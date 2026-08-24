import { voxelKey } from './depth-math.js';

// Observation-counted voxel occupancy. A voxel is reported "solid" only once it
// has been seen solidMinHits times, which filters out stray one-off depth
// noise. Framework-free so it can be unit-tested directly.
export class VoxelMap {
  constructor({ voxelSize = 0.05, solidMinHits = 3, maxSolid = 20000 } = {}) {
    this.voxelSize = voxelSize;
    this.solidMinHits = solidMinHits;
    this.maxSolid = maxSolid;
    this.counts = new Map();
    this.solid = new Map();
  }

  observe([x, y, z]) {
    const key = voxelKey(x, y, z, this.voxelSize);
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    if (next !== this.solidMinHits) return false;
    if (this.solid.size >= this.maxSolid) return false;

    const size = this.voxelSize;
    // round to kill float error so cell centers are exact (e.g. 0.35, not 0.35000000000000003)
    const center = [
      Math.round((Math.floor(x / size) + 0.5) * size * 1e10) / 1e10,
      Math.round((Math.floor(y / size) + 0.5) * size * 1e10) / 1e10,
      Math.round((Math.floor(z / size) + 0.5) * size * 1e10) / 1e10,
    ];
    const colorT = Math.min(1, Math.max(0, (center[1] + 1) / 3));
    this.solid.set(key, { position: center, colorT });
    return true;
  }

  getSolidVoxels() {
    return Array.from(this.solid.values());
  }

  getSolidCount() {
    return this.solid.size;
  }

  reset() {
    this.counts.clear();
    this.solid.clear();
  }
}
