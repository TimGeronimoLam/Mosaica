import type { MosaicSettings } from '../types';
import { cropRect, type CropRenderer, type TransformedPhoto } from './image';
import { transformMask, type PhotoMask } from './mask';
import type { Sampler } from './pixelize';
import { sampleCells, sampleGrid } from './preprocess';
import { multiply, type Affine } from './transform';

/** Upper limit on working pixels (cells x samples per cell), to keep filters fast. */
const MAX_WORK = 300_000;

/**
 * How many samples per cell side converter 2 uses: as many as the original
 * photo has pixels for, up to 6, and fewer on very large grids.
 */
export function samplesPerCell(rectW: number, rectH: number, w: number, h: number, sourcePerPx: number): number {
  const available = Math.floor(Math.min(rectW / w, rectH / h) * sourcePerPx);
  const budget = Math.floor(Math.sqrt(MAX_WORK / (w * h)));
  return Math.max(1, Math.min(6, available, budget));
}

export interface SamplerInput {
  photo: TransformedPhoto;
  settings: MosaicSettings;
  /** Background mask in original-image coordinates, and the map from photo pixels into it. */
  mask: PhotoMask | null;
  toMask: Affine | null;
  /** The mask already resampled onto `photo.raster` (converter 1 uses this). */
  photoMask: Uint8Array | null;
  renderer: CropRenderer | null;
}

/** The cell sampler for the converter the mosaic uses. */
export function makeSampler({ photo, settings: s, mask, toMask, photoMask, renderer }: SamplerInput): Sampler {
  if ((s.converter ?? 1) < 2 || !renderer) return (w, h) => sampleGrid(photo.raster, w, h, s, photoMask);
  return (w, h) => {
    const rect = cropRect(photo.raster, w, h, s);
    const S = samplesPerCell(rect.w, rect.h, w, h, renderer.sourcePerPx);
    const W = w * S;
    const H = h * S;
    const raster = renderer.render(rect, W, H);
    const m = mask && toMask ? transformMask(mask, multiply(toMask, [rect.w / W, 0, 0, rect.h / H, rect.x, rect.y]), W, H) : null;
    return sampleCells(raster, w, h, S, s, m);
  };
}
