import test from 'node:test';
import assert from 'node:assert/strict';

import { createUI } from '../src/ui.js';

function makeElement(isCanvas = false) {
  const listeners = new Map();
  const drawCalls = [];
  return {
    style: {},
    textContent: '',
    disabled: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { listeners.get('click')?.({ stopPropagation() {} }); },
    getContext: isCanvas ? () => ({
      canvas: { width: 160, height: 160 },
      clearRect(...args) { drawCalls.push(['clearRect', ...args]); },
      save() {}, restore() {}, translate() {}, scale() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
      quadraticCurveTo() {}, arc() {}, fill() {}, stroke() {},
      fillText() {}, roundRect() {},
    }) : undefined,
    drawCalls,
  };
}

function makeDocument() {
  const elements = new Map();
  return {
    elements,
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, makeElement(selector.endsWith('Canvas')));
      }
      return elements.get(selector);
    },
  };
}

test('duel UI exposes countdown hand status and simultaneous move results', () => {
  const documentRoot = makeDocument();
  const ui = createUI(documentRoot);
  ui.setDuelVisible(true);
  ui.setCountdown(3);
  ui.setHandStatus('바위를 인식하는 중');
  ui.showMoves({ playerMove: 'rock', ninjaMove: 'scissors', result: 'win' });

  assert.equal(documentRoot.elements.get('#rpsOverlay').style.display, 'flex');
  assert.equal(documentRoot.elements.get('#rpsCountdown').textContent, '3');
  assert.equal(documentRoot.elements.get('#handStatus').textContent, '바위를 인식하는 중');
  assert.equal(documentRoot.elements.get('#playerMoveLabel').textContent, '바위');
  assert.equal(documentRoot.elements.get('#ninjaMoveLabel').textContent, '가위');
  assert.equal(documentRoot.elements.get('#rpsResult').textContent, '승리!');
  assert.ok(documentRoot.elements.get('#playerMoveCanvas').drawCalls.length > 0);
  assert.ok(documentRoot.elements.get('#ninjaMoveCanvas').drawCalls.length > 0);
});

test('normal mode hides manual controls and debug mode binds exact moves', () => {
  const documentRoot = makeDocument();
  const ui = createUI(documentRoot);
  const moves = [];
  ui.bindManualMoves((move) => moves.push(move));
  ui.setManualMode(false);
  assert.equal(documentRoot.elements.get('#manualMoves').style.display, 'none');
  ui.setManualMode(true);
  assert.equal(documentRoot.elements.get('#manualMoves').style.display, 'flex');

  documentRoot.elements.get('#manualRock').click();
  documentRoot.elements.get('#manualPaper').click();
  documentRoot.elements.get('#manualScissors').click();
  assert.deepEqual(moves, ['rock', 'paper', 'scissors']);
});

test('duel errors remain visible without enabling manual mode', () => {
  const documentRoot = makeDocument();
  const ui = createUI(documentRoot);
  ui.setManualMode(false);
  ui.showDuelError('이 기기에서는 AR 카메라 손 인식을 사용할 수 없습니다.');
  assert.equal(documentRoot.elements.get('#rpsError').style.display, 'block');
  assert.match(documentRoot.elements.get('#rpsError').textContent, /손 인식/);
  assert.equal(documentRoot.elements.get('#manualMoves').style.display, 'none');
});
