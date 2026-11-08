import type { Clue, NonogramPuzzle } from '../../types';

/**
 * Checks whether a nonogram's clues pin down the picture.
 *
 * - `unique`: line logic alone reaches the picture; a solver never has to guess.
 * - `guess`: one solution, but it needs trial and error at some point.
 * - `ambiguous`: at least two pictures fit the clues.
 * - `unknown`: the time budget ran out before the search finished.
 *
 * `unknown` lists the cells line logic could not settle; `ambiguous` lists the
 * cells where two solutions disagree (so the user knows where to touch up).
 */
export interface NonogramAnalysis {
  status: 'unique' | 'guess' | 'ambiguous' | 'unknown';
  unknown: number[];
  ambiguous: number[];
}

const UNKNOWN = -1;
const BLANK = 0;

/**
 * Narrows one line: for every cell, which values (blank or a colour) appear
 * in at least one placement of the clues that agrees with the known cells.
 * Returns null when no placement fits.
 */
function solveLine(clues: Clue[], known: number[], out: number[]): boolean {
  const n = known.length;
  const m = clues.length;
  const blank = (i: number) => known[i] === UNKNOWN || known[i] === BLANK;
  const fill = (i: number, c: number) => known[i] === UNKNOWN || known[i] === c;

  // F[k][i]: clues 0..k-1 placed in cells 0..i-1 (cells after the last run are blank).
  const F: Uint8Array[] = [];
  for (let k = 0; k <= m; k++) F.push(new Uint8Array(n + 1));
  F[0][0] = 1;
  for (let i = 1; i <= n; i++) F[0][i] = F[0][i - 1] && blank(i - 1) ? 1 : 0;

  const prefixOk = (k: number, s: number): boolean => {
    // Can clues 0..k-1 sit before a run of clue k starting at s?
    if (k === 0) return F[0][s] === 1;
    if (clues[k - 1].c === clues[k].c) return s >= 1 && blank(s - 1) && F[k][s - 1] === 1;
    return F[k][s] === 1;
  };

  for (let k = 0; k < m; k++) {
    const L = clues[k].n;
    const c = clues[k].c;
    let runOk = 0; // how many cells ending at i-1 can be colour c
    for (let i = 1; i <= n; i++) {
      runOk = fill(i - 1, c) ? runOk + 1 : 0;
      let v = F[k + 1][i - 1] && blank(i - 1) ? 1 : 0;
      if (!v && runOk >= L && prefixOk(k, i - L)) v = 1;
      F[k + 1][i] = v;
    }
  }

  // B[k][i]: clues k..m-1 placed in cells i..n-1.
  const B: Uint8Array[] = [];
  for (let k = 0; k <= m; k++) B.push(new Uint8Array(n + 2));
  B[m][n] = 1;
  for (let i = n - 1; i >= 0; i--) B[m][i] = B[m][i + 1] && blank(i) ? 1 : 0;

  const suffixOk = (k: number, e: number): boolean => {
    // Can clues k+1..m-1 sit after a run of clue k ending at e (exclusive)?
    if (k === m - 1) return B[m][e] === 1;
    if (clues[k + 1].c === clues[k].c) return e < n && blank(e) && B[k + 1][e + 1] === 1;
    return B[k + 1][e] === 1;
  };

  for (let k = m - 1; k >= 0; k--) {
    const L = clues[k].n;
    const c = clues[k].c;
    let runOk = 0; // how many cells starting at i can be colour c
    for (let i = n - 1; i >= 0; i--) {
      runOk = fill(i, c) ? runOk + 1 : 0;
      let v = B[k][i + 1] && blank(i) ? 1 : 0;
      if (!v && runOk >= L && suffixOk(k, i + L)) v = 1;
      B[k][i] = v;
    }
  }

  if (!B[0][0]) return false;

  // Mark which values each cell can take. Bit 0 = blank, bit c = colour c.
  const can = new Uint32Array(n);
  for (let k = 0; k <= m; k++) {
    for (let i = 0; i < n; i++) {
      if (F[k][i] && blank(i) && B[k][i + 1]) can[i] |= 1;
    }
  }
  const diff = new Int32Array(n + 1);
  for (let k = 0; k < m; k++) {
    const L = clues[k].n;
    const c = clues[k].c;
    diff.fill(0);
    let runOk = 0;
    for (let i = n - 1; i >= 0; i--) {
      runOk = fill(i, c) ? runOk + 1 : 0;
      if (runOk >= L && prefixOk(k, i) && suffixOk(k, i + L)) {
        diff[i]++;
        diff[i + L]--;
      }
    }
    let open = 0;
    for (let i = 0; i < n; i++) {
      open += diff[i];
      if (open > 0) can[i] |= 1 << c;
    }
  }

  for (let i = 0; i < n; i++) {
    const bits = can[i];
    if (bits === 0) return false;
    if ((bits & (bits - 1)) === 0) {
      out[i] = bits === 1 ? BLANK : 31 - Math.clz32(bits);
    } else {
      out[i] = known[i];
    }
  }
  return true;
}

interface Solver {
  width: number;
  height: number;
  rows: Clue[][];
  cols: Clue[][];
  colours: number;
}

/** Runs line logic to a fixed point. Returns false on a contradiction. */
function propagate(s: Solver, grid: Int8Array, dirtyRows: Uint8Array, dirtyCols: Uint8Array): boolean {
  const { width, height, rows, cols } = s;
  const rowLine = new Array<number>(width);
  const colLine = new Array<number>(height);
  const out = new Array<number>(Math.max(width, height));
  for (;;) {
    let any = false;
    for (let y = 0; y < height; y++) {
      if (!dirtyRows[y]) continue;
      dirtyRows[y] = 0;
      any = true;
      for (let x = 0; x < width; x++) rowLine[x] = grid[y * width + x];
      if (!solveLine(rows[y], rowLine, out)) return false;
      for (let x = 0; x < width; x++) {
        if (out[x] !== rowLine[x]) {
          grid[y * width + x] = out[x];
          dirtyCols[x] = 1;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      if (!dirtyCols[x]) continue;
      dirtyCols[x] = 0;
      any = true;
      for (let y = 0; y < height; y++) colLine[y] = grid[y * width + x];
      if (!solveLine(cols[x], colLine, out)) return false;
      for (let y = 0; y < height; y++) {
        if (out[y] !== colLine[y]) {
          grid[y * width + x] = out[y];
          dirtyRows[y] = 1;
        }
      }
    }
    if (!any) return true;
  }
}

export interface AnalyzeOptions {
  /** Stop searching after this long and report `unknown`. */
  budgetMs?: number;
}

export function analyzeNonogram(p: NonogramPuzzle, opts: AnalyzeOptions = {}): NonogramAnalysis {
  const budgetMs = opts.budgetMs ?? 400;
  const deadline = performance.now() + budgetMs;
  const s: Solver = { width: p.width, height: p.height, rows: p.rows, cols: p.cols, colours: p.palette.length };
  const size = p.width * p.height;

  const grid = new Int8Array(size).fill(UNKNOWN);
  if (!propagate(s, grid, new Uint8Array(p.height).fill(1), new Uint8Array(p.width).fill(1))) {
    // Clues came from a real picture, so this cannot happen; treat as unknown.
    return { status: 'unknown', unknown: [], ambiguous: [] };
  }
  const unknown: number[] = [];
  for (let i = 0; i < size; i++) if (grid[i] === UNKNOWN) unknown.push(i);
  if (unknown.length === 0) return { status: 'unique', unknown, ambiguous: [] };

  // Line logic stalled: search for up to two solutions.
  const found: Int8Array[] = [];
  let timedOut = false;
  const search = (g: Int8Array): void => {
    if (found.length >= 2 || timedOut) return;
    if (performance.now() > deadline) {
      timedOut = true;
      return;
    }
    // Branch on the unknown cell whose row has the fewest unknowns: cheap and keeps the tree shallow.
    let pick = -1;
    let best = Infinity;
    const rowUnknown = new Int32Array(p.height);
    for (let i = 0; i < size; i++) if (g[i] === UNKNOWN) rowUnknown[(i / p.width) | 0]++;
    for (let i = 0; i < size; i++) {
      if (g[i] !== UNKNOWN) continue;
      const u = rowUnknown[(i / p.width) | 0];
      if (u < best) {
        best = u;
        pick = i;
      }
    }
    if (pick < 0) {
      found.push(g);
      return;
    }
    const y = (pick / p.width) | 0;
    const x = pick % p.width;
    for (let v = 0; v < s.colours; v++) {
      const g2 = new Int8Array(g);
      g2[pick] = v;
      const dr = new Uint8Array(p.height);
      const dc = new Uint8Array(p.width);
      dr[y] = 1;
      dc[x] = 1;
      if (propagate(s, g2, dr, dc)) search(g2);
      if (found.length >= 2 || timedOut) return;
    }
  };
  search(grid);

  if (found.length >= 2) {
    const ambiguous: number[] = [];
    for (let i = 0; i < size; i++) if (found[0][i] !== found[1][i]) ambiguous.push(i);
    return { status: 'ambiguous', unknown, ambiguous };
  }
  if (timedOut) return { status: 'unknown', unknown, ambiguous: [] };
  return { status: 'guess', unknown, ambiguous: [] };
}
