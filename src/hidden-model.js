// Pure fitting math for the loaded hiding model. No three.js dependency so it
// can be unit-tested directly.
//
// A scanned GLB arrives at its own scale and centered on its own origin, while
// the game expects a model that stands on the surface point it is placed at.
// fitToHeight turns a bounding box into the uniform scale and the translation
// that put the model at a known height, resting on y = 0 and centered on the
// vertical axis.
//
// Apply as: worldPoint = localPoint * scale + offset.
export function fitToHeight(min, max, targetHeight) {
  const height = max[1] - min[1];
  const scale = height > 0 ? targetHeight / height : 1;

  return {
    scale,
    offset: [
      0 - ((min[0] + max[0]) / 2) * scale,
      0 - min[1] * scale,
      0 - ((min[2] + max[2]) / 2) * scale,
    ],
  };
}

// Put a fit computed by fitToHeight onto a loaded object.
export function applyFit(object, { scale, offset }) {
  object.scale.setScalar(scale);
  object.position.set(offset[0], offset[1], offset[2]);
}

// Copy the loaded template into a scene-ready object. Materials are cloned per
// instance: the template's materials are shared across every mesh three.js
// created from the same glTF primitive, so fading one hidden model would
// otherwise fade every copy of it.
export function createInstanceFrom(template, opacity) {
  const instance = template.clone(true);
  instance.traverse((child) => {
    if (!child.material) return;
    child.material = child.material.clone();
    child.material.transparent = true;
    child.material.opacity = opacity;
    child.material.depthWrite = opacity > 0.5;
  });
  return instance;
}
