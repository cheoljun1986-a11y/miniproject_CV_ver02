// Raw scan material and the rebuild that turns it into a voxel grid. Pure: no
// three.js, no DOM, no WebXR.
//
// The point of storing keyframes at all is that every filter threshold becomes
// re-tunable after the scan. Building the grid during capture — as
// depth-cloud.js does — means changing any parameter requires another 20-second
// walk, and two walks are different data, so filters can never be compared.

import { filterDepthGrid } from './depth-grid-filter.js';
import { depthSampleToWorld } from './depth-math.js';
import { VoxelGrid } from './voxel-grid.js';

export const KEYFRAME_JSON_VERSION = 1;

// Depth is quantized to millimetres on export. That is lossless relative to a
// 30-50mm voxel and roughly halves the payload.
const MM = 1000;

export class KeyframeStore {
  constructor({ maxKeyframes = 15 } = {}) {
    this.maxKeyframes = maxKeyframes;
    this.keyframes = [];
  }

  add(keyframe) {
    if (this.keyframes.length >= this.maxKeyframes) return false;
    this.keyframes.push(keyframe);
    return true;
  }

  getKeyframes() {
    return this.keyframes;
  }

  getCount() {
    return this.keyframes.length;
  }

  getElapsedMs() {
    if (this.keyframes.length < 2) return 0;
    return this.keyframes[this.keyframes.length - 1].timeMs - this.keyframes[0].timeMs;
  }

  // Recorded so a session whose XR local space was re-established mid-scan is
  // diagnosable rather than mysterious: every later pose shifts relative to the
  // earlier ones, which reads exactly like a grid-alignment failure.
  getFirstViewerPosition() {
    return this.keyframes[0]?.viewerPosition ?? null;
  }

  reset() {
    this.keyframes = [];
  }

  toJSON() {
    return {
      version: KEYFRAME_JSON_VERSION,
      maxKeyframes: this.maxKeyframes,
      keyframes: this.keyframes.map((k) => ({
        frameId: k.frameId,
        timeMs: k.timeMs,
        width: k.width,
        height: k.height,
        depths: Array.from(k.depths, (d) => Math.round(d * MM) / MM),
        projectionMatrix: Array.from(k.projectionMatrix),
        invProjectionMatrix: Array.from(k.invProjectionMatrix),
        viewMatrix: Array.from(k.viewMatrix),
        viewerPosition: Array.from(k.viewerPosition),
        viewerQuaternion: Array.from(k.viewerQuaternion),
      })),
    };
  }
}

export function keyframeStoreFromJSON(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.version !== KEYFRAME_JSON_VERSION) return null;
  if (!Array.isArray(json.keyframes)) return null;

  const store = new KeyframeStore({
    maxKeyframes: json.maxKeyframes ?? json.keyframes.length,
  });
  for (const k of json.keyframes) {
    if (!k || !Array.isArray(k.depths)) return null;
    if (k.depths.length !== k.width * k.height) return null;
    if (!Array.isArray(k.invProjectionMatrix) || k.invProjectionMatrix.length !== 16) return null;
    if (!Array.isArray(k.viewMatrix) || k.viewMatrix.length !== 16) return null;
    store.keyframes.push({
      frameId: k.frameId,
      timeMs: k.timeMs,
      width: k.width,
      height: k.height,
      depths: Float32Array.from(k.depths),
      projectionMatrix: k.projectionMatrix ?? k.invProjectionMatrix,
      invProjectionMatrix: k.invProjectionMatrix,
      viewMatrix: k.viewMatrix,
      viewerPosition: k.viewerPosition ?? [0, 0, 0],
      viewerQuaternion: k.viewerQuaternion ?? [0, 0, 0, 1],
    });
  }
  return store;
}

// Drains keyframes strictly in order — this is the precondition that makes
// VoxelGrid's single lastFrameId equivalent to a per-cell Set<frameId>.
export function rebuildVoxelGrid(keyframes, {
  voxelSize = 0.05,
  origin = [0, 0, 0],
  nearM = 0.3,
  farM = 5.0,
  gradientMaxJumpM = 0.10,
  rejectOnMissingNeighbor = false,
  maxCells = 200000,
  now = () => 0,
} = {}) {
  const startedAt = now();
  const grid = new VoxelGrid({ voxelSize, origin, maxCells });
  const stats = {
    keyframes: keyframes.length,
    samplesTotal: 0,
    rejectedZero: 0,
    rejectedRange: 0,
    rejectedGradient: 0,
    rejectedUnproject: 0,
    accepted: 0,
    cells: 0,
    truncated: false,
    histogram: null,
    buildMs: 0,
  };

  for (const keyframe of keyframes) {
    const { width, height, depths, invProjectionMatrix, viewMatrix, frameId } = keyframe;
    const pass = filterDepthGrid(
      { depths, width, height },
      { nearM, farM, gradientMaxJumpM, rejectOnMissingNeighbor },
      (col, row, depth) => {
        const u = (col + 0.5) / width;
        const v = (row + 0.5) / height;
        const point = depthSampleToWorld(u, v, depth, invProjectionMatrix, viewMatrix);
        if (!point) {
          stats.rejectedUnproject += 1;
          return;
        }
        if (grid.observe(point[0], point[1], point[2], frameId) === 'full') {
          stats.truncated = true;
        }
      },
    );

    stats.samplesTotal += pass.total;
    stats.rejectedZero += pass.rejectedZero;
    stats.rejectedRange += pass.rejectedRange;
    stats.rejectedGradient += pass.rejectedGradient;
    stats.accepted += pass.accepted;
  }

  // rejectedUnproject is carved out of what filterDepthGrid counted as accepted,
  // so the five buckets add up to samplesTotal.
  stats.accepted -= stats.rejectedUnproject;
  stats.cells = grid.getCellCount();
  stats.histogram = grid.getHistogram();
  stats.buildMs = now() - startedAt;
  return { grid, stats };
}
