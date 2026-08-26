import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createUI } from '../src/ui.js';

// chaseBtn is deliberately absent: the chase starts when the map is frozen,
// so there is no mode to toggle.
const CHASE_IDS = ['chasePanel', 'chaseGaugeFill', 'chaseHint', 'chaseArrow'];

// ── page markup ──────────────────────────────────────────────
test('the chase page carries every element the chase UI touches', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  for (const id of CHASE_IDS) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});

test('the chase page still loads the shared module entrypoint', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  const moduleScripts = [...html.matchAll(/<script\s+type="module"([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(moduleScripts.length, 1);
  assert.match(moduleScripts[0][1], /src="\.\/src\/main\.js"/);
});

test('the chase page forces a depth mode that accumulates a map', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.match(html, /occlusion'?,\s*'cpu'/);
});

test('the team demo page has no chase elements, so chase stays off there', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of CHASE_IDS) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `index.html gained #${id}`);
  }
});

// ── UI guards ────────────────────────────────────────────────
function stubElement() {
  return {
    style: {},
    disabled: false,
    textContent: '',
    listeners: [],
    addEventListener(type, handler) { this.listeners.push([type, handler]); },
  };
}

function stubDocument(ids) {
  const elements = new Map(ids.map((id) => [id, stubElement()]));
  return {
    elements,
    querySelector(selector) {
      return elements.get(selector.replace('#', '')) ?? null;
    },
    addEventListener() {},
  };
}

const BASE_IDS = [
  'status', 'metrics', 'message', 'scanBtn', 'newRoundBtn', 'extendBtn',
  'markBtn', 'checkBtn', 'scanFlash', 'fallback', 'fallbackDetail',
  'operatorBtn', 'operatorOverlay', 'operatorCanvas', 'operatorCloseBtn',
  'operatorStatus',
];

test('chase helpers are inert when the page has no chase elements', () => {
  const doc = stubDocument(BASE_IDS);
  const ui = createUI(doc);

  assert.equal(ui.hasChaseControls(), false);
  // None of these may throw on the team demo page.
  ui.setChaseButton('x', true);
  ui.setChaseVisible(true);
  ui.setChaseGauge(0.5);
  ui.setChaseHint('x');
  ui.setChaseArrow(1.2);
  ui.setChaseArrow(null);
});

test('binding chase without a button still wires SCAN hold', () => {
  const doc = stubDocument(BASE_IDS);
  const ui = createUI(doc);
  let started = 0;
  let ended = 0;
  ui.bindChase({
    onToggle() {},
    onHoldStart() { started += 1; },
    onHoldEnd() { ended += 1; },
  });

  const scan = doc.elements.get('scanBtn');
  const down = scan.listeners.find(([type]) => type === 'pointerdown');
  const up = scan.listeners.find(([type]) => type === 'pointerup');
  assert.ok(down && up, 'SCAN should accept press and release');
  down[1]({ stopPropagation() {} });
  up[1]({ stopPropagation() {} });
  assert.equal(started, 1);
  assert.equal(ended, 1);
});

test('the chase page reports its controls and drives the gauge', () => {
  const doc = stubDocument([...BASE_IDS, ...CHASE_IDS]);
  const ui = createUI(doc);
  assert.equal(ui.hasChaseControls(), true);

  ui.setChaseVisible(true);
  assert.equal(doc.elements.get('chasePanel').style.display, 'flex');

  ui.setChaseGauge(0.42);
  assert.equal(doc.elements.get('chaseGaugeFill').style.width, '42%');

  ui.setChaseGauge(1);
  assert.equal(doc.elements.get('chaseGaugeFill').style.background, '#35d07f');

  ui.setChaseArrow(null);
  assert.equal(doc.elements.get('chaseArrow').style.display, 'none');
  ui.setChaseArrow(0.5);
  assert.match(doc.elements.get('chaseArrow').style.transform, /rotate\(0.5rad\)/);
});

test('the chase page is recognised by its gauge panel, not by a toggle', () => {
  const doc = stubDocument([...BASE_IDS, ...CHASE_IDS]);
  assert.equal(createUI(doc).hasChaseControls(), true);
  // index.html has no chase panel and must stay out of the chase wiring.
  assert.equal(createUI(stubDocument(BASE_IDS)).hasChaseControls(), false);
});

test('binding the chase with no toggle button present does not throw', () => {
  const doc = stubDocument([...BASE_IDS, ...CHASE_IDS]);
  const ui = createUI(doc);
  ui.bindChase({ onToggle() {} });
  assert.equal(doc.elements.has('chaseBtn'), false);
});

// ── anchor actually moves the rendered model ─────────────────
// Regression: the anchor pose was only written to object.matrix, which three
// discards each frame while matrixAutoUpdate is on.
test('an anchor update moves the object position, not just its matrix', async () => {
  const { NinjaGame } = await import('../src/ninja-game.js');
  const { SpatialMapper } = await import('../src/spatial-mapper.js');

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const at = (x, y, z) => {
    const m = identity.slice();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  };

  const object = {
    matrixAutoUpdate: true,
    matrixWorldNeedsUpdate: false,
    matrix: { fromArray() {} },
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    quaternion: { identity() {} },
    rotation: { set() {} },
    updateMatrix() {},
  };
  const anchor = { anchorSpace: {} };
  const mapper = new SpatialMapper({ minCandidateSpacing: 0.22 });
  mapper.recordSurface({ position: [0, 0, -1], matrix: at(0, 0, -1), upY: 1 });

  const game = new NinjaGame({
    scene: { add() {}, remove() {} },
    ui: { setStatus() {}, setMessage() {}, setControls() {}, flash() {} },
    mapper,
    model: {
      createNinja: () => object,
      revealNinja() {},
      disposeObject() {},
      setNinjaOpacity() {},
      createSurfaceMarker: () => ({}),
    },
    getSession: () => ({}),
    getLocalSpace: () => ({}),
    getViewerPose: () => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }),
    random: () => 0.5,
  });

  assert.equal(game.hideNewTarget(), true);
  game.target.anchor = anchor;
  game.target.anchorState = 'anchor';
  game.updateTargetAnchor({
    getPose: () => ({ transform: { matrix: at(1.5, 0.25, -2.5) } }),
  });

  assert.equal(object.position.x, 1.5);
  assert.equal(object.position.y, 0.25);
  assert.equal(object.position.z, -2.5);
});

test('external control stops the anchor fighting the chase', async () => {
  const { NinjaGame } = await import('../src/ninja-game.js');
  const { SpatialMapper } = await import('../src/spatial-mapper.js');
  const object = {
    matrixAutoUpdate: true,
    matrix: { fromArray() {} },
    position: { x: 9, y: 9, z: 9, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    quaternion: { identity() {} },
    rotation: { set() {} },
    updateMatrix() {},
  };
  const mapper = new SpatialMapper({ minCandidateSpacing: 0.22 });
  mapper.recordSurface({
    position: [0, 0, -1],
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1],
    upY: 1,
  });

  const game = new NinjaGame({
    scene: { add() {}, remove() {} },
    ui: { setStatus() {}, setMessage() {}, setControls() {}, flash() {} },
    mapper,
    model: {
      createNinja: () => object,
      revealNinja() {},
      disposeObject() {},
      setNinjaOpacity() {},
      createSurfaceMarker: () => ({}),
    },
    getSession: () => ({}),
    getLocalSpace: () => ({}),
    getViewerPose: () => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }),
    random: () => 0.5,
  });
  game.hideNewTarget();
  game.setExternalControl(true);
  game.setTargetWorldPosition([2, 0.3, -4], 1.2);

  game.updateTargetAnchor({ getPose: () => ({ transform: { matrix: new Array(16).fill(0) } }) });
  assert.equal(object.position.x, 2, 'anchor overwrote a chase position');
  assert.deepEqual(game.getTargetPosition(), [2, 0.3, -4]);
});

// ── on-device fixes from the first play test ─────────────────
test('the chase page makes nothing in the HUD selectable', async () => {
  // A long press on selectable text raises Android's selection toolbar, and
  // dismissing that toolbar with Back closes Chrome out of the AR session.
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.match(html, /user-select\s*:\s*none/);
  assert.match(html, /-webkit-touch-callout\s*:\s*none/);
  assert.match(html, /contextmenu/);
});

test('the control row clears the system navigation area', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.match(html, /safe-area-inset-bottom/);
  const controls = html.match(/#controls\s*\{[^}]*\}/);
  assert.ok(controls, '#controls rule missing');
  const bottom = controls[0].match(/bottom:calc\((\d+)px/);
  assert.ok(bottom && Number(bottom[1]) >= 48, 'control row still sits on the Back key');
});

test('the chase page drops the two diagnostic buttons', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="markBtn"/);
  assert.doesNotMatch(html, /id="checkBtn"/);
  assert.match(html, /id="hudToggle"/);
});

test('commands and control states survive missing buttons', () => {
  const doc = stubDocument(BASE_IDS.filter((id) => id !== 'markBtn' && id !== 'checkBtn'));
  const ui = createUI(doc);
  ui.bindCommands({
    onScan() {}, onNewRound() {}, onExtend() {}, onMark() {}, onCheck() {},
  });
  ui.setControls({ scan: true, newRound: false, extend: true, mark: true, check: true });
  assert.equal(doc.elements.get('scanBtn').disabled, false);
  assert.equal(doc.elements.get('newRoundBtn').disabled, true);
});

test('metrics start hidden where the page offers a toggle', () => {
  const doc = stubDocument([...BASE_IDS, 'hudToggle']);
  const ui = createUI(doc);
  assert.equal(ui.isMetricsVisible(), false);
  assert.equal(doc.elements.get('metrics').style.display, 'none');

  const toggle = doc.elements.get('hudToggle');
  toggle.listeners.find(([type]) => type === 'click')[1]({ stopPropagation() {} });
  assert.equal(ui.isMetricsVisible(), true);
  assert.equal(doc.elements.get('metrics').style.display, '');
});

test('metrics stay visible on a page with no toggle', () => {
  const ui = createUI(stubDocument(BASE_IDS));
  assert.equal(ui.isMetricsVisible(), true);
});

test('SCAN can be taken off screen for the chase', () => {
  const doc = stubDocument([...BASE_IDS, ...CHASE_IDS]);
  const ui = createUI(doc);
  ui.setScanVisible(false);
  assert.equal(doc.elements.get('scanBtn').style.display, 'none');
  ui.setScanVisible(true);
  assert.equal(doc.elements.get('scanBtn').style.display, '');
});

test('without hold handlers SCAN is never wired for a long press', () => {
  const doc = stubDocument([...BASE_IDS, ...CHASE_IDS]);
  const ui = createUI(doc);
  ui.bindChase({ onToggle() {} });
  const scan = doc.elements.get('scanBtn');
  assert.equal(scan.listeners.some(([type]) => type === 'pointerdown'), false);
});

// ── pre-built map flow ───────────────────────────────────────

test('the chase page carries a map button and drops the +20s scan', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.match(html, /id="mapBtn"/);
  assert.doesNotMatch(html, /id="extendBtn"/);
  assert.match(html, /맵 생성/);
});

test('index.html is untouched by the map flow — no map button there', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="mapBtn"/);
});

test('chase-only: the hide-and-seek buttons are gone from the chase page', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="scanBtn"/);
  assert.doesNotMatch(html, /id="newRoundBtn"/);
  // No chase toggle either: freezing the map starts it.
  assert.doesNotMatch(html, /id="chaseBtn"/);
  assert.match(html, /id="mapBtn"/);
});

test('index.html keeps its hide-and-seek buttons', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="scanBtn"/);
  assert.match(html, /id="newRoundBtn"/);
});

// ── the page has no idle state ───────────────────────────────
test('main.js starts the chase from freezeMap, not from a button', async () => {
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  // freezeMap must call startChase itself.
  const freeze = src.slice(src.indexOf('function freezeMap('));
  const body = freeze.slice(0, freeze.indexOf('\n}\n'));
  assert.match(body, /startChase\(\)/);
  // And the old opt-in toggle must be gone entirely.
  assert.doesNotMatch(src, /function toggleChase/);
  assert.doesNotMatch(src, /setChaseButton\('/);
});

test('the chase page instructions describe the automatic start', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.match(html, /맵 생성 종료/);
  assert.doesNotMatch(html, /도망 모드를 누르/);
});

// ── respawn: a bad round costs a button press, not a rescan ──
test('the chase page carries a respawn button, hidden until a chase runs', async () => {
  const html = await readFile(new URL('../v4-chase.html', import.meta.url), 'utf8');
  assert.match(html, /id="respawnBtn"/);
  // It ships hidden; startChase reveals it.
  assert.match(html, /id="respawnBtn"[^>]*display:\s*none/);
});

test('respawn is wired as a command and toggled with the chase panel', async () => {
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /onRespawn:\s*\(\)\s*=>\s*respawnHachuping\(\)/);
  assert.match(src, /ui\.setRespawnVisible\(true\)/);
  assert.match(src, /ui\.setRespawnVisible\(false\)/);
});

test('respawn keeps the map but resets the capture gauge', async () => {
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function respawnHachuping('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  // A near-complete capture must not carry over onto a brand new target.
  assert.match(body, /captureGauge\.reset\(\)/);
  // And the terrain must survive: no grid or map rebuild in here.
  assert.doesNotMatch(body, /chaseGrid\.reset\(\)/);
  assert.doesNotMatch(body, /voxelMap\?\.reset\(\)/);
});

test('the respawn button is bound through bindCommands like the others', () => {
  const doc = stubDocument([...BASE_IDS, ...CHASE_IDS, 'mapBtn', 'respawnBtn']);
  const ui = createUI(doc);
  let respawned = 0;
  ui.bindCommands({ onRespawn() { respawned += 1; } });
  const button = doc.elements.get('respawnBtn');
  const click = button.listeners.find(([type]) => type === 'click');
  click[1]({ stopPropagation() {} });
  assert.equal(respawned, 1);
});
