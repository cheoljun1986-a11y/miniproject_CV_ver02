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

test('guide states the project boundary and avoids the baseline misconception', async () => {
  const html = await readFile(guideUrl, 'utf8');
  assert.match(html, /ARCore[^<]{0,120}(포즈|pose)[^<]{0,120}(깊이|depth)/i);
  assert.match(html, /(우리 코드|애플리케이션)[^<]{0,160}(역투영|unprojection)/i);
  assert.match(html, /(카메라|시각)[^<]{0,100}IMU[^<]{0,120}(결합|융합)/i);
  assert.doesNotMatch(html, /가속도계가 베이스라인을 (정확히 )?(알려|측정)/);
  for (const term of [
    'RANSAC', 'Essential', '삼각측량', 'PnP', 'Bundle Adjustment',
    '포인트클라우드', '복셀', 'TSDF', '앵커',
  ]) assert.ok(html.includes(term), `missing ${term}`);
});

test('guide links all primary sources', async () => {
  const html = await readFile(guideUrl, 'utf8');
  for (const id of [
    '1MGXIs_wamT0Bhyl4y90_EjwmdDpj4R-Y',
    '16jv_HBdVUVJE9yNAc915k0pQfEy9Z0Fn',
    '1K-hp8RfPbj2S26TGE-ThItWTGe2MhtER',
  ]) assert.ok(html.includes(id), `missing Drive source ${id}`);
  assert.ok(html.includes('developers.google.com/ar/develop/depth'));
  assert.ok(html.includes('developers.google.com/ar/develop/fundamentals'));
  assert.ok(html.includes('immersive-web.github.io/webxr/spatial-tracking-explainer'));
});

test('guide supports keyboard presentation and expandable technical notes', async () => {
  const html = await readFile(guideUrl, 'utf8');
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) {
    assert.ok(html.includes(key), `missing keyboard control ${key}`);
  }
  assert.ok((html.match(/<details\b/g) ?? []).length >= 10, 'needs at least 10 technical notes');
  assert.ok((html.match(/<svg\b/g) ?? []).length >= 10, 'needs at least 10 explanatory diagrams');
  assert.match(html, /@media \(max-width:\s*700px\)/);
});
