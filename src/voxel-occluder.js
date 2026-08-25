import * as THREE from 'three';

import {
  VOXEL_OCCLUDER_POLYGON_OFFSET_FACTOR,
  VOXEL_OCCLUDER_POLYGON_OFFSET_UNITS,
} from './config.js';
import { buildOccluderGeometry } from './voxel-occluder-mesh.js';

// A depth-only mesh of the scanned room. It writes the real world's geometry
// into the depth buffer before anything else is drawn, so the GPU's z-test
// hides the character behind real furniture — every frame, from any angle,
// with no per-frame CPU cost. That last property is what makes it work while
// the character is moving.
//
// renderOrder -3 puts it ahead of the runtime depth sources (CPU occluder -2,
// three's depth-sensing mesh -1). Ordering among depth-only writers does not
// change the result — they all write depth and the nearest wins — but this is
// the static, always-valid one, so it goes first.
export class VoxelOccluder {
  constructor({ scene, voxelSize = 0.05, origin = [0, 0, 0] }) {
    this.scene = scene;
    this.voxelSize = voxelSize;
    this.origin = origin;

    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      // Pushes the occluder very slightly away from the camera in depth, so a
      // character standing exactly on a real surface wins the z-test instead of
      // having its feet culled.
      polygonOffset: true,
      polygonOffsetFactor: VOXEL_OCCLUDER_POLYGON_OFFSET_FACTOR,
      polygonOffsetUnits: VOXEL_OCCLUDER_POLYGON_OFFSET_UNITS,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = -3;
    this.mesh.frustumCulled = false; // spans the whole room
    this.mesh.visible = false;
    this.scene.add(this.mesh);

    this.triangleCount = 0;
    this.revision = -1;
  }

  // Rebuilds only when the cell set actually changed. In game mode that fires
  // once; in the diagnostic it refires on every slider change.
  build(cells, revision) {
    if (revision === this.revision) return this.triangleCount;
    this.revision = revision;

    const { positions, indices, triangleCount } = buildOccluderGeometry(cells, {
      voxelSize: this.voxelSize,
      origin: this.origin,
    });

    const previous = this.geometry;
    this.geometry = new THREE.BufferGeometry();
    // Position only — colorWrite is off, so normals and uvs would never be read.
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // Uint32: a full-room scan passes 65,535 vertices, so Uint16 would wrap.
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.mesh.geometry = this.geometry;
    previous.dispose();

    this.triangleCount = triangleCount;
    this.mesh.visible = this.mesh.visible && triangleCount > 0;
    return triangleCount;
  }

  setVisible(visible) {
    this.mesh.visible = visible && this.triangleCount > 0;
  }

  isVisible() {
    return this.mesh.visible;
  }

  getTriangleCount() {
    return this.triangleCount;
  }

  setVoxelSize(size) {
    if (size === this.voxelSize) return;
    this.voxelSize = size;
    this.revision = -1; // force a rebuild at the new scale
  }

  reset() {
    this.revision = -1;
    this.triangleCount = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
