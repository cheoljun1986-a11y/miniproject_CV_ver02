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
  } = {}) {
    this.cellSize = cellSize;
    this.slabHeight = slabHeight;
    this.minY = minY;
    this.slabCount = Math.min(slabCount, 64); // two 32-bit masks per cell
    this.headroomSlabs = Math.max(1, Math.ceil(headroom / slabHeight));
    this.maxStepUp = maxStepUp;
    this.maxJumpUp = maxJumpUp;
    this.maxDropDown = maxDropDown;
    this.cells = new Map();
    this.revision = 0;
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
      cell = { cx, cz, lo: UNSEEN, hi: UNSEEN, levels: null };
      this.cells.set(key, cell);
    }

    if (slab < 32) {
      const bit = 1 << slab;
      if ((cell.lo & bit) !== 0) return false;
      cell.lo |= bit;
    } else {
      const bit = 1 << (slab - 32);
      if ((cell.hi & bit) !== 0) return false;
      cell.hi |= bit;
    }
    cell.levels = null; // recompute lazily
    this.revision += 1;
    return true;
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
    if (cell.levels) return cell.levels;

    const levels = [];
    for (let slab = 0; slab < this.slabCount; slab += 1) {
      if (!this.hasSlab(cell, slab)) continue;
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
  neighbors(node) {
    const fromY = this.levelY(node.cx, node.cz, node.level);
    if (fromY === null) return [];

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

        let bestLevel = -1;
        let bestRise = Infinity;
        for (let level = 0; level < levels.length; level += 1) {
          const rise = levels[level] - fromY;
          if (rise > this.maxJumpUp) continue;
          if (rise < -this.maxDropDown) continue;
          if (Math.abs(rise) < Math.abs(bestRise)) {
            bestRise = rise;
            bestLevel = level;
          }
        }
        if (bestLevel < 0) continue;

        const planar = Math.hypot(dx, dz) * this.cellSize;
        const jump = Math.abs(bestRise) > this.maxStepUp;
        out.push({
          cx: nx,
          cz: nz,
          level: bestLevel,
          rise: bestRise,
          distance: planar,
          move: jump ? MOVE.JUMP : MOVE.WALK,
          // Jumps are legal but should not be the casual choice.
          cost: planar + (jump ? 0.6 + Math.abs(bestRise) : 0),
        });
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
