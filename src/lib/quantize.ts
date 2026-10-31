import type { Rng } from './rng';

export type Center = [number, number, number];

function dist2(p: Float32Array, i: number, c: Center): number {
  const dr = p[i] - c[0];
  const dg = p[i + 1] - c[1];
  const db = p[i + 2] - c[2];
  return dr * dr + dg * dg + db * db;
}

const luma = (c: Center) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * k-means colour quantisation with k-means++ seeding.
 * `points` holds n*3 floats, either sRGB 0..1 or OKLab (then pass
 * `lightness: c => c[0]`). Returns centres sorted lightest first.
 */
export function kmeans(
  points: Float32Array,
  k: number,
  rng: Rng,
  iterations = 20,
  lightness: (c: Center) => number = luma,
): { centers: Center[]; labels: number[] } {
  const n = points.length / 3;
  if (n === 0) return { centers: [], labels: [] };
  k = Math.max(1, Math.min(k, n));

  // Count distinct colours (quantised a little) so we never ask for more clusters than exist.
  const distinct = new Set<number>();
  for (let i = 0; i < n && distinct.size <= k; i++) {
    // 7 bits per channel, offset so negative OKLab a/b values work too.
    const q = (v: number) => Math.round(v * 31) + 64;
    const key = (q(points[i * 3]) << 14) | (q(points[i * 3 + 1]) << 7) | q(points[i * 3 + 2]);
    distinct.add(key);
  }
  k = Math.min(k, distinct.size);

  // k-means++ initialisation
  const centers: Center[] = [];
  const first = rng.int(n) * 3;
  centers.push([points[first], points[first + 1], points[first + 2]]);
  const d = new Float32Array(n).fill(Infinity);
  while (centers.length < k) {
    let total = 0;
    const last = centers[centers.length - 1];
    for (let i = 0; i < n; i++) {
      const v = dist2(points, i * 3, last);
      if (v < d[i]) d[i] = v;
      total += d[i];
    }
    if (total === 0) break;
    let r = rng.next() * total;
    let idx = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centers.push([points[idx * 3], points[idx * 3 + 1], points[idx * 3 + 2]]);
  }

  const labels = new Array<number>(n).fill(0);
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const v = dist2(points, i * 3, centers[c]);
        if (v < bestD) {
          bestD = v;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[labels[i]];
      s[0] += points[i * 3];
      s[1] += points[i * 3 + 1];
      s[2] += points[i * 3 + 2];
      s[3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      const s = sums[c];
      if (s[3] > 0) {
        centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      } else {
        // Empty cluster: move it to the point farthest from its centre.
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const v = dist2(points, i * 3, centers[labels[i]]);
          if (v > farD) {
            farD = v;
            far = i;
          }
        }
        centers[c] = [points[far * 3], points[far * 3 + 1], points[far * 3 + 2]];
        changed = true;
      }
    }
    if (!changed && it > 0) break;
  }

  // Sort lightest first and remap labels.
  const order = centers.map((c, i) => ({ i, l: lightness(c) })).sort((a, b) => b.l - a.l);
  const remap = new Array<number>(centers.length);
  order.forEach((o, newIndex) => (remap[o.i] = newIndex));
  return {
    centers: order.map((o) => centers[o.i]),
    labels: labels.map((l) => remap[l]),
  };
}

/**
 * Nearest palette index for each point, with Floyd–Steinberg error diffusion.
 * Cells flagged in `skip` get index 0 and neither take nor pass on error.
 */
export function ditherAssign(points: Float32Array, w: number, h: number, palette: Center[], skip?: Uint8Array | null, amount = 1): number[] {
  const buf = Float32Array.from(points);
  const labels = new Array<number>(w * h).fill(0);
  const add = (x: number, y: number, er: number, eg: number, eb: number, f: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h || skip?.[y * w + x]) return;
    const o = (y * w + x) * 3;
    buf[o] += er * f;
    buf[o + 1] += eg * f;
    buf[o + 2] += eb * f;
  };
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      if (skip?.[y * w + x]) continue;
      const o = (y * w + x) * 3;
      const r = buf[o];
      const g = buf[o + 1];
      const b = buf[o + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const dr = r - palette[c][0];
        const dg = g - palette[c][1];
        const db = b - palette[c][2];
        const v = dr * dr + dg * dg + db * db;
        if (v < bestD) {
          bestD = v;
          best = c;
        }
      }
      labels[y * w + x] = best;
      const er = (r - palette[best][0]) * amount;
      const eg = (g - palette[best][1]) * amount;
      const eb = (b - palette[best][2]) * amount;
      const dir = ltr ? 1 : -1;
      add(x + dir, y, er, eg, eb, 7 / 16);
      add(x - dir, y + 1, er, eg, eb, 3 / 16);
      add(x, y + 1, er, eg, eb, 5 / 16);
      add(x + dir, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return labels;
}

/** Nearest palette index without dithering. */
export function nearestAssign(points: Float32Array, palette: Center[]): number[] {
  const n = points.length / 3;
  const labels = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const v = dist2(points, i * 3, palette[c]);
      if (v < bestD) {
        bestD = v;
        best = c;
      }
    }
    labels[i] = best;
  }
  return labels;
}

/** 4x4 Bayer matrix, values 0..15. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Threshold offset in -0.5..0.5 for an ordered-dither pattern at (x, y). */
export function bayer(x: number, y: number): number {
  return (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
}

/**
 * Ordered ("pattern") dithering: nudge each cell's lightness by a fixed
 * checkerboard-like pattern before picking the nearest colour. Gradients turn
 * into regular, easy-to-colour textures instead of random speckle. Expects
 * OKLab points and palette (lightness in channel 0). Cells in `skip` get 0.
 */
export function orderedAssign(points: Float32Array, w: number, h: number, palette: Center[], skip: Uint8Array | null | undefined, amount: number): number[] {
  // Nudge by about the typical lightness step between neighbouring palette colours.
  const ls = palette.map((c) => c[0]).sort((a, b) => a - b);
  let step = 0;
  for (let i = 1; i < ls.length; i++) step += ls[i] - ls[i - 1];
  step = ls.length > 1 ? step / (ls.length - 1) : 0;
  const labels = new Array<number>(w * h).fill(0);
  const p = new Float32Array(3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (skip?.[i]) continue;
      p[0] = points[i * 3] + bayer(x, y) * step * 1.5 * amount;
      p[1] = points[i * 3 + 1];
      p[2] = points[i * 3 + 2];
      labels[i] = nearestAssign(p, palette)[0];
    }
  }
  return labels;
}

/**
 * k-means run from several k-means++ starts, keeping the palette with the
 * least total error. One run can settle in a poor local optimum that merges a
 * small but distinctive colour (an orange crema, blue eyes) into a bigger one.
 */
export function kmeansBest(points: Float32Array, k: number, rng: Rng, restarts: number, lightness: (c: Center) => number): { centers: Center[]; labels: number[] } {
  let best: { centers: Center[]; labels: number[] } | null = null;
  let bestErr = Infinity;
  for (let r = 0; r < restarts; r++) {
    const run = kmeans(points, k, rng, 20, lightness);
    let err = 0;
    for (let i = 0; i < run.labels.length; i++) err += dist2(points, i * 3, run.centers[run.labels[i]]);
    if (err < bestErr) {
      bestErr = err;
      best = run;
    }
  }
  return best!;
}
