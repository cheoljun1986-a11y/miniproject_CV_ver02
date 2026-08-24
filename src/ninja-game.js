import {
  DETECT_MAX_ANGLE_DEG,
  DETECT_MAX_DISTANCE_M,
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
    this.phase = 'idle';
    this.mappingEnd = 0;
    this.lastSampleTime = 0;
    this.target = null;
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
    this.setControls({ extend: true, mark: true, check: true });
    this.startMapping(MAP_SECONDS, true);
  }

  endSession() {
    this.phase = 'idle';
    this.clearTarget();
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
    if (reset) this.mapper.resetCandidates();
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
      this.mapper.recordSurface(surface);
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
    return this.hideNewTarget();
  }

  hideNewTarget() {
    const viewerPose = this.getViewerPose();
    if (!this.getSession() || !viewerPose) return false;
    const pool = this.mapper.getPool();
    if (!pool.length) return false;

    this.clearTarget();
    const forward = forwardFromQuaternion(viewerPose.quaternion);
    const ranked = rankCandidates(
      pool,
      viewerPose.position,
      forward,
      this.random,
    );
    const chosen = ranked[0].candidate;
    const object = this.model.createNinja(NINJA_CAMOUFLAGE_OPACITY);
    object.position.set(...chosen.pos);
    object.position.y += 0.02;
    object.quaternion.identity();
    this.scene.add(object);

    this.target = {
      object,
      anchor: null,
      position: Array.from(chosen.pos),
      found: false,
      mode: 'local-space',
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
      this.revealTarget();
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

  revealTarget() {
    if (!this.target) return;
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

  updateTargetAnchor(frame) {
    const localSpace = this.getLocalSpace();
    if (!this.target?.anchor || !localSpace) return;
    const pose = frame.getPose(this.target.anchor.anchorSpace, localSpace);
    if (pose) this.target.object.matrix.fromArray(pose.transform.matrix);
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

