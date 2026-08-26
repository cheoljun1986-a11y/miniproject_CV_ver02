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
    headroom = 0.5,
    maxStepUp = 0.15,
    maxJumpUp = 0.7,
    maxDropDown = 1.2,
    // A ceiling is geometrically identical to a tabletop: a thin occupied slab
    // with clear air on one side. Only its height tells them apart, so cap how
    // far above the floor a surface may be and still count as standable.
    maxStandAboveFloor = 1.3,
    // How many cells must share a slab before it is believed to be the floor.
    // A handful of stray depth points below the real floor would otherwise
    // drag the ceiling up with them.
    floorMinCells = 8,
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
    this.maxStepUp = maxStepUp;
    this.maxJumpUp = maxJumpUp;
    this.maxDropDown = maxDropDown;
    this.maxStandAboveFloor = maxStandAboveFloor;
    this.floorMinCells = floorMinCells;
    this.cells = new Map();
    this.revision = 0;
    this.slabCells = new Int32Array(64);
    this.floorSlab = null;
    this.floorDirty = true;
    this.standGen = 0;
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
  observe([x, y, z]) {
    const slab = this.slabOf(y);
    if (slab < 0 || slab >= this.slabCount) return false;

    const cx = this.cellX(x);
    const cz = this.cellZ(z);
    const key = cellKey(cx, cz);
    let cell = this.cells.get(key);
    if (!cell) {
      // votes: how many voxels back each slab bit, so a retracted voxel only
      // clears the bit when it was the last one holding it up.
      cell = { cx, cz, lo: UNSEEN, hi: UNSEEN, votes: new Uint16Array(this.slabCount), levels: null, levelsGen: -1 };
      this.cells.set(key, cell);
    }

    if (cell.votes[slab] < 0xffff) cell.votes[slab] += 1;
    if (this.hasSlab(cell, slab)) return false;
    if (slab < 32) cell.lo |= 1 << slab;
    else cell.hi |= 1 << (slab - 32);
    this.slabCells[slab] += 1;
    if (this.floorSlab === null || slab <= this.floorSlab) this.floorDirty = true;
    cell.levels = null; // recompute lazily
    this.revision += 1;
    return true;
  }

  // The inverse of observe, for accumulators that can take a voxel back
  // (TSDF fusion clears a floater once enough rays pass through it). Returns
  // true when the slab bit actually cleared. An empty cell is dropped so it
  // reads as unseen again rather than blocked.
  unobserve([x, y, z]) {
    const slab = this.slabOf(y);
    if (slab < 0 || slab >= this.slabCount) return false;
    const cell = this.cells.get(cellKey(this.cellX(x), this.cellZ(z)));
    if (!cell || cell.votes[slab] === 0) return false;
    cell.votes[slab] -= 1;
    if (cell.votes[slab] > 0) return false;

    if (slab < 32) cell.lo &= ~(1 << slab);
    else cell.hi &= ~(1 << (slab - 32));
    this.slabCells[slab] -= 1;
    if (cell.lo === UNSEEN && cell.hi === UNSEEN) this.cells.delete(cellKey(cell.cx, cell.cz));
    // The floor may have lost support; let the next read decide.
    this.floorDirty = true;
    cell.levels = null;
    this.revision += 1;
    return true;
  }

  // Lowest slab that enough cells share to be believable as the floor.
  // Recomputed only when a new low slab appears, and every cached level list is
  // invalidated when the answer moves, because the standable ceiling moves too.
  resolveFloorSlab() {
    // A fitted floor plane is the authority when present: the histogram below is
    // exactly what mislabels a tabletop as the floor, which the plane fixes.
    if (this.floorPlane && this.floorPlaneRefY !== null) {
      const slab = Math.max(0, Math.min(this.slabCount - 1, this.slabOf(this.floorPlaneRefY)));
      if (slab !== this.floorSlab) { this.floorSlab = slab; this.standGen += 1; }
      this.floorDirty = false;
      return this.floorSlab;
    }
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
  occupiedVoxelPoints() {
    const points = [];
    for (const cell of this.cells.values()) {
      for (let slab = 0; slab < this.slabCount; slab += 1) {
        if (this.hasSlab(cell, slab)) {
          points.push([this.centerX(cell.cx), this.slabTopY(slab), this.centerZ(cell.cz)]);
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
  solidInBand(cell, startSlab, count) {
    const end = Math.min(this.slabCount, startSlab + count);
    for (let slab = Math.max(0, startSlab); slab < end; slab += 1) {
      if (this.hasSlab(cell, slab)) return true;
    }
    return false;
  }

  // Add a floor voxel the map never observed, to bridge a sparse-scan gap.
  // Marked synthetic for diagnostics; otherwise it is an ordinary occupied slab.
  addSyntheticFloor(cx, cz, slab) {
    const key = cellKey(cx, cz);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = {
        cx, cz, lo: UNSEEN, hi: UNSEEN, votes: new Uint16Array(this.slabCount),
        levels: null, levelsGen: -1, synthetic: true,
      };
      this.cells.set(key, cell);
    }
    if (this.hasSlab(cell, slab)) return;
    if (cell.votes[slab] < 0xffff) cell.votes[slab] += 1;
    if (slab < 32) cell.lo |= 1 << slab;
    else cell.hi |= 1 << (slab - 32);
    this.slabCells[slab] += 1;
    cell.levels = null;
  }

  // Adopt a fitted floor plane (or null to clear). Two effects:
  //   1. Height correction — resolveFloorSlab uses the plane, not the histogram.
  //   2. Bounded sparse fill — cells within fillRadius of an observed floor cell
  //      gain a floor voxel at the plane height, UNLESS something solid blocks
  //      the body column just above (furniture / wall) or they sit beyond the
  //      radius (a real hole or unscanned void, left untouched).
  applyFloorPlane(plane, { fillRadius = 2, bodyHeightSlabs = this.headroomSlabs } = {}) {
    this.floorPlane = plane || null;
    if (!plane) {
      this.floorPlaneRefY = null;
      this.floorDirty = true;
      this.standGen += 1;
      this.revision += 1;
      return;
    }

    // Floor reference height = the plane at the observed centroid.
    let sx = 0; let sz = 0; let nc = 0;
    for (const cell of this.cells.values()) {
      sx += this.centerX(cell.cx); sz += this.centerZ(cell.cz); nc += 1;
    }
    this.floorPlaneRefY = plane.heightAt(nc ? sx / nc : 0, nc ? sz / nc : 0);

    const planeSlabAt = (cx, cz) => this.slabOf(plane.heightAt(this.centerX(cx), this.centerZ(cz)));

    // Seeds: observed cells that carry a floor voxel in the plane's slab.
    const seeds = [];
    for (const cell of this.cells.values()) {
      if (this.hasSlab(cell, planeSlabAt(cell.cx, cell.cz))) seeds.push([cell.cx, cell.cz]);
    }

    // Bounded dilation of the observed floor.
    const done = new Set();
    for (const [scx, scz] of seeds) {
      for (let dz = -fillRadius; dz <= fillRadius; dz += 1) {
        for (let dx = -fillRadius; dx <= fillRadius; dx += 1) {
          const cx = scx + dx; const cz = scz + dz;
          const key = cellKey(cx, cz);
          if (done.has(key)) continue;
          done.add(key);
          const slab = planeSlabAt(cx, cz);
          if (slab < 0 || slab >= this.slabCount) continue;
          const cell = this.cells.get(key);
          if (cell) {
            if (this.hasSlab(cell, slab)) continue; // already floor here
            if (this.solidInBand(cell, slab + 1, bodyHeightSlabs)) continue; // under something
          }
          this.addSyntheticFloor(cx, cz, slab);
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
  levels(cx, cz) {
    const cell = this.getCell(cx, cz);
    if (!cell) return [];
    const ceiling = this.standCeilingY();
    if (cell.levels && cell.levelsGen === this.standGen) return cell.levels;

    const levels = [];
    for (let slab = 0; slab < this.slabCount; slab += 1) {
      if (!this.hasSlab(cell, slab)) continue;
      // Too high above the floor to be anywhere a small character could get.
      if (this.slabTopY(slab) > ceiling) break;
      // The body height must fit, and it must fit inside the mapped band —
      // otherwise the top of a wall reads as a ledge you could stand on.
      if (slab + this.headroomSlabs >= this.slabCount) break;
      let clear = true;
      for (let above = 1; above <= this.headroomSlabs; above += 1) {
        if (this.hasSlab(cell, slab + above)) {
          clear = false;
          break;
        }
      }
      if (clear) levels.push(this.slabTopY(slab));
    }
    cell.levels = levels;
    cell.levelsGen = this.standGen;
    return levels;
  }

  isWalkable(cx, cz) {
    return this.levels(cx, cz).length > 0;
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
    const floorY = floorSlab === null ? null : this.slabTopY(floorSlab);

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

          const jump = Math.abs(rise) > this.maxStepUp;
          // Climbing is charged double its height, dropping half: coming down
          // must always look like the easy direction.
          const jumpCost = jump
            ? 0.6 + (rise > 0 ? rise * 2 : Math.abs(rise) * 0.5)
            : 0;
          // Toll for walking above the floor, per step and proportional to
          // altitude. This is what turns table-chair-table routes into
          // table-floor-table ones without forbidding furniture outright.
          const heightToll = floorY === null
            ? 0
            : Math.max(0, levels[level] - floorY - this.slabHeight / 2) * 0.8;
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
