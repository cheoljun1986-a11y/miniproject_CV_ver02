// Voxel accumulation for the debug scan. Pure: no three.js, no DOM, no WebXR.
//
// Differs from voxel-map.js in the three ways that make diagnosis possible:
//   1. observe() takes a frameId, so one keyframe contributes at most one
//      observation per cell. Without this a single depth frame lands 4-9
//      samples in one 5cm cell and promotes it on its own.
//   2. observationCount survives, so cells can be coloured and filtered by it
//      after the fact instead of being thrown away at a fixed threshold.
//   3. The stored position is the running mean of the real points, not the
//      grid center, so a cell shows where the surface actually is.
//
// PRECONDITION: keyframes must be drained strictly in order — one keyframe
// fully consumed before the next begins. That is what makes a single
// lastFrameId equivalent to the spec's per-cell Set<frameId>, at a fraction of
// the memory (a Set per cell over 200k cells costs ~20MB for data never read
// back). rebuildVoxelGrid() in keyframe-store.js guarantees this ordering.

export class VoxelGrid {
  constructor({ voxelSize = 0.05, origin = [0, 0, 0], maxCells = 200000 } = {}) {
    this.voxelSize = voxelSize;
    this.origin = [origin[0], origin[1], origin[2]];
    this.maxCells = maxCells;
    this.cells = new Map();
    this.revision = 0;
  }

  observe(x, y, z, frameId) {
    const size = this.voxelSize;
    const ix = Math.floor((x - this.origin[0]) / size);
    const iy = Math.floor((y - this.origin[1]) / size);
    const iz = Math.floor((z - this.origin[2]) / size);
    const key = `${ix},${iy},${iz}`;

    let cell = this.cells.get(key);
    if (!cell) {
      // A full grid must keep counting cells it already has, otherwise the
      // histogram under-reports and looks like a multi-view failure.
      if (this.cells.size >= this.maxCells) return 'full';
      cell = {
        key,
        ix,
        iy,
        iz,
        observationCount: 0,
        lastFrameId: null,
        sampleCount: 0,
        sumX: 0,
        sumY: 0,
        sumZ: 0,
        clusterId: null,
      };
      this.cells.set(key, cell);
      this.revision += 1;
    }

    cell.sampleCount += 1;
    cell.sumX += x;
    cell.sumY += y;
    cell.sumZ += z;

    const isNew = cell.observationCount === 0;
    if (cell.lastFrameId !== frameId) {
      cell.lastFrameId = frameId;
      cell.observationCount += 1;
      return isNew ? 'new' : 'observed';
    }
    return 'accumulated';
  }

  getCell(ix, iy, iz) {
    return this.cells.get(`${ix},${iy},${iz}`) ?? null;
  }

  getCells() {
    return Array.from(this.cells.values());
  }

  getCellCount() {
    return this.cells.size;
  }

  getHistogram() {
    const histogram = { one: 0, two: 0, three: 0, fourPlus: 0, total: 0 };
    for (const cell of this.cells.values()) {
      histogram.total += 1;
      if (cell.observationCount <= 1) histogram.one += 1;
      else if (cell.observationCount === 2) histogram.two += 1;
      else if (cell.observationCount === 3) histogram.three += 1;
      else histogram.fourPlus += 1;
    }
    return histogram;
  }

  isFull() {
    return this.cells.size >= this.maxCells;
  }

  getRevision() {
    return this.revision;
  }

  reset() {
    this.cells.clear();
    this.revision += 1;
  }
}

// Where the surface actually is, averaged over every contributing depth pixel.
export function cellMeanPosition(cell) {
  const n = cell.sampleCount || 1;
  return [cell.sumX / n, cell.sumY / n, cell.sumZ / n];
}

export function cellCenterPosition(cell, voxelSize, origin = [0, 0, 0]) {
  return [
    origin[0] + (cell.ix + 0.5) * voxelSize,
    origin[1] + (cell.iy + 0.5) * voxelSize,
    origin[2] + (cell.iz + 0.5) * voxelSize,
  ];
}

// Render-time filter for the observation-threshold slider. Deliberately not a
// rebuild: dragging the slider must be instant.
export function selectCells(cells, { minObservations = 1 } = {}) {
  if (minObservations <= 1) return cells;
  return cells.filter((cell) => cell.observationCount >= minObservations);
}

export function histogramDisplayCount(histogram, minObservations) {
  if (minObservations <= 1) return histogram.total;
  if (minObservations === 2) return histogram.two + histogram.three + histogram.fourPlus;
  if (minObservations === 3) return histogram.three + histogram.fourPlus;
  return histogram.fourPlus;
}
