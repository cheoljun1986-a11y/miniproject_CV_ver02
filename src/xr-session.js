import * as THREE from 'three';

export class XRSessionController {
  constructor({ renderer, reticle, onHitTestError }) {
    this.renderer = renderer;
    this.reticle = reticle;
    this.onHitTestError = onHitTestError;
    this.session = null;
    this.localSpace = null;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.currentHitResult = null;
    this.viewerPose = null;
  }

  async start() {
    this.session = this.renderer.xr.getSession();
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.currentHitResult = null;
    this.viewerPose = null;

    try {
      this.localSpace = await this.session.requestReferenceSpace('local');
    } catch {
      this.localSpace = this.renderer.xr.getReferenceSpace();
    }
  }

  end() {
    this.session = null;
    this.localSpace = null;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.currentHitResult = null;
    this.viewerPose = null;
    this.reticle.visible = false;
  }

  async requestHitTestSource() {
    if (!this.session || this.hitTestSourceRequested) return;
    this.hitTestSourceRequested = true;
    try {
      const viewerSpace = await this.session.requestReferenceSpace('viewer');
      this.hitTestSource = await this.session.requestHitTestSource({ space: viewerSpace });
      this.session.addEventListener('end', () => {
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
      });
    } catch (error) {
      console.error(error);
      this.onHitTestError?.(error);
    }
  }

  update(frame) {
    if (this.session && !this.hitTestSourceRequested) this.requestHitTestSource();
    this.updateViewerPose(frame);
    const surface = this.updateHitTest(frame);
    return { viewerPose: this.viewerPose, surface };
  }

  updateViewerPose(frame) {
    if (!this.localSpace) return;
    const pose = frame.getViewerPose(this.localSpace);
    if (!pose) return;

    const position = pose.transform.position;
    const orientation = pose.transform.orientation;
    this.viewerPose = {
      position: [position.x, position.y, position.z],
      quaternion: [orientation.x, orientation.y, orientation.z, orientation.w],
    };
  }

  updateHitTest(frame) {
    this.currentHitResult = null;
    this.reticle.visible = false;
    if (!this.hitTestSource || !this.localSpace) return null;

    const results = frame.getHitTestResults(this.hitTestSource);
    if (!results.length) return null;

    const result = results[0];
    const pose = result.getPose(this.localSpace);
    if (!pose) return null;

    this.currentHitResult = result;
    this.reticle.visible = true;
    this.reticle.matrix.fromArray(pose.transform.matrix);

    const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
    return {
      matrix: Array.from(pose.transform.matrix),
      position: [position.x, position.y, position.z],
      upY: up.y,
      hitResult: result,
    };
  }

  getSession() {
    return this.session;
  }

  getLocalSpace() {
    return this.localSpace;
  }

  getViewerPose() {
    return this.viewerPose;
  }

  hasHitTest() {
    return this.reticle.visible;
  }
}
