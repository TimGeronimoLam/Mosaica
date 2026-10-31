import { describe, expect, it } from 'vitest';
import type { MosaicSettings } from '../types';
import {
  cropRect,
  currentBox,
  dragHandle,
  flipBox,
  largestBox,
  moveBox,
  reconcile,
  rotateBox,
  scaleBox,
  spanBox,
  withRatio,
  boxAspect,
  type CropBox,
} from '../lib/crop';
import { oklabToSrgb, srgbToOklab } from '../lib/color';
import { mergeSmallRegions, otsuThreshold } from '../lib/regions';
import { downsample, sampleCells } from '../lib/preprocess';
import { kmeans, kmeansBest, orderedAssign } from '../lib/quantize';
import { createRng } from '../lib/rng';
import { samplesPerCell } from '../lib/sampler';
import { pixelize } from '../lib/pixelize';
import { defaultSettings, loadSettings } from '../lib/modes';

const near = (a: CropBox, b: CropBox, eps = 1e-9) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(eps);
};
const inside = (c: CropBox) => {
  expect(c.x).toBeGreaterThanOrEqual(-1e-12);
  expect(c.y).toBeGreaterThanOrEqual(-1e-12);
  expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-12);
  expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-12);
};

describe('free crop', () => {
  const A = 1.5; // a 3:2 photo

  it('reshapes to a ratio around the same centre and stays on the photo', () => {
    const c = withRatio({ x: 0.2, y: 0.2, w: 0.4, h: 0.5 }, 1, A);
    expect(boxAspect(c, A)).toBeCloseTo(1);
    expect(c.x + c.w / 2).toBeCloseTo(0.4);
    expect(c.y + c.h / 2).toBeCloseTo(0.45);
    inside(c);
    // The largest square of a 3:2 photo is its full height.
    const sq = largestBox(1, A);
    expect(sq.h).toBeCloseTo(1);
    expect(sq.w).toBeCloseTo(1 / A);
    inside(withRatio({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 16 / 9, A));
  });

  it('draws a crop between two points, holding a ratio when asked', () => {
    const free = spanBox(0.1, 0.1, 0.5, 0.3, A, null);
    near(free, { x: 0.1, y: 0.1, w: 0.4, h: 0.2 });
    // Dragging up and left of the anchor works too.
    const back = spanBox(0.5, 0.5, 0.2, 0.3, A, null);
    near(back, { x: 0.2, y: 0.3, w: 0.3, h: 0.2 });
    const square = spanBox(0.1, 0.1, 0.5, 0.3, A, 1);
    expect(boxAspect(square, A)).toBeCloseTo(1);
    // Past the photo edge it shrinks to fit, keeping the ratio.
    const clipped = spanBox(0.8, 0.5, 2, 2, A, 1);
    inside(clipped);
    expect(boxAspect(clipped, A)).toBeCloseTo(1);
  });

  it('resizes from edges and corners', () => {
    const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    near(dragHandle(start, 'e', 0.9, 0.5, A, null), { x: 0.2, y: 0.2, w: 0.7, h: 0.4 });
    near(dragHandle(start, 'n', 0.5, 0.1, A, null), { x: 0.2, y: 0.1, w: 0.4, h: 0.5 });
    // A corner keeps the opposite corner where it was.
    const c = dragHandle(start, 'nw', 0.1, 0.1, A, null);
    expect(c.x + c.w).toBeCloseTo(0.6);
    expect(c.y + c.h).toBeCloseTo(0.6);
    // A fixed-ratio edge drag stays centred along that edge.
    const e = dragHandle(start, 'e', 0.7, 0.5, A, 1);
    expect(boxAspect(e, A)).toBeCloseTo(1);
    expect(e.y + e.h / 2).toBeCloseTo(0.4);
  });

  it('moves and scales within the photo', () => {
    near(moveBox({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.5, -1), { x: 0.6, y: 0, w: 0.4, h: 0.4 });
    const big = scaleBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 10, A);
    inside(big);
    expect(big.w / big.h).toBeCloseTo(1);
    const tiny = scaleBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.0001, A);
    expect(tiny.w).toBeGreaterThan(0);
  });

  it('follows the photo when it is turned or mirrored', () => {
    const c = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    let r = c;
    for (let i = 0; i < 4; i++) r = rotateBox(r, 1);
    near(r, c);
    near(rotateBox(rotateBox(c, 1), -1), c);
    near(flipBox(flipBox(c, 'h'), 'h'), c);
    near(rotateBox(c, 1), { x: 0.4, y: 0.1, w: 0.4, h: 0.3 });
  });

  it('keeps grid and crop the same shape', () => {
    const base = { gridWidth: 30, gridHeight: 30, lockAspect: true, zoom: 1, cx: 0.5, cy: 0.5 };
    // Height follows a portrait crop on a 3:2 photo: crop px aspect = 0.2 * 1.5 / 0.6 = 0.5.
    expect(reconcile({ ...base, crop: { x: 0, y: 0, w: 0.2, h: 0.6 } }, A).gridHeight).toBe(60);
    // Without a crop box (older mosaics), the height follows the photo.
    expect(reconcile(base, A).gridHeight).toBe(20);
    // A hand-set grid reshapes the crop instead.
    const fixed = reconcile({ ...base, lockAspect: false, gridHeight: 15, crop: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } }, A);
    expect(boxAspect(fixed.crop!, A)).toBeCloseTo(2);
  });

  it('describes the older zoom and pan framing as the same crop', () => {
    const photo = { width: 1000, height: 700 };
    for (const s of [
      { zoom: 1, cx: 0.5, cy: 0.5 },
      { zoom: 2.4, cx: 0.2, cy: 0.9 },
      { zoom: 1.3, cx: 0.7, cy: 0.35 },
    ]) {
      const legacy = cropRect(photo, 40, 28, s);
      const asBox = cropRect(photo, 40, 28, { ...s, crop: currentBox(photo, 40, 28, s) });
      for (const k of ['x', 'y', 'w', 'h'] as const) expect(asBox[k]).toBeCloseTo(legacy[k], 6);
    }
  });
});

describe('OKLab', () => {
  it('round-trips and has the reference anchors', () => {
    expect(srgbToOklab(1, 1, 1)[0]).toBeCloseTo(1, 3);
    expect(srgbToOklab(1, 1, 1)[1]).toBeCloseTo(0, 3);
    expect(srgbToOklab(0, 0, 0)[0]).toBeCloseTo(0, 6);
    for (const c of [
      [0.9, 0.4, 0.1],
      [0.1, 0.5, 0.8],
      [0.33, 0.33, 0.33],
    ] as const) {
      const [L, a, b] = srgbToOklab(c[0], c[1], c[2]);
      const back = oklabToSrgb(L, a, b);
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 4));
    }
  });

  it('k-means counts distinct OKLab colours with negative a/b correctly', () => {
    const blue = srgbToOklab(0.1, 0.2, 0.9);
    const green = srgbToOklab(0.1, 0.8, 0.2);
    const pts = new Float32Array(60);
    for (let i = 0; i < 20; i++) pts.set(i < 10 ? blue : green, i * 3);
    const { centers } = kmeans(pts, 5, createRng(1), 20, (c) => c[0]);
    expect(centers.length).toBe(2);
    expect(centers[0][0]).toBeGreaterThan(centers[1][0]);
  });
});

describe('palette search', () => {
  it('keeps the best of several k-means starts', () => {
    const rng = createRng(5);
    const pts = new Float32Array(600 * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = rng.next();
    const err = (r: { centers: number[][]; labels: number[] }) => r.labels.reduce((a, l, i) => a + (pts[i * 3] - r.centers[l][0]) ** 2 + (pts[i * 3 + 1] - r.centers[l][1]) ** 2 + (pts[i * 3 + 2] - r.centers[l][2]) ** 2, 0);
    const one = kmeans(pts, 6, createRng(9), 20, (c) => c[0]);
    const best = kmeansBest(pts, 6, createRng(9), 6, (c) => c[0]);
    expect(err(best)).toBeLessThanOrEqual(err(one) + 1e-9);
  });
});

describe('cell sampling', () => {
  // A 4x4 block: 10 dark samples and 6 light ones.
  const block = () => {
    const rgb = new Float32Array(16 * 3).fill(0.95);
    for (let i = 0; i < 10; i++) rgb.fill(0.1, i * 3, i * 3 + 3);
    return rgb;
  };

  it('main colour takes the larger side of an edge instead of a blend', () => {
    expect(downsample(block(), 4, 4, 4, 0, false)[0]).toBeCloseTo(0.1 * (10 / 16) + 0.95 * (6 / 16));
    expect(downsample(block(), 4, 4, 4, 0, true)[0]).toBeCloseTo(0.1);
  });

  it('main colour still averages a cell that is all one colour with a little texture', () => {
    const rgb = new Float32Array(16 * 3);
    for (let i = 0; i < 16; i++) rgb.fill(0.5 + (i % 2 ? 0.01 : -0.01), i * 3, i * 3 + 3);
    expect(downsample(rgb, 4, 4, 4, 0, true)[0]).toBeCloseTo(0.5);
  });

  it('ignores removed samples when choosing a kept cell’s colour', () => {
    const rgb = block();
    const cover = new Float32Array(16);
    for (let i = 0; i < 6; i++) cover[i] = 1; // part of the dark side is background
    expect(downsample(rgb, 4, 4, 4, 0, false, cover)[0]).toBeCloseTo((0.1 * 4 + 0.95 * 6) / 10);
  });

  it('sampleCells reads a crop rendered at S samples per cell', () => {
    const S = 3;
    const data = new Uint8ClampedArray(2 * S * S * 4).fill(255);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) data.fill(0, (y * 2 * S + x) * 4, (y * 2 * S + x) * 4 + 3);
    const { rgb } = sampleCells({ width: 2 * S, height: S, data }, 2, 1, S, { ...defaultSettings('nonogram', 1), cellColor: 'average' });
    expect(rgb[0]).toBeCloseTo(0);
    expect(rgb[3]).toBeCloseTo(1);
  });

  it('uses as many samples as the photo has, within a budget', () => {
    expect(samplesPerCell(300, 300, 30, 30, 1)).toBe(6);
    expect(samplesPerCell(300, 300, 30, 30, 0.2)).toBe(2);
    expect(samplesPerCell(60, 60, 30, 30, 1)).toBe(2);
    expect(samplesPerCell(10, 10, 30, 30, 1)).toBe(1);
    expect(samplesPerCell(4000, 4000, 120, 180, 1)).toBe(3);
  });
});

describe('clean-up after quantising', () => {
  it('merges small islands into the area around them', () => {
    const cells = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(mergeSmallRegions(cells, 4, 4, 2)[6]).toBe(0);
    // Big enough areas stay.
    const pair = [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0];
    expect(mergeSmallRegions(pair, 4, 3, 2)).toEqual(pair);
    expect(mergeSmallRegions(pair, 4, 3, 3)[5]).toBe(0);
    // Locked (removed) cells never change.
    const locked = new Uint8Array(16);
    locked[6] = 1;
    expect(mergeSmallRegions(cells, 4, 4, 2, null, locked)[6]).toBe(1);
  });

  it('prefers the more similar neighbour colour', () => {
    // A single red-ish cell between a red area (2 sides) and a black area (2 sides).
    const cells = [0, 0, 2, 2, 0, 1, 2, 2, 0, 0, 2, 2];
    const colors = [srgbToOklab(0.8, 0.1, 0.1), srgbToOklab(0.7, 0.15, 0.1), srgbToOklab(0, 0, 0)];
    expect(mergeSmallRegions(cells, 4, 3, 2, colors)[5]).toBe(0);
  });

  it('finds a threshold between two groups of lightness', () => {
    const values = [...Array(50).fill(0.2), ...Array(50).fill(0.7)];
    const t = otsuThreshold(values);
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThanOrEqual(0.7);
  });

  it('pattern dithering mixes colours on a mid tone and leaves flat areas alone', () => {
    const palette: [number, number, number][] = [
      [1, 0, 0],
      [0, 0, 0],
    ];
    const grey = new Float32Array(16 * 3);
    for (let i = 0; i < 16; i++) grey[i * 3] = 0.5;
    const mixed = orderedAssign(grey, 4, 4, palette, null, 1);
    expect(new Set(mixed).size).toBe(2);
    const off = orderedAssign(grey, 4, 4, palette, null, 0);
    expect(new Set(off).size).toBe(1);
  });
});

describe('converter 2 palettes', () => {
  /** Grey wall, peach face and dark hair, like a portrait. */
  const portrait = () => {
    const w = 30;
    const h = 30;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const face = (x - 15) ** 2 + (y - 17) ** 2 < 64;
        const hair = !face && (x - 15) ** 2 + (y - 13) ** 2 < 100;
        const c = face ? [225, 175, 145] : hair ? [70, 50, 35] : [200, 198, 195];
        data.set([...c, 255], o);
      }
    }
    return { width: w, height: h, data };
  };

  it('keeps a skin tone apart from a grey wall', () => {
    const s: MosaicSettings = { ...defaultSettings('colorByCode', 3), gridWidth: 30, gridHeight: 30, colors: 3, blankLightest: false, minRegion: 0 };
    const g = pixelize(portrait(), s, 'palette');
    const hasSkin = g.palette.some((hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return r - b > 50 && r > 180;
    });
    expect(hasSkin).toBe(true);
  });

  it('older mosaics load with the original converter', () => {
    const saved = { ...defaultSettings('colorByCode', 1) } as Partial<MosaicSettings>;
    for (const key of ['converter', 'cellColor', 'minRegion', 'ditherStyle', 'ditherAmount', 'cropRatio'] as const) delete saved[key];
    const s = loadSettings('colorByCode', saved as MosaicSettings);
    expect([s.converter, s.cellColor, s.minRegion, s.ditherStyle, s.ditherAmount]).toEqual([1, 'average', 0, 'diffusion', 100]);
    expect(loadSettings('colorByCode', defaultSettings('colorByCode', 1)).converter).toBe(2);
  });
});
