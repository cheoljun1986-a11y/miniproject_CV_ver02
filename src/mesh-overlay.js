import * as THREE from 'three';

import { surfaceFromTsdf } from './surface-nets.js';

// Draws the fused surface — the TSDF zero crossing — over the live camera.
//
// The wireframe overlay next to this one answers "which voxels exist"; this
// answers "what shape did they add up to". A slanted wall comes out slanted
// instead of stepped, because the crossing is read between voxel centres rather
// than snapped to them.
//
// No radius culling or instance cap, unlike VoxelOverlay: a mesh is a single
// draw call, and on a real room scan it is 25,978 triangles against 191,800 for
// the same map drawn as merged voxel faces. The expensive part is extracting
// it, which happens on a toggle or a rebuild — never per frame.
//
// Render contract matches VoxelOverlay: renderOrder 3 puts it above the
// character (2) and the depth meshes (-2, -1), and depthWrite MUST stay false
// or the surface poisons the depth buffer and the character vanishes behind a
// diagnostic layer. depthTest stays true, which is only honest while the
// occluders are suppressed — the caller owns that (see toggleTerrainOverlay).
export class MeshOverlay {
  constructor({ scene, color = 0x9fd8ff, opacity = 0.55 }) {
    this.scene = scene;
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({
        color,
        // Scan surfaces are open shells — a wall seen from one side has no back
        // face — so single-sided rendering would leave holes wherever the
        // player walks around something.
        side: THREE.DoubleSide,
        flatShading: true,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.scene.add(this.mesh);

    this.revision = -1;
    this.triangleCount = 0;
  }

  // Rebuilds from a TsdfGrid when the map has moved on. `revision` is the
  // caller's cheap "has anything changed" token; extraction is far too costly
  // to run per frame, and the map it reads is frozen for most of a session.
  build(grid, revision, { minWeight = 1 } = {}) {
    if (!grid || revision === this.revision) return this.triangleCount;
    this.revision = revision;

    const geo = surfaceFromTsdf(grid, { minWeight });
    const previous = this.mesh.geometry;
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    next.setIndex(new THREE.BufferAttribute(geo.indices, 1));
    // Surface Nets emits one vertex per straddling cell shared by its quads, so
    // averaged normals would smooth across genuine creases. flatShading above
    // means the shader takes the face normal anyway; these are computed so the
    // geometry is complete for anything else that reads it.
    next.computeVertexNormals();
    this.mesh.geometry = next;
    previous.dispose();

    this.triangleCount = geo.triangleCount;
    return this.triangleCount;
  }

  getTriangleCount() {
    return this.triangleCount;
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  isVisible() {
    return this.mesh.visible;
  }

  clear() {
    const previous = this.mesh.geometry;
    this.mesh.geometry = new THREE.BufferGeometry();
    previous.dispose();
    this.revision = -1;
    this.triangleCount = 0;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
