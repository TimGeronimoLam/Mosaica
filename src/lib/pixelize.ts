import type { MosaicSettings, PixelGrid, PixelKind } from '../types';
import { bufferToOklab, hexToRgb, oklabToSrgb, rgbToHex, srgbToOklab } from './color';
import type { SourceRaster } from './image';
import { sampleGrid, type Sampled } from './preprocess';
import { bayer, ditherAssign, kmeans, kmeansBest, orderedAssign } from './quantize';
import { mergeSmallRegions, otsuThreshold } from './regions';
import { createRng } from './rng';

/** Quadrant coverage (TL, TR, BL, BR) of each mystery-portrait shape code. */
export const MYSTERY_SHAPES: [number, number, number, number][] = [
  [0, 0, 0, 0], // 0 empty
  [0, 0, 1, 1], // 1 bottom half
  [0, 1, 0, 1], // 2 right half
  [1, 1, 0, 0], // 3 top half
  [1, 0, 1, 0], // 4 left half
  [0.5, 0, 1, 0.5], // 5 triangle bottom-left
  [0.5, 1, 0, 0.5], // 6 triangle top-right
  [1, 0.5, 0.5, 0], // 7 triangle top-left
  [0, 0.5, 0.5, 1], // 8 triangle bottom-right
  [1, 1, 1, 1], // 9 full
];

/** Polygon (unit square, y down) for each shape code; null for empty. */
export const MYSTERY_POLYGONS: (string | null)[] = [
  null,
  '0,0.5 1,0.5 1,1 0,1',
  '0.5,0 1,0 1,1 0.5,1',
  '0,0 1,0 1,0.5 0,0.5',
  '0,0 0.5,0 0.5,1 0,1',
  '0,0 0,1 1,1',
  '0,0 1,0 1,1',
  '0,0 1,0 0,1',
  '1,0 1,1 0,1',
  '0,0 1,0 1,1 0,1',
];

/** Cell colours for a w x h grid: the photo sampled by whichever converter is in use. */
export type Sampler = (w: number, h: number) => Sampled;

/**
 * Reduce the photo to a grid of palette indices. `src` is the photo raster
 * (sampled with the crop in `s`) or a ready-made sampler. `mask` (same size as
 * the raster, 1 = background) marks areas that must stay blank paper: they are
 * left out of the palette and of dithering.
 */
export function pixelize(src: SourceRaster | Sampler, s: MosaicSettings, kind: PixelKind, mask?: Uint8Array | null): PixelGrid {
  const sample: Sampler = typeof src === 'function' ? src : (w, h) => sampleGrid(src, w, h, s, mask);
  const w = Math.max(2, Math.round(s.gridWidth));
  const h = Math.max(2, Math.round(s.gridHeight));
  if (kind === 'mystery') return pixelizeMystery(sample(w * 2, h * 2), w, h, s);
  if (kind === 'binary') return pixelizeBinary(sample(w, h), w, h, s);
  return pixelizePalette(sample(w, h), w, h, s);
}

/**
 * A good ink threshold (percent) for this photo: Otsu's method on the cells'
 * lightness, ignoring removed background.
 */
export function suggestThreshold(src: SourceRaster | Sampler, s: MosaicSettings, kind: PixelKind, mask?: Uint8Array | null): number {
  const sample: Sampler = typeof src === 'function' ? src : (w, h) => sampleGrid(src, w, h, s, mask);
  const w = Math.max(2, Math.round(s.gridWidth));
  const h = Math.max(2, Math.round(s.gridHeight));
  const { rgb, removed } = kind === 'mystery' ? sample(w * 2, h * 2) : sample(w, h);
  const n = rgb.length / 3;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  return Math.max(5, Math.min(95, Math.round(otsuThreshold(lum, removed) * 100)));
}

/** Force removed cells back to `blank` (after invert or despeckle may have changed them). */
function clearRemoved(cells: number[], removed: Uint8Array | null, blank: number): number[] {
  if (!removed) return cells;
  for (let i = 0; i < cells.length; i++) if (removed[i]) cells[i] = blank;
  return cells;
}

/** Cells marked as detail (at least half the cell), which clean-ups must not change. */
function detailCells(detail: Float32Array | null): Uint8Array | null {
  if (!detail) return null;
  const out = new Uint8Array(detail.length);
  let any = false;
  for (let i = 0; i < detail.length; i++) {
    if (detail[i] >= 0.5) {
      out[i] = 1;
      any = true;
    }
  }
  return any ? out : null;
}

/** Cells that merging must leave alone: removed background and marked detail. */
function lockedCells(removed: Uint8Array | null, protect: Uint8Array | null): Uint8Array | null {
  if (!removed || !protect) return removed ?? protect;
  const out = new Uint8Array(removed.length);
  for (let i = 0; i < out.length; i++) out[i] = removed[i] || protect[i] ? 1 : 0;
  return out;
}

/** Speckle removal that leaves marked detail cells as they were (an eye is one dark cell on purpose). */
function despeckleKeeping(cells: number[], w: number, h: number, passes: number, k: number, protect: Uint8Array | null): number[] {
  if (!passes) return cells;
  const out = despeckle(cells, w, h, passes, k);
  if (protect && out !== cells) for (let i = 0; i < out.length; i++) if (protect[i]) out[i] = cells[i];
  return out;
}

/** How many times a detail cell counts when choosing the palette, so eyes and lips get colours of their own. */
const DETAIL_WEIGHT = 3;

/** How much more hue and saturation count than lightness when choosing a palette (tested on photos: 2 keeps skin, crema and fur tones apart). */
const CHROMA_WEIGHT = 2;

/** k-means starts per palette for converter 2 (tested: 6 keeps e.g. an orange crema that 1-3 starts often lose). */
const KMEANS_RUNS = 6;

const amountOf = (s: MosaicSettings) => Math.max(0, Math.min(100, s.ditherAmount ?? 100)) / 100;

function pixelizeBinary({ rgb: pts, removed, detail }: Sampled, w: number, h: number, s: MosaicSettings): PixelGrid {
  const n = w * h;
  const t = s.threshold / 100;
  const protect = detailCells(detail);
  let cells: number[];
  if (s.dither && s.ditherStyle === 'pattern') {
    // Ordered dither: the threshold follows a fixed 4x4 pattern around the chosen cut.
    const amount = amountOf(s);
    cells = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * pts[i * 3] + 0.7152 * pts[i * 3 + 1] + 0.0722 * pts[i * 3 + 2];
      cells[i] = l < t + bayer(i % w, Math.floor(i / w)) * amount ? 1 : 0;
    }
  } else if (s.dither) {
    // Shift luminance so the chosen threshold sits at 0.5, then dither against black/white.
    const lum = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * pts[i * 3] + 0.7152 * pts[i * 3 + 1] + 0.0722 * pts[i * 3 + 2];
      // Removed cells are pure white with no error to pass on.
      const v = removed?.[i] ? 1 : Math.max(0, Math.min(1, l + (0.5 - t)));
      lum[i * 3] = lum[i * 3 + 1] = lum[i * 3 + 2] = v;
    }
    cells = ditherAssign(
      lum,
      w,
      h,
      [
        [1, 1, 1],
        [0, 0, 0],
      ],
      null,
      amountOf(s),
    );
  } else {
    cells = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * pts[i * 3] + 0.7152 * pts[i * 3 + 1] + 0.0722 * pts[i * 3 + 2];
      cells[i] = l < t ? 1 : 0;
    }
  }
  if (s.invert) cells = cells.map((c) => 1 - c);
  cells = clearRemoved(cells, removed, 0);
  cells = clearRemoved(despeckleKeeping(cells, w, h, s.despeckle, 2, protect), removed, 0);
  // Dither dots are one-cell areas on purpose, so merging would undo the shading.
  cells = mergeSmallRegions(cells, w, h, s.dither ? 0 : (s.minRegion ?? 0), null, lockedCells(removed, protect));
  return { width: w, height: h, cells, palette: ['#ffffff', '#000000'], blank: true, kind: 'binary' };
}

function pixelizePalette({ rgb, removed, detail }: Sampled, w: number, h: number, s: MosaicSettings): PixelGrid {
  const n = w * h;
  const k = Math.max(2, Math.min(24, Math.round(s.colors)));
  const rng = createRng(s.seed);
  const protect = detailCells(detail);
  // Converter 2 chooses and matches colours in OKLab, where distance follows
  // how different colours look, with hue and saturation counting double: a
  // colour-by-code palette needs distinct hues (skin vs. a grey wall, orange
  // crema vs. beige foam) more than many steps of lightness. Converter 1 keeps
  // the original sRGB maths.
  const oklab = (s.converter ?? 1) >= 2;
  const cw = CHROMA_WEIGHT;
  const pts = oklab ? bufferToOklab(rgb) : rgb;
  if (oklab) for (let i = 0; i < pts.length; i += 3) (pts[i + 1] *= cw), (pts[i + 2] *= cw);
  // Only the cells that are kept take part in choosing the palette, so the
  // background does not use up colours. Detail cells are entered several
  // times, so their few cells still pull a palette colour towards them.
  let kept = pts;
  let keptIndex: number[] | null = null;
  if (removed || protect) {
    keptIndex = [];
    for (let i = 0; i < n; i++) {
      if (removed?.[i]) continue;
      for (let r = protect?.[i] ? DETAIL_WEIGHT : 1; r > 0; r--) keptIndex.push(i);
    }
    kept = new Float32Array(keptIndex.length * 3);
    keptIndex.forEach((src, j) => kept.set(pts.subarray(src * 3, src * 3 + 3), j * 3));
  }
  // Several k-means starts, keeping the best, so small distinctive colours are
  // not lost to one unlucky start and Shuffle gives variations, not worse palettes.
  const { centers, labels } = oklab ? kmeansBest(kept, k, rng, KMEANS_RUNS, (c) => c[0]) : kmeans(kept, k, rng);
  if (!centers.length) {
    return { width: w, height: h, cells: new Array<number>(n).fill(0), palette: ['#ffffff'], blank: true, kind: 'palette' };
  }
  let cells: number[];
  if (s.dither && s.ditherStyle === 'pattern' && oklab) cells = orderedAssign(pts, w, h, centers, removed, amountOf(s));
  else if (s.dither) cells = ditherAssign(pts, w, h, centers, removed, amountOf(s));
  else if (keptIndex) {
    cells = new Array<number>(n).fill(0);
    keptIndex.forEach((src, j) => (cells[src] = labels[j]));
  } else cells = labels;
  cells = despeckleKeeping(cells, w, h, s.despeckle, centers.length, protect);
  let palette = centers.map((c) => {
    const [r, g, b] = oklab ? oklabToSrgb(c[0], c[1] / cw, c[2] / cw) : c;
    return rgbToHex(r * 255, g * 255, b * 255);
  });
  let blank = s.blankLightest;
  if (blank) {
    // Treat the lightest colour as paper white.
    palette = palette.slice();
    palette[0] = '#ffffff';
  }
  if (s.invert) {
    palette = palette.slice().reverse();
    cells = cells.map((c) => palette.length - 1 - c);
    blank = false;
  }
  if (removed && !blank) {
    // Removed areas need a "leave it white" code of their own.
    palette = ['#ffffff', ...palette];
    cells = cells.map((c) => c + 1);
    blank = true;
  }
  cells = clearRemoved(cells, removed, 0);
  if ((s.minRegion ?? 0) >= 2 && !s.dither) {
    const colors = palette.map((hex) => {
      const [r, g, b] = hexToRgb(hex);
      return srgbToOklab(r / 255, g / 255, b / 255);
    });
    cells = mergeSmallRegions(cells, w, h, s.minRegion, colors, lockedCells(removed, protect));
  }
  return { width: w, height: h, cells, palette, blank, kind: 'palette' };
}

function pixelizeMystery({ rgb: pts, removed }: Sampled, w: number, h: number, s: MosaicSettings): PixelGrid {
  const t = s.threshold / 100;
  const gain = 1.6;
  const amount = amountOf(s);
  const cells = new Array<number>(w * h);
  // Error carried over to neighbouring cells (Floyd–Steinberg on the cell's mean coverage).
  const carry = new Float32Array(w * h);
  const q = [0, 0, 0, 0];
  const W2 = w * 2;
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const idx = [y * 2 * W2 + x * 2, y * 2 * W2 + x * 2 + 1, (y * 2 + 1) * W2 + x * 2, (y * 2 + 1) * W2 + x * 2 + 1];
      const bias = s.dither ? carry[y * w + x] : 0;
      let mean = 0;
      let gone = 0;
      for (let i = 0; i < 4; i++) {
        const o = idx[i] * 3;
        const l = 0.2126 * pts[o] + 0.7152 * pts[o + 1] + 0.0722 * pts[o + 2];
        let d = 1 - l; // darkness
        if (s.invert) d = 1 - d;
        // A removed quarter is blank, so shapes can follow the edge of the cut-out.
        if (removed?.[idx[i]]) {
          q[i] = 0;
          gone++;
        } else q[i] = Math.max(0, Math.min(1, 0.5 + (d - (1 - t)) * gain + bias));
        mean += q[i] / 4;
      }
      if (gone === 4) {
        cells[y * w + x] = 0;
        continue;
      }
      let best = 0;
      let bestErr = Infinity;
      for (let c = 0; c < MYSTERY_SHAPES.length; c++) {
        const sh = MYSTERY_SHAPES[c];
        let e = 0;
        for (let i = 0; i < 4; i++) e += (q[i] - sh[i]) * (q[i] - sh[i]);
        if (e < bestErr - 1e-9) {
          bestErr = e;
          best = c;
        }
      }
      cells[y * w + x] = best;
      if (s.dither) {
        const sh = MYSTERY_SHAPES[best];
        const err = (mean - (sh[0] + sh[1] + sh[2] + sh[3]) / 4) * amount;
        const dir = ltr ? 1 : -1;
        const spread = (dx: number, dy: number, f: number) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny < h) carry[ny * w + nx] += err * f;
        };
        spread(dir, 0, 7 / 16);
        spread(-dir, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(dir, 1, 1 / 16);
      }
    }
  }
  return { width: w, height: h, cells, palette: ['#ffffff', '#000000'], blank: true, kind: 'mystery' };
}

/** Remove isolated cells by replacing them with the majority of their neighbours. */
export function despeckle(cells: number[], w: number, h: number, passes: number, k: number): number[] {
  let cur = cells;
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = cur[i];
        const counts = new Array<number>(k).fill(0);
        let same4 = 0;
        let same8 = 0;
        let total = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nv = cur[ny * w + nx];
            counts[nv]++;
            total++;
            if (nv === v) {
              same8++;
              if (!dx || !dy) same4++;
            }
          }
        }
        const lonely = same4 === 0 && (p === 0 ? same8 <= 1 : same8 <= 2);
        if (lonely && total > 0) {
          let best = v;
          let bestC = -1;
          for (let c = 0; c < k; c++) {
            if (c !== v && counts[c] > bestC) {
              bestC = counts[c];
              best = c;
            }
          }
          if (best !== v) {
            next[i] = best;
            changed = true;
          }
        }
      }
    }
    cur = next;
    if (!changed) break;
  }
  return cur;
}
