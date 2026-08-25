import test from 'node:test';
import assert from 'node:assert/strict';

import * as cameraCopier from '../src/camera-texture-copier.js';

test('portrait camera frames keep their aspect ratio for hand inference', () => {
  assert.equal(typeof cameraCopier.fitInferenceSize, 'function');
  assert.deepEqual(cameraCopier.fitInferenceSize(1080, 1920, 320), {
    width: 180,
    height: 320,
  });
});

test('landscape camera frames keep their aspect ratio for hand inference', () => {
  assert.equal(typeof cameraCopier.fitInferenceSize, 'function');
  assert.deepEqual(cameraCopier.fitInferenceSize(1920, 1080, 320), {
    width: 320,
    height: 180,
  });
});
