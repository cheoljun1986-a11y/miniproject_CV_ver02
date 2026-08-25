# Voxel Reconstruction & Operator View Design

## Goal

Turn the accumulated depth point cloud (`?depth=cloud`) into a denoised **voxel
occupancy map**, and add an on-device **operator view** — a toggleable god's-eye
3D screen showing the reconstructed space, the hidden Ninja's location, and the
player's path. As a follow-up phase, reuse the voxels as depth-only occluders so
the Ninja can hide behind *static* real objects (pillow, toy, pillar).

This is scoped to the existing `?depth=cloud` (cpu-optimized depth) mode. The
default gpu-optimized occlusion mode is unchanged.

## Constraints

- Same device, no networking or backend; keep the static GitHub Pages model.
- three.js stays pinned to `0.180.0` via the existing import map; only add
  `three/addons/controls/OrbitControls.js` (already reachable through the map).
- Keep pure logic (voxel occupancy, path downsampling) free of three.js / DOM /
  WebXR so it stays Node-unit-testable, matching the current module split.
- Do not change the game rules, mapping, detection, or default-mode behavior.
- Operator view and voxels only apply in cloud mode; other modes are untouched.
- Voxel blocks now; smooth meshing (marching cubes) is explicitly out of scope.

## Scope & Phasing

- **Phase 1 (primary):** `VoxelMap` + operator view (visible voxel cubes, Ninja
  marker, player pose + path, toggle). Delivers "can I see that the 3D map and
  the Ninja are where they should be."
- **Phase 2 (secondary):** game-view depth-only voxel occluder for static
  hide-behind. Higher risk (sparse/noisy voxels can wrongly occlude), so it is
  separable and gated behind Phase 1.

## Architecture

New modules (following the existing pure/three split):

- `src/voxel-map.js` — **framework-free.** Observation-counted voxel occupancy.
  `observe([x,y,z])` increments the count for that voxel (key via `voxelKey`
  from `depth-math.js`); a voxel becomes *solid* once its count reaches
  `VOXEL_SOLID_MIN_HITS`. Exposes `getSolidVoxels()` → list of
  `{ position:[x,y,z], colorT }` (color ramp by height), `getSolidCount()`,
  `reset()`. No rendering.
- `src/operator-view.js` — **three.js.** Owns a second `WebGLRenderer` on an
  overlay `<canvas>`, its own scene, an orbit camera with
  `OrbitControls`, a ground grid + axes, an `InstancedMesh` of voxel cubes
  (visible, height-colored), a Ninja marker, and a player pose marker + path
  line. `show()/hide()`, and `render(state)` syncs from shared data. Phase 1
  builds the cube `InstancedMesh` inline here; Phase 2 extracts that builder into
  `voxel-mesh.js` and reuses it.
- `src/player-trail.js` — **framework-free.** Fixed-capacity, distance-gated
  buffer of viewer positions (only record when moved > `TRAIL_MIN_STEP_M`),
  returns the path as a flat point list. Unit-testable.

Changed modules:

- `src/depth-cloud.js` — in addition to the existing points, feed each
  reconstructed world point into a shared `VoxelMap.observe(...)`. Point-cloud
  rendering stays as scan feedback; voxel occupancy is the new persistent map.
- `src/ninja-game.js` — add `getTargetPosition()` (Ninja world position, or
  `null`) so the operator view can mark it. No behavior change.
- `src/main.js` — in cloud mode: construct `VoxelMap`, `OperatorView`,
  `PlayerTrail`; record trail from viewer pose; wire the toggle; each frame,
  when the operator view is visible, render it from shared state.
- `src/ui.js` — add an `운영자 뷰 / 게임으로` toggle button (cloud mode only) and
  a `setOperatorVisible(bool)` state hook.
- `index.html` — add the hidden operator overlay (`<canvas>` + close/toggle
  button) inside the existing DOM overlay; add the toggle button to controls.
- `src/config.js` — add `VOXEL_SOLID_MIN_HITS`, `VOXEL_MAX_SOLID`,
  `TRAIL_MIN_STEP_M`, `TRAIL_MAX_POINTS`.

Phase 2 only:

- `src/voxel-mesh.js` — **three.js.** Build/update an `InstancedMesh` of solid
  voxels from `VoxelMap`. Used by the game scene as a depth-only occluder
  (`colorWrite=false`, `depthWrite=true`, `renderOrder<0`) and reused by the
  operator view for its visible cubes.

## Data Flow

```
cpu depth frame ─(depth-math unproject)─> world points ─┬─> point cloud (feedback)
                                                        └─> VoxelMap.observe()
                                                                │  (count ≥ min → solid)
viewer pose ──> PlayerTrail.record()                            │
Ninja target ──> ninja-game.getTargetPosition()                 │
                                                                ▼
UI toggle ──> OperatorView.show()/hide()      OperatorView.render({
                                                 solidVoxels, ninjaPos,
                                                 playerPos, playerPath })
                                              (Phase 2) game scene occluder cubes
```

- All positions are in the XR `local` reference space, consistent with the
  Ninja, viewer pose, and point cloud already in use.
- The operator renderer is an independent WebGL context on an overlay canvas; it
  renders only while visible and never touches the XR renderer's state.

## UX

- Cloud mode shows a `운영자 뷰` button. Tapping it overlays the 3D map
  full-screen (AR keeps running underneath); a `게임으로` / close button returns.
- Operator scene: height-colored voxel cubes, a bright Ninja marker (distinct
  from map colors), a player marker (camera frustum/cone) with a path line, a
  faint ground grid + axes for orientation. One-finger drag orbits, pinch zooms.

## Error Handling

- No depth / non-cloud mode: no voxels accumulate; the operator view shows an
  empty map (grid + player only). Toggle is hidden outside cloud mode.
- Voxel and instance counts are hard-capped (`VOXEL_MAX_SOLID`); excess
  observations are ignored once full.
- Operator overlay is best-effort: if the second WebGL context fails to create,
  log and disable the toggle; the game is unaffected.
- Session start/end resets `VoxelMap`, `PlayerTrail`, and the operator scene.

## Verification

- Unit tests (`node:test`, framework-free):
  - `VoxelMap`: repeated `observe` of the same cell reaches solid at the
    threshold; distinct cells stay separate; solid list dedups; count is capped;
    `reset` clears.
  - `PlayerTrail`: records only past the min step, caps length (drops oldest),
    returns points in order.
  - `ninja-game.getTargetPosition` returns the hidden position and `null` when
    idle.
- Existing 22 tests continue to pass unchanged.
- Manual/on-device (documented, not automated): in cloud mode the operator view
  shows cubes matching the room, the Ninja marker sits where it is hidden, and
  the player marker/path tracks real movement.

## Open Risks (verify on device)

- Rendering a second WebGL canvas over an active `immersive-ar` session via the
  DOM overlay is assumed to composite correctly; confirm on device early.
- Phase 2 voxel occlusion quality depends on voxel density/denoising; it may be
  too sparse to occlude cleanly. It is intentionally optional for this reason.
