# AR Ninja Hand Gesture RPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a successful ninja scan start a camera-recognized rock-paper-scissors duel whose win captures, draw repeats, and loss relocates the ninja.

**Architecture:** Keep `NinjaGame` responsible for mapped targets and anchors, add a pure `RpsGame` state machine for duel timing, and isolate camera/MediaPipe work behind frame-source and recognizer boundaries. Pure modules receive Node tests; browser-only boundaries use injected fakes and static tests.

**Tech Stack:** JavaScript ES modules, WebXR/ARCore, Three.js 0.180, MediaPipe Tasks Vision, WebGL, HTML/CSS DOM Overlay, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-25-rps-hand-gesture-game-design.md`

## Global Constraints

- Preserve mapping, anchors, CPU/GPU depth occlusion, operator view, and `hcp.glb`.
- Target current Android Chrome with ARCore over HTTPS.
- Normal mode requires real camera recognition; manual controls appear only for `input=manual`.
- Camera pixels stay local and are never persisted or transmitted.
- Keep a static site with no build step or backend.
- Use test-first red-green-refactor for every production behavior.

---

### Task 1: Pure RPS rules and stable gesture consensus

**Files:**
- Create: `src/rps-rules.js`
- Create: `src/gesture-consensus.js`
- Create: `tests/rps-rules.test.mjs`
- Create: `tests/gesture-consensus.test.mjs`

**Interfaces:**
- Produces `MOVES`, `mapGestureLabel(label)`, `chooseMove(random)`, and `evaluateRound(playerMove, ninjaMove)`.
- Produces `GestureConsensus(options)` with `add(sample)` and `reset()`.

- [ ] **Step 1: Write the failing rule test**

Assert the three MediaPipe mappings, unsupported `None`, random bucket edges, invalid move errors, and all nine outcomes:

```js
for (const [player, ninja, expected] of [
  ['rock', 'rock', 'draw'], ['rock', 'scissors', 'win'], ['rock', 'paper', 'lose'],
  ['paper', 'paper', 'draw'], ['paper', 'rock', 'win'], ['paper', 'scissors', 'lose'],
  ['scissors', 'scissors', 'draw'], ['scissors', 'paper', 'win'], ['scissors', 'rock', 'lose'],
]) assert.equal(evaluateRound(player, ninja), expected);
```

- [ ] **Step 2: Run `node --test tests/rps-rules.test.mjs`**

Expected: FAIL because `src/rps-rules.js` does not exist.

- [ ] **Step 3: Implement minimal rules**

Use frozen moves, an explicit label map, clamped random selection, and a beats map. Invalid moves throw `TypeError`.

- [ ] **Step 4: Run the rule test**

Expected: PASS.

- [ ] **Step 5: Write the failing consensus test**

```js
const c = new GestureConsensus({
  minConfidence: 0.7, requiredMatches: 3, windowSize: 5, maxAgeMs: 500,
});
assert.equal(c.add({ move: 'rock', confidence: 0.9, time: 0 }), null);
assert.equal(c.add({ move: 'rock', confidence: 0.8, time: 100 }), null);
assert.equal(c.add({ move: 'rock', confidence: 0.85, time: 200 }), 'rock');
```

Also cover low confidence, mixed samples, expiry, unsupported moves, single emission, and reset.

- [ ] **Step 6: Run `node --test tests/gesture-consensus.test.mjs`**

Expected: FAIL because `GestureConsensus` is missing.

- [ ] **Step 7: Implement consensus and run both tests**

Keep valid recent samples, trim by age and size, emit once at the agreement threshold, and latch until reset.

Run: `node --test tests/rps-rules.test.mjs tests/gesture-consensus.test.mjs`

Expected: PASS with no warnings.

- [ ] **Step 8: Commit**

```bash
git add src/rps-rules.js src/gesture-consensus.js tests/rps-rules.test.mjs tests/gesture-consensus.test.mjs
git commit -m 'feat: add rps rules and gesture consensus'
```

---

### Task 2: Deterministic duel state machine

**Files:**
- Create: `src/rps-game.js`
- Create: `tests/rps-game.test.mjs`
- Modify: `src/config.js`

**Interfaces:**
- Consumes `chooseMove` and `evaluateRound`.
- Produces `RpsGame(options)` with `start(time)`, `update(time)`, `acceptPlayerMove(move, time)`, `reset()`, and `getState()`.

- [ ] **Step 1: Write failing state tests**

Use countdown 3000ms, read timeout 2500ms, and result display 1200ms. Assert countdown to reading, one accepted move, simultaneous reveal, exactly one result callback, draw restart, timeout retry without loss, and reset.

- [ ] **Step 2: Run `node --test tests/rps-game.test.mjs`**

Expected: FAIL because `src/rps-game.js` is absent.

- [ ] **Step 3: Implement the time-driven controller**

Do not use timers. Store phase deadlines and transition only from `update(time)`. Choose the ninja move at `start`, hide it until accepted input, and ignore input outside reading or after acceptance.

- [ ] **Step 4: Add configuration constants**

Export countdown, read timeout, result display, inference interval, confidence, agreement, window, and sample-age values from `src/config.js`.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/rps-game.test.mjs tests/rps-rules.test.mjs tests/gesture-consensus.test.mjs`

Expected: PASS.

```bash
git add src/config.js src/rps-game.js tests/rps-game.test.mjs
git commit -m 'feat: add timed rps duel state machine'
```

---

### Task 3: Connect duel outcomes to ninja capture and relocation

**Files:**
- Modify: `src/ninja-game.js`
- Modify: `tests/ninja-game.test.mjs`

**Interfaces:**
- Add constructor callback `onDuelStart({ target })`.
- Add `resolveDuel(outcome)` and `relocateAfterLoss()`.
- Preserve `triggerScan(): boolean`, where true now means duel started.

- [ ] **Step 1: Replace the old immediate-capture test with failing duel assertions**

After a detected scan, assert phase `duel-countdown`, opaque target, disabled scan control, one `onDuelStart` call, and no found halo.

- [ ] **Step 2: Add failing outcome and relocation tests**

Assert `resolveDuel('win')` enters `found`; draw keeps the same target; loss deletes the current anchor and chooses a different candidate position when two exist. Assert a one-candidate map returns safely to hunt with guidance.

- [ ] **Step 3: Run `node --test tests/ninja-game.test.mjs`**

Expected: FAIL on the new duel behavior while existing anchor tests remain green up to those assertions.

- [ ] **Step 4: Implement minimal transitions**

Store the chosen candidate key on `target`. Filter that key in `hideNewTarget({ excludeCandidateKey })`, keep anchor updates active for all duel phases, and call the existing reveal logic only on win.

- [ ] **Step 5: Run regression tests**

Run: `node --test tests/ninja-game.test.mjs tests/game-rules.test.mjs tests/surface-placement.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ninja-game.js tests/ninja-game.test.mjs
git commit -m 'feat: start rps duel after ninja scan'
```

---

### Task 4: Duel HUD and shared move artwork

**Files:**
- Create: `src/rps-art.js`
- Modify: `index.html`
- Modify: `src/ui.js`
- Create: `tests/rps-ui.test.mjs`
- Modify: `tests/static-site.test.mjs`

**Interfaces:**
- Produce `drawMove(ctx, move, options)`.
- Extend UI with `setDuelVisible`, `setCountdown`, `setHandStatus`, `showMoves`, `showDuelError`, `bindManualMoves`, and `setManualMode`.

- [ ] **Step 1: Write failing DOM/static tests**

Assert the overlay, countdown, two canvases, result text, error panel, and three manual buttons exist. A fake document must prove manual buttons are hidden by default and shown only after `setManualMode(true)`.

- [ ] **Step 2: Run `node --test tests/rps-ui.test.mjs tests/static-site.test.mjs`**

Expected: FAIL because the duel DOM and methods do not exist.

- [ ] **Step 3: Implement responsive HUD and canvas art**

Draw distinct fist, open palm, and V-finger silhouettes with Korean labels. Add reduced-motion CSS, accessible status text, and pointer events only for debug buttons.

- [ ] **Step 4: Verify and commit**

Run: `node --test tests/rps-ui.test.mjs tests/ui.test.mjs tests/static-site.test.mjs`

Expected: PASS.

```bash
git add index.html src/ui.js src/rps-art.js tests/rps-ui.test.mjs tests/static-site.test.mjs
git commit -m 'feat: add rps duel hud and artwork'
```

---

### Task 5: WebXR camera frames and MediaPipe recognition

**Files:**
- Create: `assets/gesture_recognizer.task`
- Create: `src/raw-camera-frame-source.js`
- Create: `src/hand-gesture-recognizer.js`
- Create: `tests/raw-camera-frame-source.test.mjs`
- Create: `tests/hand-gesture-recognizer.test.mjs`

**Interfaces:**
- Produce `RawCameraFrameSource(options)` with `start(session, gl)`, `capture(frame, referenceSpace, time)`, `reset()`, and `getStatus()`.
- Produce `HandGestureRecognizer(options)` with `initialize()`, `recognize(image, time)`, `resetRound()`, `close()`, and `getStatus()`.

- [ ] **Step 1: Write failing camera boundary tests**

Inject binding, canvas, and texture-copy factories. Assert statuses for missing `XRWebGLBinding`, no camera view, copy failure, interval throttling, successful canvas output, and reset.

- [ ] **Step 2: Run `node --test tests/raw-camera-frame-source.test.mjs`**

Expected: FAIL because the source module is absent.

- [ ] **Step 3: Implement camera extraction**

Use the active frame viewer pose, `view.camera`, and `binding.getCameraImage(view.camera)`. Copy to a 256px inference canvas with a Y-correcting WebGL quad. Restore framebuffer, viewport, program, texture, and buffer bindings after copying.

- [ ] **Step 4: Write failing recognizer tests**

Inject a fake MediaPipe factory. Assert initialization states, one-hand category extraction, label mapping, confidence forwarding, no overlapping inference, failure status, consensus reset, and close.

- [ ] **Step 5: Run `node --test tests/hand-gesture-recognizer.test.mjs`**

Expected: FAIL because the recognizer module is absent.

- [ ] **Step 6: Add pinned runtime and model**

Pin `@mediapipe/tasks-vision@1.0.1` through jsDelivr `+esm` and its versioned `wasm` directory. Download Google's `gesture_recognizer.task` into `assets/` and load it by relative URL. Run video mode with one hand and no server upload.

- [ ] **Step 7: Implement recognizer and verify**

Run: `node --test tests/raw-camera-frame-source.test.mjs tests/hand-gesture-recognizer.test.mjs tests/gesture-consensus.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add assets/gesture_recognizer.task src/raw-camera-frame-source.js src/hand-gesture-recognizer.js tests/raw-camera-frame-source.test.mjs tests/hand-gesture-recognizer.test.mjs
git commit -m 'feat: recognize rps hand gestures from webxr camera'
```

---

### Task 6: In-world sign and application composition

**Files:**
- Modify: `src/ninja-model.js`
- Modify: `src/xr-session.js`
- Modify: `src/main.js`
- Modify: `tests/ninja-game.test.mjs`
- Modify: `tests/static-site.test.mjs`

**Interfaces:**
- Add model methods `showNinjaMove(root, move)` and `clearNinjaMove(root)`.
- Add `XRSessionController.getViewerPoseObject()` for the current active frame.
- Compose `RpsGame`, `GestureConsensus`, `RawCameraFrameSource`, and `HandGestureRecognizer` in `main.js`.

- [ ] **Step 1: Write failing integration/static tests**

Assert `main.js` requests optional `camera-access`, checks `input=manual`, imports every new module, updates the duel before render, performs recognition only in `duel-reading`, and resets camera/recognizer/duel state on session end.

- [ ] **Step 2: Run integration-related tests**

Run: `node --test tests/static-site.test.mjs tests/ninja-game.test.mjs`

Expected: FAIL on missing imports, feature request, and sign hooks.

- [ ] **Step 3: Implement the in-world move sign**

Use `drawMove` on a square canvas, create a transparent `CanvasTexture` plane above the ninja, mark it with a fixed name, face it toward the camera each frame, and dispose replaced textures/materials/geometries.

- [ ] **Step 4: Wire application state**

On successful scan call `rpsGame.start(time)`. During reading, capture a throttled camera canvas and forward stable recognition to `acceptPlayerMove`. Route result callbacks to `game.resolveDuel` and UI methods. In explicit manual mode, bind three buttons to the same acceptance method.

- [ ] **Step 5: Handle capability failure**

Keep `camera-access` optional at session creation, but block normal duel input with a Korean recovery message when the camera source or MediaPipe status is unavailable. Do not expose manual controls unless the query explicitly selects them.

- [ ] **Step 6: Run the full suite**

Run: `node --test tests/*.test.mjs`

Expected: every existing and new test PASS with no warnings.

- [ ] **Step 7: Commit**

```bash
git add src/ninja-model.js src/xr-session.js src/main.js tests/ninja-game.test.mjs tests/static-site.test.mjs
git commit -m 'feat: integrate hand gesture duel with ar hunt'
```

---

### Task 7: Teammate documentation and delivery verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents the exact branch URL, play URLs, permissions, phases, move mapping, debug mode, architecture, tests, and device checklist.

- [ ] **Step 1: Write the README change**

Add a top-level feature section and chronological entry for `private/junsung`. State that normal play requires raw camera support and that `?input=manual` is diagnostic only. Include `?occlusion=cpu` compatibility and explain how to combine query parameters with `&`.

- [ ] **Step 2: Run documentation/static verification**

Run: `node --test tests/static-site.test.mjs` and `git diff --check`.

Expected: PASS and no whitespace errors.

- [ ] **Step 3: Run final automated verification**

Run: `node --test tests/*.test.mjs`.

Expected: all tests PASS.

- [ ] **Step 4: Record manual Android acceptance limits**

README must distinguish PC-verified behavior from checks requiring Android hardware: permission prompt, camera texture orientation, real three-gesture accuracy, occlusion frame rate, thermal behavior, relocation, and capture.

- [ ] **Step 5: Commit and push**

```bash
git add README.md
git commit -m 'docs: explain hand gesture rps game'
git status --short --branch
git push -u origin private/junsung
```
