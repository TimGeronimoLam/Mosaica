import type { MosaicSettings, PixelGrid, PixelKind } from '../types';
import { rgbToHex } from './color';
import type { SourceRaster } from './image';
import { sampleGrid } from './preprocess';
import { ditherAssign, kmeans } from './quantize';
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

/**
 * Reduce the photo to a grid of palette indices. `mask` (same size as `src`,
 * 1 = background) marks areas that must stay blank paper: they are left out
 * of the palette and of dithering.
 */
export function pixelize(src: SourceRaster, s: MosaicSettings, kind: PixelKind, mask?: Uint8Array | null): PixelGrid {
  const w = Math.max(2, Math.round(s.gridWidth));
  const h = Math.max(2, Math.round(s.gridHeight));
  if (kind === 'mystery') return pixelizeMystery(src, w, h, s, mask);
  if (kind === 'binary') return pixelizeBinary(src, w, h, s, mask);
  return pixelizePalette(src, w, h, s, mask);
}

/** Force removed cells back to `blank` (after invert or despeckle may have changed them). */
function clearRemoved(cells: number[], removed: Uint8Array | null, blank: number): number[] {
  if (!removed) return cells;
  for (let i = 0; i < cells.length; i++) if (removed[i]) cells[i] = blank;
  return cells;
}

function pixelizeBinary(src: SourceRaster, w: number, h: number, s: MosaicSettings, mask?: Uint8Array | null): PixelGrid {
  const { rgb: pts, removed } = sampleGrid(src, w, h, s, mask);
  const n = w * h;
  const t = s.threshold / 100;
  let cells: number[];
  if (s.dither) {
    // Shift luminance so the chosen threshold sits at 0.5, then dither against black/white.
    const lum = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * pts[i * 3] + 0.7152 * pts[i * 3 + 1] + 0.0722 * pts[i * 3 + 2];
      // Removed cells are pure white with no error to pass on.
      const v = removed?.[i] ? 1 : Math.max(0, Math.min(1, l + (0.5 - t)));
      lum[i * 3] = lum[i * 3 + 1] = lum[i * 3 + 2] = v;
    }
    cells = ditherAssign(lum, w, h, [
      [1, 1, 1],
      [0, 0, 0],
    ]);
  } else {
    cells = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * pts[i * 3] + 0.7152 * pts[i * 3 + 1] + 0.0722 * pts[i * 3 + 2];
      cells[i] = l < t ? 1 : 0;
    }
  }
  if (s.invert) cells = cells.map((c) => 1 - c);
  cells = clearRemoved(cells, removed, 0);
  cells = clearRemoved(despeckle(cells, w, h, s.despeckle, 2), removed, 0);
  return { width: w, height: h, cells, palette: ['#ffffff', '#000000'], blank: true, kind: 'binary' };
}

function pixelizePalette(src: SourceRaster, w: number, h: number, s: MosaicSettings, mask?: Uint8Array | null): PixelGrid {
  const { rgb: pts, removed } = sampleGrid(src, w, h, s, mask);
  const n = w * h;
  const k = Math.max(2, Math.min(24, Math.round(s.colors)));
  const rng = createRng(s.seed);
  // Only the cells that are kept take part in choosing the palette, so the
  // background does not use up colours.
  let kept = pts;
  let keptIndex: number[] | null = null;
  if (removed) {
    keptIndex = [];
    for (let i = 0; i < n; i++) if (!removed[i]) keptIndex.push(i);
    kept = new Float32Array(keptIndex.length * 3);
    keptIndex.forEach((src, j) => kept.set(pts.subarray(src * 3, src * 3 + 3), j * 3));
  }
  const { centers, labels } = kmeans(kept, k, rng);
  if (!centers.length) {
    return { width: w, height: h, cells: new Array<number>(n).fill(0), palette: ['#ffffff'], blank: true, kind: 'palette' };
  }
  let cells: number[];
  if (s.dither) cells = ditherAssign(pts, w, h, centers, removed);
  else if (keptIndex) {
    cells = new Array<number>(n).fill(0);
    keptIndex.forEach((src, j) => (cells[src] = labels[j]));
  } else cells = labels;
  cells = despeckle(cells, w, h, s.despeckle, centers.length);
  let palette = centers.map((c) => rgbToHex(c[0] * 255, c[1] * 255, c[2] * 255));
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
  return { width: w, height: h, cells, palette, blank, kind: 'palette' };
}

function pixelizeMystery(src: SourceRaster, w: number, h: number, s: MosaicSettings, mask?: Uint8Array | null): PixelGrid {
  const { rgb: pts, removed } = sampleGrid(src, w * 2, h * 2, s, mask);
  const t = s.threshold / 100;
  const gain = 1.6;
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
        const err = mean - (sh[0] + sh[1] + sh[2] + sh[3]) / 4;
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
