import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ScanUploader,
  formatBytes,
  formatSessionId,
  shouldBackup,
  uploadName,
} from '../src/scan-uploader.js';

test('session ids are filesystem-safe local timestamps', () => {
  assert.equal(formatSessionId(new Date(2026, 7, 26, 9, 5, 3)), '20260826-090503');
  assert.equal(uploadName('game', '20260826-090503'), 'game-20260826-090503');
  assert.throws(() => uploadName('../etc', 'x'));
});

test('a backup is due only when the map changed and the interval elapsed', () => {
  assert.equal(shouldBackup({ now: 31000, lastBackupAt: 0, intervalMs: 30000, dirty: true }), true);
  assert.equal(shouldBackup({ now: 29000, lastBackupAt: 0, intervalMs: 30000, dirty: true }), false);
  assert.equal(shouldBackup({ now: 90000, lastBackupAt: 0, intervalMs: 30000, dirty: false }), false);
});

function fakeFetch(respond) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetchFn, calls };
}

test('a successful upload posts JSON to /upload?name= and reports the stored file', async () => {
  const { fetchFn, calls } = fakeFetch(async () => ({
    ok: true, status: 200, json: async () => ({ ok: true, file: 'results/game-1.json' }),
  }));
  const statuses = [];
  const uploader = new ScanUploader({ fetchFn, onStatus: (s) => statuses.push(s) });

  const result = await uploader.upload('game-1', '{"a":1}');
  assert.deepEqual(result, { ok: true, file: 'results/game-1.json' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, './upload?name=game-1');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"a":1}');
  assert.match(statuses.at(-1), /전송 완료 · results\/game-1\.json/);
});

test('a missing endpoint fails quietly with a status line, never a throw', async () => {
  const { fetchFn } = fakeFetch(async () => ({ ok: false, status: 404 }));
  const statuses = [];
  const uploader = new ScanUploader({ fetchFn, onStatus: (s) => statuses.push(s) });
  const result = await uploader.upload('scan-1', '{}');
  assert.equal(result.ok, false);
  assert.match(statuses.at(-1), /업로드 서버 없음/);

  const thrower = new ScanUploader({
    fetchFn: async () => { throw new Error('offline'); },
    onStatus: (s) => statuses.push(s),
  });
  const failed = await thrower.upload('scan-1', '{}');
  assert.equal(failed.ok, false);
  assert.match(statuses.at(-1), /전송 실패 · offline/);
});

test('uploads are serialised: a second call while one is in flight is skipped', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const uploader = new ScanUploader({
    fetchFn: async () => { await gate; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  const first = uploader.upload('game-1', '{}');
  assert.equal(uploader.isBusy(), true);
  assert.deepEqual(await uploader.upload('game-1', '{}'), { ok: false, skipped: true });
  release();
  assert.equal((await first).ok, true);
  assert.equal(uploader.isBusy(), false);
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512B');
  assert.equal(formatBytes(2048), '2KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0MB');
});
