import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guideUrl = new URL('../webxr_3d_reconstruction_guide.html', import.meta.url);

test('guide has the complete 16-scene narrative', async () => {
  const html = await readFile(guideUrl, 'utf8');
  const slides = html.match(/<section\b[^>]*class="[^"]*\bslide\b[^"]*"/g) ?? [];
  assert.equal(slides.length, 16);
  for (const id of [
    'distance-problem', 'three-spaces', 'world-ruler', 'camera-intrinsics',
    'camera-point', 'world-transform', 'my-coordinate', 'triangulation',
    'vio-scale', 'traditional-sfm', 'responsibility-boundary', 'point-cloud',
    'voxel-tsdf', 'anchors', 'failure-cases', 'summary',
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test('guide exposes presentation controls and accessible progress', async () => {
  const html = await readFile(guideUrl, 'utf8');
  assert.match(html, /id="prev-slide"/);
  assert.match(html, /id="next-slide"/);
  assert.match(html, /id="slide-progress"[^>]*aria-live="polite"/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /@media print/);
});

test('guide contains the exact worked coordinate example', async () => {
  const html = await readFile(guideUrl, 'utf8');
  for (const value of [
    '640 × 480', 'fx = fy = 600 px', '(440, 300)', '2.0 m',
    '(0.4, −0.2, −2.0) m', '(3.0, 1.3, 0.9) m',
  ]) assert.ok(html.includes(value), `missing ${value}`);
  assert.match(html, /\+X[^<]*오른쪽/);
  assert.match(html, /\+Y[^<]*위/);
  assert.match(html, /−Z[^<]*앞/);
  assert.match(html, /CV 좌표계[^<]*\+Z/);
  assert.match(html, /window\.GuideMath/);
  assert.match(html, /data-example-step="pixel"/);
  assert.match(html, /id="example-result"[^>]*aria-live="polite"/);
});
