import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

import {
  APP_MODES,
  autoStartsGame,
  depthUsageForSession,
  resolveAppMode,
  usesDepthCloud,
  usesSpaceMapping,
  usesVoxelOccluder,
} from './app-mode.js';
import {
  HIDDEN_MODEL_HEIGHT_M,
  HIDDEN_MODEL_URL,
  HORIZONTAL_SURFACE_THRESHOLD,
  MAP_SECONDS,
  MAX_TRACKING_STEP,
  MIN_CANDIDATE_SPACING,
  NINJA_CAMOUFLAGE_OPACITY,
  OPERATOR_RENDER_GAP_MS,
  OPERATOR_STATUS_GAP_MS,
  TRAIL_MAX_POINTS,
  TRAIL_MIN_STEP_M,
  VOXEL_DEBUG_MAX_INSTANCES,
  VOXEL_OCCLUDER_MIN_OBSERVATIONS,
  VOXEL_TRAVERSAL_MIN_OBSERVATIONS,
  VOXEL_MAX_SOLID,
  VOXEL_MAX_PENDING,
  VOXEL_SIZE_M,
  VOXEL_SOLID_MIN_HITS,
} from './config.js';
import { CpuDepthFrameSource } from './cpu-depth-frame-source.js';
import { TraversalGrid, nodeKey } from './traversal-grid.js';
import { ChaseRunner } from './chase-runner.js';
import {
  CaptureGauge, angleToTargetDeg, directionInViewSpace, screenAngleFromViewDirection,
} from './capture-gauge.js';
import { forwardFromQuaternion } from './game-rules.js';
import {
  CHASE_BODY_HEIGHT_M,
  CHASE_CELL_SIZE_M,
  CHASE_GRID_MIN_Y,
  CHASE_GRID_REBUILD_GAP_MS,
  CHASE_GRID_SLABS,
  CHASE_MAX_DROP_M,
  CHASE_MAX_JUMP_UP_M,
  CHASE_MAX_STAND_ABOVE_FLOOR_M,
  CHASE_MAX_STEP_UP_M,
  CHASE_MIN_WALKABLE_CELLS,
  CHASE_RECENT_WINDOW_MS,
  CHASE_RETARGET_MS,
  CHASE_SLAB_HEIGHT_M,
  CHASE_STUCK_MS,
} from './config.js';
import { CpuDepthOccluder } from './cpu-depth-occluder.js';
import { DepthCloud } from './depth-cloud.js';
import { loadHiddenModel } from './hidden-model-loader.js';
import { NinjaGame } from './ninja-game.js';
import * as ninjaModel from './ninja-model.js';
import { OperatorView } from './operator-view.js';
import { PlayerTrail } from './player-trail.js';
import { SpatialMapper } from './spatial-mapper.js';
import {
  createUI,
  formatMetrics,
  formatOperatorStatus,
  formatVoxelDebugStatus,
  formatVoxelDebugSummary,
} from './ui.js';
import { confirmedCellPositions } from './voxel-grid.js';
import { VoxelDebugController } from './voxel-debug-controller.js';
import { createVoxelDebugPanel } from './voxel-debug-panel.js';
import { VoxelMap } from './voxel-map.js';
import { VoxelOccluder } from './voxel-occluder.js';
import { VoxelOverlay } from './voxel-overlay.js';
import { XRSessionController } from './xr-session.js';

// A WebXR session uses one depth mode. CPU mode shares that single feed between
// the latest occlusion mesh and the slower cumulative operator map.
const APP_MODE = resolveAppMode(location.search);
const CLOUD_MODE = APP_MODE === APP_MODES.CLOUD;
const CPU_OCCLUSION_MODE = APP_MODE === APP_MODES.CPU_OCCLUSION;
const GPU_OCCLUSION_MODE = APP_MODE === APP_MODES.GPU_OCCLUSION;
const VOXEL_DEBUG_MODE = APP_MODE === APP_MODES.VOXEL_DEBUG;
// Orthogonal to the depth pipeline: the static occluder composes with any mode
// but needs the keyframe scan, hence the space-mapping wiring.
const VOXEL_OCCLUDER_ON = usesVoxelOccluder(location.search);
const KEYFRAME_SCAN_MODE = VOXEL_DEBUG_MODE || VOXEL_OCCLUDER_ON;
const SPACE_MAPPING_MODE = usesSpaceMapping(APP_MODE) || VOXEL_OCCLUDER_ON;
const DEPTH_CLOUD_MODE = usesDepthCloud(APP_MODE);

const ui = createUI();
let scene;
let camera;
let renderer;
let controller;
let reticle;
let mapper;
let xrSession;
let game;
let depthSource = null;
let depthCloud = null;
let occluder = null; // depth-sensing occlusion mesh (real world hides the ninja)
let cpuDepthOccluder = null;
let voxelMap = null;
let playerTrail = null;
let operatorView = null;
let operatorVisible = false;

// ── chase mode ────────────────────────────────────────────────
// Only wired up on the chase page, which is the only one carrying #chaseBtn.
let chaseGrid = null;
let chaseRunner = null;
let captureGauge = null;
let chaseActive = false;
let lastChaseTime = null;
let chaseTiles = null;
let chaseTilesRevision = -1;
let lastTileBuildAt = -Infinity;
let lastOperatorStatusTime = -Infinity;
let lastOperatorRenderTime = -Infinity;
let operatorVoxelRevision = -1;
let operatorSolidVoxels = [];
let voxelDebug = null;
let voxelOverlay = null;
let voxelPanel = null;
let voxelOccluder = null;
let chaseFedRevision = -1;

init();

async function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 50);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 2.4));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
  directionalLight.position.set(1, 2, 1);
  scene.add(directionalLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  document.body.appendChild(renderer.domElement);

  reticle = ninjaModel.makeReticle();
  scene.add(reticle);

  mapper = new SpatialMapper({
    minCandidateSpacing: MIN_CANDIDATE_SPACING,
    maxTrackingStep: MAX_TRACKING_STEP,
    horizontalThreshold: HORIZONTAL_SURFACE_THRESHOLD,
  });
  xrSession = new XRSessionController({
    renderer,
    reticle,
    onHitTestError() {
      ui.setStatus('Hit-test 생성 실패');
    },
  });
  game = new NinjaGame({
    scene,
    ui,
    mapper,
    model: ninjaModel,
    getSession: () => xrSession.getSession(),
    getLocalSpace: () => xrSession.getLocalSpace(),
    getViewerPose: () => xrSession.getViewerPose(),
  });

  controller = renderer.xr.getController(0);
  controller.addEventListener('select', () => game.triggerScan());
  scene.add(controller);

  ui.bindCommands({
    // SCAN is hidden during a chase; ignore it defensively all the same.
    onScan: () => { if (!chaseActive) game.triggerScan(); },
    onNewRound: () => game.hideNewTarget(),
    onExtend: () => game.startMapping(MAP_SECONDS, false),
    onMark: () => game.saveCheckpoint(),
    onCheck: () => game.checkReturnError(),
  });
  // No hold handlers: capture now needs only range plus aim, so SCAN keeps its
  // ordinary tap behaviour and never sees a long press.
  ui.bindChase({ onToggle: toggleChase });
  addEventListener('resize', onResize);

  const supported = Boolean(navigator.xr)
    && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) {
    ui.setStatus('WebXR immersive-ar 미지원');
    ui.showFallback('navigator.xr 또는 immersive-ar 지원을 찾지 못했습니다.');
    return;
  }

  // Fetch the hiding model before the session can start. A failure here is not
  // fatal: createNinja keeps drawing the built-in ninja.
  ui.setStatus('숨을 모델 불러오는 중…');
  try {
    ninjaModel.setHiddenTemplate(
      await loadHiddenModel(HIDDEN_MODEL_URL, HIDDEN_MODEL_HEIGHT_M),
    );
  } catch (error) {
    console.error('Hidden model unavailable, using the built-in ninja:', error);
  }

  ui.setStatus(VOXEL_DEBUG_MODE
    ? 'WebXR AR 지원됨 (복셀 진단 모드) — START AR을 누르세요'
    : CLOUD_MODE
      ? 'WebXR AR 지원됨 (공간 복원 모드) — START AR을 누르세요'
      : CPU_OCCLUSION_MODE
        ? 'WebXR AR 지원됨 (CPU 깊이 가림 모드) — START AR을 누르세요'
        : 'WebXR AR 지원됨 — START AR을 누르세요');
  if (SPACE_MAPPING_MODE) {
    depthSource = new CpuDepthFrameSource({
      getSession: () => xrSession.getSession(),
    });
    if (ui.hasChaseControls()) {
      chaseGrid = new TraversalGrid({
        cellSize: CHASE_CELL_SIZE_M,
        slabHeight: CHASE_SLAB_HEIGHT_M,
        minY: CHASE_GRID_MIN_Y,
        slabCount: CHASE_GRID_SLABS,
        headroom: CHASE_BODY_HEIGHT_M,
        maxStepUp: CHASE_MAX_STEP_UP_M,
        maxJumpUp: CHASE_MAX_JUMP_UP_M,
        maxDropDown: CHASE_MAX_DROP_M,
        maxStandAboveFloor: CHASE_MAX_STAND_ABOVE_FLOOR_M,
      });
      chaseRunner = new ChaseRunner({
        grid: chaseGrid,
        retargetMs: CHASE_RETARGET_MS,
        stuckMs: CHASE_STUCK_MS,
        recentWindowMs: CHASE_RECENT_WINDOW_MS,
      });
      captureGauge = new CaptureGauge();
    }
    playerTrail = new PlayerTrail({
      minStep: TRAIL_MIN_STEP_M,
      maxPoints: TRAIL_MAX_POINTS,
    });
    if (DEPTH_CLOUD_MODE && !KEYFRAME_SCAN_MODE) {
      voxelMap = new VoxelMap({
        voxelSize: VOXEL_SIZE_M,
        solidMinHits: VOXEL_SOLID_MIN_HITS,
        maxSolid: VOXEL_MAX_SOLID,
        maxPending: VOXEL_MAX_PENDING,
        // One cell touched per confirmed voxel — never a full grid rebuild.
        onSolid: chaseGrid ? (center) => chaseGrid.observe(center) : null,
      });
      depthCloud = new DepthCloud({
        scene,
        voxelMap,
        renderPoints: false,
        depthSource,
      });
    }
    if (KEYFRAME_SCAN_MODE) {
      // Keyframe-gated capture with per-frame dedup, replacing DepthCloud's
      // 200ms timer which lets a single frame promote a voxel on its own.
      voxelDebug = new VoxelDebugController({ depthSource });
    }
    if (VOXEL_DEBUG_MODE) {
      voxelOverlay = new VoxelOverlay({ scene });
    }
    if (KEYFRAME_SCAN_MODE) {
      // Built in the diagnostic too, so the wireframe can be checked against
      // it, but only shown automatically when it is the point of the session.
      voxelOccluder = new VoxelOccluder({ scene });
    }
    if (CPU_OCCLUSION_MODE) {
      cpuDepthOccluder = new CpuDepthOccluder({ scene, depthSource });
    }
    try {
      operatorView = new OperatorView({
        canvas: ui.getOperatorCanvas(),
        maxVoxels: VOXEL_DEBUG_MODE ? VOXEL_DEBUG_MAX_INSTANCES : VOXEL_MAX_SOLID,
      });
      ui.setOperatorButtonVisible(true);
      ui.bindOperator({
        onToggle(visible) {
          operatorVisible = visible;
          ui.setOperatorVisible(visible);
        },
      });
    } catch (error) {
      console.error('Operator view unavailable:', error);
      operatorView = null;
    }
    if (VOXEL_DEBUG_MODE) {
      voxelPanel = createVoxelDebugPanel({
        root: document.querySelector('#hud'),
        controller: voxelDebug,
        overlay: voxelOverlay,
        operatorView,
        onOperatorToggle: () => {
          operatorVisible = !operatorVisible;
          ui.setOperatorVisible(operatorVisible);
        },
        onStartGame: () => {
          game.startSession();
          // Starting the game in the diagnostic has exactly one purpose:
          // watching whether the character hides. Leaving the occluder off
          // makes that test silently measure nothing.
          voxelOccluder?.setVisible(true);
        },
        occluder: voxelOccluder,
      });
      // Nothing on the legacy metrics card applies while the game is idle, and
      // the panel already reports everything else.
      ui.setMetricsVisible(false);
    }
  }

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['anchors', 'dom-overlay', 'local-floor', 'depth-sensing'],
    // gpu-optimized feeds three's built-in mesh. CPU modes let this app read
    // samples for either point-cloud reconstruction or our dynamic occluder.
    depthSensing: {
      usagePreference: [depthUsageForSession(APP_MODE, VOXEL_OCCLUDER_ON)],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
    domOverlay: { root: document.body },
  });
  document.body.appendChild(arButton);

  renderer.xr.addEventListener('sessionstart', async () => {
    detachOccluder();
    depthSource?.reset();
    cpuDepthOccluder?.reset();
    resetChaseState();
    depthCloud?.reset();
    voxelMap?.reset();
    playerTrail?.reset();
    lastOperatorStatusTime = -Infinity;
    lastOperatorRenderTime = -Infinity;
    operatorVoxelRevision = -1;
    operatorSolidVoxels = [];
    voxelDebug?.reset();
    voxelOverlay?.clear();
    voxelOccluder?.reset();
    chaseFedRevision = -1;
    voxelDebug?.startScan(performance.now());
    await xrSession.start();
    if (autoStartsGame(APP_MODE)) game.startSession();
  });
  renderer.xr.addEventListener('sessionend', () => {
    detachOccluder();
    depthSource?.reset();
    cpuDepthOccluder?.reset();
    resetChaseState();
    depthCloud?.reset();
    voxelMap?.reset();
    playerTrail?.reset();
    lastOperatorStatusTime = -Infinity;
    lastOperatorRenderTime = -Infinity;
    operatorVoxelRevision = -1;
    operatorSolidVoxels = [];
    voxelDebug?.reset();
    voxelOverlay?.clear();
    voxelOccluder?.reset();
    operatorVisible = false;
    ui.setOperatorVisible(false);
    if (autoStartsGame(APP_MODE)) game.endSession();
    xrSession.end();
  });
  renderer.setAnimationLoop(render);
}

// Once ARCore delivers a depth map, three exposes a full-screen mesh that writes
// real-world depth into the depth buffer. We make it depth-only and render it
// first, so any virtual object behind a real surface is depth-tested away — a
// hand, a body, or a pillar now hides the ninja instead of showing through it.
function maybeAttachOccluder() {
  if (occluder || !renderer.xr.hasDepthSensing?.()) return;
  const mesh = renderer.xr.getDepthSensingMesh?.();
  if (!mesh) return;
  mesh.material.colorWrite = false; // depth only — don't paint over the camera feed
  mesh.renderOrder = -1;            // fill the depth buffer before the ninja draws
  mesh.frustumCulled = false;       // vertex shader outputs clip space directly
  scene.add(mesh);
  occluder = mesh;
}

function detachOccluder() {
  if (!occluder) return;
  scene.remove(occluder);
  occluder = null; // three recreates the mesh for the next session
}

// ── chase mode ────────────────────────────────────────────────
function resetChaseState() {
  if (!chaseRunner) return;
  chaseActive = false;
  lastChaseTime = null;
  chaseRunner.reset();
  chaseGrid.reset();
  captureGauge.reset();
  chaseTiles = null;
  chaseTilesRevision = -1;
  lastTileBuildAt = -Infinity;
  ui.setChaseVisible(false);
  ui.setChaseArrow(null);
  ui.setChaseButton('도망 모드', true);
  ui.setScanVisible(true);
}

function stopChase(message) {
  if (!chaseRunner) return;
  chaseActive = false;
  chaseRunner.stop();
  game.setExternalControl(false);
  game.setTargetOpacity(NINJA_CAMOUFLAGE_OPACITY);
  ui.setChaseVisible(false);
  ui.setChaseArrow(null);
  ui.setChaseButton('도망 모드', true);
  ui.setScanVisible(true);
  if (message) ui.setMessage(message);
}

function toggleChase() {
  if (!chaseRunner || !chaseGrid) return;
  if (chaseActive) {
    stopChase('도망 모드를 껐습니다.');
    return;
  }

  const target = game.getTargetPosition();
  if (!target) {
    ui.setMessage('먼저 스캔을 끝내고 하츄핑이 숨은 뒤에 시작하세요.');
    return;
  }
  const { walkable } = chaseGrid.stats();
  if (walkable < CHASE_MIN_WALKABLE_CELLS) {
    ui.setMessage(`지도가 아직 부족합니다 — 갈 수 있는 칸 ${walkable}/${CHASE_MIN_WALKABLE_CELLS}. 더 걸으며 비춰주세요.`);
    return;
  }
  if (!chaseRunner.start(target, performance.now())) {
    ui.setMessage('하츄핑이 설 자리를 찾지 못했습니다. 주변 바닥을 더 비춰주세요.');
    return;
  }

  captureGauge.reset();
  chaseActive = true;
  lastChaseTime = null;
  game.setExternalControl(true);
  game.setTargetOpacity(1);
  ui.setChaseVisible(true);
  ui.setChaseGauge(0);
  ui.setChaseButton('도망 모드 끄기', true);
  ui.setScanVisible(false);
  ui.setStatus('하츄핑이 도망칩니다');
  ui.setMessage('1.2m 안까지 쫓아가 화면 중앙에 5초간 담아두세요.');
}

function updateChase(time, viewerPose) {
  if (!chaseActive || !chaseRunner?.isActive()) return;

  const dt = lastChaseTime === null
    ? 0
    : Math.min(0.1, Math.max(0, (time - lastChaseTime) / 1000));
  lastChaseTime = time;
  if (dt <= 0) return;

  // Losing tracking must not hand Hachuping a free head start.
  chaseRunner.setFrozen(!viewerPose);
  const state = chaseRunner.update(dt, {
    playerPosition: viewerPose ? viewerPose.position : null,
    now: time,
    speedMultiplier: captureGauge.speedMultiplier(),
  });
  if (state.position) {
    game.setTargetWorldPosition(
      [state.position[0], state.visualY, state.position[2]],
      state.headingAngle,
    );
  }

  if (!viewerPose || !state.position) {
    ui.setChaseHint('추적 대기 중');
    return;
  }

  const forward = forwardFromQuaternion(viewerPose.quaternion);
  const dx = state.position[0] - viewerPose.position[0];
  const dy = state.position[1] - viewerPose.position[1];
  const dz = state.position[2] - viewerPose.position[2];
  const distance = Math.hypot(dx, dy, dz);
  const angleDeg = angleToTargetDeg(forward, viewerPose.position, state.position);
  const capture = captureGauge.update(dt, { distance, angleDeg });

  ui.setChaseGauge(capture.value);
  ui.setChaseHint(`${captureGauge.hint()}  ·  ${distance.toFixed(1)}m`);
  ui.setChaseArrow(angleDeg > 35
    ? screenAngleFromViewDirection(
      directionInViewSpace(viewerPose.quaternion, viewerPose.position, state.position),
    )
    : null);

  if (capture.captured) {
    stopChase(`검거 성공! ${distance.toFixed(2)}m 에서 잡았습니다.`);
    ui.setStatus('하츄핑 검거 완료');
    ui.setChaseGauge(1);
    ui.flash();
  }
}

function buildChaseTiles(time) {
  if (!chaseGrid) return;
  if (time - lastTileBuildAt < CHASE_GRID_REBUILD_GAP_MS) return;
  if (chaseGrid.getRevision() === chaseTilesRevision) return;
  lastTileBuildAt = time;
  chaseTilesRevision = chaseGrid.getRevision();
  const reachable = chaseRunner?.getReachable() ?? null;
  chaseTiles = chaseGrid.toOverlay().map((tile) => ({
    ...tile,
    // null = unknown (no chase running yet), so it just draws green.
    reachable: !tile.walkable || !reachable
      ? null
      : reachable.has(nodeKey(tile.cx, tile.cz, tile.level)),
  }));
}

function render(time, frame) {
  if (!frame) {
    renderer.render(scene, camera);
    return;
  }

  const { viewerPose, surface } = xrSession.update(frame);
  if (viewerPose) mapper.recordViewer(viewerPose.position);
  game.update(time, frame, surface);

  if (SPACE_MAPPING_MODE) {
    const localSpace = xrSession.getLocalSpace();
    if (CPU_OCCLUSION_MODE) {
      cpuDepthOccluder?.update(frame, localSpace, time);
    }
    if (KEYFRAME_SCAN_MODE) {
      voxelDebug.update(frame, localSpace, time, viewerPose);
      voxelDebug.rebuildIfDirty();
      maybeBuildVoxelOccluder();
      maybeFeedChaseGrid();
    }
    if (!KEYFRAME_SCAN_MODE) {
      depthCloud?.update(frame, localSpace, time);
    }
    if (viewerPose) playerTrail?.record(viewerPose.position);
    updateChase(time, viewerPose);
    if (operatorVisible) buildChaseTiles(time);

    const ninjaPosition = game.getTargetPosition();
    const voxelCount = voxelMap?.getSolidCount() ?? voxelDebug?.getCellCount() ?? 0;
    if (time - lastOperatorStatusTime >= OPERATOR_STATUS_GAP_MS) {
      lastOperatorStatusTime = time;
      if (VOXEL_DEBUG_MODE) {
        const stats = voxelDebug.getStats(time);
        voxelPanel?.setStatus(formatVoxelDebugStatus(stats));
        voxelPanel?.refresh();
        ui.setOperatorStatus(formatVoxelDebugSummary(stats));
      } else {
        ui.setOperatorStatus(formatOperatorStatus({
          anchorState: game.getAnchorState(),
          voxelCount,
          ninjaPosition,
          playerPosition: viewerPose?.position ?? null,
          pathPointCount: playerTrail?.getCount() ?? 0,
        }));
      }
    }
    if (
      operatorVisible
      && operatorView
      && time - lastOperatorRenderTime >= OPERATOR_RENDER_GAP_MS
    ) {
      lastOperatorRenderTime = time;
      if (VOXEL_DEBUG_MODE) {
        const revision = voxelDebug.getRevision();
        operatorView.setVoxelSize(voxelDebug.getParams().voxelSize);
        operatorView.setVoxelCells(
          voxelDebug.getRenderCells(),
          revision,
          voxelDebug.getColorMode(),
        );
        operatorView.setKeyframePoses(voxelDebug.getKeyframePoses());
        operatorView.render({
          solidVoxels: null,
          voxelRevision: revision,
          ninjaPos: ninjaPosition,
          playerPos: viewerPose?.position ?? null,
          playerPath: playerTrail.getPoints(),
        });
      } else {
        const voxelRevision = voxelMap.getRevision();
        if (voxelRevision !== operatorVoxelRevision) {
          operatorVoxelRevision = voxelRevision;
          operatorSolidVoxels = voxelMap.getSolidVoxels();
        }
        operatorView.render({
          gridTiles: chaseTiles,
          gridRevision: chaseTilesRevision,
          cellSize: CHASE_CELL_SIZE_M,
          chasePath: chaseActive ? chaseRunner?.remainingPathWorld() : null,
          hachupingPos: chaseActive ? chaseRunner?.position : null,
          solidVoxels: operatorSolidVoxels,
          voxelRevision,
          ninjaPos: ninjaPosition,
          playerPos: viewerPose?.position ?? null,
          playerPath: playerTrail.getPoints(),
        });
      }
    }
    if (VOXEL_DEBUG_MODE && voxelOverlay?.isVisible()) {
      voxelOverlay.setVoxelSize(voxelDebug.getParams().voxelSize);
      voxelOverlay.setCells(
        voxelDebug.getRenderCells(),
        voxelDebug.getRevision(),
        voxelDebug.getColorMode(),
        { cameraPosition: viewerPose?.position ?? null },
      );
    }
  } else if (GPU_OCCLUSION_MODE) {
    maybeAttachOccluder();
  }
  if (!VOXEL_DEBUG_MODE) updateMetrics(viewerPose);
  renderer.render(scene, camera);
}

// Hands the keyframe reconstruction to the chase terrain. Without this the
// grid starves in keyframe mode, since it was only ever fed through
// VoxelMap.onSolid, which fires off the DepthCloud path this mode replaces.
//
// The rebuild is wholesale rather than incremental: a threshold change can
// remove cells as well as add them, and TraversalGrid accumulates, so it has
// to start clean. A few thousand points once per rebuild is cheap.
function maybeFeedChaseGrid() {
  if (!chaseGrid || !voxelDebug) return;
  if (voxelDebug.isScanning(performance.now())) return;
  if (voxelDebug.getRevision() === chaseFedRevision) return;
  chaseFedRevision = voxelDebug.getRevision();

  const points = confirmedCellPositions(voxelDebug.getRenderCells(), {
    minObservations: VOXEL_TRAVERSAL_MIN_OBSERVATIONS,
    voxelSize: voxelDebug.getParams().voxelSize,
  });
  chaseGrid.reset();
  chaseGrid.observeAll(points);
}

// The occluder is static: built when the scan settles and left alone. Only a
// slider in the diagnostic can change the cell set afterwards, which the
// revision gate picks up. Confidence threshold is deliberately higher than the
// display default — a single-observation voxel writing depth would hide the
// character behind noise.
function maybeBuildVoxelOccluder() {
  if (!voxelOccluder || !voxelDebug) return;
  if (voxelDebug.isScanning(performance.now())) return;

  const cells = voxelDebug.getRenderCells()
    .filter((c) => c.observationCount >= VOXEL_OCCLUDER_MIN_OBSERVATIONS);
  voxelOccluder.setVoxelSize(voxelDebug.getParams().voxelSize);
  voxelOccluder.build(cells, voxelDebug.getRevision());
  // In game mode it should start occluding as soon as it exists; in the
  // diagnostic the panel owns the toggle so the wireframe stays inspectable.
  if (!VOXEL_DEBUG_MODE) voxelOccluder.setVisible(true);
}

function updateMetrics(viewerPose) {
  if (!viewerPose) {
    ui.setMetrics('pose: tracking 대기 중');
    return;
  }

  const spatial = mapper.getMetrics();
  const gameState = game.getState();
  let depthUsage = null;
  let depthDataFormat = null;
  const session = xrSession.getSession();
  if (session) {
    try {
      depthUsage = session.depthUsage;
      depthDataFormat = session.depthDataFormat;
    } catch {
      // Access throws when depth-sensing was not enabled for this session.
    }
  }
  ui.setMetrics(formatMetrics({
    viewerPosition: viewerPose.position,
    pathDistance: spatial.pathDistance,
    maxDisplacement: spatial.maxDisplacement,
    poolCount: spatial.poolCount,
    hitTestFound: xrSession.hasHitTest(),
    phase: gameState.phase,
    mappingLeft: gameState.mappingLeft,
    scans: gameState.scans,
    misses: gameState.misses,
    lastReturnError: spatial.lastReturnError,
    occlusionMode: CPU_OCCLUSION_MODE
      ? 'cpu'
      : GPU_OCCLUSION_MODE && renderer.xr.hasDepthSensing?.() ? 'gpu' : null,
    occlusionTriangles: cpuDepthOccluder?.getTriangleCount() ?? 0,
    voxelCount: SPACE_MAPPING_MODE
      ? (voxelMap?.getSolidCount() ?? voxelDebug?.getCellCount() ?? 0)
      : null,
    depthUsage,
    depthDataFormat,
    anchorState: game.getAnchorState(),
  }));
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
