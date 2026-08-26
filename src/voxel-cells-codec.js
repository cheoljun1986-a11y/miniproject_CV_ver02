// JSON codec for a finished voxel map — the cells themselves, not the depth
// keyframes that produced them. Pure: no three.js, no DOM, no WebXR.
//
// This is what the game exports. The game accumulators keep no raw keyframes
// (VoxelTerrain drops them on ingest, VoxelMap never had them), so unlike the
// diagnostic's keyframe JSON this cannot be re-filtered afterwards; it is a
// record of what the character actually stood on. viewer.html draws either.

import { VoxelGrid } from './voxel-grid.js';

export const VOXEL_CELLS_JSON_VERSION = 1;
export const VOXEL_CELLS_KIND = 'voxel-cells';

const MM = 1000;
const round = (v) => Math.round(v * MM) / MM;

// Cells are flattened to [ix, iy, iz, observations, meanX, meanY, meanZ] — a
// 60k-cell room is ~2MB, small enough to re-upload every half minute.
export function voxelCellsToJSON({
  cells,
  voxelSize,
  origin = [0, 0, 0],
  keyframeCount = 0,
  playerPath = [],
  sessionId = null,
  source = 'keyframe',
  stats = null,
}) {
  return {
    version: VOXEL_CELLS_JSON_VERSION,
    kind: VOXEL_CELLS_KIND,
    source,
    sessionId,
    voxelSize,
    origin: [origin[0], origin[1], origin[2]],
    keyframeCount,
    stats,
    playerPath: playerPath.map((p) => [round(p[0]), round(p[1]), round(p[2])]),
    cells: cells.map((cell) => {
      const n = cell.sampleCount || 1;
      return [
        cell.ix, cell.iy, cell.iz, cell.observationCount,
        round(cell.sumX / n), round(cell.sumY / n), round(cell.sumZ / n),
      ];
    }),
  };
}

// VoxelMap only knows cell centres and that each passed its hit threshold.
// Widened to the VoxelGrid cell shape so both game paths export identically.
export function cellsFromSolidVoxels(solidVoxels, voxelSize, observationCount = 3) {
  return solidVoxels.map(({ position }) => {
    const ix = Math.floor(position[0] / voxelSize);
    const iy = Math.floor(position[1] / voxelSize);
    const iz = Math.floor(position[2] / voxelSize);
    return {
      key: `${ix},${iy},${iz}`,
      ix,
      iy,
      iz,
      observationCount,
      lastFrameId: null,
      sampleCount: 1,
      sumX: position[0],
      sumY: position[1],
      sumZ: position[2],
      clusterId: null,
    };
  });
}

export function isVoxelCellsJSON(json) {
  return Boolean(json)
    && typeof json === 'object'
    && json.kind === VOXEL_CELLS_KIND
    && json.version === VOXEL_CELLS_JSON_VERSION
    && Array.isArray(json.cells);
}

// Rebuilds a VoxelGrid with the same cell records the live grid held, so the
// viewer's colour modes, floor estimate and occluder mesh all work unchanged.
export function voxelCellsFromJSON(json) {
  if (!isVoxelCellsJSON(json)) return null;
  if (!(json.voxelSize > 0)) return null;

  const grid = new VoxelGrid({
    voxelSize: json.voxelSize,
    origin: json.origin ?? [0, 0, 0],
    maxCells: Math.max(json.cells.length, 1),
  });
  for (const entry of json.cells) {
    if (!Array.isArray(entry) || entry.length < 7) return null;
    const [ix, iy, iz, observationCount, mx, my, mz] = entry;
    const key = `${ix},${iy},${iz}`;
    grid.cells.set(key, {
      key,
      ix,
      iy,
      iz,
      observationCount,
      lastFrameId: null,
      sampleCount: 1,
      sumX: mx,
      sumY: my,
      sumZ: mz,
      clusterId: null,
    });
  }
  grid.revision += 1;

  return {
    grid,
    meta: {
      source: json.source ?? 'keyframe',
      sessionId: json.sessionId ?? null,
      keyframeCount: json.keyframeCount ?? 0,
      stats: json.stats ?? null,
      playerPath: Array.isArray(json.playerPath) ? json.playerPath : [],
    },
  };
}
