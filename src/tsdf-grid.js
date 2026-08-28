// Sparse TSDF (truncated signed distance) fusion over keyframes. Pure: no
// three.js, no DOM, no WebXR, so it runs offline against a saved scan and in
// unit tests exactly as it runs on the phone.
//
// Why this replaces hit counting (VoxelGrid.observe) for the game terrain:
// counting only ever gathers positive evidence — a depth sample landed here —
// so a flying pixel that lands in the same cell from three viewpoints becomes
// a confirmed voxel in mid-air, and a floor the depth camera sampled sparsely
// stays full of holes. TSDF stores, per voxel, the signed distance to the
// nearest observed surface averaged over every frame that looked at it:
//
//   - along each depth ray the voxels in front of the hit get positive values
//     (free space) and the ones just behind get negative ones, truncated to
//     ±truncation so distant voxels are not claimed by a surface they never saw;
//   - a voxel a later ray passes THROUGH gets a full +1 (free) vote, which is
//     the negative evidence that erases floaters;
//   - the surface is where the averaged distance crosses zero, so sparse
//     samples of one plane fuse into a continuous band instead of a scatter.
//
// Solid = weight >= minWeight && |tsdf| < surfaceBand. Because a voxel can
// stop being solid when free-space evidence accumulates, the grid reports
// both transitions (onSolid / onCleared) and the consumers must support
// retraction (TraversalGrid.unobserve).
//
// Cost model per keyframe (80x60 after the capture stride — see
// TSDF_KEYFRAME_MAX_SAMPLES): every accepted pixel marches
// (2*truncationVoxels + 1) band steps; carving marches the whole ray from
// carveStartM to the band but only on a carveStride sub-grid of pixels and
// only touches cells that already exist, so memory scales with surface area
// rather than room volume.

import { filterDepthGrid } from './depth-grid-filter.js';
import { depthSampleToWorld } from './depth-math.js';

// Numeric keys are several times faster than template strings in a hot loop.
// 17 bits per axis: ±65536 voxels, i.e. ±3.2km at 5cm — nothing a room hits.
const KEY_HALF = 65536;
const KEY_SPAN = 131072;

export function tsdfKey(ix, iy, iz) {
  return ((ix + KEY_HALF) * KEY_SPAN + (iy + KEY_HALF)) * KEY_SPAN + (iz + KEY_HALF);
}

export class TsdfGrid {
  constructor({
    voxelSize = 0.05,
    origin = [0, 0, 0],
    // Half-width of the fused band in voxels. Wider tolerates more depth noise
    // but thickens every surface and costs proportionally more per ray.
    truncationVoxels = 2,
    // Running-average cap. Past it, old evidence decays exponentially, which
    // is what lets a surface move when a chair is pushed mid-session.
    maxWeight = 32,
    // Distinct frames a voxel must be seen in before it can be solid. Same
    // meaning as VoxelGrid's confirmMinObservations.
    minWeight = 3,
    // |tsdf| below which a voxel is on the surface, in units of truncation.
    // 0.5 with truncationVoxels=2 is a one-voxel-thick shell either side.
    surfaceBand = 0.5,
    // Carving samples every Nth column and row. 1 carves every ray (about
    // 10x the cost of the band pass); 3 keeps it comparable to the band.
    carveStride = 3,
    // Carving starts here rather than at the camera: the nearest metres are
    // where depth is most reliable, but also where the operator's hand is.
    carveStartM = 0.3,
    // Observation weight falls off with range: w = min(1, (ref / L) ^ power).
    // Depth noise grows with distance, so a far sample should need more
    // agreeing frames before it counts as surface. 0 disables (every
    // observation weighs 1, weight == frames seen).
    depthWeightRefM = 0,
    depthWeightPower = 1,
    maxCells = 200000,
    onSolid = null,
    onCleared = null,
  } = {}) {
    this.depthWeightRefM = depthWeightRefM;
    this.depthWeightPower = depthWeightPower;
    this.voxelSize = voxelSize;
    this.origin = [origin[0], origin[1], origin[2]];
    this.truncationVoxels = truncationVoxels;
    this.truncationM = truncationVoxels * voxelSize;
    this.maxWeight = maxWeight;
    this.minWeight = minWeight;
    this.surfaceBand = surfaceBand;
    this.carveStride = Math.max(1, Math.floor(carveStride));
    this.carveStartM = carveStartM;
    this.maxCells = maxCells;
    this.onSolid = onSolid;
    this.onCleared = onCleared;

    this.cells = new Map();
    this.touched = new Set();
    this.solidCount = 0;
    this.revision = 0;
    this.full = false;
  }

  // ── writing ───────────────────────────────────────────────

  // Fuses one keyframe. Returns the filter pass counters plus how many cells
  // changed solid state, so callers can keep the same stats VoxelTerrain had.
  integrate({ width, height, depths, invProjectionMatrix, viewMatrix, frameId }, {
    nearM = 0.3,
    farM = 5.0,
    gradientMaxJumpM = 0.10,
    rejectOnMissingNeighbor = false,
  } = {}) {
    const cam = [viewMatrix[12], viewMatrix[13], viewMatrix[14]];
    const tau = this.truncationM;
    const step = this.voxelSize;
    const carveStride = this.carveStride;
    const carveStart = Math.max(this.carveStartM, 0);
    const weightRef = this.depthWeightRefM;
    const weightPower = this.depthWeightPower;
    let rejectedUnproject = 0;
    let carved = 0;
    let banded = 0;

    const pass = filterDepthGrid(
      { depths, width, height },
      { nearM, farM, gradientMaxJumpM, rejectOnMissingNeighbor },
      (col, row, depth) => {
        const u = (col + 0.5) / width;
        const v = (row + 0.5) / height;
        const hit = depthSampleToWorld(u, v, depth, invProjectionMatrix, viewMatrix);
        if (!hit) {
          rejectedUnproject += 1;
          return;
        }
        const dx = hit[0] - cam[0];
        const dy = hit[1] - cam[1];
        const dz = hit[2] - cam[2];
        const length = Math.hypot(dx, dy, dz);
        if (!(length > 0)) {
          rejectedUnproject += 1;
          return;
        }
        const ux = dx / length;
        const uy = dy / length;
        const uz = dz / length;
        const obsWeight = weightRef > 0
          ? Math.min(1, (weightRef / length) ** weightPower)
          : 1;

        // Band: [L - tau, L + tau], signed distance measured along the ray.
        // Integer step counts: accumulating floats would drop the last band
        // sample whenever rounding pushes t a hair past bandEnd.
        const bandStart = Math.max(length - tau, 0);
        const bandSteps = Math.round((length + tau - bandStart) / step);
        for (let i = 0; i <= bandSteps; i += 1) {
          const t = bandStart + i * step;
          const sdf = Math.max(-1, Math.min(1, (length - t) / tau));
          this._fuse(cam[0] + ux * t, cam[1] + uy * t, cam[2] + uz * t, sdf, frameId, true, obsWeight);
          banded += 1;
        }

        // Free space: the ray got here, so nothing solid sits along it.
        if (col % carveStride === 0 && row % carveStride === 0 && bandStart > carveStart) {
          const carveSteps = Math.floor((bandStart - carveStart) / step);
          for (let i = 0; i < carveSteps; i += 1) {
            const t = carveStart + i * step;
            this._fuse(cam[0] + ux * t, cam[1] + uy * t, cam[2] + uz * t, 1, frameId, false, obsWeight);
            carved += 1;
          }
        }
      },
    );

    const transitions = this._flushTouched();
    return {
      total: pass.total,
      rejectedZero: pass.rejectedZero,
      rejectedRange: pass.rejectedRange,
      rejectedGradient: pass.rejectedGradient,
      rejectedUnproject,
      // filterDepthGrid counted unprojection failures as accepted.
      accepted: pass.accepted - rejectedUnproject,
      banded,
      carved,
      ...transitions,
    };
  }

  // One voxel, one signed-distance observation. A voxel several rays of the
  // same frame cross keeps only the observation nearest the surface, so the
  // weight still counts frames, not rays, and a carving ray never outvotes a
  // band ray from the same viewpoint.
  _fuse(x, y, z, sdf, frameId, create, obsWeight = 1) {
    const size = this.voxelSize;
    const ix = Math.floor((x - this.origin[0]) / size);
    const iy = Math.floor((y - this.origin[1]) / size);
    const iz = Math.floor((z - this.origin[2]) / size);
    const key = tsdfKey(ix, iy, iz);

    let cell = this.cells.get(key);
    if (!cell) {
      if (!create) return;
      if (this.cells.size >= this.maxCells) {
        this.full = true;
        return;
      }
      cell = {
        key: `${ix},${iy},${iz}`,
        ix,
        iy,
        iz,
        tsdf: 0,
        weight: 0,
        observationCount: 0,
        lastFrameId: null,
        solid: false,
        // Frame-local undo state, see below.
        frameTsdf: 0,
        frameWeight: 0,
        frameSdf: 0,
        // VoxelGrid cell shape, so the export codec, the viewer and the
        // operator view read either grid. The surface estimate is the centre.
        sampleCount: 1,
        sumX: this.origin[0] + (ix + 0.5) * size,
        sumY: this.origin[1] + (iy + 0.5) * size,
        sumZ: this.origin[2] + (iz + 0.5) * size,
        clusterId: null,
      };
      this.cells.set(key, cell);
      this.revision += 1;
    }

    if (cell.lastFrameId === frameId) {
      if (Math.abs(sdf) >= Math.abs(cell.frameSdf)) return;
      // A closer-to-surface observation from the same frame replaces the
      // earlier one: restore the pre-frame state and apply the new value.
      cell.tsdf = cell.frameTsdf;
      cell.weight = cell.frameWeight;
      cell.observationCount -= 1;
    } else {
      cell.lastFrameId = frameId;
      cell.frameTsdf = cell.tsdf;
      cell.frameWeight = cell.weight;
      this.touched.add(cell);
    }
    cell.frameSdf = sdf;

    const w = cell.weight;
    cell.tsdf = (cell.tsdf * w + sdf * obsWeight) / (w + obsWeight);
    cell.weight = Math.min(w + obsWeight, this.maxWeight);
    cell.observationCount += 1;
  }

  _isSolid(cell) {
    return cell.weight >= this.minWeight && Math.abs(cell.tsdf) < this.surfaceBand;
  }

  _flushTouched() {
    let becameSolid = 0;
    let becameClear = 0;
    for (const cell of this.touched) {
      const solid = this._isSolid(cell);
      if (solid === cell.solid) continue;
      cell.solid = solid;
      if (solid) {
        this.solidCount += 1;
        becameSolid += 1;
        this.onSolid?.(cellCenter(cell), cell);
      } else {
        this.solidCount -= 1;
        becameClear += 1;
        this.onCleared?.(cellCenter(cell), cell);
      }
    }
    this.touched.clear();
    if (becameSolid || becameClear) this.revision += 1;
    return { becameSolid, becameClear };
  }

  // Frees room in a full grid by dropping cells seen once and never solid —
  // overwhelmingly the far end of a band around a noisy sample. Returns how
  // many were removed.
  evictUnconfirmed(count) {
    let removed = 0;
    for (const [key, cell] of this.cells) {
      if (removed >= count) break;
      if (cell.weight <= 1 && !cell.solid) {
        this.cells.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.revision += 1;
      this.full = false;
    }
    return removed;
  }

  // ── reading ───────────────────────────────────────────────

  getCell(ix, iy, iz) {
    return this.cells.get(tsdfKey(ix, iy, iz)) ?? null;
  }

  getCells() {
    return Array.from(this.cells.values());
  }

  // Cells near the zero crossing, solid or not yet: what the export carries so
  // the viewer's observation-threshold slider still means something. Cells
  // that only ever held free-space or deep-inside votes are omitted.
  getSurfaceCells() {
    const cells = [];
    for (const cell of this.cells.values()) {
      if (Math.abs(cell.tsdf) < this.surfaceBand) cells.push(cell);
    }
    return cells;
  }

  getSolidCells() {
    const cells = [];
    for (const cell of this.cells.values()) if (cell.solid) cells.push(cell);
    return cells;
  }

  getCellCount() {
    return this.cells.size;
  }

  getSolidCount() {
    return this.solidCount;
  }

  isFull() {
    return this.full;
  }

  getRevision() {
    return this.revision;
  }

  // Observation histogram of surface cells — the same buckets VoxelGrid
  // reports, so the operator status line reads identically.
  getHistogram() {
    const histogram = { one: 0, two: 0, three: 0, fourPlus: 0, total: 0 };
    for (const cell of this.cells.values()) {
      if (Math.abs(cell.tsdf) >= this.surfaceBand) continue;
      histogram.total += 1;
      if (cell.observationCount <= 1) histogram.one += 1;
      else if (cell.observationCount === 2) histogram.two += 1;
      else if (cell.observationCount === 3) histogram.three += 1;
      else histogram.fourPlus += 1;
    }
    return histogram;
  }

  reset() {
    if (this.cells.size) this.revision += 1;
    this.cells.clear();
    this.touched.clear();
    this.solidCount = 0;
    this.full = false;
  }
}

export function cellCenter(cell) {
  return [cell.sumX, cell.sumY, cell.sumZ];
}

// Keeps every Nth column and row of a stored keyframe and drops the rest. The
// phone captures the game terrain at half resolution
// (TSDF_KEYFRAME_MAX_SAMPLES), so an offline rebuild has to subsample the
// full-resolution scan the same way or it is not measuring what the game runs.
export function subsampleKeyframe(keyframe, stride = 1) {
  if (stride <= 1) return keyframe;
  const width = Math.ceil(keyframe.width / stride);
  const height = Math.ceil(keyframe.height / stride);
  const depths = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      depths[row * width + col] = keyframe.depths[(row * stride) * keyframe.width + col * stride];
    }
  }
  return { ...keyframe, width, height, depths };
}

// Batch counterpart of rebuildVoxelGrid: fuses stored keyframes into a fresh
// TSDF grid and reports the same stats shape, so the diagnostic panel and the
// PC viewer can swap fusions without knowing which one ran.
//
// The returned `grid` exposes only the surface cells — the ones near the zero
// crossing. Free-space and deep-inside cells are bookkeeping, and handing them
// to a renderer would draw a solid block of every room the camera swept.
export function rebuildTsdfGrid(keyframes, {
  voxelSize = 0.05,
  minObservations = 3,
  nearM = 0.3,
  farM = 5.0,
  gradientMaxJumpM = 0.10,
  maxCells = 4000000,
  sampleStride = 2,
  now = () => 0,
  ...tsdfOptions
} = {}) {
  const startedAt = now();
  const tsdf = new TsdfGrid({
    voxelSize,
    minWeight: minObservations,
    maxCells,
    ...tsdfOptions,
  });
  const stats = {
    keyframes: keyframes.length,
    samplesTotal: 0,
    rejectedZero: 0,
    rejectedRange: 0,
    rejectedGradient: 0,
    rejectedUnproject: 0,
    accepted: 0,
    carved: 0,
    cleared: 0,
    cells: 0,
    truncated: false,
    histogram: null,
    buildMs: 0,
  };

  for (const keyframe of keyframes) {
    const pass = tsdf.integrate(subsampleKeyframe(keyframe, sampleStride), {
      nearM, farM, gradientMaxJumpM,
    });
    stats.samplesTotal += pass.total;
    stats.rejectedZero += pass.rejectedZero;
    stats.rejectedRange += pass.rejectedRange;
    stats.rejectedGradient += pass.rejectedGradient;
    stats.rejectedUnproject += pass.rejectedUnproject;
    stats.accepted += pass.accepted;
    stats.carved += pass.carved;
    stats.cleared += pass.becameClear;
    if (tsdf.isFull()) stats.truncated = true;
  }

  const surface = tsdf.getSurfaceCells();
  stats.cells = surface.length;
  stats.histogram = tsdf.getHistogram();
  stats.buildMs = now() - startedAt;

  return {
    tsdf,
    stats,
    grid: {
      getCells: () => surface,
      getCellCount: () => surface.length,
      getHistogram: () => stats.histogram,
    },
  };
}
