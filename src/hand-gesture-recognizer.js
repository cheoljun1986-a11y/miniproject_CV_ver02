import {
  HAND_MIN_CONFIDENCE,
} from './config.js';
import { mapGestureLabel } from './rps-rules.js';

export const MEDIAPIPE_VERSION = '1.0.1';
export const MEDIAPIPE_MODULE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
export const MEDIAPIPE_WASM_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const GESTURE_MODEL_URL =
  new URL('../assets/gesture_recognizer.task', import.meta.url).href;

export async function createMediaPipeRecognizer() {
  const { FilesetResolver, GestureRecognizer } = await import(MEDIAPIPE_MODULE_URL);
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const common = {
    baseOptions: {
      modelAssetPath: GESTURE_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: HAND_MIN_CONFIDENCE,
    minHandPresenceConfidence: HAND_MIN_CONFIDENCE,
    minTrackingConfidence: 0.6,
  };
  try {
    return await GestureRecognizer.createFromOptions(vision, common);
  } catch (gpuError) {
    console.warn('MediaPipe GPU delegate unavailable; retrying on CPU.', gpuError);
    return GestureRecognizer.createFromOptions(vision, {
      ...common,
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL },
    });
  }
}

export class HandGestureRecognizer {
  constructor({
    consensus,
    createRecognizer = createMediaPipeRecognizer,
  }) {
    this.consensus = consensus;
    this.createRecognizer = createRecognizer;
    this.recognizer = null;
    this.setStatus('idle');
  }

  async initialize() {
    if (this.status.state === 'ready') return true;
    this.setStatus('loading');
    try {
      this.recognizer = await this.createRecognizer();
      this.setStatus('ready');
      return true;
    } catch (error) {
      this.recognizer = null;
      this.setStatus('error', error);
      return false;
    }
  }

  recognize(image, time) {
    if (this.status.state !== 'ready' || !this.recognizer) return null;
    try {
      const result = this.recognizer.recognizeForVideo(image, time);
      const category = result?.gestures?.[0]?.[0];
      const move = mapGestureLabel(category?.categoryName);
      if (!move) return null;
      return this.consensus.add({
        move,
        confidence: category.score,
        time,
      });
    } catch (error) {
      this.setStatus('error', error);
      return null;
    }
  }

  resetRound() {
    this.consensus.reset();
  }

  close() {
    try {
      this.recognizer?.close?.();
    } catch {
      // MediaPipe may already be torn down while the page is unloading.
    }
    this.recognizer = null;
    this.consensus.reset();
    this.setStatus('idle');
  }

  getStatus() {
    return { ...this.status };
  }

  setStatus(state, error = null) {
    this.status = {
      state,
      detail: error ? (error.message || String(error)) : null,
    };
  }
}
