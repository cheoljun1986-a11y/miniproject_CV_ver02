const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export const DynamicDrawUsage = 'dynamic';
export const DoubleSide = 'double';

export class Matrix4 {
  constructor() { this.elements = IDENTITY.slice(); }
  fromArray(values) { this.elements = Array.from(values); return this; }
  invert() { return this; }
}

export class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.needsUpdate = false;
  }
  setUsage(usage) { this.usage = usage; return this; }
}

export class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.drawRange = { start: 0, count: 0 };
  }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  setIndex(attribute) { this.index = attribute; return this; }
  setDrawRange(start, count) { this.drawRange = { start, count }; }
  computeBoundingSphere() { this.boundingSphereComputed = true; }
}

export class MeshBasicMaterial {
  constructor(options) { Object.assign(this, options); }
}

export class PointsMaterial {
  constructor(options) { Object.assign(this, options); }
}

export class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.visible = true;
  }
}

export class Points extends Mesh {}

export class CanvasTexture {
  constructor(image) {
    this.image = image;
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}

export class SpriteMaterial extends MeshBasicMaterial {
  dispose() { this.disposed = true; }
}

function transformTarget() {
  return {
    values: null,
    set(...values) { this.values = values; },
  };
}

export class Sprite {
  constructor(material) {
    this.material = material;
    this.position = transformTarget();
    this.scale = transformTarget();
    this.name = '';
  }
}

export const SRGBColorSpace = 'srgb';

export const MathUtils = {
  clamp(value, min, max) { return Math.min(max, Math.max(min, value)); },
};
