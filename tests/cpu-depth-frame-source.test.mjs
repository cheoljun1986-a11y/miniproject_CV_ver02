import test from 'node:test';
import assert from 'node:assert/strict';

import { CpuDepthFrameSource } from '../src/cpu-depth-frame-source.js';

test('returns one cached snapshot when two consumers read the same XRFrame', () => {
  let viewerPoseCalls = 0;
  let depthCalls = 0;
  const view = { eye: 'none' };
  const depthInformation = { width: 160, height: 120 };
  const frame = {
    getViewerPose() {
      viewerPoseCalls += 1;
      return { views: [view] };
    },
    getDepthInformation(receivedView) {
      assert.equal(receivedView, view);
      depthCalls += 1;
      return depthInformation;
    },
  };
  const session = { depthUsage: 'cpu-optimized', depthDataFormat: 'float32' };
  const source = new CpuDepthFrameSource({ getSession: () => session });

  const first = source.read(frame, {});
  const second = source.read(frame, {});

  assert.equal(first, second);
  assert.equal(viewerPoseCalls, 1);
  assert.equal(depthCalls, 1);
  assert.deepEqual(first.views, [{ view, depthInformation }]);
  assert.equal(first.usage, 'cpu-optimized');
  assert.equal(first.format, 'float32');
});

test('reads a fresh depth snapshot when XRFrame changes', () => {
  let depthCalls = 0;
  const view = {};
  const makeFrame = () => ({
    getViewerPose: () => ({ views: [view] }),
    getDepthInformation: () => {
      depthCalls += 1;
      return { frameNumber: depthCalls };
    },
  });
  const source = new CpuDepthFrameSource();

  const first = source.read(makeFrame(), {});
  const second = source.read(makeFrame(), {});

  assert.notEqual(first, second);
  assert.equal(depthCalls, 2);
});

test('keeps successful views when another view throws during depth lookup', () => {
  const failingView = { eye: 'left' };
  const workingView = { eye: 'right' };
  const depthInformation = { width: 10, height: 10 };
  const frame = {
    getViewerPose: () => ({ views: [failingView, workingView] }),
    getDepthInformation(view) {
      if (view === failingView) throw new Error('depth unavailable');
      return depthInformation;
    },
  };

  const snapshot = new CpuDepthFrameSource().read(frame, {});

  assert.deepEqual(snapshot.views, [{ view: workingView, depthInformation }]);
});

test('returns an empty diagnostic snapshot when CPU depth is unavailable', () => {
  const session = { depthUsage: undefined, depthDataFormat: undefined };
  const source = new CpuDepthFrameSource({ getSession: () => session });

  const snapshot = source.read({}, {});

  assert.equal(snapshot.viewerPose, null);
  assert.deepEqual(snapshot.views, []);
  assert.equal(snapshot.usage, null);
  assert.equal(snapshot.format, null);
});

test('reset forgets the cached frame so a reused frame is read again', () => {
  let calls = 0;
  const view = {};
  const frame = {
    getViewerPose: () => ({ views: [view] }),
    getDepthInformation: () => { calls += 1; return {}; },
  };
  const source = new CpuDepthFrameSource();
  source.read(frame, {});

  source.reset();
  source.read(frame, {});

  assert.equal(calls, 2);
});
