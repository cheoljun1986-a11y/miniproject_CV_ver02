import assert from 'node:assert/strict';
import test from 'node:test';

import { fitFloorPlane } from '../src/plane-fit.js';

// Deterministic RNG so the RANSAC sampling is reproducible in tests.
function mulberry32(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A regular xz grid of points at height y_of(x, z).
function planeGrid(yOf, nx = 20, nz = 20, step = 0.2) {
  const points = [];
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const x = i * step;
      const z = j * step;
      points.push([x, yOf(x, z), z]);
    }
  }
  return points;
}

test('fits a flat horizontal floor and reports its height', () => {
  const points = planeGrid(() => -1.4);
  const plane = fitFloorPlane(points, { rng: mulberry32(1) });
  assert.ok(plane, 'expected a plane');
  assert.ok(Math.abs(plane.heightAt(1, 1) - -1.4) < 1e-6);
  assert.ok(plane.inlierCount >= points.length * 0.9);
});

test('fits a gently tilted plane within the tilt limit', () => {
  const points = planeGrid((x) => -1.4 + 0.05 * x);
  const plane = fitFloorPlane(points, { rng: mulberry32(2) });
  assert.ok(plane, 'expected a plane');
  assert.ok(Math.abs(plane.heightAt(2, 0) - -1.3) < 1e-3);
});

test('rejects a vertical wall (no height field fits many points)', () => {
  // Several stacked columns: many y values share the same (x, z) footprint, so
  // no single y = f(x, z) plane can claim them.
  const points = [];
  for (const x of [0, 0.05]) {
    for (const z of [0, 0.05]) {
      for (let h = 0; h < 40; h += 1) points.push([x, h * 0.05, z]);
    }
  }
  const plane = fitFloorPlane(points, { rng: mulberry32(3), minInliers: 20 });
  assert.equal(plane, null);
});

test('rejects floater outliers and keeps the true floor height', () => {
  const points = planeGrid(() => -1.0);
  const noise = mulberry32(99);
  for (let i = 0; i < 30; i += 1) points.push([noise() * 4, 0.5 + noise(), noise() * 4]);
  const plane = fitFloorPlane(points, { rng: mulberry32(4) });
  assert.ok(plane, 'expected a plane');
  assert.ok(Math.abs(plane.heightAt(1, 1) - -1.0) < 1e-3);
});

test('locks onto the floor, ignoring a small tabletop', () => {
  const floor = planeGrid(() => -1.4, 20, 20); // 400 points
  const table = planeGrid(() => -0.4, 5, 5); // 25 points (below minInliers)
  const plane = fitFloorPlane([...floor, ...table], { rng: mulberry32(5) });
  assert.ok(plane, 'expected a plane');
  assert.ok(Math.abs(plane.heightAt(0, 0) - -1.4) < 1e-2, 'should lock onto the floor, not the table');
});

test('picks the LOWEST substantial plane, not the densest', () => {
  // A big dense surface up high and a smaller-but-substantial floor below it.
  const floor = planeGrid(() => -1.4, 12, 12); // 144 points
  const deck = planeGrid(() => -0.3, 20, 20); // 400 points, denser and higher
  const points = [...floor, ...deck];
  const lowest = fitFloorPlane(points, { rng: mulberry32(11), keepFraction: 0.3 });
  assert.ok(Math.abs(lowest.heightAt(0, 0) - -1.4) < 1e-2, 'lowest selection returns the floor');
  const dominant = fitFloorPlane(points, { rng: mulberry32(11), select: 'dominant' });
  assert.ok(Math.abs(dominant.heightAt(0, 0) - -0.3) < 1e-2, 'dominant selection returns the denser deck');
});

test('returns null when inliers fall below the minimum', () => {
  const points = planeGrid(() => -1.4, 3, 3); // 9 points
  const plane = fitFloorPlane(points, { rng: mulberry32(6), minInliers: 40 });
  assert.equal(plane, null);
});

test('rejects a plane steeper than maxTilt', () => {
  const points = planeGrid((x) => 2.0 * x); // slope 2 ≈ 63°
  const plane = fitFloorPlane(points, { rng: mulberry32(7), maxTiltDeg: 20 });
  assert.equal(plane, null);
});
