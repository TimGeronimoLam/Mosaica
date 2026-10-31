import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CropRect, SourceRaster, TransformedPhoto } from '../lib/image';
import { combineMask, emptyMask, invertMask, maskCoverage, normalizeMask, paintSegment, renderMaskOverlay, selectBackground, selectSimilar, type Box, type PhotoMask } from '../lib/mask';
import { apply, invert, multiply, scaleOf, scaling, type Affine } from '../lib/transform';
import { IconBrush, IconInvert, IconMove, IconSparkles, IconTrash, IconWand } from './Icons';
import { capture, Segmented, Slider } from './ui';

export interface PhotoTools {
  tool: 'move' | 'brush' | 'wand';
  /** Brush and wand remove background (true) or bring it back (false). */
  erase: boolean;
  /** Brush radius in grid cells. */
  brush: number;
  /** Wand and auto-background colour tolerance, 0..100. */
  tolerance: number;
}

export const DEFAULT_PHOTO_TOOLS: PhotoTools = { tool: 'move', erase: true, brush: 1.5, tolerance: 30 };

/** Maps pixels of the transformed photo to pixels of a mask of the given size. */
export function photoToMask(photo: TransformedPhoto, maskWidth: number, maskHeight: number): Affine {
  return multiply(scaling(maskWidth / photo.baseWidth, maskHeight / photo.baseHeight), invert(photo.m));
}

const FULL = (w: number, h: number): Box => ({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 });

/** Draw the removed areas of `mask` over a canvas the size of the photo. */
function paintOverlay(canvas: HTMLCanvasElement, mask: PhotoMask | null, toMask: Affine, box?: Box): void {
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
  renderMaskOverlay(img.data, bw, mask, shifted, { x0: 0, y0: 0, x1: bw - 1, y1: bh - 1 });
  ctx.putImageData(img, b.x0, b.y0);
}

/** The photo with its removed background, as a small picture (sidebar). */
export function PhotoThumb({ photo, mask, toMask, crop }: { photo: TransformedPhoto; mask: PhotoMask | null; toMask: Affine; crop: CropRect }) {
  const img = useRef<HTMLCanvasElement>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const { width: W, height: H } = photo.raster;
  useLayoutEffect(() => {
    img.current?.getContext('2d')?.drawImage(photo.canvas, 0, 0);
  }, [photo]);
  useLayoutEffect(() => {
    if (ov.current) paintOverlay(ov.current, mask, toMask);
  }, [photo, mask, toMask]);
  return (
    <div className="crop-preview" style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, ${Math.round((320 * W) / H)}px)` }}>
      <canvas ref={img} width={W} height={H} />
      <canvas ref={ov} width={W} height={H} className="mask-layer" />
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
  /** The untransformed photo at mask resolution, for the wand. */
  maskBase: SourceRaster;
  crop: CropRect;
  /** Size of one grid cell in photo pixels. */
  cellSize: number;
  zoom: number;
  displayWidth: number;
  tools: PhotoTools;
  onCrop: (patch: { cx?: number; cy?: number; zoom?: number }) => void;
  onMask: (m: PhotoMask | null) => void;
}

type Gesture =
  | { kind: 'move'; x: number; y: number; cx: number; cy: number }
  | { kind: 'pinch'; dist: number; zoom: number }
  | { kind: 'brush'; data: Uint8Array; last: [number, number] };

export function PhotoStage({ photo, mask, maskBase, crop, cellSize, zoom, displayWidth, tools, onCrop, onMask }: StageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const imgCanvas = useRef<HTMLCanvasElement>(null);
  const ovCanvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const gesture = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [dragging, setDragging] = useState(false);
  const { width: W, height: H } = photo.raster;
  const mw = maskBase.width;
  const mh = maskBase.height;
  const toMask = photoToMask(photo, mw, mh);
  const toPhoto = invert(toMask);
  const scale = displayWidth / W;
  const brushPx = Math.max(1, tools.brush * cellSize);

  useLayoutEffect(() => {
    imgCanvas.current?.getContext('2d')?.drawImage(photo.canvas, 0, 0);
  }, [photo]);

  useLayoutEffect(() => {
    if (ovCanvas.current) paintOverlay(ovCanvas.current, mask, photoToMask(photo, mw, mh));
  }, [photo, mask, mw, mh]);

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms the crop.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onCrop({ zoom: clampZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01)) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onCrop]);

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
    if (!box || !ovCanvas.current) return;
    // The changed mask box, mapped back to photo pixels.
    const corners = [
      apply(toPhoto, box.x0, box.y0),
      apply(toPhoto, box.x1 + 1, box.y0),
      apply(toPhoto, box.x0, box.y1 + 1),
      apply(toPhoto, box.x1 + 1, box.y1 + 1),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    paintOverlay(ovCanvas.current, { width: mw, height: mh, data: g.data }, toMask, {
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
    if (tools.tool === 'move') {
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        gesture.current = { kind: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom };
      } else {
        gesture.current = { kind: 'move', x: e.clientX, y: e.clientY, cx: (crop.x + crop.w / 2) / W, cy: (crop.y + crop.h / 2) / H };
      }
      setDragging(true);
      return;
    }
    if (tools.tool === 'wand') {
      const [mx, my] = apply(toMask, p[0], p[1]);
      if (mx < 0 || my < 0 || mx >= mw || my >= mh) return;
      const region = selectSimilar(maskBase, mx, my, tools.tolerance);
      onMask(normalizeMask(combineMask(mask, region, tools.erase ? 1 : 0, mw, mh)));
      return;
    }
    const g: Gesture = { kind: 'brush', data: mask ? mask.data.slice() : emptyMask(mw, mh).data, last: p };
    gesture.current = g;
    strokeTo(g, p);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const p = toImage(e);
    setHover(p);
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'brush') strokeTo(g, p);
    else if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      onCrop({ zoom: clampZoom((g.zoom * Math.hypot(a[0] - b[0], a[1] - b[1])) / Math.max(1, g.dist)) });
    } else if (g.kind === 'move') {
      const dx = (e.clientX - g.x) / displayWidth;
      const dy = (e.clientY - g.y) / (displayWidth * (H / W));
      const hx = crop.w / W / 2;
      const hy = crop.h / H / 2;
      onCrop({ cx: clamp(g.cx + dx, hx, 1 - hx), cy: clamp(g.cy + dy, hy, 1 - hy) });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    // Fingers do not hover, so do not leave the brush ring behind.
    if (e.pointerType !== 'mouse') setHover(null);
    const g = gesture.current;
    if (g?.kind === 'brush') onMask(normalizeMask({ width: mw, height: mh, data: g.data }));
    gesture.current = null;
    setDragging(false);
    // Lifting one finger of a pinch carries on as a move with the other.
    if (g?.kind === 'pinch' && pointers.current.size === 1) {
      const [x, y] = [...pointers.current.values()][0];
      gesture.current = { kind: 'move', x, y, cx: (crop.x + crop.w / 2) / W, cy: (crop.y + crop.h / 2) / H };
      setDragging(true);
    }
  };

  const cursor = tools.tool === 'move' ? (dragging ? 'grabbing' : 'grab') : tools.tool === 'wand' ? 'crosshair' : 'none';
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
      <div className={`crop-frame ${tools.tool === 'move' ? '' : 'faint'}`} style={cropStyle(crop, W, H)} />
      {hover && tools.tool === 'brush' && (
        <div
          className={`brush-cursor ${tools.erase ? 'erase' : 'keep'}`}
          style={{ left: hover[0] * scale, top: hover[1] * scale, width: brushPx * 2 * scale, height: brushPx * 2 * scale }}
        />
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return lo > hi ? 0.5 : Math.max(lo, Math.min(hi, v));
}

function clampZoom(z: number): number {
  return Math.round(Math.max(1, Math.min(4, z)) * 100) / 100;
}

interface ToolbarProps {
  tools: PhotoTools;
  onTools: (patch: Partial<PhotoTools>) => void;
  mask: PhotoMask | null;
  maskBase: SourceRaster;
  zoom: number;
  onZoom: (z: number) => void;
  onMask: (m: PhotoMask | null) => void;
}

export function PhotoToolbar({ tools, onTools, mask, maskBase, zoom, onZoom, onMask }: ToolbarProps) {
  const mw = maskBase.width;
  const mh = maskBase.height;
  const removed = maskCoverage(mask);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setNotice(null), [tools.tool, tools.erase]);
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
  const hint =
    tools.tool === 'move'
      ? 'Drag the frame to choose what goes in the puzzle. Pinch or Ctrl+scroll to zoom.'
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
            { value: 'move', label: 'Frame', icon: <IconMove size={16} /> },
            { value: 'brush', label: 'Brush', icon: <IconBrush size={16} /> },
            { value: 'wand', label: 'Wand', icon: <IconWand size={16} /> },
          ]}
        />
        {tools.tool !== 'move' && (
          <Segmented
            label="Brush mode"
            value={tools.erase ? 'erase' : 'keep'}
            onChange={(v) => onTools({ erase: v === 'erase' })}
            options={[
              { value: 'erase', label: 'Remove' },
              { value: 'keep', label: 'Keep' },
            ]}
          />
        )}
        <div className="tool-slider">
          {tools.tool === 'move' && <Slider label="Zoom" value={zoom} min={1} max={4} step={0.05} onChange={onZoom} format={(v) => `${v.toFixed(2)}×`} />}
          {tools.tool === 'brush' && <Slider label="Brush size" value={tools.brush} min={0.5} max={8} step={0.5} onChange={(brush) => onTools({ brush })} format={(v) => `${v} cells`} />}
        </div>
      </div>
      <div className="tool-row">
        <button className="btn small" onClick={autoBackground} title="Remove the plain background around the subject">
          <IconSparkles size={16} /> Remove background
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
      {notice ? (
        <p className="hint warn" role="status">
          {notice}
        </p>
      ) : (
        <p className="hint">{hint}</p>
      )}
    </div>
  );
}
