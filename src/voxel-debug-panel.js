import { VOXEL_DEBUG_CONTROLS } from './voxel-debug-params.js';

// Built at runtime, only in ?voxel=debug, so nothing about this panel ships to
// the production HUD. app.html stays untouched: createUI() querySelectors a
// fixed list of 16 IDs with no null guards and has no Node coverage, so a dozen
// new slider IDs there would only fail on a phone.

const PANEL_ID = 'voxelDebugPanel';

function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) node.setAttribute('style', style);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createVoxelDebugPanel({
  root,
  controller,
  overlay,
  operatorView = null,
  meshOverlay = null,
  // Called when the mesh becomes visible, so the caller can extract it lazily
  // rather than paying for a surface nobody asked to see.
  onMeshShown = null,
  now = () => (typeof performance !== 'undefined' ? performance.now() : 0),
  onOperatorToggle = null,
  onStartGame = null,
  occluder = null,
  onUpload = null,
  documentRoot = document,
}) {
  const panel = el('div', [
    'position:absolute',
    'left:8px',
    'right:8px',
    'bottom:8px',
    // Above #operatorOverlay (20): the core Phase 2 experiment is dragging the
    // threshold slider while watching the orbit view.
    'z-index:25',
    'padding:8px 10px',
    'border-radius:12px',
    'background:rgba(0,0,0,.72)',
    'backdrop-filter:blur(7px)',
    'color:#fff',
    'font-size:12px',
    'line-height:1.4',
    'max-height:44vh',
    'overflow-y:auto',
    // #hud is pointer-events:none. Without this every slider is dead.
    'pointer-events:auto',
  ].join(';'));
  panel.id = PANEL_ID;

  // Header stays visible when collapsed: the status block plus the toggle.
  const header = el('div', 'display:flex;align-items:flex-start;gap:8px;');
  const status = el('div', 'flex:1 1 auto;white-space:pre-line;font-variant-numeric:tabular-nums;');
  const collapseBtn = el('button', [
    'flex:0 0 auto', 'border:0', 'border-radius:8px', 'padding:2px 8px',
    'font-size:14px', 'background:rgba(255,255,255,.22)', 'color:#fff',
  ].join(';'), '▾');
  header.append(status, collapseBtn);
  panel.appendChild(header);

  const uploadStatus = el('div', [
    'margin-top:4px', 'padding:3px 6px', 'border-radius:6px',
    'background:rgba(255,255,255,.14)', 'font-size:11px', 'white-space:pre-line',
  ].join(';'));
  uploadStatus.style.display = 'none';
  panel.appendChild(uploadStatus);

  const body = el('div', 'margin-top:6px;');
  panel.appendChild(body);
  let collapsed = false;
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    collapseBtn.textContent = collapsed ? '▸' : '▾';
  });

  const sliders = new Map();
  for (const control of VOXEL_DEBUG_CONTROLS) {
    const row = el('div', 'display:flex;align-items:center;gap:8px;margin:3px 0;');
    const label = el('span', 'flex:0 0 62px;', control.label);
    const input = documentRoot.createElement('input');
    input.type = 'range';
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(control.value);
    input.setAttribute('style', 'flex:1 1 auto;min-width:0;');
    const value = el('span', 'flex:0 0 56px;text-align:right;font-variant-numeric:tabular-nums;');

    const paint = (v) => {
      value.textContent = control.step >= 1 ? `${v}` : `${v.toFixed(2)}${control.unit}`;
    };
    paint(control.value);

    input.addEventListener('input', () => {
      const result = controller.setParam(control.id, Number(input.value));
      const applied = controller.getParams()[control.id];
      input.value = String(applied);
      paint(applied);
      if (result.changed) refreshAll();
    });

    row.append(label, input, value);
    body.appendChild(row);
    sliders.set(control.id, { input, paint });
  }

  const buttons = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;');
  const button = (text, onClick) => {
    const node = el('button', [
      'border:0',
      'border-radius:999px',
      'padding:8px 11px',
      'font-weight:700',
      'font-size:12px',
      'background:rgba(255,255,255,.92)',
      'color:#111',
    ].join(';'), text);
    node.addEventListener('click', onClick);
    buttons.appendChild(node);
    return node;
  };

  // The scan has to be ended by hand: the map is only built when the window
  // closes, so without this there is nothing to overlay until the 10-minute
  // timer runs out. Keyframes survive a stop, so starting again resumes.
  const scanBtn = button('스캔 정지', () => {
    const time = now();
    if (controller.isScanning(time)) controller.stopScan(time);
    else controller.startScan(time);
    refreshAll();
  });

  const colorBtn = button('색상 전환', () => {
    controller.cycleColorMode();
    refreshAll();
  });

  // Off -> voxels -> mesh -> off. Two views of the same map answer different
  // questions: the wireframe shows which voxels exist and how often each was
  // seen, the mesh shows the shape they add up to. Keeping both, on one button,
  // is what lets a defect be attributed to the map rather than to the drawing.
  // The mesh step is skipped when there is no field to mesh (?fusion=count, or
  // a scan loaded from JSON).
  const OVERLAY_MODES = ['off', 'voxel', 'mesh'];
  let overlayMode = 'off';

  function canMesh() {
    return Boolean(meshOverlay && controller.getTsdfField?.());
  }

  function applyOverlayMode() {
    overlay.setVisible(overlayMode === 'voxel');
    meshOverlay?.setVisible(overlayMode === 'mesh');
    if (overlayMode === 'mesh') onMeshShown?.();
  }

  const overlayBtn = button('AR 오버레이', () => {
    const next = OVERLAY_MODES[(OVERLAY_MODES.indexOf(overlayMode) + 1) % OVERLAY_MODES.length];
    overlayMode = next === 'mesh' && !canMesh() ? 'off' : next;
    applyOverlayMode();
    refreshAll();
  });

  const frustumBtn = button('카메라 경로', () => {
    frustumsVisible = !frustumsVisible;
    operatorView?.setKeyframePosesVisible(frustumsVisible);
    refreshAll();
  });
  let frustumsVisible = false;

  // Turning this on makes the wireframe get eaten wherever a real object is
  // nearer — that culling IS the evidence the occluder lines up with the room,
  // so it is not something to "fix".
  const occluderBtn = occluder
    ? button('가림 메시', () => { occluder.setVisible(!occluder.isVisible()); refreshAll(); })
    : null;

  if (onOperatorToggle) button('운영자 뷰', () => onOperatorToggle());
  // The game stays idle in this mode; start it on demand once there is an
  // occluder worth hiding behind.
  if (onStartGame) button('게임 시작', () => { onStartGame(); refreshAll(); });

  button('JSON 내보내기', () => {
    const blob = new Blob([controller.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = documentRoot.createElement('a');
    link.href = url;
    link.download = 'voxel-keyframes.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const fileInput = documentRoot.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.setAttribute('style', 'display:none;');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (!controller.importJSON(String(reader.result))) {
        status.textContent = 'JSON 불러오기 실패';
        return;
      }
      // Imported coordinates belong to a different XR local space origin, so
      // drawing them over the live camera would be meaningless.
      overlayMode = 'off';
      applyOverlayMode();
      syncSliders();
      refreshAll();
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
  button('JSON 불러오기', () => fileInput.click());
  // Mid-scan checkpoint to the dev server; the session end sends one anyway.
  if (onUpload) button('서버로 전송', () => onUpload());

  body.append(buttons, fileInput);
  root.appendChild(panel);

  function syncSliders() {
    const params = controller.getParams();
    for (const [id, slider] of sliders) {
      slider.input.value = String(params[id]);
      slider.paint(params[id]);
    }
  }

  function refreshAll() {
    const time = now();
    const scanning = controller.isScanning(time);
    scanBtn.style.background = scanning ? '#ff9c6b' : '#8ee6a0';
    scanBtn.textContent = scanning
      ? `스캔 정지 (${controller.getStats(time).keyframeCount}장)`
      : `스캔 시작${controller.getCellCount() ? ' · 맵 완성' : ''}`;
    overlayBtn.disabled = controller.isImported();
    if (overlayBtn.disabled) {
      // An imported scan's coordinates belong to another session's local space,
      // so anything drawn from it would float somewhere arbitrary.
      if (overlayMode !== 'off') { overlayMode = 'off'; applyOverlayMode(); }
      overlayBtn.textContent = 'AR 오버레이(불가)';
    } else if (overlayMode === 'voxel') {
      overlayBtn.textContent = `AR 복셀 (${controller.getRenderCells().length})`;
    } else if (overlayMode === 'mesh') {
      overlayBtn.textContent = `AR 메시 (${meshOverlay.getTriangleCount().toLocaleString()}△)`;
    } else {
      overlayBtn.textContent = canMesh() ? 'AR 오버레이' : 'AR 오버레이(복셀)';
    }
    overlayBtn.style.background = overlayMode === 'off' ? 'rgba(255,255,255,.92)' : '#ffd66b';
    overlayBtn.style.opacity = overlayBtn.disabled ? '.42' : '1';
    frustumBtn.style.background = frustumsVisible ? '#ffd66b' : 'rgba(255,255,255,.92)';
    frustumBtn.textContent = frustumsVisible
      ? `카메라 경로 (${controller.getKeyframePoses().length})`
      : '카메라 경로';
    colorBtn.textContent = `색상: ${controller.getStats().colorMode}`;
    if (occluderBtn) {
      const on = occluder.isVisible();
      occluderBtn.style.background = on ? '#ffd66b' : 'rgba(255,255,255,.92)';
      occluderBtn.textContent = on ? `가림 메시 (${occluder.getTriangleCount()}△)` : '가림 메시';
    }
  }
  refreshAll();

  return {
    setStatus(text) { status.textContent = text; },
    // Upload progress gets its own line: it must stay readable while the
    // status block above keeps ticking over with scan numbers, and a 20MB
    // send is long enough that "did it work" is a real question.
    setUploadStatus(text) {
      uploadStatus.textContent = text ?? '';
      uploadStatus.style.display = text ? '' : 'none';
    },
    refresh: refreshAll,
    isFrustumsVisible: () => frustumsVisible,
    destroy() { panel.remove(); },
  };
}
