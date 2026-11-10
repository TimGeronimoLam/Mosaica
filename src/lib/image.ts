import { tr } from '../i18n';
import type { CropRect } from './crop';
import { multiply, scaleOf, scaling, transformFor, type Affine, type PhotoTransform } from './transform';

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
      reject(new Error(tr().errors.decode));
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
  if (!ctx) throw new Error(tr().errors.canvas);
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
  if (!ctx) throw new Error(tr().errors.canvas);
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

/**
 * Renders parts of the transformed photo straight from the full-resolution
 * image, so a tight crop still gets real detail instead of being cut out of
 * the 1024px working copy.
 */
export interface CropRenderer {
  /** Original-image pixels per pixel of the transformed working copy. */
  sourcePerPx: number;
  /** `rect` (in working-copy pixels) rendered at W x H. The last result is cached. */
  render(rect: CropRect, W: number, H: number): SourceRaster;
}

/** Most pixels drawn for one crop before averaging down. */
const MAX_DRAW = 2_000_000;

export function createCropRenderer(img: HTMLImageElement, photo: TransformedPhoto): CropRenderer {
  // Original image pixels → working-copy pixels.
  const toPhoto = multiply(photo.m, scaling(photo.baseWidth / img.naturalWidth, photo.baseHeight / img.naturalHeight));
  const sourcePerPx = 1 / scaleOf(toPhoto);
  const canvas = document.createElement('canvas');
  let lastKey = '';
  let last: SourceRaster | null = null;
  return {
    sourcePerPx,
    render(rect, W, H) {
      const key = `${rect.x},${rect.y},${rect.w},${rect.h},${W},${H}`;
      if (last && key === lastKey) return last;
      // Draw at f times the size and average down in f x f blocks, so large
      // reductions do not alias whatever filter the browser uses.
      const f = Math.max(1, Math.min(4, Math.floor((rect.w * sourcePerPx) / W), Math.floor(Math.sqrt(MAX_DRAW / (W * H)))));
      const DW = W * f;
      const DH = H * f;
      canvas.width = DW;
      canvas.height = DH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error(tr().errors.canvas);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, DW, DH);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const sx = DW / rect.w;
      const sy = DH / rect.h;
      ctx.setTransform(...multiply([sx, 0, 0, sy, -rect.x * sx, -rect.y * sy], toPhoto));
      ctx.drawImage(img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const big = ctx.getImageData(0, 0, DW, DH).data;
      last = { width: W, height: H, data: f === 1 ? big : boxReduce(big, DW, W, H, f) };
      lastKey = key;
      return last;
    },
  };
}

/** Average f x f blocks of RGBA pixels. */
export function boxReduce(src: Uint8ClampedArray, srcW: number, W: number, H: number, f: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  const n = f * f;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * srcW + x * f) * 4;
        for (let dx = 0; dx < f; dx++) {
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          i += 4;
        }
      }
      const o = (y * W + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}

/** Re-encode a blob so that very large originals do not bloat the database. */
export async function prepareSourceBlob(blob: Blob, img: HTMLImageElement): Promise<Blob> {
  const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
  if (maxSide <= 2400 && blob.size <= 4_000_000) return blob;
  const scale = Math.min(1, 2400 / maxSide);
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

export { cropRect, type CropRect } from './crop';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
