import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PixelGrid } from '../types';
import type { CropRect, TransformedPhoto } from '../lib/image';
import { BLANK, editCount, floodCells, remapEdits, resolveToken, setCells, tokenForValue, type CellEdits, type EditToken } from '../lib/edits';
import { MYSTERY_POLYGONS } from '../lib/pixelize';
import { IconBucket, IconEraser, IconPencil, IconPipette, IconTrash } from './Icons';
import { capture, Segmented, Toggle } from './ui';

export interface PixelTools {
  tool: 'pencil' | 'fill' | 'pick' | 'revert';
  token: EditToken;
  size: number;
  /** Show the photo under the cells. */
  underlay: boolean;
  /** Mark touched-up cells. */
  marks: boolean;
}

export const DEFAULT_PIXEL_TOOLS: PixelTools = { tool: 'pencil', token: BLANK, size: 1, underlay: false, marks: true };

interface Swatch {
  token: EditToken;
  label: string;
  color?: string;
  shape?: number;
}

export function swatchesFor(grid: PixelGrid): Swatch[] {
  if (grid.kind === 'mystery') return MYSTERY_POLYGONS.map((_, v) => ({ token: tokenForValue(grid, v), label: v === 0 ? 'Blank (0)' : `Shape ${v}`, shape: v }));
  if (grid.kind === 'binary') {
    return [
      { token: BLANK, label: 'Blank', color: '#ffffff' },
      { token: '#000000', label: 'Ink', color: '#111111' },
    ];
  }
  return grid.palette.map((color, i) => ({ token: tokenForValue(grid, i), label: grid.blank && i === 0 ? 'Blank (0)' : `Colour ${i}`, color }));
}

function drawShape(ctx: CanvasRenderingContext2D, v: number, x: number, y: number, s: number) {
  const poly = MYSTERY_POLYGONS[v];
  if (!poly) return;
  ctx.beginPath();
  poly.split(' ').forEach((pair, i) => {
    const [px, py] = pair.split(',').map(Number);
    if (i === 0) ctx.moveTo(x + px * s, y + py * s);
    else ctx.lineTo(x + px * s, y + py * s);
  });
  ctx.closePath();
  ctx.fill();
}

interface StageProps {
  /** The pixel art with touch-ups applied. */
  grid: PixelGrid;
  /** The automatic pixel art, before touch-ups. */
  base: PixelGrid;
  edits: CellEdits | null;
  photo: TransformedPhoto;
  crop: CropRect;
  displayWidth: number;
  tools: PixelTools;
  onTools: (patch: Partial<PixelTools>) => void;
  onEdits: (next: CellEdits | null) => void;
}

export function PixelStage({ grid, base, edits, photo, crop, displayWidth, tools, onTools, onEdits }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<{ cells: Set<number>; last: number } | null>(null);
  const [pending, setPending] = useState<Set<number> | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { width: gw, height: gh } = grid;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cell = Math.max(4, Math.min(48, Math.round((displayWidth * dpr) / gw)));
  const edited = useMemo(() => (edits ? remapEdits(edits, gw, gh).cells : {}), [edits, gw, gh]);

  useLayoutEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const W = gw * cell;
    const H = gh * cell;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (tools.underlay) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(photo.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    }
    const value = (i: number) => {
      if (!pending?.has(i)) return grid.cells[i];
      return tools.tool === 'revert' ? base.cells[i] : resolveToken(grid, tools.token);
    };
    ctx.globalAlpha = tools.underlay ? 0.55 : 1;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const v = value(y * gw + x);
        if (grid.kind === 'mystery') {
          ctx.fillStyle = '#111111';
          drawShape(ctx, v, x * cell, y * cell, cell);
        } else if (!(grid.blank && v === 0)) {
          ctx.fillStyle = grid.palette[v] ?? '#000000';
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
    ctx.globalAlpha = 1;
    if (cell >= 6) {
      ctx.lineWidth = 1;
      for (let k = 0; k <= Math.max(gw, gh); k++) {
        ctx.strokeStyle = k % 5 === 0 ? 'rgba(29,34,48,0.32)' : 'rgba(29,34,48,0.12)';
        ctx.beginPath();
        if (k <= gw) {
          ctx.moveTo(k * cell + 0.5, 0);
          ctx.lineTo(k * cell + 0.5, H);
        }
        if (k <= gh) {
          ctx.moveTo(0, k * cell + 0.5);
          ctx.lineTo(W, k * cell + 0.5);
        }
        ctx.stroke();
      }
    }
    if (tools.marks) {
      // A small corner flag on every touched-up cell.
      ctx.fillStyle = '#e4572e';
      const m = Math.max(3, Math.round(cell * 0.32));
      const mark = (i: number) => {
        const x = (i % gw) * cell;
        const y = Math.floor(i / gw) * cell;
        ctx.beginPath();
        ctx.moveTo(x + cell - m, y);
        ctx.lineTo(x + cell, y);
        ctx.lineTo(x + cell, y + m);
        ctx.closePath();
        ctx.fill();
      };
      for (const key of Object.keys(edited)) {
        const i = Number(key);
        if (!(pending?.has(i) && tools.tool === 'revert')) mark(i);
      }
      if (pending && tools.tool !== 'revert') pending.forEach(mark);
    }
  }, [grid, base, edited, pending, photo, crop, cell, gw, gh, tools.underlay, tools.marks, tools.tool, tools.token]);

  const cellAt = (e: { clientX: number; clientY: number }): number | null => {
    const r = canvas.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * gw);
    const y = Math.floor(((e.clientY - r.top) / r.height) * gh);
    return x < 0 || y < 0 || x >= gw || y >= gh ? null : y * gw + x;
  };

  /** Cells under a size x size brush centred on cell i. */
  const brushCells = (i: number, out: Set<number>) => {
    const cx = i % gw;
    const cy = (i - cx) / gw;
    const lo = -Math.floor((tools.size - 1) / 2);
    for (let dy = lo; dy < lo + tools.size; dy++) {
      for (let dx = lo; dx < lo + tools.size; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < gw && y < gh) out.add(y * gw + x);
      }
    }
  };

  /** Cells on the straight line between two cells, so fast strokes leave no gaps. */
  const lineCells = (a: number, b: number, out: Set<number>) => {
    let x0 = a % gw;
    let y0 = Math.floor(a / gw);
    const x1 = b % gw;
    const y1 = Math.floor(b / gw);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      brushCells(y0 * gw + x0, out);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (stroke.current) return;
    const i = cellAt(e);
    if (i === null) return;
    if (tools.tool === 'pick') {
      onTools({ token: tokenForValue(grid, grid.cells[i]), tool: 'pencil' });
      return;
    }
    if (tools.tool === 'fill') {
      onEdits(setCells(edits, gw, gh, floodCells(grid, i), tools.token));
      return;
    }
    capture(canvas.current, e.pointerId);
    const cells = new Set<number>();
    brushCells(i, cells);
    stroke.current = { cells, last: i };
    setPending(new Set(cells));
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const i = cellAt(e);
    setHover(i);
    const s = stroke.current;
    if (!s || i === null || i === s.last) return;
    lineCells(s.last, i, s.cells);
    s.last = i;
    setPending(new Set(s.cells));
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') setHover(null);
    const s = stroke.current;
    stroke.current = null;
    setPending(null);
    if (s) onEdits(setCells(edits, gw, gh, s.cells, tools.tool === 'revert' ? null : tools.token));
  };

  const W = gw * cell;
  const H = gh * cell;
  const showCursor = hover !== null && (tools.tool === 'pencil' || tools.tool === 'revert');
  const lo = -Math.floor((tools.size - 1) / 2);
  return (
    <div className="pixel-stage" style={{ width: displayWidth }}>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        style={{ cursor: tools.tool === 'fill' || tools.tool === 'pick' ? 'crosshair' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
      />
      {showCursor && (
        <div
          className="cell-cursor"
          style={{
            left: `${((((hover % gw) + lo) / gw) * 100).toFixed(3)}%`,
            top: `${(((Math.floor(hover / gw) + lo) / gh) * 100).toFixed(3)}%`,
            width: `${((tools.size / gw) * 100).toFixed(3)}%`,
            height: `${((tools.size / gh) * 100).toFixed(3)}%`,
          }}
        />
      )}
    </div>
  );
}

function SwatchFace({ s }: { s: Swatch }) {
  if (s.shape !== undefined) {
    const poly = MYSTERY_POLYGONS[s.shape];
    return (
      <svg viewBox="0 0 1 1" width="100%" height="100%" aria-hidden="true">
        {poly && <polygon points={poly} fill="#111" />}
      </svg>
    );
  }
  return <span className={`swatch-fill ${s.token === BLANK ? 'blank' : ''}`} style={{ background: s.color }} />;
}

interface ToolbarProps {
  grid: PixelGrid;
  edits: CellEdits | null;
  tools: PixelTools;
  onTools: (patch: Partial<PixelTools>) => void;
  onEdits: (next: CellEdits | null) => void;
}

export function PixelToolbar({ grid, edits, tools, onTools, onEdits }: ToolbarProps) {
  const swatches = swatchesFor(grid);
  const count = editCount(edits);
  const current = resolveToken(grid, tools.token);
  const hint =
    tools.tool === 'pencil'
      ? 'Paint cells with the chosen colour. Your touch-ups stay when you change other settings.'
      : tools.tool === 'fill'
        ? 'Click a cell to recolour the whole area of that colour joined to it.'
        : tools.tool === 'pick'
          ? 'Click a cell to pick up its colour.'
          : 'Brush over touched-up cells to give them back to the automatic result.';
  return (
    <div className="stage-tools" role="toolbar" aria-label="Pixel tools">
      <div className="tool-row">
        <Segmented
          label="Tool"
          value={tools.tool}
          onChange={(tool) => onTools({ tool })}
          options={[
            { value: 'pencil', label: 'Pencil', icon: <IconPencil size={16} /> },
            { value: 'fill', label: 'Fill', icon: <IconBucket size={16} /> },
            { value: 'pick', label: 'Pick', icon: <IconPipette size={16} /> },
            { value: 'revert', label: 'Revert', icon: <IconEraser size={16} /> },
          ]}
        />
        {(tools.tool === 'pencil' || tools.tool === 'revert') && (
          <Segmented
            label="Brush size"
            value={String(tools.size)}
            onChange={(v) => onTools({ size: Number(v) })}
            options={[1, 2, 3, 5].map((n) => ({ value: String(n), label: `${n}×${n}` }))}
          />
        )}
      </div>
      <div className="swatches" role="radiogroup" aria-label="Paint colour">
        {swatches.map((s) => {
          const on = tools.tool !== 'revert' && resolveToken(grid, s.token) === current;
          return (
            <button
              key={s.token + s.label}
              type="button"
              role="radio"
              aria-checked={on}
              className={`swatch ${on ? 'on' : ''}`}
              title={s.label}
              aria-label={s.label}
              onClick={() => onTools({ token: s.token, tool: tools.tool === 'pick' || tools.tool === 'revert' ? 'pencil' : tools.tool })}
            >
              <SwatchFace s={s} />
            </button>
          );
        })}
      </div>
      <div className="tool-row">
        <Toggle label="Photo underneath" checked={tools.underlay} onChange={(underlay) => onTools({ underlay })} />
        <Toggle label="Mark touch-ups" checked={tools.marks} onChange={(marks) => onTools({ marks })} />
        <button className="btn small ghost" onClick={() => onEdits(null)} disabled={!count}>
          <IconTrash size={16} /> Clear {count ? `${count} touch-up${count === 1 ? '' : 's'}` : 'touch-ups'}
        </button>
      </div>
      <p className="hint">{hint}</p>
    </div>
  );
}
