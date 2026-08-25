export function isDepthUpdateDue(lastSampleTime, time, sampleGapMs) {
  return time - lastSampleTime >= sampleGapMs;
}

export function isDepthStale(lastDepthTime, time, staleMs) {
  return time - lastDepthTime > staleMs;
}

export function shouldUpdatePointGeometry(renderPoints) {
  return renderPoints === true;
}
