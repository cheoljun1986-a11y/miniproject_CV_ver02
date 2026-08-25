import {
  HORIZONTAL_SURFACE_THRESHOLD,
  NINJA_HORIZONTAL_OFFSET_M,
  NINJA_VERTICAL_OFFSET_M,
} from './config.js';

function normalize([x, y, z], fallback = [0, 1, 0]) {
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-8)) return fallback.slice();
  return [x / length, y / length, z / length];
}

export function surfaceNormalFromMatrix(matrix) {
  return normalize([matrix[4], matrix[5], matrix[6]]);
}

export function orientNormalTowardViewer(normal, surfacePosition, viewerPosition) {
  const unitNormal = normalize(normal);
  const toViewer = normalize([
    viewerPosition[0] - surfacePosition[0],
    viewerPosition[1] - surfacePosition[1],
    viewerPosition[2] - surfacePosition[2],
  ]);
  const dot = unitNormal[0] * toViewer[0]
    + unitNormal[1] * toViewer[1]
    + unitNormal[2] * toViewer[2];
  return dot < 0
    ? unitNormal.map((value) => (value === 0 ? 0 : -value))
    : unitNormal;
}

export function placeNinjaOnSurface(candidate, viewerPosition, {
  horizontalThreshold = HORIZONTAL_SURFACE_THRESHOLD,
  horizontalOffset = NINJA_HORIZONTAL_OFFSET_M,
  verticalOffset = NINJA_VERTICAL_OFFSET_M,
} = {}) {
  const normal = orientNormalTowardViewer(
    surfaceNormalFromMatrix(candidate.matrix),
    candidate.pos,
    viewerPosition,
  );
  const horizontal = Math.abs(normal[1]) >= horizontalThreshold;
  const offset = horizontal ? horizontalOffset : verticalOffset;
  return {
    position: candidate.pos.map((value, index) => value + normal[index] * offset),
    normal,
    horizontal,
    offset,
  };
}
