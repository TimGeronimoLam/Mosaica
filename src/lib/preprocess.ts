import type { MosaicSettings } from '../types';
import { bufferToOklab } from './color';
import { clamp01, cropRect, type SourceRaster } from './image';

/**
 * Cell colours (w*h*3, sRGB 0..1), which cells were removed as background, and
 * how much of each cell (0..1) is marked as detail to protect.
 */
export interface Sampled {
  rgb: Float32Array;
  removed: Uint8Array | null;
  detail: Float32Array | null;
}

export type CleanupSettings = Pick<
  MosaicSettings,
  'crop' | 'zoom' | 'cx' | 'cy' | 'brightness' | 'contrast' | 'saturation' | 'autoLevels' | 'localContrast' | 'smooth' | 'darkDetails' | 'outlines' | 'cellColor'
> &
  Partial<Pick<MosaicSettings, 'restoreContrast'>>;

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Turn the crop of the (transformed) photo into one colour per cell.
 *
 * Filters that look at neighbourhoods (even lighting, simplify, outlines, dark
 * details, main colour) need to see inside each cell, so the crop is first
 * resampled at up to 4x4 pixels per cell, filtered, and then reduced to cells.
 * With all of them off, each cell is a plain average of its source pixels:
 * exactly what mosaics made before these options got.
 *
 * `mask` (same size as the photo, 1 = background) marks cells to leave blank;
 * `detailMask` (same size, 1 = detail) marks areas whose contrast and small
 * features the converter protects.
 */
export function sampleGrid(src: SourceRaster, w: number, h: number, s: CleanupSettings, mask?: Uint8Array | null, detailMask?: Uint8Array | null): Sampled {
  const rect = cropRect(src, w, h, s);
  const detail = s.localContrast > 0 || s.smooth > 0 || s.darkDetails > 0 || s.outlines > 0 || s.cellColor === 'main' || (s.restoreContrast ?? 0) > 0 || !!detailMask;
  const S = detail ? Math.max(1, Math.min(4, Math.floor(Math.min(rect.w / w, rect.h / h)))) : 1;
  const { rgb, cover } = resampleArea(src, rect, w * S, h * S, mask ?? null);
  const want = detailMask ? resampleCoverage(detailMask, src.width, src.height, rect, w * S, h * S) : null;
  return finish(rgb, cover, want, w, h, S, s);
}

/**
 * Like sampleGrid, for a crop that has already been rendered at S x S pixels
 * per cell (w*S x h*S) straight from the full-resolution photo. `mask` and
 * `detailMask` are the background and detail masks at that same size.
 */
export function sampleCells(src: SourceRaster, w: number, h: number, S: number, s: CleanupSettings, mask?: Uint8Array | null, detailMask?: Uint8Array | null): Sampled {
  const n = w * S * h * S;
  const rgb = new Float32Array(n * 3);
  const { data } = src;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    rgb[i * 3] = (data[i * 4] * a + 255 * (1 - a)) / 255;
    rgb[i * 3 + 1] = (data[i * 4 + 1] * a + 255 * (1 - a)) / 255;
    rgb[i * 3 + 2] = (data[i * 4 + 2] * a + 255 * (1 - a)) / 255;
  }
  return finish(rgb, mask ? Float32Array.from(mask) : null, detailMask ? Float32Array.from(detailMask) : null, w, h, S, s);
}

/** Tone, filters, then reduce S x S blocks to cells. */
function finish(rgb: Float32Array, cover: Float32Array | null, want: Float32Array | null, w: number, h: number, S: number, s: CleanupSettings): Sampled {
  const W = w * S;
  const H = h * S;
  tone(rgb, cover, s);
  if (s.localContrast > 0) evenLighting(rgb, W, H, s.localContrast / 100, cover);
  if (s.smooth > 0) kuwahara(rgb, W, H, Math.max(1, Math.round((s.smooth / 100) * 1.5 * S)));
  if (s.outlines > 0) drawOutlines(rgb, W, H, s.outlines / 100, Math.max(1, Math.round(S / 2)));
  for (let i = 0; i < rgb.length; i++) rgb[i] = clamp01(rgb[i]);
  let detail = want ? cellShare(want, w, h, S) : null;
  if (detail && !detail.some((v) => v > 0)) detail = null;
  const out = S === 1 ? rgb : downsample(rgb, W, H, S, s.darkDetails / 100, s.cellColor === 'main', cover, detail);
  const amount = Math.max(0, Math.min(100, s.restoreContrast ?? 0)) / 100;
  if (S > 1 && (amount > 0 || detail)) restoreContrast(out, rgb, W, H, S, amount, cover, detail);
  let removed: Uint8Array | null = null;
  if (cover) {
    const share = cellShare(cover, w, h, S);
    removed = new Uint8Array(w * h);
    let any = false;
    for (let i = 0; i < share.length; i++) {
      if (share[i] >= 0.5) {
        removed[i] = 1;
        any = true;
      }
    }
    if (!any) removed = null;
  }
  return { rgb: out, removed, detail };
}

/** Share of each cell's S x S samples flagged in `flags` (values 0..1). */
function cellShare(flags: Float32Array, w: number, h: number, S: number): Float32Array {
  const W = w * S;
  const out = new Float32Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      let c = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) c += flags[(gy * S + y) * W + gx * S + x];
      out[gy * w + gx] = c / (S * S);
    }
  }
  return out;
}

/** Share of each W x H block of the crop rectangle covered by set pixels of `mask` (sw x sh, the photo's size). */
function resampleCoverage(mask: Uint8Array, sw: number, sh: number, rect: { x: number; y: number; w: number; h: number }, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const cellW = rect.w / W;
  const cellH = rect.h / H;
  for (let gy = 0; gy < H; gy++) {
    const y0 = Math.floor(rect.y + gy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor(rect.y + (gy + 1) * cellH));
    for (let gx = 0; gx < W; gx++) {
      const x0 = Math.floor(rect.x + gx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor(rect.x + (gx + 1) * cellW));
      let m = 0;
      let n = 0;
      for (let y = Math.max(0, y0); y < y1 && y < sh; y++) {
        for (let x = Math.max(0, x0); x < x1 && x < sw; x++) {
          if (mask[y * sw + x]) m++;
          n++;
        }
      }
      out[gy * W + gx] = n ? m / n : 0;
    }
  }
  return out;
}

/** Most a neighbourhood's contrast is scaled up by, so photo noise cannot blow up. */
const RESTORE_MAX = 4;

/**
 * Perceptual downscaling (Öztireli & Gross 2015) in closed form, applied to
 * cells already reduced from S x S samples.
 *
 * Averaging a whole cell loses the contrast of anything thinner than a cell:
 * an eye becomes a slightly darker patch of skin, a whisker vanishes. For
 * every 3 x 3 neighbourhood of cells this compares how much the samples vary
 * with how much the cell colours vary, and scales the cells' deviations from
 * their local mean up until the two match, so the cells carry the contrast the
 * samples had. Smooth areas are left as they are.
 *
 * `amount` blends between the plain cells (0) and the restored ones (1);
 * `importance` (per cell, 0..1) raises the amount to 1 where a cell is marked
 * as detail. Removed cells (`cover`) are left alone and left out of the
 * neighbourhoods.
 */
export function restoreContrast(
  cells: Float32Array,
  rgb: Float32Array,
  W: number,
  H: number,
  S: number,
  amount: number,
  cover: Float32Array | null = null,
  importance: Float32Array | null = null,
): void {
  const w = W / S;
  const h = H / S;
  const n = w * h;
  // Mean of squares per cell over the kept samples, and which cells take part.
  const sq = new Float32Array(n * 3);
  const ok = new Uint8Array(n);
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const i = gy * w + gx;
      let count = 0;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const p = (gy * S + y) * W + gx * S + x;
          if (cover && cover[p] >= 0.5) continue;
          count++;
          sq[i * 3] += rgb[p * 3] * rgb[p * 3];
          sq[i * 3 + 1] += rgb[p * 3 + 1] * rgb[p * 3 + 1];
          sq[i * 3 + 2] += rgb[p * 3 + 2] * rgb[p * 3 + 2];
        }
      }
      if (count * 2 <= S * S) continue;
      ok[i] = 1;
      sq[i * 3] /= count;
      sq[i * 3 + 1] /= count;
      sq[i * 3 + 2] /= count;
    }
  }
  const M = new Float32Array(n);
  const R = new Float32Array(n);
  const D = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    // Local mean of the cells and the ratio of sample spread to cell spread.
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const i = gy * w + gx;
        if (!ok[i]) continue;
        let cnt = 0;
        let sum = 0;
        let sum2 = 0;
        let sumq = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const y = gy + dy;
          if (y < 0 || y >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const x = gx + dx;
            if (x < 0 || x >= w) continue;
            const j = y * w + x;
            if (!ok[j]) continue;
            const v = cells[j * 3 + c];
            cnt++;
            sum += v;
            sum2 += v * v;
            sumq += sq[j * 3 + c];
          }
        }
        const m = sum / cnt;
        const sl = sum2 / cnt - m * m;
        const sh = sumq / cnt - m * m;
        M[i] = m;
        R[i] = sl > 1e-6 ? Math.min(RESTORE_MAX, Math.sqrt(Math.max(0, sh) / sl)) : 1;
      }
    }
    // Each cell's restored value, averaged over the neighbourhoods it belongs to.
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const i = gy * w + gx;
        if (!ok[i]) continue;
        const v = cells[i * 3 + c];
        let cnt = 0;
        let acc = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const y = gy + dy;
          if (y < 0 || y >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const x = gx + dx;
            if (x < 0 || x >= w) continue;
            const j = y * w + x;
            if (!ok[j]) continue;
            cnt++;
            acc += M[j] + R[j] * (v - M[j]);
          }
        }
        D[i] = acc / cnt;
      }
    }
    for (let i = 0; i < n; i++) {
      if (!ok[i]) continue;
      const a = Math.max(amount, importance ? importance[i] : 0);
      if (a <= 0) continue;
      const v = cells[i * 3 + c];
      cells[i * 3 + c] = clamp01(v + a * (D[i] - v));
    }
  }
}

/** Box-average the crop rectangle down (or up) to W x H pixels. */
function resampleArea(src: SourceRaster, rect: { x: number; y: number; w: number; h: number }, W: number, H: number, mask: Uint8Array | null) {
  const rgb = new Float32Array(W * H * 3);
  const cover = mask ? new Float32Array(W * H) : null;
  const { data, width: sw } = src;
  const cellW = rect.w / W;
  const cellH = rect.h / H;
  for (let gy = 0; gy < H; gy++) {
    const y0 = Math.floor(rect.y + gy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor(rect.y + (gy + 1) * cellH));
    for (let gx = 0; gx < W; gx++) {
      const x0 = Math.floor(rect.x + gx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor(rect.x + (gx + 1) * cellW));
      let r = 0;
      let g = 0;
      let b = 0;
      let m = 0;
      let n = 0;
      // Colour of the kept (unmasked) pixels only, so cut-out edges carry no background colour.
      let kr = 0;
      let kg = 0;
      let kb = 0;
      for (let y = y0; y < y1 && y < src.height; y++) {
        let i = (y * sw + x0) * 4;
        for (let x = x0; x < x1 && x < sw; x++) {
          const a = data[i + 3] / 255;
          const pr = data[i] * a + 255 * (1 - a);
          const pg = data[i + 1] * a + 255 * (1 - a);
          const pb = data[i + 2] * a + 255 * (1 - a);
          r += pr;
          g += pg;
          b += pb;
          if (mask) {
            if (mask[y * sw + x]) m++;
            else {
              kr += pr;
              kg += pg;
              kb += pb;
            }
          }
          n++;
          i += 4;
        }
      }
      if (n === 0) n = 1;
      const o = (gy * W + gx) * 3;
      const kept = n - m;
      if (mask && m > 0 && kept > 0) {
        rgb[o] = kr / kept / 255;
        rgb[o + 1] = kg / kept / 255;
        rgb[o + 2] = kb / kept / 255;
      } else {
        rgb[o] = r / n / 255;
        rgb[o + 1] = g / n / 255;
        rgb[o + 2] = b / n / 255;
      }
      if (cover) cover[gy * W + gx] = m / n;
    }
  }
  return { rgb, cover };
}

/** Auto levels, then saturation, contrast and brightness. */
function tone(rgb: Float32Array, cover: Float32Array | null, s: CleanupSettings): void {
  const n = rgb.length / 3;
  let lo = 0;
  let scale = 1;
  if (s.autoLevels) {
    const hist = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (cover && cover[i] >= 0.5) continue;
      hist[Math.min(255, Math.max(0, Math.round(lum(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) * 255)))]++;
      total++;
    }
    if (total > 0) {
      const pick = (q: number) => {
        let acc = 0;
        for (let b = 0; b < 256; b++) {
          acc += hist[b];
          if (acc >= q * total) return b / 255;
        }
        return 1;
      };
      const a = pick(0.01);
      const b = pick(0.99);
      if (b - a > 0.04) {
        lo = a;
        scale = 1 / (b - a);
      }
    }
  }
  const bright = (s.brightness / 100) * 0.5;
  const contrast = s.contrast >= 0 ? 1 + s.contrast / 50 : 1 + s.contrast / 100;
  const sat = (s.saturation + 100) / 100;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    let r = (rgb[o] - lo) * scale;
    let g = (rgb[o + 1] - lo) * scale;
    let b = (rgb[o + 2] - lo) * scale;
    const l = lum(r, g, b);
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    rgb[o] = clamp01((r - 0.5) * contrast + 0.5 + bright);
    rgb[o + 1] = clamp01((g - 0.5) * contrast + 0.5 + bright);
    rgb[o + 2] = clamp01((b - 0.5) * contrast + 0.5 + bright);
  }
}

/** Mean filter with a (2r+1)² window, clamped at the edges. Separable running sums. */
export function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sum = 0;
    let cnt = 0;
    for (let x = 0; x <= Math.min(r, W - 1); x++) {
      sum += src[row + x];
      cnt++;
    }
    for (let x = 0; x < W; x++) {
      tmp[row + x] = sum / cnt;
      const add = x + r + 1;
      const sub = x - r;
      if (add < W) {
        sum += src[row + add];
        cnt++;
      }
      if (sub >= 0) {
        sum -= src[row + sub];
        cnt--;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    let cnt = 0;
    for (let y = 0; y <= Math.min(r, H - 1); y++) {
      sum += tmp[y * W + x];
      cnt++;
    }
    for (let y = 0; y < H; y++) {
      out[y * W + x] = sum / cnt;
      const add = y + r + 1;
      const sub = y - r;
      if (add < H) {
        sum += tmp[add * W + x];
        cnt++;
      }
      if (sub >= 0) {
        sum -= tmp[sub * W + x];
        cnt--;
      }
    }
  }
  return out;
}

function luminanceOf(rgb: Float32Array, n: number): Float32Array {
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lum(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  return L;
}

/**
 * Remove a share k of the large-scale brightness changes (shadows across a
 * face, a dark corner) while slightly boosting fine detail. Like an adaptive
 * threshold, but it works for colours too.
 */
export function evenLighting(rgb: Float32Array, W: number, H: number, k: number, cover: Float32Array | null = null): void {
  const n = W * H;
  const L = luminanceOf(rgb, n);
  const R = Math.max(2, Math.round(Math.max(W, H) * 0.08));
  const B = boxBlur(boxBlur(L, W, H, R), W, H, R);
  let mean = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (cover && cover[i] >= 0.5) continue;
    mean += L[i];
    cnt++;
  }
  mean = cnt ? mean / cnt : 0.5;
  const boost = 1 + 0.6 * k;
  for (let i = 0; i < n; i++) {
    const target = mean + (L[i] - B[i]) * boost + (B[i] - mean) * (1 - k);
    const d = target - L[i];
    rgb[i * 3] += d;
    rgb[i * 3 + 1] += d;
    rgb[i * 3 + 2] += d;
  }
}

/**
 * Kuwahara filter: each pixel takes the mean colour of whichever of its four
 * (r+1)² quadrants is most uniform. Flattens texture (skin pores, grass, hair
 * strands) into clean areas while keeping edges sharp, which is exactly what
 * pixel art wants.
 */
export function kuwahara(rgb: Float32Array, W: number, H: number, r: number): void {
  const W1 = W + 1;
  const size = W1 * (H + 1);
  const sR = new Float64Array(size);
  const sG = new Float64Array(size);
  const sB = new Float64Array(size);
  const sL = new Float64Array(size);
  const sL2 = new Float64Array(size);
  for (let y = 0; y < H; y++) {
    let aR = 0;
    let aG = 0;
    let aB = 0;
    let aL = 0;
    let aL2 = 0;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const l = lum(rgb[o], rgb[o + 1], rgb[o + 2]);
      aR += rgb[o];
      aG += rgb[o + 1];
      aB += rgb[o + 2];
      aL += l;
      aL2 += l * l;
      const i = (y + 1) * W1 + x + 1;
      const up = y * W1 + x + 1;
      sR[i] = sR[up] + aR;
      sG[i] = sG[up] + aG;
      sB[i] = sB[up] + aB;
      sL[i] = sL[up] + aL;
      sL2[i] = sL2[up] + aL2;
    }
  }
  const box = (s: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    s[(y1 + 1) * W1 + x1 + 1] - s[y0 * W1 + x1 + 1] - s[(y1 + 1) * W1 + x0] + s[y0 * W1 + x0];
  const out = new Float32Array(rgb.length);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(W - 1, x + r);
      let best = Infinity;
      let bx0 = x;
      let by0 = y;
      let bx1 = x;
      let by1 = y;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : xa;
        const x1 = q & 1 ? xb : x;
        const y0 = q & 2 ? y : ya;
        const y1 = q & 2 ? yb : y;
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const m = box(sL, x0, y0, x1, y1) / n;
        const v = box(sL2, x0, y0, x1, y1) / n - m * m;
        if (v < best) {
          best = v;
          bx0 = x0;
          by0 = y0;
          bx1 = x1;
          by1 = y1;
        }
      }
      const n = (bx1 - bx0 + 1) * (by1 - by0 + 1);
      const o = (y * W + x) * 3;
      out[o] = box(sR, bx0, by0, bx1, by1) / n;
      out[o + 1] = box(sG, bx0, by0, bx1, by1) / n;
      out[o + 2] = box(sB, bx0, by0, bx1, by1) / n;
    }
  }
  rgb.set(out);
}

/** Darken pixels on strong brightness edges so outlines survive as lines of cells. */
export function drawOutlines(rgb: Float32Array, W: number, H: number, k: number, d: number): void {
  const n = W * H;
  const L = boxBlur(luminanceOf(rgb, n), W, H, d);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - d) * W;
    const yb = Math.min(H - 1, y + d) * W;
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - d);
      const xb = Math.min(W - 1, x + d);
      const gx = L[y * W + xb] - L[y * W + xa];
      const gy = L[yb + x] - L[ya + x];
      const e = Math.min(1, Math.max(0, (Math.sqrt(gx * gx + gy * gy) - 0.05) * 5));
      const f = 1 - k * e;
      const o = (y * W + x) * 3;
      rgb[o] *= f;
      rgb[o + 1] *= f;
      rgb[o + 2] *= f;
    }
  }
}

/**
 * Reduce S x S blocks to one cell.
 *
 * Average (the classic way): the mean colour. With `dark` > 0 the cell leans
 * towards the mean of its darkest quarter, so a thin dark line through a cell
 * (an eye, a mouth, a whisker) still darkens it instead of being averaged away.
 *
 * Main colour (`main`): a cell that straddles an edge takes the colour of the
 * larger side instead of a blend of both. Blends are colours that exist on
 * neither side, so they add muddy in-between cells along every edge and use up
 * palette colours. The samples are split into two groups in OKLab; if the
 * groups are nearly the same colour the cell is just averaged, so smooth areas
 * stay smooth. `dark` makes the darker side win close calls.
 *
 * Samples flagged in `cover` (removed background) are ignored unless the whole
 * cell is removed. `importance` (per cell, 0..1) raises `dark` for cells marked
 * as detail, so an eye keeps its darkness even with the slider low.
 */
export function downsample(
  rgb: Float32Array,
  W: number,
  H: number,
  S: number,
  dark: number,
  main = false,
  cover: Float32Array | null = null,
  importance: Float32Array | null = null,
): Float32Array {
  const w = W / S;
  const h = H / S;
  const out = new Float32Array(w * h * 3);
  const lab = main ? bufferToOklab(rgb) : null;
  const all = new Int32Array(S * S);
  const assign = new Uint8Array(S * S);
  const baseDark = dark;
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const dark = importance ? Math.min(1, baseDark + importance[gy * w + gx] * (1 - baseDark) * 0.6) : baseDark;
      let count = 0;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const p = (gy * S + y) * W + gx * S + x;
          if (!cover || cover[p] < 0.5) all[count++] = p;
        }
      }
      if (count === 0) {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) all[count++] = (gy * S + y) * W + gx * S + x;
      }
      const idx = all.subarray(0, count);
      const o = (gy * w + gx) * 3;
      if (lab && count >= 3 && mainColour(rgb, lab, idx, assign, dark, out, o)) continue;
      averageCell(rgb, idx, dark, out, o);
    }
  }
  return out;
}

function averageCell(rgb: Float32Array, idx: Int32Array, dark: number, out: Float32Array, o: number): void {
  const count = idx.length;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let k = 0; k < count; k++) {
    const p = idx[k] * 3;
    r += rgb[p];
    g += rgb[p + 1];
    b += rgb[p + 2];
  }
  r /= count;
  g /= count;
  b /= count;
  if (dark > 0) {
    const keep = Math.max(1, Math.ceil(count / 4));
    const order = Array.from(idx).sort((p, q) => lum(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) - lum(rgb[q * 3], rgb[q * 3 + 1], rgb[q * 3 + 2]));
    let dr = 0;
    let dg = 0;
    let db = 0;
    for (let i = 0; i < keep; i++) {
      const p = order[i] * 3;
      dr += rgb[p];
      dg += rgb[p + 1];
      db += rgb[p + 2];
    }
    r += (dr / keep - r) * dark;
    g += (dg / keep - g) * dark;
    b += (db / keep - b) * dark;
  }
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}

/** Two-group split of a cell's samples; writes the bigger group's mean colour. False if the cell is uniform. */
function mainColour(rgb: Float32Array, lab: Float32Array, idx: Int32Array, assign: Uint8Array, dark: number, out: Float32Array, o: number): boolean {
  const count = idx.length;
  // Start from the darkest and lightest samples.
  let lo = idx[0];
  let hi = idx[0];
  for (let k = 1; k < count; k++) {
    const p = idx[k];
    if (lab[p * 3] < lab[lo * 3]) lo = p;
    if (lab[p * 3] > lab[hi * 3]) hi = p;
  }
  const c = [lab[lo * 3], lab[lo * 3 + 1], lab[lo * 3 + 2], lab[hi * 3], lab[hi * 3 + 1], lab[hi * 3 + 2]];
  const d2 = () => (c[0] - c[3]) ** 2 + (c[1] - c[4]) ** 2 + (c[2] - c[5]) ** 2;
  // OKLab distance under ~0.07 reads as "the same colour, a little textured".
  const SAME = 0.07 * 0.07;
  if (d2() < SAME) return false;
  let n0 = 0;
  for (let it = 0; it < 5; it++) {
    const sum = [0, 0, 0, 0, 0, 0];
    n0 = 0;
    for (let k = 0; k < count; k++) {
      const p = idx[k] * 3;
      const e0 = (lab[p] - c[0]) ** 2 + (lab[p + 1] - c[1]) ** 2 + (lab[p + 2] - c[2]) ** 2;
      const e1 = (lab[p] - c[3]) ** 2 + (lab[p + 1] - c[4]) ** 2 + (lab[p + 2] - c[5]) ** 2;
      const g = e0 <= e1 ? 0 : 1;
      assign[k] = g;
      if (!g) n0++;
      sum[g * 3] += lab[p];
      sum[g * 3 + 1] += lab[p + 1];
      sum[g * 3 + 2] += lab[p + 2];
    }
    const n1 = count - n0;
    if (!n0 || !n1) return false;
    for (let j = 0; j < 3; j++) {
      c[j] = sum[j] / n0;
      c[3 + j] = sum[3 + j] / n1;
    }
  }
  if (d2() < SAME) return false;
  // Group 0 started from the darkest sample, so it is the darker side.
  const pick = n0 * (1 + 2 * dark) >= count - n0 ? 0 : 1;
  let r = 0;
  let g = 0;
  let b = 0;
  let m = 0;
  for (let k = 0; k < count; k++) {
    if (assign[k] !== pick) continue;
    const p = idx[k] * 3;
    r += rgb[p];
    g += rgb[p + 1];
    b += rgb[p + 2];
    m++;
  }
  out[o] = r / m;
  out[o + 1] = g / m;
  out[o + 2] = b / m;
  return true;
}
