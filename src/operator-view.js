// src/operator-view.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  CHASE_GRID_MAX_TILES,
  CHASE_PATH_MAX_POINTS,
  TRAIL_MAX_POINTS,
  VOXEL_MAX_SOLID,
  VOXEL_SIZE_M,
} from './config.js';
import { cellMeanPosition } from './voxel-grid.js';
import { voxelColorRGB } from './voxel-color-modes.js';
import { framePoints } from './operator-framing.js';

const CAMERA_FOV_DEG = 60;

// Direction the auto-framed camera sits in relative to the map's center: above
// and to one side, so floors and walls both read.
const CAMERA_DIRECTION = [0.45, 0.7, 0.55];

const MAX_FRUSTUMS = 32;
const FRUSTUM_DEPTH_M = 0.25;
const FRUSTUM_SPREAD = 0.18;
// Apex plus the four corners of a small near rect, in view space (-Z forward).
const FRUSTUM_CORNERS = [
  [0, 0, 0],
  [-FRUSTUM_SPREAD, -FRUSTUM_SPREAD * 0.75, -FRUSTUM_DEPTH_M],
  [FRUSTUM_SPREAD, -FRUSTUM_SPREAD * 0.75, -FRUSTUM_DEPTH_M],
  [FRUSTUM_SPREAD, FRUSTUM_SPREAD * 0.75, -FRUSTUM_DEPTH_M],
  [-FRUSTUM_SPREAD, FRUSTUM_SPREAD * 0.75, -FRUSTUM_DEPTH_M],
];
const FRUSTUM_EDGES = [
  [FRUSTUM_CORNERS[0], FRUSTUM_CORNERS[1]],
  [FRUSTUM_CORNERS[0], FRUSTUM_CORNERS[2]],
  [FRUSTUM_CORNERS[0], FRUSTUM_CORNERS[3]],
  [FRUSTUM_CORNERS[0], FRUSTUM_CORNERS[4]],
  [FRUSTUM_CORNERS[1], FRUSTUM_CORNERS[2]],
  [FRUSTUM_CORNERS[2], FRUSTUM_CORNERS[3]],
  [FRUSTUM_CORNERS[3], FRUSTUM_CORNERS[4]],
  [FRUSTUM_CORNERS[4], FRUSTUM_CORNERS[1]],
];
const FRUSTUM_VERTS = FRUSTUM_EDGES.length * 2;

// A second, non-XR 3D scene rendered onto an overlay canvas: a god's-eye view
// of the reconstructed voxel space, the hidden Ninja, and the player's path.
// Independent WebGL context; renders only while the overlay is visible.
export class OperatorView {
  constructor({ canvas, voxelSize = VOXEL_SIZE_M, maxVoxels = VOXEL_MAX_SOLID }) {
    this.canvas = canvas;
    this.voxelSize = voxelSize;
    this.maxVoxels = maxVoxels;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0b0b);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 2.0));
    this.scene.add(new THREE.GridHelper(10, 20, 0x334455, 0x223344));
    this.scene.add(new THREE.AxesHelper(0.5));

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
    this.camera.position.set(2, 3, 4);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    // Auto-framing follows the map until the operator takes over the camera.
    this.autoFrame = true;
    this.framedRevision = -1;
    this.controls.addEventListener('start', () => { this.autoFrame = false; });

    this.voxels = new THREE.InstancedMesh(
      new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize),
      // No vertexColors here. It defines USE_COLOR, whose shader chunk runs
      // `vColor *= color` against the geometry's color attribute — and a
      // BoxGeometry has none, so the undefined attribute reads as (0,0,0) and
      // zeroes the color before instanceColor is ever multiplied in. Leaving it
      // off keeps USE_INSTANCING_COLOR alone, which is what setColorAt feeds.
      new THREE.MeshLambertMaterial(),
      maxVoxels,
    );
    this.voxels.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxVoxels * 3),
      3,
    );
    this.voxels.count = 0;
    this.scene.add(this.voxels);

    // Flat tiles showing where Hachuping is allowed to go. Green = reachable,
    // amber = standable but cut off, red = observed with nowhere to stand.
    // Anything never observed simply has no tile.
    this.tiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.02, 1),
      // No vertexColors — same trap as the voxel mesh above. It defines
      // USE_COLOR, whose shader chunk runs `vColor *= color` against a colour
      // attribute this BoxGeometry does not have, so the tiles drew black and
      // the green/amber/red walkability coding was invisible on device.
      new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55 }),
      CHASE_GRID_MAX_TILES,
    );
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(CHASE_GRID_MAX_TILES * 3),
      3,
    );
    this.tiles.count = 0;
    this.tiles.visible = false;
    this.scene.add(this.tiles);
    this.tileRevision = -1;

    this.chasePathGeometry = new THREE.BufferGeometry();
    this.chasePathGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(CHASE_PATH_MAX_POINTS * 3), 3),
    );
    this.chasePathGeometry.setDrawRange(0, 0);
    this.chasePath = new THREE.Line(
      this.chasePathGeometry,
      new THREE.LineBasicMaterial({ color: 0xffc44d }),
    );
    this.chasePath.frustumCulled = false;
    this.chasePath.visible = false;
    this.scene.add(this.chasePath);

    this.hachuping = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5fd2 }),
    );
    this.hachuping.visible = false;
    this.scene.add(this.hachuping);

    this.ninja = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3355 }),
    );
    this.ninja.visible = false;
    this.scene.add(this.ninja);

    this.player = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.14, 12),
      new THREE.MeshBasicMaterial({ color: 0x33ddff }),
    );
    this.player.visible = false;
    this.scene.add(this.player);

    this.pathGeometry = new THREE.BufferGeometry();
    this.pathGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3),
    );
    this.pathGeometry.setDrawRange(0, 0);
    this.path = new THREE.Line(
      this.pathGeometry,
      new THREE.LineBasicMaterial({ color: 0x33ddff }),
    );
    this.path.frustumCulled = false;
    this.scene.add(this.path);

    // Keyframe camera frustums: one preallocated LineSegments, 8 segments each,
    // so pose accumulation is legible as a shape rather than a number.
    this.frustumGeometry = new THREE.BufferGeometry();
    this.frustumGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_FRUSTUMS * FRUSTUM_VERTS * 3), 3),
    );
    this.frustumGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(MAX_FRUSTUMS * FRUSTUM_VERTS * 3), 3),
    );
    this.frustumGeometry.setDrawRange(0, 0);
    this.frustums = new THREE.LineSegments(
      this.frustumGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true }),
    );
    this.frustums.frustumCulled = false;
    this.frustums.visible = false;
    this.scene.add(this.frustums);

    this._matrix = new THREE.Matrix4();
    this._color = new THREE.Color();
    this._vec = new THREE.Vector3();
    this._frustumMatrix = new THREE.Matrix4();
    this.voxelRevision = -1;
    this.cellRevision = -1;
    this.drawnVoxelCount = 0;
  }

  // Swaps the instanced box size when the voxel-size slider moves. instanceMatrix
  // and instanceColor survive a geometry swap; the old geometry must be disposed
  // or a single slider drag leaks a GPU buffer per step.
  setVoxelSize(size) {
    if (size === this.voxelSize) return;
    this.voxelSize = size;
    const previous = this.voxels.geometry;
    this.voxels.geometry = new THREE.BoxGeometry(size, size, size);
    previous.dispose();
    this.cellRevision = -1;
  }

  // Debug path: VoxelCell records rather than the legacy {position, colorT}.
  // Returns how many were actually drawn so truncation is never invisible.
  setVoxelCells(cells, revision, colorMode, { minY = -1, spanY = 3 } = {}) {
    if (revision === this.cellRevision) return this.drawnVoxelCount;
    this.cellRevision = revision;
    this.voxelRevision = -1; // legacy path must rebuild if it ever runs again

    const count = Math.min(cells.length, this.maxVoxels);
    for (let i = 0; i < count; i += 1) {
      const cell = cells[i];
      const [x, y, z] = cellMeanPosition(cell);
      this._matrix.makeTranslation(x, y, z);
      this.voxels.setMatrixAt(i, this._matrix);
      const [r, g, b] = voxelColorRGB(cell, colorMode, { y, minY, spanY });
      this._color.setRGB(r, g, b);
      this.voxels.setColorAt(i, this._color);
    }
    this.voxels.count = count;
    this.voxels.instanceMatrix.needsUpdate = true;
    if (this.voxels.instanceColor) this.voxels.instanceColor.needsUpdate = true;
    this.drawnVoxelCount = count;
    return count;
  }

  setKeyframePoses(poses) {
    const count = Math.min(poses.length, MAX_FRUSTUMS);
    const positions = this.frustumGeometry.attributes.position.array;
    const colors = this.frustumGeometry.attributes.color.array;
    let offset = 0;

    for (let i = 0; i < count; i += 1) {
      this._frustumMatrix.fromArray(poses[i].viewMatrix);
      // Index ramp: the first keyframe is dark, the last is bright, so the
      // capture order reads directly off the picture.
      const t = count > 1 ? i / (count - 1) : 1;
      const r = 0.25 + 0.75 * t;
      const g = 0.5 + 0.4 * t;
      const b = 0.35 + 0.2 * (1 - t);

      for (const [from, to] of FRUSTUM_EDGES) {
        for (const corner of [from, to]) {
          this._vec.set(corner[0], corner[1], corner[2]).applyMatrix4(this._frustumMatrix);
          positions[offset] = this._vec.x;
          positions[offset + 1] = this._vec.y;
          positions[offset + 2] = this._vec.z;
          colors[offset] = r;
          colors[offset + 1] = g;
          colors[offset + 2] = b;
          offset += 3;
        }
      }
    }

    this.frustumGeometry.setDrawRange(0, count * FRUSTUM_VERTS);
    this.frustumGeometry.attributes.position.needsUpdate = true;
    this.frustumGeometry.attributes.color.needsUpdate = true;
  }

  setKeyframePosesVisible(visible) {
    this.frustums.visible = visible;
  }

  resize() {
    const width = this.canvas.clientWidth || innerWidth;
    const height = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // Keep the reconstruction in view as it grows. The map is anchored to wherever
  // the session started, so it can end up far from the camera's initial spot.
  // Reframes only when the map actually changed, and stops for good once the
  // operator drags the camera themselves.
  applyAutoFrame(solidVoxels, voxelRevision) {
    if (!this.autoFrame || voxelRevision === this.framedRevision) return;

    const framing = framePoints(
      solidVoxels.map(({ position }) => position),
      CAMERA_FOV_DEG,
    );
    if (!framing) return;
    this.framedRevision = voxelRevision;

    const [tx, ty, tz] = framing.target;
    const length = Math.hypot(...CAMERA_DIRECTION);
    this.controls.target.set(tx, ty, tz);
    this.camera.position.set(
      tx + (CAMERA_DIRECTION[0] / length) * framing.distance,
      ty + (CAMERA_DIRECTION[1] / length) * framing.distance,
      tz + (CAMERA_DIRECTION[2] / length) * framing.distance,
    );
  }

  render({
    solidVoxels, voxelRevision, ninjaPos, playerPos, playerPath,
    gridTiles = null, gridRevision = -1, cellSize = 0.2,
    chasePath = null, hachupingPos = null,
  }) {
    this.resize();

    // Walkability tiles. Rebuilt only when the grid actually changed — the
    // full rebuild is cheap but doing it every frame is not.
    if (gridTiles && gridRevision !== this.tileRevision) {
      const count = Math.min(gridTiles.length, CHASE_GRID_MAX_TILES);
      for (let i = 0; i < count; i += 1) {
        const tile = gridTiles[i];
        this._matrix.makeScale(cellSize * 0.9, 1, cellSize * 0.9);
        this._matrix.setPosition(tile.position[0], tile.position[1], tile.position[2]);
        this.tiles.setMatrixAt(i, this._matrix);
        if (!tile.walkable) this._color.setRGB(0.85, 0.22, 0.22);
        else if (tile.reachable === false) this._color.setRGB(0.95, 0.72, 0.20);
        else this._color.setRGB(0.20, 0.82, 0.45);
        this.tiles.setColorAt(i, this._color);
      }
      this.tiles.count = count;
      this.tiles.visible = count > 0;
      this.tiles.instanceMatrix.needsUpdate = true;
      if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
      this.tileRevision = gridRevision;
    } else if (!gridTiles) {
      this.tiles.visible = false;
    }

    if (chasePath && chasePath.length > 1) {
      const positions = this.chasePathGeometry.attributes.position.array;
      const count = Math.min(chasePath.length, CHASE_PATH_MAX_POINTS);
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = chasePath[i][0];
        positions[i * 3 + 1] = chasePath[i][1] + 0.03;
        positions[i * 3 + 2] = chasePath[i][2];
      }
      this.chasePathGeometry.setDrawRange(0, count);
      this.chasePathGeometry.attributes.position.needsUpdate = true;
      this.chasePath.visible = true;
    } else {
      this.chasePath.visible = false;
    }

    if (hachupingPos) {
      this.hachuping.visible = true;
      this.hachuping.position.set(hachupingPos[0], hachupingPos[1], hachupingPos[2]);
    } else {
      this.hachuping.visible = false;
    }

    // solidVoxels is null in ?voxel=debug, where setVoxelCells() owns the
    // instanced mesh instead of this legacy path.
    if (solidVoxels && voxelRevision !== this.voxelRevision) {
      const count = Math.min(solidVoxels.length, VOXEL_MAX_SOLID);
      for (let i = 0; i < count; i += 1) {
        const { position, colorT } = solidVoxels[i];
        this._matrix.makeTranslation(position[0], position[1], position[2]);
        this.voxels.setMatrixAt(i, this._matrix);
        this._color.setRGB(0.2 + 0.8 * colorT, 0.5, 1 - 0.8 * colorT);
        this.voxels.setColorAt(i, this._color);
      }
      this.voxels.count = count;
      this.voxels.instanceMatrix.needsUpdate = true;
      if (this.voxels.instanceColor) this.voxels.instanceColor.needsUpdate = true;
      this.voxelRevision = voxelRevision;
    }

    if (ninjaPos) {
      this.ninja.visible = true;
      this.ninja.position.set(ninjaPos[0], ninjaPos[1], ninjaPos[2]);
    } else {
      this.ninja.visible = false;
    }

    if (playerPos) {
      this.player.visible = true;
      this.player.position.set(playerPos[0], playerPos[1], playerPos[2]);
    } else {
      this.player.visible = false;
    }

    const positions = this.pathGeometry.attributes.position.array;
    const pathCount = Math.min(playerPath.length, TRAIL_MAX_POINTS);
    for (let i = 0; i < pathCount; i += 1) {
      positions[i * 3] = playerPath[i][0];
      positions[i * 3 + 1] = playerPath[i][1];
      positions[i * 3 + 2] = playerPath[i][2];
    }
    this.pathGeometry.setDrawRange(0, pathCount);
    this.pathGeometry.attributes.position.needsUpdate = true;

    this.applyAutoFrame(solidVoxels, voxelRevision);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
