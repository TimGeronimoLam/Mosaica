import type { PixelGrid } from '../types';
import { hexToRgb, luminance } from './color';
import { MYSTERY_SHAPES } from './pixelize';

/**
 * What a touched-up cell should show, independent of the current palette so
 * edits survive re-quantising, changing mode or resizing the grid:
 * '_' = blank paper, '#rrggbb' = the palette colour nearest to this,
 * 'm0'..'m9' = a mystery-portrait shape.
 */
export type EditToken = string;

export const BLANK: EditToken = '_';

/** Cell touch-ups painted over the automatic pixel art, for a grid of width x height. */
export interface CellEdits {
  width: number;
  height: number;
  cells: Record<number, EditToken>;
}

export function editCount(e: CellEdits | null | undefined): number {
  return e ? Object.keys(e.cells).length : 0;
}

/** The same edits on a grid of another size (nearest cell). */
export function remapEdits(e: CellEdits, width: number, height: number): CellEdits {
  if (e.width === width && e.height === height) return e;
  const cells: Record<number, EditToken> = {};
  for (let y = 0; y < height; y++) {
    const sy = Math.min(e.height - 1, Math.floor(((y + 0.5) * e.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(e.width - 1, Math.floor(((x + 0.5) * e.width) / width));
      const t = e.cells[sy * e.width + sx];
      if (t !== undefined) cells[y * width + x] = t;
    }
  }
  return { width, height, cells };
}

function coverage(code: number): number {
  const s = MYSTERY_SHAPES[code] ?? MYSTERY_SHAPES[0];
  return (s[0] + s[1] + s[2] + s[3]) / 4;
}

function nearest(palette: string[], rgb: [number, number, number]): number {
  let best = 0;
  let bestD = Infinity;
  palette.forEach((hex, i) => {
    const [r, g, b] = hexToRgb(hex);
    const d = 0.3 * (r - rgb[0]) ** 2 + 0.59 * (g - rgb[1]) ** 2 + 0.11 * (b - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The cell value a token stands for in this grid. */
export function resolveToken(grid: PixelGrid, token: EditToken): number {
  const shape = token[0] === 'm' ? Math.max(0, Math.min(9, Number(token.slice(1)) || 0)) : -1;
  const hex = token[0] === '#' ? hexToRgb(token) : null;
  const dark = hex ? luminance(hex[0] / 255, hex[1] / 255, hex[2] / 255) < 0.5 : shape >= 0 ? coverage(shape) >= 0.5 : false;
  if (grid.kind === 'mystery') {
    if (shape >= 0) return shape;
    return dark ? 9 : 0;
  }
  if (grid.kind === 'binary') return dark ? 1 : 0;
  if (token === BLANK) return grid.blank ? 0 : nearest(grid.palette, [255, 255, 255]);
  if (hex) return nearest(grid.palette, hex);
  const g = Math.round((1 - coverage(shape)) * 255);
  return nearest(grid.palette, [g, g, g]);
}

/** The token that paints a cell with value v of this grid. */
export function tokenForValue(grid: PixelGrid, v: number): EditToken {
  if (grid.kind === 'mystery') return v === 0 ? BLANK : `m${v}`;
  if (grid.blank && v === 0) return BLANK;
  return grid.palette[v] ?? BLANK;
}

/** The grid with the touch-ups painted on top. */
export function applyEdits(grid: PixelGrid, edits: CellEdits | null | undefined): PixelGrid {
  if (!edits || editCount(edits) === 0) return grid;
  const e = remapEdits(edits, grid.width, grid.height);
  const cells = grid.cells.slice();
  const cache = new Map<EditToken, number>();
  for (const key of Object.keys(e.cells)) {
    const i = Number(key);
    if (i < 0 || i >= cells.length) continue;
    const t = e.cells[i];
    let v = cache.get(t);
    if (v === undefined) {
      v = resolveToken(grid, t);
      cache.set(t, v);
    }
    cells[i] = v;
  }
  return { ...grid, cells };
}

/** Set (or with token null, clear) the edits of some cells. Null when nothing is left. */
export function setCells(edits: CellEdits | null, width: number, height: number, indices: Iterable<number>, token: EditToken | null): CellEdits | null {
  const base = edits ? remapEdits(edits, width, height) : { width, height, cells: {} };
  const cells = { ...base.cells };
  for (const i of indices) {
    if (token === null) delete cells[i];
    else cells[i] = token;
  }
  return Object.keys(cells).length ? { width, height, cells } : null;
}

/** The 4-connected area of cells with the same value as `start`. */
export function floodCells(grid: PixelGrid, start: number): number[] {
  const { width: w, height: h, cells } = grid;
  const v = cells[start];
  const seen = new Uint8Array(w * h);
  const out: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    out.push(p);
    const x = p % w;
    const y = (p - x) / w;
    const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of next) {
      if (q >= 0 && !seen[q] && cells[q] === v) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return out;
}
