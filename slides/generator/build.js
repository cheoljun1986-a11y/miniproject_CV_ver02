const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const PptxGenJS = require('pptxgenjs');

const A = require('./fig-anchor');
const B = require('./fig-commits');

const OUT = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const INK = '1C2430';
const INK2 = '3D4757';
const MUTED = '78849A';
const BLUE = '2F6FED';
const TEAL = '0F9B8E';
const AMBER = 'E08B26';
const RED = 'D1495B';
const GREEN = '2E9E5B';

function png(svg, width = 2000) {
  const r = new Resvg(svg, {
    font: { fontDirs: ['C:\\Windows\\Fonts'], defaultFontFamily: 'Malgun Gothic', loadSystemFonts: true },
    fitTo: { mode: 'width', value: width },
  });
  return `data:image/png;base64,${r.render().asPng().toString('base64')}`;
}

// ── slide helpers ────────────────────────────────────────────
function deck() {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
  p.theme = { headFontFace: 'Malgun Gothic', bodyFontFace: 'Malgun Gothic' };
  return p;
}

function titleSlide(p, { kicker, title, sub, meta }) {
  const s = p.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape('rect', {
    x: 0, y: 0, w: 0.16, h: 5.625, fill: { color: BLUE },
  });
  s.addText(kicker, {
    x: 0.75, y: 1.35, w: 8.6, h: 0.35, fontSize: 15, color: BLUE, bold: true, charSpacing: 2,
  });
  s.addText(title, {
    x: 0.72, y: 1.75, w: 8.6, h: 1.0, fontSize: 40, bold: true, color: INK,
  });
  s.addText(sub, {
    x: 0.75, y: 2.85, w: 8.4, h: 0.9, fontSize: 17, color: INK2, lineSpacing: 26,
  });
  s.addShape('line', {
    x: 0.78, y: 4.0, w: 2.0, h: 0, line: { color: 'CCD4E0', width: 1.5 },
  });
  s.addText(meta, { x: 0.75, y: 4.15, w: 8.4, h: 0.6, fontSize: 13, color: MUTED, lineSpacing: 20 });
  return s;
}

function sectionSlide(p, n, title, sub) {
  const s = p.addSlide();
  s.background = { color: 'F7F9FC' };
  s.addText(n, {
    x: 0.75, y: 1.9, w: 1.1, h: 1.0, fontSize: 60, bold: true, color: 'D8E2F5',
  });
  s.addText(title, { x: 1.9, y: 2.1, w: 7.4, h: 0.6, fontSize: 30, bold: true, color: INK });
  s.addText(sub, { x: 1.95, y: 2.78, w: 7.3, h: 0.6, fontSize: 16, color: MUTED });
  return s;
}

// Slide with a heading and a full-width figure underneath.
function figureSlide(p, { title, lead = null, svg, note = null, tone = BLUE }) {
  const s = p.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape('rect', { x: 0.42, y: 0.34, w: 0.055, h: 0.42, fill: { color: tone } });
  s.addText(title, { x: 0.62, y: 0.3, w: 8.9, h: 0.5, fontSize: 24, bold: true, color: INK });
  let top = 0.92;
  if (lead) {
    s.addText(lead, { x: 0.64, y: 0.82, w: 8.85, h: 0.34, fontSize: 15, color: INK2 });
    top = 1.24;
  }
  const bottom = note ? 5.02 : 5.34;
  const h = bottom - top;
  const w = h * (1240 / 690);
  s.addImage({ data: png(svg), x: (10 - Math.min(w, 9.2)) / 2, y: top, w: Math.min(w, 9.2), h: Math.min(w, 9.2) * (690 / 1240) });
  if (note) {
    s.addText(note, {
      x: 0.62, y: 5.02, w: 8.8, h: 0.42, fontSize: 14, color: MUTED, italic: true,
    });
  }
  return s;
}

// Figure on the left, bullet column on the right.
function splitSlide(p, {
  title, svg, bullets, tone = BLUE, figW = 5.55, aspect = 690 / 1240, note = null,
}) {
  const s = p.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape('rect', { x: 0.42, y: 0.34, w: 0.055, h: 0.42, fill: { color: tone } });
  s.addText(title, { x: 0.62, y: 0.3, w: 8.9, h: 0.5, fontSize: 24, bold: true, color: INK });
  s.addImage({
    data: png(svg), x: 0.42, y: 1.05, w: figW, h: figW * aspect,
  });
  s.addText(bullets.map((b) => (typeof b === 'string'
    ? { text: b, options: { bullet: { code: '2022' }, fontSize: 14.5, color: INK2, paraSpaceAfter: 9 } }
    : { text: b.t, options: { fontSize: b.h ? 16 : 14.5, bold: !!b.h, color: b.h ? INK : INK2, bullet: b.h ? false : { code: '2022' }, paraSpaceAfter: b.h ? 5 : 9, paraSpaceBefore: b.h ? 10 : 0 } })), {
    x: figW + 0.62, y: 1.05, w: 9.5 - figW - 0.65, h: 3.9, valign: 'top',
  });
  if (note) s.addText(note, { x: 0.42, y: 5.06, w: 9.1, h: 0.4, fontSize: 13, color: MUTED, italic: true });
  return s;
}

function tableSlide(p, { title, head, rows, colW, tone = BLUE, note = null }) {
  const s = p.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape('rect', { x: 0.42, y: 0.34, w: 0.055, h: 0.42, fill: { color: tone } });
  s.addText(title, { x: 0.62, y: 0.3, w: 8.9, h: 0.5, fontSize: 24, bold: true, color: INK });
  const body = [head.map((h) => ({
    text: h,
    options: { bold: true, color: 'FFFFFF', fill: { color: tone }, fontSize: 14, align: 'left' },
  }))];
  rows.forEach((r, i) => {
    body.push(r.map((cell) => ({
      text: typeof cell === 'string' ? cell : cell.t,
      options: {
        fontSize: 13.5,
        color: typeof cell === 'string' ? INK2 : (cell.c || INK2),
        bold: typeof cell === 'object' && !!cell.b,
        fill: { color: i % 2 ? 'F7F9FC' : 'FFFFFF' },
        valign: 'middle',
      },
    })));
  });
  s.addTable(body, {
    x: 0.45, y: 1.05, w: 9.1, colW, border: { type: 'solid', color: 'E2E8F0', pt: 0.75 },
    autoPage: false, rowH: 0.42,
  });
  if (note) s.addText(note, { x: 0.45, y: 5.02, w: 9.1, h: 0.45, fontSize: 13, color: MUTED, italic: true });
  return s;
}

function checklistSlide(p, { title, intro, items, tone = AMBER, note }) {
  const s = p.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape('rect', { x: 0.42, y: 0.34, w: 0.055, h: 0.42, fill: { color: tone } });
  s.addText(title, { x: 0.62, y: 0.3, w: 8.9, h: 0.5, fontSize: 24, bold: true, color: INK });
  s.addText(intro, { x: 0.64, y: 0.84, w: 8.85, h: 0.34, fontSize: 15, color: INK2 });
  items.forEach((it, i) => {
    const y = 1.34 + i * 0.72;
    s.addShape('roundRect', {
      x: 0.5, y, w: 9.0, h: 0.62, fill: { color: i % 2 ? 'F7F9FC' : 'FFFFFF' }, line: { color: 'E2E8F0', width: 0.75 }, rectRadius: 0.06,
    });
    s.addShape('roundRect', {
      x: 0.66, y: y + 0.14, w: 0.34, h: 0.34, fill: { color: 'FFFFFF' }, line: { color: tone, width: 1.5 }, rectRadius: 0.04,
    });
    s.addText(it.t, { x: 1.14, y: y + 0.05, w: 5.3, h: 0.3, fontSize: 14.5, bold: true, color: INK });
    s.addText(it.d, { x: 1.14, y: y + 0.3, w: 8.2, h: 0.28, fontSize: 12.5, color: MUTED });
  });
  if (note) s.addText(note, { x: 0.5, y: 5.06, w: 9.0, h: 0.4, fontSize: 13, color: MUTED, italic: true });
  return s;
}

// ═══════════════════════════════════════════════════════════════
// DECK 1 — anchor
// ═══════════════════════════════════════════════════════════════
function buildAnchorDeck() {
  const p = deck();
  titleSlide(p, {
    kicker: 'AR 기초 · miniproject_CV_ver02',
    title: '지도 앵커(Anchor)는 무엇이고\n어떻게 동작하는가',
    sub: '하츄핑이 "순간이동"하던 원인을 이해하기 위한 배경 지식.\nARCore가 자기 위치를 어떻게 추정하고, 왜 틀리고, 앵커가 그것을 어떻게 되돌리는지.',
    meta: '2026-08-27 · private/jaehoon',
  });

  sectionSlide(p, '01', '먼저, ARCore는 자기 위치를 "추정"한다', '측정이 아니라 추정이라는 점이 모든 문제의 출발점');

  splitSlide(p, {
    title: '폰은 특징점으로 자기 위치를 계산한다',
    svg: A.figTracking(),
    tone: TEAL,
    bullets: [
      { t: '무엇을 보는가', h: true },
      '카메라 영상에서 가구 모서리·무늬처럼 다시 알아볼 수 있는 점(특징점)을 뽑는다.',
      { t: '무엇을 만드는가', h: true },
      '세션 내내 "내가 본 특징점들이 3차원 어디에 있는지"에 대한 자기만의 지도를 쌓는다. 원점 근처만이 아니라 방 전체에 대해.',
      { t: '어떻게 위치를 아는가', h: true },
      '그 지도와 지금 보이는 화면을 대조해 계산한다. 즉 GPS처럼 측정하는 것이 아니라 영상으로 추정한다.',
    ],
  });

  splitSlide(p, {
    title: '특징점이 없으면 오차가 쌓인다 — 드리프트',
    svg: A.figDrift(),
    tone: AMBER,
    bullets: [
      { t: '왜 흰 벽이 문제인가', h: true },
      '대조할 특징점이 없어 관성 센서 추측만 남는다. 걸음이 쌓일수록 실제 위치와 추정 위치가 벌어진다.',
      { t: '얼마나 벌어지나', h: true },
      '방 하나를 한 바퀴 도는 정도로도 수십 cm까지 벌어질 수 있다. 20cm짜리 하츄핑에게는 치명적인 크기.',
      { t: '이 상태로는 아무 일도 안 일어난다', h: true },
      '오차는 조용히 쌓이기만 한다. 문제는 다음 장에서 터진다.',
    ],
  });

  figureSlide(p, {
    title: '보정: 알아보는 순간 좌표가 한 번에 튄다',
    lead: '이것이 재훈님이 관찰한 "흰 벽 보다가 가구 비추면 나만 튀는" 현상의 정체입니다.',
    svg: A.figSnap(),
    tone: BLUE,
    note: '중요: 원점이나 앵커를 비출 필요가 없습니다. 아무 특징 물체나 다시 알아보면 일어납니다.',
  });

  sectionSlide(p, '02', '앵커가 없으면 무슨 일이 생기나', '순간이동의 정체');

  figureSlide(p, {
    title: '보정은 현실만 옮긴다 — 지도는 옛 좌표에 남는다',
    svg: A.figNoAnchor(),
    tone: RED,
    note: '운영자 모드는 저장된 숫자를 그리므로 완벽히 연속으로 보입니다. 그래서 이 버그는 운영자 모드로는 절대 관찰할 수 없었습니다.',
  });

  sectionSlide(p, '03', '앵커란 무엇인가', '가장 흔한 오해부터 정리');

  figureSlide(p, {
    title: '앵커는 눈으로 찾는 표식이 아니다',
    svg: A.figAnchorConcept(),
    tone: GREEN,
    note: '앵커는 시각적으로 알아보는 대상이 아니라, ARCore의 내부 특징점 지도 위에 등록해 둔 좌표입니다.',
  });

  figureSlide(p, {
    title: '앵커의 동작 과정',
    svg: A.figAnchorFlow(),
    tone: BLUE,
  });

  tableSlide(p, {
    title: '핵심 반전: 무엇이 움직이는가',
    head: ['', '보정이 일어나면', '결과'],
    colW: [2.2, 4.0, 2.9],
    tone: BLUE,
    rows: [
      [{ t: '앵커 없음', b: true, c: RED }, '숫자는 그대로, 현실이 숫자 밑에서 미끄러진다', { t: '지도가 방과 어긋남 → 순간이동', c: RED }],
      [{ t: '앵커 있음', b: true, c: GREEN }, '숫자가 보정량만큼 바뀐다', { t: '지도가 방에 계속 붙어 있음', c: GREEN }],
    ],
    note: '복셀 8만 개를 하나씩 옮기는 게 아니라, 변환 하나만 바꾸면 지도 전체가 통째로 따라갑니다.',
  });

  figureSlide(p, {
    title: '두 좌표계와 변환',
    svg: A.figTransform(),
    tone: TEAL,
  });

  sectionSlide(p, '04', '알고 있어야 할 한계', '앵커는 만능이 아니다');

  const s = p.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape('rect', { x: 0.42, y: 0.34, w: 0.055, h: 0.42, fill: { color: AMBER } });
  s.addText('한계와 전제', { x: 0.62, y: 0.3, w: 8.9, h: 0.5, fontSize: 24, bold: true, color: INK });
  const limits = [
    ['드리프트를 없애지는 않는다', '앵커는 지도가 ARCore의 "현재 최선의 추정"을 따라가게 할 뿐이다. ARCore 자체가 틀리면 지도도 같이 틀린다. 다만 화면에 보이는 것과는 어긋나지 않는데, AR에서는 절대 정확도보다 이 일치가 중요하다.'],
    ['앵커 하나는 통짜 이동·회전만 보정한다', '실제 드리프트는 방 구석마다 다르게 쌓여 지도가 미묘하게 휠 수 있다. "지도 전체가 30cm 밀림"은 고쳐도 "부채꼴로 벌어짐"은 못 고친다. 방 하나 크기에서는 통짜 보정으로 충분하다.'],
    ['기기가 앵커를 지원해야 한다', '미지원이면 변환이 항등으로 남아 이전과 동일하게 동작한다. 그래서 운영자 카드에 "지도앵커 미지원"을 표시하도록 함께 배선했다 — 조용히 실패하지 않게.'],
  ];
  limits.forEach(([t, d], i) => {
    const y = 1.05 + i * 1.32;
    s.addShape('roundRect', { x: 0.5, y, w: 9.0, h: 1.16, fill: { color: 'FFFBF3' }, line: { color: 'F0DBB4', width: 1 }, rectRadius: 0.08 });
    s.addText(t, { x: 0.78, y: y + 0.13, w: 8.5, h: 0.32, fontSize: 16, bold: true, color: INK });
    s.addText(d, { x: 0.78, y: y + 0.47, w: 8.5, h: 0.62, fontSize: 13.5, color: INK2, lineSpacing: 19 });
  });

  tableSlide(p, {
    title: '한 장 요약',
    head: ['질문', '답'],
    colW: [3.4, 5.7],
    tone: BLUE,
    rows: [
      ['앵커가 뭔가?', '"이 좌표를 계속 추적해줘"라고 ARCore에 등록해 둔 지점. 물체도 표식도 아니다.'],
      ['카메라로 비춰야 하나?', { t: '아니다.', b: true, c: RED }],
      ['그럼 언제 보정되나?', '아무 특징 물체나 다시 알아본 순간. 그때 등록된 앵커의 좌표값이 자동으로 갱신된다.'],
      ['원점에 아무것도 없어도 되나?', { t: '된다.', b: true, c: GREEN }],
      ['우리 코드에서 무엇이 문제였나?', '등록만 하고 매 프레임 "지금 어디니?"를 한 번도 묻지 않았다.'],
    ],
    note: '마지막 줄이 오늘 커밋 2cb9e69에서 고친 내용입니다.',
  });

  return p;
}

// ═══════════════════════════════════════════════════════════════
// DECK 2 — today's commits
// ═══════════════════════════════════════════════════════════════
function buildCommitDeck() {
  const p = deck();
  titleSlide(p, {
    kicker: '작업 정리 · 2026-08-27',
    title: '헛가림과 순간이동 수정',
    sub: '도망 모드에서 하츄핑이 (1) 가릴 것이 없는데 사라지고 (2) 엉뚱한 위치로 순간이동하던 문제.\n원인 규명부터 수정, 그리고 아직 검증되지 않은 기대효과까지.',
    meta: 'private/jaehoon · 커밋 4개 · 테스트 353 → 371 · 포크와 팀 저장소 양쪽 push 완료',
  });

  figureSlide(p, {
    title: '오늘 반영한 것',
    svg: B.figTimeline(),
    tone: BLUE,
    note: 'main 브랜치는 건드리지 않았습니다. 세 수정은 원인이 서로 달라 개별 revert가 가능하도록 나눴습니다.',
  });

  sectionSlide(p, '01', '검거 사거리 2m 정정', '86ccaff · 지정값 반영');

  tableSlide(p, {
    title: '지시·코드·문서가 서로 달랐다',
    head: ['', '값', '문제'],
    colW: [2.4, 1.7, 5.0],
    tone: MUTED,
    rows: [
      ['지정값', { t: '2m', b: true, c: GREEN }, '재훈님이 지정한 값'],
      ['커밋 63a4bc3의 코드', { t: '3.0m', b: true, c: RED }, '지시가 코드 어디에도 기록되지 않은 채 다른 값이 들어감'],
      ['인수인계 문서', { t: '1.2m', b: true, c: RED }, '값을 바꾸면서 문서를 갱신하지 않음'],
    ],
    note: '수정: 상수를 2.0으로 정정하고 주석에 지정값임을 명기, 문서의 1.2m 세 곳을 갱신. 화면 안내문은 이미 상수를 참조하므로 자동 반영됩니다.',
  });

  sectionSlide(p, '02', '헛가림 — 가릴 것이 없는데 사라진다', '1ed4091 · 가장 큰 수정');

  figureSlide(p, {
    title: '문제의 배경: 전체 화면 가림 그물',
    lead: 'AR에서 카메라 영상은 납작한 사진이라, 아무 조치가 없으면 하츄핑이 벽도 뚫고 보입니다.',
    svg: B.figOccluderMesh(),
    tone: BLUE,
  });

  splitSlide(p, {
    title: '원인 ① 20cm 몸은 격자로 자를 수 있는 크기가 아니다',
    svg: B.figResolution(),
    tone: RED,
    figW: 5.5,
    bullets: [
      { t: '거리가 멀수록 급격히 나빠진다', h: true },
      '격자 한 칸이 차지하는 실제 크기가 커져서, 2m에서 하츄핑은 가로로 6칸 남짓밖에 안 된다.',
      { t: '그런데 해상도만 문제가 아니다', h: true },
      'ARCore 깊이 오차는 거리에 비례해 커진다. 2~3m에서는 오차가 캐릭터 크기와 같은 자릿수가 된다.',
      { t: '결론', h: true },
      '격자를 촘촘히 해도 해결되지 않는다. 측정 자체가 틀리는 것은 해상도로 못 고친다. 접근을 바꿔야 했다.',
    ],
  });

  figureSlide(p, {
    title: '원인 ② 그물이 카메라를 따라오지 못한다',
    svg: B.figLag(),
    tone: RED,
  });

  figureSlide(p, {
    title: '원인 ③ 직전 커밋의 반투명 유령이 엉뚱한 신호에 물려 있었다',
    svg: B.figWrongSignal(),
    tone: RED,
    note: '63a4bc3의 유령은 좋은 아이디어였지만, 화면에서 지우는 주체(실시간 깊이)가 아니라 게이지용 판정(저장 지도)에 연결돼 있었습니다.',
  });

  figureSlide(p, {
    title: '수정: 몸을 하나의 물체로 판정한다',
    lead: '픽셀 단위로 자르는 대신, 실루엣 7점을 실시간 깊이 영상에 투영해 "몇 % 가려졌나"를 잽니다.',
    svg: B.figSevenPoint(),
    tone: GREEN,
  });

  figureSlide(p, {
    title: '가림은 이제 불투명도로 표현된다',
    svg: B.figOpacityScale(),
    tone: GREEN,
    note: '완전히 가려도 옅은 실루엣이 남으므로, 그 위로 무엇이 가렸는지 눈으로 확인할 수 있습니다 — 디버깅 요구사항을 그대로 만족합니다.',
  });

  tableSlide(p, {
    title: '무엇이 달라지나',
    head: ['상황', '수정 전', '수정 후'],
    colW: [2.7, 3.2, 3.2],
    tone: GREEN,
    rows: [
      ['노이즈 격자 한 칸', { t: '몸이 통째로 사라짐', c: RED }, { t: '불투명도 1/7만 흐려짐', c: GREEN }],
      ['진짜 벽 뒤', '픽셀 단위로 잘림', '0.25 실루엣이 남음 (가린 것이 보임)'],
      ['화면 밖 / 깊이 없음', '그물 상태에 따라 제각각', '"측정 불가" = 안 가림'],
      ['지도가 어긋난 상태', { t: '지도 기반 게이지가 헛가림', c: RED }, { t: '렌더 좌표로만 판정 → 무관', c: GREEN }],
      ['프레임당 깊이 샘플', '4,800회', { t: '7회', b: true, c: GREEN }],
    ],
    note: '도망 페이지에서는 전체 화면 그물 생성을 중단했습니다. 깊이 읽기 자체는 복셀 지도와 실측 판정이 계속 사용합니다.',
  });

  const t = p.addSlide();
  t.background = { color: 'FFFFFF' };
  t.addShape('rect', { x: 0.42, y: 0.34, w: 0.055, h: 0.42, fill: { color: AMBER } });
  t.addText('알고 받아들인 트레이드오프', { x: 0.62, y: 0.3, w: 8.9, h: 0.5, fontSize: 24, bold: true, color: INK });
  [
    ['문틀에 반쯤 걸치면 "반 잘림"이 아니라 "전체가 반투명"', '20cm 캐릭터라 실제로는 구분이 거의 안 되고, 노이즈에 토막나는 것보다 낫다고 판단했습니다.'],
    ['진짜로 숨어도 0.25 실루엣이 남는다', '추격 게임이라 놓치는 것보다 낫고, "무엇이 가렸나"를 판단하기 위해 의도한 동작입니다.'],
    ['얇은 물체(의자 다리)는 약하게만 반영된다', '7점 중 소수만 가리므로 게이지가 크게 느려지지 않습니다. 증상과는 반대 방향이라 지금은 문제가 되지 않습니다.'],
  ].forEach(([a, b], i) => {
    const y = 1.1 + i * 1.28;
    t.addShape('roundRect', { x: 0.5, y, w: 9.0, h: 1.12, fill: { color: 'FFFBF3' }, line: { color: 'F0DBB4', width: 1 }, rectRadius: 0.08 });
    t.addText(a, { x: 0.78, y: y + 0.14, w: 8.5, h: 0.32, fontSize: 15.5, bold: true, color: INK });
    t.addText(b, { x: 0.78, y: y + 0.5, w: 8.5, h: 0.56, fontSize: 13.5, color: INK2, lineSpacing: 19 });
  });

  sectionSlide(p, '03', '순간이동 — 지도 앵커가 죽어 있었다', '2cb9e69');

  tableSlide(p, {
    title: '증상과 그 의미',
    head: ['관찰된 것', '무엇을 뜻하는가'],
    colW: [4.3, 4.8],
    tone: RED,
    rows: [
      ['평지를 잘 다니다 갑자기 엉뚱한 현실 위치로 이동', '화면에 그려지는 물리적 위치가 틀렸다'],
      [{ t: '운영자 모드에서는 궤적이 완전히 연속', b: true }, '저장된 좌표는 멀쩡하다 → 경로 계산의 문제가 아니다'],
      ['가릴 물건이 없는데 가려졌다고 나옴', '저장된 지도가 현실의 방과 어긋나 있다'],
      ['흰 벽 보다 가구 비추면 플레이어만 튐 (이전 관찰)', { t: '드리프트 보정이 실제로 일어나고 있다는 직접 증거', b: true, c: RED }],
    ],
    note: '네 관찰이 하나의 원인으로 모두 설명됩니다: 지도가 ARCore의 좌표 보정을 따라가지 못한다.',
  });

  figureSlide(p, {
    title: '원인: 등록만 하고 한 번도 묻지 않았다',
    svg: B.figAnchorWiring(),
    tone: RED,
  });

  splitSlide(p, {
    title: '함께 고친 것: 운영자 뷰의 좌표계 혼용',
    svg: B.figOperatorFrames(),
    tone: TEAL,
    figW: 5.6,
    bullets: [
      { t: '왜 지금 고쳐야 했나', h: true },
      '앵커가 살아나는 순간 이것이 실제 버그가 된다. 보정 때 플레이어 점만 튀어 보인다.',
      { t: '왜 진단을 방해했나', h: true },
      '진짜 문제(지도가 방과 어긋남)가 가짜 문제(플레이어가 튐)로 보인다. 이 미니맵으로는 원인을 볼 수 없었다.',
      { t: '무엇을 바꿨나', h: true },
      '하츄핑·타일·플레이어·경로를 모두 맵 좌표로 통일. 복셀 배경만 원좌표를 유지한다(수만 점 재투영 비용 대비 진단 가치가 없음).',
      { t: '추가', h: true },
      '운영자 카드에 "지도앵커 O / 생성 중 / 일시 손실 / 미지원" 표시를 붙였다. 조용히 실패하지 않게.',
    ],
  });

  sectionSlide(p, '04', '기대효과', '⚠ 아직 실기기 검증 전입니다');

  const e = p.addSlide();
  e.background = { color: 'FFFFFF' };
  e.addShape('rect', { x: 0.42, y: 0.34, w: 0.055, h: 0.42, fill: { color: AMBER } });
  e.addText('검증된 것과 검증되지 않은 것', { x: 0.62, y: 0.3, w: 8.9, h: 0.5, fontSize: 24, bold: true, color: INK });
  e.addShape('roundRect', { x: 0.5, y: 1.0, w: 4.4, h: 3.9, fill: { color: 'F4FAF7' }, line: { color: 'BFE0CD', width: 1.2 }, rectRadius: 0.08 });
  e.addText('검증 완료', { x: 0.75, y: 1.16, w: 3.9, h: 0.35, fontSize: 18, bold: true, color: GREEN });
  e.addText([
    { text: '자동 테스트 371개 전부 통과 (353 → 371)', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '7점 판정의 수학(투영·역행렬·경계조건)이 단위 테스트로 검증됨', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '새 테스트가 실제 버그를 하나 잡음 — 역행렬 전치 실수', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '모든 모듈이 브라우저 방식으로 파싱됨 (페이지 부팅 실패 방지)', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '원인 규명은 코드 근거로 확인됨 (추측 아님)', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2 } },
  ], { x: 0.75, y: 1.58, w: 3.9, h: 3.2, valign: 'top' });

  e.addShape('roundRect', { x: 5.1, y: 1.0, w: 4.4, h: 3.9, fill: { color: 'FFFBF3' }, line: { color: 'F0DBB4', width: 1.2 }, rectRadius: 0.08 });
  e.addText('⚠ 기대효과 — 미검증', { x: 5.35, y: 1.16, w: 3.9, h: 0.35, fontSize: 18, bold: true, color: AMBER });
  e.addText([
    { text: '헛가림 소멸: 빈 방향을 겨눴을 때 하츄핑이 선명하게 유지될 것', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '순간이동 소멸: 보정 시 지도·하츄핑·격자가 통째로 방을 따라갈 것', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '빠른 회전 시 가장자리 뜯김이 사라질 것', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '2m에서의 검거 조작감', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2, paraSpaceAfter: 10 } },
    { text: '설 수 있는 칸 수가 지나치게 줄지 않았는지 (복셀 4개 기준의 부작용)', options: { bullet: { code: '2022' }, fontSize: 13.5, color: INK2 } },
  ], { x: 5.35, y: 1.58, w: 3.9, h: 3.2, valign: 'top' });
  e.addText('이 항목들은 전부 기기에서만 확인할 수 있습니다. PC 테스트로는 알 수 없습니다.', { x: 0.5, y: 5.02, w: 9.0, h: 0.4, fontSize: 13.5, color: MUTED, italic: true });

  checklistSlide(p, {
    title: '내일 실기기에서 확인할 순서',
    intro: '순서가 중요합니다. 1번이 아니면 3번 결과를 해석할 수 없습니다.',
    tone: AMBER,
    items: [
      { t: '① 운영자 카드에서 "지도앵커 O" 확인', d: '미지원이면 순간이동 수정은 무효(안전하게 이전 동작)이며 다른 접근이 필요합니다. 가장 먼저 볼 것.' },
      { t: '② 헛가림 — 빈 방향을 겨눠 본다', d: '하츄핑이 선명하게 유지되는지. 진짜 가구 뒤에서는 0.25 실루엣이 남고 그 위로 가린 물체가 보이는지.' },
      { t: '③ 순간이동 — 흰 벽을 한참 보다 가구를 비춘다', d: '재현 절차입니다. 하츄핑이 현실에서 튀지 않고 제자리를 지키는지 확인.' },
      { t: '④ 빠른 회전 — 폰을 좌우로 흔든다', d: '가장자리가 더 이상 뜯기지 않는지. 그물 지연이 사라졌는지 확인하는 항목.' },
      { t: '⑤ 도망 기록에서 map-anchor 이벤트 확인', d: '수치 카드 하단. 앵커 상태가 바뀐 시점과 체감 이상의 대응을 봅니다.' },
    ],
    note: '되돌리기: 커밋이 독립적이라 사거리(상수 하나) / 가림 방식(1ed4091) / 앵커(2cb9e69)를 개별 revert할 수 있습니다.',
  });

  return p;
}

(async () => {
  const a = buildAnchorDeck();
  await a.writeFile({ fileName: path.join(OUT, 'AR-앵커-동작원리.pptx') });
  const b = buildCommitDeck();
  await b.writeFile({ fileName: path.join(OUT, '도망모드-헛가림-순간이동-수정.pptx') });
  console.log('written to', OUT);
})();
