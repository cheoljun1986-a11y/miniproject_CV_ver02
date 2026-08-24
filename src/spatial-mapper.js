function distance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function cloneVector(values) {
  return Array.from(values);
}

export class SpatialMapper {
  constructor({
    minCandidateSpacing = 0.22,
    maxTrackingStep = 0.35,
    horizontalThreshold = 0.62,
  } = {}) {
    this.minCandidateSpacing = minCandidateSpacing;
    this.maxTrackingStep = maxTrackingStep;
    this.horizontalThreshold = horizontalThreshold;
    this.resetSession();
  }

  resetSession() {
    this.resetCandidates();
    this.pathDistance = 0;
    this.lastViewerPosition = null;
    this.maxDisplacement = 0;
    this.sessionStartPosition = null;
    this.checkpoint = null;
    this.lastReturnError = null;
  }

  resetCandidates() {
    this.candidates = [];
    this.allCandidates = [];
    this.lastCandidate = null;
  }

  recordSurface({ position, matrix, upY }) {
    const nextPosition = cloneVector(position);
    if (
      this.lastCandidate
      && distance(nextPosition, this.lastCandidate) < this.minCandidateSpacing
    ) {
      return false;
    }

    const candidate = {
      matrix: Array.from(matrix),
      pos: nextPosition,
    };
    this.allCandidates.push(candidate);
    if (upY > this.horizontalThreshold) this.candidates.push(candidate);
    this.lastCandidate = nextPosition;
    return true;
  }

  getPool() {
    return this.candidates.length >= 5 ? this.candidates : this.allCandidates;
  }

  recordViewer(position) {
    const nextPosition = cloneVector(position);
    if (!this.sessionStartPosition) this.sessionStartPosition = cloneVector(nextPosition);

    if (this.lastViewerPosition) {
      const step = distance(nextPosition, this.lastViewerPosition);
      if (step < this.maxTrackingStep) this.pathDistance += step;
    }
    this.lastViewerPosition = cloneVector(nextPosition);
    this.maxDisplacement = Math.max(
      this.maxDisplacement,
      distance(nextPosition, this.sessionStartPosition),
    );

    return this.getMetrics();
  }

  saveCheckpoint(position, quaternion) {
    this.checkpoint = {
      position: cloneVector(position),
      quaternion: cloneVector(quaternion),
    };
    this.lastReturnError = null;
  }

  checkReturnError(position, quaternion) {
    if (!this.checkpoint) return null;

    const posErr = distance(position, this.checkpoint.position);
    const dot = quaternion.reduce(
      (sum, value, index) => sum + value * this.checkpoint.quaternion[index],
      0,
    );
    const angleErr = 2 * Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI;
    this.lastReturnError = { posErr, angleErr };
    return this.lastReturnError;
  }

  getMetrics() {
    return {
      pathDistance: this.pathDistance,
      maxDisplacement: this.maxDisplacement,
      poolCount: this.getPool().length,
      hasCheckpoint: Boolean(this.checkpoint),
      lastReturnError: this.lastReturnError,
    };
  }
}

