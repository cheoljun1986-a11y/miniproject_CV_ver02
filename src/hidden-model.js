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

// Decode one sRGB channel to linear light, the space three.js shades in.
export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

// Decode a whole vertex color attribute. Scanners commonly write display-ready
// sRGB bytes into COLOR_0, while glTF declares that attribute to be linear, so
// three.js renders the model washed out until the values are decoded once.
// Alpha carries no color and is copied through.
//
// maxValue scales the incoming components to 0..1 (255 for byte attributes).
export function srgbAttributeToLinear(components, itemSize, maxValue) {
  const linear = new Float32Array(components.length);
  for (let offset = 0; offset < components.length; offset += itemSize) {
    for (let channel = 0; channel < itemSize; channel += 1) {
      const value = components[offset + channel] / maxValue;
      linear[offset + channel] = channel < 3 ? srgbToLinear(value) : value;
    }
  }
  return linear;
}
