export const MOVE_LABELS = Object.freeze({
  rock: '바위',
  paper: '보',
  scissors: '가위',
});

const MOVE_COLORS = Object.freeze({
  rock: '#ffb347',
  paper: '#65d6ff',
  scissors: '#ff72b6',
});

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawRock(ctx) {
  roundedRect(ctx, 48, 75, 64, 48, 18);
  ctx.fill();
  for (const [x, y, radius] of [
    [52, 70, 17], [73, 60, 18], [96, 63, 17], [111, 79, 15],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPaper(ctx) {
  roundedRect(ctx, 51, 70, 62, 57, 18);
  ctx.fill();
  const fingers = [
    [48, 31, 15, 65], [67, 20, 15, 68], [86, 25, 15, 65], [105, 38, 14, 56],
  ];
  for (const [x, y, width, height] of fingers) {
    roundedRect(ctx, x, y, width, height, width / 2);
    ctx.fill();
  }
}

function drawScissors(ctx) {
  roundedRect(ctx, 50, 77, 62, 50, 18);
  ctx.fill();
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(72, 88);
  ctx.lineTo(48, 29);
  ctx.moveTo(88, 88);
  ctx.lineTo(111, 29);
  ctx.stroke();
  roundedRect(ctx, 97, 66, 18, 42, 9);
  ctx.fill();
}

export function drawMove(ctx, move) {
  if (!ctx || !MOVE_LABELS[move]) return false;
  const { width = 160, height = 160 } = ctx.canvas ?? {};
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.scale(width / 160, height / 160);
  ctx.fillStyle = MOVE_COLORS[move];
  ctx.strokeStyle = MOVE_COLORS[move];
  ctx.shadowColor = MOVE_COLORS[move];
  ctx.shadowBlur = 12;
  if (move === 'rock') drawRock(ctx);
  else if (move === 'paper') drawPaper(ctx);
  else drawScissors(ctx);
  ctx.restore();
  return true;
}
