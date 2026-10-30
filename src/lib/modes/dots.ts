import type { DotLoop, DotsPuzzle, PixelGrid } from '../../types';

export interface DotsOptions {
  /** Simplification tolerance in cells; bigger = fewer dots. */
  detail: number;
  /** Ignore regions (or holes) smaller than this many cells. */
  minRegion: number;
  maxDots: number;
  /** Split straight runs so no two consecutive dots are further apart than this (cells). */
  maxGap: number;
}

type Pt = [number, number];

/** Trace the boundaries between inked and empty cells as closed loops of lattice points. */
export function traceContours(grid: PixelGrid): Pt[][] {
  const { width: w, height: h, cells } = grid;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === 1;
  const key = (x: number, y: number) => y * (w + 1) + x;
  const out = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = out.get(k);
    if (list) list.push(key(x1, y1));
    else out.set(k, [key(x1, y1)]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add(x, y, x + 1, y);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const toPt = (k: number): Pt => [k % (w + 1), Math.floor(k / (w + 1))];
  const loops: Pt[][] = [];
  for (const [startKey, targets] of out) {
    while (targets.length) {
      const loop: Pt[] = [];
      let cur = startKey;
      let prev = -1;
      for (;;) {
        const outs = out.get(cur);
        if (!outs || outs.length === 0) break;
        let pick = 0;
        if (outs.length > 1 && prev >= 0) {
          // At a pinch point prefer the sharpest right turn so regions stay separate.
          const [px, py] = toPt(prev);
          const [cx, cy] = toPt(cur);
          const dinx = cx - px;
          const diny = cy - py;
          let bestCross = -Infinity;
          outs.forEach((t, idx) => {
            const [tx, ty] = toPt(t);
            const cross = dinx * (ty - cy) - diny * (tx - cx);
            if (cross > bestCross) {
              bestCross = cross;
              pick = idx;
            }
          });
        }
        const next = outs[pick];
        outs.splice(pick, 1);
        loop.push(toPt(cur));
        prev = cur;
        cur = next;
        if (cur === startKey) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = douglasPeucker(pts.slice(0, idx + 1), eps);
    const right = douglasPeucker(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

/** Simplify a closed polygon, returning its vertices without repeating the first. */
export function simplifyClosed(pts: Pt[], eps: number): Pt[] {
  if (pts.length <= 3) return pts;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = douglasPeucker(pts.slice(0, far + 1), eps);
  const b = douglasPeucker(pts.slice(far).concat([pts[0]]), eps);
  const merged = a.slice(0, -1).concat(b.slice(0, -1));
  // Drop collinear leftovers.
  const result: Pt[] = [];
  for (let i = 0; i < merged.length; i++) {
    const p = merged[(i - 1 + merged.length) % merged.length];
    const c = merged[i];
    const q = merged[(i + 1) % merged.length];
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (Math.abs(cross) > 1e-9) result.push(c);
  }
  return result.length >= 3 ? result : merged;
}

export function generateDots(grid: PixelGrid, opts: DotsOptions): DotsPuzzle {
  const raw = traceContours(grid).filter((l) => Math.abs(signedArea(l)) >= Math.max(1, opts.minRegion));
  raw.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

  let eps = Math.max(0.2, opts.detail);
  let gap = Math.max(1, opts.maxGap);
  let simplified: Pt[][] = [];
  for (let attempt = 0; attempt < 14; attempt++) {
    simplified = raw
      .map((l) => subdivide(simplifyClosed(l, eps), gap))
      .filter((l) => l.length >= 3);
    const total = simplified.reduce((s, l) => s + l.length, 0);
    if (total <= opts.maxDots) break;
    eps *= 1.25;
    gap *= 1.25;
  }

  const loops: DotLoop[] = [];
  let counter = 1;
  for (const pts of simplified) {
    // Start each loop at its top-most (then left-most) point.
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][1] < pts[s][1] || (pts[i][1] === pts[s][1] && pts[i][0] < pts[s][0])) s = i;
    }
    const ordered = pts.slice(s).concat(pts.slice(0, s));
    const normals: Pt[] = ordered.map((p, i) => {
      const prev = ordered[(i - 1 + ordered.length) % ordered.length];
      const next = ordered[(i + 1) % ordered.length];
      // Boundaries are traced with ink on the right, so "outward" is the left normal.
      const n1 = leftNormal(prev, p);
      const n2 = leftNormal(p, next);
      let nx = n1[0] + n2[0];
      let ny = n1[1] + n2[1];
      const len = Math.hypot(nx, ny);
      if (len < 1e-6) {
        nx = n2[0];
        ny = n2[1];
      } else {
        nx /= len;
        ny /= len;
      }
      return [nx, ny];
    });
    loops.push({ points: ordered, normals, start: counter });
    counter += ordered.length;
  }
  return { kind: 'dots', width: grid.width, height: grid.height, loops, total: counter - 1 };
}

/** Insert evenly spaced dots along edges longer than `maxGap`. */
export function subdivide(pts: Pt[], maxGap: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.ceil(len / maxGap);
    for (let k = 1; k < parts; k++) {
      const t = k / parts;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function leftNormal(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
}
