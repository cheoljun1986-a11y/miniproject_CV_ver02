# AR Ninja Rock-Paper-Scissors Hand Gesture Game Design

## Goal

Extend the Android ARCore WebXR ninja hunt so that a successful scan starts a rock-paper-scissors duel. The player shows a real hand gesture to the phone camera. Winning captures the ninja, drawing starts another duel, and losing moves the ninja to another mapped hiding candidate.

## Scope and constraints

- Start from `cj_develop` and preserve mapping, anchors, CPU/GPU depth occlusion, operator view, and the scanned `hcp.glb` model.
- Target Android ARCore with a current Chrome version over HTTPS.
- Normal play requires camera recognition. `?input=manual` exists only for desktop tests and emergency diagnostics.
- Camera frames stay on the device and are neither persisted nor transmitted.
- Keep the static GitHub Pages architecture without a build step or backend.
- All existing Node tests must continue to pass.

## User experience

1. The player maps the room and hunts for the hidden ninja as before.
2. When `SCAN` meets the current distance and angle rules, the target becomes visible but is not captured.
3. The UI displays `3`, `2`, `1`, then `가위바위보!` while the player holds one hand near the camera center.
4. MediaPipe labels map as `Victory -> scissors`, `Closed_Fist -> rock`, and `Open_Palm -> paper`.
5. A move is accepted only when enough recent, above-threshold samples agree.
6. The ninja chooses a uniformly random move at round start but hides it until the player's move is accepted.
7. Both moves appear together in HUD cards, and a camera-facing sign above the target shows the ninja move.
8. A win captures the ninja; a draw starts another countdown at the same target; a loss relocates the ninja to a different mapped candidate.
9. Missing or uncertain hand input never counts as a loss. The UI gives pose guidance and retries recognition.

## State model

`NinjaGame` keeps ownership of mapping and target placement. Recognition timing lives in a separate `RpsGame` controller.

- `hunt`: target hidden and `SCAN` enabled.
- `duel-countdown`: target visible, controls locked, countdown running.
- `duel-reading`: camera samples accepted until a stable move or timeout.
- `duel-result`: both moves and the result shown briefly.
- `found`: player won and the ninja is captured.
- A loss relocates the target and returns to `hunt`.

A successful `triggerScan()` starts the duel instead of calling the old immediate capture path. The duel reports `win`, `draw`, or `lose`. A win performs the final reveal, a draw keeps the target, and a loss clears its model and anchor before choosing another candidate.

Candidate selection excludes the previous candidate when at least two candidates exist. If only one candidate exists, the target stays there and the UI explains that more hiding locations must be mapped instead of failing or looping.

## Components

### `src/rps-rules.js`

Pure move constants, MediaPipe label mapping, random ninja move selection, and all nine win/draw/loss combinations. No DOM, Three.js, or WebXR dependencies.

### `src/gesture-consensus.js`

Maintains a bounded rolling sample window. It rejects unsupported labels and low confidence, expires stale samples, and emits only after the configured agreement count. It resets for every throw window.

### `src/raw-camera-frame-source.js`

Owns `XRWebGLBinding` and a small WebGL copy pipeline that transfers the current `view.camera` texture to a downscaled inference canvas at a capped rate. It reports typed capability states for missing camera access, binding, camera view, and texture-copy failures.

### `src/hand-gesture-recognizer.js`

Loads a pinned MediaPipe Tasks Vision runtime and repository-pinned gesture model, runs one-hand video inference, maps supported categories, and feeds `GestureConsensus`. Initialization and inference failures become UI status rather than uncaught render-loop errors.

### `src/rps-game.js`

Deterministic time-driven controller for countdown, reading, result display, timeout retry, and win/draw/loss callbacks. Clock and random functions are injected for tests.

### `src/rps-art.js`

Draws consistent vector rock, paper, and scissors artwork onto canvases. HUD cards and the Three.js `CanvasTexture` sign share this drawing function, avoiding device-dependent emoji.

### Existing files

- `src/ninja-game.js`: enter a duel after scan, capture only after a win, and relocate after a loss while keeping anchor tracking during a duel.
- `src/ninja-model.js`: manage the camera-facing move sign without changing the existing model or reveal effect.
- `src/xr-session.js`: expose the current viewer pose/views needed for raw camera access without changing hit testing.
- `src/main.js`: request optional `camera-access`, construct duel/recognition components, process frames only during reading, and reset them on session end.
- `src/ui.js` and `index.html`: add countdown, hand status, move cards, result text, capability errors, and debug-only manual controls.
- `src/config.js`: hold recognition confidence, agreement, sampling, countdown, timeout, and result timings.
- `README.md`: document gameplay, requirements, permission behavior, debug mode, files, tests, and device validation.

## Camera and recognition pipeline

The AR session requests `camera-access` as optional so mapping can still start and display a useful diagnostic on unsupported browsers. During an XR frame, the app selects a viewer view with a camera, obtains its texture through `XRWebGLBinding.getCameraImage()`, and copies it through an orientation-correcting shader into a small inference canvas.

Inference runs only during `duel-reading` and is rate-limited to control heat and latency. MediaPipe runs locally in video mode. Rolling consensus prevents one-frame mistakes and is reset between rounds.

If raw camera access is unavailable in normal mode, the duel shows a blocking compatibility explanation and never silently falls back to manual input. With explicit `input=manual`, the camera path is bypassed and three test buttons feed the same `RpsGame` interface.

## Graphics and accessibility

The duel overlay remains inside the current DOM overlay without hiding the AR background. Countdown is centered. Result cards show `나` and `닌자` with graphics and Korean labels. The in-world ninja sign is a child of the target, follows anchor corrections, and faces the camera.

Status always uses text as well as shape and color. Controls remain phone-sized, debug buttons are absent from normal play, and reduced-motion preference disables nonessential animation.

## Error handling and lifecycle

- MediaPipe exposes loading, ready, and failure states before a duel.
- Camera permission or capability failure blocks only the duel and provides a concrete recovery message.
- Hand absence, unsupported poses, and low confidence keep the reading window alive; timeout retries without awarding a loss.
- Session end resets consensus and duel state, stops inference, removes signs, and preserves current depth/anchor cleanup.
- At most one inference request runs at a time.
- Render-loop errors are caught at the camera/inference boundaries.

## Testing

Automated Node tests cover:

- all move combinations and MediaPipe label mapping;
- confidence threshold, agreement, stale expiry, and reset;
- countdown, move acceptance, result timing, draw replay, timeout retry, win, and loss;
- scan entering a duel instead of capture;
- win capture, draw without relocation, and loss excluding the previous candidate;
- injected raw-camera capability states;
- normal/debug manual control visibility;
- required imports, assets, and DOM elements.

The complete `node --test tests/*.test.mjs` suite must pass. Android acceptance additionally checks camera permission, portrait orientation, all three gestures in indoor lighting, CPU occlusion responsiveness, repeated rounds, draw replay, loss relocation, and win capture.

## Delivery

All changes are committed and pushed only to `origin/private/junsung`. The README contains a chronological change summary and direct teammate instructions.
