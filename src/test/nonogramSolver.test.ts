import { describe, expect, it } from 'vitest';
import type { PixelGrid } from '../types';
import { generateNonogram } from '../lib/modes/nonogram';
import { analyzeNonogram } from '../lib/modes/nonogramSolver';

function binaryGrid(rows: string[]): PixelGrid {
  const width = rows[0].length;
  const height = rows.length;
  const cells = rows.join('').split('').map((c) => (c === '#' ? 1 : 0));
  return { width, height, cells, palette: ['#ffffff', '#000000'], blank: true, kind: 'binary' };
}

// A 30 × 43 portrait whose thin right-hand sliver can shift one column
// without changing a single clue.
const PORTRAIT = [
  '.......###########............',
  '.......#############..........',
  '.......####..########.........',
  '.....###.....##...##..........',
  '.....####...###.#.............',
  '......#############...........',
  '....################..........',
  '.....###############..........',
  '.....###......................',
  '.....##.......................',
  '......................##......',
  '.......................##.....',
  '........................#.....',
  '...##...................##....',
  '...##..................###....',
  '..###..................###....',
  '..##...........####....###....',
  '...##.......######.....###....',
  '...######..########....###....',
  '...######..##########..##.....',
  '...######....#####.##..####...',
  '...######.....####......##....',
  '...#####........##.......##...',
  '...######................##...',
  '...####.#.....................',
  '...###..................##....',
  '....##..................##....',
  '....##..#.....................',
  '.....##.#####.................',
  '.....########.................',
  '......#######.................',
  '......########................',
  '......########................',
  '.......########...............',
  '.......#####..#...............',
  '........######................',
  '.......#######................',
  '......######.......#..........',
  '.....#####.......###...##.....',
  '....######....#####....##.....',
  '...################...###.....',
  '.#################..#####.....',
  '##################.#######....',
];

describe('nonogram solver', () => {
  it('reports a picture that line logic fully determines as unique', () => {
    const g = binaryGrid(['###.#', '#.#..', '###.#', '....#', '#####']);
    const a = analyzeNonogram(generateNonogram(g, false));
    expect(a.status).toBe('unique');
    expect(a.unknown).toEqual([]);
  });

  it('spots the checkerboard ambiguity', () => {
    const g = binaryGrid(['#.', '.#']);
    const a = analyzeNonogram(generateNonogram(g, false));
    expect(a.status).toBe('ambiguous');
    expect(a.ambiguous).toEqual([0, 1, 2, 3]);
  });

  it('finds the shifting sliver in a real portrait', () => {
    const a = analyzeNonogram(generateNonogram(binaryGrid(PORTRAIT), false), { budgetMs: 5000 });
    expect(a.status).toBe('ambiguous');
    expect(a.unknown.length).toBe(22);
    const w = 30;
    const cells = a.ambiguous.map((i) => [Math.floor(i / w) + 1, (i % w) + 1]);
    expect(cells).toEqual([
      [11, 23], [11, 25],
      [21, 23], [21, 27],
      [22, 25], [22, 27],
      [23, 25], [23, 27],
      [24, 25], [24, 27],
      [26, 25], [26, 27],
      [27, 25], [27, 27],
    ]);
  });

  it('handles colour clues: runs of different colours may touch', () => {
    const g: PixelGrid = {
      width: 3,
      height: 2,
      cells: [1, 2, 0, 0, 2, 1],
      palette: ['#fff', '#f00', '#00f'],
      blank: true,
      kind: 'palette',
    };
    const a = analyzeNonogram(generateNonogram(g, true));
    expect(a.status).toBe('unique');
  });

  it('colour puzzle with a genuine ambiguity', () => {
    // A red checkerboard in the corner next to a blue edge: the two red cells can swap.
    const g: PixelGrid = { width: 3, height: 3, cells: [1, 0, 2, 0, 1, 2, 2, 2, 2], palette: ['#fff', '#f00', '#00f'], blank: true, kind: 'palette' };
    const a = analyzeNonogram(generateNonogram(g, true));
    expect(a.status).toBe('ambiguous');
    expect(a.ambiguous).toEqual([0, 1, 3, 4]);
  });
});
