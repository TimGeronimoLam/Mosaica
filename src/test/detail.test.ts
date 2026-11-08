import { describe, expect, it } from 'vitest';
import type { MosaicSettings } from '../types';
import type { SourceRaster } from '../lib/image';
import { convexHull, fillPolygon, growMask } from '../lib/mask';
import { defaultSettings } from '../lib/modes';
import { pixelize } from '../lib/pixelize';
import { downsample, restoreContrast, sampleGrid } from '../lib/preprocess';

/** A raster from a function giving [r, g, b] (0..255) per pixel. */
function raster(w: number, h: number, f: (x: number, y: number) => [number, number, number]): SourceRaster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Grey samples (0..1) laid out W x H, as an rgb buffer. */
function grey(W: number, H: number, f: (x: number, y: number) => number): Float32Array {
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.fill(f(x, y), (y * W + x) * 3, (y * W + x) * 3 + 3);
  return rgb;
}

const settings = (patch: Partial<MosaicSettings> = {}): MosaicSettings => ({ ...defaultSettings('nonogram', 1), minRegion: 0, ...patch });

describe('restoreContrast (perceptual downscaling)', () => {
  it('leaves a flat area untouched', () => {
    const S = 4;
    const rgb = grey(5 * S, 5 * S, () => 0.6);
    const cells = downsample(rgb, 5 * S, 5 * S, S, 0);
    const before = cells.slice();
    restoreContrast(cells, rgb, 5 * S, 5 * S, S, 1);
    for (let i = 0; i < cells.length; i++) expect(cells[i]).toBeCloseTo(before[i], 5);
  });

  it('makes cells crossed by a thin dark line darker than their plain average', () => {
    const S = 4;
    const W = 7 * S;
    const H = 7 * S;
    // A one-sample-wide black line down the middle column of cells, on white.
    const rgb = grey(W, H, (x) => (x === 3 * S + 1 ? 0 : 1));
    const plain = downsample(rgb, W, H, S, 0);
    const cells = plain.slice();
    restoreContrast(cells, rgb, W, H, S, 1);
    const mid = (3 * 7 + 3) * 3;
    expect(plain[mid]).toBeCloseTo(0.75, 5);
    expect(cells[mid]).toBeLessThan(plain[mid] - 0.1);
    // The white cells beside it stay (nearly) white and in range.
    const side = (3 * 7 + 1) * 3;
    expect(cells[side]).toBeGreaterThan(0.95);
    expect(cells[side]).toBeLessThanOrEqual(1);
  });

  it('blends with the amount and goes all the way where a cell is marked as detail', () => {
    const S = 4;
    const W = 5 * S;
    const H = 5 * S;
    const rgb = grey(W, H, (x) => (x === 2 * S + 1 ? 0 : 1));
    const plain = downsample(rgb, W, H, S, 0);
    const full = plain.slice();
    restoreContrast(full, rgb, W, H, S, 1);
    const half = plain.slice();
    restoreContrast(half, rgb, W, H, S, 0.5);
    const mid = (2 * 5 + 2) * 3;
    expect(half[mid]).toBeCloseTo((plain[mid] + full[mid]) / 2, 5);
    const importance = new Float32Array(25);
    importance[2 * 5 + 2] = 1;
    const marked = plain.slice();
    restoreContrast(marked, rgb, W, H, S, 0, null, importance);
    expect(marked[mid]).toBeCloseTo(full[mid], 5);
    // Unmarked cells with amount 0 are untouched.
    expect(marked[(1 * 5 + 2) * 3]).toBeCloseTo(plain[(1 * 5 + 2) * 3], 5);
  });

  it('leaves removed cells alone', () => {
    const S = 2;
    const W = 4 * S;
    const H = 4 * S;
    const rgb = grey(W, H, (x, y) => ((x + y) % 2 ? 0.2 : 0.8));
    const cover = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) cover[y * W + x] = 1;
    const cells = downsample(rgb, W, H, S, 0, false, cover);
    const before = cells.slice();
    restoreContrast(cells, rgb, W, H, S, 1, cover);
    for (let y = 0; y < 4; y++) expect(cells[y * 4 * 3]).toBeCloseTo(before[y * 4 * 3], 6);
  });
});

describe('polygon fill, growing and hulls', () => {
  it('fills a rectangle exactly', () => {
    const data = new Uint8Array(10 * 10);
    fillPolygon(data, 10, 10, [
      [2, 2],
      [6, 2],
      [6, 5],
      [2, 5],
    ]);
    let n = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (data[y * 10 + x]) n++;
    expect(n).toBe(4 * 3);
    expect(data[2 * 10 + 2]).toBe(1);
    expect(data[4 * 10 + 5]).toBe(1);
    expect(data[5 * 10 + 2]).toBe(0);
    expect(data[2 * 10 + 6]).toBe(0);
  });

  it('grows a pixel into a disc', () => {
    const data = new Uint8Array(9 * 9);
    data[4 * 9 + 4] = 1;
    const grown = growMask(data, 9, 9, 2);
    expect(grown[4 * 9 + 2]).toBe(1);
    expect(grown[2 * 9 + 4]).toBe(1);
    expect(grown[2 * 9 + 2]).toBe(0);
    expect(grown[4 * 9 + 1]).toBe(0);
    let n = 0;
    for (const v of grown) n += v;
    expect(n).toBe(13);
  });

  it('finds the convex hull of a point cloud', () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
      [1, 3],
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(expect.arrayContaining([[0, 0], [4, 0], [4, 4], [0, 4]]));
  });
});

describe('detail mask in the pipeline', () => {
  // A 40x40 light-grey photo with a single black 2x2 dot: at 10x10 cells the dot is a quarter of one cell,
  // so the plain average (0.59) lands above the 50% ink threshold and the dot is lost.
  const src = raster(40, 40, (x, y) => (x >= 17 && x < 19 && y >= 17 && y < 19 ? [0, 0, 0] : [200, 200, 200]));
  const dotCell = 4 * 10 + 4;

  it('keeps a tiny dark feature that averaging and the threshold would lose', () => {
    const s = settings({ gridWidth: 10, gridHeight: 10, lockAspect: false, threshold: 50, cellColor: 'average' });
    const plain = pixelize(src, s, 'binary');
    expect(plain.cells[dotCell]).toBe(0);
    const detail = new Uint8Array(40 * 40);
    for (let y = 16; y < 20; y++) for (let x = 16; x < 20; x++) detail[y * 40 + x] = 1;
    const sampled = sampleGrid(src, 10, 10, s, null, detail);
    expect(sampled.detail?.[dotCell]).toBe(1);
    expect(sampled.rgb[dotCell * 3]).toBeLessThan(0.5);
  });

  it('protects marked cells from merging into their neighbours', () => {
    const s = settings({ gridWidth: 10, gridHeight: 10, lockAspect: false, threshold: 50, minRegion: 4, cellColor: 'average' });
    const detail = new Uint8Array(40 * 40);
    for (let y = 16; y < 20; y++) for (let x = 16; x < 20; x++) detail[y * 40 + x] = 1;
    const grid = pixelize((w, h) => sampleGrid(src, w, h, s, null, detail), s, 'binary');
    expect(grid.cells[dotCell]).toBe(1);
    expect(grid.cells.filter((c) => c === 1)).toHaveLength(1);
  });
});
