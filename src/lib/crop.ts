/**
 * The crop: which part of the (rotated, straightened) photo becomes the
 * puzzle. Stored as fractions 0..1 of the photo's width and height so it does
 * not depend on resolution. Any shape is allowed; the grid takes the crop's
 * shape unless the user fixes the grid size, in which case the crop keeps the
 * grid's shape.
 */

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle in pixels. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropRatio = 'free' | 'photo' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16';

/** Crop shapes offered in the editor, in menu order (labels live in the i18n messages). */
export const CROP_RATIOS: CropRatio[] = ['free', 'photo', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];

export const FULL_CROP: CropBox = { x: 0, y: 0, w: 1, h: 1 };

/** Width / height of the ratio in pixels, or null for a free crop. `photoAspect` is the photo's width / height. */
export function ratioValue(r: CropRatio, photoAspect: number): number | null {
  if (r === 'free') return null;
  if (r === 'photo') return photoAspect;
  const [a, b] = r.split(':').map(Number);
  return a / b;
}

/** Width / height in pixels of a crop on a photo of the given aspect. */
export function boxAspect(c: CropBox, photoAspect: number): number {
  return (c.w * photoAspect) / c.h;
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/** Pixels on a photo of size A x 1 (A = aspect). Working in those units keeps ratios honest. */
function toPx(c: CropBox, A: number) {
  return { x: c.x * A, y: c.y, w: c.w * A, h: c.h };
}

function fromPx(r: { x: number; y: number; w: number; h: number }, A: number): CropBox {
  return { x: r.x / A, y: r.y, w: r.w / A, h: r.h };
}

/** Smallest crop side, as a share of the photo's shorter side. */
const MIN_SIDE = 0.04;

/** The crop reshaped to `ratio` (px width / height), keeping its centre and area and staying on the photo. */
export function withRatio(c: CropBox, ratio: number, A: number): CropBox {
  const p = toPx(c, A);
  const area = p.w * p.h;
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const k = Math.min(1, A / w, 1 / h);
  w *= k;
  h *= k;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  return fromPx({ x: clamp(cx - w / 2, 0, A - w), y: clamp(cy - h / 2, 0, 1 - h), w, h }, A);
}

/** The largest centred crop of a ratio (or the whole photo when free). */
export function largestBox(ratio: number | null, A: number): CropBox {
  return ratio === null ? FULL_CROP : withRatio(FULL_CROP, ratio, A);
}

export function moveBox(c: CropBox, dx: number, dy: number): CropBox {
  return { ...c, x: clamp(c.x + dx, 0, 1 - c.w), y: clamp(c.y + dy, 0, 1 - c.h) };
}

/** Grow (f > 1) or shrink the crop around its centre, keeping its shape. */
export function scaleBox(c: CropBox, f: number, A: number): CropBox {
  const min = (MIN_SIDE * Math.min(A, 1)) / Math.min(c.w * A, c.h);
  const g = clamp(f, min, Math.min(1 / c.w, 1 / c.h));
  const w = c.w * g;
  const h = c.h * g;
  return { x: clamp(c.x + c.w / 2 - w / 2, 0, 1 - w), y: clamp(c.y + c.h / 2 - h / 2, 0, 1 - h), w, h };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * A crop spanned from a fixed anchor point to the pointer (both as fractions),
 * as when drawing a new crop or dragging a corner. With a ratio the larger
 * extent wins, and the crop shrinks to stay on the photo.
 */
export function spanBox(ax: number, ay: number, px: number, py: number, A: number, ratio: number | null): CropBox {
  const min = MIN_SIDE * Math.min(A, 1);
  const a = { x: ax * A, y: ay };
  const p = { x: px * A, y: py };
  const dx = p.x >= a.x ? 1 : -1;
  const dy = p.y >= a.y ? 1 : -1;
  let w = Math.max(min, Math.abs(p.x - a.x));
  let h = Math.max(min, Math.abs(p.y - a.y));
  const maxW = dx > 0 ? A - a.x : a.x;
  const maxH = dy > 0 ? 1 - a.y : a.y;
  if (ratio !== null) {
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    const k = Math.min(1, maxW / w, maxH / h);
    w *= k;
    h *= k;
  } else {
    w = Math.min(w, maxW);
    h = Math.min(h, maxH);
  }
  return fromPx({ x: dx > 0 ? a.x : a.x - w, y: dy > 0 ? a.y : a.y - h, w, h }, A);
}

/** Resize `start` by dragging one of its handles to the pointer (fractions). */
export function dragHandle(start: CropBox, handle: Handle, px: number, py: number, A: number, ratio: number | null): CropBox {
  const s = toPx(start, A);
  const right = s.x + s.w;
  const bottom = s.y + s.h;
  if (handle.length === 2) {
    // Corner: the opposite corner stays put.
    const ax = handle.includes('w') ? right : s.x;
    const ay = handle.includes('n') ? bottom : s.y;
    return spanBox(ax / A, ay, px, py, A, ratio);
  }
  const min = MIN_SIDE * Math.min(A, 1);
  const p = { x: px * A, y: py };
  if (ratio === null) {
    let { x, y, w, h } = s;
    if (handle === 'e') w = clamp(p.x, s.x + min, A) - s.x;
    if (handle === 'w') {
      x = clamp(p.x, 0, right - min);
      w = right - x;
    }
    if (handle === 's') h = clamp(p.y, s.y + min, 1) - s.y;
    if (handle === 'n') {
      y = clamp(p.y, 0, bottom - min);
      h = bottom - y;
    }
    return fromPx({ x, y, w, h }, A);
  }
  // An edge with a fixed ratio: the opposite edge stays, the crop stays centred along it.
  const horizontal = handle === 'e' || handle === 'w';
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  let w: number;
  let h: number;
  if (horizontal) {
    w = Math.max(min, handle === 'e' ? p.x - s.x : right - p.x);
    h = w / ratio;
    const k = Math.min(1, (handle === 'e' ? A - s.x : right) / w, (2 * Math.min(cy, 1 - cy)) / h);
    w *= k;
    h *= k;
    return fromPx({ x: handle === 'e' ? s.x : right - w, y: cy - h / 2, w, h }, A);
  }
  h = Math.max(min, handle === 's' ? p.y - s.y : bottom - p.y);
  w = h * ratio;
  const k = Math.min(1, (handle === 's' ? 1 - s.y : bottom) / h, (2 * Math.min(cx, A - cx)) / w);
  w *= k;
  h *= k;
  return fromPx({ x: cx - w / 2, y: handle === 's' ? s.y : bottom - h, w, h }, A);
}

/** The crop after turning the photo a quarter clockwise (dir 1) or anticlockwise (-1). */
export function rotateBox(c: CropBox, dir: 1 | -1): CropBox {
  return dir === 1 ? { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w };
}

export function flipBox(c: CropBox, axis: 'h' | 'v'): CropBox {
  return axis === 'h' ? { ...c, x: 1 - c.x - c.w } : { ...c, y: 1 - c.y - c.h };
}

export interface FramingSettings {
  crop?: CropBox;
  /** Framing of mosaics made before free cropping: cover-fit zoom and centre. */
  zoom: number;
  cx: number;
  cy: number;
}

/**
 * The pixels of `src` that map onto a w x h grid. With a crop box this is the
 * crop, trimmed by under a cell so cells stay square. Without one (older
 * mosaics) it is the original cover-fit, zoom and pan framing.
 */
export function cropRect(src: { width: number; height: number }, w: number, h: number, s: FramingSettings): CropRect {
  const target = w / h;
  if (s.crop) {
    const bx = s.crop.x * src.width;
    const by = s.crop.y * src.height;
    const bw = s.crop.w * src.width;
    const bh = s.crop.h * src.height;
    const rw = bw / bh > target ? bh * target : bw;
    const rh = bw / bh > target ? bh : bw / target;
    return { x: bx + (bw - rw) / 2, y: by + (bh - rh) / 2, w: rw, h: rh };
  }
  let rw: number;
  let rh: number;
  if (src.width / src.height > target) {
    rh = src.height;
    rw = rh * target;
  } else {
    rw = src.width;
    rh = rw / target;
  }
  const zoom = Math.max(1, s.zoom);
  rw /= zoom;
  rh /= zoom;
  let x = s.cx * src.width - rw / 2;
  let y = s.cy * src.height - rh / 2;
  x = Math.max(0, Math.min(src.width - rw, x));
  y = Math.max(0, Math.min(src.height - rh, y));
  return { x, y, w: rw, h: rh };
}

/** The crop box that the older zoom/pan framing describes, so it can be edited as a crop. */
export function currentBox(photo: { width: number; height: number }, w: number, h: number, s: FramingSettings): CropBox {
  if (s.crop) return s.crop;
  const r = cropRect(photo, w, h, s);
  return { x: r.x / photo.width, y: r.y / photo.height, w: r.w / photo.width, h: r.h / photo.height };
}

export interface GridFraming extends FramingSettings {
  gridWidth: number;
  gridHeight: number;
  lockAspect: boolean;
}

/**
 * Keep the grid and the crop the same shape after a change. With lockAspect
 * the grid height follows the crop (or, for older mosaics without a crop box,
 * the photo). Without it the user sets both grid sides and the crop is
 * reshaped to match, keeping its centre and size. `photoAspect` is the
 * transformed photo's width / height.
 */
export function reconcile<T extends GridFraming>(s: T, photoAspect: number): T {
  if (s.lockAspect) {
    const aspect = s.crop ? boxAspect(s.crop, photoAspect) : photoAspect;
    const gridHeight = Math.max(2, Math.round(s.gridWidth / aspect));
    return gridHeight === s.gridHeight ? s : { ...s, gridHeight };
  }
  if (!s.crop) return s;
  const ratio = s.gridWidth / s.gridHeight;
  if (Math.abs(boxAspect(s.crop, photoAspect) / ratio - 1) < 1e-6) return s;
  return { ...s, crop: withRatio(s.crop, ratio, photoAspect) };
}

/** The ratio a crop frame must keep while it is dragged. */
export function dragRatio(s: GridFraming & { cropRatio: CropRatio }, photoAspect: number): number | null {
  return s.lockAspect ? ratioValue(s.cropRatio, photoAspect) : s.gridWidth / s.gridHeight;
}
