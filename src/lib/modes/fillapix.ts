import type { Difficulty, FillAPixPuzzle, PixelGrid } from '../../types';
import { createRng } from '../rng';

const UNKNOWN = 0;
const FILLED = 1;
const EMPTY = 2;

function neighbourhoods(w: number, h: number): number[][] {
  const out: number[][] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nb: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) nb.push(ny * w + nx);
        }
      }
      out[y * w + x] = nb;
    }
  }
  return out;
}

/** Cells whose 3x3 neighbourhood overlaps that of `c` (Chebyshev distance <= 2). */
function nearClues(w: number, h: number, c: number): number[] {
  const x = c % w;
  const y = Math.floor(c / w);
  const out: number[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
    }
  }
  return out;
}

/** Deterministic Fill-a-Pix solver: single-clue logic plus (optionally) overlapping-pair logic. */
export class FillAPixSolver {
  state: Uint8Array;
  hasClue: Uint8Array;
  unknownCount: number;
  private queue: number[] = [];
  private inQueue: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly counts: number[],
    readonly nb: number[][],
    readonly pairRule: boolean,
  ) {
    this.state = new Uint8Array(w * h);
    this.hasClue = new Uint8Array(w * h);
    this.inQueue = new Uint8Array(w * h);
    this.unknownCount = w * h;
  }

  clone(): FillAPixSolver {
    const s = new FillAPixSolver(this.w, this.h, this.counts, this.nb, this.pairRule);
    s.state = this.state.slice();
    s.hasClue = this.hasClue.slice();
    s.unknownCount = this.unknownCount;
    return s;
  }

  solved(): boolean {
    return this.unknownCount === 0;
  }

  setCell(i: number, v: number): void {
    if (this.state[i] !== UNKNOWN) return;
    this.state[i] = v;
    this.unknownCount--;
    for (const c of this.nb[i]) if (this.hasClue[c]) this.enqueue(c);
  }

  addClue(c: number): void {
    this.hasClue[c] = 1;
    this.enqueue(c);
    this.propagate();
  }

  private enqueue(c: number): void {
    if (!this.inQueue[c]) {
      this.inQueue[c] = 1;
      this.queue.push(c);
    }
  }

  propagate(): void {
    while (this.queue.length) {
      const c = this.queue.pop()!;
      this.inQueue[c] = 0;
      this.checkSingle(c);
      if (this.pairRule) {
        for (const d of nearClues(this.w, this.h, c)) {
          if (this.hasClue[d]) this.checkPair(c, d);
        }
      }
    }
  }

  private checkSingle(c: number): void {
    let filled = 0;
    let unknown = 0;
    for (const i of this.nb[c]) {
      if (this.state[i] === FILLED) filled++;
      else if (this.state[i] === UNKNOWN) unknown++;
    }
    if (unknown === 0) return;
    const rem = this.counts[c] - filled;
    if (rem === 0) {
      for (const i of this.nb[c]) if (this.state[i] === UNKNOWN) this.setCell(i, EMPTY);
    } else if (rem === unknown) {
      for (const i of this.nb[c]) if (this.state[i] === UNKNOWN) this.setCell(i, FILLED);
    }
  }

  private checkPair(a: number, b: number): void {
    const nbA = this.nb[a];
    const nbB = this.nb[b];
    let remA = this.counts[a];
    let remB = this.counts[b];
    const onlyA: number[] = [];
    const onlyB: number[] = [];
    for (const i of nbA) {
      if (this.state[i] === FILLED) remA--;
      else if (this.state[i] === UNKNOWN && !nbB.includes(i)) onlyA.push(i);
    }
    for (const i of nbB) {
      if (this.state[i] === FILLED) remB--;
      else if (this.state[i] === UNKNOWN && !nbA.includes(i)) onlyB.push(i);
    }
    if (onlyA.length === 0 && onlyB.length === 0) return;
    if (remA - remB === onlyA.length) {
      for (const i of onlyA) this.setCell(i, FILLED);
      for (const i of onlyB) this.setCell(i, EMPTY);
    } else if (remB - remA === onlyB.length) {
      for (const i of onlyB) this.setCell(i, FILLED);
      for (const i of onlyA) this.setCell(i, EMPTY);
    }
  }
}

export interface FillAPixOptions {
  difficulty: Difficulty;
  seed: number;
  /** Milliseconds to spend removing redundant clues. */
  pruneBudgetMs?: number;
}

export function generateFillAPix(grid: PixelGrid, opts: FillAPixOptions): FillAPixPuzzle {
  const { width: w, height: h } = grid;
  const n = w * h;
  const solution = grid.cells.map((c) => (c === 1 ? 1 : 0));
  const nb = neighbourhoods(w, h);
  const counts = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const j of nb[i]) s += solution[j];
    counts[i] = s;
  }
  const pairRule = opts.difficulty === 'normal';
  const rng = createRng(opts.seed ^ 0xf111);
  const solver = new FillAPixSolver(w, h, counts, nb, pairRule);
  const clued = new Uint8Array(n);

  // Forward construction: keep adding the most useful clue until logic reaches every cell.
  let guard = 0;
  while (!solver.solved() && guard++ < n + 5) {
    let best: number[] = [];
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (clued[i]) continue;
      let unknown = 0;
      let filled = 0;
      for (const j of nb[i]) {
        if (solver.state[j] === UNKNOWN) unknown++;
        else if (solver.state[j] === FILLED) filled++;
      }
      if (unknown === 0) continue;
      const rem = counts[i] - filled;
      const known = nb[i].length - unknown;
      const score = rem === 0 || rem === unknown ? 100 + unknown : known;
      if (score > bestScore) {
        bestScore = score;
        best = [i];
      } else if (score === bestScore) {
        best.push(i);
      }
    }
    if (best.length === 0) break;
    let pick: number;
    if (bestScore >= 100) {
      pick = rng.pick(best);
    } else {
      // Nothing is immediately deductive: try a few candidates and keep the most productive one.
      const sample = rng.shuffle(best.slice()).slice(0, 10);
      let gain = -1;
      pick = sample[0];
      for (const cand of sample) {
        const trial = solver.clone();
        trial.addClue(cand);
        const g = solver.unknownCount - trial.unknownCount;
        if (g > gain) {
          gain = g;
          pick = cand;
        }
      }
    }
    clued[pick] = 1;
    solver.addClue(pick);
  }

  // Anything still unknown is handed to the solver as a given cell.
  const givens: number[] = [];
  for (let i = 0; i < n; i++) if (solver.state[i] === UNKNOWN) givens.push(i);

  // Pruning: drop clues that are not needed, within a time budget.
  const budget = opts.pruneBudgetMs ?? 250;
  const start = now();
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => i).filter((i) => clued[i]));
  for (const c of order) {
    if (now() - start > budget) break;
    clued[c] = 0;
    if (!solvable(w, h, counts, nb, pairRule, clued, givens, solution)) clued[c] = 1;
  }

  const clues = new Array<number>(n);
  for (let i = 0; i < n; i++) clues[i] = clued[i] ? counts[i] : -1;
  return { kind: 'fillapix', width: w, height: h, clues, solution, givens };
}

function solvable(
  w: number,
  h: number,
  counts: number[],
  nb: number[][],
  pairRule: boolean,
  clued: Uint8Array,
  givens: number[],
  solution: number[],
): boolean {
  const s = new FillAPixSolver(w, h, counts, nb, pairRule);
  for (const g of givens) s.setCell(g, solution[g] ? FILLED : EMPTY);
  for (let i = 0; i < clued.length; i++) if (clued[i]) s.hasClue[i] = 1;
  for (let i = 0; i < clued.length; i++) if (clued[i]) s.addClue(i);
  return s.solved();
}

/** Solve a puzzle from its printed clues; returns the filled cells or null if logic gets stuck. */
export function solveFillAPix(p: FillAPixPuzzle, pairRule = true): number[] | null {
  const nb = neighbourhoods(p.width, p.height);
  const counts = p.clues.map((c) => (c < 0 ? 0 : c));
  const s = new FillAPixSolver(p.width, p.height, counts, nb, pairRule);
  for (const g of p.givens) s.setCell(g, p.solution[g] ? FILLED : EMPTY);
  for (let i = 0; i < p.clues.length; i++) if (p.clues[i] >= 0) s.hasClue[i] = 1;
  for (let i = 0; i < p.clues.length; i++) if (p.clues[i] >= 0) s.addClue(i);
  if (!s.solved()) return null;
  return Array.from(s.state, (v) => (v === FILLED ? 1 : 0));
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
