function distanceAndAngle(candidatePosition, viewerPosition, viewerForward) {
  const offset = candidatePosition.map((value, index) => value - viewerPosition[index]);
  const distance = Math.hypot(...offset);
  const dot = distance > 1e-6
    ? viewerForward.reduce((sum, value, index) => sum + value * offset[index] / distance, 0)
    : 1;
  const angle = distance > 1e-6
    ? Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI
    : 0;

  return { distance, angle };
}

export function forwardFromQuaternion([x, y, z, w]) {
  return [
    -2 * (x * z + w * y),
    2 * (w * x - y * z),
    2 * (x * x + y * y) - 1,
  ];
}

export function measureTarget(targetPosition, viewerPosition, viewerForward) {
  return distanceAndAngle(targetPosition, viewerPosition, viewerForward);
}

export function isDetected(distance, angle, maxDistance, maxAngle) {
  return distance <= maxDistance && angle <= maxAngle;
}

export function rankCandidates(candidates, viewerPosition, viewerForward, random = Math.random) {
  return candidates
    .map((candidate) => {
      const { distance, angle } = distanceAndAngle(
        candidate.pos,
        viewerPosition,
        viewerForward,
      );
      let score = random();
      if (distance >= 1 && distance <= 8) score += 2;
      if (angle >= 25) score += 1.5;
      return { candidate, score, distance, angle };
    })
    .sort((left, right) => right.score - left.score);
}
