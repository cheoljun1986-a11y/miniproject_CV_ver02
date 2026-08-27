import {
  VOXEL_DEBUG_MAX_CELLS,
  VOXEL_KEYFRAME_MAX,
  VOXEL_KEYFRAME_MAX_SAMPLES,
  VOXEL_KEYFRAME_MIN_GAP_MS,
  VOXEL_KEYFRAME_MIN_ROTATION_DEG,
  VOXEL_KEYFRAME_MIN_TRANSLATION_M,
  VOXEL_REBUILD_DEBOUNCE_MS,
  VOXEL_SCAN_SECONDS,
} from './config.js';
import { KeyframeCapture } from './keyframe-capture.js';
import { KeyframeGate } from './keyframe-gate.js';
import { KeyframeStore, keyframeStoreFromJSON, rebuildVoxelGrid } from './keyframe-store.js';
import { rebuildTsdfGrid } from './tsdf-grid.js';
import {
  TSDF_CARVE_START_M,
  TSDF_CARVE_STRIDE,
  TSDF_DEPTH_WEIGHT_POWER,
  TSDF_DEPTH_WEIGHT_REF_M,
  TSDF_KEYFRAME_SAMPLE_STRIDE,
  TSDF_MAX_WEIGHT,
  TSDF_SURFACE_BAND,
  TSDF_TRUNCATION_VOXELS,
} from './config.js';
import { DEFAULT_VOXEL_DEBUG_PARAMS, applyParam } from './voxel-debug-params.js';
import { VOXEL_COLOR_MODES, VOXEL_COLOR_MODE_LABELS, nextColorMode } from './voxel-color-modes.js';
import { histogramDisplayCount, selectCells } from './voxel-grid.js';

// Owns the scan lifecycle: gate -> capture -> store -> rebuild -> render cells.
// Keeps the raw keyframes so every filter parameter is re-tunable offline.
export class VoxelDebugController {
  constructor({
    depthSource,
    params = DEFAULT_VOXEL_DEBUG_PARAMS,
    scanSeconds = VOXEL_SCAN_SECONDS,
    maxKeyframes = VOXEL_KEYFRAME_MAX,
    maxCells = VOXEL_DEBUG_MAX_CELLS,
    // Which fusion the stop-of-scan rebuild runs. 'tsdf' is the default so the
    // AR overlay shows the same kind of map the game plays on; 'count' keeps
    // the original hit counting for A/B (?voxel=debug&fusion=count).
    fusion = 'tsdf',
    now = () => (typeof performance !== 'undefined' ? performance.now() : 0),
  }) {
    this.scanSeconds = scanSeconds;
    this.maxKeyframes = maxKeyframes;
    this.maxCells = maxCells;
    this.fusion = fusion === 'count' ? 'count' : 'tsdf';
    this.now = now;
    this.params = { ...params };

    this.store = new KeyframeStore({ maxKeyframes });
    this.gate = new KeyframeGate({
      minTranslationM: VOXEL_KEYFRAME_MIN_TRANSLATION_M,
      minRotationDeg: VOXEL_KEYFRAME_MIN_ROTATION_DEG,
      maxKeyframes,
      minGapMs: VOXEL_KEYFRAME_MIN_GAP_MS,
    });
    this.capture = new KeyframeCapture({
      store: this.store,
      gate: this.gate,
      depthSource,
      maxSamples: VOXEL_KEYFRAME_MAX_SAMPLES,
    });

    this.colorMode = VOXEL_COLOR_MODES.OBSERVATION;
    this.grid = null;
    this.tsdf = null;
    this.stats = null;
    this.renderCells = [];
    this.revision = 0;
    this.rebuildCount = 0;
    this.dirtyAt = null;
    this.scanStartedAt = null;
    this.scanEndsAt = null;
    this.imported = false;
  }

  startScan(time) {
    this.scanStartedAt = time;
    this.scanEndsAt = time + this.scanSeconds * 1000;
  }

  stopScan(time) {
    this.scanEndsAt = Math.min(this.scanEndsAt ?? time, time);
    this._rebuild();
  }

  isScanning(time) {
    return this.scanEndsAt !== null && time < this.scanEndsAt
      && this.store.getCount() < this.maxKeyframes;
  }

  getScanLeftSec(time) {
    if (this.scanEndsAt === null) return 0;
    return Math.max(0, (this.scanEndsAt - time) / 1000);
  }

  update(frame, referenceSpace, time, viewerPose) {
    if (this.imported) return false;
    if (!this.isScanning(time)) {
      // One rebuild at the moment the scan window closes.
      if (this.scanEndsAt !== null && this.grid === null) this._rebuild();
      return false;
    }
    const pose = viewerPose
      ? { position: viewerPose.position, quaternion: viewerPose.quaternion, timeMs: time }
      : null;
    return this.capture.update(frame, referenceSpace, time, pose);
  }

  setParam(id, value) {
    const result = applyParam(this.params, id, value);
    if (!result.changed) return result;
    this.params = result.params;

    if (result.needsRebuild) {
      // Debounced: a slider drag emits dozens of events and each rebuild walks
      // every stored depth pixel.
      this.dirtyAt = this.now();
    } else {
      // A render-time filter. Bump the revision so the renderers pick up the
      // new selection without re-walking the keyframes.
      this._selectRenderCells();
    }
    return result;
  }

  rebuildIfDirty() {
    if (this.dirtyAt === null) return false;
    if (this.now() - this.dirtyAt < VOXEL_REBUILD_DEBOUNCE_MS) return false;
    this.dirtyAt = null;
    this._rebuild();
    return true;
  }

  _rebuild() {
    const common = {
      voxelSize: this.params.voxelSize,
      nearM: this.params.nearM,
      farM: this.params.farM,
      gradientMaxJumpM: this.params.gradientMaxJumpM,
      now: this.now,
    };
    const { grid, stats, tsdf } = this.fusion === 'tsdf'
      ? rebuildTsdfGrid(this.store.getKeyframes(), {
        ...common,
        minObservations: this.params.minObservations,
        // Room-sized TSDF holds several times more cells than the hit-count
        // grid: free space and the band behind each surface are cells too.
        maxCells: this.maxCells * 20,
        sampleStride: TSDF_KEYFRAME_SAMPLE_STRIDE,
        truncationVoxels: TSDF_TRUNCATION_VOXELS,
        maxWeight: TSDF_MAX_WEIGHT,
        surfaceBand: TSDF_SURFACE_BAND,
        carveStride: TSDF_CARVE_STRIDE,
        carveStartM: TSDF_CARVE_START_M,
        depthWeightRefM: TSDF_DEPTH_WEIGHT_REF_M,
        depthWeightPower: TSDF_DEPTH_WEIGHT_POWER,
      })
      : rebuildVoxelGrid(this.store.getKeyframes(), { ...common, maxCells: this.maxCells });
    this.grid = grid;
    // The signed-distance field itself, kept alongside the surface-cell view.
    // `grid` only exposes cells near the zero crossing, which is what the voxel
    // renderers want but useless for meshing: Surface Nets has to see the sign
    // FLIP, so it needs the free-space cells the adapter filters out.
    this.tsdf = tsdf ?? null;
    this.stats = stats;
    this.rebuildCount += 1;
    this._selectRenderCells();
  }

  _selectRenderCells() {
    this.renderCells = this.grid
      ? selectCells(this.grid.getCells(), { minObservations: this.params.minObservations })
      : [];
    this.revision += 1;
  }

  // The fused field, or null when this scan was hit-counted (?fusion=count) or
  // loaded from a game export — neither carries signed distances to mesh.
  getTsdfField() {
    return this.tsdf;
  }

  getRenderCells() {
    return this.renderCells;
  }

  getRevision() {
    return this.revision;
  }

  getRebuildCount() {
    return this.rebuildCount;
  }

  getCellCount() {
    return this.grid?.getCellCount() ?? 0;
  }

  getKeyframePoses() {
    return this.store.getKeyframes().map((k) => ({ viewMatrix: k.viewMatrix }));
  }

  cycleColorMode() {
    this.colorMode = nextColorMode(this.colorMode);
    this.revision += 1;
    return this.colorMode;
  }

  getColorMode() {
    return this.colorMode;
  }

  getParams() {
    return this.params;
  }

  isImported() {
    return this.imported;
  }

  getStats(time = this.now()) {
    const histogram = this.stats?.histogram ?? null;
    return {
      scanning: this.isScanning(time),
      scanLeftSec: this.getScanLeftSec(time),
      keyframeCount: this.store.getCount(),
      maxKeyframes: this.maxKeyframes,
      elapsedMs: this.store.getElapsedMs(),
      cellCount: this.getCellCount(),
      displayedCount: histogram
        ? histogramDisplayCount(histogram, this.params.minObservations)
        : 0,
      truncated: this.stats?.truncated ?? false,
      histogram,
      colorMode: VOXEL_COLOR_MODE_LABELS[this.colorMode],
      params: this.params,
      buildMs: this.stats?.buildMs ?? 0,
      rejected: {
        zero: this.stats?.rejectedZero ?? 0,
        range: this.stats?.rejectedRange ?? 0,
        gradient: this.stats?.rejectedGradient ?? 0,
        accepted: this.stats?.accepted ?? 0,
      },
      imported: this.imported,
      firstViewerPosition: this.store.getFirstViewerPosition(),
    };
  }

  exportJSON() {
    return JSON.stringify(this.store.toJSON());
  }

  // Imported world coordinates belong to a different XR local space origin, so
  // main.js force-disables the in-AR overlay while isImported() is true.
  importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    const store = keyframeStoreFromJSON(parsed);
    if (!store) return false;

    this.store = store;
    this.maxKeyframes = Math.max(store.getCount(), this.maxKeyframes);
    this.imported = true;
    this.scanEndsAt = null;
    this._rebuild();
    return true;
  }

  reset() {
    this.store.reset();
    this.gate.reset();
    this.capture.reset();
    this.grid = null;
    this.tsdf = null;
    this.stats = null;
    this.renderCells = [];
    this.dirtyAt = null;
    this.scanStartedAt = null;
    this.scanEndsAt = null;
    this.imported = false;
    this.revision += 1;
  }
}
