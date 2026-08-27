import {
  TSDF_CARVE_START_M,
  TSDF_CARVE_STRIDE,
  TSDF_DEPTH_WEIGHT_POWER,
  TSDF_DEPTH_WEIGHT_REF_M,
  TSDF_KEYFRAME_MAX_SAMPLES,
  TSDF_MAX_WEIGHT,
  TSDF_SURFACE_BAND,
  TSDF_TRUNCATION_VOXELS,
  VOXEL_KEYFRAME_MAX_SAMPLES,
  VOXEL_KEYFRAME_MIN_ROTATION_DEG,
  VOXEL_KEYFRAME_MIN_TRANSLATION_M,
  VOXEL_TERRAIN_EVICT_BATCH,
  VOXEL_TERRAIN_MAX_CELLS,
  VOXEL_TERRAIN_MAX_SOLID,
  VOXEL_TERRAIN_MIN_GAP_MS,
  VOXEL_TERRAIN_MIN_OBSERVATIONS,
} from './config.js';
import { filterDepthGrid } from './depth-grid-filter.js';
import { depthSampleToWorld } from './depth-math.js';
import { KeyframeCapture } from './keyframe-capture.js';
import { KeyframeGate } from './keyframe-gate.js';
import { TsdfGrid } from './tsdf-grid.js';
import { voxelCellsToJSON } from './voxel-cells-codec.js';
import { DEFAULT_VOXEL_DEBUG_PARAMS } from './voxel-debug-params.js';
import { VoxelGrid, cellCenterPosition } from './voxel-grid.js';

export const TERRAIN_FUSIONS = Object.freeze({ TSDF: 'tsdf', COUNT: 'count' });

// The game's space map, built from the same keyframe pipeline as the
// ?voxel=debug diagnostic but run as an accumulator rather than a lab:
//
//   - no scan window and no keyframe cap — it captures for the whole session,
//     so the map keeps growing wherever the player walks;
//   - keyframes are folded into the grid the moment they land and then
//     dropped, so memory scales with room size, not time walked;
//   - a cell reaching VOXEL_TERRAIN_MIN_OBSERVATIONS distinct viewpoints is
//     handed to onSolid once, the same contract VoxelMap.onSolid gave the
//     chase TraversalGrid.
//
// Exposes the VoxelMap surface main.js already reads (getSolidVoxels,
// getSolidCount, getRevision, reset) so the operator view needs no changes.
//
// It stands in for KeyframeStore behind KeyframeCapture: add() is the only
// method capture calls, and returning true keeps the gate's pose baseline
// moving. Re-tuning after the fact is impossible by design here — that is what
// the diagnostic is for; the values it settles on go into config.js.
export class VoxelTerrain {
  constructor({
    depthSource,
    params = DEFAULT_VOXEL_DEBUG_PARAMS,
    minObservations = VOXEL_TERRAIN_MIN_OBSERVATIONS,
    minGapMs = VOXEL_TERRAIN_MIN_GAP_MS,
    minTranslationM = VOXEL_KEYFRAME_MIN_TRANSLATION_M,
    minRotationDeg = VOXEL_KEYFRAME_MIN_ROTATION_DEG,
    // null: full resolution for counting, half for TSDF (see config).
    maxSamples = null,
    maxCells = VOXEL_TERRAIN_MAX_CELLS,
    evictBatch = VOXEL_TERRAIN_EVICT_BATCH,
    maxSolid = VOXEL_TERRAIN_MAX_SOLID,
    // 'tsdf' (default) or 'count'. TSDF can retract a voxel, so it also
    // reports onCleared; the count grid never does.
    fusion = TERRAIN_FUSIONS.TSDF,
    tsdf = {},
    onSolid = null,
    onCleared = null,
  }) {
    this.params = { ...params };
    this.minObservations = minObservations;
    this.maxCells = maxCells;
    this.evictBatch = evictBatch;
    this.maxSolid = maxSolid;
    this.fusion = fusion === TERRAIN_FUSIONS.COUNT ? TERRAIN_FUSIONS.COUNT : TERRAIN_FUSIONS.TSDF;
    this.tsdfOptions = {
      truncationVoxels: TSDF_TRUNCATION_VOXELS,
      maxWeight: TSDF_MAX_WEIGHT,
      surfaceBand: TSDF_SURFACE_BAND,
      carveStride: TSDF_CARVE_STRIDE,
      carveStartM: TSDF_CARVE_START_M,
      depthWeightRefM: TSDF_DEPTH_WEIGHT_REF_M,
      depthWeightPower: TSDF_DEPTH_WEIGHT_POWER,
      ...tsdf,
    };
    this.onSolid = onSolid;
    this.onCleared = onCleared;
    // key -> index into this.solid, so a retraction is O(1) swap-remove.
    this.solidIndex = new Map();

    this.gate = new KeyframeGate({
      minTranslationM,
      minRotationDeg,
      maxKeyframes: Infinity,
      minGapMs,
    });
    this.capture = new KeyframeCapture({
      store: this,
      gate: this.gate,
      depthSource,
      maxSamples: maxSamples
        ?? (this.fusion === TERRAIN_FUSIONS.TSDF ? TSDF_KEYFRAME_MAX_SAMPLES : VOXEL_KEYFRAME_MAX_SAMPLES),
    });

    this.grid = this._makeGrid();
    this.solid = [];
    this.revision = 0;
    this.keyframeCount = 0;
    this.lastIngestMs = 0;
    this.stats = {
      samplesTotal: 0,
      rejectedZero: 0,
      rejectedRange: 0,
      rejectedGradient: 0,
      rejectedUnproject: 0,
      accepted: 0,
      evicted: 0,
      carved: 0,   // free-space votes cast (tsdf only)
      cleared: 0,  // solid voxels later retracted (tsdf only)
    };
  }

  _makeGrid() {
    if (this.fusion === TERRAIN_FUSIONS.TSDF) {
      return new TsdfGrid({
        voxelSize: this.params.voxelSize,
        maxCells: this.maxCells,
        minWeight: this.minObservations,
        ...this.tsdfOptions,
        onSolid: (center, cell) => this._confirm(cell, center),
        onCleared: (center, cell) => this._retract(cell, center),
      });
    }
    return new VoxelGrid({
      voxelSize: this.params.voxelSize,
      maxCells: this.maxCells,
      confirmMinObservations: this.minObservations,
      onConfirmed: (cell) => this._confirm(cell, cellCenterPosition(cell, this.params.voxelSize)),
    });
  }

  _confirm(cell, center) {
    // Same shape VoxelMap produced, so OperatorView draws either map.
    if (this.solid.length < this.maxSolid) {
      const colorT = Math.min(1, Math.max(0, (center[1] + 1) / 3));
      this.solidIndex.set(cell.key, this.solid.length);
      this.solid.push({ position: center, colorT, key: cell.key });
      this.revision += 1;
    }
    this.onSolid?.(center);
  }

  _retract(cell, center) {
    const index = this.solidIndex.get(cell.key);
    if (index !== undefined) {
      const last = this.solid.length - 1;
      if (index !== last) {
        const moved = this.solid[last];
        this.solid[index] = moved;
        this.solidIndex.set(moved.key, index);
      }
      this.solid.pop();
      this.solidIndex.delete(cell.key);
      this.revision += 1;
    }
    this.stats.cleared += 1;
    this.onCleared?.(center);
  }

  // Per-frame entry point. Cheap on frames the pose gate rejects: the depth
  // read only happens once the camera has moved enough.
  update(frame, referenceSpace, time, viewerPose) {
    const pose = viewerPose
      ? { position: viewerPose.position, quaternion: viewerPose.quaternion, timeMs: time }
      : null;
    return this.capture.update(frame, referenceSpace, time, pose);
  }

  // KeyframeStore contract for KeyframeCapture. Never refuses: the keyframe is
  // consumed here and now, so there is no slot to run out of.
  add(keyframe) {
    const startedAt = now();
    this._ingest(keyframe);
    this.keyframeCount += 1;
    this.lastIngestMs = now() - startedAt;
    return true;
  }

  getCount() {
    return this.keyframeCount;
  }

  _ingest(keyframe) {
    const { nearM, farM, gradientMaxJumpM } = this.params;
    const stats = this.stats;
    if (this.fusion === TERRAIN_FUSIONS.TSDF) {
      const pass = this.grid.integrate(keyframe, { nearM, farM, gradientMaxJumpM });
      if (this.grid.isFull()) {
        // Same policy as the count grid: shed the far ends of one-look bands
        // so the map keeps growing into the next room.
        stats.evicted += this.grid.evictUnconfirmed(this.evictBatch);
      }
      stats.samplesTotal += pass.total;
      stats.rejectedZero += pass.rejectedZero;
      stats.rejectedRange += pass.rejectedRange;
      stats.rejectedGradient += pass.rejectedGradient;
      stats.rejectedUnproject += pass.rejectedUnproject;
      stats.accepted += pass.accepted;
      stats.carved += pass.carved;
      return;
    }
    const { width, height, depths, invProjectionMatrix, viewMatrix, frameId } = keyframe;
    // A keyframe's samples are all tagged with one frameId, so however many
    // land in one cell the grid counts a single observation — the per-frame
    // dedup VoxelMap lacks.
    const pass = filterDepthGrid(
      { depths, width, height },
      { nearM, farM, gradientMaxJumpM },
      (col, row, depth) => {
        const u = (col + 0.5) / width;
        const v = (row + 0.5) / height;
        const point = depthSampleToWorld(u, v, depth, invProjectionMatrix, viewMatrix);
        if (!point) {
          stats.rejectedUnproject += 1;
          return;
        }
        if (this.grid.observe(point[0], point[1], point[2], frameId) === 'full') {
          // Make room by shedding single-look cells, then retry once. If the
          // grid is genuinely full of confirmed surfaces this sample is lost,
          // which is the acceptable failure: the map stops growing, not the game.
          const evicted = this.grid.evictUnconfirmed(this.evictBatch);
          stats.evicted += evicted;
          if (evicted > 0) this.grid.observe(point[0], point[1], point[2], frameId);
        }
      },
    );
    stats.samplesTotal += pass.total;
    stats.rejectedZero += pass.rejectedZero;
    stats.rejectedRange += pass.rejectedRange;
    stats.rejectedGradient += pass.rejectedGradient;
    stats.accepted += pass.accepted;
  }

  // ── VoxelMap-compatible surface ───────────────────────────
  getSolidVoxels() {
    return this.solid;
  }

  getSolidCount() {
    return this.solid.length;
  }

  getRevision() {
    return this.revision;
  }

  getCellCount() {
    return this.grid.getCellCount();
  }

  getKeyframeCount() {
    return this.keyframeCount;
  }

  getLastIngestMs() {
    return this.lastIngestMs;
  }

  getHistogram() {
    return this.grid.getHistogram();
  }

  getStats() {
    return { ...this.stats, keyframes: this.keyframeCount, cells: this.getCellCount() };
  }

  // Every cell, not just confirmed ones: the observation count is in the
  // record, so the viewer's threshold slider still works on the export.
  exportJSON({ playerPath = [], sessionId = null } = {}) {
    // The TSDF grid also holds free-space and deep-inside cells; only the
    // ones near the zero crossing are a surface the viewer should draw.
    const cells = this.fusion === TERRAIN_FUSIONS.TSDF
      ? this.grid.getSurfaceCells()
      : this.grid.getCells();
    return JSON.stringify(voxelCellsToJSON({
      cells,
      voxelSize: this.params.voxelSize,
      keyframeCount: this.keyframeCount,
      playerPath,
      sessionId,
      source: 'keyframe',
      stats: this.getStats(),
    }));
  }

  reset() {
    this.gate.reset();
    this.capture.reset();
    this.grid = this._makeGrid();
    if (this.solid.length) this.revision += 1;
    this.solid = [];
    this.solidIndex.clear();
    this.keyframeCount = 0;
    this.lastIngestMs = 0;
    for (const key of Object.keys(this.stats)) this.stats[key] = 0;
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
