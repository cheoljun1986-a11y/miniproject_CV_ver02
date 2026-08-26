// Flight-recorder for the chase: a small ring buffer of the events that
// explain odd behaviour after the fact — retargets, replan failures, terrain
// reanchors, escapes, tracking loss.
//
// On device the biggest debugging bottleneck is that a glitch leaves no trace
// beyond "something looked wrong". The recent entries render at the bottom of
// the (hidden-by-default) metrics card, so a tester can toggle 수치 and read
// what the runner just did.
//
// Pure data structure — no DOM, unit-testable.

const LABELS = {
  start: '도망 시작',
  stop: '도망 종료',
  retarget: '목적지 변경',
  'replan-fail': '경로 실패',
  reanchor: '지형 변경 → 재정착',
  'reanchor-fail': '재정착 실패(지도 없음)',
  escape: '갇힘 → 카메라 쪽 탈출',
  frozen: '추적 끊김',
  unfrozen: '추적 복구',
  captured: '검거',
  'map-anchor': '지도 anchor',
  respawn: '하츄핑 재생성',
};

export class ChaseLog {
  constructor({ capacity = 40 } = {}) {
    this.capacity = capacity;
    this.items = [];
  }

  push(nowMs, type, detail = '') {
    this.items.push({ t: nowMs, type, detail });
    if (this.items.length > this.capacity) this.items.shift();
  }

  size() {
    return this.items.length;
  }

  entries() {
    return this.items.slice();
  }

  clear() {
    this.items = [];
  }

  // Newest first — that is what you want to read on a phone mid-test.
  formatRecent(maxLines = 5) {
    if (!this.items.length) return '';
    return this.items.slice(-maxLines).reverse()
      .map((e) => {
        const label = LABELS[e.type] ?? e.type;
        return `${(e.t / 1000).toFixed(1)}s ${label}${e.detail ? ` · ${e.detail}` : ''}`;
      })
      .join('\n');
  }
}
