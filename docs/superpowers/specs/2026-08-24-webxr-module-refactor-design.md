# WebXR Module Refactor Design

## Goal

Split the single-file WebXR Hidden Ninja prototype into focused native ES modules without changing its user-visible behavior or GitHub Pages deployment model.

## Constraints

- Keep `index.html` at the repository root so GitHub Pages can serve the app directly.
- Use browser-native ES modules and relative URLs; do not add a bundler or runtime dependency.
- Keep Three.js pinned to `0.180.0` through the existing import map.
- Preserve the current mapping, hunting, detection, checkpoint, and HUD behavior.
- Keep WebXR-dependent code out of Node-based unit tests.
- Do not add depth occlusion, anchors, gestures, scoring, or other new behavior in this refactor.

## Architecture

`src/main.js` is the composition root. It creates the scene, connects UI commands to the game controller, and owns the render loop.

- `src/config.js`: shared numeric game and mapping configuration.
- `src/ui.js`: DOM lookup, button bindings, and HUD/status rendering.
- `src/xr-session.js`: WebXR session state, reference spaces, hit-test source lifecycle, viewer pose, and hit-test pose extraction.
- `src/spatial-mapper.js`: framework-free candidate collection and movement/checkpoint metrics.
- `src/game-rules.js`: framework-free detection and candidate-ranking rules.
- `src/ninja-game.js`: mapping/hunt/found phase orchestration and target lifecycle.
- `src/ninja-model.js`: Three.js Ninja, reticle, reveal halo, opacity, and disposal helpers.

Browser-only dependencies flow inward through `main.js`; pure rule and metric modules do not access the DOM, Three.js, or WebXR globals.

## Data Flow

1. UI button events call commands exposed by `main.js` and `ninja-game.js`.
2. `xr-session.js` converts each XR frame into viewer and surface-pose snapshots.
3. `spatial-mapper.js` records candidate positions and movement metrics.
4. `ninja-game.js` applies `game-rules.js`, creates/removes Ninja objects through `ninja-model.js`, and updates phase state.
5. `main.js` renders the current state through `ui.js` and Three.js.

## Error Handling

- Unsupported WebXR continues to show the existing fallback screen.
- Reference-space fallback remains unchanged.
- Hit-test creation errors remain visible in the status and console.
- Missing poses or candidates remain safe no-op conditions.

## Verification

- Unit tests cover detection thresholds, candidate preference, candidate spacing, movement jump filtering, and checkpoint errors.
- A static integration test confirms `index.html` loads `./src/main.js` and no longer contains the inline application module.
- Every JavaScript module passes Node syntax checking.
- Git status is reviewed to ensure only intended files changed.

