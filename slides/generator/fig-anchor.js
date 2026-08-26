const L = require('./lib');

const { P } = L;
const W = 1240;
const H = 690;

function featureMark(x, y, s = 7, color = P.teal, op = 0.9) {
  return `<g opacity="${op}" stroke="${color}" stroke-width="2" stroke-linecap="round"><line x1="${x - s}" y1="${y}" x2="${x + s}" y2="${y}"/><line x1="${x}" y1="${y - s}" x2="${x}" y2="${y + s}"/></g>`;
}

function furnishedRoom(c, pt, { withFeatures = true, blankWall = false } = {}) {
  const out = [];
  out.push(L.room(c, pt, { w: 7, d: 7, h: 2.4 }));
  if (blankWall) {
    out.push(L.box(c, pt, 0, 0, -0.14, 7, 2.4, 0.14, '#f2f5f9'));
    out.push(L.label(...pt(3.5, 1.5, 0), '무늬 없는 흰 벽', { size: 21, fill: P.muted }));
  }
  out.push(L.shelf(c, pt, 0.25, 0.6));
  out.push(L.sofa(c, pt, 4.4, 0.5, { rot: 1 }));
  out.push(L.table(c, pt, 1.9, 3.4, { w: 1.5, d: 1.0 }));
  if (withFeatures) {
    const spots = [
      pt(0.6, 1.7, 1.2), pt(0.6, 1.7, 0.7), pt(0.25, 1.1, 1.6),
      pt(4.4, 0.9, 0.8), pt(4.4, 0.9, 1.9), pt(5.25, 0.45, 2.3),
      pt(1.9, 0.7, 3.6), pt(3.4, 0.7, 4.3), pt(3.4, 0.7, 3.5),
      pt(2.4, 0.7, 4.4),
    ];
    out.push(spots.map((s) => featureMark(s[0], s[1])).join(''));
  }
  return out.join('');
}

// ── A1: how ARCore knows where it is ─────────────────────────
function figTracking() {
  const c = L.canvas(W, H);
  const pt = L.makeView({ scale: 58, ox: 560, oy: 175 });
  c.add(furnishedRoom(c, pt));
  c.add(L.frustum(c, pt, [5.6, 1.35, 5.6], [2.2, 0, 2.2], { spread: 1.5 }));
  c.add(L.phone(c, pt, 5.6, 1.35, 5.6, { scale: 1.25 }));
  c.add(L.label(...pt(5.6, 0.55, 5.9), '내 폰', { size: 21 }));

  const legX = 960;
  c.add(L.panel(c, legX - 60, 118, 320, 250));
  c.add(L.text(legX - 36, 154, '지금 보이는 화면', { size: 21, weight: 700, fill: P.ink }));
  c.add(featureMark(legX - 22, 190, 8));
  c.add(L.text(legX - 2, 197, '특징점', { size: 20, fill: P.ink2 }));
  c.add(L.caption(legX - 36, 232, [
    '가구 모서리·무늬처럼',
    '다시 알아볼 수 있는 점.',
    'ARCore는 이 점들의 3차원',
    '지도를 세션 내내 쌓고,',
    '그 지도와 대조해 내 위치를',
    '"추정"한다.',
  ], { size: 18, gap: 24 }));
  c.add(L.badge(legX - 60, 384, '추정이므로 틀릴 수 있다', { fill: P.amber, size: 18 }));
  return c.svg();
}

// ── A2: drift accumulates on a featureless wall ──────────────
function figDrift() {
  const c = L.canvas(W, H);
  const pt = L.makeView({ scale: 58, ox: 560, oy: 175 });
  c.add(furnishedRoom(c, pt, { blankWall: true }));

  const truePath = [[5.8, 0.02, 5.8], [5.0, 0.02, 4.0], [4.2, 0.02, 2.0], [3.4, 0.02, 0.9]];
  const estPath = [[5.8, 0.02, 5.8], [4.85, 0.02, 3.95], [3.8, 0.02, 1.85], [2.5, 0.02, 0.55]];
  const line = (path, color, dash) => `<polyline points="${L.poly(path.map((p) => pt(...p)))}" fill="none" stroke="${color}" stroke-width="4" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  c.add(line(truePath, P.green));
  c.add(line(estPath, P.red, '9 7'));
  for (const p of truePath) {
    const q = pt(...p);
    c.add(`<circle cx="${L.f(q[0])}" cy="${L.f(q[1])}" r="5" fill="${P.green}"/>`);
  }
  const te = pt(...truePath[3]);
  const ee = pt(...estPath[3]);
  c.add(`<line x1="${L.f(te[0])}" y1="${L.f(te[1])}" x2="${L.f(ee[0])}" y2="${L.f(ee[1])}" stroke="${P.red}" stroke-width="2.4" stroke-dasharray="4 4"/>`);
  c.add(L.label((te[0] + ee[0]) / 2, (te[1] + ee[1]) / 2 - 18, '오차', { size: 21, fill: P.red }));
  c.add(L.phone(c, pt, 5.8, 1.35, 5.8, { scale: 1.05 }));

  c.add(L.panel(c, 900, 118, 320, 210));
  c.add(`<line x1="930" y1="158" x2="978" y2="158" stroke="${P.green}" stroke-width="4" stroke-linecap="round"/>`);
  c.add(L.text(990, 165, '실제로 걸은 길', { size: 19, fill: P.ink2 }));
  c.add(`<line x1="930" y1="196" x2="978" y2="196" stroke="${P.red}" stroke-width="4" stroke-dasharray="9 7" stroke-linecap="round"/>`);
  c.add(L.text(990, 203, 'ARCore의 추정', { size: 19, fill: P.ink2 }));
  c.add(L.caption(930, 244, [
    '흰 벽에는 대조할 특징점이',
    '없어 관성 센서 추측만 남고,',
    '오차가 조금씩 쌓인다.',
  ], { size: 18, gap: 24 }));
  return c.svg();
}

// ── A3: loop closure snaps the estimate ──────────────────────
function figSnap() {
  const c = L.canvas(W, H);
  const mini = (ox, title, tone, est) => {
    const pt = L.makeView({ scale: 34, ox, oy: 245 });
    const out = [];
    out.push(L.tile(pt, 0, 0, 7, 7, 0, P.floor));
    out.push(L.floorGrid(pt, { w: 7, d: 7 }));
    out.push(L.tile(pt, 0, 0, 7, 7, 0, 'none', { stroke: '#aab4c4', sw: 1.5 }));
    out.push(L.sofa(c, pt, 4.4, 0.5, { rot: 1 }));
    out.push(L.table(c, pt, 1.9, 3.4, { w: 1.5, d: 1.0 }));
    const tp = pt(3.4, 0.06, 0.9);
    const ep = pt(...est);
    out.push(`<circle cx="${L.f(tp[0])}" cy="${L.f(tp[1])}" r="9" fill="${P.green}"/>`);
    out.push(`<circle cx="${L.f(ep[0])}" cy="${L.f(ep[1])}" r="11" fill="none" stroke="${P.red}" stroke-width="3.5" stroke-dasharray="6 5"/>`);
    out.push(L.label(ox, 90, title, { size: 25, fill: tone, weight: 700 }));
    return out.join('');
  };
  c.add(mini(300, '보정 직전', P.red, [2.5, 0.06, 0.55]));
  c.add(mini(940, '보정 직후', P.green, [3.4, 0.06, 0.92]));
  c.add(L.arrow(c, 600, 250, 690, 250, { color: P.blue, width: 4 }));
  c.add(L.label(645, 224, '가구를 다시 알아봄', { size: 20, fill: P.blue }));
  c.add(L.label(645, 292, '(루프 클로저)', { size: 18, fill: P.muted, weight: 400 }));

  c.add(L.panel(c, 150, 480, 940, 150));
  c.add(L.text(185, 522, '특징 있는 물체를 다시 알아본 순간, ARCore는 내부 지도 전체와 자기 위치를 한 번에 고친다.', { size: 22, fill: P.ink, weight: 600 }));
  c.add(L.caption(185, 562, [
    '· 원점이나 앵커를 비출 필요가 없다 — 아무 특징 물체나 다시 보면 일어난다',
    '· 이때 월드 좌표가 계단식으로 튄다. 값이 부드럽게 변하다 한 프레임에 훅 바뀐다',
  ], { size: 19, gap: 30 }));
  return c.svg();
}

// ── A4: without an anchor, the map is left behind ────────────
function figNoAnchor() {
  const c = L.canvas(W, H);
  const pt = L.makeView({ scale: 54, ox: 520, oy: 118 });
  // The real room, fully drawn.
  c.add(L.tile(pt, 0, 0, 7, 7, 0, P.floor));
  c.add(L.floorGrid(pt, { w: 7, d: 7 }));
  c.add(L.tile(pt, 0, 0, 7, 7, 0, 'none', { stroke: '#8d99ab', sw: 2 }));
  c.add(L.sofa(c, pt, 4.2, 0.5, { rot: 1 }));
  c.add(L.table(c, pt, 1.6, 3.6, { w: 1.5, d: 1.0 }));
  c.add(L.label(...pt(0.9, 0, 6.6), '현실의 방', { size: 22, fill: P.ink }));

  // The same room in stale coordinates: outline only, so the real one shows.
  const off = [1.5, 0, -1.0];
  const ptM = (x, y, z) => pt(x + off[0], y + off[1], z + off[2]);
  c.add(L.tile(ptM, 0, 0, 7, 7, 0, P.pink, { opacity: 0.1 }));
  c.add(`<g opacity="0.4">${L.floorGrid(ptM, { w: 7, d: 7, color: P.pinkD })}</g>`);
  c.add(L.tile(ptM, 0, 0, 7, 7, 0, 'none', { stroke: P.pinkD, sw: 3 }));
  // The map's copy of the sofa, where the stored coordinates think it is.
  c.add(`<g opacity="0.55">${L.tile(ptM, 4.2, 0.5, 0.85, 1.9, 0.02, P.pinkD, { opacity: 0.35, stroke: P.pinkD, sw: 2 })}</g>`);
  c.add(L.label(...ptM(5.6, 0, 0.1), '저장된 지도', { size: 22, fill: P.pinkD }));

  // The offset between the two frames.
  const c0 = pt(0, 0, 0);
  const c1 = ptM(0, 0, 0);
  c.add(L.arrow(c, c0[0], c0[1], c1[0], c1[1], { color: P.red, width: 3 }));
  c.add(L.label((c0[0] + c1[0]) / 2 + 6, (c0[1] + c1[1]) / 2 - 16, '어긋난 양', { size: 19, fill: P.red }));

  // Hachuping stands on empty floor as far as the MAP is concerned...
  c.add(L.hachu(c, ptM, 3.4, 0, 2.4, { scale: 1.2 }));
  c.add(L.label(...ptM(3.4, 1.45, 2.4), '지도 기준: 빈 바닥 (좌표 연속)', { size: 19, fill: P.pinkD }));
  // ...but in the real room that is somewhere else entirely.
  const spot = pt(3.4 + off[0], 0, 2.4 + off[2]);
  c.add(`<circle cx="${L.f(spot[0])}" cy="${L.f(spot[1])}" r="13" fill="none" stroke="${P.red}" stroke-width="3.5" stroke-dasharray="6 5"/>`);
  c.add(L.arrow(c, spot[0] + 175, spot[1] + 108, spot[0] + 20, spot[1] + 16, { color: P.red, width: 3, curve: 24 }));
  c.add(L.label(spot[0] + 285, spot[1] + 126, '현실에서는 엉뚱한 자리', { size: 20, fill: P.red }));

  c.add(L.panel(c, 60, 566, 1120, 96, { fill: '#fff5f6', stroke: '#f0c4ca' }));
  c.add(L.text(92, 606, '보정이 일어나도 저장된 지도는 옛 좌표에 그대로 남는다.', { size: 22, fill: P.ink, weight: 700 }));
  c.add(L.text(92, 640, '저장된 숫자는 연속 → 운영자 모드에는 아무 이상이 없어 보인다. 그러나 현실 위치는 튄다 = 순간이동.', { size: 20, fill: P.ink2 }));
  return c.svg();
}

// ── A5: what an anchor actually is ───────────────────────────
function figAnchorConcept() {
  const c = L.canvas(W, H);
  // Left: the wrong mental model.
  c.add(L.panel(c, 55, 90, 545, 470, { fill: '#fff6f6', stroke: '#f0c4ca' }));
  c.add(L.text(327, 140, '오해', { size: 26, weight: 700, fill: P.red, anchor: 'middle' }));
  const ptA = L.makeView({ scale: 30, ox: 327, oy: 250 });
  c.add(L.tile(ptA, 0, 0, 6, 6, 0, P.floor));
  c.add(L.floorGrid(ptA, { w: 6, d: 6 }));
  c.add(L.tile(ptA, 0, 0, 6, 6, 0, 'none', { stroke: '#aab4c4', sw: 1.4 }));
  const ap = ptA(3, 0.05, 3);
  c.add(`<circle cx="${L.f(ap[0])}" cy="${L.f(ap[1])}" r="14" fill="${P.amber}"/>`);
  c.add(L.frustum(c, ptA, [5.6, 1.2, 5.6], [3, 0, 3], { spread: 0.9, color: P.amber }));
  c.add(L.phone(c, ptA, 5.6, 1.2, 5.6, { scale: 0.85 }));
  c.add(`<g stroke="${P.red}" stroke-width="7" stroke-linecap="round"><line x1="240" y1="392" x2="414" y2="470"/><line x1="414" y1="392" x2="240" y2="470"/></g>`);
  c.add(L.caption(327, 516, ['"앵커 자리를 카메라로 다시 비추면 보정된다"'], { size: 19, fill: P.red, anchor: 'middle' }));

  // Right: what it really is.
  c.add(L.panel(c, 640, 90, 545, 470, { fill: '#f4faf7', stroke: '#bfe0cd' }));
  c.add(L.text(912, 140, '실제', { size: 26, weight: 700, fill: P.green, anchor: 'middle' }));
  const ptB = L.makeView({ scale: 30, ox: 912, oy: 250 });
  c.add(L.tile(ptB, 0, 0, 6, 6, 0, P.floor));
  c.add(L.floorGrid(ptB, { w: 6, d: 6 }));
  c.add(L.tile(ptB, 0, 0, 6, 6, 0, 'none', { stroke: '#aab4c4', sw: 1.4 }));
  const cloud = [[0.7, 1.3, 0.9], [1.4, 1.6, 0.5], [5.3, 1.1, 1.4], [5.6, 0.7, 3.2],
    [1.0, 0.6, 4.6], [2.4, 0.9, 5.4], [4.6, 1.4, 5.1], [3.1, 1.8, 0.4], [0.5, 0.9, 2.6]];
  for (const p of cloud) {
    const q = ptB(...p);
    c.add(featureMark(q[0], q[1], 6, P.teal, 0.85));
    const a = ptB(3, 0.05, 3);
    c.add(`<line x1="${L.f(q[0])}" y1="${L.f(q[1])}" x2="${L.f(a[0])}" y2="${L.f(a[1])}" stroke="${P.teal}" stroke-width="1" opacity="0.35" stroke-dasharray="3 4"/>`);
  }
  const bp = ptB(3, 0.05, 3);
  c.add(`<circle cx="${L.f(bp[0])}" cy="${L.f(bp[1])}" r="15" fill="${P.blue}"/><circle cx="${L.f(bp[0])}" cy="${L.f(bp[1])}" r="24" fill="none" stroke="${P.blue}" stroke-width="2.5" opacity="0.55"/>`);
  c.add(L.label(bp[0], bp[1] + 56, '앵커', { size: 21, fill: P.blue }));
  c.add(L.caption(912, 500, [
    '"이 좌표를 계속 추적해줘"라는 등록증.',
    '주변 방 전체의 특징점이 기준이 되므로',
    '그 자리에 아무 물체가 없어도 된다.',
  ], { size: 18, fill: P.ink2, anchor: 'middle', gap: 25 }));
  return c.svg();
}

// ── A6: the four-step cycle ──────────────────────────────────
function figAnchorFlow() {
  const c = L.canvas(W, 640);
  const steps = [
    ['1', '못을 박는다', ['맵 생성을 시작할 때', 'ARCore에 원점 좌표를', '앵커로 등록한다.'], P.blue],
    ['2', '매 프레임 물어본다', ['"그 앵커 지금 어디야?"', '이 조회가 빠지면 전체가', '죽은 코드가 된다.'], P.teal],
    ['3', '보정이 일어난다', ['특징 물체를 다시 알아본', '순간 ARCore가 내부 지도를', '통째로 고친다.'], P.amber],
    ['4', '지도가 따라간다', ['앵커 좌표가 보정량만큼', '갱신되고, 변환 하나로', '지도 전체가 함께 움직인다.'], P.green],
  ];
  steps.forEach(([n, title, lines, color], i) => {
    const x = 48 + i * 292;
    c.add(L.panel(c, x, 92, 258, 396, { fill: '#fbfcfe' }));
    c.add(`<circle cx="${x + 44}" cy="${140}" r="26" fill="${color}"/>`);
    c.add(L.text(x + 44, 149, n, { size: 26, fill: '#fff', weight: 700, anchor: 'middle' }));
    c.add(L.text(x + 84, 149, title, { size: 21, weight: 700, fill: P.ink }));
    c.add(`<line x1="${x + 24}" y1="182" x2="${x + 234}" y2="182" stroke="${L.shade(color, 0.5)}" stroke-width="2.5"/>`);
    c.add(L.caption(x + 24, 220, lines, { size: 18, gap: 26 }));
    if (i < 3) c.add(L.arrow(c, x + 264, 300, x + 296, 300, { color: P.faint, width: 3 }));
  });
  // The cycle repeats.
  c.add(`<path d="M 1155 470 q 40 90 -530 90 q -570 0 -530 -90" fill="none" stroke="${P.faint}" stroke-width="2.5" stroke-dasharray="8 7"/>`);
  c.add(L.label(620, 578, '2 → 3 → 4 는 세션 내내 반복된다', { size: 20, fill: P.muted, weight: 400 }));
  return c.svg();
}

// ── A7: the two coordinate frames ────────────────────────────
function figTransform() {
  const c = L.canvas(W, 620);
  c.add(L.panel(c, 60, 96, 470, 404, { fill: '#f3f7ff', stroke: '#c3d6f7' }));
  c.add(L.text(295, 142, '맵 좌표', { size: 26, weight: 700, fill: P.blue, anchor: 'middle' }));
  c.add(L.caption(295, 176, ['앵커를 기준으로 삼는 좌표'], { size: 18, fill: P.muted, anchor: 'middle' }));
  c.add(L.caption(110, 230, [
    '· 복셀 지도 (벽·가구)',
    '· 이동 격자 (설 수 있는 칸)',
    '· 하츄핑의 위치',
    '· 경로 계산·가림 계산',
    '· 운영자 미니맵 표시',
  ], { size: 20, gap: 34, fill: P.ink2 }));
  c.add(L.badge(110, 430, '보정돼도 값이 안 흔들린다', { fill: P.blue, size: 17 }));

  c.add(L.panel(c, 712, 96, 470, 404, { fill: '#f5f8f6', stroke: '#c6ddd0' }));
  c.add(L.text(947, 142, '월드 좌표', { size: 26, weight: 700, fill: P.green, anchor: 'middle' }));
  c.add(L.caption(947, 176, ['ARCore가 그때그때 주는 좌표'], { size: 18, fill: P.muted, anchor: 'middle' }));
  c.add(L.caption(762, 230, [
    '· 플레이어(폰)의 실제 자세',
    '· 깊이 영상의 각 픽셀',
    '· 화면에 실제로 그리는 위치',
  ], { size: 20, gap: 34, fill: P.ink2 }));
  c.add(L.badge(762, 430, '보정이 일어나면 통째로 튄다', { fill: P.green, size: 17 }));

  c.add(L.arrow(c, 690, 250, 552, 250, { color: P.ink2, width: 3 }));
  c.add(L.label(621, 228, 'toMapSpace', { size: 19, fill: P.ink }));
  c.add(L.arrow(c, 552, 346, 690, 346, { color: P.ink2, width: 3 }));
  c.add(L.label(621, 326, 'toRenderSpace', { size: 19, fill: P.ink }));
  c.add(L.label(621, 400, '변환의 근거는', { size: 17, fill: P.muted, weight: 400 }));
  c.add(L.label(621, 424, '앵커의 자세 하나', { size: 17, fill: P.muted, weight: 400 }));

  c.add(L.panel(c, 60, 528, 1122, 66, { fill: '#fffaf0', stroke: '#f0dbb4' }));
  c.add(L.text(92, 570, '앵커가 갱신되지 않으면 두 변환이 모두 "아무것도 안 하는 함수"가 되어, 맵 좌표 = 월드 좌표로 붙어버린다.', { size: 21, fill: P.ink2 }));
  return c.svg();
}

module.exports = { figTracking, figDrift, figSnap, figNoAnchor, figAnchorConcept, figAnchorFlow, figTransform };
