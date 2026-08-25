# CPU WebXR Depth Occlusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated `?occlusion=cpu` mode that turns WebXR CPU depth into a depth-only dynamic mesh so real hands and objects can hide the Ninja on CPU-depth-only Android devices.

**Architecture:** URL mode selection and mesh topology remain pure JavaScript so Node can test them. A small Three.js adapter owns preallocated geometry, reads `XRCPUDepthInformation`, reconstructs world-space vertices with the existing unprojection function, and writes only to the depth buffer before the Ninja renders.

**Tech Stack:** WebXR Depth Sensing, Three.js 0.180, browser ES modules, Node.js `node:test`, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-08-25-cpu-depth-occlusion-design.md`

## Global Constraints

- Work only on `cj_develop`; do not modify `main`.
- Preserve user-owned untracked files under `img/`.
- Keep default GPU occlusion and `?depth=cloud` behavior unchanged.
- CPU occlusion uses an `80 x 60` grid, at most one update per `66ms`, a `6m` range, a `0.20m` triangle depth-jump limit, and a `250ms` stale timeout.
- Request depth sensing as optional so unsupported browsers still run the game.
- Update `README.md` with presentation-friendly problem, principle, mode comparison, access, and validation explanations.

---

### Task 1: URL mode selection

**Files:**
- Create: `src/app-mode.js`
- Create: `tests/app-mode.test.mjs`
- Modify: `src/main.js`

**Interfaces:**
- Produces: `resolveAppMode(search: string): 'gpu-occlusion' | 'cloud' | 'cpu-occlusion'`
- Produces: `depthUsageForMode(mode: string): 'gpu-optimized' | 'cpu-optimized'`

- [ ] **Step 1: Write the failing tests**

```js
test('default URL keeps GPU occlusion', () => {
  assert.equal(resolveAppMode(''), 'gpu-occlusion');
});
test('cloud URL selects point-cloud reconstruction', () => {
  assert.equal(resolveAppMode('?depth=cloud'), 'cloud');
});
test('CPU occlusion wins when both experimental parameters are present', () => {
  assert.equal(resolveAppMode('?depth=cloud&occlusion=cpu'), 'cpu-occlusion');
});
test('CPU modes request CPU-optimized WebXR depth', () => {
  assert.equal(depthUsageForMode('cloud'), 'cpu-optimized');
  assert.equal(depthUsageForMode('cpu-occlusion'), 'cpu-optimized');
  assert.equal(depthUsageForMode('gpu-occlusion'), 'gpu-optimized');
});
```

- [ ] **Step 2: Run `node --test tests/app-mode.test.mjs` and confirm it fails because `src/app-mode.js` does not exist.**
- [ ] **Step 3: Implement the two pure functions with `URLSearchParams`; check `occlusion=cpu` before `depth=cloud`.**
- [ ] **Step 4: Run `node --test tests/app-mode.test.mjs` and confirm all mode tests pass.**
- [ ] **Step 5: Replace `CLOUD_MODE` parsing in `main.js` with the returned mode flags and `depthUsageForMode(APP_MODE)`.**

### Task 2: Depth mesh topology

**Files:**
- Create: `src/cpu-occlusion-math.js`
- Create: `tests/cpu-occlusion-math.test.mjs`

**Interfaces:**
- Produces: `isUsableDepth(depth: number, maxRange: number): boolean`
- Produces: `triangleFits(depths: number[], maxJump: number, maxRange: number): boolean`
- Produces: `writeGridTriangleIndices(depths: ArrayLike<number>, cols: number, rows: number, indices: Uint16Array, maxJump: number, maxRange: number): number`; return value is the number of written indices.

- [ ] **Step 1: Write failing tests with hand-derived grids:** valid `2 x 2` depth produces six indices; zero/NaN/out-of-range vertices remove their triangles; a `0.21m` discontinuity removes a triangle while exactly `0.20m` remains; output never exceeds the supplied index buffer.**
- [ ] **Step 2: Run `node --test tests/cpu-occlusion-math.test.mjs` and confirm the missing module is the failure reason.**
- [ ] **Step 3: Implement the minimal pure validation and two-triangle-per-cell index writer. Use triangle winding `[topLeft, bottomLeft, topRight]` and `[topRight, bottomLeft, bottomRight]`.**
- [ ] **Step 4: Run the focused test and then `node --test tests/*.test.mjs`.**

### Task 3: Three.js CPU depth occluder and render integration

**Files:**
- Create: `src/cpu-depth-occluder.js`
- Modify: `src/config.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `depthSampleToWorld()`, `writeGridTriangleIndices()`, and CPU occlusion constants.
- Produces: `new CpuDepthOccluder({ scene })`, `update(frame, referenceSpace, time): number`, `getTriangleCount(): number`, `reset(): void`.

- [ ] **Step 1: Add exact config constants from Global Constraints.**
- [ ] **Step 2: Create preallocated position, depth, and index arrays plus one `BufferGeometry`; create `MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide })`; set `renderOrder = -2`, `frustumCulled = false`, and initially hide the mesh.**
- [ ] **Step 3: In `update()`, throttle by `66ms`, get viewer pose and each view's CPU depth, sample normalized cell centers through `getDepthInMeters(u, v)`, unproject valid samples, build safe indices, update draw range, and return the triangle count.**
- [ ] **Step 4: Catch depth-access errors per view, hide data after `250ms` without a successful update, and make `reset()` clear all counters and visibility.**
- [ ] **Step 5: Instantiate and update the adapter only in CPU occlusion mode; reset it at session boundaries; keep the existing Three.js GPU occluder only in GPU mode.**
- [ ] **Step 6: Run all Node tests and a syntax parse check for every source module.**

### Task 4: HUD and presentation documentation

**Files:**
- Modify: `src/ui.js`
- Modify: `tests/ui.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Extends: `formatMetrics({ occlusionMode?: 'gpu' | 'cpu' | null, occlusionTriangles?: number, ... })`

- [ ] **Step 1: Write a failing HUD test requiring `가림 CPU · 삼각형 321` for the CPU mode while preserving `가림 GPU` and cloud point counts.**
- [ ] **Step 2: Run the focused UI test and confirm the expected new label is absent.**
- [ ] **Step 3: Implement the minimal formatter change and pass mode/triangle state from `main.js`.**
- [ ] **Step 4: Update README sections 3–10: add the CPU URL, explain why GPU depth was unavailable, explain invisible depth mesh in plain Korean, compare all three modes, add S26 Ultra steps and limitations, update file/test counts.**
- [ ] **Step 5: Run all tests and verify README URLs and code structure against the actual files.**

### Task 5: Verification, commit, and deployment

**Files:**
- Verify all changed files; do not stage `img/`.

**Interfaces:**
- Produces: a tested `cj_develop` commit and a successful push to `origin/cj_develop`.

- [ ] **Step 1: Run `node --test tests/*.test.mjs`; require zero failures.**
- [ ] **Step 2: Run the repository's source syntax/import checks; require zero errors.**
- [ ] **Step 3: Inspect `git diff --check`, `git diff --stat`, and `git status --short`; confirm only intended source, tests, docs, and README are staged and `img/` remains untracked.**
- [ ] **Step 4: Commit the implementation to `cj_develop`.**
- [ ] **Step 5: Push only `cj_develop` to `origin/cj_develop`, then report the exact phone URL `?occlusion=cpu` and what HUD values to send back.**

