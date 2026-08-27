import { RpsGame } from './rps-game.js';

const MOVE_LABELS = {
  rock: '바위',
  paper: '보',
  scissors: '가위',
};

export function formatGestureObservation(observation) {
  if (!observation?.detected) return '손을 찾는 중… 손 전체를 미리보기 안에 넣으세요.';
  if (!observation.move) return '손은 보입니다 · 손가락을 펴거나 주먹을 또렷하게 해주세요.';
  const label = MOVE_LABELS[observation.move] ?? observation.move;
  const confidence = Math.round((observation.confidence ?? 0) * 100);
  return `${label} 인식 중 ${observation.matches}/${observation.requiredMatches} · ${confidence}%`;
}

export class RpsRuntime {
  constructor({
    ui,
    game,
    recognizer,
    cameraSource,
    manualMode = false,
    random = Math.random,
    countdownMs,
    readTimeoutMs,
    resultMs,
    resetRendererState = () => {},
  }) {
    this.ui = ui;
    this.game = game;
    this.recognizer = recognizer;
    this.cameraSource = cameraSource;
    this.manualMode = manualMode;
    this.resetRendererState = resetRendererState;
    this.currentTime = 0;
    this.initializationPromise = null;
    this.duel = new RpsGame({
      random,
      countdownMs,
      readTimeoutMs,
      resultMs,
      onPhase: (state) => this.handlePhase(state),
      onReveal: (result) => this.handleReveal(result),
      onWin: () => this.handleOutcome('win'),
      onDraw: () => this.handleOutcome('draw'),
      onLose: () => this.handleOutcome('lose'),
      onRetry: () => this.handleRetry(),
    });

    this.ui.setManualMode(this.manualMode);
    this.ui.bindManualMoves((move) => {
      if (this.manualMode) this.duel.acceptPlayerMove(move, this.currentTime);
    });
  }

  async initialize() {
    if (this.manualMode) return true;
    if (this.recognizer.getStatus().state === 'ready') return true;
    if (!this.initializationPromise) {
      this.initializationPromise = this.recognizer.initialize().then((ready) => {
        if (!ready) {
          const status = this.recognizer.getStatus();
          this.ui.showDuelError(
            `손 인식 모델을 불러오지 못했습니다: ${status.detail ?? '알 수 없는 오류'}`,
          );
        }
        return ready;
      });
    }
    return this.initializationPromise;
  }

  startSession(session, gl) {
    if (this.manualMode) return true;
    const ready = this.cameraSource.start(session, gl);
    if (!ready) {
      const status = this.cameraSource.getStatus();
      this.ui.showDuelError(
        `AR 카메라 손 인식을 시작할 수 없습니다: ${status.detail ?? status.state}`,
      );
    } else {
      this.ui.setHandPreview(this.cameraSource.getCanvas());
      if (this.recognizer.getStatus().state !== 'ready') {
        this.ui.setHandStatus('손 인식 모델을 백그라운드에서 준비하는 중…');
        void this.initialize();
      }
    }
    return ready;
  }

  startDuel(time) {
    this.currentTime = time;
    this.recognizer.resetRound();
    this.ui.showDuelError('');
    this.ui.setDuelVisible(true);
    this.duel.start(time);
  }

  update(time, frame, referenceSpace) {
    this.currentTime = time;
    this.duel.update(time);
    const state = this.duel.getState();
    this.ui.setCountdown(state.countdown);
    if (state.phase !== 'duel-reading' || this.manualMode) return state;

    const recognizerStatus = this.recognizer.getStatus();
    if (recognizerStatus.state !== 'ready') {
      if (recognizerStatus.state === 'error') {
        this.ui.showDuelError(
          `손 인식 오류: ${recognizerStatus.detail ?? '모델을 다시 불러와 주세요.'}`,
        );
      }
      return state;
    }

    const image = this.cameraSource.capture(frame, referenceSpace, time);
    if (!image) {
      const cameraStatus = this.cameraSource.getStatus();
      if (cameraStatus.state === 'waiting-camera') {
        this.ui.setHandStatus('AR 카메라 권한을 기다리는 중입니다…');
      } else if (cameraStatus.state === 'error' || cameraStatus.state === 'unavailable') {
        this.ui.showDuelError(
          `AR 카메라 오류: ${cameraStatus.detail ?? cameraStatus.state}`,
        );
      }
      return state;
    }

    this.resetRendererState();
    const move = this.recognizer.recognize(image, time);
    if (move) this.duel.acceptPlayerMove(move, time);
    else this.ui.setHandStatus(
      formatGestureObservation(this.recognizer.getObservation()),
    );
    return this.duel.getState();
  }

  resetSession() {
    this.duel.reset();
    this.cameraSource.reset();
    this.recognizer.resetRound();
    this.ui.setHandPreview(null);
    this.ui.setDuelVisible(false);
    this.ui.showDuelError('');
  }

  getState() {
    return this.duel.getState();
  }

  handlePhase(state) {
    if (state.phase.startsWith('duel-')) this.game.setDuelPhase(state.phase);
    this.ui.setDuelPhase(state.phase);
    this.ui.setDuelVisible(state.phase !== 'idle');
    this.ui.setCountdown(state.countdown);
    if (state.phase === 'duel-countdown') {
      this.ui.setHandStatus('화면 중앙에 한 손을 준비하세요.');
    } else if (state.phase === 'duel-reading') {
      this.recognizer.resetRound();
      this.ui.setHandStatus('가위·바위·보 중 하나를 유지하세요!');
    }
  }

  handleReveal(result) {
    this.ui.showMoves(result);
  }

  handleOutcome(outcome) {
    this.game.resolveDuel(outcome);
    if (outcome !== 'draw') this.ui.setDuelVisible(false);
  }

  handleRetry() {
    this.recognizer.resetRound();
    this.ui.setHandStatus('손을 찾지 못했습니다. 손 전체를 중앙에 두고 다시 유지하세요.');
  }

}
