import type { LogipixPath, LogipixPuzzle, PixelGrid } from '../../types';
import { createRng } from '../rng';

export interface LogipixOptions {
  maxLen: number;
  color: boolean;
  seed: number;
}

/**
 * Logipix: every pair of equal numbers is joined by a straight-or-bent path
 * of exactly that many cells; a 1 is a lone cell. The shaded paths form the picture.
 * We partition the inked cells into simple paths and label both ends with the length.
 */
export function generateLogipix(grid: PixelGrid, opts: LogipixOptions): LogipixPuzzle {
  const { width: w, height: h, cells } = grid;
  const n = w * h;
  const maxLen = Math.max(1, Math.min(12, Math.round(opts.maxLen)));
  const rng = createRng(opts.seed ^ 0x10617);
  const active = (i: number) => (grid.blank ? cells[i] !== 0 : true);
  const assigned = new Int32Array(n).fill(-1);

  const neighbours = (i: number): number[] => {
    const x = i % w;
    const y = Math.floor(i / w);
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y > 0) out.push(i - w);
    if (y < h - 1) out.push(i + w);
    return out.filter((j) => active(j) && cells[j] === cells[i]);
  };
  const freeDegree = (i: number) => neighbours(i).filter((j) => assigned[j] < 0).length;

  const order = Array.from({ length: n }, (_, i) => i)
    .filter(active)
    .map((i) => ({ i, d: freeDegree(i), r: rng.next() }))
    .sort((a, b) => a.d - b.d || a.r - b.r)
    .map((o) => o.i);

  const paths: number[][] = [];
  for (const startCell of order) {
    if (assigned[startCell] >= 0) continue;
    const target = 2 + rng.int(maxLen - 1);
    const path = [startCell];
    assigned[startCell] = paths.length;
    let cur = startCell;
    while (path.length < target) {
      const options = neighbours(cur).filter((j) => assigned[j] < 0);
      if (options.length === 0) break;
      // Warnsdorff's rule: move to the neighbour with the fewest onward options.
      let best: number[] = [];
      let bestD = Infinity;
      for (const j of options) {
        const d = freeDegree(j);
        if (d < bestD) {
          bestD = d;
          best = [j];
        } else if (d === bestD) best.push(j);
      }
      cur = rng.pick(best);
      assigned[cur] = paths.length;
      path.push(cur);
    }
    paths.push(path);
  }

  // Merge lone cells into neighbouring path ends so the puzzle has fewer trivial 1s.
  const isAdjacent = (a: number, b: number) => {
    const ax = a % w;
    const ay = Math.floor(a / w);
    const bx = b % w;
    const by = Math.floor(b / w);
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let p = 0; p < paths.length; p++) {
      const single = paths[p];
      if (single.length !== 1) continue;
      const c = single[0];
      const candidates: { q: number; atEnd: boolean }[] = [];
      for (const j of neighbours(c)) {
        const q = assigned[j];
        if (q === p || q < 0) continue;
        const other = paths[q];
        if (other.length >= maxLen) continue;
        if (other[other.length - 1] === j && isAdjacent(j, c)) candidates.push({ q, atEnd: true });
        else if (other[0] === j && isAdjacent(j, c)) candidates.push({ q, atEnd: false });
      }
      if (candidates.length === 0) continue;
      // Prefer joining the shortest neighbouring path.
      candidates.sort((a, b) => paths[a.q].length - paths[b.q].length);
      const { q, atEnd } = candidates[0];
      if (atEnd) paths[q].push(c);
      else paths[q].unshift(c);
      assigned[c] = q;
      paths[p] = [];
    }
  }

  const result: LogipixPath[] = paths
    .filter((p) => p.length > 0)
    .map((p) => ({ cells: p, color: cells[p[0]] }));

  return { kind: 'logipix', width: w, height: h, color: opts.color, palette: grid.palette, paths: result };
}
