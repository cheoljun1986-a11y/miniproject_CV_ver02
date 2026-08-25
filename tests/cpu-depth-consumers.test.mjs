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

const { CpuDepthFrameSource } = await import('../src/cpu-depth-frame-source.js');
const { CpuDepthOccluder } = await import('../src/cpu-depth-occluder.js');
const { DepthCloud } = await import('../src/depth-cloud.js');

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function makeDepthFrame({ depth = 1 } = {}) {
  const view = {
    projectionMatrix: IDENTITY,
    transform: { matrix: IDENTITY },
  };
  let depthCalls = 0;
  return {
    frame: {
      getViewerPose: () => ({ views: [view] }),
      getDepthInformation: () => {
        depthCalls += 1;
        return depth === null ? null : { getDepthInMeters: () => depth };
      },
    },
    getDepthCalls: () => depthCalls,
  };
}

function makeScene() {
  return { objects: [], add(object) { this.objects.push(object); } };
}

test('occlusion and voxel mapping share one depth lookup for the same XRFrame', () => {
  const source = new CpuDepthFrameSource();
  const scene = makeScene();
  const observed = [];
  const occluder = new CpuDepthOccluder({ scene, depthSource: source });
  const cloud = new DepthCloud({
    scene,
    depthSource: source,
    voxelMap: { observe(point) { observed.push(point); } },
    renderPoints: false,
  });
  const depthFrame = makeDepthFrame();

  occluder.update(depthFrame.frame, {}, 0);
  cloud.update(depthFrame.frame, {}, 0);

  assert.equal(depthFrame.getDepthCalls(), 1);
  assert.ok(occluder.getTriangleCount() > 0);
  assert.ok(observed.length > 0);
});

test('hides an occlusion mesh after the shared source has no fresh depth', () => {
  const source = new CpuDepthFrameSource();
  const occluder = new CpuDepthOccluder({ scene: makeScene(), depthSource: source });
  const first = makeDepthFrame();
  occluder.update(first.frame, {}, 0);
  assert.equal(occluder.mesh.visible, true);

  const missing = makeDepthFrame({ depth: null });
  occluder.update(missing.frame, {}, 251);

  assert.equal(occluder.mesh.visible, false);
  assert.equal(occluder.getTriangleCount(), 0);
});

test('renderPoints false skips raw point buffers while continuing voxel observations', () => {
  const observed = [];
  const cloud = new DepthCloud({
    scene: makeScene(),
    depthSource: new CpuDepthFrameSource(),
    voxelMap: { observe(point) { observed.push(point); } },
    renderPoints: false,
  });
  const depthFrame = makeDepthFrame();

  cloud.update(depthFrame.frame, {}, 0);

  assert.equal(cloud.geometry, null);
  assert.equal(cloud.positions, null);
  assert.equal(cloud.getCount(), 0);
  assert.ok(observed.length > 0);
});
