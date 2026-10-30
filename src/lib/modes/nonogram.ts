import type { Clue, NonogramPuzzle, PixelGrid } from '../../types';

function runs(values: number[], blank: boolean): Clue[] {
  const out: Clue[] = [];
  let cur = -1;
  let n = 0;
  const flush = () => {
    if (n > 0 && (!blank || cur !== 0)) out.push({ n, c: cur });
    n = 0;
  };
  for (const v of values) {
    if (v === cur) {
      n++;
    } else {
      flush();
      cur = v;
      n = 1;
    }
  }
  flush();
  return out;
}

export function generateNonogram(grid: PixelGrid, color: boolean): NonogramPuzzle {
  const { width, height, cells } = grid;
  const rows: Clue[][] = [];
  const cols: Clue[][] = [];
  for (let y = 0; y < height; y++) {
    rows.push(runs(cells.slice(y * width, (y + 1) * width), true));
  }
  for (let x = 0; x < width; x++) {
    const col: number[] = [];
    for (let y = 0; y < height; y++) col.push(cells[y * width + x]);
    cols.push(runs(col, true));
  }
  return { kind: 'nonogram', width, height, rows, cols, color, palette: grid.palette, cells };
}
