import type { Rgba } from '../mask';

/**
 * Finding the subject of a photo with a neural network that runs in the
 * browser (Transformers.js on ONNX Runtime's WebAssembly backend). The model
 * is downloaded on first use and cached by the browser; nothing is uploaded
 * anywhere.
 *
 * WebGPU is deliberately not used: with ONNX Runtime 1.31 MODNet returns a
 * garbage matte on it, BiRefNet fails with "Too many storage buffers in
 * shader", and once a WebGPU session has run, WebAssembly sessions in the
 * same page fail the same way. On the CPU MODNet takes about 3 s.
 */

export type SubjectModel = 'portrait' | 'any';

export interface SubjectModelInfo {
  label: string;
  /** Shown next to the choice. */
  note: string;
  /** Hugging Face model id. */
  id: string;
  task: 'background-removal' | 'image-segmentation';
  /** Weights to download (Transformers.js dtype); undefined = the library's default for the CPU (8-bit). */
  dtype?: 'fp32' | 'fp16' | 'q8';
}

export const SUBJECT_MODELS: Record<SubjectModel, SubjectModelInfo> = {
  portrait: {
    label: 'People (fast, 25 MB)',
    note: 'MODNet, a portrait matting model. Best for photos of people; small and quick.',
    id: 'Xenova/modnet',
    task: 'background-removal',
    dtype: 'fp32',
  },
  any: {
    label: 'Any subject (94 MB, slow)',
    note: 'BiRefNet lite at 512 px, a general subject segmentation model. Works for pets, objects and people; a big download and about 15 s per photo.',
    // The onnx-community export has a fixed 1024 px input and runs out of WebAssembly memory; this one is exported at 512 px.
    id: 'studioludens/birefnet-lite-512',
    task: 'image-segmentation',
    dtype: 'fp16',
  },
};

export type Progress = (message: string) => void;

/** A soft mask, 0..255, where high values are the subject. */
interface SoftMask {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
  /** Bytes per pixel in `data`, and which one holds the subject. */
  stride: number;
  offset: number;
}

type Runner = (img: import('@huggingface/transformers').RawImage) => Promise<SoftMask>;

const runners = new Map<SubjectModel, Promise<Runner>>();

async function loadRunner(model: SubjectModel, onProgress: Progress): Promise<Runner> {
  const info = SUBJECT_MODELS[model];
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
    } else if (p.status === 'ready') onProgress('Finding the subject…');
  };
  const options = { device: 'wasm' as const, dtype: info.dtype, progress_callback };
  if (info.task === 'background-removal') {
    const pipe = await tf.pipeline('background-removal', info.id, options);
    return async (img) => {
      const out = await pipe(img);
      const image = Array.isArray(out) ? out[0] : out;
      return { width: image.width, height: image.height, data: image.data, stride: image.channels, offset: image.channels - 1 };
    };
  }
  const pipe = await tf.pipeline('image-segmentation', info.id, options);
  return async (img) => {
    const out = await pipe(img);
    const first = Array.isArray(out) ? out[0] : out;
    const mask = first.mask;
    return { width: mask.width, height: mask.height, data: mask.data, stride: mask.channels, offset: 0 };
  };
}

/**
 * The background of the picture as a mask the size of `src` (1 = background),
 * found by the chosen model. Rejects with a readable message when the model
 * cannot be loaded (no network, unsupported browser).
 */
export async function findSubject(src: Rgba, model: SubjectModel, onProgress: Progress): Promise<Uint8Array> {
  onProgress('Loading the model…');
  let runner = runners.get(model);
  if (!runner) {
    runner = loadRunner(model, onProgress);
    runners.set(model, runner);
    runner.catch(() => runners.delete(model));
  }
  const run = await runner;
  onProgress('Finding the subject…');
  const { RawImage } = await import('@huggingface/transformers');
  const img = new RawImage(new Uint8ClampedArray(src.data), src.width, src.height, 4);
  const soft = await run(img);
  return backgroundFrom(soft, src.width, src.height);
}

/** Threshold the soft mask at half and resample it (nearest) to w x h; 1 = background. */
function backgroundFrom(m: SoftMask, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = m.height === h ? y : Math.min(m.height - 1, Math.floor(((y + 0.5) * m.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = m.width === w ? x : Math.min(m.width - 1, Math.floor(((x + 0.5) * m.width) / w));
      if (m.data[(sy * m.width + sx) * m.stride + m.offset] < 128) out[y * w + x] = 1;
    }
  }
  return out;
}
