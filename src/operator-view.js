// src/operator-view.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { TRAIL_MAX_POINTS, VOXEL_MAX_SOLID, VOXEL_SIZE_M } from './config.js';

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

  render({ solidVoxels, voxelRevision, ninjaPos, playerPos, playerPath }) {
    this.resize();

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
