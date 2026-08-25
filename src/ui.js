import { drawMove, MOVE_LABELS } from './rps-art.js';

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
복귀오차 ${lastReturnError ? `${lastReturnError.posErr.toFixed(2)}m, ${lastReturnError.angleErr.toFixed(1)}°` : '-'}`;
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
    rpsOverlay: documentRoot.querySelector('#rpsOverlay'),
    rpsCountdown: documentRoot.querySelector('#rpsCountdown'),
    handStatus: documentRoot.querySelector('#handStatus'),
    playerMoveCanvas: documentRoot.querySelector('#playerMoveCanvas'),
    ninjaMoveCanvas: documentRoot.querySelector('#ninjaMoveCanvas'),
    playerMoveLabel: documentRoot.querySelector('#playerMoveLabel'),
    ninjaMoveLabel: documentRoot.querySelector('#ninjaMoveLabel'),
    rpsResult: documentRoot.querySelector('#rpsResult'),
    rpsError: documentRoot.querySelector('#rpsError'),
    manualMoves: documentRoot.querySelector('#manualMoves'),
    manualRock: documentRoot.querySelector('#manualRock'),
    manualPaper: documentRoot.querySelector('#manualPaper'),
    manualScissors: documentRoot.querySelector('#manualScissors'),
  };

  function bindCommands({ onScan, onNewRound, onExtend, onMark, onCheck }) {
    const bindings = [
      [elements.scan, onScan],
      [elements.newRound, onNewRound],
      [elements.extend, onExtend],
      [elements.mark, onMark],
      [elements.check, onCheck],
    ];
    bindings.forEach(([element, command]) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        command();
      });
    });
  }

  function setControls({ scan, newRound, extend, mark, check }) {
    elements.scan.disabled = !scan;
    elements.newRound.disabled = !newRound;
    elements.extend.disabled = !extend;
    elements.mark.disabled = !mark;
    elements.check.disabled = !check;
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

  function flash() {
    elements.scanFlash.style.borderWidth = '10px';
    elements.scanFlash.style.borderColor = 'rgba(255,255,255,.85)';
    setTimeout(() => {
      elements.scanFlash.style.borderWidth = '0px';
      elements.scanFlash.style.borderColor = 'rgba(255,255,255,0)';
    }, 130);
  }

  function bindManualMoves(onMove) {
    const bindings = [
      [elements.manualRock, 'rock'],
      [elements.manualPaper, 'paper'],
      [elements.manualScissors, 'scissors'],
    ];
    for (const [element, move] of bindings) {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        onMove(move);
      });
    }
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
    showFallback(detail) {
      elements.fallbackDetail.textContent = detail;
      elements.fallback.style.display = 'flex';
    },
    flash,
    bindOperator,
    bindManualMoves,
    setDuelVisible(visible) {
      elements.rpsOverlay.style.display = visible ? 'flex' : 'none';
    },
    setCountdown(value) {
      elements.rpsCountdown.textContent = value ? String(value) : '가위바위보!';
    },
    setHandStatus(text) {
      elements.handStatus.textContent = text;
    },
    showMoves({ playerMove, ninjaMove, result }) {
      drawMove(elements.playerMoveCanvas.getContext('2d'), playerMove);
      drawMove(elements.ninjaMoveCanvas.getContext('2d'), ninjaMove);
      elements.playerMoveLabel.textContent = MOVE_LABELS[playerMove] ?? '-';
      elements.ninjaMoveLabel.textContent = MOVE_LABELS[ninjaMove] ?? '-';
      elements.rpsResult.textContent = ({
        win: '승리!',
        draw: '무승부 — 다시!',
        lose: '패배 — Ninja가 도망갑니다!',
      })[result] ?? '';
    },
    showDuelError(text) {
      elements.rpsError.textContent = text;
      elements.rpsError.style.display = text ? 'block' : 'none';
    },
    setManualMode(enabled) {
      elements.manualMoves.style.display = enabled ? 'flex' : 'none';
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
  };
}
