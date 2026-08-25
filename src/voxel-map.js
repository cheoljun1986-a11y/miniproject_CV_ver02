import { voxelKey } from './depth-math.js';

// Observation-counted voxel occupancy. A voxel is reported "solid" only once it
// has been seen solidMinHits times, which filters out stray one-off depth
// noise. Framework-free so it can be unit-tested directly.
export class VoxelMap {
  constructor({
    voxelSize = 0.05,
    solidMinHits = 3,
    maxSolid = 20000,
    maxPending = maxSolid * 2,
  } = {}) {
    this.voxelSize = voxelSize;
    this.solidMinHits = solidMinHits;
    this.maxSolid = maxSolid;
    this.maxPending = maxPending;
    this.counts = new Map();
    this.solid = new Map();
    this.revision = 0;
  }

  observe([x, y, z]) {
    const key = voxelKey(x, y, z, this.voxelSize);
    if (this.solid.has(key)) return false;
    if (this.solid.size >= this.maxSolid) {
      this.counts.clear();
      return false;
    }

    const next = (this.counts.get(key) ?? 0) + 1;
    if (next < this.solidMinHits) {
      if (!this.counts.has(key) && this.counts.size >= this.maxPending) {
        const oldestKey = this.counts.keys().next().value;
        if (oldestKey !== undefined) this.counts.delete(oldestKey);
      }
      if (this.maxPending > 0) this.counts.set(key, next);
      return false;
    }
    this.counts.delete(key);

    const size = this.voxelSize;
    // round to kill float error so cell centers are exact (e.g. 0.35, not 0.35000000000000003)
    const center = [
      Math.round((Math.floor(x / size) + 0.5) * size * 1e10) / 1e10,
      Math.round((Math.floor(y / size) + 0.5) * size * 1e10) / 1e10,
      Math.round((Math.floor(z / size) + 0.5) * size * 1e10) / 1e10,
    ];
    const colorT = Math.min(1, Math.max(0, (center[1] + 1) / 3));
    this.solid.set(key, { position: center, colorT });
    this.revision += 1;
    if (this.solid.size >= this.maxSolid) this.counts.clear();
    return true;
  }

  getSolidVoxels() {
    return Array.from(this.solid.values());
  }

  getSolidCount() {
    return this.solid.size;
  }

  getPendingCount() {
    return this.counts.size;
  }

  getRevision() {
    return this.revision;
  }

  reset() {
    if (this.counts.size || this.solid.size) this.revision += 1;
    this.counts.clear();
    this.solid.clear();
  }
}
