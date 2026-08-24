import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

import {
  HORIZONTAL_SURFACE_THRESHOLD,
  MAP_SECONDS,
  MAX_TRACKING_STEP,
  MIN_CANDIDATE_SPACING,
} from './config.js';
import { NinjaGame } from './ninja-game.js';
import * as ninjaModel from './ninja-model.js';
import { SpatialMapper } from './spatial-mapper.js';
import { createUI, formatMetrics } from './ui.js';
import { XRSessionController } from './xr-session.js';

const ui = createUI();
let scene;
let camera;
let renderer;
let controller;
let reticle;
let mapper;
let xrSession;
let game;
let occluder = null; // depth-sensing occlusion mesh (real world hides the ninja)

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

  ui.setStatus('WebXR AR 지원됨 — START AR을 누르세요');
  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['anchors', 'dom-overlay', 'local-floor', 'depth-sensing'],
    // Real-world depth so people/hands/pillars can occlude the ninja. three's
    // built-in occluder mesh only works with the gpu-optimized depth path.
    depthSensing: {
      usagePreference: ['gpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
    domOverlay: { root: document.body },
  });
  document.body.appendChild(arButton);

  renderer.xr.addEventListener('sessionstart', async () => {
    detachOccluder();
    await xrSession.start();
    game.startSession();
  });
  renderer.xr.addEventListener('sessionend', () => {
    detachOccluder();
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

  maybeAttachOccluder();
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
    occlusionOn: Boolean(renderer.xr.hasDepthSensing?.()),
  }));
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
