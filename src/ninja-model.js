import * as THREE from 'three';

import { createInstanceFrom } from './hidden-model.js';

// Normalized model loaded from HIDDEN_MODEL_URL, or null while it is still
// loading or when loading failed. createNinja falls back to the built-in ninja
// so the game stays playable either way.
let hiddenTemplate = null;

export function setHiddenTemplate(template) {
  hiddenTemplate = template;
}

export function makeReticle() {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.visible = false;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.085, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  group.add(ring);
  return group;
}

export function createNinja(opacity = 0.13) {
  if (hiddenTemplate) return createInstanceFrom(hiddenTemplate, opacity);

  const group = new THREE.Group();
  const material = (color) => new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    transparent: true,
    opacity,
    depthWrite: opacity > 0.5,
  });
  const orange = material(0xff7a00);
  const black = material(0x171717);
  const skin = material(0xffc48a);
  const white = material(0xffffff);
  const eye = material(0x111111);
  const hair = material(0xf0c832);

  for (const x of [-0.045, 0.045]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.085), black);
    foot.position.set(x, 0.015, 0.015);
    group.add(foot);
  }

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.12, 5, 10), orange);
  body.position.y = 0.15;
  group.add(body);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.025, 20), black);
  belt.position.y = 0.12;
  group.add(belt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 18), skin);
  head.position.y = 0.33;
  group.add(head);

  const band = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.04, 0.025), black);
  band.position.set(0, 0.365, 0.084);
  group.add(band);

  for (const x of [-0.032, 0.032]) {
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), white);
    sclera.scale.set(1.4, 0.65, 0.35);
    sclera.position.set(x, 0.333, 0.088);
    group.add(sclera);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), eye);
    pupil.position.set(x, 0.333, 0.098);
    group.add(pupil);
  }

  const spikeGeometry = new THREE.ConeGeometry(0.026, 0.09, 8);
  [-1, -0.55, 0, 0.55, 1].forEach((angle) => {
    const spike = new THREE.Mesh(spikeGeometry, hair);
    spike.position.set(Math.sin(angle) * 0.075, 0.43 + Math.cos(angle) * 0.018, -0.005);
    spike.rotation.z = -angle * 0.5;
    group.add(spike);
  });

  group.userData.camouflageOpacity = opacity;
  return group;
}

// Debug marker for a stored scan point. Green = horizontal surface (a spot the
// ninja can be hidden on), orange = any other surface kept only in the full
// pool. Drawn as an always-visible overlay (depthTest off) so the whole set of
// collected points stays readable while scanning.
export function createSurfaceMarker(position, horizontal) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 10, 8),
    new THREE.MeshBasicMaterial({
      color: horizontal ? 0x33dd88 : 0xff7755,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    }),
  );
  marker.position.set(position[0], position[1], position[2]);
  marker.renderOrder = 2;
  marker.frustumCulled = false;
  return marker;
}

export function setNinjaOpacity(root, opacity) {
  root.traverse((child) => {
    if (child.material?.transparent) {
      child.material.opacity = opacity;
      child.material.depthWrite = opacity > 0.5;
      child.material.needsUpdate = true;
    }
  });
}
export function revealNinja(root) {
  setNinjaOpacity(root, 1);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.014, 10, 48).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  halo.position.y = 0.2;
  halo.name = 'foundHalo';
  root.add(halo);
}

export function disposeObject(root) {
  root.traverse((child) => {
    child.geometry?.dispose?.();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose?.());
    }
  });
}
