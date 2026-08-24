// Object detection for WebXR Hidden Ninja.
//
// Detector contract (shared by every implementation):
//   await detector.init();
//   const dets = await detector.detect(imageSource);
//   // dets: [{x1, y1, x2, y2, score, classId, label}]  — pixel coords of the input image
//
// imageSource: ImageData | HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap
//
// Implementations:
//   OnnxYoloDetector — YOLO26n (or YOLOv8-family) ONNX in the browser via onnxruntime-web
//   RemoteDetector   — same contract over HTTP; swap it in to run SAM2.1/YOLOE/etc. on a
//                      Python server later without touching game code

const ORT_VERSION = '1.22.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

export const COCO_LABELS = [
  'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light',
  'fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow',
  'elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee',
  'skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard',
  'tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple',
  'sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch',
  'potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard',
  'cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase',
  'scissors','teddy bear','hair drier','toothbrush'
];

const KO_LABELS = {
  chair:'의자', couch:'소파', bench:'벤치', backpack:'백팩', handbag:'핸드백', suitcase:'캐리어',
  'potted plant':'화분', bed:'침대', 'dining table':'테이블', tv:'TV', laptop:'노트북',
  bottle:'병', cup:'컵', book:'책', bicycle:'자전거', motorcycle:'오토바이', car:'자동차',
  bus:'버스', truck:'트럭', umbrella:'우산', dog:'개', cat:'고양이', bird:'새',
  refrigerator:'냉장고', microwave:'전자레인지', sink:'싱크대', toilet:'변기', clock:'시계',
  vase:'꽃병', keyboard:'키보드', mouse:'마우스', 'cell phone':'휴대폰', person:'사람',
  'fire hydrant':'소화전', 'stop sign':'정지표지판', 'traffic light':'신호등', 'sports ball':'공'
};

export function labelKo(label) { return KO_LABELS[label] || label; }

let ortPromise = null;
function loadOrt() {
  if (!ortPromise) {
    ortPromise = import(ORT_BASE + 'ort.webgpu.min.mjs').then(ort => {
      ort.env.wasm.wasmPaths = ORT_BASE;
      return ort;
    });
  }
  return ortPromise;
}

function float32ToFloat16Bits(val) {
  // IEEE 754 float32 -> float16 (round-to-nearest), returns uint16 bits
  f32[0] = val;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf/NaN
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00;                        // overflow -> Inf
  if (exp <= 0) {                                               // subnormal / underflow
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  return sign | (exp << 10) | ((mant + 0x1000) >> 13);
}
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

function float16BitsToFloat32(bits) {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

function toCanvasSource(source) {
  // Normalize an ImageData into a canvas so ctx.drawImage can consume every source type.
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    const c = document.createElement('canvas');
    c.width = source.width; c.height = source.height;
    c.getContext('2d').putImageData(source, 0, 0);
    return { src: c, w: source.width, h: source.height };
  }
  const w = source.videoWidth ?? source.naturalWidth ?? source.width;
  const h = source.videoHeight ?? source.naturalHeight ?? source.height;
  return { src: source, w, h };
}

export class OnnxYoloDetector {
  constructor({ modelUrl, inputSize = 640, confThreshold = 0.35, iouThreshold = 0.45 } = {}) {
    this.modelUrl = modelUrl;
    this.inputSize = inputSize;
    this.confThreshold = confThreshold;
    this.iouThreshold = iouThreshold;
    this.backend = null;
    this.inputDtype = null;   // resolved on first detect ('float32' or 'float16')
    this.lastInferMs = 0;
    this.lastOutputDims = null;
  }

  async init() {
    this.ort = await loadOrt();
    for (const ep of ['webgpu', 'wasm']) {
      try {
        this.session = await this.ort.InferenceSession.create(this.modelUrl, { executionProviders: [ep] });
        this.backend = ep;
        break;
      } catch (err) {
        if (ep === 'wasm') throw err;
        console.warn('webgpu EP unavailable, falling back to wasm:', err?.message || err);
      }
    }
    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];
    const S = this.inputSize;
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(S, S) : document.createElement('canvas');
    this.canvas.width = S; this.canvas.height = S;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  preprocess(source) {
    const S = this.inputSize;
    const { src, w, h } = toCanvasSource(source);
    const scale = Math.min(S / w, S / h);
    const dw = Math.round(w * scale), dh = Math.round(h * scale);
    const padX = Math.floor((S - dw) / 2), padY = Math.floor((S - dh) / 2);
    this.ctx.fillStyle = '#727272';
    this.ctx.fillRect(0, 0, S, S);
    this.ctx.drawImage(src, 0, 0, w, h, padX, padY, dw, dh);
    const { data } = this.ctx.getImageData(0, 0, S, S);
    const n = S * S;
    const chw = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      chw[i]         = data[i * 4]     / 255; // R
      chw[n + i]     = data[i * 4 + 1] / 255; // G
      chw[2 * n + i] = data[i * 4 + 2] / 255; // B
    }
    return { chw, scale, padX, padY, srcW: w, srcH: h };
  }

  makeTensor(chw, dtype) {
    const S = this.inputSize;
    if (dtype === 'float16') {
      const half = new Uint16Array(chw.length);
      for (let i = 0; i < chw.length; i++) half[i] = float32ToFloat16Bits(chw[i]);
      return new this.ort.Tensor('float16', half, [1, 3, S, S]);
    }
    return new this.ort.Tensor('float32', chw, [1, 3, S, S]);
  }

  async run(chw) {
    // The FP16 export takes float16 input; resolve the dtype once by trying float32 first.
    const tryOrder = this.inputDtype ? [this.inputDtype] : ['float32', 'float16'];
    let lastErr = null;
    for (const dtype of tryOrder) {
      try {
        const out = await this.session.run({ [this.inputName]: this.makeTensor(chw, dtype) });
        this.inputDtype = dtype;
        return out;
      } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }

  async detect(source) {
    const { chw, scale, padX, padY, srcW, srcH } = this.preprocess(source);
    const t0 = performance.now();
    const outputs = await this.run(chw);
    this.lastInferMs = performance.now() - t0;

    const out = outputs[this.outputName] ?? outputs[Object.keys(outputs)[0]];
    this.lastOutputDims = out.dims.slice();
    let data;
    if (out.type === 'float16') {
      data = new Float32Array(out.data.length);
      for (let i = 0; i < out.data.length; i++) data[i] = float16BitsToFloat32(out.data[i]);
    } else {
      data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
    }

    let dets;
    if (out.dims.length === 3 && out.dims[2] === 6) {
      dets = this.parseEnd2End(data, out.dims);          // YOLO26 end2end: [1, 300, 6]
    } else if (out.dims.length === 3) {
      dets = this.parseRawWithNms(data, out.dims);       // YOLOv8-style raw: [1, 84, 8400]
    } else {
      throw new Error(`unexpected output dims: ${out.dims}`);
    }

    // Map letterboxed 640-space coords back to source pixels.
    for (const d of dets) {
      d.x1 = Math.max(0, Math.min(srcW, (d.x1 - padX) / scale));
      d.y1 = Math.max(0, Math.min(srcH, (d.y1 - padY) / scale));
      d.x2 = Math.max(0, Math.min(srcW, (d.x2 - padX) / scale));
      d.y2 = Math.max(0, Math.min(srcH, (d.y2 - padY) / scale));
      d.label = COCO_LABELS[d.classId] ?? `class${d.classId}`;
    }
    return dets.filter(d => d.x2 - d.x1 > 2 && d.y2 - d.y1 > 2);
  }

  parseEnd2End(data, dims) {
    const dets = [];
    for (let i = 0; i < dims[1]; i++) {
      const o = i * 6;
      const score = data[o + 4];
      if (score < this.confThreshold) continue;
      dets.push({ x1: data[o], y1: data[o + 1], x2: data[o + 2], y2: data[o + 3], score, classId: data[o + 5] | 0 });
    }
    return dets;
  }

  parseRawWithNms(data, dims) {
    // Accepts [1, C, N] (channels-first, typical) or [1, N, C]; C = 4 box + numClasses scores.
    let C = dims[1], N = dims[2], channelsFirst = true;
    if (dims[1] > dims[2]) { C = dims[2]; N = dims[1]; channelsFirst = false; }
    const at = channelsFirst ? (c, i) => data[c * N + i] : (c, i) => data[i * C + c];
    const numClasses = C - 4;

    const cands = [];
    for (let i = 0; i < N; i++) {
      let best = 0, bestC = -1;
      for (let c = 0; c < numClasses; c++) {
        const s = at(4 + c, i);
        if (s > best) { best = s; bestC = c; }
      }
      if (best < this.confThreshold) continue;
      const cx = at(0, i), cy = at(1, i), w = at(2, i), h = at(3, i);
      cands.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: best, classId: bestC });
    }

    cands.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const c of cands) {
      let ok = true;
      for (const k of kept) {
        const ix = Math.max(0, Math.min(c.x2, k.x2) - Math.max(c.x1, k.x1));
        const iy = Math.max(0, Math.min(c.y2, k.y2) - Math.max(c.y1, k.y1));
        const inter = ix * iy;
        const union = (c.x2 - c.x1) * (c.y2 - c.y1) + (k.x2 - k.x1) * (k.y2 - k.y1) - inter;
        if (union > 0 && inter / union > this.iouThreshold) { ok = false; break; }
      }
      if (ok) kept.push(c);
      if (kept.length >= 100) break;
    }
    return kept;
  }
}

export class RemoteDetector {
  // Server contract: POST <endpoint> with a JPEG body (Content-Type: image/jpeg),
  // response JSON: [{x1, y1, x2, y2, score, label, classId?}] in pixel coords of the sent image.
  // Latency is absorbed by the game's pose-at-capture design, so 100–300ms round trips are fine.
  constructor({ endpoint, confThreshold = 0.35, jpegQuality = 0.7 } = {}) {
    this.endpoint = endpoint;
    this.confThreshold = confThreshold;
    this.jpegQuality = jpegQuality;
    this.backend = 'remote';
    this.lastInferMs = 0;
  }

  async init() { /* nothing to preload */ }

  async detect(source) {
    const { src, w, h } = toCanvasSource(source);
    let canvas = src;
    if (!(src instanceof HTMLCanvasElement)) {
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(src, 0, 0, w, h);
    }
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', this.jpegQuality));
    const t0 = performance.now();
    const resp = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    this.lastInferMs = performance.now() - t0;
    if (!resp.ok) throw new Error(`remote detector HTTP ${resp.status}`);
    const dets = await resp.json();
    return dets.filter(d => d.score >= this.confThreshold);
  }
}
