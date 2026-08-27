// Walkable-surface grid built from the accumulated voxel map.
//
// The voxel map answers "is something here". Chasing needs "can Hachuping
// stand here, and can it get from here to there", so this projects the voxels
// onto a top-down grid of cells and, per cell, records which height slabs are
// occupied as a bitmask.
//
// A cell can hold more than one standable level — the floor under a table and
// the tabletop above it are separate levels, which is what lets Hachuping jump
// onto furniture instead of only walking around it.
//
// No three.js dependency so it can be unit-tested directly.

const UNSEEN = 0;

const NEIGHBOUR_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function cellKey(cx, cz) {
  return `${cx},${cz}`;
}

export function nodeKey(cx, cz, level) {
  return `${cx},${cz},${level}`;
}

export function parseNodeKey(key) {
  const [cx, cz, level] = key.split(',');
  return { cx: Number(cx), cz: Number(cz), level: Number(level) };
}

export const MOVE = Object.freeze({
  WALK: 'walk',
  JUMP: 'jump',
});

export class TraversalGrid {
  constructor({
    cellSize = 0.2,
    slabHeight = 0.1,
    // The 'local' reference space puts the origin at the phone when the session
    // started, so the floor sits roughly 1.4m BELOW y = 0. The band has to
    // reach well under zero or the floor falls outside the grid entirely.
    minY = -3.0,
    slabCount = 64,
    // These mirror the shipped values in config.js. They drifted apart once —
    // config moved and this did not — so a reader of this file saw numbers the
    // game never used. Keep them in step.
    headroom = 0.34,
    // Clear space a surface needs above it before Hachuping will stand there.
    // The body only needs `headroom`, but fitting is not the same as being
    // somewhere worth going: at 34cm it fits under a desk, and then it spends
    // the chase invisible under furniture. Asking for a metre keeps it on open
    // floor and on top of things. Defaults to the body height so the class on
    // its own behaves as before; the game raises it.
    minOverhead = headroom,
    // Neighbouring cells that must offer a surface at the same height before
    // this one counts as somewhere to stand. A band of wall is one cell thick,
    // so it runs out of neighbours across its width however long it runs; a
    // table top has them all round. Together with minSlabVoxels — which asks
    // whether the cell itself is broad — this separates a real surface from the
    // last scanned row of a wall, which otherwise reads as a ledge in mid-air.
    // 0 disables it, the class default, so nothing changes unasked.
    minNeighbours = 0,
    // How far apart two neighbouring surfaces may sit and still count as one.
    // A slab either way: enough that a real surface's own roughness does not
    // disconnect it from itself.
    neighbourToleranceM = 0.12,
    maxStepUp = 0.15,
    maxJumpUp = 0.95,
    maxDropDown = 1.2,
    // A ceiling is geometrically identical to a tabletop: a thin occupied slab
    // with clear air on one side. Only its height tells them apart, so cap how
    // far above the floor a surface may be and still count as standable.
    maxStandAboveFloor = 1.3,
    // How many cells must share a slab before it is believed to be the floor.
    // A handful of stray depth points below the real floor would otherwise
    // drag the ceiling up with them.
    floorMinCells = 8,
    // How many distinct 5cm voxels a 20x20x10cm slab needs before it counts as
    // something to stand on. One was enough before, so a single stray depth
    // point conjured a whole 20x20cm foothold in mid-air. A fully observed flat
    // floor leaves 16 voxels in its slab, so 4 clears real surfaces comfortably
    // while rejecting isolated noise.
    minSlabVoxels = 4,
    // A foothold this far above the floor must look like a real platform, not
    // a lone blob: at least `minRaisedSupport` of its eight neighbours need a
    // standable level within `raisedSupportBandM`. Furniture tops are wide and
    // score 8/8; a noise cluster floating in mid-air scores 0/8. Without this,
    // raising the jump height to reach hip-height furniture also hands
    // Hachuping every stray reconstruction artefact in the room.
    raisedSupportAboveFloorM = 0.4,
    minRaisedSupport = 2,
    raisedSupportBandM = 0.10,
    // How reluctant Hachuping is to use furniture. These were tuned when the
    // penalties were the ONLY defence against the aerial-highway bug (touring
    // the room at tabletop height without ever landing). hasRaisedSupport now
    // blocks the noise ledges that made that bug dangerous, so the tax exists
    // only for believability — a small creature mostly runs on the ground.
    // Measured on a real room scan; see the commit that introduced them.
    climbCostPerM = 2.0,     // charged once, per metre climbed
    dropCostPerM = 0.5,      // coming down must look like the easy direction
    jumpBaseCost = 0.6,
    heightTollPerM = 0.1,    // charged every step taken above the floor
    // ... and at least this fraction of the busiest slab's cells. Measured on
    // two room scans: 0.3 puts the floor on the slab holding the surface for
    // both hit counting and TSDF, while 0.1 still let a sub-floor noise slab
    // through for TSDF.
    floorMinFraction = 0.3,
  } = {}) {
    this.floorMinFraction = floorMinFraction;
    this.cellSize = cellSize;
    this.slabHeight = slabHeight;
    this.minY = minY;
    this.slabCount = Math.min(slabCount, 64); // two 32-bit masks per cell
    this.headroomSlabs = Math.max(1, Math.ceil(headroom / slabHeight));
    this.overheadSlabs = Math.max(this.headroomSlabs, Math.ceil(minOverhead / slabHeight));
    this.minNeighbours = minNeighbours;
    this.neighbourToleranceM = neighbourToleranceM;
    // Bumped whenever any footing appears or goes. A cell's own levels depend
    // only on its own column, but the neighbour rule makes the FILTERED answer
    // depend on the cells around it, and there is no per-cell channel that
    // notices a neighbour changing.
    this.areaGen = 0;
    this.maxStepUp = maxStepUp;
    this.maxJumpUp = maxJumpUp;
    this.maxDropDown = maxDropDown;
    this.maxStandAboveFloor = maxStandAboveFloor;
    this.floorMinCells = floorMinCells;
    this.minSlabVoxels = Math.max(1, minSlabVoxels);
    this.raisedSupportAboveFloorM = raisedSupportAboveFloorM;
    this.minRaisedSupport = minRaisedSupport;
    this.raisedSupportBandM = raisedSupportBandM;
    this.climbCostPerM = climbCostPerM;
    this.dropCostPerM = dropCostPerM;
    this.jumpBaseCost = jumpBaseCost;
    this.heightTollPerM = heightTollPerM;
    this.cells = new Map();
    this.revision = 0;
    this.slabCells = new Int32Array(64);
    this.floorSlab = null;
    this.floorDirty = true;
    this.standGen = 0;
    this.floorHeightCache = null;
    this.floorHeightGen = -1;
    this.floorHeightSlab = null;
    // Optional RANSAC floor plane (see applyFloorPlane). When set it overrides
    // the histogram floor detection and can fill sparse floor gaps.
    this.floorPlane = null;
    this.floorPlaneRefY = null;
  }

  // ── coordinate helpers ────────────────────────────────────
  cellX(x) {
    return Math.floor(x / this.cellSize);
  }

  cellZ(z) {
    return Math.floor(z / this.cellSize);
  }

  slabOf(y) {
    return Math.floor((y - this.minY) / this.slabHeight);
  }

  // Where feet actually go in this cell's slab: the interpolated surface when
  // the fusion could resolve one, the slab top otherwise. Clamped inside the
  // slab so levels() stays ascending — a refined height is at most half a voxel
  // outside its own slab, and letting one overtake the slab above would break
  // the level ordering every caller assumes.
  _slabHeight(cell, slab) {
    const n = cell.heightCount[slab];
    if (!n) return this.slabTopY(slab);
    const mean = cell.heightSum[slab] / n;
    const bottom = this.minY + slab * this.slabHeight;
    const slack = this.slabHeight / 2;
    return Math.min(Math.max(mean, bottom - slack), bottom + this.slabHeight + slack);
  }

  // The height a cell's feet sit at, or null when it has no footing there.
  slabHeightAt(cx, cz, slab) {
    const cell = this.getCell(cx, cz);
    if (!cell || !this.hasSlab(cell, slab)) return null;
    return this._slabHeight(cell, slab);
  }

  // Representative floor height: the refined mean across every cell holding the
  // floor slab, falling back to the slab top. Replaces slabTopY(floorSlab) at
  // the call sites that compare a (now continuous) level against the floor —
  // mixing the two conventions there would bias every comparison by up to a
  // full slab.
  floorHeightY() {
    const slab = this.resolveFloorSlab();
    if (slab === null) return null;
    if (this.floorHeightGen === this.standGen && this.floorHeightSlab === slab) {
      return this.floorHeightCache;
    }
    let sum = 0;
    let count = 0;
    for (const cell of this.cells.values()) {
      if (!cell.heightCount[slab] || !this.hasSlab(cell, slab)) continue;
      sum += this._slabHeight(cell, slab);
      count += 1;
    }
    this.floorHeightCache = count ? sum / count : this.slabTopY(slab);
    this.floorHeightGen = this.standGen;
    this.floorHeightSlab = slab;
    return this.floorHeightCache;
  }

  // Top of a slab: standing on it puts your feet here.
  slabTopY(slab) {
    return this.minY + (slab + 1) * this.slabHeight;
  }

  centerX(cx) {
    return (cx + 0.5) * this.cellSize;
  }

  centerZ(cz) {
    return (cz + 0.5) * this.cellSize;
  }

  // ── writing ───────────────────────────────────────────────
  // Called once per voxel that became solid. O(1) — never rebuild the whole
  // grid per frame, that measured 110x slower than updating touched cells.
  // `surfaceY` is the interpolated height of the surface this voxel sits on,
  // or null when the fusion could not resolve one. It is deliberately NOT used
  // to pick the slab: keeping slab assignment on the voxel centre leaves the
  // vote ledger, the floor histogram and the footing threshold bit-identical to
  // before, and stops a flat surface's votes splitting across two slabs (which
  // would drop cells below minSlabVoxels and erase walkable ground).
  observe([x, y, z], surfaceY = y) {
    const slab = this.slabOf(y);
    if (slab < 0 || slab >= this.slabCount) return false;

    const cx = this.cellX(x);
    const cz = this.cellZ(z);
    const key = cellKey(cx, cz);
    let cell = this.cells.get(key);
    if (!cell) {
      // votes: how many confirmed voxels back each slab. One ledger serves
      // two features that were built apart and merged here:
      //  - the slab only becomes standable at `minSlabVoxels` votes, so a
      //    single stray depth point cannot conjure a 20x20cm foothold;
      //  - TSDF retraction (unobserve) decrements the same ledger, and the
      //    bit clears when votes drop back below the threshold.
      // Counting must therefore CONTINUE past the threshold — capping there
      // would make later retractions clear the bit too early.
      cell = {
        cx, cz, lo: UNSEEN, hi: UNSEEN,
        rawLevels: null, rawGen: -1, levels: null, levelsGen: -1, levelsArea: -1,
        votes: new Uint16Array(this.slabCount),
        // Interpolated standing heights, summed per slab. Counted separately
        // from `votes` because only some voxels can be refined — mixing the
        // un-refined ones in would bias the mean upward, slab tops sitting
        // systematically above the real surface.
        heightSum: new Float64Array(this.slabCount),
        heightCount: new Uint16Array(this.slabCount),
      };
      this.cells.set(key, cell);
    }

    if (cell.votes[slab] < 0xffff) cell.votes[slab] += 1;
    if (surfaceY !== null && cell.heightCount[slab] < 0xffff) {
      cell.heightSum[slab] += surfaceY;
      cell.heightCount[slab] += 1;
      // The mean moved, so both memoised answers are stale — the height is
      // part of the RAW one, not something the neighbour filter adds.
      // Deliberately does NOT bump `revision` (that gates the instanced chase
      // overlay, which would rebuild every keyframe for a millimetre) nor
      // `areaGen` (the neighbour test has 12cm of tolerance; a sample cannot
      // nudge the mean across it).
      cell.rawLevels = null;
      cell.levels = null;
    }
    // The floor histogram counts OBSERVED cells (first vote), not confirmed
    // footing. Floor detection is statistics over many cells with its own
    // noise defences (floorMinCells, floorMinFraction); gating it on the
    // footing threshold starved it on sparse TSDF maps until applyFloorPlane
    // had no floor slab to fill against.
    if (cell.votes[slab] === 1) {
      this.slabCells[slab] += 1;
      if (this.floorSlab === null || slab <= this.floorSlab) this.floorDirty = true;
    }
    if (this.hasSlab(cell, slab)) return false;   // already solid — vote banked
    if (cell.votes[slab] < this.minSlabVoxels) return false; // evidence pending
    if (slab < 32) cell.lo |= 1 << slab;
    else cell.hi |= 1 << (slab - 32);
    cell.rawLevels = null; // recompute lazily
    cell.levels = null;
    this.areaGen += 1;
    this.revision += 1;
    return true;
  }

  // The inverse of observe, for accumulators that can take a voxel back
  // (TSDF fusion clears a floater once enough rays pass through it). Returns
  // true when the slab bit actually cleared. An empty cell is dropped so it
  // reads as unseen again rather than blocked.
  unobserve([x, y, z], surfaceY = y) {
    const slab = this.slabOf(y);
    if (slab < 0 || slab >= this.slabCount) return false;
    const cell = this.cells.get(cellKey(this.cellX(x), this.cellZ(z)));
    if (!cell || cell.votes[slab] === 0) return false;
    cell.votes[slab] -= 1;
    if (surfaceY !== null && cell.heightCount[slab] > 0) {
      cell.heightSum[slab] -= surfaceY;
      cell.heightCount[slab] -= 1;
      if (cell.heightCount[slab] === 0) cell.heightSum[slab] = 0;
      cell.rawLevels = null;
      cell.levels = null;
    }
    if (cell.votes[slab] === 0) {
      this.slabCells[slab] -= 1;
      this.floorDirty = true;
      // A cell with no votes anywhere is gone entirely.
      if (this._dropIfEmpty(cell)) {
        this.revision += 1;
        return true;
      }
    }
    // The footing bit exists only while votes meet the threshold; it clears on
    // the retraction that drops below it, not when the ledger hits zero.
    if (!this.hasSlab(cell, slab)) return false;
    if (cell.votes[slab] >= this.minSlabVoxels) return false;

    if (slab < 32) cell.lo &= ~(1 << slab);
    else cell.hi &= ~(1 << (slab - 32));
    // The floor may have lost support; let the next read decide.
    this.floorDirty = true;
    cell.rawLevels = null;
    cell.levels = null;
    this.areaGen += 1;
    this.revision += 1;
    // Checked again AFTER clearing the bit. The emptiness test above runs while
    // the footing is still set, so a cell whose last vote was just retracted
    // would survive as an empty husk — seen, unwalkable, and therefore read as
    // a wall by isBlocked. That is the opposite of what a full retraction means.
    this._dropIfEmpty(cell);
    return true;
  }

  _dropIfEmpty(cell) {
    if (cell.lo !== UNSEEN || cell.hi !== UNSEEN) return false;
    if (!cell.votes.every((v) => v === 0)) return false;
    this.cells.delete(cellKey(cell.cx, cell.cz));
    return true;
  }

  // Lowest slab that enough cells share to be believable as the floor.
  // Recomputed only when a new low slab appears, and every cached level list is
  // invalidated when the answer moves, because the standable ceiling moves too.
  resolveFloorSlab() {
    if (!this.floorDirty) return this.floorSlab;
    this.floorDirty = false;
    // Absolute floor of 8 cells was tuned for hit counting. A fused map emits
    // several times more voxels, so a slab of sub-floor noise clears 8 cells
    // easily and drags the standable ceiling down with it (measured: 2 slabs
    // low, 158 desk-top cells lost). The bar is therefore also relative to
    // the busiest slab, which is the real floor or something as big.
    let busiest = 0;
    for (let slab = 0; slab < this.slabCount; slab += 1) {
      if (this.slabCells[slab] > busiest) busiest = this.slabCells[slab];
    }
    const minCells = Math.max(this.floorMinCells, Math.ceil(busiest * this.floorMinFraction));
    let found = null;
    for (let slab = 0; slab < this.slabCount; slab += 1) {
      if (this.slabCells[slab] >= minCells) { found = slab; break; }
    }
    // A real floor is never one clean slab: depth noise and an uneven scan
    // spread it over three or four. Taking the lowest qualifying slab lands on
    // the bottom shoulder of that spread, 10-20cm below the actual surface
    // (measured on all five room scans). Walk up while the population is still
    // growing to sit on the peak instead. Stopping at the first decrease is
    // what keeps this from wandering off onto a desk plane higher up.
    if (found !== null) {
      while (found + 1 < this.slabCount
        && this.slabCells[found + 1] > this.slabCells[found]) {
        found += 1;
      }
    }
    if (found === null) {
      for (let slab = 0; slab < this.slabCount; slab += 1) {
        if (this.slabCells[slab] > 0) { found = slab; break; }
      }
    }
    if (found !== this.floorSlab) {
      this.floorSlab = found;
      this.standGen += 1;
    }
    return this.floorSlab;
  }

  // Highest y a surface may sit at and still be somewhere Hachuping could go.
  standCeilingY() {
    const floor = this.resolveFloorSlab();
    if (floor === null) return Infinity;
    return this.slabTopY(floor) + this.maxStandAboveFloor;
  }

  hasSlab(cell, slab) {
    if (slab < 0 || slab >= this.slabCount) return false;
    return slab < 32
      ? (cell.lo & (1 << slab)) !== 0
      : (cell.hi & (1 << (slab - 32))) !== 0;
  }

  observeAll(points) {
    let changed = 0;
    for (const point of points) {
      if (this.observe(point)) changed += 1;
    }
    return changed;
  }

  reset() {
    if (this.cells.size) this.revision += 1;
    this.cells.clear();
    this.slabCells.fill(0);
    this.floorSlab = null;
    this.floorDirty = true;
    this.floorPlane = null;
    this.floorPlaneRefY = null;
    this.standGen += 1;
  }

  // ── RANSAC floor plane ─────────────────────────────────────
  // Every occupied voxel as a world point, for fitting the floor plane. One
  // point per occupied slab at its top (where a body would stand). Read this
  // BEFORE applyFloorPlane so the fit sees only real observations.
  // Raw observations, not footing. The plane fitter has its own outlier
  // rejection (RANSAC inlier voting), so it wants every observed voxel; the
  // footing threshold (minSlabVoxels) would starve it on the sparse TSDF maps
  // the floor-plane rescue exists for.
  occupiedVoxelPoints() {
    const points = [];
    for (const cell of this.cells.values()) {
      for (let slab = 0; slab < this.slabCount; slab += 1) {
        if (cell.votes[slab] > 0) {
          points.push([this.centerX(cell.cx), this._slabHeight(cell, slab), this.centerZ(cell.cz)]);
        }
      }
    }
    return points;
  }

  // Occupied voxels within a low band, for fitting the floor plane. The floor is
  // the lowest large surface, so fitting the whole cloud lets a ceiling or a
  // tall shelf — more voxels, higher up — win the plane. Anchoring to a robust
  // low height (a low percentile, so a stray sub-floor floater cannot drag it
  // down) and keeping only points within bandM above it isolates the floor.
  floorBandVoxelPoints({ bandM = 0.5, lowPercentile = 0.1 } = {}) {
    const points = this.occupiedVoxelPoints();
    if (!points.length) return points;
    const ys = points.map((p) => p[1]).sort((a, b) => a - b);
    const y0 = ys[Math.floor(lowPercentile * (ys.length - 1))];
    return points.filter((p) => p[1] <= y0 + bandM);
  }

  // Any occupied slab in [startSlab, startSlab + count)?
  // Any observation counts here, confirmed or not: this guards where the
  // synthetic floor may NOT go, and even a single observed voxel overhead is
  // reason enough to leave the space beneath it alone.
  solidInBand(cell, startSlab, count) {
    const end = Math.min(this.slabCount, startSlab + count);
    for (let slab = Math.max(0, startSlab); slab < end; slab += 1) {
      if (cell.votes[slab] > 0) return true;
    }
    return false;
  }

  // Add a floor voxel the map never observed, to bridge a sparse-scan gap.
  // Marked synthetic for diagnostics; otherwise it is an ordinary occupied slab.
  // `height` is the observed floor's refined height. Without it a filled cell
  // would fall back to the slab top and put a 10cm cliff at the seam between
  // scanned and synthesised floor — the exact discontinuity the fill exists to
  // remove. The RANSAC plane is deliberately not used for this: its absolute
  // height is not trusted (see applyFloorPlane).
  addSyntheticFloor(cx, cz, slab, height = null) {
    const key = cellKey(cx, cz);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = {
        cx, cz, lo: UNSEEN, hi: UNSEEN, votes: new Uint16Array(this.slabCount),
        heightSum: new Float64Array(this.slabCount),
        heightCount: new Uint16Array(this.slabCount),
        rawLevels: null, rawGen: -1, levels: null, levelsGen: -1, levelsArea: -1,
        synthetic: true,
      };
      this.cells.set(key, cell);
    }
    if (this.hasSlab(cell, slab)) return;
    // Synthetic floor is deliberate synthesis, not evidence: grant it the full
    // footing threshold so the votes<->bit invariant holds for unobserve.
    if (cell.votes[slab] === 0) this.slabCells[slab] += 1;
    if (cell.votes[slab] < this.minSlabVoxels) cell.votes[slab] = this.minSlabVoxels;
    if (height !== null && cell.heightCount[slab] === 0) {
      // One sample standing for the whole synthesised footing, so the mean is
      // exactly the observed floor height rather than a fraction of it.
      cell.heightSum[slab] = height;
      cell.heightCount[slab] = 1;
    }
    if (slab < 32) cell.lo |= 1 << slab;
    else cell.hi |= 1 << (slab - 32);
    cell.rawLevels = null;
    cell.levels = null;
    this.areaGen += 1;
  }

  // Adopt a fitted floor plane (or null to clear) and fill sparse-scan gaps in
  // the floor. The plane's job is to CONFIRM a coherent, near-horizontal floor
  // exists — its absolute height is deliberately not trusted, because a scan's
  // densest surface can be a desk (floats the character) and its lowest points
  // can be sub-floor noise (sinks it). The fill therefore bridges gaps at the
  // height the OBSERVATIONS already agree on (the histogram floor slab), which
  // is the height the game ran at before this feature.
  //
  // A cell within fillRadius of an observed floor cell gains a floor voxel at
  // that slab UNLESS it already stands somewhere, something solid blocks the
  // body column just above it, or it lies beyond the radius (a real hole or
  // unscanned void, left untouched).
  applyFloorPlane(plane, { fillRadius = 2, bodyHeightSlabs = this.headroomSlabs } = {}) {
    this.floorPlane = plane || null;
    this.floorPlaneRefY = null;
    if (!plane) {
      this.floorDirty = true;
      this.standGen += 1;
      this.revision += 1;
      return;
    }

    const floorSlab = this.resolveFloorSlab();
    if (floorSlab === null) return;
    // Resolved before any synthesis, so the fill copies the height the real
    // observations agree on rather than one polluted by its own output.
    const floorHeight = this.floorHeightY();

    // Seeds: observed cells that carry a floor voxel at the floor slab.
    const seeds = [];
    for (const cell of this.cells.values()) {
      // Raw observation seeds the fill: a sparse floor cell with votes below
      // the footing threshold is exactly what the synthesis is for — it gets
      // granted full footing by addSyntheticFloor below.
      if (cell.votes[floorSlab] > 0) seeds.push([cell.cx, cell.cz]);
    }

    // Bounded dilation of the observed floor, at the observed floor height.
    const done = new Set();
    for (const [scx, scz] of seeds) {
      for (let dz = -fillRadius; dz <= fillRadius; dz += 1) {
        for (let dx = -fillRadius; dx <= fillRadius; dx += 1) {
          const cx = scx + dx; const cz = scz + dz;
          const key = cellKey(cx, cz);
          if (done.has(key)) continue;
          done.add(key);
          const cell = this.cells.get(key);
          if (cell) {
            if (this.hasSlab(cell, floorSlab)) continue; // already floor here
            if (this.solidInBand(cell, floorSlab + 1, bodyHeightSlabs)) continue; // under something
            // Only bridge genuine gaps. A cell that already offers somewhere to
            // stand (e.g. a shelf) keeps it; adding a floor beneath it would
            // sink Hachuping through a surface it should rest on.
            if (this.isWalkable(cx, cz)) continue;
          }
          this.addSyntheticFloor(cx, cz, floorSlab, floorHeight);
        }
      }
    }

    this.floorDirty = true;
    this.standGen += 1;
    this.revision += 1;
  }

  // ── reading ───────────────────────────────────────────────
  getCell(cx, cz) {
    return this.cells.get(cellKey(cx, cz)) ?? null;
  }

  isSeen(cx, cz) {
    return this.cells.has(cellKey(cx, cz));
  }

  // Standable heights in a cell, lowest first. A slab qualifies when it is
  // occupied and the slabs above it are clear for the whole body height.
  // Heights this column alone offers, before the neighbour rule. Kept separate
  // so the neighbour test can read its neighbours' RAW answer: asking for their
  // filtered one would recurse across the whole grid.
  rawLevels(cx, cz) {
    const cell = this.getCell(cx, cz);
    if (!cell) return [];
    const ceiling = this.standCeilingY();
    if (cell.rawLevels && cell.rawGen === this.standGen) return cell.rawLevels;

    const levels = [];
    for (let slab = 0; slab < this.slabCount; slab += 1) {
      if (!this.hasSlab(cell, slab)) continue;
      // Too high above the floor to be anywhere a small character could get.
      if (this.slabTopY(slab) > ceiling) break;
      // The clearance must fit, and it must fit inside the mapped band —
      // otherwise the top of a wall reads as a ledge you could stand on.
      if (slab + this.overheadSlabs >= this.slabCount) break;
      let clear = true;
      for (let above = 1; above <= this.overheadSlabs; above += 1) {
        if (this.hasSlab(cell, slab + above)) {
          clear = false;
          break;
        }
      }
      if (clear) levels.push(this._slabHeight(cell, slab));
    }
    cell.rawLevels = levels;
    cell.rawGen = this.standGen;
    return levels;
  }

  levels(cx, cz) {
    const raw = this.rawLevels(cx, cz);
    if (!this.minNeighbours || !raw.length) return raw;
    const cell = this.getCell(cx, cz);
    if (cell.levels && cell.levelsGen === this.standGen && cell.levelsArea === this.areaGen) {
      return cell.levels;
    }
    const kept = raw.filter((y) => this.neighboursAt(cx, cz, y) >= this.minNeighbours);
    cell.levels = kept;
    cell.levelsGen = this.standGen;
    cell.levelsArea = this.areaGen;
    return kept;
  }

  // Of the eight cells around this one, how many offer a surface at the same
  // height. Reads raw levels on purpose — see rawLevels.
  neighboursAt(cx, cz, y) {
    let found = 0;
    for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
      for (const v of this.rawLevels(cx + dx, cz + dz)) {
        if (Math.abs(v - y) <= this.neighbourToleranceM) { found += 1; break; }
      }
    }
    return found;
  }

  isWalkable(cx, cz) {
    return this.levels(cx, cz).length > 0;
  }

  // Does a raised level look like part of a real platform?
  //
  // Deliberately NOT folded into levels(): that would recurse, since the test
  // reads the neighbours' levels. It belongs on the edge layer anyway — the
  // surface exists either way, the question is whether it is somewhere a
  // character could sensibly hop onto.
  hasRaisedSupport(cx, cz, y) {
    const floorSlab = this.resolveFloorSlab();
    if (floorSlab === null) return true;
    const height = y - (this.floorHeightY() ?? this.slabTopY(floorSlab));
    if (height <= this.raisedSupportAboveFloorM) return true; // ground level

    let support = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        for (const level of this.levels(cx + dx, cz + dz)) {
          if (Math.abs(level - y) <= this.raisedSupportBandM) {
            support += 1;
            break;
          }
        }
        if (support >= this.minRaisedSupport) return true;
      }
    }
    return false;
  }

  // A cell that was observed but offers nowhere to stand — a wall, or the
  // solid body of a piece of furniture.
  isBlocked(cx, cz) {
    return this.isSeen(cx, cz) && !this.isWalkable(cx, cz);
  }

  levelY(cx, cz, level) {
    return this.levels(cx, cz)[level] ?? null;
  }

  worldOf({ cx, cz, level }) {
    const y = this.levelY(cx, cz, level);
    if (y === null) return null;
    return [this.centerX(cx), y, this.centerZ(cz)];
  }

  // Nearest standable node to a world point. Used to drop Hachuping onto the
  // grid when the chase starts, and to locate the player on it.
  nodeAtWorld([x, y, z], searchRadius = 3) {
    const cx = this.cellX(x);
    const cz = this.cellZ(z);
    let best = null;
    let bestCost = Infinity;
    for (let dz = -searchRadius; dz <= searchRadius; dz += 1) {
      for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
        const nx = cx + dx;
        const nz = cz + dz;
        const levels = this.levels(nx, nz);
        for (let level = 0; level < levels.length; level += 1) {
          const planar = Math.hypot(dx, dz) * this.cellSize;
          const vertical = Math.abs(levels[level] - y);
          const cost = planar + vertical * 2;
          if (cost < bestCost) {
            bestCost = cost;
            best = { cx: nx, cz: nz, level };
          }
        }
      }
    }
    return best;
  }

  // ── movement rules ────────────────────────────────────────
  // Neighbours reachable in one step. Height decides walk vs jump; anything
  // steeper than maxJumpUp is simply not an edge, which is what keeps
  // Hachuping out of walls and off unreachable shelves.
  //
  // Every admissible level of a neighbouring cell is offered as its own edge.
  // The earlier version returned only the level closest to the current height,
  // which made staying on furniture the ONLY option while standing on it — the
  // floor edge under a table was never even generated, so once Hachuping got
  // up somewhere it toured the room at tabletop altitude. Now the floor route
  // always exists and the costs below make it the preferred one.
  neighbors(node) {
    const fromY = this.levelY(node.cx, node.cz, node.level);
    if (fromY === null) return [];
    const floorSlab = this.resolveFloorSlab();
    const floorY = floorSlab === null ? null : (this.floorHeightY() ?? this.slabTopY(floorSlab));

    const out = [];
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const nx = node.cx + dx;
        const nz = node.cz + dz;
        const levels = this.levels(nx, nz);
        if (!levels.length) continue; // unseen or blocked — never traversable

        // Diagonals may not cut a corner between two blocked cells.
        if (dx !== 0 && dz !== 0) {
          if (!this.isWalkable(node.cx + dx, node.cz) && !this.isWalkable(node.cx, node.cz + dz)) {
            continue;
          }
        }

        const planar = Math.hypot(dx, dz) * this.cellSize;
        for (let level = 0; level < levels.length; level += 1) {
          const rise = levels[level] - fromY;
          // Slab tops are sums of floats; without the epsilon a rise exactly at
          // the limit (0.7000000000000002 vs 0.7) is rejected at random.
          if (rise > this.maxJumpUp + 1e-9) continue;
          if (rise < -this.maxDropDown - 1e-9) continue;

          // A lone blob in mid-air is not a platform, however legal the hop
          // onto it would be. Only checked when climbing: dropping off one is
          // still allowed, or a character could get stranded on it forever.
          if (rise > this.maxStepUp
            && !this.hasRaisedSupport(nx, nz, levels[level])) continue;

          const jump = Math.abs(rise) > this.maxStepUp;
          // Climbing is charged double its height, dropping half: coming down
          // must always look like the easy direction.
          const jumpCost = jump
            ? this.jumpBaseCost + (rise > 0
              ? rise * this.climbCostPerM
              : Math.abs(rise) * this.dropCostPerM)
            : 0;
          // Toll for walking above the floor, per step and proportional to
          // altitude. This is what turns table-chair-table routes into
          // table-floor-table ones without forbidding furniture outright.
          const heightToll = floorY === null
            ? 0
            : Math.max(0, levels[level] - floorY - this.slabHeight / 2)
              * this.heightTollPerM;
          out.push({
            cx: nx,
            cz: nz,
            level,
            rise,
            distance: planar,
            move: jump ? MOVE.JUMP : MOVE.WALK,
            cost: planar + jumpCost + heightToll,
          });
        }
      }
    }
    return out;
  }

  // ── diagnostics ───────────────────────────────────────────
  stats() {
    let seen = 0;
    let walkable = 0;
    let blocked = 0;
    let levelTotal = 0;
    for (const cell of this.cells.values()) {
      seen += 1;
      const levels = this.levels(cell.cx, cell.cz);
      if (levels.length) {
        walkable += 1;
        levelTotal += levels.length;
      } else {
        blocked += 1;
      }
    }
    return { seen, walkable, blocked, levelTotal };
  }

  getRevision() {
    return this.revision;
  }

  // Cells for the operator view overlay, one entry per standable level plus
  // one per blocked cell so the map reads as green / red at a glance.
  toOverlay(maxEntries = 20000) {
    const out = [];
    for (const cell of this.cells.values()) {
      if (out.length >= maxEntries) break;
      const levels = this.levels(cell.cx, cell.cz);
      if (!levels.length) {
        // Draw a blocked cell at the height of its lowest voxel so walls read
        // as red at floor level instead of sinking to the bottom of the band.
        let lowest = this.minY + this.slabHeight;
        for (let slab = 0; slab < this.slabCount; slab += 1) {
          if (this.hasSlab(cell, slab)) { lowest = this.slabTopY(slab); break; }
        }
        out.push({
          cx: cell.cx,
          cz: cell.cz,
          level: -1,
          position: [this.centerX(cell.cx), lowest, this.centerZ(cell.cz)],
          walkable: false,
        });
        continue;
      }
      for (let level = 0; level < levels.length; level += 1) {
        if (out.length >= maxEntries) break;
        out.push({
          cx: cell.cx,
          cz: cell.cz,
          level,
          position: [this.centerX(cell.cx), levels[level], this.centerZ(cell.cz)],
          walkable: true,
        });
      }
    }
    return out;
  }
}
