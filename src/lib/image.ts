import type { MosaicSettings } from '../types';
import { transformFor, type Affine, type PhotoTransform } from './transform';

/** RGBA pixels of the source image, capped in size for speed. */
export interface SourceRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode this image.'));
    };
    img.src = url;
  });
}

/** Draw an image onto a canvas no larger than maxSize on its longest side. */
export function rasterize(img: HTMLImageElement, maxSize = 1024): SourceRaster {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return { width: w, height: h, data };
}

/** Size of the working copy of a picture: no larger than maxSize on its longest side. */
export function baseSize(img: HTMLImageElement, maxSize = 1024): { width: number; height: number } {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  return { width: Math.max(1, Math.round(img.naturalWidth * scale)), height: Math.max(1, Math.round(img.naturalHeight * scale)) };
}

/** The photo after rotating, mirroring and straightening, ready for sampling and display. */
export interface TransformedPhoto {
  raster: SourceRaster;
  canvas: HTMLCanvasElement;
  /** Maps pixels of the untransformed working copy (baseWidth x baseHeight) to `raster` pixels. */
  m: Affine;
  baseWidth: number;
  baseHeight: number;
}

export function renderTransformed(img: HTMLImageElement, t: PhotoTransform, maxSize = 1024): TransformedPhoto {
  const base = baseSize(img, maxSize);
  const { m, width, height } = transformFor(base.width, base.height, t);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(...m);
  ctx.drawImage(img, 0, 0, base.width, base.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  return { raster: { width, height, data }, canvas, m, baseWidth: base.width, baseHeight: base.height };
}

/** Re-encode a blob so that very large originals do not bloat the database. */
export async function prepareSourceBlob(blob: Blob, img: HTMLImageElement): Promise<Blob> {
  const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
  if (maxSide <= 1600 && blob.size <= 3_000_000) return blob;
  const scale = Math.min(1, 1600 / maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.92);
  });
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the source image that maps onto a w x h grid (cover fit, then zoom/pan). */
export function cropRect(src: { width: number; height: number }, w: number, h: number, s: Pick<MosaicSettings, 'zoom' | 'cx' | 'cy'>): CropRect {
  const target = w / h;
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

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
