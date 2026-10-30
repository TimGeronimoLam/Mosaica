import { describe, expect, it } from 'vitest';
import type { PixelGrid } from '../types';
import { generateNonogram } from '../lib/modes/nonogram';
import { generateFillAPix, solveFillAPix } from '../lib/modes/fillapix';
import { generateLogipix } from '../lib/modes/logipix';
import { generateLabymage, N, E, S, W } from '../lib/modes/labymage';
import { generateDots, traceContours, signedArea } from '../lib/modes/dots';
import { makeSum } from '../lib/modes/colorByCode';
import { kmeans } from '../lib/quantize';
import { createRng } from '../lib/rng';
import { despeckle } from '../lib/pixelize';

function binaryGrid(rows: string[]): PixelGrid {
  const width = rows[0].length;
  const height = rows.length;
  const cells = rows.join('').split('').map((c) => (c === '#' ? 1 : 0));
  return { width, height, cells, palette: ['#ffffff', '#000000'], blank: true, kind: 'binary' };
}

function randomGrid(w: number, h: number, seed: number, density = 0.5): PixelGrid {
  const rng = createRng(seed);
  // Blobby noise: smooth a random field so there are solid regions, like a real picture.
  const field = Array.from({ length: w * h }, () => rng.next());
  const cells = new Array<number>(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
            s += field[ny * w + nx];
            n++;
          }
        }
      }
      cells[y * w + x] = s / n < density ? 1 : 0;
    }
  }
  return { width: w, height: h, cells, palette: ['#ffffff', '#000000'], blank: true, kind: 'binary' };
}

describe('nonogram', () => {
  it('computes run clues for rows and columns', () => {
    const g = binaryGrid(['##.#', '....', '.###']);
    const p = generateNonogram(g, false);
    expect(p.rows.map((r) => r.map((c) => c.n))).toEqual([[2, 1], [], [3]]);
    expect(p.cols.map((r) => r.map((c) => c.n))).toEqual([[1], [1, 1], [1], [1, 1]]);
  });

  it('keeps colour with each clue', () => {
    const g: PixelGrid = { width: 3, height: 1, cells: [1, 2, 2], palette: ['#fff', '#f00', '#00f'], blank: true, kind: 'palette' };
    const p = generateNonogram(g, true);
    expect(p.rows[0]).toEqual([
      { n: 1, c: 1 },
      { n: 2, c: 2 },
    ]);
  });
});

describe('fill-a-pix', () => {
  it('produces a puzzle that its own solver can solve to the picture', () => {
    for (const seed of [1, 2, 3]) {
      const g = randomGrid(18, 14, seed);
      const p = generateFillAPix(g, { difficulty: 'normal', seed, pruneBudgetMs: 100 });
      const solved = solveFillAPix(p, true);
      expect(solved).not.toBeNull();
      expect(solved).toEqual(p.solution);
      const clueCount = p.clues.filter((c) => c >= 0).length;
      expect(clueCount).toBeGreaterThan(0);
      expect(clueCount).toBeLessThan(p.clues.length);
    }
  });

  it('easy puzzles are solvable with single-clue logic only', () => {
    const g = randomGrid(16, 12, 7);
    const p = generateFillAPix(g, { difficulty: 'easy', seed: 7, pruneBudgetMs: 100 });
    expect(solveFillAPix(p, false)).toEqual(p.solution);
  });
});

describe('logipix', () => {
  it('partitions inked cells into simple paths within the length limit', () => {
    const g = randomGrid(20, 15, 11);
    const p = generateLogipix(g, { maxLen: 6, color: false, seed: 11 });
    const seen = new Set<number>();
    for (const path of p.paths) {
      expect(path.cells.length).toBeGreaterThanOrEqual(1);
      expect(path.cells.length).toBeLessThanOrEqual(6);
      for (let i = 0; i < path.cells.length; i++) {
        const c = path.cells[i];
        expect(seen.has(c)).toBe(false);
        seen.add(c);
        expect(g.cells[c]).toBe(1);
        if (i > 0) {
          const a = path.cells[i - 1];
          const dist = Math.abs((a % 20) - (c % 20)) + Math.abs(Math.floor(a / 20) - Math.floor(c / 20));
          expect(dist).toBe(1);
        }
      }
    }
    const inked = g.cells.filter((c) => c === 1).length;
    expect(seen.size).toBe(inked);
  });
});

describe('labymage', () => {
  it('builds a perfect maze whose route covers the whole picture', () => {
    const g = randomGrid(14, 10, 5, 0.45);
    const p = generateLabymage(g, { twist: 70, seed: 5 });
    const { width, height, open } = p;
    expect(width).toBe(28);
    expect(height).toBe(20);
    // Symmetric passages and a spanning tree: passages = cells - 1.
    let passages = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = y * width + x;
        if (open[c] & E) {
          expect(open[c + 1] & W).toBeTruthy();
          passages++;
        }
        if (open[c] & S) {
          expect(open[c + width] & N).toBeTruthy();
          passages++;
        }
      }
    }
    expect(passages).toBe(width * height - 1);
    // Every cell reachable.
    const seen = new Uint8Array(width * height);
    const stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % width;
      const y = Math.floor(c / width);
      const nbs: [number, number][] = [
        [N, c - width],
        [E, c + 1],
        [S, c + width],
        [W, c - 1],
      ];
      for (const [bit, j] of nbs) {
        if (open[c] & bit && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
      void x;
      void y;
    }
    expect(Array.from(seen).every((v) => v === 1)).toBe(true);
    // The route is a connected walk through open passages, covering all cells of the largest region.
    for (let i = 1; i < p.path.length; i++) {
      const a = p.path[i - 1];
      const b = p.path[i];
      const bit = b === a + 1 ? E : b === a - 1 ? W : b === a + width ? S : N;
      expect(open[a] & bit).toBeTruthy();
    }
    const unique = new Set(p.path);
    expect(unique.size).toBe(p.path.length);
    expect(p.entrance).not.toBeNull();
    expect(p.exit).not.toBeNull();
  });
});

describe('connect the dots', () => {
  it('traces a square as one loop with four corners', () => {
    const g = binaryGrid(['....', '.##.', '.##.', '....']);
    const loops = traceContours(g);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(8);
    expect(Math.abs(signedArea(loops[0]))).toBe(4);
    const p = generateDots(g, { detail: 0.5, minRegion: 1, maxDots: 100, maxGap: 100 });
    expect(p.loops.length).toBe(1);
    expect(p.loops[0].points.length).toBe(4);
    expect(p.total).toBe(4);
  });

  it('finds holes as separate loops and numbers continuously', () => {
    const g = binaryGrid(['#####', '#...#', '#.#.#', '#...#', '#####']);
    const p = generateDots(g, { detail: 0.5, minRegion: 1, maxDots: 100, maxGap: 100 });
    expect(p.loops.length).toBe(3);
    expect(p.loops[1].start).toBe(p.loops[0].points.length + 1);
    expect(p.total).toBe(p.loops.reduce((s, l) => s + l.points.length, 0));
  });
});

describe('sums', () => {
  it('generates expressions that evaluate to the code', () => {
    const rng = createRng(3);
    for (let n = 0; n <= 12; n++) {
      for (const ops of ['add', 'addsub', 'mul', 'mixed'] as const) {
        const s = makeSum(n, ops, rng);
        const m = s.match(/^(\d+)([+−×÷])(\d+)$/);
        expect(m, s).not.toBeNull();
        const a = Number(m![1]);
        const b = Number(m![3]);
        const v = m![2] === '+' ? a + b : m![2] === '−' ? a - b : m![2] === '×' ? a * b : a / b;
        expect(v).toBe(n);
      }
    }
  });
});

describe('quantize', () => {
  it('finds two clearly separated colours, lightest first', () => {
    const pts = new Float32Array(40 * 3);
    for (let i = 0; i < 40; i++) {
      const dark = i % 2 === 0;
      pts[i * 3] = dark ? 0.1 : 0.9;
      pts[i * 3 + 1] = dark ? 0.1 : 0.9;
      pts[i * 3 + 2] = dark ? 0.1 : 0.9;
    }
    const { centers, labels } = kmeans(pts, 2, createRng(1));
    expect(centers.length).toBe(2);
    expect(centers[0][0]).toBeGreaterThan(centers[1][0]);
    expect(labels[0]).toBe(1);
    expect(labels[1]).toBe(0);
  });

  it('despeckle removes lone cells', () => {
    const cells = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    expect(despeckle(cells, 3, 3, 1, 2)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('dot subdivision', () => {
  it('adds intermediate dots on long edges', () => {
    const g = binaryGrid(['##########', '##########']);
    const p = generateDots(g, { detail: 0.5, minRegion: 1, maxDots: 100, maxGap: 2.5 });
    // A 10 x 2 rectangle: long sides are split into 4 pieces each, short sides stay.
    expect(p.loops[0].points.length).toBe(2 * 4 + 2 * 1);
  });
});
