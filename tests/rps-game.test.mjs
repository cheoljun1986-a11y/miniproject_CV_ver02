import test from 'node:test';
import assert from 'node:assert/strict';

import { RpsGame } from '../src/rps-game.js';

function makeGame(random = () => 0) {
  const events = [];
  const game = new RpsGame({
    random,
    countdownMs: 3000,
    readTimeoutMs: 2500,
    resultMs: 1200,
    onPhase: (state) => events.push(['phase', state.phase]),
    onReveal: (result) => events.push(['reveal', result]),
    onWin: () => events.push(['win']),
    onDraw: () => events.push(['draw']),
    onLose: () => events.push(['lose']),
    onRetry: () => events.push(['retry']),
  });
  return { game, events };
}

test('counts down before accepting a player move', () => {
  const { game } = makeGame();
  game.start(0);
  assert.deepEqual(game.getState(), {
    phase: 'duel-countdown',
    countdown: 3,
    playerMove: null,
    ninjaMove: null,
    result: null,
    round: 1,
  });
  assert.equal(game.acceptPlayerMove('paper', 1000), false);
  game.update(2999);
  assert.equal(game.getState().phase, 'duel-countdown');
  game.update(3000);
  assert.equal(game.getState().phase, 'duel-reading');
});

test('reveals both moves together and reports a win once', () => {
  const { game, events } = makeGame(() => 0);
  game.start(0);
  game.update(3000);
  assert.equal(game.acceptPlayerMove('paper', 3100), true);
  assert.deepEqual(game.getState(), {
    phase: 'duel-result',
    countdown: 0,
    playerMove: 'paper',
    ninjaMove: 'rock',
    result: 'win',
    round: 1,
  });
  assert.deepEqual(events.find(([type]) => type === 'reveal'), [
    'reveal',
    { playerMove: 'paper', ninjaMove: 'rock', result: 'win' },
  ]);
  game.update(4299);
  assert.equal(events.filter(([type]) => type === 'win').length, 0);
  game.update(4300);
  game.update(5000);
  assert.equal(events.filter(([type]) => type === 'win').length, 1);
  assert.equal(game.getState().phase, 'idle');
});

test('draw starts a fresh countdown on the same duel controller', () => {
  const { game, events } = makeGame(() => 0);
  game.start(0);
  game.update(3000);
  game.acceptPlayerMove('rock', 3100);
  game.update(4300);
  assert.equal(events.filter(([type]) => type === 'draw').length, 1);
  assert.equal(game.getState().phase, 'duel-countdown');
  assert.equal(game.getState().round, 2);
});

test('loss reports once and becomes idle', () => {
  const { game, events } = makeGame(() => 0);
  game.start(0);
  game.update(3000);
  game.acceptPlayerMove('scissors', 3100);
  game.update(4300);
  game.update(6000);
  assert.equal(events.filter(([type]) => type === 'lose').length, 1);
  assert.equal(game.getState().phase, 'idle');
});

test('recognition timeout retries without awarding a loss', () => {
  const { game, events } = makeGame();
  game.start(0);
  game.update(3000);
  game.update(5500);
  assert.equal(game.getState().phase, 'duel-reading');
  assert.equal(events.filter(([type]) => type === 'retry').length, 1);
  assert.equal(events.filter(([type]) => type === 'lose').length, 0);
  game.update(7999);
  assert.equal(events.filter(([type]) => type === 'retry').length, 1);
  game.update(8000);
  assert.equal(events.filter(([type]) => type === 'retry').length, 2);
});

test('reset cancels the active round state', () => {
  const { game } = makeGame();
  game.start(0);
  game.reset();
  game.update(10000);
  assert.deepEqual(game.getState(), {
    phase: 'idle',
    countdown: 0,
    playerMove: null,
    ninjaMove: null,
    result: null,
    round: 0,
  });
});
