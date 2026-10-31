import { describe, expect, it } from 'vitest';
import type { MosaicSettings, PixelGrid } from '../types';
import { apply, flipView, invert, multiply, rotateView, scaleOf, straightenZoom, transformFor, type PhotoTransform } from '../lib/transform';
import { combineMask, decodeMask, emptyMask, encodeMask, invertMask, paintSegment, selectBackground, selectSimilar, transformMask } from '../lib/mask';
import { downsample, evenLighting, kuwahara, sampleGrid } from '../lib/preprocess';
import { applyEdits, floodCells, remapEdits, resolveToken, setCells, tokenForValue } from '../lib/edits';
import { initHistory, pushHistory, redoHistory, undoHistory } from '../lib/history';
import { pixelize } from '../lib/pixelize';
import { defaultSettings } from '../lib/modes';
import type { SourceRaster } from '../lib/image';

const T0: PhotoTransform = { rotate: 0, flipH: false, flipV: false, straighten: 0 };

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

function settings(patch: Partial<MosaicSettings> = {}): MosaicSettings {
  return { ...defaultSettings('colorByCode', 1), despeckle: 0, ...patch };
}

describe('photo transform', () => {
  it('maps corners correctly for each quarter turn', () => {
    const w = 40;
    const h = 30;
    // Top-left corner of the picture after turning clockwise ends at the top-right.
    const q1 = transformFor(w, h, { ...T0, rotate: 1 });
    expect([q1.width, q1.height]).toEqual([30, 40]);
    expect(apply(q1.m, 0, 0)).toEqual([30, 0]);
    const q2 = transformFor(w, h, { ...T0, rotate: 2 });
    expect(apply(q2.m, 0, 0)).toEqual([40, 30]);
    const q3 = transformFor(w, h, { ...T0, rotate: 3 });
    expect(apply(q3.m, 0, 0)).toEqual([0, 40]);
    const fh = transformFor(w, h, { ...T0, flipH: true });
    expect(apply(fh.m, 0, 0)).toEqual([40, 0]);
  });

  it('inverts', () => {
    const { m } = transformFor(64, 48, { rotate: 1, flipH: true, flipV: false, straighten: 12 });
    const [x, y] = apply(multiply(invert(m), m), 17, 9);
    expect(x).toBeCloseTo(17, 6);
    expect(y).toBeCloseTo(9, 6);
  });

  it('straightening zooms just enough to hide the corners', () => {
    const w = 120;
    const h = 80;
    const { m } = transformFor(w, h, { ...T0, straighten: 10 });
    expect(scaleOf(m)).toBeCloseTo(straightenZoom(w, h, 10), 6);
    // Every corner of the output must come from inside the source picture.
    const inv = invert(m);
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ]) {
      const [sx, sy] = apply(inv, x, y);
      expect(sx).toBeGreaterThanOrEqual(-1e-6);
      expect(sy).toBeGreaterThanOrEqual(-1e-6);
      expect(sx).toBeLessThanOrEqual(w + 1e-6);
      expect(sy).toBeLessThanOrEqual(h + 1e-6);
    }
  });

  it('rotating the view four times, or mirroring twice, gets back to the start', () => {
    let s = { ...T0, flipH: true, straighten: 5, cx: 0.3, cy: 0.8 };
    const start = { ...s };
    for (let i = 0; i < 4; i++) s = { ...s, ...rotateView(s, 1) };
    expect(s.rotate % 4).toBe(start.rotate);
    expect(s.cx).toBeCloseTo(start.cx);
    expect(s.cy).toBeCloseTo(start.cy);
    s = { ...s, ...flipView(s, 'v') };
    s = { ...s, ...flipView(s, 'v') };
    expect({ ...s, cx: 0, cy: 0 }).toEqual({ ...start, cx: 0, cy: 0 });
    expect(s.cx).toBeCloseTo(start.cx);
    expect(s.cy).toBeCloseTo(start.cy);
  });

  it('rotate right on a mirrored photo turns the view clockwise', () => {
    const w = 40;
    const h = 30;
    const s = { ...T0, flipH: true, cx: 0.5, cy: 0.5 };
    const before = transformFor(w, h, s);
    const after = transformFor(w, h, { ...s, ...rotateView(s, 1) });
    // A point at the top-left of the current view must move to the top-right.
    const src = apply(invert(before.m), 0, 0);
    const [x, y] = apply(after.m, src[0], src[1]);
    expect(x).toBeCloseTo(after.width);
    expect(y).toBeCloseTo(0);
  });
});

describe('background mask', () => {
  it('round-trips through run-length encoding', () => {
    const m = emptyMask(37, 23);
    paintSegment(m.data, 37, 23, 5, 5, 30, 18, 3.5, 1);
    const back = decodeMask(encodeMask(m));
    expect(back.width).toBe(37);
    expect(Array.from(back.data)).toEqual(Array.from(m.data));
    expect(encodeMask(emptyMask(4, 4)).rle).toBe('g');
  });

  it('paints round-capped strokes and can erase them', () => {
    const m = emptyMask(20, 20);
    paintSegment(m.data, 20, 20, 10, 10, 10, 10, 3, 1);
    expect(m.data[10 * 20 + 10]).toBe(1);
    expect(m.data[10 * 20 + 14]).toBe(0);
    paintSegment(m.data, 20, 20, 10, 10, 10, 10, 1, 0);
    expect(m.data[10 * 20 + 10]).toBe(0);
    expect(m.data[10 * 20 + 12]).toBe(1);
  });

  it('wand selects the connected area of similar colour only', () => {
    // Blue sky above a dark hill, with a separate blue pond inside the hill.
    const src = raster(30, 20, (x, y) => (y < 8 ? [90, 150, 230] : x > 10 && x < 20 && y > 12 && y < 17 ? [90, 150, 230] : [40, 60, 30]));
    const sel = selectSimilar(src, 3, 3, 30);
    expect(sel[2 * 30 + 25]).toBe(1);
    expect(sel[12 * 30 + 3]).toBe(0);
    expect(sel[14 * 30 + 15]).toBe(0);
  });

  it('auto background keeps a subject that touches one edge', () => {
    // Plain grey backdrop; a red figure reaching down to the bottom edge.
    const src = raster(40, 40, (x, y) => (x > 14 && x < 26 && y > 10 ? [200, 40, 40] : [210, 210, 205]));
    const sel = selectBackground(src, 30);
    expect(sel[2 * 40 + 2]).toBe(1);
    expect(sel[38 * 40 + 2]).toBe(1);
    expect(sel[30 * 40 + 20]).toBe(0);
    expect(sel[39 * 40 + 20]).toBe(0);
  });

  it('combines, inverts and follows the photo transform', () => {
    const region = new Uint8Array(16);
    region[0] = 1;
    const m = combineMask(null, region, 1, 4, 4);
    expect(m.data[0]).toBe(1);
    expect(invertMask(m, 4, 4).data[0]).toBe(0);
    // Turn the 4x4 mask a quarter clockwise: top-left goes to top-right.
    const { m: tm } = transformFor(4, 4, { ...T0, rotate: 1 });
    const out = transformMask(m, invert(tm), 4, 4);
    expect(out[3]).toBe(1);
    expect(out[0]).toBe(0);
  });
});

describe('photo clean-up', () => {
  it('samples exactly like a plain average when every filter is off', () => {
    const src = raster(8, 8, (x, y) => [x * 30, y * 30, 100]);
    const { rgb, removed } = sampleGrid(src, 2, 2, settings());
    expect(removed).toBeNull();
    // Top-left cell averages x, y in 0..3.
    expect(rgb[0]).toBeCloseTo((1.5 * 30) / 255, 5);
    expect(rgb[1]).toBeCloseTo((1.5 * 30) / 255, 5);
  });

  it('flags cells whose area is mostly masked', () => {
    const src = raster(8, 8, () => [10, 10, 10]);
    const mask = new Uint8Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) mask[y * 8 + x] = 1;
    const { removed } = sampleGrid(src, 2, 2, settings(), mask);
    expect(Array.from(removed!)).toEqual([1, 0, 1, 0]);
  });

  it('auto levels stretches a flat, grey photo', () => {
    const src = raster(10, 10, (x) => (x < 5 ? [100, 100, 100] : [150, 150, 150]));
    const { rgb } = sampleGrid(src, 10, 10, settings({ autoLevels: true }));
    expect(rgb[0]).toBeLessThan(0.05);
    expect(rgb[9 * 3]).toBeGreaterThan(0.95);
  });

  it('even lighting flattens a shadow gradient', () => {
    const W = 40;
    const H = 10;
    const rgb = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) rgb.fill(0.2 + (0.6 * (i % W)) / W, i * 3, i * 3 + 3);
    const spread = () => rgb[(5 * W + W - 5) * 3] - rgb[(5 * W + 4) * 3];
    const before = spread();
    evenLighting(rgb, W, H, 1);
    expect(spread()).toBeLessThan(before * 0.5);
  });

  it('simplify keeps a hard edge hard and flattens noise', () => {
    const W = 20;
    const H = 20;
    const rgb = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.fill((x < 10 ? 0.2 : 0.8) + (((x * 7 + y * 13) % 5) - 2) * 0.03, (y * W + x) * 3, (y * W + x) * 3 + 3);
    kuwahara(rgb, W, H, 2);
    expect(rgb[(10 * W + 9) * 3]).toBeLessThan(0.3);
    expect(rgb[(10 * W + 10) * 3]).toBeGreaterThan(0.7);
    const a = rgb[(10 * W + 4) * 3];
    const b = rgb[(11 * W + 5) * 3];
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it('dark details keeps a thin dark line that averaging would lose', () => {
    // One 4x4 block: white with a one-pixel dark line.
    const rgb = new Float32Array(16 * 3).fill(1);
    for (let y = 0; y < 4; y++) rgb.fill(0, (y * 4 + 1) * 3, (y * 4 + 1) * 3 + 3);
    expect(downsample(rgb, 4, 4, 4, 0)[0]).toBeCloseTo(0.75);
    expect(downsample(rgb, 4, 4, 4, 1)[0]).toBeCloseTo(0);
  });
});

describe('pixelize with a background mask', () => {
  // Left half a busy green background, right half a red subject.
  const src = raster(20, 10, (x, y) => (x < 10 ? [20 + ((x * 37 + y * 11) % 3) * 90, 160, 40] : [210, 30, 40]));
  const mask = new Uint8Array(200);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) mask[y * 20 + x] = 1;

  it('leaves removed cells blank and keeps their colours out of the palette', () => {
    const g = pixelize(src, settings({ gridWidth: 20, gridHeight: 10, colors: 4, blankLightest: false }), 'palette', mask);
    expect(g.blank).toBe(true);
    expect(g.palette[0]).toBe('#ffffff');
    expect(g.cells[0]).toBe(0);
    expect(g.palette.slice(1).every((c) => !c.startsWith('#14') && !c.startsWith('#6e'))).toBe(true);
    expect(g.cells[15]).not.toBe(0);
  });

  it('keeps removed cells blank in inverted and dithered binary grids', () => {
    const g = pixelize(src, settings({ gridWidth: 20, gridHeight: 10, invert: true, dither: true, threshold: 50 }), 'binary', mask);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) expect(g.cells[y * 20 + x]).toBe(0);
  });

  it('blanks removed quarters in mystery portraits', () => {
    const g = pixelize(src, settings({ gridWidth: 10, gridHeight: 5, invert: true }), 'mystery', mask);
    expect(g.cells[0]).toBe(0);
  });
});

describe('touch-ups', () => {
  const palette: PixelGrid = { width: 3, height: 2, cells: [0, 1, 2, 0, 1, 2], palette: ['#ffffff', '#cc2222', '#2222cc'], blank: true, kind: 'palette' };

  it('paints by nearest colour, blank or shape depending on the grid', () => {
    expect(resolveToken(palette, '#dd3333')).toBe(1);
    expect(resolveToken(palette, '_')).toBe(0);
    const bin: PixelGrid = { ...palette, palette: ['#ffffff', '#000000'], kind: 'binary' };
    expect(resolveToken(bin, '#2222cc')).toBe(1);
    expect(resolveToken(bin, 'm9')).toBe(1);
    const mys: PixelGrid = { ...bin, kind: 'mystery' };
    expect(resolveToken(mys, 'm5')).toBe(5);
    expect(tokenForValue(mys, 0)).toBe('_');
    expect(tokenForValue(palette, 2)).toBe('#2222cc');
  });

  it('applies edits and survives a resize', () => {
    const e = setCells(null, 3, 2, [0], '#2222cc');
    expect(applyEdits(palette, e).cells[0]).toBe(2);
    const bigger = remapEdits(e!, 6, 4);
    expect(Object.keys(bigger.cells).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 6, 7]);
    expect(setCells(e, 3, 2, [0], null)).toBeNull();
  });

  it('flood fills the connected area of one value', () => {
    const g: PixelGrid = { ...palette, width: 4, height: 2, cells: [1, 1, 0, 1, 0, 1, 0, 1] };
    expect(floodCells(g, 0).sort()).toEqual([0, 1, 5]);
  });
});

describe('history', () => {
  it('merges quick changes with the same key and undoes/redoes', () => {
    let h = initHistory(0);
    h = pushHistory(h, 1, 'a', 1000);
    h = pushHistory(h, 2, 'a', 1500);
    h = pushHistory(h, 3, 'b', 1600);
    expect(h.past).toEqual([0, 2]);
    h = undoHistory(h);
    expect(h.present).toBe(2);
    h = undoHistory(h);
    expect(h.present).toBe(0);
    h = redoHistory(h);
    expect(h.present).toBe(2);
    h = pushHistory(h, 9, null, 9000);
    expect(h.future).toEqual([]);
  });
});

describe('compatibility', () => {
  it('samples saved mosaics exactly as before when no clean-up is used', async () => {
    const { legacySampleGrid } = await import('./fixtures/legacySample');
    const { createRng } = await import('../lib/rng');
    const rng = createRng(42);
    const src = raster(173, 121, () => [rng.int(256), rng.int(256), rng.int(256)]);
    for (const patch of [{}, { brightness: 30, contrast: -40, saturation: 60 }, { zoom: 2.3, cx: 0.3, cy: 0.7, contrast: 80 }, { gridWidth: 41, gridHeight: 17 }]) {
      const s = settings(patch);
      const w = s.gridWidth;
      const h = s.gridHeight;
      const before = legacySampleGrid(src, w, h, s);
      const after = sampleGrid(src, w, h, s).rgb;
      expect(after.length).toBe(before.length);
      for (let i = 0; i < before.length; i++) expect(after[i]).toBeCloseTo(before[i], 6);
    }
  });
});
