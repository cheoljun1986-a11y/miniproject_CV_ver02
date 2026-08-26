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

const { VoxelDebugController } = await import('../src/voxel-debug-controller.js');
const { VOXEL_COLOR_MODES } = await import('../src/voxel-color-modes.js');

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function depthSource(depth = 1.5, width = 8, height = 6) {
  return {
    read() {
      return {
        views: [{
          view: { projectionMatrix: IDENTITY, transform: { matrix: IDENTITY } },
          depthInformation: { width, height, getDepthInMeters: () => depth },
        }],
      };
    },
  };
}

const pose = (x) => ({ position: [x, 0, 0], quaternion: [0, 0, 0, 1] });

// A fake clock so the debounce is deterministic.
function makeController(overrides = {}) {
  let clock = 0;
  const controller = new VoxelDebugController({
    depthSource: depthSource(),
    now: () => clock,
    ...overrides,
  });
  return { controller, tick: (ms) => { clock += ms; }, at: () => clock };
}

function scan(controller, count = 3) {
  controller.startScan(0);
  for (let i = 0; i < count; i += 1) {
    controller.update({}, {}, i * 1000, pose(i * 0.5));
  }
  controller.stopScan(count * 1000);
}

test('capture only happens inside the scan window', () => {
  const { controller } = makeController();
  assert.equal(controller.update({}, {}, 0, pose(0)), false, 'no scan started yet');

  controller.startScan(0);
  assert.equal(controller.update({}, {}, 0, pose(0)), true);
  assert.equal(controller.update({}, {}, 30000, pose(5)), false, 'scan window closed');
});

test('stopScan rebuilds exactly once', () => {
  const { controller } = makeController();
  scan(controller, 3);
  assert.equal(controller.getRebuildCount(), 1);
  assert.ok(controller.getCellCount() > 0);
});

// The threshold slider is a render-time filter. If it triggered a rebuild the
// Phase 2 experiment would stutter through every drag.
test('minObservations re-selects without rebuilding', () => {
  const { controller } = makeController();
  scan(controller, 3);
  const rebuilds = controller.getRebuildCount();
  const revision = controller.getRevision();

  const result = controller.setParam('minObservations', 3);
  assert.equal(result.needsRebuild, false);
  assert.equal(controller.getRebuildCount(), rebuilds, 'no rebuild');
  assert.ok(controller.getRevision() > revision, 'renderers still refresh');
  assert.ok(controller.getRenderCells().every((c) => c.observationCount >= 3));
});

test('voxelSize rebuilds, but only after the debounce elapses', () => {
  const { controller, tick } = makeController();
  scan(controller, 3);
  const rebuilds = controller.getRebuildCount();

  assert.equal(controller.setParam('voxelSize', 0.03).needsRebuild, true);
  assert.equal(controller.rebuildIfDirty(), false, 'still inside the debounce');
  assert.equal(controller.getRebuildCount(), rebuilds);

  tick(200);
  assert.equal(controller.rebuildIfDirty(), true);
  assert.equal(controller.getRebuildCount(), rebuilds + 1);
  assert.equal(controller.rebuildIfDirty(), false, 'not dirty any more');
});

test('a JSON round trip reproduces the grid and flags the import', () => {
  const { controller } = makeController();
  scan(controller, 3);
  const cells = controller.getCellCount();
  const json = controller.exportJSON();

  const fresh = makeController().controller;
  assert.equal(fresh.importJSON(json), true);
  assert.equal(fresh.getCellCount(), cells);
  assert.equal(fresh.isImported(), true);
});

test('a malformed import is refused and leaves the state intact', () => {
  const { controller } = makeController();
  scan(controller, 3);
  const cells = controller.getCellCount();

  assert.equal(controller.importJSON('not json'), false);
  assert.equal(controller.importJSON('{"version":99}'), false);
  assert.equal(controller.getCellCount(), cells);
  assert.equal(controller.isImported(), false);
});

test('the colour mode cycles and reset clears the scan', () => {
  const { controller } = makeController();
  scan(controller, 2);
  assert.equal(controller.getColorMode(), VOXEL_COLOR_MODES.OBSERVATION);
  assert.equal(controller.cycleColorMode(), VOXEL_COLOR_MODES.HEIGHT);

  controller.reset();
  assert.equal(controller.getCellCount(), 0);
  assert.equal(controller.getRenderCells().length, 0);
  assert.equal(controller.getStats(0).keyframeCount, 0);
});
