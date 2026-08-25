import * as THREE from 'three';

import {
  VOXEL_OVERLAY_MAX_INSTANCES,
  VOXEL_OVERLAY_RADIUS_M,
  VOXEL_OVERLAY_REBUILD_STEP_M,
  VOXEL_SIZE_M,
} from './config.js';
import { cellMeanPosition } from './voxel-grid.js';
import { voxelColorRGB } from './voxel-color-modes.js';

// Draws the reconstructed voxels as a wireframe on top of the live camera feed.
// This is the only view that answers "does a voxel actually sit ON that table",
// which the orbit view cannot show.
//
// Render order sits above the ninja (2). depthWrite MUST stay false: a wireframe
// writing depth would poison the buffer for the ninja and produce phantom
// occlusion that reads as a voxel-map defect.
//
// depthTest stays true, which is only correct because ?voxel=debug runs with no
// occluder — neither the CPU depth mesh (renderOrder -2) nor three's GPU depth
// mesh (-1). If either wrote real-world depth, every voxel behind a real object
// would be culled, hiding exactly what we need to judge.
export class VoxelOverlay {
  constructor({
    scene,
    voxelSize = VOXEL_SIZE_M,
    maxInstances = VOXEL_OVERLAY_MAX_INSTANCES,
    radiusM = VOXEL_OVERLAY_RADIUS_M,
  }) {
    this.scene = scene;
    this.voxelSize = voxelSize;
    this.maxInstances = maxInstances;
    this.radiusM = radiusM;

    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize),
      // vertexColors is deliberately absent — see the same note in
      // operator-view.js. With it, USE_COLOR zeroes every instance colour
      // against a BoxGeometry that has no colour attribute, and the wireframe
      // draws black, which is all but invisible over a camera feed.
      new THREE.MeshBasicMaterial({
        wireframe: true,
        transparent: true,
        opacity: 0.6,
        depthTest: true,
        depthWrite: false,
      }),
      maxInstances,
    );
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 3),
      3,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.scene.add(this.mesh);

    this._matrix = new THREE.Matrix4();
    this._color = new THREE.Color();
    this.revision = -1;
    this.lastCameraPosition = null;
  }

  setVoxelSize(size) {
    if (size === this.voxelSize) return;
    this.voxelSize = size;
    const previous = this.mesh.geometry;
    this.mesh.geometry = new THREE.BoxGeometry(size, size, size);
    previous.dispose();
    this.revision = -1;
  }

  setCells(cells, revision, colorMode, { cameraPosition = null, minY = -1, spanY = 3 } = {}) {
    if (!this.mesh.visible) return 0;

    // Rebuild on new data, or once the camera has walked far enough that the
    // radius cull would pick a meaningfully different set. Not every frame.
    const moved = cameraPosition && this.lastCameraPosition
      ? Math.hypot(
        cameraPosition[0] - this.lastCameraPosition[0],
        cameraPosition[1] - this.lastCameraPosition[1],
        cameraPosition[2] - this.lastCameraPosition[2],
      )
      : Infinity;
    if (revision === this.revision && moved < VOXEL_OVERLAY_REBUILD_STEP_M) return this.mesh.count;

    this.revision = revision;
    if (cameraPosition) {
      this.lastCameraPosition = [cameraPosition[0], cameraPosition[1], cameraPosition[2]];
    }

    // Wireframe lines are expensive per instance and compete with the camera
    // composite, so keep only what is near the viewer, nearest first.
    const nearby = [];
    for (const cell of cells) {
      const position = cellMeanPosition(cell);
      if (cameraPosition) {
        const distance = Math.hypot(
          position[0] - cameraPosition[0],
          position[1] - cameraPosition[1],
          position[2] - cameraPosition[2],
        );
        if (distance > this.radiusM) continue;
        nearby.push({ cell, position, distance });
      } else {
        nearby.push({ cell, position, distance: 0 });
      }
    }
    nearby.sort((a, b) => a.distance - b.distance);

    const count = Math.min(nearby.length, this.maxInstances);
    for (let i = 0; i < count; i += 1) {
      const { cell, position } = nearby[i];
      this._matrix.makeTranslation(position[0], position[1], position[2]);
      this.mesh.setMatrixAt(i, this._matrix);
      const [r, g, b] = voxelColorRGB(cell, colorMode, { y: position[1], minY, spanY });
      this._color.setRGB(r, g, b);
      this.mesh.setColorAt(i, this._color);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return count;
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    if (visible) this.revision = -1; // force a rebuild on the next setCells
  }

  isVisible() {
    return this.mesh.visible;
  }

  clear() {
    this.mesh.count = 0;
    this.revision = -1;
    this.lastCameraPosition = null;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
