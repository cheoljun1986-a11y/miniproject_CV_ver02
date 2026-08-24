export function isUsableDepth(depth, maxRange) {
  return Number.isFinite(depth) && depth > 0 && depth <= maxRange;
}

export function triangleFits(depths, maxJump, maxRange) {
  return depths.length === 3
    && triangleFitsThree(depths[0], depths[1], depths[2], maxJump, maxRange);
}

function triangleFitsThree(a, b, c, maxJump, maxRange) {
  if (!isUsableDepth(a, maxRange)
    || !isUsableDepth(b, maxRange)
    || !isUsableDepth(c, maxRange)) return false;
  return Math.max(a, b, c) - Math.min(a, b, c) <= maxJump;
}

export function writeGridTriangleIndices(
  depths,
  cols,
  rows,
  indices,
  maxJump,
  maxRange,
) {
  let writeOffset = 0;

  function writeTriangle(a, b, c) {
    if (writeOffset + 3 > indices.length) return false;
    if (!triangleFitsThree(depths[a], depths[b], depths[c], maxJump, maxRange)) return true;
    indices[writeOffset] = a;
    indices[writeOffset + 1] = b;
    indices[writeOffset + 2] = c;
    writeOffset += 3;
    return true;
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const topLeft = row * cols + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + cols;
      const bottomRight = bottomLeft + 1;
      if (!writeTriangle(topLeft, bottomLeft, topRight)) return writeOffset;
      if (!writeTriangle(topRight, bottomLeft, bottomRight)) return writeOffset;
    }
  }

  return writeOffset;
}
