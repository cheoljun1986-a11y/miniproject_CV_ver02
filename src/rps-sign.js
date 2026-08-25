import * as THREE from 'three';

import { drawMove } from './rps-art.js';

const SIGN_NAME = 'rpsMoveSign';

function defaultCanvasFactory() {
  return document.createElement('canvas');
}

export function clearNinjaMove(root) {
  const sign = root?.children?.find((child) => child.name === SIGN_NAME);
  if (!sign) return false;
  root.remove(sign);
  sign.material?.map?.dispose?.();
  sign.material?.dispose?.();
  return true;
}

export function showNinjaMove(
  root,
  move,
  { canvasFactory = defaultCanvasFactory } = {},
) {
  clearNinjaMove(root);
  const canvas = canvasFactory();
  canvas.width = 256;
  canvas.height = 256;
  drawMove(canvas.getContext('2d'), move);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sign = new THREE.Sprite(material);
  sign.name = SIGN_NAME;
  sign.position.set(0, 0.72, 0);
  sign.scale.set(0.42, 0.42, 1);
  sign.renderOrder = 4;
  root.add(sign);
  return sign;
}
