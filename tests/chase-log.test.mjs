import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChaseLog } from '../src/chase-log.js';

test('it keeps only the most recent entries', () => {
  const log = new ChaseLog({ capacity: 3 });
  for (let i = 0; i < 10; i += 1) log.push(i * 1000, 'retarget', `${i}`);
  assert.equal(log.size(), 3);
  assert.deepEqual(log.entries().map((e) => e.detail), ['7', '8', '9']);
});

test('recent lines read newest first', () => {
  const log = new ChaseLog();
  log.push(1000, 'start');
  log.push(2000, 'escape', '2.1m');
  const lines = log.formatRecent(2).split('\n');
  assert.match(lines[0], /탈출|escape/);
  assert.match(lines[1], /도망 시작/);
});

test('known event types render in Korean rather than as raw keys', () => {
  const log = new ChaseLog();
  log.push(500, 'reanchor', '0.12m');
  const text = log.formatRecent();
  assert.match(text, /지형 변경/);
  assert.match(text, /0\.12m/);
});

test('an unknown type still renders instead of showing undefined', () => {
  const log = new ChaseLog();
  log.push(0, 'something-new');
  assert.match(log.formatRecent(), /something-new/);
  assert.doesNotMatch(log.formatRecent(), /undefined/);
});

test('an empty log renders as an empty string so the HUD stays unchanged', () => {
  assert.equal(new ChaseLog().formatRecent(), '');
});

test('clear empties it', () => {
  const log = new ChaseLog();
  log.push(0, 'start');
  log.clear();
  assert.equal(log.size(), 0);
});
