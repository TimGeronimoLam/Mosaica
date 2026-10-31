// The cell sampler as it was before photo clean-up existed (copied from git history).
// Kept so tests can prove saved mosaics still regenerate identically.
import type { MosaicSettings } from '../../types';
import { clamp01, cropRect, type SourceRaster } from '../../lib/image';

export function legacySampleGrid(src: SourceRaster, w: number, h: number, s: MosaicSettings): Float32Array {
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
