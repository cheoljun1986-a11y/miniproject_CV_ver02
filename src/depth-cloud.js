import * as THREE from 'three';

import {
  DEPTH_CLOUD_GRID_COLS,
  DEPTH_CLOUD_GRID_ROWS,
  DEPTH_CLOUD_MAX_POINTS,
  DEPTH_CLOUD_MAX_RANGE_M,
  DEPTH_CLOUD_SAMPLE_GAP_MS,
  DEPTH_CLOUD_VOXEL_M,
} from './config.js';
import { depthSampleToWorld, voxelKey } from './depth-math.js';

// Accumulates a world-space point cloud from WebXR cpu-optimized depth frames.
// Each frame samples a coarse grid of the depth image, unprojects every sample
// into the local reference space, deduplicates by voxel, and grows a single
// THREE.Points cloud so the room fills in as you walk and scan. Points are
// coloured by height for readability. Requires the session to have been created
// with depth-sensing in cpu-optimized usage; otherwise update() is a no-op.
export class DepthCloud {
  constructor({ scene, voxelMap = null, renderPoints = true }) {
    this.scene = scene;
    this.voxelMap = voxelMap;
    this.renderPoints = renderPoints;
    this.lastSampleTime = -Infinity;
    this.occupied = new Set();
    this.count = 0;

    this.positions = new Float32Array(DEPTH_CLOUD_MAX_POINTS * 3);
    this.colors = new Float32Array(DEPTH_CLOUD_MAX_POINTS * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({ size: 0.012, vertexColors: true, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    // In cloud mode the operator view shows the reconstruction; the raw points
    // are only added to the AR game scene when explicitly requested.
    if (renderPoints) this.scene.add(this.points);
  }

  update(frame, localSpace, time) {
    if (!localSpace || typeof frame.getDepthInformation !== 'function') return this.count;
    if (time - this.lastSampleTime < DEPTH_CLOUD_SAMPLE_GAP_MS) return this.count;
    this.lastSampleTime = time;

    const pose = frame.getViewerPose(localSpace);
    if (!pose) return this.count;

    const invProjection = new THREE.Matrix4();
    for (const view of pose.views) {
      const depthInfo = frame.getDepthInformation(view);
      if (!depthInfo) continue;

      invProjection.fromArray(view.projectionMatrix).invert();
      const invProjectionArray = invProjection.elements;
      const viewMatrix = view.transform.matrix;
      this.sampleView(depthInfo, invProjectionArray, viewMatrix);
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
    this.geometry.computeBoundingSphere();
    return this.count;
  }

  sampleView(depthInfo, invProjection, viewMatrix) {
    for (let row = 0; row < DEPTH_CLOUD_GRID_ROWS; row += 1) {
      const v = (row + 0.5) / DEPTH_CLOUD_GRID_ROWS;
      for (let col = 0; col < DEPTH_CLOUD_GRID_COLS; col += 1) {
        if (this.count >= DEPTH_CLOUD_MAX_POINTS) return;
        const u = (col + 0.5) / DEPTH_CLOUD_GRID_COLS;

        let depth;
        try {
          depth = depthInfo.getDepthInMeters(u, v);
        } catch {
          continue; // sample outside the valid depth region
        }
        if (!(depth > 0) || depth > DEPTH_CLOUD_MAX_RANGE_M) continue;

        const point = depthSampleToWorld(u, v, depth, invProjection, viewMatrix);
        if (!point) continue;
        this.voxelMap?.observe(point);
        this.addPoint(point);
      }
    }
  }

  addPoint([x, y, z]) {
    const key = voxelKey(x, y, z, DEPTH_CLOUD_VOXEL_M);
    if (this.occupied.has(key)) return;
    this.occupied.add(key);

    const offset = this.count * 3;
    this.positions[offset] = x;
    this.positions[offset + 1] = y;
    this.positions[offset + 2] = z;

    // Height ramp: low = blue-ish, high = warm, so structure reads at a glance.
    const t = THREE.MathUtils.clamp((y + 1) / 3, 0, 1);
    this.colors[offset] = 0.2 + 0.8 * t;
    this.colors[offset + 1] = 0.5;
    this.colors[offset + 2] = 1 - 0.8 * t;
    this.count += 1;
  }

  getCount() {
    return this.count;
  }

  reset() {
    this.occupied.clear();
    this.count = 0;
    this.lastSampleTime = -Infinity;
    this.geometry.setDrawRange(0, 0);
  }
}
