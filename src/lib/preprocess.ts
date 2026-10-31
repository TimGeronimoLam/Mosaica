import type { MosaicSettings } from '../types';
import { clamp01, cropRect, type SourceRaster } from './image';

/** Cell colours (w*h*3, sRGB 0..1) plus which cells were removed as background. */
export interface Sampled {
  rgb: Float32Array;
  removed: Uint8Array | null;
}

export type CleanupSettings = Pick<
  MosaicSettings,
  'zoom' | 'cx' | 'cy' | 'brightness' | 'contrast' | 'saturation' | 'autoLevels' | 'localContrast' | 'smooth' | 'darkDetails' | 'outlines'
>;

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Turn the crop of the (transformed) photo into one colour per cell.
 *
 * Filters that look at neighbourhoods (even lighting, simplify, outlines, dark
 * details) need to see inside each cell, so the crop is first resampled at up
 * to 4x4 pixels per cell, filtered, and then reduced to cells. With all of
 * them off, each cell is a plain average of its source pixels.
 *
 * `mask` (same size as the photo, 1 = background) marks cells to leave blank.
 */
export function sampleGrid(src: SourceRaster, w: number, h: number, s: CleanupSettings, mask?: Uint8Array | null): Sampled {
  const rect = cropRect(src, w, h, s);
  const detail = s.localContrast > 0 || s.smooth > 0 || s.darkDetails > 0 || s.outlines > 0;
  const S = detail ? Math.max(1, Math.min(4, Math.floor(Math.min(rect.w / w, rect.h / h)))) : 1;
  const W = w * S;
  const H = h * S;
  const { rgb, cover } = resampleArea(src, rect, W, H, mask ?? null);
  tone(rgb, cover, s);
  if (s.localContrast > 0) evenLighting(rgb, W, H, s.localContrast / 100, cover);
  if (s.smooth > 0) kuwahara(rgb, W, H, Math.max(1, Math.round((s.smooth / 100) * 1.5 * S)));
  if (s.outlines > 0) drawOutlines(rgb, W, H, s.outlines / 100, Math.max(1, Math.round(S / 2)));
  for (let i = 0; i < rgb.length; i++) rgb[i] = clamp01(rgb[i]);
  const out = S === 1 ? rgb : downsample(rgb, W, H, S, s.darkDetails / 100);
  let removed: Uint8Array | null = null;
  if (cover) {
    removed = new Uint8Array(w * h);
    let any = false;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        let c = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) c += cover[(gy * S + y) * W + gx * S + x];
        if (c / (S * S) >= 0.5) {
          removed[gy * w + gx] = 1;
          any = true;
        }
      }
    }
    if (!any) removed = null;
  }
  return { rgb: out, removed };
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
      for (let y = y0; y < y1 && y < src.height; y++) {
        let i = (y * sw + x0) * 4;
        for (let x = x0; x < x1 && x < sw; x++) {
          const a = data[i + 3] / 255;
          r += data[i] * a + 255 * (1 - a);
          g += data[i + 1] * a + 255 * (1 - a);
          b += data[i + 2] * a + 255 * (1 - a);
          if (mask) m += mask[y * sw + x];
          n++;
          i += 4;
        }
      }
      if (n === 0) n = 1;
      const o = (gy * W + gx) * 3;
      rgb[o] = r / n / 255;
      rgb[o + 1] = g / n / 255;
      rgb[o + 2] = b / n / 255;
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
 * Reduce S x S blocks to one cell. With `dark` > 0 the cell leans towards
 * the mean of its darkest quarter, so a thin dark line through a cell (an eye,
 * a mouth, a whisker) still darkens it instead of being averaged away.
 */
export function downsample(rgb: Float32Array, W: number, H: number, S: number, dark: number): Float32Array {
  const w = W / S;
  const h = H / S;
  const out = new Float32Array(w * h * 3);
  const count = S * S;
  const keep = Math.max(1, Math.ceil(count / 4));
  const ls = new Float32Array(count);
  const idx = new Array<number>(count);
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let k = 0;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const o = ((gy * S + y) * W + gx * S + x) * 3;
          r += rgb[o];
          g += rgb[o + 1];
          b += rgb[o + 2];
          ls[k] = lum(rgb[o], rgb[o + 1], rgb[o + 2]);
          idx[k] = o;
          k++;
        }
      }
      r /= count;
      g /= count;
      b /= count;
      if (dark > 0) {
        const order = idx.map((_, i) => i).sort((p, q) => ls[p] - ls[q]);
        let dr = 0;
        let dg = 0;
        let db = 0;
        for (let i = 0; i < keep; i++) {
          const o = idx[order[i]];
          dr += rgb[o];
          dg += rgb[o + 1];
          db += rgb[o + 2];
        }
        r += (dr / keep - r) * dark;
        g += (dg / keep - g) * dark;
        b += (db / keep - b) * dark;
      }
      const o = (gy * w + gx) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}
