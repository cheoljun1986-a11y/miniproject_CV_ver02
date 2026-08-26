import * as THREE from 'three';

import {
  VOXEL_KEYFRAME_MAX_SAMPLES,
} from './config.js';

// Turns gated XR frames into keyframe depth snapshots. The only new module that
// touches three.js, and it touches it for exactly one thing: inverting the
// view's projection matrix, the same call depth-cloud.js:67 already makes.
//
// Depth is read through getDepthInMeters(u, v) at the buffer's native
// resolution. That deliberately avoids depthInformation.data, rawValueToMeters
// and normDepthBufferFromNormView — no uint16/float32 branching to get wrong.
export class KeyframeCapture {
  constructor({
    store,
    gate,
    depthSource,
    maxSamples = VOXEL_KEYFRAME_MAX_SAMPLES,
    fallbackWidth = 160,
    fallbackHeight = 120,
  }) {
    this.store = store;
    this.gate = gate;
    this.depthSource = depthSource;
    this.maxSamples = maxSamples;
    this.fallbackWidth = fallbackWidth;
    this.fallbackHeight = fallbackHeight;
    this.inverseProjection = new THREE.Matrix4();
    this.nextFrameId = 1;
    this.lastCaptureMs = 0;
  }

  update(frame, referenceSpace, time, viewerPose) {
    if (!viewerPose) return false;
    // Pose gate first: getDepthInformation is not free, so it must not run on
    // frames the gate is going to reject anyway.
    if (!this.gate.shouldCapture(viewerPose.position, viewerPose.quaternion, time)) return false;

    const snapshot = this.depthSource.read(frame, referenceSpace);
    // views[0] only. Capturing both eyes of a stereo runtime would double every
    // observationCount without adding a viewpoint, which is precisely the
    // "green voxels in mid-air" artifact Phase 2 is trying to detect.
    const first = snapshot?.views?.[0];
    if (!first?.depthInformation) return false;

    const startedAt = time;
    const captured = this._capture(first, viewerPose);
    if (!captured) return false;

    this.lastCaptureMs = Math.max(0, time - startedAt);
    this.gate.accept(viewerPose.position, viewerPose.quaternion, time);
    return true;
  }

  _capture({ view, depthInformation }, viewerPose) {
    const nativeWidth = depthInformation.width || this.fallbackWidth;
    const nativeHeight = depthInformation.height || this.fallbackHeight;

    // Stride is the escape hatch when a device reports an unexpectedly large
    // buffer. Never read the buffer across frames instead: XRCPUDepthInformation
    // is only valid for the frame it came from.
    let stride = 1;
    while ((Math.ceil(nativeWidth / stride) * Math.ceil(nativeHeight / stride)) > this.maxSamples) {
      stride += 1;
    }
    const width = Math.ceil(nativeWidth / stride);
    const height = Math.ceil(nativeHeight / stride);

    const depths = new Float32Array(width * height);
    for (let row = 0; row < height; row += 1) {
      const v = (row + 0.5) / height;
      for (let col = 0; col < width; col += 1) {
        const u = (col + 0.5) / width;
        let depth = 0;
        try {
          depth = depthInformation.getDepthInMeters(u, v);
        } catch {
          depth = 0; // outside the valid depth region
        }
        depths[row * width + col] = Number.isFinite(depth) && depth > 0 ? depth : 0;
      }
    }

    // ARCore has no depth map yet on the first frames of a session, so the
    // opening capture is all zeros. Letting it through burns a keyframe slot
    // and shows up as a whole keyframe's worth of "0값" in the HUD.
    let valid = 0;
    for (let i = 0; i < depths.length; i += 1) if (depths[i] > 0) valid += 1;
    if (valid === 0) return false;

    this.inverseProjection.fromArray(view.projectionMatrix).invert();

    const frameId = this.nextFrameId;
    const added = this.store.add({
      frameId,
      timeMs: viewerPose.timeMs ?? 0,
      width,
      height,
      stride,
      depths,
      projectionMatrix: Array.from(view.projectionMatrix),
      invProjectionMatrix: Array.from(this.inverseProjection.elements),
      viewMatrix: Array.from(view.transform.matrix),
      viewerPosition: Array.from(viewerPose.position),
      viewerQuaternion: Array.from(viewerPose.quaternion),
    });
    // A rejected store must not consume a keyframe slot or move the pose
    // baseline, so the caller only calls gate.accept() when this returns true.
    if (!added) return false;

    this.nextFrameId += 1;
    return true;
  }

  getLastCaptureMs() {
    return this.lastCaptureMs;
  }

  reset() {
    this.nextFrameId = 1;
    this.lastCaptureMs = 0;
  }
}
