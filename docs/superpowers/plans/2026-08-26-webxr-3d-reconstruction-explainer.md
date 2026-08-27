# WebXR 3D Reconstruction Explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one presentation-ready Korean HTML file that teaches non-specialists how WebXR/ARCore turns camera pixels into world-space 3D reconstruction, with real numeric examples and expandable technical depth.

**Architecture:** A single standalone `webxr_3d_reconstruction_guide.html` contains semantic 16:9 sections, scoped CSS, inline SVG diagrams, and small inline JavaScript for navigation and step-by-step calculations. A focused Node test reads the HTML as text to guard narrative structure, exact example values, accuracy-critical wording, accessibility hooks, and source links; browser QA verifies runtime interaction and responsive layout.

**Tech Stack:** HTML5, CSS3, inline SVG, vanilla JavaScript, Node.js built-in test runner, bundled Chromium/Playwright for browser QA.

**Spec:** `docs/superpowers/specs/2026-08-26-webxr-3d-reconstruction-explainer-design.md`

## Global Constraints

- Create exactly one user-facing artifact at repository root: `webxr_3d_reconstruction_guide.html`.
- Keep HTML, CSS, SVG, and JavaScript in that file; do not add runtime dependencies or network requests.
- Do not modify the current game pages or WebXR runtime code.
- Use WebXR coordinates `+X right`, `+Y up`, `−Z forward`; explicitly distinguish the lecture-style CV convention `+Z forward`, `+y down`.
- Preserve the exact worked example: image `640×480`, `fx=fy=600px`, `cx=320px`, `cy=240px`, pixel `(440,300)`, depth `2.0m`, camera point `(0.4,−0.2,−2.0)m`, world point `(3.0,1.3,0.9)m`.
- State that ARCore supplies pose and depth while this application performs unprojection, world transformation, and spatial fusion.
- Explain metric motion as visual-inertial fusion, not as the accelerometer directly measuring the baseline.
- Support desktop presentation, `390×844` mobile reading, keyboard navigation, reduced motion, and print page breaks.

---

### Task 1: Semantic presentation shell and content contract

**Files:**
- Create: `tests/webxr-guide.test.mjs`
- Create: `webxr_3d_reconstruction_guide.html`

**Interfaces:**
- Consumes: the section order and accuracy rules in the approved spec.
- Produces: 16 `<section class="slide" id="...">` elements, a fixed progress control, previous/next buttons, and source-link placeholders that later tasks populate with complete content.

- [ ] **Step 1: Write the failing structural test**

```js
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
```

- [ ] **Step 2: Run the structural test and verify it fails**

Run:

```powershell
& 'C:\Users\cheol\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests/webxr-guide.test.mjs
```

Expected: FAIL with `ENOENT` for `webxr_3d_reconstruction_guide.html`.

- [ ] **Step 3: Create the minimal standalone presentation shell**

Create a complete HTML document with this semantic spine, repeating the section pattern for all 16 exact IDs from Step 1:

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>픽셀에서 월드까지 — WebXR 3D 공간 복원</title>
  <style>
    :root { --ink:#142033; --paper:#f7f9fc; --blue:#2563eb; --purple:#7c3aed; --orange:#ea7c1b; --green:#11956b; --red:#d33d4a; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; scroll-snap-type:y mandatory; }
    body { margin:0; color:var(--ink); background:var(--paper); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
    .slide { min-height:100svh; scroll-snap-align:start; padding:clamp(28px,5vw,72px); display:grid; align-content:center; }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } *, *::before, *::after { animation:none!important; transition:none!important; } }
    @media print { .slide { min-height:auto; break-after:page; } .presentation-nav { display:none; } }
  </style>
</head>
<body>
  <main id="deck">
    <section class="slide" id="distance-problem" aria-labelledby="title-distance"><h1 id="title-distance">한 장의 사진에는 거리가 없다</h1></section>
    <section class="slide" id="three-spaces"><h2>이미지·카메라·월드 좌표는 서로 다른 주소다</h2></section>
    <section class="slide" id="world-ruler"><h2>월드 좌표는 방에 놓는 가상의 자다</h2></section>
    <section class="slide" id="camera-intrinsics"><h2>K가 픽셀을 카메라 광선으로 바꾼다</h2></section>
    <section class="slide" id="camera-point"><h2>방향과 깊이를 합치면 카메라 3D 점이 된다</h2></section>
    <section class="slide" id="world-transform"><h2>카메라 포즈를 곱하면 월드 주소가 된다</h2></section>
    <section class="slide" id="my-coordinate"><h2>내 좌표와 월드 좌표는 서로 왕복할 수 있다</h2></section>
    <section class="slide" id="triangulation"><h2>움직인 카메라는 두 눈처럼 깊이를 만든다</h2></section>
    <section class="slide" id="vio-scale"><h2>시각 정보와 IMU가 미터 단위 포즈를 만든다</h2></section>
    <section class="slide" id="traditional-sfm"><h2>전통적 SfM은 카메라와 구조를 함께 복원한다</h2></section>
    <section class="slide" id="responsibility-boundary"><h2>ARCore와 우리 코드의 책임은 다르다</h2></section>
    <section class="slide" id="point-cloud"><h2>월드 점을 누적하면 포인트클라우드가 된다</h2></section>
    <section class="slide" id="voxel-tsdf"><h2>복셀과 TSDF가 노이즈를 표면으로 정리한다</h2></section>
    <section class="slide" id="anchors"><h2>좌표값 저장과 현실 장소 추적은 다르다</h2></section>
    <section class="slide" id="failure-cases"><h2>깊이가 실패하는 장면은 미리 예측할 수 있다</h2></section>
    <section class="slide" id="summary"><h2>픽셀에서 월드까지 한 문장으로 연결된다</h2></section>
  </main>
  <nav class="presentation-nav" aria-label="발표 장 이동">
    <button id="prev-slide" type="button">이전</button>
    <span id="slide-progress" aria-live="polite">1 / 16</span>
    <button id="next-slide" type="button">다음</button>
  </nav>
  <script>
    const slides = [...document.querySelectorAll('.slide')];
    let current = 0;
    function goToSlide(index) {
      current = Math.max(0, Math.min(slides.length - 1, index));
      slides[current].scrollIntoView({ behavior:'smooth', block:'start' });
      document.getElementById('slide-progress').textContent = `${current + 1} / ${slides.length}`;
    }
    document.getElementById('prev-slide').addEventListener('click', () => goToSlide(current - 1));
    document.getElementById('next-slide').addEventListener('click', () => goToSlide(current + 1));
  </script>
</body>
</html>
```

- [ ] **Step 4: Run the structural test and verify it passes**

Run the command from Step 2.

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the shell and test**

```powershell
git add -- webxr_3d_reconstruction_guide.html tests/webxr-guide.test.mjs
git commit -m "feat: scaffold WebXR reconstruction explainer"
```

---

### Task 2: Numeric coordinate walkthrough and interactive diagrams

**Files:**
- Modify: `webxr_3d_reconstruction_guide.html`
- Modify: `tests/webxr-guide.test.mjs`

**Interfaces:**
- Consumes: the Task 1 section IDs and `goToSlide(index)` navigation.
- Produces: `window.GuideMath.pixelToCamera(input)`, `window.GuideMath.cameraToWorld(point, matrix)`, and step controls with `[data-example-step]` that update `#example-result`.

- [ ] **Step 1: Add failing tests for exact values and coordinate conventions**

Append:

```js
test('guide contains the exact worked coordinate example', async () => {
  const html = await readFile(guideUrl, 'utf8');
  for (const value of ['640 × 480', 'fx = fy = 600 px', '(440, 300)', '2.0 m', '(0.4, −0.2, −2.0) m', '(3.0, 1.3, 0.9) m']) {
    assert.ok(html.includes(value), `missing ${value}`);
  }
  assert.match(html, /\+X[^<]*오른쪽/);
  assert.match(html, /\+Y[^<]*위/);
  assert.match(html, /−Z[^<]*앞/);
  assert.match(html, /CV 좌표계[^<]*\+Z/);
  assert.match(html, /window\.GuideMath/);
  assert.match(html, /data-example-step="pixel"/);
  assert.match(html, /id="example-result"[^>]*aria-live="polite"/);
});
```

- [ ] **Step 2: Run tests and verify the new test fails**

Run the Task 1 test command.

Expected: the structural tests PASS and `guide contains the exact worked coordinate example` FAILS.

- [ ] **Step 3: Implement scenes 1–8 and the exact math functions**

Fill `distance-problem` through `triangulation` with one large inline SVG per scene, short audience-facing copy, and `<details><summary>숫자로 확인</summary>…</details>` for equations. Define the calculation API exactly as follows:

```js
window.GuideMath = Object.freeze({
  pixelToCamera({ u, v, depth, fx, fy, cx, cy }) {
    return {
      x: ((u - cx) / fx) * depth,
      y: -((v - cy) / fy) * depth,
      z: -depth,
    };
  },
  cameraToWorld({ x, y, z }, m) {
    return {
      x: m[0] * x + m[4] * y + m[8] * z + m[12],
      y: m[1] * x + m[5] * y + m[9] * z + m[13],
      z: m[2] * x + m[6] * y + m[10] * z + m[14],
    };
  },
});
```

Use the exact column-major camera-to-world matrix below so `cameraToWorld({x:0.4,y:-0.2,z:-2}, matrix)` returns `{x:3,y:1.3,z:0.9}`:

```js
const exampleMatrix = [
  0, 0, 1, 0,
  0, 1, 0, 0,
 -1, 0, 0, 0,
  1, 1.5, 0.5, 1,
];
```

Add five buttons with `data-example-step="pixel|ray|depth|world|accumulate"`. On click, update the active SVG layer, button `aria-pressed`, and one-line `#example-result` text.

- [ ] **Step 4: Run the tests and verify they pass**

Run the Task 1 test command.

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the coordinate walkthrough**

```powershell
git add -- webxr_3d_reconstruction_guide.html tests/webxr-guide.test.mjs
git commit -m "feat: add numeric camera-to-world walkthrough"
```

---

### Task 3: SfM, ARCore responsibility boundary, fusion, anchors, and sources

**Files:**
- Modify: `webxr_3d_reconstruction_guide.html`
- Modify: `tests/webxr-guide.test.mjs`

**Interfaces:**
- Consumes: Task 1 slide shell and Task 2 visual language.
- Produces: complete scenes 9–16, source links, accuracy-critical wording, and a final 30-second speech block.

- [ ] **Step 1: Add failing tests for content accuracy and sources**

Append:

```js
test('guide states the project boundary and avoids the baseline misconception', async () => {
  const html = await readFile(guideUrl, 'utf8');
  assert.match(html, /ARCore[^<]{0,120}(포즈|pose)[^<]{0,120}(깊이|depth)/i);
  assert.match(html, /(우리 코드|애플리케이션)[^<]{0,160}(역투영|unprojection)/i);
  assert.match(html, /(카메라|시각)[^<]{0,100}IMU[^<]{0,120}(결합|융합)/i);
  assert.doesNotMatch(html, /가속도계가 베이스라인을 (정확히 )?(알려|측정)/);
  for (const term of ['RANSAC', 'Essential', '삼각측량', 'PnP', 'Bundle Adjustment', '포인트클라우드', '복셀', 'TSDF', '앵커']) {
    assert.ok(html.includes(term), `missing ${term}`);
  }
});

test('guide links all primary sources', async () => {
  const html = await readFile(guideUrl, 'utf8');
  for (const id of ['1MGXIs_wamT0Bhyl4y90_EjwmdDpj4R-Y', '16jv_HBdVUVJE9yNAc915k0pQfEy9Z0Fn', '1K-hp8RfPbj2S26TGE-ThItWTGe2MhtER']) {
    assert.ok(html.includes(id), `missing Drive source ${id}`);
  }
  assert.ok(html.includes('developers.google.com/ar/develop/depth'));
  assert.ok(html.includes('developers.google.com/ar/develop/fundamentals'));
  assert.ok(html.includes('immersive-web.github.io/webxr/spatial-tracking-explainer'));
});
```

- [ ] **Step 2: Run tests and verify both new tests fail**

Run the Task 1 test command.

Expected: earlier tests PASS; both Task 3 tests FAIL.

- [ ] **Step 3: Implement scenes 9–16 with complete source-backed content**

Add these exact pipeline labels to the relevant SVGs:

```text
전통적 SfM: 특징점 → 대응점 → RANSAC(E/F) → 초기 포즈 → 삼각측량 → PnP → Bundle Adjustment
현재 프로젝트: ARCore(카메라 포즈 + 깊이맵) → 우리 코드(역투영 + 월드 변환 + 복셀/TSDF 융합)
```

Add a visible correction callout:

```text
가속도계가 이동거리 20cm를 혼자 재는 것이 아니다. 카메라 특징점과 IMU를 함께 융합해 미터 단위 포즈를 추정한다.
```

Add the final speech as audience-facing copy:

```text
카메라의 픽셀은 방향만 알려주고 깊이는 알려주지 않습니다. ARCore는 여러 시점의 영상과 IMU를 결합해 카메라 포즈와 픽셀별 깊이를 추정합니다. 저희 코드는 픽셀을 광선으로 역투영하고 깊이를 적용해 카메라 좌표를 만든 뒤, 촬영 순간의 포즈를 곱해 월드 좌표로 변환합니다. 여러 프레임의 월드 점을 복셀이나 TSDF로 융합하면 방의 3D 구조가 만들어집니다. 현실의 특정 위치를 오래 유지할 때는 좌표값만 저장하지 않고 앵커를 사용합니다.
```

Use complete source anchors with `target="_blank" rel="noreferrer"` for all six web/Drive sources in the spec.

- [ ] **Step 4: Run the tests and verify they pass**

Run the Task 1 test command.

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the complete technical narrative**

```powershell
git add -- webxr_3d_reconstruction_guide.html tests/webxr-guide.test.mjs
git commit -m "feat: complete WebXR reconstruction narrative"
```

---

### Task 4: Browser interaction, responsive layout, print, and final QA

**Files:**
- Modify: `webxr_3d_reconstruction_guide.html`
- Modify: `tests/webxr-guide.test.mjs`
- Create temporarily, then leave untracked: `.tmp/webxr-guide-qa.mjs`
- Create temporarily, then leave untracked: `.tmp/webxr-guide-desktop.png`
- Create temporarily, then leave untracked: `.tmp/webxr-guide-mobile.png`

**Interfaces:**
- Consumes: the complete HTML and `window.GuideMath` from Tasks 1–3.
- Produces: verified ArrowUp/ArrowDown/PageUp/PageDown/Home/End navigation, active slide tracking, responsive figures, print breaks, and browser-tested numeric output.

- [ ] **Step 1: Extend the static test for keyboard and semantic details**

Append:

```js
test('guide supports keyboard presentation and expandable technical notes', async () => {
  const html = await readFile(guideUrl, 'utf8');
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) assert.ok(html.includes(key));
  assert.ok((html.match(/<details\b/g) ?? []).length >= 10);
  assert.ok((html.match(/<svg\b/g) ?? []).length >= 10);
  assert.match(html, /@media \(max-width:\s*700px\)/);
});
```

- [ ] **Step 2: Run tests and verify the new QA test fails**

Run the Task 1 test command.

Expected: earlier tests PASS; `guide supports keyboard presentation and expandable technical notes` FAILS.

- [ ] **Step 3: Complete keyboard, observer, responsive, and print behavior**

Add keyboard mapping and active-slide observation:

```js
document.addEventListener('keydown', event => {
  if (event.target.closest('button, a, summary')) return;
  const moves = { ArrowDown:1, PageDown:1, ArrowUp:-1, PageUp:-1 };
  if (event.key in moves) { event.preventDefault(); goToSlide(current + moves[event.key]); }
  if (event.key === 'Home') { event.preventDefault(); goToSlide(0); }
  if (event.key === 'End') { event.preventDefault(); goToSlide(slides.length - 1); }
});

const observer = new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  current = slides.indexOf(visible.target);
  document.getElementById('slide-progress').textContent = `${current + 1} / ${slides.length}`;
}, { threshold:[0.55, 0.75] });
slides.forEach(slide => observer.observe(slide));
```

At `max-width:700px`, stack every split layout, remove forced `100svh` section height, and allow normal vertical reading. In print, hide controls, open essential technical content using print-visible duplicated blocks when closed `<details>` cannot be guaranteed, and apply `break-after:page` to slides.

- [ ] **Step 4: Run all static tests**

Run the Task 1 test command.

Expected: 6 tests PASS.

- [ ] **Step 5: Create and run browser QA at desktop and mobile sizes**

Write `.tmp/webxr-guide-qa.mjs` with the bundled Playwright package:

```js
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const target = pathToFileURL('C:/Users/cheol/OneDrive/Desktop/Data Scientist/miniproject_CV_ver02/webxr_3d_reconstruction_guide.html').href;
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto(target);
await page.click('[data-example-step="world"]');
const result = await page.locator('#example-result').textContent();
if (!result.includes('(3.0, 1.3, 0.9)')) throw new Error(`wrong example result: ${result}`);
await page.keyboard.press('End');
await page.waitForTimeout(300);
if (!(await page.locator('#slide-progress').textContent()).includes('16 / 16')) throw new Error('End key did not reach slide 16');
await page.screenshot({ path:'.tmp/webxr-guide-desktop.png', fullPage:true });
await page.setViewportSize({ width:390, height:844 });
await page.goto(target);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
if (overflow) throw new Error('mobile horizontal overflow');
await page.screenshot({ path:'.tmp/webxr-guide-mobile.png', fullPage:true });
if (errors.length) throw new Error(errors.join('\n'));
await browser.close();
```

Run with command-scoped bundled dependencies:

```powershell
$env:NODE_PATH='C:\Users\cheol\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& 'C:\Users\cheol\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .tmp/webxr-guide-qa.mjs
```

Expected: exit code 0 and both screenshots created.

- [ ] **Step 6: Inspect screenshots and correct visual defects**

Open `.tmp/webxr-guide-desktop.png` and `.tmp/webxr-guide-mobile.png`. Fix any clipped title, overlapping label, unreadable matrix, horizontal overflow, low contrast, or excessive blank space. Repeat Steps 4–5 until the screenshots are clean.

- [ ] **Step 7: Verify the numeric example independently**

Use this PowerShell calculation and compare all printed values with the HTML:

```powershell
$u=440; $v=300; $d=2.0; $fx=600; $fy=600; $cx=320; $cy=240
$x=(($u-$cx)/$fx)*$d; $y=-(($v-$cy)/$fy)*$d; $z=-$d
$wx=-$z+1.0; $wy=$y+1.5; $wz=$x+0.5
"camera=($x,$y,$z) world=($wx,$wy,$wz)"
```

Expected: `camera=(0.4,-0.2,-2) world=(3,1.3,0.9)`.

- [ ] **Step 8: Run final repository-scoped verification and commit**

```powershell
& 'C:\Users\cheol\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests/webxr-guide.test.mjs
git diff --check -- webxr_3d_reconstruction_guide.html tests/webxr-guide.test.mjs
git status --short
git add -- webxr_3d_reconstruction_guide.html tests/webxr-guide.test.mjs
git commit -m "feat: finish presentation-ready WebXR explainer"
```

Expected: 6 tests PASS, no `git diff --check` output, only the two requested files staged for the final commit, and unrelated user changes remain untouched.
