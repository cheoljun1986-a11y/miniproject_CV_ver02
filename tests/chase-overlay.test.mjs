import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const threeStubUrl = new URL('./support/three-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: threeStubUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { ChaseOverlay } = await import('../src/chase-overlay.js');

function scene() {
  const added = [];
  return { add: (o) => added.push(o), remove: () => {}, added };
}

const tile = (x, z, y = 0, extra = {}) => ({
  cx: Math.round(x / 0.2), cz: Math.round(z / 0.2), level: 0,
  position: [x, y, z], walkable: true, ...extra,
});

function rig(options = {}) {
  const overlay = new ChaseOverlay({ scene: scene(), ...options });
  overlay.setVisible(true);
  return overlay;
}

test('a hidden overlay draws nothing and does not walk the tiles', () => {
  const overlay = new ChaseOverlay({ scene: scene() });
  assert.equal(overlay.isVisible(), false);
  assert.equal(overlay.setTiles([tile(0, 0)], 1, {}), 0);
  assert.equal(overlay.mesh.count, 0);
});

test('walkable, blocked and unreachable tiles get distinct colours', () => {
  const overlay = rig();
  overlay.setTiles([
    tile(0, 0),
    tile(0.2, 0, 0, { walkable: false }),
    tile(0.4, 0, 0, { reachable: false }),
  ], 1, {});
  assert.equal(overlay.mesh.count, 3);
  const [walkable, blocked, unreachable] = overlay.mesh.colors;
  assert.ok(walkable[1] > walkable[0], 'walkable reads green');
  assert.ok(blocked[0] > blocked[1], 'blocked reads red');
  assert.ok(unreachable[0] > 0.9 && unreachable[1] > 0.5 && unreachable[2] < 0.4, 'amber');
});

// The tiles live in map space; the character is drawn in render space. Drawing
// them in different spaces is the exact defect this overlay has to rule out.
test('tiles are drawn through the caller supplied map-to-render conversion', () => {
  const overlay = rig();
  overlay.setTiles([tile(1, 2, 0.5)], 1, {
    toRender: ([x, y, z]) => [x + 10, y, z],
  });
  assert.deepEqual(overlay.mesh.positionAt(0), [11, 0.5, 2]);
});

test('tiles beyond the radius are dropped and the nearest survive the cap', () => {
  const overlay = rig({ radiusM: 1.0, maxInstances: 2 });
  overlay.setTiles([
    tile(5, 0), // outside the radius
    tile(0.9, 0),
    tile(0.1, 0),
    tile(0.5, 0),
  ], 1, { cameraPosition: [0, 0, 0] });
  assert.equal(overlay.mesh.count, 2, 'radius drops one, the cap drops another');
  // Nearest first, so the cap sheds the far tile rather than an arbitrary one.
  assert.deepEqual(overlay.mesh.positionAt(0), [0.1, 0, 0]);
  assert.deepEqual(overlay.mesh.positionAt(1), [0.5, 0, 0]);
});

test('an unchanged revision skips the rebuild until the camera has moved', () => {
  const overlay = rig({ radiusM: 10 });
  const tiles = [tile(0, 0)];
  overlay.setTiles(tiles, 7, { cameraPosition: [0, 0, 0] });
  assert.equal(overlay.mesh.count, 1);

  // Same revision, camera barely moved: the tile list is not walked again.
  overlay.setTiles([...tiles, tile(0.2, 0)], 7, { cameraPosition: [0.05, 0, 0] });
  assert.equal(overlay.mesh.count, 1, 'still the previous build');

  // Far enough that the radius cull would pick a different set.
  overlay.setTiles([...tiles, tile(0.2, 0)], 7, { cameraPosition: [1, 0, 0] });
  assert.equal(overlay.mesh.count, 2);

  // A new revision always rebuilds.
  overlay.setTiles(tiles, 8, { cameraPosition: [1, 0, 0] });
  assert.equal(overlay.mesh.count, 1);
});

test('showing again forces a rebuild rather than reusing a stale frame', () => {
  const overlay = rig({ radiusM: 10 });
  overlay.setTiles([tile(0, 0)], 3, {});
  overlay.setVisible(false);
  overlay.clear();
  assert.equal(overlay.mesh.count, 0);
  overlay.setVisible(true);
  // Same revision as before: without the forced rebuild this would draw nothing.
  overlay.setTiles([tile(0, 0), tile(0.2, 0)], 3, {});
  assert.equal(overlay.mesh.count, 2);
});
