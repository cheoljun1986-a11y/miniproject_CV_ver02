// Where should Hachuping run next, and how does it get there.
//
// Two separate jobs:
//   chooseFleeTarget  — pick a destination worth running to
//   findPath          — find a legal route to it on the traversal grid
//
// Both are pure functions over a TraversalGrid so they can be unit-tested
// without a headset. findPath only walks grid edges, so a returned path can
// never teleport: every step is one adjacent cell.

import { nodeKey } from './traversal-grid.js';

function heuristic(grid, a, b) {
  const dx = (a.cx - b.cx) * grid.cellSize;
  const dz = (a.cz - b.cz) * grid.cellSize;
  return Math.hypot(dx, dz);
}

// A* over grid nodes. maxExpansions bounds the worst case so a chase never
// stalls the frame on a pathological map.
export function findPath(grid, start, goal, { maxExpansions = 4000 } = {}) {
  if (!start || !goal) return null;
  const startKey = nodeKey(start.cx, start.cz, start.level);
  const goalKey = nodeKey(goal.cx, goal.cz, goal.level);
  if (startKey === goalKey) return [start];

  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const nodes = new Map([[startKey, start]]);
  const open = [{ key: startKey, f: heuristic(grid, start, goal) }];
  const closed = new Set();
  let expansions = 0;

  while (open.length && expansions < maxExpansions) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (open[i].f < open[bestIndex].f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    if (closed.has(current.key)) continue;
    closed.add(current.key);
    expansions += 1;

    if (current.key === goalKey) {
      const path = [];
      let key = goalKey;
      while (key !== undefined) {
        path.push(nodes.get(key));
        key = cameFrom.get(key);
      }
      return path.reverse();
    }

    const node = nodes.get(current.key);
    for (const next of grid.neighbors(node)) {
      const key = nodeKey(next.cx, next.cz, next.level);
      if (closed.has(key)) continue;
      const tentative = gScore.get(current.key) + next.cost;
      if (tentative >= (gScore.get(key) ?? Infinity)) continue;
      gScore.set(key, tentative);
      cameFrom.set(key, current.key);
      nodes.set(key, next);
      open.push({ key, f: tentative + heuristic(grid, next, goal) });
    }
  }
  return null;
}

// Every node Hachuping can actually get to from where it stands.
//
// Geometry alone is not enough: the top of a 2m wall is a perfectly flat
// surface with clear air above it, so it reads as standable even though there
// is no way up. Flooding the graph once per retarget keeps those cells out of
// the running and stops the chase wasting replans on unreachable goals.
export function reachableFrom(grid, start, { maxNodes = 6000 } = {}) {
  const seen = new Set();
  if (!start) return seen;
  const startKey = nodeKey(start.cx, start.cz, start.level);
  seen.add(startKey);
  const queue = [start];
  let head = 0;
  while (head < queue.length && seen.size < maxNodes) {
    const node = queue[head];
    head += 1;
    for (const next of grid.neighbors(node)) {
      const key = nodeKey(next.cx, next.cz, next.level);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

// Straight-line distance between two nodes in world units.
function nodeDistance(grid, a, b) {
  const wa = grid.worldOf(a);
  const wb = grid.worldOf(b);
  if (!wa || !wb) return Infinity;
  return Math.hypot(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]);
}

// Score every reachable-looking cell and take the best.
//
// The recentVisits penalty is what stops Hachuping circling one spot: cells it
// passed through in the last few seconds score far lower, so it keeps being
// pushed toward ground it has not covered yet.
export function chooseFleeTarget(grid, {
  from,
  playerPosition = null,
  recentVisits = new Map(),
  now = 0,
  recentWindowMs = 15000,
  heading = null,
  minDistance = 1.5,
  maxDistance = 6.0,
  random = Math.random,
  sampleLimit = 4000,
  reachable = null,
} = {}) {
  if (!from) return null;
  const fromWorld = grid.worldOf(from);
  if (!fromWorld) return null;

  let best = null;
  let bestScore = -Infinity;
  let sampled = 0;

  for (const cell of grid.cells.values()) {
    if (sampled >= sampleLimit) break;
    const levels = grid.levels(cell.cx, cell.cz);
    if (!levels.length) continue;

    for (let level = 0; level < levels.length; level += 1) {
      sampled += 1;
      const candidate = { cx: cell.cx, cz: cell.cz, level };
      if (reachable && !reachable.has(nodeKey(cell.cx, cell.cz, level))) continue;
      const world = grid.worldOf(candidate);
      if (!world) continue;

      const travel = Math.hypot(world[0] - fromWorld[0], world[2] - fromWorld[2]);
      if (travel < minDistance) continue;

      let score = 0;

      // Farther from the player is better, but with diminishing returns so it
      // does not always sprint to the same far corner.
      if (playerPosition) {
        const away = Math.hypot(world[0] - playerPosition[0], world[2] - playerPosition[2]);
        score += Math.min(away, 8) * 1.0;
      }

      // Do not pick somewhere it just came from.
      const visitedAt = recentVisits.get(nodeKey(cell.cx, cell.cz, level));
      if (visitedAt !== undefined && now - visitedAt < recentWindowMs) {
        const freshness = 1 - (now - visitedAt) / recentWindowMs;
        score -= 6.0 * freshness;
      }

      // Prefer carrying on roughly forwards over doubling back.
      if (heading) {
        const dx = world[0] - fromWorld[0];
        const dz = world[2] - fromWorld[2];
        const length = Math.hypot(dx, dz);
        if (length > 1e-6) {
          const dot = (dx / length) * heading[0] + (dz / length) * heading[1];
          score += dot * 1.6;
        }
      }

      // Long hauls start to look like teleporting.
      if (travel > maxDistance) score -= (travel - maxDistance) * 1.2;

      // Ground is where a small creature believably runs; furniture is the
      // exception. The old +0.8 bonus here kept Hachuping touring tabletops.
      if (level > 0) score -= 1.2;

      score += random() * 1.2;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best;
}

// Trim visit records that have aged out, so the map cannot grow forever.
export function pruneVisits(recentVisits, now, windowMs) {
  for (const [key, at] of recentVisits) {
    if (now - at >= windowMs) recentVisits.delete(key);
  }
  return recentVisits;
}

export { nodeDistance };
