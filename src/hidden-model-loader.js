import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { applyFit, fitToHeight } from './hidden-model.js';

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
  const bounds = new THREE.Box3().setFromObject(model);

  applyFit(model, fitToHeight(bounds.min.toArray(), bounds.max.toArray(), targetHeight));

  const template = new THREE.Group();
  template.add(model);
  return template;
}
