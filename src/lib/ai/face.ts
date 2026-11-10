import { tr } from '../../i18n';
import { convexHull, fillPolygon, growMask, type Rgba } from '../mask';

/**
 * Finding the features of a face (eyes, brows, nose, mouth) with MediaPipe's
 * Face Landmarker, which runs in the browser. These are the few cells a
 * portrait is recognised by, so the converter protects them: see the detail
 * mask in the editor.
 */

/** Keep in step with the installed @mediapipe/tasks-vision version (package.json). */
const TASKS_VISION_VERSION = '1.2.2';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Landmarks around the nose tip and nostrils (the model has no connection set for the nose). */
const NOSE = [1, 2, 4, 5, 19, 94, 97, 98, 326, 327];

export type Progress = (message: string) => void;

export interface FaceDetails {
  faces: number;
  /** 1 = detail, the size of the picture given. */
  mask: Uint8Array;
}

type Landmarker = import('@mediapipe/tasks-vision').FaceLandmarker;

let landmarker: Promise<Landmarker> | null = null;

async function load(onProgress: Progress): Promise<Landmarker> {
  onProgress(tr().ai.loadingFaceModel);
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'IMAGE' as const, numFaces: 4 });
  try {
    return await FaceLandmarker.createFromOptions(vision, options('GPU'));
  } catch {
    return FaceLandmarker.createFromOptions(vision, options('CPU'));
  }
}

/** Find faces in the picture and mark their eyes, brows, nose and mouth. */
export async function findFaceDetails(src: Rgba, onProgress: Progress): Promise<FaceDetails> {
  if (!landmarker) {
    landmarker = load(onProgress);
    landmarker.catch(() => (landmarker = null));
  }
  const lm = await landmarker;
  const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
  onProgress(tr().ai.findingFaces);
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(tr().errors.canvas);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), 0, 0);
  const result = lm.detect(canvas);
  const { width: w, height: h } = src;
  let mask: Uint8Array = new Uint8Array(w * h);
  const sets = [
    [...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS],
    [...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS],
    FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
    FaceLandmarker.FACE_LANDMARKS_LIPS,
  ].map((conns) => [...new Set(conns.flatMap((c) => [c.start, c.end]))]);
  sets.push(NOSE);
  let maxRadius = 0;
  for (const face of result.faceLandmarks) {
    const pt = (i: number): [number, number] => [face[i].x * w, face[i].y * h];
    // Grow each feature by a little of the face's size, so the cells around an eye count too.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
      const [x, y] = pt(c.start);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const size = Math.hypot(maxX - minX, maxY - minY);
    maxRadius = Math.max(maxRadius, size * 0.025);
    for (const ids of sets) fillPolygon(mask, w, h, convexHull(ids.map(pt)), 1);
  }
  if (maxRadius >= 1) mask = growMask(mask, w, h, maxRadius);
  return { faces: result.faceLandmarks.length, mask };
}
