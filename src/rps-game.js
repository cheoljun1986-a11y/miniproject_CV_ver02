import { chooseMove, evaluateRound } from './rps-rules.js';

const NOOP = () => {};

export class RpsGame {
  constructor({
    random = Math.random,
    countdownMs,
    readTimeoutMs,
    resultMs,
    onPhase = NOOP,
    onReveal = NOOP,
    onWin = NOOP,
    onDraw = NOOP,
    onLose = NOOP,
    onRetry = NOOP,
  }) {
    this.random = random;
    this.countdownMs = countdownMs;
    this.readTimeoutMs = readTimeoutMs;
    this.resultMs = resultMs;
    this.onPhase = onPhase;
    this.onReveal = onReveal;
    this.onWin = onWin;
    this.onDraw = onDraw;
    this.onLose = onLose;
    this.onRetry = onRetry;
    this.reset();
  }

  start(time) {
    this.round += 1;
    this.phase = 'duel-countdown';
    this.phaseDeadline = time + this.countdownMs;
    this.lastTime = time;
    this.playerMove = null;
    this.selectedNinjaMove = chooseMove(this.random);
    this.visibleNinjaMove = null;
    this.result = null;
    this.notifyPhase();
  }

  update(time) {
    this.lastTime = time;
    if (this.phase === 'duel-countdown' && time >= this.phaseDeadline) {
      this.phase = 'duel-reading';
      this.phaseDeadline = time + this.readTimeoutMs;
      this.notifyPhase();
      return;
    }

    if (this.phase === 'duel-reading' && time >= this.phaseDeadline) {
      this.phaseDeadline = time + this.readTimeoutMs;
      this.onRetry();
      return;
    }

    if (this.phase !== 'duel-result' || time < this.phaseDeadline) return;

    const completed = this.result;
    this.phase = 'idle';
    this.phaseDeadline = 0;
    if (completed === 'draw') {
      this.onDraw();
      this.start(time);
      return;
    }
    this.notifyPhase();
    if (completed === 'win') this.onWin();
    else this.onLose();
  }

  acceptPlayerMove(move, time) {
    if (this.phase !== 'duel-reading' || this.playerMove) return false;
    this.lastTime = time;
    this.playerMove = move;
    this.visibleNinjaMove = this.selectedNinjaMove;
    this.result = evaluateRound(move, this.selectedNinjaMove);
    this.phase = 'duel-result';
    this.phaseDeadline = time + this.resultMs;
    const reveal = {
      playerMove: this.playerMove,
      ninjaMove: this.visibleNinjaMove,
      result: this.result,
    };
    this.onReveal(reveal);
    this.notifyPhase();
    return true;
  }

  reset() {
    this.phase = 'idle';
    this.phaseDeadline = 0;
    this.lastTime = 0;
    this.playerMove = null;
    this.selectedNinjaMove = null;
    this.visibleNinjaMove = null;
    this.result = null;
    this.round = 0;
  }

  getState() {
    const countdown = this.phase === 'duel-countdown'
      ? Math.max(0, Math.ceil((this.phaseDeadline - this.lastTime) / 1000))
      : 0;
    return {
      phase: this.phase,
      countdown,
      playerMove: this.playerMove,
      ninjaMove: this.visibleNinjaMove,
      result: this.result,
      round: this.round,
    };
  }

  notifyPhase() {
    this.onPhase(this.getState());
  }
}
