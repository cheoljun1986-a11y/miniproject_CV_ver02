export function formatMetrics({
  viewerPosition,
  pathDistance,
  maxDisplacement,
  poolCount,
  hitTestFound,
  phase,
  mappingLeft,
  scans,
  misses,
  lastReturnError,
  occlusionOn = false,
  occlusionMode = null,
  occlusionTriangles = 0,
  chaseLogText = '',
  pointCount = null,
  voxelCount = null,
  depthUsage = null,
  depthDataFormat = null,
  anchorState = null,
}) {
  const [x, y, z] = viewerPosition;
  const voxelTag = voxelCount === null ? '' : ` · 복셀 ${voxelCount}`;
  const occlusionTag = occlusionMode === 'cpu'
    ? `   가림 CPU · 삼각형 ${occlusionTriangles}${voxelTag}`
    : occlusionMode === 'gpu'
      ? '   가림 GPU'
      : occlusionOn ? '   가림 ON' : '';
  const pointTag = pointCount === null ? '' : `   점 ${pointCount}`;
  const mappingTag = voxelCount === null || occlusionMode === 'cpu'
    ? ''
    : `   복셀 ${voxelCount}`;
  const hitTestLine = `표면후보 ${poolCount}   hit-test ${hitTestFound ? 'FOUND' : 'searching'}${occlusionTag}${mappingTag}${pointTag}`;
  return `viewer (m)  x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)}
이동경로 ${pathDistance.toFixed(1)}m   최대변위 ${maxDisplacement.toFixed(1)}m
${hitTestLine}
depth usage ${depthUsage ?? 'unavailable'}
depth format ${depthDataFormat ?? '-'}
${formatAnchorStatus(anchorState)}
phase ${phase}${phase === 'mapping' ? ` (${mappingLeft.toFixed(1)}s)` : ''}
scan ${scans}회 / miss ${misses}회
복귀오차 ${lastReturnError ? `${lastReturnError.posErr.toFixed(2)}m, ${lastReturnError.angleErr.toFixed(1)}°` : '-'}${
  // Flight recorder: only rendered while a chase has actually logged something,
  // so ordinary sessions keep the card the size it was.
  chaseLogText ? `\n── 도망 기록 ──\n${chaseLogText}` : ''}`;
}

export function formatAnchorStatus(state) {
  return ({
    'anchor-pending': '고정 anchor 준비',
    anchor: '고정 anchor',
    'anchor-lost': '고정 anchor (추적 일시 손실)',
    local: '고정 local',
  })[state] ?? '고정 -';
}

function formatPosition(label, position) {
  if (!position) return `${label} -`;
  return `${label}  x ${position[0].toFixed(2)}  y ${position[1].toFixed(2)}  z ${position[2].toFixed(2)}`;
}

export function formatOperatorStatus({
  anchorState = null,
  voxelCount = 0,
  ninjaPosition = null,
  playerPosition = null,
  pathPointCount = 0,
}) {
  return `운영자 공간지도 · 복셀 ${voxelCount}
${formatAnchorStatus(anchorState)}
${formatPosition('Ninja', ninjaPosition)}
${formatPosition('플레이어', playerPosition)} · 경로 ${pathPointCount}점`;
}

// Everything Phase 2 diagnosis needs to read off the phone in one card: how
// much material the scan gathered, where the depth samples went, and how the
// observation histogram responds to the threshold slider.
export function formatVoxelDebugStatus({
  scanning = false,
  scanLeftSec = 0,
  keyframeCount = 0,
  maxKeyframes = 0,
  elapsedMs = 0,
  cellCount = 0,
  displayedCount = 0,
  truncated = false,
  histogram = null,
  colorMode = '',
  params = null,
  buildMs = 0,
  rejected = null,
  imported = false,
}) {
  const h = histogram ?? { one: 0, two: 0, three: 0, fourPlus: 0 };
  const r = rejected ?? { zero: 0, range: 0, gradient: 0, accepted: 0 };
  const p = params ?? { nearM: 0, farM: 0, gradientMaxJumpM: 0, voxelSize: 0, minObservations: 1 };

  const source = imported ? 'JSON 불러옴' : scanning ? `스캔 중 ${scanLeftSec.toFixed(0)}s` : '스캔 완료';
  const truncatedTag = truncated ? ' ⚠상한' : '';

  return `복셀 디버그 · ${source} · 키프레임 ${keyframeCount}/${maxKeyframes} · 경과 ${(elapsedMs / 1000).toFixed(1)}s
복셀 ${cellCount} (표시 ${displayedCount})${truncatedTag} · 재구성 ${Math.round(buildMs)}ms
관측 1회 ${h.one} · 2회 ${h.two} · 3+회 ${h.three + h.fourPlus}
클립 ${p.nearM.toFixed(2)}–${p.farM.toFixed(2)}m · 그래디언트 ${p.gradientMaxJumpM.toFixed(2)}m · 크기 ${p.voxelSize.toFixed(2)}m · 임계 ${p.minObservations}
버림  0값 ${r.zero} · 범위 ${r.range} · 경사 ${r.gradient} · 수용 ${r.accepted}
색상 ${colorMode}`;
}

// The panel (z-25) sits above #operatorOverlay (z-20), so both are on screen at
// once. Sending the full block to both duplicates six lines; the orbit view gets
// this one-liner instead so the numbers stay readable without the repetition.
export function formatVoxelDebugSummary({
  cellCount = 0,
  displayedCount = 0,
  clusterCount = null,
  keyframeCount = 0,
  maxKeyframes = 0,
  buildMs = 0,
}) {
  const clusters = clusterCount === null ? '' : ` · 클러스터 ${clusterCount}`;
  return `복셀 ${cellCount} (표시 ${displayedCount})${clusters}`
    + ` · 키프레임 ${keyframeCount}/${maxKeyframes} · 재구성 ${Math.round(buildMs)}ms`;
}

export function createUI(documentRoot = document) {
  const elements = {
    status: documentRoot.querySelector('#status'),
    metrics: documentRoot.querySelector('#metrics'),
    message: documentRoot.querySelector('#message'),
    scan: documentRoot.querySelector('#scanBtn'),
    newRound: documentRoot.querySelector('#newRoundBtn'),
    extend: documentRoot.querySelector('#extendBtn'),
    mark: documentRoot.querySelector('#markBtn'),
    check: documentRoot.querySelector('#checkBtn'),
    scanFlash: documentRoot.querySelector('#scanFlash'),
    fallback: documentRoot.querySelector('#fallback'),
    fallbackDetail: documentRoot.querySelector('#fallbackDetail'),
    operatorBtn: documentRoot.querySelector('#operatorBtn'),
    operatorOverlay: documentRoot.querySelector('#operatorOverlay'),
    operatorCanvas: documentRoot.querySelector('#operatorCanvas'),
    operatorCloseBtn: documentRoot.querySelector('#operatorCloseBtn'),
    operatorStatus: documentRoot.querySelector('#operatorStatus'),
    // Chase mode elements exist only on the chase page; every use below is
    // guarded so index.html keeps behaving exactly as before.
    chaseBtn: documentRoot.querySelector('#chaseBtn'),
    chasePanel: documentRoot.querySelector('#chasePanel'),
    chaseGaugeFill: documentRoot.querySelector('#chaseGaugeFill'),
    chaseHint: documentRoot.querySelector('#chaseHint'),
    chaseArrow: documentRoot.querySelector('#chaseArrow'),
    hudToggle: documentRoot.querySelector('#hudToggle'),
    map: documentRoot.querySelector('#mapBtn'),
  };

  // The metrics card is a diagnostic wall of text that covers half a phone
  // screen. On a page that offers a toggle it starts hidden.
  let metricsVisible = !elements.hudToggle;

  function applyMetricsVisible() {
    if (elements.metrics) elements.metrics.style.display = metricsVisible ? '' : 'none';
    if (elements.hudToggle) elements.hudToggle.textContent = metricsVisible ? '수치 ✕' : '수치';
  }

  if (elements.hudToggle) {
    elements.hudToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      metricsVisible = !metricsVisible;
      applyMetricsVisible();
    });
    applyMetricsVisible();
  }

  function bindCommands({ onScan, onNewRound, onExtend, onMark, onCheck, onMap }) {
    const bindings = [
      [elements.scan, onScan],
      [elements.newRound, onNewRound],
      [elements.extend, onExtend],
      [elements.mark, onMark],
      [elements.check, onCheck],
      [elements.map, onMap],
    ];
    // The chase page drops the two diagnostic buttons, so a missing element is
    // normal rather than a mistake.
    bindings.forEach(([element, command]) => {
      if (!element || !command) return;
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        command();
      });
    });
  }

  function setControls({ scan, newRound, extend, mark, check }) {
    const states = [
      [elements.scan, scan],
      [elements.newRound, newRound],
      [elements.extend, extend],
      [elements.mark, mark],
      [elements.check, check],
    ];
    states.forEach(([element, enabled]) => {
      if (element) element.disabled = !enabled;
    });
  }

  function bindOperator({ onToggle }) {
    elements.operatorBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggle(true);
    });
    elements.operatorCloseBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggle(false);
    });
  }

  // Chase mode used to ask the player to HOLD scan. On Android a long press on
  // a DOM button raises the text-selection toolbar, and dismissing it with Back
  // closes the browser, so the hold is gone unless handlers are passed in.
  function bindChase({ onToggle, onHoldStart, onHoldEnd }) {
    if (elements.chaseBtn) {
      elements.chaseBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        onToggle();
      });
    }
    const scan = elements.scan;
    if (!scan || !onHoldStart || !onHoldEnd) return;
    const start = (event) => {
      event.stopPropagation();
      onHoldStart();
    };
    const end = (event) => {
      event.stopPropagation();
      onHoldEnd();
    };
    scan.addEventListener('pointerdown', start);
    scan.addEventListener('pointerup', end);
    scan.addEventListener('pointercancel', end);
    scan.addEventListener('pointerleave', end);
    // A pointer released outside the button must still stop the attempt.
    documentRoot.addEventListener?.('pointerup', () => onHoldEnd());
  }

  function flash() {
    elements.scanFlash.style.borderWidth = '10px';
    elements.scanFlash.style.borderColor = 'rgba(255,255,255,.85)';
    setTimeout(() => {
      elements.scanFlash.style.borderWidth = '0px';
      elements.scanFlash.style.borderColor = 'rgba(255,255,255,0)';
    }, 130);
  }

  return {
    bindCommands,
    setControls,
    setStatus(text) {
      elements.status.textContent = text;
    },
    setMessage(text) {
      elements.message.textContent = text;
    },
    setMetrics(text) {
      elements.metrics.textContent = text;
    },
    setMetricsVisible(visible) {
      metricsVisible = Boolean(visible);
      applyMetricsVisible();
    },
    isMetricsVisible() {
      return metricsVisible;
    },
    // SCAN has no meaning while Hachuping is running, and leaving it there
    // invites the long press the capture rule no longer wants.
    setScanVisible(visible) {
      if (elements.scan) elements.scan.style.display = visible ? '' : 'none';
    },
    showFallback(detail) {
      elements.fallbackDetail.textContent = detail;
      elements.fallback.style.display = 'flex';
    },
    flash,
    bindOperator,
    setMetricsVisible(visible) {
      elements.metrics.style.display = visible ? '' : 'none';
    },
    setOperatorButtonVisible(visible) {
      elements.operatorBtn.style.display = visible ? '' : 'none';
    },
    setOperatorVisible(visible) {
      elements.operatorOverlay.style.display = visible ? 'block' : 'none';
    },
    setOperatorStatus(text) {
      elements.operatorStatus.textContent = text;
    },
    getOperatorCanvas() {
      return elements.operatorCanvas;
    },
    bindChase,
    hasChaseControls() {
      return Boolean(elements.chaseBtn);
    },
    // Map-building lifecycle button; only the chase page has one.
    setMapButton(label, enabled) {
      if (!elements.map) return;
      elements.map.textContent = label;
      elements.map.disabled = !enabled;
    },
    hasMapButton() {
      return Boolean(elements.map);
    },
    setChaseButton(label, enabled) {
      if (!elements.chaseBtn) return;
      elements.chaseBtn.textContent = label;
      elements.chaseBtn.disabled = !enabled;
    },
    setChaseVisible(visible) {
      if (!elements.chasePanel) return;
      elements.chasePanel.style.display = visible ? 'flex' : 'none';
    },
    setChaseGauge(value) {
      if (!elements.chaseGaugeFill) return;
      elements.chaseGaugeFill.style.width = `${Math.round(value * 100)}%`;
      elements.chaseGaugeFill.style.background = value >= 1
        ? '#35d07f'
        : (value > 0 ? '#ffc44d' : '#556');
    },
    setChaseHint(text) {
      if (elements.chaseHint) elements.chaseHint.textContent = text;
    },
    // Points at Hachuping when it has run out of frame. Without this the
    // player simply loses it and the chase stalls.
    setChaseArrow(angleRad) {
      if (!elements.chaseArrow) return;
      if (angleRad === null) {
        elements.chaseArrow.style.display = 'none';
        return;
      }
      elements.chaseArrow.style.display = 'block';
      elements.chaseArrow.style.transform =
        `translate(-50%, -50%) rotate(${angleRad}rad)`;
    },
  };
}
