import type { MysteryPuzzle, PixelGrid } from '../../types';

export function generateMystery(grid: PixelGrid): MysteryPuzzle {
  return { kind: 'mystery', width: grid.width, height: grid.height, cells: grid.cells };
}
