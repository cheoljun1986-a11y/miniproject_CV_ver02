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
}) {
  const [x, y, z] = viewerPosition;
  return `viewer (m)  x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)}
이동경로 ${pathDistance.toFixed(1)}m   최대변위 ${maxDisplacement.toFixed(1)}m
표면후보 ${poolCount}   hit-test ${hitTestFound ? 'FOUND' : 'searching'}
phase ${phase}${phase === 'mapping' ? ` (${mappingLeft.toFixed(1)}s)` : ''}
scan ${scans}회 / miss ${misses}회
복귀오차 ${lastReturnError ? `${lastReturnError.posErr.toFixed(2)}m, ${lastReturnError.angleErr.toFixed(1)}°` : '-'}`;
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
    showFallback(detail) {
      elements.fallbackDetail.textContent = detail;
      elements.fallback.style.display = 'flex';
    },
    flash,
  };
}

