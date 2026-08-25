const VALID_MOVES = new Set(['rock', 'paper', 'scissors']);

export class GestureConsensus {
  constructor({ minConfidence, requiredMatches, windowSize, maxAgeMs }) {
    this.minConfidence = minConfidence;
    this.requiredMatches = requiredMatches;
    this.windowSize = windowSize;
    this.maxAgeMs = maxAgeMs;
    this.reset();
  }

  add({ move, confidence, time }) {
    if (this.emitted) return null;

    const cutoff = time - this.maxAgeMs;
    this.samples = this.samples.filter((sample) => sample.time >= cutoff);
    if (!VALID_MOVES.has(move) || confidence < this.minConfidence) return null;

    this.samples.push({ move, time });
    if (this.samples.length > this.windowSize) {
      this.samples.splice(0, this.samples.length - this.windowSize);
    }

    const matches = this.samples.reduce(
      (count, sample) => count + Number(sample.move === move),
      0,
    );
    if (matches < this.requiredMatches) return null;

    this.emitted = true;
    return move;
  }

  reset() {
    this.samples = [];
    this.emitted = false;
  }
}
