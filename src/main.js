import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

import { APP_MODES, depthUsageForMode, resolveAppMode } from './app-mode.js';
import {
  HORIZONTAL_SURFACE_THRESHOLD,
  MAP_SECONDS,
  MAX_TRACKING_STEP,
  MIN_CANDIDATE_SPACING,
  TRAIL_MAX_POINTS,
  TRAIL_MIN_STEP_M,
  VOXEL_MAX_SOLID,
  VOXEL_SIZE_M,
  VOXEL_SOLID_MIN_HITS,
} from './config.js';
import { CpuDepthOccluder } from './cpu-depth-occluder.js';
import { DepthCloud } from './depth-cloud.js';
import { NinjaGame } from './ninja-game.js';
import * as ninjaModel from './ninja-model.js';
import { OperatorView } from './operator-view.js';
import { PlayerTrail } from './player-trail.js';
import { SpatialMapper } from './spatial-mapper.js';
import { createUI, formatMetrics } from './ui.js';
import { VoxelMap } from './voxel-map.js';
import { XRSessionController } from './xr-session.js';

// A WebXR session can use only one depth mode. Keep each experiment isolated
// so point-cloud reconstruction and dynamic occlusion never compete for CPU.
const APP_MODE = resolveAppMode(location.search);
const CLOUD_MODE = APP_MODE === APP_MODES.CLOUD;
const CPU_OCCLUSION_MODE = APP_MODE === APP_MODES.CPU_OCCLUSION;
const GPU_OCCLUSION_MODE = APP_MODE === APP_MODES.GPU_OCCLUSION;

const ui = createUI();
let scene;
let camera;
let renderer;
let controller;
let reticle;
let mapper;
let xrSession;
let game;
let depthCloud = null; // point-cloud reconstruction (CLOUD_MODE)
let occluder = null; // depth-sensing occlusion mesh (real world hides the ninja)
let cpuDepthOccluder = null;
let voxelMap = null;
let playerTrail = null;
let operatorView = null;
let operatorVisible = false;

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

  ui.setStatus(CLOUD_MODE
    ? 'WebXR AR 지원됨 (공간 복원 모드) — START AR을 누르세요'
    : CPU_OCCLUSION_MODE
      ? 'WebXR AR 지원됨 (CPU 깊이 가림 모드) — START AR을 누르세요'
      : 'WebXR AR 지원됨 — START AR을 누르세요');
  if (CLOUD_MODE) {
    voxelMap = new VoxelMap({
      voxelSize: VOXEL_SIZE_M,
      solidMinHits: VOXEL_SOLID_MIN_HITS,
      maxSolid: VOXEL_MAX_SOLID,
    });
    playerTrail = new PlayerTrail({
      minStep: TRAIL_MIN_STEP_M,
      maxPoints: TRAIL_MAX_POINTS,
    });
    depthCloud = new DepthCloud({ scene, voxelMap, renderPoints: false });
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
  } else if (CPU_OCCLUSION_MODE) {
    cpuDepthOccluder = new CpuDepthOccluder({ scene });
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
    cpuDepthOccluder?.reset();
    depthCloud?.reset();
    voxelMap?.reset();
    playerTrail?.reset();
    await xrSession.start();
    game.startSession();
  });
  renderer.xr.addEventListener('sessionend', () => {
    detachOccluder();
    cpuDepthOccluder?.reset();
    depthCloud?.reset();
    voxelMap?.reset();
    playerTrail?.reset();
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

  if (CLOUD_MODE) {
    depthCloud?.update(frame, xrSession.getLocalSpace(), time);
    const pose = xrSession.getViewerPose();
    if (pose) playerTrail?.record(pose.position);
    if (operatorVisible && operatorView) {
      operatorView.render({
        solidVoxels: voxelMap.getSolidVoxels(),
        ninjaPos: game.getTargetPosition(),
        playerPos: pose ? pose.position : null,
        playerPath: playerTrail.getPoints(),
      });
    }
  } else if (CPU_OCCLUSION_MODE) {
    cpuDepthOccluder?.update(frame, xrSession.getLocalSpace(), time);
  } else if (GPU_OCCLUSION_MODE) {
    maybeAttachOccluder();
  }
  const { viewerPose, surface } = xrSession.update(frame);
  if (viewerPose) mapper.recordViewer(viewerPose.position);
  game.update(time, frame, surface);
  updateMetrics(viewerPose);
  renderer.render(scene, camera);
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
    pointCount: CLOUD_MODE
      ? (voxelMap?.getSolidCount() ? voxelMap.getSolidCount() : (depthCloud?.getCount() ?? 0))
      : null,
    depthUsage,
    depthDataFormat,
  }));
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
