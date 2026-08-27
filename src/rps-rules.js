export const MOVES = Object.freeze(['rock', 'paper', 'scissors']);

const GESTURE_TO_MOVE = Object.freeze({
  Closed_Fist: 'rock',
  Open_Palm: 'paper',
  Victory: 'scissors',
});

const BEATS = Object.freeze({
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
});

export function mapGestureLabel(label) {
  return GESTURE_TO_MOVE[label] ?? null;
}

export function chooseMove(random = Math.random) {
  const index = Math.min(MOVES.length - 1, Math.max(0, Math.floor(random() * MOVES.length)));
  return MOVES[index];
}

export function evaluateRound(playerMove, ninjaMove) {
  if (!MOVES.includes(playerMove) || !MOVES.includes(ninjaMove)) {
    throw new TypeError('Both moves must be rock, paper, or scissors.');
  }
  if (playerMove === ninjaMove) return 'draw';
  return BEATS[playerMove] === ninjaMove ? 'win' : 'lose';
}
