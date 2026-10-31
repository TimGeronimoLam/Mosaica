/**
 * Geometry of the photo transform: quarter turns, mirroring and a fine
 * "straighten" rotation. Everything is a 2D affine map in canvas order
 * [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */

export type Affine = [number, number, number, number, number, number];

export interface PhotoTransform {
  /** Quarter turns clockwise (any integer; taken mod 4). */
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  /** Degrees clockwise, -45..45. */
  straighten: number;
}

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** a ∘ b: apply b first, then a. */
export function multiply(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Uniform scale factor of a similarity transform. */
export function scaleOf(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export function scaling(sx: number, sy: number = sx): Affine {
  return [sx, 0, 0, sy, 0, 0];
}

function translation(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

function rotation(deg: number): Affine {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function quarterTurns(t: Pick<PhotoTransform, 'rotate'>): number {
  return ((Math.round(t.rotate) % 4) + 4) % 4;
}

/**
 * Zoom needed after rotating a w x h picture by `deg` so that a w x h window
 * still fits inside it (no blank corners).
 */
export function straightenZoom(w: number, h: number, deg: number): number {
  const r = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const k = Math.min(w / (w * c + h * s), h / (w * s + h * c));
  return 1 / k;
}

/**
 * The map from the original picture (w x h) to the transformed one, and the
 * transformed size. Quarter turns swap width and height; straightening keeps
 * the size and zooms in just enough to hide the corners.
 */
export function transformFor(w: number, h: number, t: PhotoTransform): { m: Affine; width: number; height: number } {
  const q = quarterTurns(t);
  const width = q % 2 ? h : w;
  const height = q % 2 ? w : h;
  const turns: Affine[] = [
    IDENTITY,
    [0, 1, -1, 0, h, 0],
    [-1, 0, 0, -1, w, h],
    [0, -1, 1, 0, 0, w],
  ];
  let m = turns[q];
  if (t.flipH) m = multiply([-1, 0, 0, 1, width, 0], m);
  if (t.flipV) m = multiply([1, 0, 0, -1, 0, height], m);
  if (t.straighten) {
    const z = straightenZoom(width, height, t.straighten);
    const centre = translation(width / 2, height / 2);
    const back = translation(-width / 2, -height / 2);
    m = multiply(centre, multiply(rotation(t.straighten), multiply(scaling(z), multiply(back, m))));
  }
  return { m, width, height };
}

/** Width / height of the picture after the transform. */
export function transformedAspect(w: number, h: number, t: Pick<PhotoTransform, 'rotate'>): number {
  return quarterTurns(t) % 2 ? h / w : w / h;
}

/**
 * Changes that rotate or mirror what the user currently sees. A turn while the
 * picture is mirrored has to go the other way round in the underlying
 * rotate-then-flip order, and mirroring flips the straighten angle. The crop
 * centre follows the picture.
 */
export function rotateView<T extends PhotoTransform & { cx: number; cy: number }>(s: T, dir: 1 | -1): Partial<T> {
  const mirrored = s.flipH !== s.flipV;
  return {
    rotate: (quarterTurns(s) + (mirrored ? -dir : dir) + 4) % 4,
    cx: dir === 1 ? 1 - s.cy : s.cy,
    cy: dir === 1 ? s.cx : 1 - s.cx,
  } as Partial<T>;
}

export function flipView<T extends PhotoTransform & { cx: number; cy: number }>(s: T, axis: 'h' | 'v'): Partial<T> {
  const straighten = s.straighten ? -s.straighten : 0;
  return (axis === 'h' ? { flipH: !s.flipH, cx: 1 - s.cx, straighten } : { flipV: !s.flipV, cy: 1 - s.cy, straighten }) as Partial<T>;
}
