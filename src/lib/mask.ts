import { boxBlur } from './preprocess';
import { apply, type Affine } from './transform';

/**
 * Parts of the photo marked as background. Stored in the coordinates of the
 * original, untransformed picture so it keeps lining up when the photo is
 * rotated, mirrored or straightened later. 1 = removed (left as blank paper).
 */
export interface PhotoMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The mask as saved in the database and in exports (run-length encoded). */
export interface StoredMask {
  width: number;
  height: number;
  rle: string;
}

/** RGBA pixels; the same shape as SourceRaster. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Longest side of the mask grid. Brushes and the wand work at this resolution. */
export const MASK_MAX = 640;

export function maskSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const scale = Math.min(1, MASK_MAX / Math.max(naturalWidth, naturalHeight));
  return { width: Math.max(1, Math.round(naturalWidth * scale)), height: Math.max(1, Math.round(naturalHeight * scale)) };
}

/** The mask resampled to another size (nearest pixel); the same mask if the size already matches. */
export function resizeMask(m: PhotoMask, width: number, height: number): PhotoMask {
  if (m.width === width && m.height === height) return m;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(m.height - 1, Math.floor(((y + 0.5) * m.height) / height));
    for (let x = 0; x < width; x++) data[y * width + x] = m.data[sy * m.width + Math.min(m.width - 1, Math.floor(((x + 0.5) * m.width) / width))];
  }
  return { width, height, data };
}

export function emptyMask(width: number, height: number): PhotoMask {
  return { width, height, data: new Uint8Array(width * height) };
}

export function maskCoverage(m: PhotoMask | null): number {
  if (!m) return 0;
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i];
  return n / m.data.length;
}

/** Null for a mask with nothing removed, so "no mask" has one representation. */
export function normalizeMask(m: PhotoMask | null): PhotoMask | null {
  return m && maskCoverage(m) > 0 ? m : null;
}

export function encodeMask(m: PhotoMask): StoredMask {
  const runs: string[] = [];
  let cur = 0;
  let run = 0;
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i] ? 1 : 0;
    if (v === cur) run++;
    else {
      runs.push(run.toString(36));
      cur = v;
      run = 1;
    }
  }
  runs.push(run.toString(36));
  return { width: m.width, height: m.height, rle: runs.join('.') };
}

export function decodeMask(s: StoredMask): PhotoMask {
  const data = new Uint8Array(s.width * s.height);
  let i = 0;
  let v = 0;
  for (const part of s.rle.split('.')) {
    const n = parseInt(part, 36) || 0;
    if (v) data.fill(1, i, Math.min(data.length, i + n));
    i += n;
    v = 1 - v;
  }
  return { width: s.width, height: s.height, data };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Paint a round-capped line of radius r into `data` (mutated). Coordinates are
 * mask pixels. Returns the box of pixels that may have changed.
 */
export function paintSegment(data: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, r: number, value: 0 | 1): Box | null {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
  if (x0 > x1 || y0 > y1) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - px;
      const ey = ay + dy * t - py;
      if (ex * ex + ey * ey <= r2) data[y * w + x] = value;
    }
  }
  return { x0, y0, x1, y1 };
}

const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/**
 * CIE Lab copy of the picture, lightly blurred (5x5) so flood fills ignore
 * texture and sensor noise. Lab distances match how different colours look,
 * so skin is not mistaken for a grey wall the way plain RGB distances can.
 */
function labImage(src: Rgba): Float32Array {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = LINEAR[Math.round(data[i * 4] * a + 255 * (1 - a))];
    const g = LINEAR[Math.round(data[i * 4 + 1] * a + 255 * (1 - a))];
    const b = LINEAR[Math.round(data[i * 4 + 2] * a + 255 * (1 - a))];
    const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    ch[0][i] = 116 * fy - 16;
    ch[1][i] = 500 * (fx - fy);
    ch[2][i] = 200 * (fy - fz);
  }
  const out = new Float32Array(n * 3);
  ch.forEach((c, k) => {
    const blurred = boxBlur(c, w, h, 2);
    for (let i = 0; i < n; i++) out[i * 3 + k] = blurred[i];
  });
  return out;
}

/** Colour difference (ΔE, with lightness counting a little less so soft shadows on a backdrop stay together). */
function dist(a: Float32Array, i: number, b: Float32Array, j: number): number {
  const dl = (a[i] - b[j]) * 0.75;
  const da = a[i + 1] - b[j + 1];
  const db = a[i + 2] - b[j + 2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Colour difference allowed for a tolerance of 0..100. */
function toleranceDistance(tolerance: number): number {
  return 3 + (Math.max(0, Math.min(100, tolerance)) / 100) * 45;
}

/**
 * Flood from the seed pixels. A pixel joins when it is close to the colour of
 * the seed it was reached from, and close to the neighbour it was reached
 * from (so soft gradients are followed but strong edges stop the fill).
 */
function flood(lab: Float32Array, w: number, h: number, seeds: number[], refs: Float32Array, tolerance: number): Uint8Array {
  const n = w * h;
  const t = toleranceDistance(tolerance);
  const step = t * 0.5;
  const out = new Uint8Array(n);
  const ref = new Float32Array(n * 3);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  seeds.forEach((s, k) => {
    if (out[s]) return;
    out[s] = 1;
    ref[s * 3] = refs[k * 3];
    ref[s * 3 + 1] = refs[k * 3 + 1];
    ref[s * 3 + 2] = refs[k * 3 + 2];
    queue[tail++] = s;
  });
  while (head < tail) {
    const p = queue[head++];
    const px = p % w;
    const py = (p - px) / w;
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? px + 1 : k === 1 ? px - 1 : px;
      const ny = k === 2 ? py + 1 : k === 3 ? py - 1 : py;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (out[q]) continue;
      if (dist(lab, q * 3, ref, p * 3) > t || dist(lab, q * 3, lab, p * 3) > step) continue;
      out[q] = 1;
      ref[q * 3] = ref[p * 3];
      ref[q * 3 + 1] = ref[p * 3 + 1];
      ref[q * 3 + 2] = ref[p * 3 + 2];
      queue[tail++] = q;
    }
  }
  return out;
}

/** Magic wand: the connected area of similar colour around (x, y), in mask pixels. */
export function selectSimilar(src: Rgba, x: number, y: number, tolerance: number): Uint8Array {
  const { width: w, height: h } = src;
  const sx = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const lab = labImage(src);
  const seed = sy * w + sx;
  return flood(lab, w, h, [seed], lab.slice(seed * 3, seed * 3 + 3), tolerance);
}

/**
 * One-click background: flood inwards from the top edge and the upper part of
 * the sides, seeded only from colours that are common there. Subjects of
 * photos usually stand on or run off the bottom edge (shoulders, a sitting
 * pet), so seeding there would eat the subject; a backdrop that does reach the
 * bottom is still found by flooding round from the top.
 */
export function selectBackground(src: Rgba, tolerance: number): Uint8Array {
  const { width: w, height: h } = src;
  const lab = labImage(src);
  const border: number[] = [];
  const stride = Math.max(1, Math.round((w + h) / 600));
  const sideEnd = Math.round(h * 0.6);
  for (let x = 0; x < w; x += stride) border.push(x);
  for (let y = stride; y < sideEnd; y += stride) border.push(y * w, y * w + w - 1);
  const t = toleranceDistance(tolerance);
  const minShare = 0.1 * border.length;
  const seeds: number[] = [];
  const refs: number[] = [];
  for (const p of border) {
    let near = 0;
    for (const q of border) if (dist(lab, p * 3, lab, q * 3) <= t) near++;
    if (near >= minShare) {
      seeds.push(p);
      refs.push(lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]);
    }
  }
  if (!seeds.length) return new Uint8Array(w * h);
  return flood(lab, w, h, seeds, Float32Array.from(refs), tolerance);
}

/** Set (value 1) or clear (value 0) every pixel of `region` in the mask. */
export function combineMask(m: PhotoMask | null, region: Uint8Array, value: 0 | 1, width: number, height: number): PhotoMask {
  const data = m ? m.data.slice() : new Uint8Array(width * height);
  for (let i = 0; i < region.length; i++) if (region[i]) data[i] = value;
  return { width: m?.width ?? width, height: m?.height ?? height, data };
}

export function invertMask(m: PhotoMask | null, width: number, height: number): PhotoMask {
  const src = m ?? emptyMask(width, height);
  const data = new Uint8Array(src.data.length);
  for (let i = 0; i < data.length; i++) data[i] = src.data[i] ? 0 : 1;
  return { width: src.width, height: src.height, data };
}

/**
 * Resample the mask into the transformed picture (outW x outH), where
 * `toMask` maps transformed pixels to mask pixels. Nearest neighbour.
 */
export function transformMask(m: PhotoMask, toMask: Affine, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH);
  forEachMapped(m, toMask, outW, { x0: 0, y0: 0, x1: outW - 1, y1: outH - 1 }, (i, v) => {
    out[i] = v;
  });
  return out;
}

/**
 * Draw the removed areas as faded paper with diagonal stripes into an RGBA
 * buffer the size of the transformed picture. Only `box` is redrawn.
 */
export function renderMaskOverlay(rgba: Uint8ClampedArray, outW: number, m: PhotoMask | null, toMask: Affine, box: Box): void {
  if (!m) {
    for (let y = box.y0; y <= box.y1; y++) rgba.fill(0, (y * outW + box.x0) * 4, (y * outW + box.x1 + 1) * 4);
    return;
  }
  forEachMapped(m, toMask, outW, box, (i, v) => {
    const o = i * 4;
    if (!v) {
      rgba[o + 3] = 0;
      return;
    }
    const x = i % outW;
    const y = (i - x) / outW;
    const stripe = (x + y) % 14 < 3;
    rgba[o] = stripe ? 228 : 255;
    rgba[o + 1] = stripe ? 87 : 255;
    rgba[o + 2] = stripe ? 46 : 255;
    rgba[o + 3] = stripe ? 200 : 190;
  });
}

function forEachMapped(m: PhotoMask, toMask: Affine, outW: number, box: Box, cb: (i: number, v: number) => void): void {
  const { width: mw, height: mh, data } = m;
  const [a, b] = [toMask[0], toMask[1]];
  for (let y = box.y0; y <= box.y1; y++) {
    let [mx, my] = apply(toMask, box.x0 + 0.5, y + 0.5);
    for (let x = box.x0; x <= box.x1; x++) {
      const ix = Math.floor(mx);
      const iy = Math.floor(my);
      cb(y * outW + x, ix >= 0 && iy >= 0 && ix < mw && iy < mh ? data[iy * mw + ix] : 0);
      mx += a;
      my += b;
    }
  }
}
