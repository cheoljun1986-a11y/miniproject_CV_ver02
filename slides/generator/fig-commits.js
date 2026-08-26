const L = require('./lib');

const { P } = L;
const W = 1240;
const H = 690;

// A phone-screen viewport with the camera feed inside.
function screenFrame(c, x, y, w, h, { title = null, tone = P.line } = {}) {
  const g = c.id('g');
  c.def(`<linearGradient id="${g}" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#eef3f8"/><stop offset="1" stop-color="#dbe3ec"/></linearGradient>`);
  const out = [`<rect x="${x - 9}" y="${y - 9}" width="${w + 18}" height="${h + 18}" rx="18" fill="#2c3545" filter="url(#soft2)"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#${g})"/>`];
  if (title) out.push(L.label(x + w / 2, y - 24, title, { size: 21, fill: tone === P.line ? P.ink : tone }));
  return out.join('');
}

// A sofa drawn flat, as it appears in the camera image.
function sofaFlat(x, y, s, color = '#8fa0bb') {
  return `<g transform="translate(${x},${y}) scale(${s})">
<rect x="-92" y="-34" width="184" height="66" rx="10" fill="${L.shade(color, -0.08)}"/>
<rect x="-92" y="-64" width="184" height="40" rx="12" fill="${color}"/>
<rect x="-100" y="-52" width="26" height="60" rx="10" fill="${L.shade(color, 0.1)}"/>
<rect x="74" y="-52" width="26" height="60" rx="10" fill="${L.shade(color, 0.1)}"/>
</g>`;
}

function hachuFlat(c, x, y, s, opacity = 1) {
  const pt = () => [x, y];
  return L.hachu(c, pt, 0, 0, 0, { scale: s, opacity });
}

// ── B1: what shipped today ───────────────────────────────────
function figTimeline() {
  const c = L.canvas(W, 600);
  const items = [
    ['86ccaff', '검거 사거리 2m 정정', '지정값 반영 + 문서 동기화', P.muted, '353'],
    ['1ed4091', '실측 7점 가림 판정', '헛가림 해결 · 그물 제거', P.blue, '367'],
    ['2cb9e69', '지도 anchor 갱신 연결', '순간이동 해결 · 좌표 통일', P.teal, '371'],
    ['9a9c9c5', '참고 문서', '문제·원리·검증 절차', P.faint, '371'],
  ];
  c.add(`<line x1="120" y1="300" x2="1130" y2="300" stroke="${P.line}" stroke-width="3"/>`);
  items.forEach(([sha, title, sub, color, tests], i) => {
    const x = 190 + i * 288;
    const up = i % 2 === 0;
    const boxY = up ? 118 : 348;
    c.add(`<line x1="${x}" y1="300" x2="${x}" y2="${up ? 246 : 354}" stroke="${color}" stroke-width="3"/>`);
    c.add(`<circle cx="${x}" cy="300" r="13" fill="#fff" stroke="${color}" stroke-width="5"/>`);
    c.add(L.panel(c, x - 128, boxY, 256, 132, { fill: '#fbfcfe' }));
    c.add(L.text(x, boxY + 40, title, { size: 21, weight: 700, fill: P.ink, anchor: 'middle' }));
    c.add(L.text(x, boxY + 72, sub, { size: 18, fill: P.ink2, anchor: 'middle' }));
    c.add(L.text(x, boxY + 106, sha, { size: 17, fill: P.faint, anchor: 'middle' }));
    c.add(L.text(x, up ? 340 : 288, `테스트 ${tests}`, { size: 17, fill: color, anchor: 'middle', weight: 600 }));
  });
  c.add(L.label(620, 530, '모두 private/jaehoon 브랜치 · main 미변경 · 포크와 팀 저장소 양쪽 push', { size: 20, fill: P.muted, weight: 400 }));
  return c.svg();
}

// ── B2: how the full-screen occluder worked ──────────────────
function figOccluderMesh() {
  const c = L.canvas(W, H);
  const pt = L.makeView({ scale: 60, ox: 430, oy: 150 });
  c.add(L.tile(pt, 0, 0, 6, 6, 0, P.floor));
  c.add(L.floorGrid(pt, { w: 6, d: 6 }));
  c.add(L.tile(pt, 0, 0, 6, 6, 0, 'none', { stroke: '#aab4c4', sw: 1.5 }));
  c.add(L.sofa(c, pt, 0.5, 0.6, {}));

  // The depth sheet stands between the camera and the character.
  const zSheet = 3.2;
  const sheetQuad = [pt(-0.4, 0.02, zSheet), pt(6.4, 0.02, zSheet), pt(6.4, 2.2, zSheet), pt(-0.4, 2.2, zSheet)];

  // The character sits BEHIND the sheet, so the depth buffer discards it.
  c.add(`<g opacity="0.28">${L.hachu(c, pt, 3.4, 0, 1.4, { scale: 1.25 })}</g>`);
  const hp = pt(3.4, 0, 1.4);
  c.add(`<ellipse cx="${L.f(hp[0])}" cy="${L.f(hp[1] - 42)}" rx="30" ry="46" fill="none" stroke="${P.red}" stroke-width="2.6" stroke-dasharray="7 6"/>`);
  c.add(L.label(hp[0] + 4, hp[1] + 34, '그물에 잘려 사라짐', { size: 19, fill: P.red }));

  const sheet = [];
  for (let i = 0; i <= 10; i += 1) {
    const x = -0.4 + (i / 10) * 6.8;
    const a = pt(x, 0.02, zSheet);
    const b = pt(x, 2.2, zSheet);
    sheet.push(`<line x1="${L.f(a[0])}" y1="${L.f(a[1])}" x2="${L.f(b[0])}" y2="${L.f(b[1])}" stroke="${P.blue}" stroke-width="1.2" opacity="0.6"/>`);
  }
  for (let j = 0; j <= 7; j += 1) {
    const yy = 0.02 + (j / 7) * 2.18;
    const a = pt(-0.4, yy, zSheet);
    const b = pt(6.4, yy, zSheet);
    sheet.push(`<line x1="${L.f(a[0])}" y1="${L.f(a[1])}" x2="${L.f(b[0])}" y2="${L.f(b[1])}" stroke="${P.blue}" stroke-width="1.2" opacity="0.6"/>`);
  }
  c.add(`<polygon points="${L.poly(sheetQuad)}" fill="${P.blue}" opacity="0.1"/>`);
  c.add(sheet.join(''));
  const lp = pt(1.0, 2.2, zSheet);
  c.add(L.label(lp[0] - 20, lp[1] - 22, '전체 화면 가림 그물 (눈에 안 보임)', { size: 20, fill: P.blue }));

  c.add(L.phone(c, pt, 5.2, 1.25, 5.2, { scale: 1.1 }));
  c.add(L.label(...pt(5.2, 0.35, 5.5), '카메라', { size: 19, fill: P.ink }));

  c.add(L.panel(c, 848, 118, 358, 352));
  c.add(L.text(874, 160, '동작 원리', { size: 22, weight: 700, fill: P.ink }));
  c.add(L.caption(874, 200, [
    'AR에서 카메라 영상은 납작한',
    '사진이라, 렌더러는 "저기 소파가',
    '1.5m 앞에 있다"를 전혀 모른다.',
    '그래서 아무 조치가 없으면',
    '하츄핑이 벽도 뚫고 보인다.',
    '',
    '그래서 폰이 잰 거리대로 방의',
    '모양을 뜬 껍데기를 만들어,',
    '색은 안 칠하고 "거리"만 기록',
    '한다. 그 껍데기보다 먼 픽셀은',
    '자동으로 버려진다.',
  ], { size: 18, gap: 25 }));
  c.add(L.badge(874, 486, '80 × 60 격자 · 66ms마다 갱신', { fill: P.blue, size: 17 }));
  c.add(L.panel(c, 60, 596, 1120, 66, { fill: '#fff5f6', stroke: '#f0c4ca' }));
  c.add(L.text(92, 638, '문제: 이 껍데기가 하츄핑을 픽셀 단위로 자른다. 껍데기가 조금만 틀려도 캐릭터가 통째로 사라진다.', { size: 21, fill: P.ink2 }));
  return c.svg();
}

// ── B3: the body is smaller than the grid can resolve ────────
function figResolution() {
  const c = L.canvas(W, H);
  const panels = [
    ['1.2m', 10, 6, P.green],
    ['2m', 6, 4, P.amber],
    ['3m', 4, 3, P.red],
  ];
  panels.forEach(([dist, cols, rows, tone], i) => {
    const x = 90 + i * 372;
    const y = 130;
    const w = 300;
    const h = 300;
    c.add(screenFrame(c, x, y, w, h, { title: `${dist} 거리`, tone }));
    // The body, drawn to scale for this distance.
    const cell = 26;
    const bw = cols * cell;
    const bh = rows * cell * 1.7;
    const cx = x + w / 2;
    const cy = y + h / 2;
    c.add(`<clipPath id="cp${i}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/></clipPath>`);
    c.add(`<g clip-path="url(#cp${i})">`);
    c.add(hachuFlat(c, cx, cy + bh * 0.42, bh / 88));
    // Grid over it.
    const g = [];
    for (let gx = cx - bw * 1.6; gx <= cx + bw * 1.6; gx += cell) {
      g.push(`<line x1="${L.f(gx)}" y1="${y}" x2="${L.f(gx)}" y2="${y + h}" stroke="${P.blue}" stroke-width="0.9" opacity="0.5"/>`);
    }
    for (let gy = y; gy <= y + h; gy += cell) {
      g.push(`<line x1="${x}" y1="${L.f(gy)}" x2="${x + w}" y2="${L.f(gy)}" stroke="${P.blue}" stroke-width="0.9" opacity="0.5"/>`);
    }
    c.add(g.join(''));
    // One noisy cell landing on the body.
    const nx = cx - cell * (i === 0 ? 1 : 0.5);
    const ny = cy - cell * 0.5;
    c.add(`<rect x="${L.f(nx)}" y="${L.f(ny)}" width="${cell}" height="${cell}" fill="${P.red}" opacity="0.72"/>`);
    c.add('</g>');
    c.add(L.text(x + w / 2, y + h + 46, `몸 너비 ≈ 격자 ${cols}칸`, { size: 20, fill: P.ink, weight: 600, anchor: 'middle' }));
    c.add(L.text(x + w / 2, y + h + 76, `노이즈 한 칸 = 몸의 ${Math.round(100 / cols)}%`, { size: 19, fill: tone, weight: 700, anchor: 'middle' }));
  });
  c.add(`<rect x="90" y="556" width="24" height="24" fill="${P.red}" opacity="0.72" rx="3"/>`);
  c.add(L.text(126, 575, '깊이 측정이 틀린 격자 한 칸', { size: 19, fill: P.ink2 }));
  c.add(L.panel(c, 90, 604, 1060, 58, { fill: '#fffaf0', stroke: '#f0dbb4' }));
  c.add(L.text(118, 641, '더 근본적으로: ARCore 깊이 오차는 거리에 비례해 커져, 2~3m에서는 오차가 캐릭터 크기(20cm)와 같은 자릿수가 된다.', { size: 19, fill: P.ink2 }));
  return c.svg();
}

// ── B4: the mesh lags a fast camera turn ─────────────────────
function figLag() {
  const c = L.canvas(W, 600);
  const x = 250;
  const y = 120;
  const w = 500;
  const h = 340;
  c.add(screenFrame(c, x, y, w, h));
  c.add(`<clipPath id="cpl"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/></clipPath>`);
  c.add(`<g clip-path="url(#cpl)">`);
  c.add(sofaFlat(x + 300, y + 210, 1.15));
  c.add(hachuFlat(c, x + 150, y + 220, 1.5));
  // The mesh outline, drawn where the sofa WAS a moment ago.
  const mx = x + 190;
  const g = [];
  for (let i = 0; i <= 7; i += 1) g.push(`<line x1="${mx - 115 + i * 33}" y1="${y + 120}" x2="${mx - 115 + i * 33}" y2="${y + 250}" stroke="${P.red}" stroke-width="1.4" opacity="0.75"/>`);
  for (let j = 0; j <= 4; j += 1) g.push(`<line x1="${mx - 115}" y1="${y + 120 + j * 32.5}" x2="${mx + 116}" y2="${y + 120 + j * 32.5}" stroke="${P.red}" stroke-width="1.4" opacity="0.75"/>`);
  c.add(`<rect x="${mx - 115}" y="${y + 120}" width="231" height="130" fill="${P.red}" opacity="0.12"/>`);
  c.add(g.join(''));
  c.add('</g>');
  c.add(L.label(x + 300, y + 300, '실제 소파 (지금)', { size: 19, fill: P.ink }));
  c.add(L.label(mx, y + 104, '그물 (최대 66ms 전)', { size: 19, fill: P.red }));
  c.add(L.arrow(c, x + 60, y + 385, x + 200, y + 385, { color: P.ink2, width: 3.5 }));
  c.add(L.label(x + 250, y + 391, '폰을 빠르게 돌리는 방향', { size: 19, fill: P.ink2, weight: 400 }));

  c.add(L.panel(c, 800, 150, 380, 250, { fill: '#fff5f6', stroke: '#f0c4ca' }));
  c.add(L.text(828, 194, '왜 사라지나', { size: 22, weight: 700, fill: P.ink }));
  c.add(L.caption(828, 236, [
    '그물은 66ms마다 다시 만들어',
    '지는데 화면은 더 빠르게 그려',
    '진다. 카메라를 빠르게 돌리면',
    '그물이 옛 위치에 남아,',
    '실제 벽보다 한 뼘 밀린 자리',
    '에서 하츄핑을 잘라낸다.',
  ], { size: 18, gap: 26 }));
  c.add(L.label(620, 528, '"고개 돌리다 사라졌는데 거기 아무것도 없더라" — 이 증상의 정체', { size: 21, fill: P.red }));
  return c.svg();
}

// ── B5: the ghost was wired to the wrong signal ──────────────
function figWrongSignal() {
  const c = L.canvas(W, 620);
  const track = (y, title, sub, color, bg, border) => {
    c.add(L.panel(c, 70, y, 520, 128, { fill: bg, stroke: border }));
    c.add(L.text(100, y + 46, title, { size: 22, weight: 700, fill: color }));
    c.add(L.caption(100, y + 82, sub, { size: 18, gap: 24 }));
  };
  track(110, '화면 가림 — 실시간 깊이', ['폰이 지금 재는 거리로 픽셀을 잘라낸다.', '→ 하츄핑이 눈앞에서 사라지게 만드는 주체'], P.red, '#fff5f6', '#f0c4ca');
  track(330, '맵 가림 — 저장된 복셀 지도', ['굳혀둔 지도 위에서 직선을 그어 계산한다.', '→ 검거 게이지 속도에만 쓰였다'], P.blue, '#f3f7ff', '#c3d6f7');

  c.add(L.panel(c, 760, 210, 400, 168, { fill: '#fbfcfe' }));
  c.add(L.text(960, 256, '반투명 유령', { size: 24, weight: 700, fill: P.ink, anchor: 'middle' }));
  c.add(L.caption(960, 296, ['63a4bc3에서 추가', '"가려졌을 때 비쳐 보이게"'], { size: 18, anchor: 'middle', gap: 25 }));

  c.add(L.arrow(c, 600, 394, 752, 320, { color: P.blue, width: 3.5 }));
  c.add(L.label(676, 380, '여기에 연결됨', { size: 19, fill: P.blue }));
  c.add(`<path d="M 600 174 L 752 250" fill="none" stroke="${P.red}" stroke-width="3.5" stroke-dasharray="9 8" opacity="0.55"/>`);
  c.add(`<g stroke="${P.red}" stroke-width="6" stroke-linecap="round"><line x1="655" y1="192" x2="691" y2="228"/><line x1="691" y1="192" x2="655" y2="228"/></g>`);
  c.add(L.label(600, 132, '연결됐어야 할 곳', { size: 19, fill: P.red, anchor: 'start' }));

  c.add(L.panel(c, 70, 490, 1090, 100, { fill: '#fffaf0', stroke: '#f0dbb4' }));
  c.add(L.text(104, 532, '두 신호가 어긋나면 하츄핑은 사라진 채로 유령도 안 켜진다.', { size: 22, weight: 700, fill: P.ink }));
  c.add(L.text(104, 568, '정작 필요한 순간에 도구가 작동하지 않았다 — "무엇이 가렸나"를 볼 수 없었던 이유.', { size: 20, fill: P.ink2 }));
  return c.svg();
}

// ── B6: judge the body as one object, seven samples ──────────
function figSevenPoint() {
  const c = L.canvas(W, H);
  const camX = 150;
  const camY = 372;
  const bx = 940;
  const by = 470;

  const s = 3.1;
  c.add(hachuFlat(c, bx, by, s, 1));

  // Seven silhouette samples. The two on the left of the body sit behind the
  // obstacle, so their rays are the ones that get cut.
  const pts = [
    [bx, by - 84, null, 'r', false],
    [bx, by - 166, '머리', 'u', false],
    [bx, by - 8, '발', 'd', false],
    [bx - 84, by - 84, '왼쪽 옆구리', 'l', true],
    [bx + 84, by - 84, '오른쪽 옆구리', 'r', false],
    [bx - 60, by - 130, null, 'l', true],
    [bx + 60, by - 130, null, 'r', false],
  ];
  // The obstacle sits on the sight line of the two blocked samples.
  c.add(sofaFlat(560, 402, 1.35, '#9aa7bd'));

  for (const [px, py, , , blocked] of pts) {
    const col = blocked ? P.red : P.green;
    c.add(`<line x1="${camX + 26}" y1="${camY}" x2="${L.f(px)}" y2="${L.f(py)}" stroke="${col}" stroke-width="2" opacity="${blocked ? 0.9 : 0.45}"${blocked ? ' stroke-dasharray="8 6"' : ''}/>`);
  }
  c.add(sofaFlat(560, 402, 1.35, '#9aa7bd'));
  c.add(L.label(560, 470, '실제 장애물', { size: 20, fill: P.ink2 }));

  for (const [px, py, name, dir, blocked] of pts) {
    const col = blocked ? P.red : P.green;
    c.add(`<circle cx="${L.f(px)}" cy="${L.f(py)}" r="10" fill="#fff" stroke="${col}" stroke-width="4"/>`);
    if (!name) continue;
    const off = { l: [-24, 5, 'end'], r: [24, 5, 'start'], u: [0, -26, 'middle'], d: [0, 50, 'middle'] }[dir];
    c.add(L.label(px + off[0], py + off[1], name, { size: 18, fill: P.muted, weight: 400, anchor: off[2] }));
  }
  c.add(`<circle cx="${camX + 26}" cy="${camY}" r="17" fill="${P.ink}"/>`);
  c.add(L.label(camX + 26, camY + 44, '카메라', { size: 20, fill: P.ink }));

  c.add(L.panel(c, 70, 92, 430, 196, { fill: '#f4faf7', stroke: '#bfe0cd' }));
  c.add(L.text(98, 136, '몸을 하나의 물체로 판정', { size: 23, weight: 700, fill: P.ink }));
  c.add(L.caption(98, 176, [
    '실루엣 위 7점을 실시간 깊이',
    '영상에 투영해, 각 점이 가려',
    '졌는지만 센다. 픽셀 단위로',
    '자르지 않는다.',
  ], { size: 18, gap: 25 }));

  c.add(L.panel(c, 560, 92, 610, 130, { fill: '#fbfcfe' }));
  c.add(L.text(590, 136, '이 그림: 7점 중 2점 가려짐 → 5/7', { size: 22, weight: 700, fill: P.ink }));
  c.add(L.text(590, 174, '→ 게이지 배속 0.71 · 불투명도 0.71 (흐릿하지만 또렷이 보임)', { size: 19, fill: P.ink2 }));

  c.add(L.panel(c, 70, 596, 1100, 66, { fill: '#f3f7ff', stroke: '#c3d6f7' }));
  c.add(L.text(102, 638, '25cm 여유거리: 측정값이 그 점보다 25cm 이상 가까울 때만 "가림". 거리 오차는 이보다 작고, 진짜 가구는 이보다 깊다.', { size: 19, fill: P.ink2 }));
  return c.svg();
}

// ── B7: one number drives both gauge and opacity ─────────────
function figOpacityScale() {
  const c = L.canvas(W, 600);
  const g = c.id('g');
  c.def(`<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${P.red}"/><stop offset="0.5" stop-color="${P.amber}"/><stop offset="1" stop-color="${P.green}"/></linearGradient>`);
  const steps = [
    ['7 / 7 가려짐', 0.25, '완전히 가림'],
    ['5 / 7 가려짐', 0.45, '많이 가림'],
    ['2 / 7 가려짐', 0.72, '일부 가림'],
    ['0 / 7 가려짐', 1.0, '훤히 보임'],
  ];
  steps.forEach(([lab, op, note], i) => {
    const x = 200 + i * 285;
    c.add(L.panel(c, x - 118, 108, 236, 250, { fill: '#fbfcfe' }));
    c.add(hachuFlat(c, x, 288, 1.9, op));
    c.add(L.text(x, 148, lab, { size: 20, weight: 700, fill: P.ink, anchor: 'middle' }));
    c.add(L.text(x, 388, `불투명도 ${op.toFixed(2)}`, { size: 20, weight: 700, fill: P.ink, anchor: 'middle' }));
    c.add(L.text(x, 416, note, { size: 18, fill: P.muted, anchor: 'middle' }));
  });
  c.add(`<rect x="82" y="450" width="1076" height="16" rx="8" fill="url(#${g})"/>`);
  c.add(L.text(96, 500, '← 느리게 참 · 옅음', { size: 19, fill: P.ink2 }));
  c.add(L.text(1144, 500, '빠르게 참 · 선명 →', { size: 19, fill: P.ink2, anchor: 'end' }));
  c.add(L.panel(c, 82, 522, 1076, 62, { fill: '#f3f7ff', stroke: '#c3d6f7' }));
  c.add(L.text(114, 562, '같은 숫자 하나(visibleScale)가 검거 게이지 속도이자 모델 불투명도다. 0.25에서 바닥을 쳐서 절대 완전히 사라지지 않는다.', { size: 19, fill: P.ink2 }));
  return c.svg();
}

// ── B8: the missing call ─────────────────────────────────────
function figAnchorWiring() {
  const c = L.canvas(W, 620);
  const col = (x, title, tone, bg, border, rows) => {
    c.add(L.panel(c, x, 110, 520, 380, { fill: bg, stroke: border }));
    c.add(L.text(x + 260, 158, title, { size: 24, weight: 700, fill: tone, anchor: 'middle' }));
    rows.forEach(([txt, ok], i) => {
      const y = 210 + i * 62;
      c.add(L.panel(c, x + 30, y, 460, 48, { fill: '#ffffff', stroke: ok ? '#d6e2d9' : '#f0c4ca', r: 10 }));
      c.add(`<circle cx="${x + 60}" cy="${y + 24}" r="13" fill="${ok ? P.green : P.red}"/>`);
      if (ok) c.add(`<path d="M ${x + 54} ${y + 24} l 4 5 l 8 -10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
      else c.add(`<g stroke="#fff" stroke-width="3" stroke-linecap="round"><line x1="${x + 55}" y1="${y + 19}" x2="${x + 65}" y2="${y + 29}"/><line x1="${x + 65}" y1="${y + 19}" x2="${x + 55}" y2="${y + 29}"/></g>`);
      c.add(L.text(x + 86, y + 31, txt, { size: 19, fill: P.ink2 }));
    });
  };
  col(70, '수정 전', P.red, '#fff5f6', '#f0c4ca', [
    ['앵커 객체 생성', true], ['"추적 시작" 예약', true],
    ['매 프레임 포즈 조회', false], ['상태를 화면에 표시', false],
  ]);
  col(650, '수정 후', P.green, '#f4faf7', '#bfe0cd', [
    ['앵커 객체 생성', true], ['"추적 시작" 예약', true],
    ['매 프레임 포즈 조회', true], ['상태를 화면에 표시', true],
  ]);
  c.add(L.arrow(c, 598, 300, 640, 300, { color: P.ink2, width: 3.5 }));
  c.add(L.panel(c, 70, 512, 1100, 80, { fill: '#fffaf0', stroke: '#f0dbb4' }));
  c.add(L.text(102, 548, '조회가 빠지면 변환이 영원히 "아무것도 안 하는 함수"가 되어, 맵 좌표 = 월드 좌표로 붙는다.', { size: 21, weight: 600, fill: P.ink }));
  c.add(L.text(102, 578, '기능은 있는데 죽어 있었다. 도입 커밋(2a50ca5)부터 그랬다 — 머지 사고가 아니라 처음부터 미연결.', { size: 19, fill: P.ink2 }));
  return c.svg();
}

// ── B9: operator view mixed two frames ───────────────────────
function figOperatorFrames() {
  const c = L.canvas(W, 620);
  const mini = (ox, title, tone, playerOffset, note) => {
    const pt = L.makeView({ scale: 30, ox, oy: 210 });
    c.add(L.tile(pt, 0, 0, 7, 7, 0, P.floor));
    c.add(L.floorGrid(pt, { w: 7, d: 7 }));
    c.add(L.tile(pt, 0, 0, 7, 7, 0, 'none', { stroke: '#aab4c4', sw: 1.5 }));
    // Walkable tiles.
    for (let i = 1; i < 6; i += 1) {
      for (let j = 1; j < 6; j += 1) {
        if ((i + j) % 3 === 0) c.add(L.tile(pt, i, j, 0.92, 0.92, 0.01, P.green, { opacity: 0.2 }));
      }
    }
    const h = pt(2.4, 0.06, 4.2);
    c.add(`<circle cx="${L.f(h[0])}" cy="${L.f(h[1])}" r="11" fill="${P.pink}"/>`);
    c.add(L.label(h[0], h[1] + 34, '하츄핑', { size: 17, fill: P.pinkD }));
    const p = pt(5.2 + playerOffset[0], 0.06, 1.8 + playerOffset[1]);
    c.add(`<circle cx="${L.f(p[0])}" cy="${L.f(p[1])}" r="11" fill="${P.blue}"/>`);
    c.add(L.label(p[0], p[1] - 24, '플레이어', { size: 17, fill: P.blue }));
    if (playerOffset[0] !== 0) {
      const p0 = pt(5.2, 0.06, 1.8);
      c.add(`<circle cx="${L.f(p0[0])}" cy="${L.f(p0[1])}" r="10" fill="none" stroke="${P.blue}" stroke-width="2.5" stroke-dasharray="5 4" opacity="0.6"/>`);
      c.add(L.arrow(c, p0[0], p0[1], p[0], p[1], { color: P.red, width: 2.6 }));
    }
    c.add(L.label(ox, 96, title, { size: 23, fill: tone, weight: 700 }));
    c.add(L.caption(ox, 434, note, { size: 18, anchor: 'middle', gap: 25 }));
  };
  mini(320, '수정 전 — 좌표계 혼용', P.red, [1.5, -1.0], ['하츄핑·타일은 맵 좌표,', '플레이어만 월드 좌표.', '보정 순간 플레이어만 튄다.']);
  mini(930, '수정 후 — 맵 좌표 통일', P.green, [0, 0], ['전부 같은 기준으로 그린다.', '이제 미니맵으로 지도와 방의', '어긋남을 관찰할 수 있다.']);
  c.add(L.panel(c, 70, 522, 1100, 72, { fill: '#fffaf0', stroke: '#f0dbb4' }));
  c.add(L.text(102, 566, '한 화면에 두 좌표계가 섞여 있으면, 진짜 문제(지도가 방과 어긋남)가 가짜 문제(플레이어가 튐)로 보인다.', { size: 20, fill: P.ink2 }));
  return c.svg();
}

module.exports = {
  figTimeline, figOccluderMesh, figResolution, figLag, figWrongSignal,
  figSevenPoint, figOpacityScale, figAnchorWiring, figOperatorFrames,
};
