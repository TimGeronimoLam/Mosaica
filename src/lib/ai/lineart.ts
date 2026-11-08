import type { Rgba } from '../mask';

/**
 * Tracing the outlines of a photo with a line-drawing network that runs in
 * the browser (Transformers.js on ONNX Runtime's WebAssembly backend; see
 * segment.ts for why WebGPU is avoided). The model is downloaded on first use
 * and cached by the browser; nothing is uploaded anywhere.
 *
 * Informative Drawings (Chan, Durand & Isola, CVPR 2022), anime style: a small
 * fully convolutional generator that draws a photo as clean ink lines on white
 * paper. Edge filters mark every change of brightness; this draws the lines a
 * person would draw (the jaw, the eyes, the edge of the hair), which read far
 * better as lines of cells in a one-colour puzzle than filled blobs do.
 */
export const LINEART_MODEL = {
  /** Hugging Face model id: a plain ONNX export of the authors' anime_style weights (MIT). */
  id: 'rocca/informative-drawings-line-art-onnx',
  label: 'Informative Drawings (17 MB)',
};

/** How dark (0..1) the drawing has to be for a pixel to count as ink. */
export const INK_THRESHOLD = 0.3;

/** The generator halves and doubles the picture twice, so sizes are padded to a multiple of this. */
const STRIDE = 4;

export type Progress = (message: string) => void;

/** The drawing, 0..1 per pixel where 1 is white paper, at the size given. */
interface Drawing {
  width: number;
  height: number;
  data: Float32Array;
}

type Runner = (planes: Float32Array, width: number, height: number) => Promise<Drawing>;

let runner: Promise<Runner> | null = null;

async function loadRunner(onProgress: Progress): Promise<Runner> {
  const tf = await import('@huggingface/transformers');
  // Models come from the Hugging Face hub (cached by the browser), never from this site's own /models/.
  tf.env.allowLocalModels = false;
  const files = new Map<string, number>();
  const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, p.progress ?? 0);
      let sum = 0;
      for (const v of files.values()) sum += v;
      onProgress(`Downloading the model… ${Math.round(sum / files.size)}%`);
    } else if (p.status === 'ready') onProgress('Tracing the outlines…');
  };
  // The repository holds a bare model.onnx (no config.json, no onnx/ folder), so the
  // generic model class is used with an inline config and the file named outright.
  const model = await tf.PreTrainedModel.from_pretrained(LINEART_MODEL.id, {
    config: new tf.PretrainedConfig({ model_type: 'custom' }),
    subfolder: '',
    model_file_name: 'model',
    dtype: 'fp32',
    device: 'wasm',
    progress_callback,
  });
  return async (planes, width, height) => {
    const out = await model({ input: new tf.Tensor('float32', planes, [1, 3, height, width]) });
    const t = out.output ?? Object.values(out)[0];
    if (!t || t.dims.length !== 4) throw new Error('The line-art model gave an unexpected result.');
    return { width: t.dims[3], height: t.dims[2], data: Float32Array.from(t.data as Float32Array) };
  };
}

/**
 * Trace the outlines of the picture: a mask the size of `src` where 1 marks
 * ink. Rejects with a readable message when the model cannot be loaded (no
 * network, unsupported browser).
 */
export async function traceOutlines(src: Rgba, onProgress: Progress): Promise<Uint8Array> {
  onProgress('Loading the model…');
  if (!runner) {
    runner = loadRunner(onProgress);
    runner.catch(() => (runner = null));
  }
  const run = await runner;
  onProgress('Tracing the outlines…');
  const { width: w, height: h } = src;
  const W = Math.ceil(w / STRIDE) * STRIDE;
  const H = Math.ceil(h / STRIDE) * STRIDE;
  const drawing = await run(planesOf(src, W, H), W, H);
  return inkFrom(drawing, w, h);
}

/** The picture as planar RGB 0..1 on a W x H white canvas (transparent pixels and padding are white). */
export function planesOf(src: Rgba, W: number, H: number): Float32Array {
  const { width: w, height: h, data } = src;
  const n = W * H;
  const planes = new Float32Array(n * 3).fill(1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      const o = y * W + x;
      planes[o] = (data[i] * a + 255 * (1 - a)) / 255;
      planes[n + o] = (data[i + 1] * a + 255 * (1 - a)) / 255;
      planes[2 * n + o] = (data[i + 2] * a + 255 * (1 - a)) / 255;
    }
  }
  return planes;
}

/** Pixels of the drawing darker than the threshold, as a w x h mask (1 = ink); the drawing is cropped, or resampled if its size differs. */
export function inkFrom(d: Drawing, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const exact = d.width >= w && d.height >= h;
  for (let y = 0; y < h; y++) {
    const sy = exact ? y : Math.min(d.height - 1, Math.floor(((y + 0.5) * d.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = exact ? x : Math.min(d.width - 1, Math.floor(((x + 0.5) * d.width) / w));
      if (1 - d.data[sy * d.width + sx] > INK_THRESHOLD) out[y * w + x] = 1;
    }
  }
  return out;
}
