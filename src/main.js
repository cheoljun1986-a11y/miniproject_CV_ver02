import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

import {
  APP_MODES,
  depthUsageForMode,
  resolveAppMode,
  usesSpaceMapping,
} from './app-mode.js';
import {
  HIDDEN_MODEL_HEIGHT_M,
  HIDDEN_MODEL_URL,
  HORIZONTAL_SURFACE_THRESHOLD,
  MAP_SECONDS,
  MAX_TRACKING_STEP,
  MIN_CANDIDATE_SPACING,
  OPERATOR_RENDER_GAP_MS,
  OPERATOR_STATUS_GAP_MS,
  TRAIL_MAX_POINTS,
  TRAIL_MIN_STEP_M,
  VOXEL_MAX_SOLID,
  VOXEL_MAX_PENDING,
  VOXEL_SIZE_M,
  VOXEL_SOLID_MIN_HITS,
} from './config.js';
import { CpuDepthFrameSource } from './cpu-depth-frame-source.js';
import { CpuDepthOccluder } from './cpu-depth-occluder.js';
import { DepthCloud } from './depth-cloud.js';
import { loadHiddenModel } from './hidden-model-loader.js';
import { NinjaGame } from './ninja-game.js';
import * as ninjaModel from './ninja-model.js';
import { OperatorView } from './operator-view.js';
import { PlayerTrail } from './player-trail.js';
import { SpatialMapper } from './spatial-mapper.js';
import { createUI, formatMetrics, formatOperatorStatus } from './ui.js';
import { VoxelMap } from './voxel-map.js';
import { XRSessionController } from './xr-session.js';

// A WebXR session uses one depth mode. CPU mode shares that single feed between
// the latest occlusion mesh and the slower cumulative operator map.
const APP_MODE = resolveAppMode(location.search);
const CLOUD_MODE = APP_MODE === APP_MODES.CLOUD;
const CPU_OCCLUSION_MODE = APP_MODE === APP_MODES.CPU_OCCLUSION;
const GPU_OCCLUSION_MODE = APP_MODE === APP_MODES.GPU_OCCLUSION;
const SPACE_MAPPING_MODE = usesSpaceMapping(APP_MODE);

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
let lastOperatorStatusTime = -Infinity;
let lastOperatorRenderTime = -Infinity;
let operatorVoxelRevision = -1;
let operatorSolidVoxels = [];

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
    onScan: () => game.triggerScan(),
    onNewRound: () => game.hideNewTarget(),
    onExtend: () => game.startMapping(MAP_SECONDS, false),
    onMark: () => game.saveCheckpoint(),
    onCheck: () => game.checkReturnError(),
  });
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

  ui.setStatus(CLOUD_MODE
    ? 'WebXR AR 지원됨 (공간 복원 모드) — START AR을 누르세요'
    : CPU_OCCLUSION_MODE
      ? 'WebXR AR 지원됨 (CPU 깊이 가림 모드) — START AR을 누르세요'
      : 'WebXR AR 지원됨 — START AR을 누르세요');
  if (SPACE_MAPPING_MODE) {
    depthSource = new CpuDepthFrameSource({
      getSession: () => xrSession.getSession(),
    });
    voxelMap = new VoxelMap({
      voxelSize: VOXEL_SIZE_M,
      solidMinHits: VOXEL_SOLID_MIN_HITS,
      maxSolid: VOXEL_MAX_SOLID,
      maxPending: VOXEL_MAX_PENDING,
    });
    playerTrail = new PlayerTrail({
      minStep: TRAIL_MIN_STEP_M,
      maxPoints: TRAIL_MAX_POINTS,
    });
    depthCloud = new DepthCloud({
      scene,
      voxelMap,
      renderPoints: false,
      depthSource,
    });
    if (CPU_OCCLUSION_MODE) {
      cpuDepthOccluder = new CpuDepthOccluder({ scene, depthSource });
    }
    try {
      operatorView = new OperatorView({ canvas: ui.getOperatorCanvas() });
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
  }

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['anchors', 'dom-overlay', 'local-floor', 'depth-sensing'],
    // gpu-optimized feeds three's built-in mesh. CPU modes let this app read
    // samples for either point-cloud reconstruction or our dynamic occluder.
    depthSensing: {
      usagePreference: [depthUsageForMode(APP_MODE)],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
    domOverlay: { root: document.body },
  });
  document.body.appendChild(arButton);

  renderer.xr.addEventListener('sessionstart', async () => {
    detachOccluder();
    depthSource?.reset();
    cpuDepthOccluder?.reset();
    depthCloud?.reset();
    voxelMap?.reset();
    playerTrail?.reset();
    lastOperatorStatusTime = -Infinity;
    lastOperatorRenderTime = -Infinity;
    operatorVoxelRevision = -1;
    operatorSolidVoxels = [];
    await xrSession.start();
    game.startSession();
  });
  renderer.xr.addEventListener('sessionend', () => {
    detachOccluder();
    depthSource?.reset();
    cpuDepthOccluder?.reset();
    depthCloud?.reset();
    voxelMap?.reset();
    playerTrail?.reset();
    lastOperatorStatusTime = -Infinity;
    lastOperatorRenderTime = -Infinity;
    operatorVoxelRevision = -1;
    operatorSolidVoxels = [];
    operatorVisible = false;
    ui.setOperatorVisible(false);
    game.endSession();
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
    depthCloud?.update(frame, localSpace, time);
    if (viewerPose) playerTrail?.record(viewerPose.position);

    const ninjaPosition = game.getTargetPosition();
    const voxelCount = voxelMap?.getSolidCount() ?? 0;
    if (time - lastOperatorStatusTime >= OPERATOR_STATUS_GAP_MS) {
      lastOperatorStatusTime = time;
      ui.setOperatorStatus(formatOperatorStatus({
        anchorState: game.getAnchorState(),
        voxelCount,
        pendingCount: voxelMap?.getPendingCount() ?? 0,
        occlusionTriangles: CPU_OCCLUSION_MODE
          ? (cpuDepthOccluder?.getTriangleCount() ?? 0)
          : null,
        depthUsage: readDepthSensing().usage,
        ninjaPosition,
        playerPosition: viewerPose?.position ?? null,
        pathPointCount: playerTrail?.getCount() ?? 0,
      }));
    }
    if (
      operatorVisible
      && operatorView
      && time - lastOperatorRenderTime >= OPERATOR_RENDER_GAP_MS
    ) {
      lastOperatorRenderTime = time;
      const voxelRevision = voxelMap.getRevision();
      if (voxelRevision !== operatorVoxelRevision) {
        operatorVoxelRevision = voxelRevision;
        operatorSolidVoxels = voxelMap.getSolidVoxels();
      }
      operatorView.render({
        solidVoxels: operatorSolidVoxels,
        voxelRevision,
        ninjaPos: ninjaPosition,
        playerPos: viewerPose?.position ?? null,
        playerPath: playerTrail.getPoints(),
      });
    }
  } else if (GPU_OCCLUSION_MODE) {
    maybeAttachOccluder();
  }
  updateMetrics(viewerPose);
  renderer.render(scene, camera);
}

// depthUsage/depthDataFormat throw when depth-sensing was not granted for this
// session, so both the HUD and the operator status read them through here.
function readDepthSensing() {
  const session = xrSession.getSession();
  if (!session) return { usage: null, format: null };
  try {
    return { usage: session.depthUsage ?? null, format: session.depthDataFormat ?? null };
  } catch {
    return { usage: null, format: null };
  }
}

function updateMetrics(viewerPose) {
  if (!viewerPose) {
    ui.setMetrics('pose: tracking 대기 중');
    return;
  }

  const spatial = mapper.getMetrics();
  const gameState = game.getState();
  const { usage: depthUsage, format: depthDataFormat } = readDepthSensing();
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
    voxelCount: SPACE_MAPPING_MODE ? (voxelMap?.getSolidCount() ?? 0) : null,
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
