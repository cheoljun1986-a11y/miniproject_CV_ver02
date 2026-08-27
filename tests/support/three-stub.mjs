const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export const DynamicDrawUsage = 'dynamic';
export const DoubleSide = 'double';
export const FrontSide = 'front';
export const BackSide = 'back';

export class Matrix4 {
  constructor() { this.elements = IDENTITY.slice(); }
  fromArray(values) { this.elements = Array.from(values); return this; }
  invert() { return this; }
  makeTranslation(x, y, z) {
    this.elements = IDENTITY.slice();
    this.elements[12] = x;
    this.elements[13] = y;
    this.elements[14] = z;
    return this;
  }
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
  dispose() { this.disposed = true; }
}

export class MeshBasicMaterial {
  constructor(options) { Object.assign(this, options); }
  dispose() { this.disposed = true; }
}

export class PointsMaterial {
  constructor(options) { Object.assign(this, options); }
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    super();
    this.parameters = { width, height, depth };
  }
}

export class InstancedBufferAttribute extends BufferAttribute {}

export class Color {
  constructor() { this.r = 0; this.g = 0; this.b = 0; }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
}

export class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.visible = true;
    this.renderOrder = 0;
    this.frustumCulled = true;
  }
}

export class Points extends Mesh {}

// Enough of InstancedMesh for the overlays: they only ever set per-instance
// matrices and colours and move `count`.
export class InstancedMesh extends Mesh {
  constructor(geometry, material, maxInstances) {
    super(geometry, material);
    this.maxInstances = maxInstances;
    this.count = 0;
    this.instanceMatrix = new BufferAttribute(new Float32Array(maxInstances * 16), 16);
    this.instanceColor = null;
    this.matrices = [];
    this.colors = [];
  }
  setMatrixAt(index, matrix) { this.matrices[index] = matrix.elements.slice(); }
  setColorAt(index, color) { this.colors[index] = [color.r, color.g, color.b]; }
  // Where the instance was placed, as [x, y, z].
  positionAt(index) {
    const m = this.matrices[index];
    return m ? [m[12], m[13], m[14]] : null;
  }
}

export const MathUtils = {
  clamp(value, min, max) { return Math.min(max, Math.max(min, value)); },
};
