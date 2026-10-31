import type { Rng } from './rng';

export type Center = [number, number, number];

function dist2(p: Float32Array, i: number, c: Center): number {
  const dr = p[i] - c[0];
  const dg = p[i + 1] - c[1];
  const db = p[i + 2] - c[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * k-means colour quantisation with k-means++ seeding.
 * `points` holds n*3 floats in 0..1. Returns centres sorted lightest first.
 */
export function kmeans(points: Float32Array, k: number, rng: Rng, iterations = 20): { centers: Center[]; labels: number[] } {
  const n = points.length / 3;
  if (n === 0) return { centers: [], labels: [] };
  k = Math.max(1, Math.min(k, n));

  // Count distinct colours (quantised a little) so we never ask for more clusters than exist.
  const distinct = new Set<number>();
  for (let i = 0; i < n && distinct.size <= k; i++) {
    const key = (Math.round(points[i * 3] * 31) << 10) | (Math.round(points[i * 3 + 1] * 31) << 5) | Math.round(points[i * 3 + 2] * 31);
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
  const order = centers.map((c, i) => ({ i, l: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] })).sort((a, b) => b.l - a.l);
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
export function ditherAssign(points: Float32Array, w: number, h: number, palette: Center[], skip?: Uint8Array | null): number[] {
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
      const er = r - palette[best][0];
      const eg = g - palette[best][1];
      const eb = b - palette[best][2];
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
