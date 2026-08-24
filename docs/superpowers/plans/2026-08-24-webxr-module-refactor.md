# WebXR Module Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-file WebXR Hidden Ninja prototype into focused native ES modules while preserving behavior and GitHub Pages deployment.

**Architecture:** Keep `index.html` as a static shell and use `src/main.js` as the composition root. Isolate browser-specific WebXR, DOM, and Three.js code from framework-free game rules and spatial metrics so the latter can be unit tested with Node.

**Tech Stack:** HTML, CSS, browser-native ES modules, Three.js 0.180.0, WebXR, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-24-webxr-module-refactor-design.md`

## Global Constraints

- Keep `index.html` at the repository root and use only relative local module paths.
- Add no bundler, package dependency, or server requirement.
- Preserve current user-visible behavior; feature additions are out of scope.
- Keep Three.js pinned to `0.180.0`.

---

### Task 1: Lock Pure Game and Spatial Behavior

**Files:**
- Create: `tests/game-rules.test.mjs`
- Create: `tests/spatial-mapper.test.mjs`
- Create: `src/game-rules.js`
- Create: `src/spatial-mapper.js`

**Interfaces:**
- Produces: `isDetected(distance, angle, maxDistance, maxAngle): boolean`
- Produces: `rankCandidates(candidates, viewerPosition, viewerForward, random): RankedCandidate[]`
- Produces: `SpatialMapper` with candidate, movement, and checkpoint methods.

- [ ] Write tests that encode the existing 5 m/12 degree boundary, the 1-8 m and off-axis candidate preference, 0.22 m sampling gap, 0.35 m jump filter, and checkpoint error calculations.
- [ ] Run `node --test tests/game-rules.test.mjs tests/spatial-mapper.test.mjs` and confirm failure because the modules do not exist.
- [ ] Implement only the pure functions and state needed for those tests.
- [ ] Re-run the tests and confirm they pass.

### Task 2: Extract Rendering and UI Boundaries

**Files:**
- Create: `src/ninja-model.js`
- Create: `src/ui.js`
- Create: `src/config.js`

**Interfaces:**
- Produces: `createNinja`, `makeReticle`, `revealNinja`, `setNinjaOpacity`, and `disposeObject`.
- Produces: `createUI()` returning command binding, state rendering, flash, and fallback methods.
- Produces: named configuration constants used by mapping and game modules.

- [ ] Move the existing Three.js object construction and disposal code without changing geometry, materials, or opacity.
- [ ] Move DOM lookup, button events, status, metrics, flash, and fallback rendering behind `createUI()`.
- [ ] Run syntax checks for every new module.

### Task 3: Extract WebXR Session Lifecycle

**Files:**
- Create: `src/xr-session.js`

**Interfaces:**
- Consumes: a Three.js renderer and reticle.
- Produces: session lifecycle handlers, viewer-pose snapshots, hit-test snapshots, and session/reference-space accessors.

- [ ] Move session, reference-space, hit-test source, viewer pose, and reticle updates out of the inline script.
- [ ] Preserve `local` reference-space behavior and hit-test request semantics.
- [ ] Run module syntax checks.

### Task 4: Extract Game Orchestration and Compose the App

**Files:**
- Create: `src/ninja-game.js`
- Create: `src/main.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: UI, XR session snapshots, `SpatialMapper`, game rules, and Ninja model helpers.
- Produces: mapping, hunt, found, scan, re-hide, checkpoint, and metrics behavior matching the original app.

- [ ] Move phase and target lifecycle into `ninja-game.js`.
- [ ] Build `src/main.js` as the only module loaded by `index.html`.
- [ ] Remove the inline application script and retain the existing import map, markup, and styles.
- [ ] Add a static integration test proving the root page loads `./src/main.js` and contains no inline application module.

### Task 5: Full Verification

**Files:**
- Test: `tests/*.test.mjs`
- Verify: `index.html`, `src/*.js`, `README.md`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: fresh evidence that the refactor is deployable and behavior-preserving at the testable boundaries.

- [ ] Run `node --test tests/*.test.mjs` and confirm all tests pass.
- [ ] Run `node --check` against each `src/*.js` module.
- [ ] Confirm every local browser import uses a relative path and Three.js remains pinned to `0.180.0`.
- [ ] Review `git diff --check`, `git diff --stat`, and `git status --short`.

