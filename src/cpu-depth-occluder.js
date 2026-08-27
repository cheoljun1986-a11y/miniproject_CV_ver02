import * as THREE from 'three';

import {
  CPU_OCCLUSION_GRID_COLS,
  CPU_OCCLUSION_GRID_ROWS,
  CPU_OCCLUSION_DEPTH_BIAS_M,
  CPU_OCCLUSION_MAX_DEPTH_JUMP_M,
  CPU_OCCLUSION_MAX_RANGE_M,
  CPU_OCCLUSION_SAMPLE_GAP_MS,
  CPU_OCCLUSION_STALE_MS,
} from './config.js';
import { depthSampleToWorld } from './depth-math.js';
import { CpuDepthFrameSource } from './cpu-depth-frame-source.js';
import { depthWithOcclusionBias, writeGridTriangleIndices } from './cpu-occlusion-math.js';
import { isDepthStale, isDepthUpdateDue } from './depth-update-policy.js';

const VERTEX_COUNT = CPU_OCCLUSION_GRID_COLS * CPU_OCCLUSION_GRID_ROWS;
const MAX_INDEX_COUNT = (CPU_OCCLUSION_GRID_COLS - 1)
  * (CPU_OCCLUSION_GRID_ROWS - 1)
  * 6;

export class CpuDepthOccluder {
  constructor({ scene, depthSource = new CpuDepthFrameSource() }) {
    this.scene = scene;
    this.depthSource = depthSource;
    this.lastSampleTime = -Infinity;
    this.lastDepthTime = -Infinity;
    this.triangleCount = 0;
    this.positions = new Float32Array(VERTEX_COUNT * 3);
    this.depths = new Float32Array(VERTEX_COUNT);
    this.indices = new Uint16Array(MAX_INDEX_COUNT);
    this.inverseProjection = new THREE.Matrix4();

    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.indexAttribute = new THREE.BufferAttribute(this.indices, 1);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.indexAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setIndex(this.indexAttribute);
    this.geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.suppressed = false;
    this.scene.add(this.mesh);
  }

  // Stops the mesh being drawn without tearing down the sampling, so the
  // terrain overlay can borrow the depth buffer for a moment and hand it back.
  // Sampling continues meanwhile: coming back to a stale mesh would pop.
  setSuppressed(suppressed) {
    this.suppressed = Boolean(suppressed);
    if (this.suppressed) this.mesh.visible = false;
  }

  update(frame, referenceSpace, time) {
    if (!isDepthUpdateDue(this.lastSampleTime, time, CPU_OCCLUSION_SAMPLE_GAP_MS)) {
      this.hideIfStale(time);
      return this.triangleCount;
    }
    this.lastSampleTime = time;

    const snapshot = this.depthSource.read(frame, referenceSpace);
    for (const { view, depthInformation } of snapshot.views) {
      this.sampleView(depthInformation, view);
      this.lastDepthTime = time;
      this.mesh.visible = !this.suppressed && this.triangleCount > 0;
      return this.triangleCount;
    }

    this.hideIfStale(time);
    return this.triangleCount;
  }

  sampleView(depthInfo, view) {
    this.inverseProjection.fromArray(view.projectionMatrix).invert();
    const inverseProjection = this.inverseProjection.elements;
    const viewMatrix = view.transform.matrix;

    for (let row = 0; row < CPU_OCCLUSION_GRID_ROWS; row += 1) {
      const v = (row + 0.5) / CPU_OCCLUSION_GRID_ROWS;
      for (let col = 0; col < CPU_OCCLUSION_GRID_COLS; col += 1) {
        const u = (col + 0.5) / CPU_OCCLUSION_GRID_COLS;
        const vertexIndex = row * CPU_OCCLUSION_GRID_COLS + col;
        let depth = 0;
        try {
          depth = depthInfo.getDepthInMeters(u, v);
        } catch {
          // A runtime may reject samples outside its valid transformed region.
        }
        this.depths[vertexIndex] = depth;

        const positionOffset = vertexIndex * 3;
        const occlusionDepth = depthWithOcclusionBias(
          depth,
          CPU_OCCLUSION_DEPTH_BIAS_M,
          CPU_OCCLUSION_MAX_RANGE_M,
        );
        const point = occlusionDepth !== null
          ? depthSampleToWorld(u, v, occlusionDepth, inverseProjection, viewMatrix)
          : null;
        this.positions[positionOffset] = point?.[0] ?? 0;
        this.positions[positionOffset + 1] = point?.[1] ?? 0;
        this.positions[positionOffset + 2] = point?.[2] ?? 0;
      }
    }

    const indexCount = writeGridTriangleIndices(
      this.depths,
      CPU_OCCLUSION_GRID_COLS,
      CPU_OCCLUSION_GRID_ROWS,
      this.indices,
      CPU_OCCLUSION_MAX_DEPTH_JUMP_M,
      CPU_OCCLUSION_MAX_RANGE_M,
    );
    this.triangleCount = indexCount / 3;
    this.geometry.setDrawRange(0, indexCount);
    this.positionAttribute.needsUpdate = true;
    this.indexAttribute.needsUpdate = true;
  }

  hideIfStale(time) {
    if (!isDepthStale(this.lastDepthTime, time, CPU_OCCLUSION_STALE_MS)) return;
    this.triangleCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  getTriangleCount() {
    return this.triangleCount;
  }

  reset() {
    this.lastSampleTime = -Infinity;
    this.lastDepthTime = -Infinity;
    this.triangleCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }
}
