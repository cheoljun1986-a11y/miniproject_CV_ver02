import * as THREE from 'three';

import {
  CHASE_CELL_SIZE_M,
  CHASE_OVERLAY_MAX_INSTANCES,
  CHASE_OVERLAY_RADIUS_M,
  CHASE_OVERLAY_REBUILD_STEP_M,
  CHASE_OVERLAY_TILE_THICKNESS_M,
} from './config.js';

// Draws the chase terrain over the live camera: green where Hachuping may
// stand, red where the map says it may not.
//
// Why the traversal grid rather than the voxels it was built from: the question
// this answers is "is Hachuping standing on something the runner believes in,
// and is it going around what the runner believes is solid". Raw voxels show
// the geometry; only these tiles show the decision the chase actually makes,
// which is where the bugs live (a floater becoming a ledge, a floor hole
// splitting the room).
//
// Coordinates: tiles come out of TraversalGrid in MAP space (the anchor's
// frame), the same space Hachuping's position lives in before rendering. They
// must therefore go through the same toRender conversion the character does, or
// a drift correction would move the character and leave the tiles behind —
// exactly the mismatch this overlay exists to rule out.
//
// depthWrite stays false so the tiles never occlude the character. depthTest
// stays ON: with the CPU depth mesh live, real-world depth would cull every tile
// lying on the real floor, so main.js turns the occluder off while the overlay
// is on rather than drawing tiles that lie about where they are.
export class ChaseOverlay {
  constructor({
    scene,
    cellSize = CHASE_CELL_SIZE_M,
    thickness = CHASE_OVERLAY_TILE_THICKNESS_M,
    maxInstances = CHASE_OVERLAY_MAX_INSTANCES,
    radiusM = CHASE_OVERLAY_RADIUS_M,
  }) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.maxInstances = maxInstances;
    this.radiusM = radiusM;

    this.mesh = new THREE.InstancedMesh(
      // A slab rather than a plane: seen edge-on a zero-height quad vanishes,
      // and "is the tile under its feet" is judged from eye level.
      new THREE.BoxGeometry(cellSize * 0.92, thickness, cellSize * 0.92),
      // vertexColors deliberately absent — see the note in voxel-overlay.js.
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.45,
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
    // Above the character (2) and the depth meshes (-2, -1): the overlay is a
    // diagnostic layer, not part of the scene it describes.
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.scene.add(this.mesh);

    this._matrix = new THREE.Matrix4();
    this._color = new THREE.Color();
    this.revision = -1;
    this.lastCameraPosition = null;
  }

  // tiles: TraversalGrid.toOverlay() entries, in map space.
  // toRender: map space -> render space, the same function the character uses.
  setTiles(tiles, revision, { cameraPosition = null, toRender = null } = {}) {
    if (!this.mesh.visible) return 0;

    const moved = cameraPosition && this.lastCameraPosition
      ? Math.hypot(
        cameraPosition[0] - this.lastCameraPosition[0],
        cameraPosition[1] - this.lastCameraPosition[1],
        cameraPosition[2] - this.lastCameraPosition[2],
      )
      : Infinity;
    if (revision === this.revision && moved < CHASE_OVERLAY_REBUILD_STEP_M) return this.mesh.count;

    this.revision = revision;
    if (cameraPosition) {
      this.lastCameraPosition = [cameraPosition[0], cameraPosition[1], cameraPosition[2]];
    }

    // Nearest first, so the instance cap drops the far tiles rather than an
    // arbitrary slice of the ones being looked at.
    const nearby = [];
    for (const tile of tiles) {
      const position = toRender ? toRender(tile.position) : tile.position;
      if (cameraPosition) {
        const distance = Math.hypot(
          position[0] - cameraPosition[0],
          position[1] - cameraPosition[1],
          position[2] - cameraPosition[2],
        );
        if (distance > this.radiusM) continue;
        nearby.push({ tile, position, distance });
      } else {
        nearby.push({ tile, position, distance: 0 });
      }
    }
    nearby.sort((a, b) => a.distance - b.distance);

    const count = Math.min(nearby.length, this.maxInstances);
    for (let i = 0; i < count; i += 1) {
      const { tile, position } = nearby[i];
      this._matrix.makeTranslation(position[0], position[1], position[2]);
      this.mesh.setMatrixAt(i, this._matrix);
      // Green: standable. Red: seen but nowhere to stand. Amber: standable but
      // unreachable from where Hachuping is, which looks like a bug from the
      // outside ("why does it never go there") and is not one.
      if (!tile.walkable) this._color.setRGB(0.95, 0.25, 0.25);
      else if (tile.reachable === false) this._color.setRGB(0.98, 0.72, 0.2);
      else this._color.setRGB(0.3, 0.9, 0.45);
      this.mesh.setColorAt(i, this._color);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return count;
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    if (visible) this.revision = -1; // force a rebuild on the next setTiles
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
