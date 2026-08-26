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

const { KeyframeCapture } = await import('../src/keyframe-capture.js');
const { KeyframeGate } = await import('../src/keyframe-gate.js');
const { KeyframeStore } = await import('../src/keyframe-store.js');

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function makeView(depth = 1.5, width = 4, height = 3) {
  let calls = 0;
  return {
    view: { projectionMatrix: IDENTITY, transform: { matrix: IDENTITY } },
    depthInformation: {
      width,
      height,
      getDepthInMeters() { calls += 1; return depth; },
      get calls() { return calls; },
    },
  };
}

function makeSource(views) {
  let reads = 0;
  return {
    read() { reads += 1; return { views }; },
    get reads() { return reads; },
  };
}

const pose = (x = 0) => ({ position: [x, 0, 0], quaternion: [0, 0, 0, 1], timeMs: x * 100 });

function rig({ views, maxKeyframes = 15, maxSamples = 40000 } = {}) {
  const store = new KeyframeStore({ maxKeyframes });
  const gate = new KeyframeGate({ maxKeyframes, minGapMs: 0 });
  const depthSource = makeSource(views ?? [makeView()]);
  return { store, gate, depthSource, capture: new KeyframeCapture({ store, gate, depthSource, maxSamples }) };
}

test('a gated frame is captured at the depth buffer native resolution', () => {
  const { capture, store } = rig({ views: [makeView(1.5, 4, 3)] });
  assert.equal(capture.update({}, {}, 0, pose(0)), true);

  const keyframe = store.getKeyframes()[0];
  assert.equal(keyframe.width, 4);
  assert.equal(keyframe.height, 3);
  assert.equal(keyframe.stride, 1);
  assert.equal(keyframe.depths.length, 12);
  assert.ok(keyframe.depths.every((d) => Math.abs(d - 1.5) < 1e-6));
  assert.equal(keyframe.frameId, 1);
});

// Depth acquisition is not free, so it must not run on frames the pose gate
// would reject anyway.
test('depth is not read on frames the pose gate rejects', () => {
  const { capture, depthSource } = rig();
  capture.update({}, {}, 0, pose(0));
  assert.equal(depthSource.reads, 1);

  assert.equal(capture.update({}, {}, 10, pose(0.01)), false);
  assert.equal(depthSource.reads, 1, 'no extra depth read for a rejected pose');
});

// Both eyes of a stereo runtime would double observationCount without adding a
// viewpoint, which looks exactly like broken multi-view verification.
test('only the first view is captured', () => {
  const second = makeView(9.9, 4, 3);
  const { capture, store } = rig({ views: [makeView(1.5, 4, 3), second] });
  capture.update({}, {}, 0, pose(0));

  assert.equal(store.getCount(), 1);
  assert.equal(second.depthInformation.calls, 0);
});

test('an oversized buffer is strided down and reports its effective size', () => {
  const { capture, store } = rig({ views: [makeView(1.5, 100, 100)], maxSamples: 1000 });
  capture.update({}, {}, 0, pose(0));

  const keyframe = store.getKeyframes()[0];
  assert.ok(keyframe.stride > 1);
  assert.equal(keyframe.width * keyframe.height <= 1000, true);
  assert.equal(keyframe.depths.length, keyframe.width * keyframe.height);
});

test('a full store consumes neither a keyframe slot nor the pose baseline', () => {
  const { capture, gate, store } = rig({ maxKeyframes: 1 });
  assert.equal(capture.update({}, {}, 0, pose(0)), true);
  assert.equal(gate.getCount(), 1);

  // Gate cap and store cap are both 1, so raise the gate cap to isolate the store.
  gate.maxKeyframes = 5;
  assert.equal(capture.update({}, {}, 10, pose(1)), false);
  assert.equal(gate.getCount(), 1, 'a rejected store must not advance the gate');
  assert.equal(store.getCount(), 1);
});

test('a missing viewer pose or depth information captures nothing', () => {
  const { capture, store } = rig();
  assert.equal(capture.update({}, {}, 0, null), false);

  const empty = rig({ views: [] });
  assert.equal(empty.capture.update({}, {}, 0, pose(0)), false);
  assert.equal(empty.store.getCount(), 0);
  assert.equal(store.getCount(), 0);
});

// The opening frames of a session arrive before ARCore has a depth map. Letting
// an all-zero grid through burns a keyframe slot and reports a whole
// keyframe's worth of rejected samples.
test('a keyframe with no usable depth is discarded entirely', () => {
  const blank = makeView(0, 4, 3);
  const { capture, store, gate } = rig({ views: [blank] });

  assert.equal(capture.update({}, {}, 0, pose(0)), false);
  assert.equal(store.getCount(), 0);
  assert.equal(gate.getCount(), 0, 'a blank capture must not consume a slot');
});
