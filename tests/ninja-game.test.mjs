import test from 'node:test';
import assert from 'node:assert/strict';

import { NinjaGame } from '../src/ninja-game.js';
import { SpatialMapper } from '../src/spatial-mapper.js';

function createHarness() {
  const statuses = [];
  const controls = [];
  const sceneObjects = [];
  const ui = {
    setStatus(value) { statuses.push(value); },
    setMessage() {},
    setControls(value) { controls.push(value); },
    flash() {},
  };
  const scene = {
    add(object) { sceneObjects.push(object); },
    remove(object) {
      const index = sceneObjects.indexOf(object);
      if (index >= 0) sceneObjects.splice(index, 1);
    },
  };
  const model = {
    createNinja() {
      return {
        position: {
          x: 0,
          y: 0,
          z: 0,
          set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
          },
        },
        quaternion: { identity() {} },
      };
    },
    revealNinja(object) { object.revealed = true; },
    disposeObject(object) { object.disposed = true; },
  };
  const mapper = new SpatialMapper({ minCandidateSpacing: 0.22 });
  const pose = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  };
  const game = new NinjaGame({
    scene,
    ui,
    mapper,
    model,
    getSession: () => ({}),
    getLocalSpace: () => ({}),
    getViewerPose: () => pose,
    now: () => 1000,
    random: () => 0,
  });

  return { game, mapper, statuses, controls, sceneObjects };
}

test('session start enters mapping with the existing control availability', () => {
  const { game, controls } = createHarness();
  game.startSession();

  assert.equal(game.getState().phase, 'mapping');
  assert.deepEqual(controls.at(-1), {
    scan: false,
    newRound: false,
    extend: true,
    mark: true,
    check: true,
  });
});

test('mapping candidates produce a hidden target that can be detected', () => {
  const { game, mapper, sceneObjects } = createHarness();
  game.startSession();
  for (const [index, position] of [[0, 0, -2], [0.3, 0, -2], [0.6, 0, -2]].entries()) {
    mapper.recordSurface({ position, matrix: [index], upY: 1 });
  }

  game.finishMapping();
  assert.equal(game.getState().phase, 'hunt');
  assert.equal(sceneObjects.length, 1);

  assert.equal(game.triggerScan(), true);
  assert.equal(game.getState().phase, 'found');
  assert.equal(sceneObjects[0].revealed, true);
});
