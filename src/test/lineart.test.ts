import { describe, expect, it } from 'vitest';
import type { MosaicSettings } from '../types';
import type { SourceRaster } from '../lib/image';
import { inkFrom, INK_THRESHOLD, planesOf } from '../lib/ai/lineart';
import { decodeMask, encodeMask, transformMask, transformMaskMax, type PhotoMask } from '../lib/mask';
import { defaultSettings } from '../lib/modes';
import { pixelize } from '../lib/pixelize';
import { INK_FULL, inkOutlines, sampleCells, sampleGrid } from '../lib/preprocess';
import { scaling } from '../lib/transform';

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

/** A mask from a predicate. */
function mask(width: number, height: number, f: (x: number, y: number) => boolean): PhotoMask {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (f(x, y)) data[y * width + x] = 1;
  return { width, height, data };
}

const settings = (patch: Partial<MosaicSettings> = {}): MosaicSettings => ({ ...defaultSettings('nonogram', 1), minRegion: 0, ...patch });

describe('line-art model input and output', () => {
  it('lays the picture out as planar RGB on white, padded to the working size', () => {
    const src = raster(3, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0] : [0, 0, 0]));
    // A transparent pixel reads as white.
    src.data[(1 * 3 + 2) * 4 + 3] = 0;
    const planes = planesOf(src, 4, 4);
    const n = 16;
    expect(planes.length).toBe(n * 3);
    expect([planes[0], planes[n], planes[2 * n]]).toEqual([1, 0, 0]);
    expect([planes[1], planes[n + 1], planes[2 * n + 1]]).toEqual([0, 0, 0]);
    expect([planes[4 + 2], planes[n + 4 + 2], planes[2 * n + 4 + 2]]).toEqual([1, 1, 1]);
    // Padding is white.
    expect(planes[3]).toBe(1);
    expect(planes[n * 3 - 1]).toBe(1);
  });

  it('turns the drawing into an ink mask, cropping the padding', () => {
    const data = new Float32Array(16).fill(1);
    data[0] = 0.2; // dark: ink
    data[5] = 1 - INK_THRESHOLD + 0.02; // just under the threshold: paper
    data[6] = 1 - INK_THRESHOLD - 0.02; // just over: ink
    data[3] = 0; // in the padding column: dropped
    const ink = inkFrom({ width: 4, height: 4, data }, 3, 3);
    expect(Array.from(ink)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0]);
  });

  it('resamples a drawing of a different size', () => {
    const data = new Float32Array(4).fill(1);
    data[3] = 0;
    const ink = inkFrom({ width: 2, height: 2, data }, 4, 4);
    expect(Array.from(ink)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
  });
});

describe('mapping traced lines into the crop', () => {
  it('round-trips a thin line through the stored run-length form', () => {
    const m = mask(40, 30, (x, y) => y === 2 * Math.floor(x / 3) + 1);
    const back = decodeMask(encodeMask(m));
    expect(back.width).toBe(40);
    expect(back.height).toBe(30);
    expect(Array.from(back.data)).toEqual(Array.from(m.data));
  });

  it('keeps a one-pixel line that nearest sampling would skip', () => {
    // A vertical line one mask pixel wide, sampled at every fourth mask pixel.
    const m = mask(64, 64, (x) => x === 30);
    const toMask = scaling(4);
    const nearest = transformMask(m, toMask, 16, 16);
    const kept = transformMaskMax(m, toMask, 16, 16);
    // The nearest sample in each column sits at x = 4i + 2, so column 7 reads x = 30 and column 7 alone.
    expect(nearest.reduce((a, v) => a + v, 0)).toBe(16);
    // Max sampling marks the column the line runs through, and only that column.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(kept[y * 16 + x]).toBe(x === 7 ? 1 : 0);
    const m2 = mask(64, 64, (x) => x === 31);
    // At x = 31 nearest sampling finds nothing; max sampling still does.
    expect(transformMask(m2, toMask, 16, 16).reduce((a, v) => a + v, 0)).toBe(0);
    expect(transformMaskMax(m2, toMask, 16, 16).reduce((a, v) => a + v, 0)).toBe(16);
  });

  it('is plain nearest sampling when the output is as fine as the mask', () => {
    const m = mask(8, 8, (x, y) => (x + y) % 3 === 0);
    const toMask = scaling(0.5);
    expect(Array.from(transformMaskMax(m, toMask, 16, 16))).toEqual(Array.from(transformMask(m, toMask, 16, 16)));
  });
});

describe('darkening traced outlines', () => {
  it('darkens cells by coverage, saturating at a fifth of the cell, and leaves the rest alone', () => {
    const cells = new Float32Array(4 * 3).fill(0.8);
    const share = Float32Array.from([0, INK_FULL / 2, INK_FULL, 1]);
    inkOutlines(cells, share, 1);
    expect(cells[0]).toBeCloseTo(0.8, 6);
    expect(cells[3]).toBeCloseTo(0.4, 6);
    expect(cells[6]).toBeCloseTo(0, 6);
    expect(cells[9]).toBeCloseTo(0, 6);
    const half = new Float32Array(4 * 3).fill(0.8);
    inkOutlines(half, share, 0.5);
    expect(half[6]).toBeCloseTo(0.4, 6);
  });

  it('replaces the brightness-edge filter: a traced line through a flat area darkens those cells only', () => {
    const S = 4;
    const w = 5;
    const h = 5;
    const src = raster(w * S, h * S, () => [220, 220, 220]);
    // A line two samples wide down the middle column of cells.
    const ink = new Uint8Array(w * S * h * S);
    for (let y = 0; y < h * S; y++) for (const x of [2 * S + 1, 2 * S + 2]) ink[y * w * S + x] = 1;
    const plain = sampleCells(src, w, h, S, settings({ outlines: 100 }));
    const traced = sampleCells(src, w, h, S, settings({ outlines: 100 }), null, null, ink);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      // A flat photo has no brightness edges, so the old filter leaves every cell as it is.
      expect(plain.rgb[i * 3]).toBeCloseTo(220 / 255, 3);
      if (x === 2) expect(traced.rgb[i * 3]).toBeLessThan(0.05);
      else expect(traced.rgb[i * 3]).toBeCloseTo(220 / 255, 3);
    }
    // With the slider at zero the trace changes nothing.
    const off = sampleCells(src, w, h, S, settings({ outlines: 0 }), null, null, ink);
    for (let i = 0; i < w * h; i++) expect(off.rgb[i * 3]).toBeCloseTo(220 / 255, 3);
  });

  it('works through the older converter too, with the ink mask at photo size', () => {
    const w = 6;
    const h = 6;
    const src = raster(60, 60, () => [230, 230, 230]);
    const ink = new Uint8Array(60 * 60);
    // A horizontal line three pixels tall through the third row of cells.
    for (let y = 21; y < 24; y++) for (let x = 0; x < 60; x++) ink[y * 60 + x] = 1;
    const s = settings({ outlines: 80, converter: 1, zoom: 1, cx: 0.5, cy: 0.5 });
    const out = sampleGrid(src, w, h, s, null, null, ink);
    for (let i = 0; i < w * h; i++) {
      const y = Math.floor(i / w);
      if (y === 2) expect(out.rgb[i * 3]).toBeLessThan((230 / 255) * 0.25);
      else expect(out.rgb[i * 3]).toBeCloseTo(230 / 255, 3);
    }
  });

  it('fills the traced cells of a nonogram', () => {
    const S = 4;
    const w = 8;
    const h = 8;
    const src = raster(w * S, h * S, () => [235, 235, 235]);
    const ink = new Uint8Array(w * S * h * S);
    // An L shape: left column and bottom row of cells.
    for (let y = 0; y < h * S; y++) ink[y * w * S + 1] = 1;
    for (let x = 0; x < w * S; x++) ink[(h * S - 2) * w * S + x] = 1;
    const s = settings({ outlines: 100, threshold: 50, dither: false, gridWidth: w, gridHeight: h });
    const grid = pixelize((gw, gh) => sampleCells(src, gw, gh, S, s, null, null, ink), s, 'binary');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const filled = grid.cells[y * w + x] === 1;
        expect(filled).toBe(x === 0 || y === h - 1);
      }
    }
  });
});
