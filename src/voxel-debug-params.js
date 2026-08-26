// Control schema and value handling for the voxel debug panel. Pure: no DOM.
// The panel walks this schema to build its sliders, so adding a knob is a
// one-line change here rather than new markup.

export const VOXEL_DEBUG_CONTROLS = Object.freeze([
  { id: 'nearM', label: '근접 클립', unit: 'm', min: 0.10, max: 2.00, step: 0.05, value: 0.30, rebuild: true },
  { id: 'farM', label: '원거리 클립', unit: 'm', min: 1.00, max: 8.00, step: 0.10, value: 5.00, rebuild: true },
  { id: 'gradientMaxJumpM', label: '그래디언트', unit: 'm', min: 0.00, max: 0.50, step: 0.01, value: 0.10, rebuild: true },
  { id: 'voxelSize', label: '복셀 크기', unit: 'm', min: 0.03, max: 0.05, step: 0.01, value: 0.05, rebuild: true },
  // Applied over getCells() at render time, never at ingest, so the slider is
  // instant and the Phase 2 threshold experiment needs no rescan.
  { id: 'minObservations', label: '관측 임계값', unit: '', min: 1, max: 4, step: 1, value: 1, rebuild: false },
]);

const BY_ID = new Map(VOXEL_DEBUG_CONTROLS.map((c) => [c.id, c]));

export const DEFAULT_VOXEL_DEBUG_PARAMS = Object.freeze(
  Object.fromEntries(VOXEL_DEBUG_CONTROLS.map((c) => [c.id, c.value])),
);

export function clampParam(id, value) {
  const control = BY_ID.get(id);
  if (!control) return value;

  const clamped = Math.min(control.max, Math.max(control.min, Number(value)));
  if (!(control.step > 0)) return clamped;

  const stepped = control.min + Math.round((clamped - control.min) / control.step) * control.step;
  // Re-clamp: rounding can push a value one step past the end.
  const bounded = Math.min(control.max, Math.max(control.min, stepped));
  // Kill float error so 0.30 does not print as 0.30000000000000004.
  return Math.round(bounded * 1e6) / 1e6;
}

// A near clip above the far clip empties the map with no error, which reads as
// a depth-acquisition failure. Push the far clip out of the way instead.
export function normalizeParams(params) {
  if (params.nearM < params.farM) return params;
  const farControl = BY_ID.get('farM');
  return {
    ...params,
    farM: clampParam('farM', Math.min(farControl.max, params.nearM + farControl.step)),
  };
}

export function applyParam(params, id, value) {
  const control = BY_ID.get(id);
  if (!control) return { params, changed: false, needsRebuild: false };

  const next = clampParam(id, value);
  if (next === params[id]) return { params, changed: false, needsRebuild: false };

  return {
    params: normalizeParams({ ...params, [id]: next }),
    changed: true,
    needsRebuild: control.rebuild,
  };
}
