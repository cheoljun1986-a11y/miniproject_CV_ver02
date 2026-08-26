import {
  DETECT_MAX_ANGLE_DEG,
  DETECT_MAX_DISTANCE_M,
  HORIZONTAL_SURFACE_THRESHOLD,
  MAP_SECONDS,
  NINJA_CAMOUFLAGE_OPACITY,
  SAMPLE_GAP_MS,
} from './config.js';
import {
  forwardFromQuaternion,
  isDetected,
  measureTarget,
  rankCandidates,
} from './game-rules.js';
import { placeNinjaOnSurface } from './surface-placement.js';

export class NinjaGame {
  constructor({
    scene,
    ui,
    mapper,
    model,
    getSession,
    getLocalSpace,
    getViewerPose,
    now = () => performance.now(),
    random = Math.random,
    schedule = setTimeout,
    makeRigidTransform = (position) => new XRRigidTransform(position),
    // Pre-built-map flow (the chase page): no timed mapping phase on session
    // start, and hiding candidates come from the frozen traversal grid rather
    // than the crosshair hit-test pool. index.html keeps the defaults.
    autoMapping = true,
    getCandidatePool = null,
    onDuelStart = () => {},
  }) {
    this.scene = scene;
    this.ui = ui;
    this.mapper = mapper;
    this.model = model;
    this.getSession = getSession;
    this.getLocalSpace = getLocalSpace;
    this.getViewerPose = getViewerPose;
    this.now = now;
    this.random = random;
    this.schedule = schedule;
    this.makeRigidTransform = makeRigidTransform;
    this.autoMapping = autoMapping;
    this.getCandidatePool = getCandidatePool;
    this.onDuelStart = onDuelStart;
    this.phase = 'idle';
    this.mappingEnd = 0;
    this.lastSampleTime = 0;
    this.target = null;
    this.surfaceMarkers = [];
    this.scans = 0;
    this.misses = 0;
    this.controls = {
      scan: false,
      newRound: false,
      extend: false,
      mark: false,
      check: false,
    };
  }

  setControls(changes) {
    Object.assign(this.controls, changes);
    this.ui.setControls({ ...this.controls });
  }

  startSession() {
    this.mapper.resetSession();
    this.scans = 0;
    this.misses = 0;
    this.lastSampleTime = 0;
    this.clearTarget();
    if (!this.autoMapping) {
      // The page owns the map-building lifecycle; the game waits until a
      // frozen map exists and a hide is requested.
      this.phase = 'idle';
      this.setControls({
        scan: false, newRound: false, extend: false, mark: true, check: true,
      });
      this.ui.setStatus('맵 생성 대기');
      this.ui.setMessage('맵 생성을 누르고 방을 천천히 돌며 스캔하세요.');
      return;
    }
    this.setControls({ extend: true, mark: true, check: true });
    this.startMapping(MAP_SECONDS, true);
  }

  endSession() {
    this.phase = 'idle';
    this.clearTarget();
    this.clearSurfaceMarkers();
    this.setControls({
      scan: false,
      newRound: false,
      extend: false,
      mark: false,
      check: false,
    });
    this.ui.setStatus('AR 세션 종료');
    this.ui.setMessage('START AR을 눌러 다시 시작하세요.');
  }

  startMapping(seconds = MAP_SECONDS, reset = false) {
    if (!this.getSession()) return false;
    if (reset) {
      this.mapper.resetCandidates();
      this.clearSurfaceMarkers();
    }
    this.phase = 'mapping';
    this.mappingEnd = this.now() + seconds * 1000;
    this.clearTarget();
    this.setControls({ scan: false, newRound: false });
    this.ui.setStatus(`공간 스캔 중 (${seconds}초)`);
    this.ui.setMessage('천천히 이동하며 바닥·책상 같은 표면을 여러 방향으로 비춰주세요.');
    return true;
  }

  update(time, frame, surface) {
    if (
      this.phase === 'mapping'
      && surface
      && time - this.lastSampleTime > SAMPLE_GAP_MS
    ) {
      this.lastSampleTime = time;
      if (this.mapper.recordSurface(surface)) this.addSurfaceMarker(surface);
    }

    if (this.phase === 'mapping') {
      const left = Math.max(0, this.mappingEnd - this.now());
      this.ui.setStatus(`공간 스캔 중 — ${(left / 1000).toFixed(1)}초 남음`);
      if (left <= 0) this.finishMapping();
    }

    this.updateTargetAnchor(frame);
  }

  finishMapping() {
    if (this.phase !== 'mapping') return false;
    const pool = this.mapper.getPool();
    if (pool.length < 3) {
      this.ui.setStatus('표면 좌표가 너무 적습니다');
      this.ui.setMessage('바닥/책상을 더 천천히 비춘 뒤 +20초 스캔을 눌러주세요.');
      this.phase = 'idle';
      return false;
    }

    this.ui.setStatus(`스캔 완료 — 후보 ${pool.length}개`);
    this.ui.setMessage('후보 중 한 곳에 Ninja를 숨기는 중…');
    this.clearSurfaceMarkers();
    return this.hideNewTarget();
  }

  hideNewTarget({ excludeCandidate = null } = {}) {
    const viewerPose = this.getViewerPose();
    if (!this.getSession() || !viewerPose) return false;
    const pool = this.getCandidatePool
      ? this.getCandidatePool()
      : this.mapper.getPool();
    if (!pool.length) return false;

    const previousCandidate = excludeCandidate ?? this.target?.candidate ?? null;
    const available = pool.filter((candidate) => candidate !== previousCandidate);
    const candidates = available.length ? available : pool;

    this.clearTarget();
    const forward = forwardFromQuaternion(viewerPose.quaternion);
    const ranked = rankCandidates(
      candidates,
      viewerPose.position,
      forward,
      this.random,
    );
    const chosen = ranked[0].candidate;
    const placement = placeNinjaOnSurface(chosen, viewerPose.position);
    const object = this.model.createNinja(NINJA_CAMOUFLAGE_OPACITY);
    object.position.set(...placement.position);
    object.quaternion.identity();
    this.scene.add(object);

    this.target = {
      object,
      anchor: null,
      anchorPromise: null,
      anchorState: 'anchor-pending',
      position: placement.position.slice(),
      candidate: chosen,
      found: false,
    };
    this.phase = 'hunt';
    this.setControls({ scan: true, newRound: true });
    this.ui.setStatus('Ninja가 숨었습니다');
    this.ui.setMessage('걸어다니며 찾으세요. 의심되는 방향을 화면 중앙에 두고 SCAN을 누르세요.');
    return true;
  }

  triggerScan() {
    const viewerPose = this.getViewerPose();
    if (this.phase !== 'hunt' || !this.target || !viewerPose) return false;

    this.scans += 1;
    this.ui.flash();
    const forward = forwardFromQuaternion(viewerPose.quaternion);
    const { distance, angle } = measureTarget(
      this.target.position,
      viewerPose.position,
      forward,
    );
    if (distance < 1e-5) return false;

    const detected = isDetected(
      distance,
      angle,
      DETECT_MAX_DISTANCE_M,
      DETECT_MAX_ANGLE_DEG,
    );
    if (detected) {
      this.startDuel();
      return true;
    }

    this.misses += 1;
    this.ui.setStatus('NO SIGNAL');
    this.ui.setMessage('여기는 아닙니다. 다른 위치로 이동하거나 방향을 바꿔 다시 시도하세요.');
    this.schedule(() => {
      if (this.phase === 'hunt') this.ui.setStatus('Ninja 탐색 중');
    }, 900);
    return false;
  }

  startDuel() {
    if (!this.target) return false;
    this.phase = 'duel-countdown';
    this.target.object.visible = false;
    this.clearSurfaceMarkers();
    this.setControls({ scan: false });
    this.ui.setStatus('Ninja와 가위바위보!');
    this.ui.setMessage('화면 안내에 맞춰 손 모양을 준비하세요.');
    this.onDuelStart({ target: this.target });
    return true;
  }

  setDuelPhase(phase) {
    if (!this.target || !phase.startsWith('duel-')) return false;
    this.phase = phase;
    return true;
  }

  resolveDuel(outcome) {
    if (!this.target || !this.phase.startsWith('duel-')) return false;
    if (outcome === 'win') {
      this.revealTarget();
      return true;
    }
    if (outcome === 'draw') {
      this.target.object.visible = false;
      this.model.setNinjaOpacity(this.target.object, NINJA_CAMOUFLAGE_OPACITY);
      this.phase = 'duel-countdown';
      return true;
    }
    if (outcome === 'lose') {
      const previousCandidate = this.target.candidate;
      this.clearTarget();
      return this.hideNewTarget({ excludeCandidate: previousCandidate });
    }
    return false;
  }

  revealTarget() {
    if (!this.target) return;
    this.target.object.visible = true;
    this.target.found = true;
    this.phase = 'found';
    this.model.revealNinja(this.target.object);
    this.setControls({ scan: false });
    this.ui.setStatus('DETECTED!');
    this.ui.setMessage('발견 성공. 다시 숨기기를 누르면 같은 스캔 데이터에서 새 위치로 시작합니다.');
  }

  saveCheckpoint() {
    const viewerPose = this.getViewerPose();
    if (!viewerPose) return false;
    this.mapper.saveCheckpoint(viewerPose.position, viewerPose.quaternion);
    this.ui.setStatus('기준점 저장됨');
    this.ui.setMessage('조금 이동하거나 360° 회전한 뒤, 가능한 한 같은 자리·방향으로 돌아와 복귀 오차 확인을 누르세요.');
    return true;
  }

  checkReturnError() {
    const viewerPose = this.getViewerPose();
    const result = viewerPose
      ? this.mapper.checkReturnError(viewerPose.position, viewerPose.quaternion)
      : null;
    if (!result) {
      this.ui.setStatus('먼저 기준점 저장을 누르세요');
      return null;
    }

    this.ui.setStatus(`복귀 오차: ${result.posErr.toFixed(2)}m / ${result.angleErr.toFixed(1)}°`);
    this.ui.setMessage('정확한 측정기는 아니지만, 같은 위치·방향으로 돌아왔을 때 값이 작을수록 추적 안정성이 좋습니다.');
    return result;
  }

  // Chase mode drives the model itself. Letting the anchor keep writing the
  // object's matrix would snap it back to where it was hidden every frame.
  setExternalControl(enabled) {
    this.externalControl = Boolean(enabled);
  }

  getTargetObject() {
    return this.target?.object ?? null;
  }

  setTargetOpacity(opacity) {
    if (!this.target) return false;
    this.model.setNinjaOpacity(this.target.object, opacity);
    return true;
  }

  // Move the hidden model to a world position while the chase runs.
  setTargetWorldPosition(position, headingAngle = null) {
    if (!this.target || !position) return false;
    const object = this.target.object;
    object.matrixAutoUpdate = true;
    object.position.set(position[0], position[1], position[2]);
    if (headingAngle !== null) object.rotation.set(0, headingAngle, 0);
    object.updateMatrix();
    this.target.position = [position[0], position[1], position[2]];
    return true;
  }

  updateTargetAnchor(frame) {
    if (this.externalControl) return;
    const localSpace = this.getLocalSpace();
    if (!this.target) return;
    if (this.target.anchorState === 'anchor-pending') {
      this.beginAnchorCreation(frame, localSpace);
    }

    const target = this.target;
    if (!target?.anchor || !localSpace || typeof frame?.getPose !== 'function') return;

    let pose = null;
    try {
      pose = frame.getPose(target.anchor.anchorSpace, localSpace);
    } catch {
      // A tracked anchor can be temporarily unlocatable without being invalid.
    }
    if (!pose) {
      target.anchorState = 'anchor-lost';
      return;
    }

    const matrix = pose.transform.matrix;
    target.object.matrix.fromArray(matrix);
    target.object.matrixWorldNeedsUpdate = true;
    // createNinja leaves matrixAutoUpdate on, so three recomputes .matrix from
    // position/quaternion every frame and the write above is thrown away. The
    // anchor has to move `position` as well or the model stays where it was
    // first placed while the game believes it has followed the anchor.
    target.object.position.set(matrix[12], matrix[13], matrix[14]);
    target.position[0] = matrix[12];
    target.position[1] = matrix[13];
    target.position[2] = matrix[14];
    target.anchorState = 'anchor';
  }

  beginAnchorCreation(frame, localSpace) {
    const target = this.target;
    if (!target || target.anchorPromise || target.anchorState !== 'anchor-pending') return;
    if (!localSpace || typeof frame?.createAnchor !== 'function') {
      target.anchorState = 'local';
      return;
    }

    const [x, y, z] = target.position;
    let anchorResult;
    try {
      const transform = this.makeRigidTransform({ x, y, z });
      anchorResult = frame.createAnchor(transform, localSpace);
    } catch {
      target.anchorState = 'local';
      return;
    }

    target.anchorPromise = Promise.resolve(anchorResult)
      .then((anchor) => {
        if (this.target !== target) {
          try {
            anchor?.delete?.();
          } catch {
            // The stale anchor is already detached from game state.
          }
          return;
        }
        target.anchor = anchor;
        target.anchorState = 'anchor-lost';
        target.object.matrixAutoUpdate = false;
      })
      .catch(() => {
        if (this.target === target) target.anchorState = 'local';
      });
  }

  addSurfaceMarker(surface) {
    const horizontal = surface.upY > HORIZONTAL_SURFACE_THRESHOLD;
    const marker = this.model.createSurfaceMarker(surface.position, horizontal);
    this.scene.add(marker);
    this.surfaceMarkers.push(marker);
  }

  clearSurfaceMarkers() {
    for (const marker of this.surfaceMarkers) {
      this.scene.remove(marker);
      this.model.disposeObject(marker);
    }
    this.surfaceMarkers = [];
  }

  clearTarget() {
    if (!this.target) return;
    try {
      this.target.anchor?.delete?.();
    } catch {
      // Ignore anchor cleanup failures while ending a session.
    }
    this.scene.remove(this.target.object);
    this.model.disposeObject(this.target.object);
    this.target = null;
  }

  getTargetPosition() {
    return this.target ? this.target.position.slice() : null;
  }

  getAnchorState() {
    return this.target?.anchorState ?? null;
  }

  getState() {
    return {
      phase: this.phase,
      mappingLeft: this.phase === 'mapping'
        ? Math.max(0, (this.mappingEnd - this.now()) / 1000)
        : 0,
      scans: this.scans,
      misses: this.misses,
    };
  }
}
