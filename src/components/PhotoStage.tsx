import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CROP_RATIOS, dragHandle, moveBox, scaleBox, spanBox, type CropBox, type CropRatio, type Handle } from '../lib/crop';
import type { CropRect, SourceRaster, TransformedPhoto } from '../lib/image';
import { combineMask, emptyMask, invertMask, maskCoverage, normalizeMask, paintSegment, renderMaskOverlay, selectBackground, selectSimilar, type Box, type OverlayLook, type PhotoMask } from '../lib/mask';
import { findFaceDetails } from '../lib/ai/face';
import { findSubject, SUBJECT_MODELS, type SubjectModel } from '../lib/ai/segment';
import { apply, invert, multiply, scaleOf, scaling, type Affine } from '../lib/transform';
import { IconBrush, IconCrop, IconInvert, IconSparkles, IconTrash, IconWand } from './Icons';
import { capture, Segmented, Slider } from './ui';

/** Which mask the brush and wand paint: the removed background, or the detail to protect. */
export type MaskLayer = 'background' | 'detail';

export interface PhotoTools {
  tool: 'crop' | 'brush' | 'wand';
  layer: MaskLayer;
  /** Brush and wand set the mask (remove background / mark detail) or clear it. */
  erase: boolean;
  /** Brush radius in grid cells. */
  brush: number;
  /** Wand and auto-background colour tolerance, 0..100. */
  tolerance: number;
  /** Which neural network "Find the subject" uses. */
  subjectModel: SubjectModel;
}

export const DEFAULT_PHOTO_TOOLS: PhotoTools = { tool: 'crop', layer: 'background', erase: true, brush: 1.5, tolerance: 30, subjectModel: 'portrait' };

/** Maps pixels of the transformed photo to pixels of a mask of the given size. */
export function photoToMask(photo: TransformedPhoto, maskWidth: number, maskHeight: number): Affine {
  return multiply(scaling(maskWidth / photo.baseWidth, maskHeight / photo.baseHeight), invert(photo.m));
}

const FULL = (w: number, h: number): Box => ({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 });

/** Draw the set areas of `mask` over a canvas the size of the photo. */
function paintOverlay(canvas: HTMLCanvasElement, mask: PhotoMask | null, toMask: Affine, look: OverlayLook, box?: Box): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  const b = box ?? FULL(W, H);
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  if (bw <= 0 || bh <= 0) return;
  const img = ctx.createImageData(bw, bh);
  // Render into a buffer as wide as the box, so shift the mapping to the box origin.
  const shifted = multiply(toMask, [1, 0, 0, 1, b.x0, b.y0]);
  renderMaskOverlay(img.data, bw, mask, shifted, { x0: 0, y0: 0, x1: bw - 1, y1: bh - 1 }, look);
  ctx.putImageData(img, b.x0, b.y0);
}

/** The photo with its removed background and detail areas, as a small picture (sidebar). */
export function PhotoThumb({ photo, mask, detail, toMask, crop }: { photo: TransformedPhoto; mask: PhotoMask | null; detail?: PhotoMask | null; toMask: Affine; crop: CropRect }) {
  const img = useRef<HTMLCanvasElement>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const dt = useRef<HTMLCanvasElement>(null);
  const { width: W, height: H } = photo.raster;
  useLayoutEffect(() => {
    img.current?.getContext('2d')?.drawImage(photo.canvas, 0, 0);
  }, [photo]);
  useLayoutEffect(() => {
    if (ov.current) paintOverlay(ov.current, mask, toMask, 'removed');
  }, [photo, mask, toMask]);
  useLayoutEffect(() => {
    if (dt.current) paintOverlay(dt.current, detail ?? null, toMask, 'detail');
  }, [photo, detail, toMask]);
  return (
    <div className="crop-preview" style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, ${Math.round((320 * W) / H)}px)` }}>
      <canvas ref={img} width={W} height={H} />
      <canvas ref={ov} width={W} height={H} className="mask-layer" />
      <canvas ref={dt} width={W} height={H} className="mask-layer" />
      <div className="crop-box" style={cropStyle(crop, W, H)} />
    </div>
  );
}

function cropStyle(crop: CropRect, W: number, H: number) {
  return { left: `${(crop.x / W) * 100}%`, top: `${(crop.y / H) * 100}%`, width: `${(crop.w / W) * 100}%`, height: `${(crop.h / H) * 100}%` };
}

interface StageProps {
  photo: TransformedPhoto;
  mask: PhotoMask | null;
  /** Areas to protect as detail, in the same coordinates as `mask`. */
  detail: PhotoMask | null;
  /** The untransformed photo at mask resolution, for the wand. */
  maskBase: SourceRaster;
  /** The crop, as fractions of the photo. */
  box: CropBox;
  /** Width / height the crop keeps while it is dragged, or null for a free crop. */
  ratio: number | null;
  gridWidth: number;
  gridHeight: number;
  /** Size of one grid cell in photo pixels. */
  cellSize: number;
  displayWidth: number;
  tools: PhotoTools;
  onCrop: (box: CropBox) => void;
  onMask: (m: PhotoMask | null) => void;
  onDetail: (m: PhotoMask | null) => void;
}

type CropHit = Handle | 'move' | 'new';

type Gesture =
  | { kind: 'crop'; hit: CropHit; start: CropBox; x: number; y: number; moved: boolean }
  | { kind: 'pinch'; dist: number; start: CropBox }
  | { kind: 'brush'; layer: MaskLayer; data: Uint8Array; last: [number, number] };

const LOOK: Record<MaskLayer, OverlayLook> = { background: 'removed', detail: 'detail' };

const CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se'];
const EDGES: Handle[] = ['n', 's', 'e', 'w'];
const CURSORS: Record<CropHit, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move',
  new: 'crosshair',
};

/** Where a handle sits on the crop, as fractions of the crop's width and height. */
function handleAt(h: Handle): [number, number] {
  return [h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5, h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5];
}

export function PhotoStage({ photo, mask, detail, maskBase, box, ratio, gridWidth, gridHeight, cellSize, displayWidth, tools, onCrop, onMask, onDetail }: StageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const imgCanvas = useRef<HTMLCanvasElement>(null);
  const ovCanvas = useRef<HTMLCanvasElement>(null);
  const dtCanvas = useRef<HTMLCanvasElement>(null);
  const layerCanvas = { background: ovCanvas, detail: dtCanvas };
  const layerMask = { background: mask, detail };
  const setLayer = { background: onMask, detail: onDetail };
  const pointers = useRef(new Map<number, [number, number]>());
  const gesture = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [hoverHit, setHoverHit] = useState<CropHit>('new');
  const [dragging, setDragging] = useState(false);
  const { width: W, height: H } = photo.raster;
  const mw = maskBase.width;
  const mh = maskBase.height;
  const toMask = photoToMask(photo, mw, mh);
  const toPhoto = invert(toMask);
  const scale = displayWidth / W;
  const brushPx = Math.max(1, tools.brush * cellSize);
  const A = W / H;
  const displayHeight = displayWidth * (H / W);

  useLayoutEffect(() => {
    imgCanvas.current?.getContext('2d')?.drawImage(photo.canvas, 0, 0);
  }, [photo]);

  useLayoutEffect(() => {
    if (ovCanvas.current) paintOverlay(ovCanvas.current, mask, photoToMask(photo, mw, mh), 'removed');
  }, [photo, mask, mw, mh]);

  useLayoutEffect(() => {
    if (dtCanvas.current) paintOverlay(dtCanvas.current, detail, photoToMask(photo, mw, mh), 'detail');
  }, [photo, detail, mw, mh]);

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl+wheel) resizes the crop around its centre.
  const boxRef = useRef(box);
  boxRef.current = box;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onCrop(scaleBox(boxRef.current, Math.exp(e.deltaY * 0.01), A));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onCrop, A]);

  /** What a pointer at display position (px, py) would grab on the crop frame. */
  const hitTest = (px: number, py: number, touch: boolean): CropHit => {
    const r = touch ? 22 : 10;
    const bx = box.x * displayWidth;
    const by = box.y * displayHeight;
    const bw = box.w * displayWidth;
    const bh = box.h * displayHeight;
    for (const h of ratio === null ? [...CORNERS, ...EDGES] : CORNERS) {
      const [fx, fy] = handleAt(h);
      if (Math.abs(px - (bx + fx * bw)) <= r && Math.abs(py - (by + fy * bh)) <= r) return h;
    }
    return px >= bx && px <= bx + bw && py >= by && py <= by + bh ? 'move' : 'new';
  };

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const toImage = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  /** Paint one brush segment into the stroke buffer and refresh just that part of the overlay. */
  const strokeTo = (g: Extract<Gesture, { kind: 'brush' }>, p: [number, number]) => {
    const a = apply(toMask, g.last[0], g.last[1]);
    const b = apply(toMask, p[0], p[1]);
    const box = paintSegment(g.data, mw, mh, a[0], a[1], b[0], b[1], brushPx * scaleOf(toMask), tools.erase ? 1 : 0);
    g.last = p;
    const canvas = layerCanvas[g.layer].current;
    if (!box || !canvas) return;
    // The changed mask box, mapped back to photo pixels.
    const corners = [
      apply(toPhoto, box.x0, box.y0),
      apply(toPhoto, box.x1 + 1, box.y0),
      apply(toPhoto, box.x0, box.y1 + 1),
      apply(toPhoto, box.x1 + 1, box.y1 + 1),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    paintOverlay(canvas, { width: mw, height: mh, data: g.data }, toMask, LOOK[g.layer], {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - 1),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - 1),
      x1: Math.min(W - 1, Math.ceil(Math.max(...xs)) + 1),
      y1: Math.min(H - 1, Math.ceil(Math.max(...ys)) + 1),
    });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // A second finger during a stroke would make the line jump between them.
    if (gesture.current?.kind === 'brush') return;
    capture(stage.current, e.pointerId);
    const p = toImage(e);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (tools.tool === 'crop') {
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        gesture.current = { kind: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), start: box };
      } else {
        const [lx, ly] = local(e);
        gesture.current = { kind: 'crop', hit: hitTest(lx, ly, e.pointerType !== 'mouse'), start: box, x: lx / displayWidth, y: ly / displayHeight, moved: false };
      }
      setDragging(true);
      return;
    }
    const current = layerMask[tools.layer];
    if (tools.tool === 'wand') {
      const [mx, my] = apply(toMask, p[0], p[1]);
      if (mx < 0 || my < 0 || mx >= mw || my >= mh) return;
      const region = selectSimilar(maskBase, mx, my, tools.tolerance);
      setLayer[tools.layer](normalizeMask(combineMask(current, region, tools.erase ? 1 : 0, mw, mh)));
      return;
    }
    const g: Gesture = { kind: 'brush', layer: tools.layer, data: current ? current.data.slice() : emptyMask(mw, mh).data, last: p };
    gesture.current = g;
    strokeTo(g, p);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const p = toImage(e);
    setHover(p);
    if (tools.tool === 'crop' && !gesture.current) {
      const [lx, ly] = local(e);
      setHoverHit(hitTest(lx, ly, e.pointerType !== 'mouse'));
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'brush') strokeTo(g, p);
    else if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      // Fingers apart = zoom in = a smaller crop.
      onCrop(scaleBox(g.start, Math.max(1, g.dist) / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), A));
    } else if (g.kind === 'crop') {
      const [lx, ly] = local(e);
      const fx = lx / displayWidth;
      const fy = ly / displayHeight;
      // Ignore the jitter of a plain click.
      if (!g.moved && Math.hypot((fx - g.x) * displayWidth, (fy - g.y) * displayHeight) < 4) return;
      g.moved = true;
      if (g.hit === 'move') onCrop(moveBox(g.start, fx - g.x, fy - g.y));
      else if (g.hit === 'new') onCrop(spanBox(g.x, g.y, fx, fy, A, ratio));
      else onCrop(dragHandle(g.start, g.hit, fx, fy, A, ratio));
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    // Fingers do not hover, so do not leave the brush ring behind.
    if (e.pointerType !== 'mouse') setHover(null);
    const g = gesture.current;
    if (g?.kind === 'brush') setLayer[g.layer](normalizeMask({ width: mw, height: mh, data: g.data }));
    gesture.current = null;
    setDragging(false);
    // Lifting one finger of a pinch carries on as a move with the other.
    if (g?.kind === 'pinch' && pointers.current.size === 1) {
      const [cx, cy] = [...pointers.current.values()][0];
      const [lx, ly] = local({ clientX: cx, clientY: cy });
      gesture.current = { kind: 'crop', hit: 'move', start: boxRef.current, x: lx / displayWidth, y: ly / displayHeight, moved: true };
      setDragging(true);
    }
  };

  const active = gesture.current?.kind === 'crop' ? gesture.current.hit : hoverHit;
  const cursor = tools.tool === 'crop' ? CURSORS[dragging ? active : hoverHit] : tools.tool === 'wand' ? 'crosshair' : 'none';
  // Cell lines inside the frame: every cell when cells are big enough to see, else every fifth.
  const cellPx = (box.w * displayWidth) / gridWidth;
  const every = cellPx >= 7 ? 1 : cellPx >= 2 ? 5 : 0;
  return (
    <div
      ref={stage}
      className={`photo-stage tool-${tools.tool}`}
      style={{ width: displayWidth, height: displayWidth * (H / W), cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
    >
      <canvas ref={imgCanvas} width={W} height={H} />
      <canvas ref={ovCanvas} width={W} height={H} className="mask-layer" />
      <canvas ref={dtCanvas} width={W} height={H} className="mask-layer" />
      <div
        className={`crop-frame ${tools.tool === 'crop' ? 'active' : 'faint'}`}
        style={{ left: box.x * displayWidth, top: box.y * displayHeight, width: box.w * displayWidth, height: box.h * displayHeight }}
      >
        {tools.tool === 'crop' && every > 0 && (
          <svg className="cell-lines" viewBox={`0 0 ${gridWidth} ${gridHeight}`} preserveAspectRatio="none" aria-hidden="true">
            {Array.from({ length: Math.floor((gridWidth - 1) / every) }, (_, i) => (
              <line key={`x${i}`} x1={(i + 1) * every} x2={(i + 1) * every} y1={0} y2={gridHeight} />
            ))}
            {Array.from({ length: Math.floor((gridHeight - 1) / every) }, (_, i) => (
              <line key={`y${i}`} y1={(i + 1) * every} y2={(i + 1) * every} x1={0} x2={gridWidth} />
            ))}
          </svg>
        )}
        {tools.tool === 'crop' &&
          (ratio === null ? [...CORNERS, ...EDGES] : CORNERS).map((h) => {
            const [fx, fy] = handleAt(h);
            return <span key={h} className={`crop-handle ${h.length === 2 ? 'corner' : 'edge'}`} style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }} />;
          })}
      </div>
      {hover && tools.tool === 'brush' && (
        <div
          className={`brush-cursor ${tools.layer === 'detail' ? (tools.erase ? 'mark' : 'unmark') : tools.erase ? 'erase' : 'keep'}`}
          style={{ left: hover[0] * scale, top: hover[1] * scale, width: brushPx * 2 * scale, height: brushPx * 2 * scale }}
        />
      )}
    </div>
  );
}

interface ToolbarProps {
  tools: PhotoTools;
  onTools: (patch: Partial<PhotoTools>) => void;
  mask: PhotoMask | null;
  detail: PhotoMask | null;
  maskBase: SourceRaster;
  cropRatio: CropRatio;
  /** False when the grid size is fixed by hand, so the crop has to keep the grid's shape. */
  ratioFree: boolean;
  onRatio: (r: CropRatio) => void;
  onResetCrop: () => void;
  onMask: (m: PhotoMask | null) => void;
  onDetail: (m: PhotoMask | null) => void;
}

/** A neural network running on the photo: what it is doing, or what went wrong. */
type AiState = { status: 'idle' } | { status: 'busy'; message: string } | { status: 'error'; message: string };

export function PhotoToolbar({ tools, onTools, mask, detail, maskBase, cropRatio, ratioFree, onRatio, onResetCrop, onMask, onDetail }: ToolbarProps) {
  const mw = maskBase.width;
  const mh = maskBase.height;
  const removed = maskCoverage(mask);
  const marked = maskCoverage(detail);
  const [notice, setNotice] = useState<string | null>(null);
  const [ai, setAi] = useState<AiState>({ status: 'idle' });
  useEffect(() => setNotice(null), [tools.tool, tools.erase, tools.layer]);
  // Results of a run that finishes after the toolbar is gone are dropped.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const runAi = async (job: (progress: (m: string) => void) => Promise<string | null>) => {
    setNotice(null);
    setAi({ status: 'busy', message: 'Starting…' });
    try {
      const note = await job((message) => alive.current && setAi({ status: 'busy', message }));
      if (!alive.current) return;
      setAi({ status: 'idle' });
      setNotice(note);
    } catch (e) {
      if (!alive.current) return;
      const text = e instanceof Error ? e.message : String(e);
      setAi({ status: 'error', message: /fetch|network|load/i.test(text) ? `Could not load the model (is the device online?). ${text}` : text });
    }
  };
  const aiSubject = () =>
    runAi(async (progress) => {
      const region = await findSubject(maskBase, tools.subjectModel, progress);
      const share = region.reduce((a, v) => a + v, 0) / region.length;
      if (share === 0) return 'The model found no background to remove.';
      if (share > 0.98) return 'The model found no subject in this photo. Try the other model, or the brush.';
      // The model decides the whole mask: what it keeps overrides earlier removals.
      onMask(normalizeMask({ width: mw, height: mh, data: region }));
      return null;
    });
  const aiFace = () =>
    runAi(async (progress) => {
      const found = await findFaceDetails(maskBase, progress);
      if (!found.faces) return 'No face found. Mark the important parts with the brush instead.';
      onDetail(normalizeMask(combineMask(detail, found.mask, 1, mw, mh)));
      return `Marked the eyes, brows, nose and mouth of ${found.faces === 1 ? 'one face' : `${found.faces} faces`}.`;
    });
  const busy = ai.status === 'busy';
  const autoBackground = () => {
    const region = selectBackground(maskBase, tools.tolerance);
    const share = region.reduce((a, v) => a + v, 0) / region.length;
    if (share === 0) {
      setNotice('No plain background found along the top and sides. Try a higher tolerance, or use the brush or wand.');
      return;
    }
    onMask(normalizeMask(combineMask(mask, region, 1, mw, mh)));
    setNotice(
      share > 0.7
        ? `That removed ${Math.round(share * 100)}% of the photo, so the background may not be plain enough. Undo (Ctrl+Z) and lower the tolerance, or paint with the brush instead.`
        : null,
    );
  };
  const onDetailLayer = tools.layer === 'detail';
  const hint =
    tools.tool === 'crop'
      ? ratioFree
        ? 'Drag the corners or edges to crop, drag inside to move, or drag outside to draw a new crop. Pinch or Ctrl+scroll to resize.'
        : 'The crop keeps the grid’s shape because the grid height is set by hand (step 3). Drag the corners to resize, drag inside to move.'
      : onDetailLayer
        ? tools.tool === 'brush'
          ? tools.erase
            ? 'Paint over the parts the picture is recognised by (eyes, mouth, a logo). They keep their contrast, their colours and their small features.'
            : 'Paint over marked areas to unmark them.'
          : tools.erase
            ? 'Click an area to mark it and everything of a similar colour joined to it as detail.'
            : 'Click a marked area to unmark it.'
        : tools.tool === 'brush'
          ? tools.erase
            ? 'Paint over anything that should stay blank, like a busy background.'
            : 'Paint over removed areas to bring them back.'
          : tools.erase
            ? 'Click an area to remove it and everything of a similar colour joined to it.'
            : 'Click a removed area to bring it back.';
  return (
    <div className="stage-tools" role="toolbar" aria-label="Photo tools">
      <div className="tool-row">
        <Segmented
          label="Tool"
          value={tools.tool}
          onChange={(tool) => onTools({ tool })}
          options={[
            { value: 'crop', label: 'Crop', icon: <IconCrop size={16} /> },
            { value: 'brush', label: 'Brush', icon: <IconBrush size={16} /> },
            { value: 'wand', label: 'Wand', icon: <IconWand size={16} /> },
          ]}
        />
        {tools.tool !== 'crop' && (
          <Segmented
            label="Layer"
            value={tools.layer}
            onChange={(layer) => onTools({ layer })}
            options={[
              { value: 'background', label: 'Background' },
              { value: 'detail', label: 'Detail' },
            ]}
          />
        )}
        {tools.tool !== 'crop' && (
          <Segmented
            label="Brush mode"
            value={tools.erase ? 'erase' : 'keep'}
            onChange={(v) => onTools({ erase: v === 'erase' })}
            options={
              onDetailLayer
                ? [
                    { value: 'erase', label: 'Mark' },
                    { value: 'keep', label: 'Unmark' },
                  ]
                : [
                    { value: 'erase', label: 'Remove' },
                    { value: 'keep', label: 'Keep' },
                  ]
            }
          />
        )}
        {tools.tool === 'crop' && (
          <>
            <label className="field inline">
              <span>Shape</span>
              <select value={ratioFree ? cropRatio : 'grid'} disabled={!ratioFree} onChange={(e) => onRatio(e.target.value as CropRatio)}>
                {!ratioFree && <option value="grid">Same as the grid</option>}
                {CROP_RATIOS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn small ghost" onClick={onResetCrop}>
              Reset crop
            </button>
          </>
        )}
        <div className="tool-slider">
          {tools.tool === 'brush' && <Slider label="Brush size" value={tools.brush} min={0.5} max={8} step={0.5} onChange={(brush) => onTools({ brush })} format={(v) => `${v} cells`} />}
        </div>
      </div>
      {tools.tool !== 'crop' && onDetailLayer ? (
        <div className="tool-row">
          <button className="btn small" onClick={aiFace} disabled={busy} title="Find faces and mark their eyes, brows, nose and mouth (runs in your browser)">
            <IconSparkles size={16} /> Find face details
          </button>
          <button className="btn small ghost" onClick={() => onDetail(null)} disabled={!detail}>
            <IconTrash size={16} /> Clear
          </button>
          {marked > 0 && <span className="tool-note">{Math.round(marked * 100)}% marked</span>}
        </div>
      ) : (
        <>
          <div className="tool-row">
            <button className="btn small" onClick={autoBackground} disabled={busy} title="Remove the plain background around the subject (colour flood fill)">
              <IconSparkles size={16} /> Remove plain background
            </button>
            <div className="tool-slider">
              <Slider label="Tolerance" value={tools.tolerance} min={1} max={100} onChange={(tolerance) => onTools({ tolerance })} format={(v) => (v < 20 ? `${v} · strict` : v > 60 ? `${v} · loose` : String(v))} />
            </div>
            <button className="btn small" onClick={() => onMask(normalizeMask(invertMask(mask, mw, mh)))} title="Swap removed and kept areas">
              <IconInvert size={16} /> Invert
            </button>
            <button className="btn small ghost" onClick={() => onMask(null)} disabled={!mask}>
              <IconTrash size={16} /> Clear
            </button>
            {removed > 0 && <span className="tool-note">{Math.round(removed * 100)}% removed</span>}
          </div>
          <div className="tool-row">
            <button className="btn small" onClick={aiSubject} disabled={busy} title="Let a neural network find the subject and remove everything else (runs in your browser; the model is downloaded once)">
              <IconSparkles size={16} /> Find the subject
            </button>
            <label className="field inline">
              <span>Model</span>
              <select value={tools.subjectModel} disabled={busy} onChange={(e) => onTools({ subjectModel: e.target.value as SubjectModel })} title={SUBJECT_MODELS[tools.subjectModel].note}>
                {(Object.keys(SUBJECT_MODELS) as SubjectModel[]).map((k) => (
                  <option key={k} value={k}>
                    {SUBJECT_MODELS[k].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {ai.status !== 'idle' ? (
        <p className={`hint ${ai.status === 'error' ? 'warn' : 'ai-busy'}`} role="status" aria-live="polite">
          {ai.message}
        </p>
      ) : notice ? (
        <p className="hint warn" role="status">
          {notice}
        </p>
      ) : (
        <p className="hint">{hint}</p>
      )}
    </div>
  );
}
