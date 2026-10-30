import type { MosaicSettings } from '../types';

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

/**
 * Average the source pixels of each cell. Returns w*h*3 floats in 0..1 (sRGB),
 * with brightness / contrast / saturation applied.
 */
export function sampleGrid(src: SourceRaster, w: number, h: number, s: MosaicSettings): Float32Array {
  const rect = cropRect(src, w, h, s);
  const out = new Float32Array(w * h * 3);
  const { data, width: sw } = src;
  const cellW = rect.w / w;
  const cellH = rect.h / h;
  const bright = s.brightness / 100 * 0.5;
  const contrast = s.contrast >= 0 ? 1 + s.contrast / 50 : 1 + s.contrast / 100;
  const sat = (s.saturation + 100) / 100;

  for (let gy = 0; gy < h; gy++) {
    const y0 = Math.floor(rect.y + gy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor(rect.y + (gy + 1) * cellH));
    for (let gx = 0; gx < w; gx++) {
      const x0 = Math.floor(rect.x + gx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor(rect.x + (gx + 1) * cellW));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < src.height; y++) {
        let i = (y * sw + x0) * 4;
        for (let x = x0; x < x1 && x < sw; x++) {
          const a = data[i + 3] / 255;
          r += data[i] * a + 255 * (1 - a);
          g += data[i + 1] * a + 255 * (1 - a);
          b += data[i + 2] * a + 255 * (1 - a);
          n++;
          i += 4;
        }
      }
      if (n === 0) n = 1;
      let cr = r / n / 255;
      let cg = g / n / 255;
      let cb = b / n / 255;
      // saturation
      const l = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      cr = l + (cr - l) * sat;
      cg = l + (cg - l) * sat;
      cb = l + (cb - l) * sat;
      // contrast then brightness
      cr = (cr - 0.5) * contrast + 0.5 + bright;
      cg = (cg - 0.5) * contrast + 0.5 + bright;
      cb = (cb - 0.5) * contrast + 0.5 + bright;
      const o = (gy * w + gx) * 3;
      out[o] = clamp01(cr);
      out[o + 1] = clamp01(cg);
      out[o + 2] = clamp01(cb);
    }
  }
  return out;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
