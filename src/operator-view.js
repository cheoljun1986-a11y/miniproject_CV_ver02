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

// A second, non-XR 3D scene rendered onto an overlay canvas: a god's-eye view
// of the reconstructed voxel space, the hidden Ninja, and the player's path.
// Independent WebGL context; renders only while the overlay is visible.
export class OperatorView {
  constructor({ canvas }) {
    this.canvas = canvas;
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

    this.voxels = new THREE.InstancedMesh(
      new THREE.BoxGeometry(VOXEL_SIZE_M, VOXEL_SIZE_M, VOXEL_SIZE_M),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      VOXEL_MAX_SOLID,
    );
    this.voxels.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(VOXEL_MAX_SOLID * 3),
      3,
    );
    this.voxels.count = 0;
    this.scene.add(this.voxels);

    // Flat tiles showing where Hachuping is allowed to go. Green = reachable,
    // amber = standable but cut off, red = observed with nowhere to stand.
    // Anything never observed simply has no tile.
    this.tiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.02, 1),
      new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }),
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

    this._matrix = new THREE.Matrix4();
    this._color = new THREE.Color();
    this.voxelRevision = -1;
  }

  resize() {
    const width = this.canvas.clientWidth || innerWidth;
    const height = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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

    if (voxelRevision !== this.voxelRevision) {
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

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
