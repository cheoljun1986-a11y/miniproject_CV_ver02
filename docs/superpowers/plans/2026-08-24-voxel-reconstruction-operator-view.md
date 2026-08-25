# Voxel Reconstruction & Operator View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `?depth=cloud` mode, build a denoised voxel occupancy map from the depth point cloud and add a toggleable on-device operator (god's-eye) 3D view showing the reconstructed space, the hidden Ninja, and the player's path.

**Architecture:** Add two framework-free data modules (`VoxelMap`, `PlayerTrail`) that are unit-tested in Node, and one three.js overlay module (`OperatorView`) that renders a second WebGL scene onto a DOM-overlay canvas. `depth-cloud.js` feeds every reconstructed point into `VoxelMap`; `main.js` wires the toggle and per-frame data. Pure logic stays out of three.js/DOM, matching the existing module split.

**Tech Stack:** browser-native ES modules, three.js 0.180 (+ `three/addons/controls/OrbitControls.js`), WebXR `immersive-ar` with cpu-optimized depth-sensing, Node `node:test`. Static GitHub Pages, no bundler.

**Spec:** `docs/superpowers/specs/2026-08-24-voxel-reconstruction-operator-view-design.md`

## Global Constraints

- three.js pinned to `0.180.0` via the existing import map; only new addon allowed is `three/addons/controls/OrbitControls.js`.
- Pure modules (`voxel-map.js`, `player-trail.js`) must not import three.js, touch the DOM, or use WebXR globals, so their Node tests run without a browser.
- All positions are in the XR `local` reference space (same as the Ninja, viewer pose, and point cloud).
- Feature applies only in `?depth=cloud` (cpu depth) mode; the default gpu-occlusion mode and all game rules stay unchanged.
- Voxel size is `0.05` m (5 cm), matching the existing point-cloud dedup.
- Keep `index.html` at repo root; browser-native modules and relative URLs only.
- Run the full suite with `node --test tests/*.test.mjs`; syntax-check three/DOM modules with `node --check <file>` (does not resolve imports).
- Phase 2 (game-view voxel occluder) is a separate future plan; this plan is Phase 1 only.

---

### Task 1: VoxelMap (framework-free occupancy)

**Files:**
- Create: `src/voxel-map.js`
- Test: `tests/voxel-map.test.mjs`

**Interfaces:**
- Consumes: `voxelKey(x, y, z, size)` from `src/depth-math.js` (existing).
- Produces:
  - `new VoxelMap({ voxelSize = 0.05, solidMinHits = 3, maxSolid = 20000 })`
  - `observe([x, y, z]) -> boolean` (true when this call makes the voxel newly solid)
  - `getSolidVoxels() -> Array<{ position: [number, number, number], colorT: number }>`
  - `getSolidCount() -> number`
  - `reset() -> void`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/voxel-map.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { VoxelMap } from '../src/voxel-map.js';

test('a voxel becomes solid only after reaching the hit threshold', () => {
  const map = new VoxelMap({ voxelSize: 0.05, solidMinHits: 3 });
  assert.equal(map.observe([0.01, 0.01, 0.01]), false); // 1
  assert.equal(map.observe([0.02, 0.02, 0.02]), false); // 2 (same cell)
  assert.equal(map.observe([0.0, 0.0, 0.0]), true); // 3 -> solid
  assert.equal(map.observe([0.03, 0.0, 0.0]), false); // 4, already solid
  assert.equal(map.getSolidCount(), 1);
});

test('distinct cells are tracked separately and solids report centered positions', () => {
  const map = new VoxelMap({ voxelSize: 0.1, solidMinHits: 1 });
  map.observe([0.0, 0.0, 0.0]);
  map.observe([0.35, 0.0, 0.0]);
  assert.equal(map.getSolidCount(), 2);
  const positions = map.getSolidVoxels().map((v) => v.position[0]).sort((a, b) => a - b);
  assert.deepEqual(positions, [0.05, 0.35]); // cell centers at (floor+0.5)*size
});

test('solid list is capped by maxSolid', () => {
  const map = new VoxelMap({ voxelSize: 0.1, solidMinHits: 1, maxSolid: 1 });
  map.observe([0.0, 0.0, 0.0]);
  assert.equal(map.observe([0.5, 0.0, 0.0]), false); // capped, not added
  assert.equal(map.getSolidCount(), 1);
});

test('reset clears counts and solids', () => {
  const map = new VoxelMap({ solidMinHits: 1 });
  map.observe([0, 0, 0]);
  map.reset();
  assert.equal(map.getSolidCount(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/voxel-map.test.mjs`
Expected: FAIL — cannot find module `../src/voxel-map.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/voxel-map.js
import { voxelKey } from './depth-math.js';

// Observation-counted voxel occupancy. A voxel is reported "solid" only once it
// has been seen solidMinHits times, which filters out stray one-off depth
// noise. Framework-free so it can be unit-tested directly.
export class VoxelMap {
  constructor({ voxelSize = 0.05, solidMinHits = 3, maxSolid = 20000 } = {}) {
    this.voxelSize = voxelSize;
    this.solidMinHits = solidMinHits;
    this.maxSolid = maxSolid;
    this.counts = new Map();
    this.solid = new Map();
  }

  observe([x, y, z]) {
    const key = voxelKey(x, y, z, this.voxelSize);
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    if (next !== this.solidMinHits) return false;
    if (this.solid.size >= this.maxSolid) return false;

    const size = this.voxelSize;
    const center = [
      (Math.floor(x / size) + 0.5) * size,
      (Math.floor(y / size) + 0.5) * size,
      (Math.floor(z / size) + 0.5) * size,
    ];
    const colorT = Math.min(1, Math.max(0, (center[1] + 1) / 3));
    this.solid.set(key, { position: center, colorT });
    return true;
  }

  getSolidVoxels() {
    return Array.from(this.solid.values());
  }

  getSolidCount() {
    return this.solid.size;
  }

  reset() {
    this.counts.clear();
    this.solid.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/voxel-map.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voxel-map.js tests/voxel-map.test.mjs
git commit -m "Add VoxelMap occupancy with hit-threshold denoising"
```

---

### Task 2: PlayerTrail (framework-free path buffer)

**Files:**
- Create: `src/player-trail.js`
- Test: `tests/player-trail.test.mjs`

**Interfaces:**
- Produces:
  - `new PlayerTrail({ minStep = 0.15, maxPoints = 300 })`
  - `record([x, y, z]) -> boolean` (true when the point was appended)
  - `getPoints() -> Array<[number, number, number]>` (oldest first, copies)
  - `reset() -> void`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/player-trail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { PlayerTrail } from '../src/player-trail.js';

test('records the first point and then only steps beyond minStep', () => {
  const trail = new PlayerTrail({ minStep: 0.1, maxPoints: 10 });
  assert.equal(trail.record([0, 0, 0]), true);
  assert.equal(trail.record([0.05, 0, 0]), false); // below minStep
  assert.equal(trail.record([0.2, 0, 0]), true);
  assert.deepEqual(trail.getPoints(), [[0, 0, 0], [0.2, 0, 0]]);
});

test('caps length by dropping the oldest point', () => {
  const trail = new PlayerTrail({ minStep: 0.1, maxPoints: 2 });
  trail.record([0, 0, 0]);
  trail.record([1, 0, 0]);
  trail.record([2, 0, 0]);
  assert.deepEqual(trail.getPoints(), [[1, 0, 0], [2, 0, 0]]);
});

test('reset empties the trail', () => {
  const trail = new PlayerTrail({});
  trail.record([0, 0, 0]);
  trail.reset();
  assert.deepEqual(trail.getPoints(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/player-trail.test.mjs`
Expected: FAIL — cannot find module `../src/player-trail.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/player-trail.js
// Distance-gated, fixed-capacity buffer of viewer positions for the operator
// view's path line. Framework-free and unit-tested.
export class PlayerTrail {
  constructor({ minStep = 0.15, maxPoints = 300 } = {}) {
    this.minStep = minStep;
    this.maxPoints = maxPoints;
    this.points = [];
  }

  record([x, y, z]) {
    const last = this.points[this.points.length - 1];
    if (last) {
      const step = Math.hypot(x - last[0], y - last[1], z - last[2]);
      if (step <= this.minStep) return false;
    }
    this.points.push([x, y, z]);
    if (this.points.length > this.maxPoints) this.points.shift();
    return true;
  }

  getPoints() {
    return this.points.map((point) => [...point]);
  }

  reset() {
    this.points = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/player-trail.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/player-trail.js tests/player-trail.test.mjs
git commit -m "Add PlayerTrail distance-gated path buffer"
```

---

### Task 3: Expose the hidden Ninja position

**Files:**
- Modify: `src/ninja-game.js` (add one method near `getState`)
- Test: `tests/ninja-game.test.mjs` (add one test)

**Interfaces:**
- Produces on `NinjaGame`: `getTargetPosition() -> [number, number, number] | null`

- [ ] **Step 1: Write the failing test**

Append to `tests/ninja-game.test.mjs`:

```javascript
test('getTargetPosition returns the hidden position while hunting and null otherwise', () => {
  const { game, mapper } = createHarness();
  assert.equal(game.getTargetPosition(), null);
  game.startSession();
  for (const [index, position] of [[0, 0, -2], [0.3, 0, -2], [0.6, 0, -2]].entries()) {
    mapper.recordSurface({ position, matrix: [index], upY: 1 });
  }
  game.finishMapping();
  const target = game.getTargetPosition();
  assert.ok(Array.isArray(target) && target.length === 3);
  game.endSession();
  assert.equal(game.getTargetPosition(), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ninja-game.test.mjs`
Expected: FAIL — `game.getTargetPosition is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/ninja-game.js`, add this method immediately before `getState()`:

```javascript
  getTargetPosition() {
    return this.target ? this.target.position.slice() : null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ninja-game.test.mjs`
Expected: PASS (all ninja-game tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/ninja-game.js tests/ninja-game.test.mjs
git commit -m "Expose hidden Ninja position for the operator view"
```

---

### Task 4: Feed reconstructed points into VoxelMap

**Files:**
- Modify: `src/depth-cloud.js` (constructor + `sampleView`)

**Interfaces:**
- Consumes: `VoxelMap.observe(point)` (Task 1).
- Produces: `new DepthCloud({ scene, voxelMap })` — `voxelMap` optional; when present, every reconstructed world point is also observed by it.

- [ ] **Step 1: Modify the constructor to accept a VoxelMap**

In `src/depth-cloud.js`, change the constructor signature and store the map:

```javascript
  constructor({ scene, voxelMap = null }) {
    this.scene = scene;
    this.voxelMap = voxelMap;
    this.lastSampleTime = -Infinity;
    // ...rest unchanged
```

- [ ] **Step 2: Observe each reconstructed point**

In `sampleView`, where the point is currently added, feed the voxel map first:

```javascript
        const point = depthSampleToWorld(u, v, depth, invProjection, viewMatrix);
        if (!point) continue;
        this.voxelMap?.observe(point);
        this.addPoint(point);
```

- [ ] **Step 3: Syntax-check and run the full suite**

Run: `node --check src/depth-cloud.js && node --test tests/*.test.mjs`
Expected: no syntax error; all existing tests still pass (DepthCloud is three-coupled and not directly unit-tested; regression suite must stay green).

- [ ] **Step 4: Commit**

```bash
git add src/depth-cloud.js
git commit -m "Feed reconstructed depth points into the voxel map"
```

---

### Task 5: Operator overlay DOM + UI toggle

**Files:**
- Modify: `index.html` (add overlay canvas + operator button)
- Modify: `src/ui.js` (query new elements, bind toggle, expose visibility control)

**Interfaces:**
- Produces on the object returned by `createUI()`:
  - `bindOperator({ onToggle }) -> void` (wires the operator + close buttons)
  - `setOperatorButtonVisible(visible) -> void` (shows the toggle only in cloud mode)
  - `setOperatorVisible(visible) -> void` (shows/hides the overlay + updates label)
  - `getOperatorCanvas() -> HTMLCanvasElement`

- [ ] **Step 1: Add the overlay DOM to `index.html`**

Inside `#hud`, after the `#controls` block, add the operator overlay and a toggle button. Add the toggle button inside `#controls` (hidden by default) and the overlay as a sibling of `#controls`:

In `#controls`, add as the last button:

```html
    <button class="ctrl" id="operatorBtn" style="display:none">운영자 뷰</button>
```

After the `#controls` closing `</div>`, add:

```html
  <div id="operatorOverlay" style="position:absolute; inset:0; z-index:20; display:none; background:#0b0b0b; pointer-events:auto;">
    <canvas id="operatorCanvas" style="width:100%; height:100%; display:block;"></canvas>
    <button class="ctrl primary" id="operatorCloseBtn" style="position:absolute; right:12px; top:12px;">게임으로</button>
  </div>
```

- [ ] **Step 2: Extend `createUI` in `src/ui.js`**

Add the new elements to the `elements` map (alongside the existing `querySelector` calls):

```javascript
    operatorBtn: documentRoot.querySelector('#operatorBtn'),
    operatorOverlay: documentRoot.querySelector('#operatorOverlay'),
    operatorCanvas: documentRoot.querySelector('#operatorCanvas'),
    operatorCloseBtn: documentRoot.querySelector('#operatorCloseBtn'),
```

Add these functions and include them in the returned object:

```javascript
  function bindOperator({ onToggle }) {
    elements.operatorBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggle(true);
    });
    elements.operatorCloseBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggle(false);
    });
  }
```

In the returned object, add:

```javascript
    bindOperator,
    setOperatorButtonVisible(visible) {
      elements.operatorBtn.style.display = visible ? '' : 'none';
    },
    setOperatorVisible(visible) {
      elements.operatorOverlay.style.display = visible ? 'block' : 'none';
    },
    getOperatorCanvas() {
      return elements.operatorCanvas;
    },
```

- [ ] **Step 3: Syntax-check and run the full suite**

Run: `node --check src/ui.js && node --test tests/*.test.mjs`
Expected: no syntax error; all 25+ tests still pass (`createUI` is DOM-coupled and not unit-tested; `formatMetrics` tests remain green).

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui.js
git commit -m "Add operator-view overlay DOM and UI toggle hooks"
```

---

### Task 6: OperatorView (three.js orbit overlay)

**Files:**
- Create: `src/operator-view.js`

**Interfaces:**
- Consumes: `VoxelMap.getSolidVoxels()`, `NinjaGame.getTargetPosition()`, `PlayerTrail.getPoints()`, current viewer position.
- Produces:
  - `new OperatorView({ canvas })`
  - `render({ solidVoxels, ninjaPos, playerPos, playerPath }) -> void`
  - `resize() -> void`

- [ ] **Step 1: Implement the module**

```javascript
// src/operator-view.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { VOXEL_MAX_SOLID } from './config.js';

// A second, non-XR 3D scene rendered onto an overlay canvas: a god's-eye view
// of the reconstructed voxel space, the hidden Ninja, and the player's path.
// Independent WebGL context; renders only while the overlay is visible.
export class OperatorView {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0b0b);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 2.0));
    this.scene.add(new THREE.GridHelper(10, 20, 0x334455, 0x223344));
    this.scene.add(new THREE.AxesHelper(0.5));

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
    this.camera.position.set(2, 3, 4);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.voxels = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      VOXEL_MAX_SOLID,
    );
    this.voxels.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(VOXEL_MAX_SOLID * 3),
      3,
    );
    this.voxels.count = 0;
    this.scene.add(this.voxels);

    this.ninja = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3355 }),
    );
    this.ninja.visible = false;
    this.scene.add(this.ninja);

    this.player = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.14, 12),
      new THREE.MeshBasicMaterial({ color: 0x33ddff }),
    );
    this.player.visible = false;
    this.scene.add(this.player);

    this.pathGeometry = new THREE.BufferGeometry();
    this.pathGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(300 * 3), 3),
    );
    this.pathGeometry.setDrawRange(0, 0);
    this.scene.add(new THREE.Line(
      this.pathGeometry,
      new THREE.LineBasicMaterial({ color: 0x33ddff }),
    ));

    this._matrix = new THREE.Matrix4();
    this._color = new THREE.Color();
  }

  resize() {
    const width = this.canvas.clientWidth || innerWidth;
    const height = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render({ solidVoxels, ninjaPos, playerPos, playerPath }) {
    this.resize();

    const count = Math.min(solidVoxels.length, VOXEL_MAX_SOLID);
    for (let i = 0; i < count; i += 1) {
      const { position, colorT } = solidVoxels[i];
      this._matrix.makeTranslation(position[0], position[1], position[2]);
      this.voxels.setMatrixAt(i, this._matrix);
      this._color.setRGB(0.2 + 0.8 * colorT, 0.5, 1 - 0.8 * colorT);
      this.voxels.setColorAt(i, this._color);
    }
    this.voxels.count = count;
    this.voxels.instanceMatrix.needsUpdate = true;
    if (this.voxels.instanceColor) this.voxels.instanceColor.needsUpdate = true;

    if (ninjaPos) {
      this.ninja.visible = true;
      this.ninja.position.set(ninjaPos[0], ninjaPos[1], ninjaPos[2]);
    } else {
      this.ninja.visible = false;
    }

    if (playerPos) {
      this.player.visible = true;
      this.player.position.set(playerPos[0], playerPos[1], playerPos[2]);
    }

    const positions = this.pathGeometry.attributes.position.array;
    const pathCount = Math.min(playerPath.length, 300);
    for (let i = 0; i < pathCount; i += 1) {
      positions[i * 3] = playerPath[i][0];
      positions[i * 3 + 1] = playerPath[i][1];
      positions[i * 3 + 2] = playerPath[i][2];
    }
    this.pathGeometry.setDrawRange(0, pathCount);
    this.pathGeometry.attributes.position.needsUpdate = true;
    this.pathGeometry.computeBoundingSphere();

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check src/operator-view.js`
Expected: no syntax error. (three.js/OrbitControls resolve only in the browser via the import map; runtime is verified on load in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/operator-view.js
git commit -m "Add OperatorView orbit overlay scene"
```

---

### Task 7: Wire operator view + voxel map into main.js

**Files:**
- Modify: `src/config.js` (add constants)
- Modify: `src/main.js` (construct + wire in cloud mode)

**Interfaces:**
- Consumes: `VoxelMap` (Task 1), `PlayerTrail` (Task 2), `OperatorView` (Task 6), `NinjaGame.getTargetPosition` (Task 3), `DepthCloud({ scene, voxelMap })` (Task 4), UI operator hooks (Task 5).

- [ ] **Step 1: Add config constants**

Append to `src/config.js`:

```javascript
// Voxel reconstruction / operator view.
export const VOXEL_SIZE_M = 0.05;
export const VOXEL_SOLID_MIN_HITS = 3;
export const VOXEL_MAX_SOLID = 20000;
export const TRAIL_MIN_STEP_M = 0.15;
export const TRAIL_MAX_POINTS = 300;
```

- [ ] **Step 2: Import the new modules in `src/main.js`**

Add to the import block:

```javascript
import { OperatorView } from './operator-view.js';
import { PlayerTrail } from './player-trail.js';
import { VoxelMap } from './voxel-map.js';
```

Add to the config import list: `TRAIL_MAX_POINTS, TRAIL_MIN_STEP_M, VOXEL_MAX_SOLID, VOXEL_SIZE_M, VOXEL_SOLID_MIN_HITS`.

- [ ] **Step 3: Declare module-level state**

Near the other `let` declarations, add:

```javascript
let voxelMap = null;
let playerTrail = null;
let operatorView = null;
let operatorVisible = false;
```

- [ ] **Step 4: Construct in cloud mode and wire the toggle**

Replace the existing `if (CLOUD_MODE) depthCloud = new DepthCloud({ scene });` with:

```javascript
  if (CLOUD_MODE) {
    voxelMap = new VoxelMap({
      voxelSize: VOXEL_SIZE_M,
      solidMinHits: VOXEL_SOLID_MIN_HITS,
      maxSolid: VOXEL_MAX_SOLID,
    });
    playerTrail = new PlayerTrail({
      minStep: TRAIL_MIN_STEP_M,
      maxPoints: TRAIL_MAX_POINTS,
    });
    depthCloud = new DepthCloud({ scene, voxelMap });
    operatorView = new OperatorView({ canvas: ui.getOperatorCanvas() });
    ui.setOperatorButtonVisible(true);
    ui.bindOperator({
      onToggle(visible) {
        operatorVisible = visible;
        ui.setOperatorVisible(visible);
      },
    });
  }
```

- [ ] **Step 5: Reset trail/voxels and operator state on session start/end**

In both the `sessionstart` and `sessionend` handlers, after the existing `depthCloud?.reset();` line, add:

```javascript
    voxelMap?.reset();
    playerTrail?.reset();
```

And in the `sessionend` handler only, also add:

```javascript
    operatorVisible = false;
    ui.setOperatorVisible(false);
```

- [ ] **Step 6: Record the trail and render the operator view each frame**

In `render(time, frame)`, inside the `if (CLOUD_MODE) { ... }` branch, after `depthCloud?.update(...)`:

```javascript
  if (CLOUD_MODE) {
    depthCloud?.update(frame, xrSession.getLocalSpace(), time);
    const pose = xrSession.getViewerPose();
    if (pose) playerTrail?.record(pose.position);
    if (operatorVisible && operatorView) {
      operatorView.render({
        solidVoxels: voxelMap.getSolidVoxels(),
        ninjaPos: game.getTargetPosition(),
        playerPos: pose ? pose.position : null,
        playerPath: playerTrail.getPoints(),
      });
    }
  } else {
    maybeAttachOccluder();
  }
```

- [ ] **Step 7: Show the voxel count in the HUD (reuse pointCount)**

In `updateMetrics`, change the `pointCount` line so cloud mode reports solid voxels once they exist, otherwise the raw point count:

```javascript
    pointCount: CLOUD_MODE
      ? (voxelMap?.getSolidCount() ? voxelMap.getSolidCount() : (depthCloud?.getCount() ?? 0))
      : null,
```

- [ ] **Step 8: Syntax-check and run the full suite**

Run: `node --check src/main.js && node --check src/config.js && node --test tests/*.test.mjs`
Expected: no syntax errors; all tests pass.

- [ ] **Step 9: Load-verify both modes locally**

Run a static server and open each URL in a browser; confirm no console errors.

```bash
python -m http.server 8000
```

- Default `http://localhost:8000/` → desktop shows the WebXR-unsupported fallback, no console errors, no `운영자 뷰` button behavior change.
- Cloud `http://localhost:8000/?depth=cloud` → same fallback on desktop (AR gated), no console errors, modules load (including `operator-view.js`, `OrbitControls`).

Expected: both load cleanly. (Full AR + operator overlay behavior is verified on an ARCore device — see below.)

- [ ] **Step 10: Commit**

```bash
git add src/config.js src/main.js
git commit -m "Wire voxel map, player trail, and operator view in cloud mode"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md` (update the "다음 단계" section: operator view + voxel map now implemented in cloud mode)

- [ ] **Step 1: Update README**

In `README.md`, move "운영자(서버) 3D 뷰" and voxel reconstruction from "다음 단계 (설계됨, 미구현)" into the implemented feature list (section 4), describing: `?depth=cloud`의 `운영자 뷰` 버튼으로 복원된 복셀 공간·닌자 위치·플레이어 경로를 오빗 카메라로 확인. Note that voxel-based **static** occlusion (hide behind pillow/toy) remains a Phase 2 follow-up, and dynamic (hand) occlusion still depends on the gpu occlusion mode.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document operator view and voxel reconstruction"
```

---

## On-Device Acceptance (manual, not automated)

On an ARCore Depth-capable Android phone, open `.../?depth=cloud`, START AR, scan the room, then tap `운영자 뷰`:

- The overlay shows voxel cubes whose shape matches the real room (walls high/warm, floor low/blue).
- The red Ninja marker sits where the Ninja is actually hidden.
- The cyan player marker + path track real movement.
- One-finger drag orbits; pinch zooms. Tapping `게임으로` returns to AR with tracking intact.

Record any failure (empty overlay, wrong Ninja position, drift) for follow-up — especially confirm the second WebGL canvas composites over the AR view (the spec's flagged risk).

## Self-Review

- **Spec coverage:** VoxelMap (Task 1) ✓ occupancy+denoise+cap+reset; operator view (Tasks 5–7) ✓ cubes/ninja/player/path/toggle/orbit; player trail (Task 2) ✓; ninja position (Task 3) ✓; depth-cloud feed (Task 4) ✓; cloud-mode-only + defaults unchanged (Task 7) ✓; docs (Task 8) ✓. Phase 2 occluder intentionally excluded per spec scope.
- **Placeholder scan:** none; all steps carry concrete code or exact commands.
- **Type consistency:** `getSolidVoxels()` → `{ position, colorT }` used identically in Task 6; `getPoints()` → `[[x,y,z]]` consumed in Task 6/7; `getTargetPosition()` → `[x,y,z]|null` consumed in Task 7; `DepthCloud({ scene, voxelMap })` matches Task 4/7; UI hook names (`bindOperator`, `setOperatorButtonVisible`, `setOperatorVisible`, `getOperatorCanvas`) match between Task 5 and Task 7.
