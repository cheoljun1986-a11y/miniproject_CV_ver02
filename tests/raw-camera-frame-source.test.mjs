import test from 'node:test';
import assert from 'node:assert/strict';

import { RawCameraFrameSource } from '../src/raw-camera-frame-source.js';

function makeHarness({ bindingError = null, copyError = null } = {}) {
  const canvas = { kind: 'inference-canvas' };
  const copies = [];
  let disposed = false;
  const source = new RawCameraFrameSource({
    minIntervalMs: 100,
    bindingFactory() {
      if (bindingError) throw bindingError;
      return { getCameraImage: (camera) => ({ camera }) };
    },
    canvasFactory: () => canvas,
    textureCopierFactory: () => ({
      copy(texture, camera) {
        if (copyError) throw copyError;
        copies.push({ texture, camera });
      },
      dispose() { disposed = true; },
    }),
  });
  return { source, canvas, copies, wasDisposed: () => disposed };
}

function frameWithCamera(camera = { width: 640, height: 480 }) {
  return {
    getViewerPose: () => ({ views: [{ camera }] }),
  };
}

test('captures an aligned camera view into the inference canvas', () => {
  const { source, canvas, copies } = makeHarness();
  assert.equal(source.start({}, {}), true);
  assert.equal(source.capture(frameWithCamera(), {}, 0), canvas);
  assert.equal(copies.length, 1);
  assert.equal(source.getStatus().state, 'ready');
});

test('throttles camera copies without changing ready capability', () => {
  const { source, copies } = makeHarness();
  source.start({}, {});
  source.capture(frameWithCamera(), {}, 0);
  assert.equal(source.capture(frameWithCamera(), {}, 50), null);
  assert.equal(source.capture(frameWithCamera(), {}, 100), source.getCanvas());
  assert.equal(copies.length, 2);
  assert.equal(source.getStatus().state, 'ready');
});

test('reports unavailable binding without throwing into the render loop', () => {
  const { source } = makeHarness({ bindingError: new Error('binding missing') });
  assert.equal(source.start({}, {}), false);
  assert.equal(source.capture(frameWithCamera(), {}, 0), null);
  assert.deepEqual(source.getStatus(), {
    state: 'unavailable',
    detail: 'binding missing',
  });
});

test('waits for a camera view and recovers on a later frame', () => {
  const { source, canvas } = makeHarness();
  source.start({}, {});
  assert.equal(source.capture({ getViewerPose: () => ({ views: [{}] }) }, {}, 0), null);
  assert.equal(source.getStatus().state, 'waiting-camera');
  assert.equal(source.capture(frameWithCamera(), {}, 100), canvas);
  assert.equal(source.getStatus().state, 'ready');
});

test('contains texture copy errors and reset releases resources', () => {
  const { source, wasDisposed } = makeHarness({ copyError: new Error('copy failed') });
  source.start({}, {});
  assert.equal(source.capture(frameWithCamera(), {}, 0), null);
  assert.deepEqual(source.getStatus(), { state: 'error', detail: 'copy failed' });
  source.reset();
  assert.equal(wasDisposed(), true);
  assert.deepEqual(source.getStatus(), { state: 'idle', detail: null });
});
