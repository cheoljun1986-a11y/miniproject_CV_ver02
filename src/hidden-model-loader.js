import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  applyFit, applyForwardYaw, fitToHeight, srgbAttributeToLinear,
} from './hidden-model.js';

// A scanned mesh carries no glTF material, so GLTFLoader builds the spec's
// default: fully metallic. Metal has no diffuse color, and with no environment
// map to reflect the model renders nearly black however bright its vertex
// colors are. Photogrammetry also bakes its lighting into those colors, so the
// faithful way to show them is unlit — the scan's own shading, not ours.
function useScannedColors(model) {
  model.traverse((child) => {
    const colors = child.geometry?.getAttribute?.('color');
    if (!child.isMesh) return;

    if (colors) {
      child.geometry.setAttribute('color', new THREE.BufferAttribute(
        srgbAttributeToLinear(
          colors.array,
          colors.itemSize,
          colors.array instanceof Float32Array ? 1 : 255,
        ),
        colors.itemSize,
      ));
    }

    child.material = new THREE.MeshBasicMaterial({ vertexColors: Boolean(colors) });
  });
}

// Load the glTF model the game hides, normalized to game scale.
//
// A scanned GLB carries its own capture scale and sits centered on its own
// origin, while NinjaGame places the hidden object by writing position and
// quaternion straight onto the object it gets. The fit is therefore applied to
// an inner node and returned wrapped in a group: the game moves the wrapper,
// and the normalization underneath survives untouched.
export async function loadHiddenModel(url, targetHeight) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  useScannedColors(model);
  const bounds = new THREE.Box3().setFromObject(model);

  applyFit(model, fitToHeight(bounds.min.toArray(), bounds.max.toArray(), targetHeight));
  // The scan's own front is not +Z; the chase assumes it is. See hidden-model.js.
  applyForwardYaw(model);

  const template = new THREE.Group();
  template.add(model);
  return template;
}
