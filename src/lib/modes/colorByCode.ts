import type { ColorByCodePuzzle, PixelGrid, SumOps } from '../../types';
import { createRng, type Rng } from '../rng';

const MINUS = '−';
const TIMES = '×';
const DIVIDE = '÷';

/** A small arithmetic expression whose result is `n`. */
export function makeSum(n: number, ops: SumOps, rng: Rng): string {
  const choices: string[] = [];
  if (ops === 'add' || ops === 'addsub' || ops === 'mixed') {
    const a = rng.int(n + 1);
    choices.push(`${a}+${n - a}`);
  }
  if (ops === 'addsub' || ops === 'mixed') {
    const b = 1 + rng.int(9);
    choices.push(`${n + b}${MINUS}${b}`);
  }
  if (ops === 'mul' || ops === 'mixed') {
    const factors: [number, number][] = [];
    for (let a = 1; a <= n; a++) if (n % a === 0) factors.push([a, n / a]);
    if (n === 0) factors.push([0, 1 + rng.int(9)]);
    const f = rng.pick(factors);
    choices.push(`${f[0]}${TIMES}${f[1]}`);
    const d = 2 + rng.int(8);
    choices.push(`${n * d}${DIVIDE}${d}`);
  }
  return rng.pick(choices);
}

export function generateColorByCode(grid: PixelGrid, labelStyle: 'number' | 'sums', sumOps: SumOps, seed: number): ColorByCodePuzzle {
  const rng = createRng(seed ^ 0x51ab);
  const labels = grid.cells.map((c) => (labelStyle === 'sums' ? makeSum(c, sumOps, rng) : String(c)));
  const legend = grid.palette.map((color, code) => ({ code, color }));
  return {
    kind: 'colorByCode',
    width: grid.width,
    height: grid.height,
    cells: grid.cells,
    labels,
    palette: grid.palette,
    legend,
    blank: grid.blank,
  };
}
