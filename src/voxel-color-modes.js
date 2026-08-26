// Voxel colouring for the debug renderers. Pure: no three.js, no DOM.
// Returns plain [r, g, b] in 0..1 so both the operator view and the in-AR
// overlay can feed it straight into setColorAt.

export const VOXEL_COLOR_MODES = Object.freeze({
  OBSERVATION: 'observation',
  HEIGHT: 'height',
  CLUSTER: 'cluster',
});

export const VOXEL_COLOR_MODE_LABELS = Object.freeze({
  [VOXEL_COLOR_MODES.OBSERVATION]: '관측 횟수',
  [VOXEL_COLOR_MODES.HEIGHT]: '높이',
  [VOXEL_COLOR_MODES.CLUSTER]: '클러스터',
});

const CYCLE = [
  VOXEL_COLOR_MODES.OBSERVATION,
  VOXEL_COLOR_MODES.HEIGHT,
  VOXEL_COLOR_MODES.CLUSTER,
];

export function nextColorMode(mode) {
  const index = CYCLE.indexOf(mode);
  if (index < 0) return VOXEL_COLOR_MODES.OBSERVATION;
  return CYCLE[(index + 1) % CYCLE.length];
}

// spec 1-4: 1 = red, 2 = yellow, 3+ = green. Raising the threshold slider and
// watching which colour disappears is the whole Phase 2 experiment.
const OBSERVATION_ONE = [1, 0.25, 0.25];
const OBSERVATION_TWO = [1, 0.85, 0.2];
const OBSERVATION_THREE_PLUS = [0.2, 0.9, 0.35];
const CLUSTER_UNASSIGNED = [0.6, 0.6, 0.6];

const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

function hueToRGB(h) {
  const r = Math.abs(h * 6 - 3) - 1;
  const g = 2 - Math.abs(h * 6 - 2);
  const b = 2 - Math.abs(h * 6 - 4);
  const clamp = (n) => Math.min(1, Math.max(0, n));
  // Mixed toward white so neighbouring clusters stay distinguishable on a phone.
  return [clamp(r), clamp(g), clamp(b)].map((c) => 0.25 + 0.75 * c);
}

export function voxelColorRGB(cell, mode, { y = 0, minY = -1, spanY = 3 } = {}) {
  if (mode === VOXEL_COLOR_MODES.HEIGHT) {
    // Bit-identical to operator-view.js:88 at the default minY/spanY, so cloud
    // mode's appearance is preserved.
    const t = Math.min(1, Math.max(0, (y - minY) / spanY));
    return [0.2 + 0.8 * t, 0.5, 1 - 0.8 * t];
  }

  if (mode === VOXEL_COLOR_MODES.CLUSTER) {
    if (cell.clusterId === null || cell.clusterId === undefined) return CLUSTER_UNASSIGNED;
    return hueToRGB((cell.clusterId * GOLDEN_RATIO_CONJUGATE) % 1);
  }

  if (cell.observationCount <= 1) return OBSERVATION_ONE;
  if (cell.observationCount === 2) return OBSERVATION_TWO;
  return OBSERVATION_THREE_PLUS;
}
