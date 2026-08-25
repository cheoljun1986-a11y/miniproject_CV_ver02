import { CameraTextureCopier } from './camera-texture-copier.js';

function defaultBindingFactory(session, gl) {
  if (typeof globalThis.XRWebGLBinding !== 'function') {
    throw new Error('WebXR camera-access를 지원하지 않는 브라우저입니다.');
  }
  return new globalThis.XRWebGLBinding(session, gl);
}

function defaultCanvasFactory() {
  return document.createElement('canvas');
}

function defaultTextureCopierFactory(gl, canvas) {
  return new CameraTextureCopier(gl, canvas);
}

export class RawCameraFrameSource {
  constructor({
    minIntervalMs = 100,
    bindingFactory = defaultBindingFactory,
    canvasFactory = defaultCanvasFactory,
    textureCopierFactory = defaultTextureCopierFactory,
  } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.bindingFactory = bindingFactory;
    this.canvasFactory = canvasFactory;
    this.textureCopierFactory = textureCopierFactory;
    this.reset();
  }

  start(session, gl) {
    this.reset();
    try {
      this.binding = this.bindingFactory(session, gl);
      this.canvas = this.canvasFactory();
      this.copier = this.textureCopierFactory(gl, this.canvas);
      this.setStatus('ready');
      return true;
    } catch (error) {
      this.setStatus('unavailable', error);
      return false;
    }
  }

  capture(frame, referenceSpace, time) {
    if (!this.binding || !this.copier || !this.canvas) return null;
    if (time - this.lastCaptureTime < this.minIntervalMs) return null;

    try {
      const pose = frame.getViewerPose(referenceSpace);
      const view = pose?.views?.find((candidate) => candidate.camera);
      if (!view?.camera) {
        this.setStatus('waiting-camera');
        return null;
      }
      const texture = this.binding.getCameraImage(view.camera);
      if (!texture) {
        this.setStatus('waiting-camera');
        return null;
      }
      this.copier.copy(texture, view.camera);
      this.lastCaptureTime = time;
      this.setStatus('ready');
      return this.canvas;
    } catch (error) {
      this.setStatus('error', error);
      return null;
    }
  }

  getCanvas() {
    return this.canvas;
  }

  getStatus() {
    return { ...this.status };
  }

  reset() {
    try {
      this.copier?.dispose?.();
    } catch {
      // The XR context may already be lost while a session is ending.
    }
    this.binding = null;
    this.canvas = null;
    this.copier = null;
    this.lastCaptureTime = -Infinity;
    this.setStatus('idle');
  }

  setStatus(state, error = null) {
    this.status = {
      state,
      detail: error ? (error.message || String(error)) : null,
    };
  }
}
