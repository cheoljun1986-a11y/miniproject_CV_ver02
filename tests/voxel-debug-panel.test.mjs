import test from 'node:test';
import assert from 'node:assert/strict';

import { installDocument } from './support/dom-stub.mjs';

const { createVoxelDebugPanel } = await import('../src/voxel-debug-panel.js');

// A controller stand-in: the panel only ever asks it questions and tells it to
// start or stop, so the scan window is all this has to model.
function fakeController({ scanning = true, cells = 0 } = {}) {
  return {
    scanning,
    started: 0,
    stopped: 0,
    keyframeCount: 12,
    isScanning() { return this.scanning; },
    startScan() { this.started += 1; this.scanning = true; },
    stopScan() { this.stopped += 1; this.scanning = false; },
    getCellCount() { return cells; },
    getStats() { return { keyframeCount: this.keyframeCount, colorMode: '관측' }; },
    getParams() { return { voxelSize: 0.05, nearM: 0.3, farM: 5, gradientMaxJumpM: 0.1, minObservations: 3 }; },
    setParam() { return { changed: false }; },
    getKeyframePoses() { return []; },
    isImported() { return false; },
    cycleColorMode() {},
    exportJSON() { return '{}'; },
  };
}

const fakeOverlay = () => ({ visible: false, isVisible() { return this.visible; }, setVisible(v) { this.visible = v; } });

function build(options = {}) {
  const dom = installDocument();
  const controller = options.controller ?? fakeController();
  const panel = createVoxelDebugPanel({
    root: dom.root,
    controller,
    overlay: fakeOverlay(),
    documentRoot: dom.doc,
    now: () => 0,
    ...options,
  });
  return { panel, controller, dom, find: (t) => dom.root.findByText(t) };
}

test('the scan can be ended by hand, which is what builds the map', () => {
  const { controller, find, dom } = build();
  const button = find('스캔 정지');
  assert.ok(button, 'a running scan offers a stop button');

  button.click();
  assert.equal(controller.stopped, 1);
  assert.equal(find('스캔 시작') !== null, true, 'the button flips to start');
  dom.restore();
});

test('starting again resumes the scan rather than offering nothing', () => {
  const { controller, find, dom } = build({ controller: fakeController({ scanning: false }) });
  find('스캔 시작').click();
  assert.equal(controller.started, 1);
  assert.ok(find('스캔 정지'), 'back to a stoppable scan');
  dom.restore();
});

test('a finished scan says so, so the overlay is known to have something to draw', () => {
  const { find, dom } = build({ controller: fakeController({ scanning: false, cells: 5000 }) });
  assert.match(find('스캔 시작').textContent, /맵 완성/);
  dom.restore();
});

test('the stop button counts the keyframes captured so far', () => {
  const { find, dom } = build();
  assert.match(find('스캔 정지').textContent, /12장/);
  dom.restore();
});

test('upload progress gets its own line and clears again', () => {
  const { panel, dom } = build();
  const line = () => dom.root.findByText('⬆ 서버 전송 시작');
  assert.equal(line(), null, 'nothing shown before an upload');

  panel.setUploadStatus('⬆ 서버 전송 시작 · scan-1 (20.7MB)');
  const shown = line();
  assert.ok(shown);
  assert.notEqual(shown.style.display, 'none');

  panel.setUploadStatus('');
  assert.equal(shown.style.display, 'none');
  dom.restore();
});

test('the upload button is offered only when there is somewhere to send', () => {
  const withUpload = build({ onUpload: () => {} });
  assert.ok(withUpload.find('서버로 전송'));
  withUpload.dom.restore();

  const without = build();
  assert.equal(without.find('서버로 전송'), null);
  without.dom.restore();
});
