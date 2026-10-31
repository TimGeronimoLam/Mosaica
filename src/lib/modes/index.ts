import type { ModeId, MosaicSettings, PixelGrid, PixelKind, Puzzle } from '../../types';
import { generateColorByCode } from './colorByCode';
import { generateDots } from './dots';
import { generateFillAPix } from './fillapix';
import { generateLabymage } from './labymage';
import { generateLogipix } from './logipix';
import { generateMystery } from './mystery';
import { generateNonogram } from './nonogram';

export type SettingKey =
  | 'threshold'
  | 'colors'
  | 'blankLightest'
  | 'dither'
  | 'labelStyle'
  | 'dots'
  | 'logipix'
  | 'fillapix'
  | 'maze';

export interface ModeDef {
  id: ModeId;
  name: string;
  tagline: string;
  /** Printed under the puzzle title so the solver knows what to do. */
  rules: string;
  kind: (s: MosaicSettings) => PixelKind;
  /** Which optional setting groups the sidebar shows. */
  settings: SettingKey[];
  defaultWidth: number;
  maxWidth: number;
  /** Settings forced on by the mode. */
  force?: Partial<MosaicSettings>;
  /** Defaults applied when the mode is chosen (the user can still change them). */
  defaults?: Partial<MosaicSettings>;
  generate: (grid: PixelGrid, s: MosaicSettings) => Puzzle;
}

export const MODES: ModeDef[] = [
  {
    id: 'nonogram',
    name: 'Nonogram',
    tagline: 'One colour. Row and column clues.',
    rules:
      'The numbers tell you the lengths of the runs of filled cells in that row or column, in order. Runs are separated by at least one empty cell. Fill the right cells to reveal the picture.',
    kind: () => 'binary',
    settings: ['threshold', 'dither'],
    defaultWidth: 30,
    maxWidth: 80,
    generate: (g) => generateNonogram(g, false),
  },
  {
    id: 'colorNonogram',
    name: 'Colour nonogram',
    tagline: 'Several colours. Clues carry their colour.',
    rules:
      'Each clue gives the length and colour of a run of cells in that row or column, in order. Runs of different colours may touch; runs of the same colour are separated by at least one empty cell.',
    kind: () => 'palette',
    settings: ['colors', 'dither'],
    defaultWidth: 25,
    maxWidth: 60,
    force: { blankLightest: true },
    generate: (g) => generateNonogram(g, true),
  },
  {
    id: 'colorByCode',
    name: 'Colour by code',
    tagline: 'Every cell has a number. Colour it in.',
    rules: 'Colour each cell with the colour matching its code in the legend. Cells marked 0 stay white.',
    kind: () => 'palette',
    settings: ['colors', 'blankLightest', 'dither', 'labelStyle'],
    defaultWidth: 30,
    maxWidth: 70,
    generate: (g, s) => generateColorByCode(g, s.labelStyle, s.sumOps, s.seed),
  },
  {
    id: 'mystery',
    name: 'Mystery portrait',
    tagline: 'Codes 0 to 9 are shapes. Great for faces.',
    rules:
      'Each code stands for a shape shown in the legend: 0 is empty, 9 is fully black, the others are half squares and triangles. Draw the shape in each cell and a portrait appears. Works best with a photo of a face.',
    kind: () => 'mystery',
    settings: ['threshold', 'dither'],
    defaultWidth: 30,
    maxWidth: 60,
    defaults: { dither: true, despeckle: 0, threshold: 60 },
    generate: (g) => generateMystery(g),
  },
  {
    id: 'fillapix',
    name: 'Fill-a-Pix',
    tagline: 'Minesweeper-style logic. Count the 3x3 block.',
    rules:
      'A number says how many of the cells in the 3x3 block around it (including itself) are filled. Use logic to decide which cells to fill. Shaded cells are given.',
    kind: () => 'binary',
    settings: ['threshold', 'fillapix'],
    defaultWidth: 25,
    maxWidth: 45,
    generate: (g, s) => generateFillAPix(g, { difficulty: s.fillapixDifficulty, seed: s.seed }),
  },
  {
    id: 'logipix',
    name: 'Logipix',
    tagline: 'Link pairs of numbers with paths of that length.',
    rules:
      'Join each pair of equal numbers with a path of exactly that many cells, including both ends. Paths turn only at right angles and never cross. A 1 is a single cell and two 2s sit side by side. Shade every path.',
    kind: (s) => (s.logipixColor ? 'palette' : 'binary'),
    settings: ['threshold', 'colors', 'logipix'],
    defaultWidth: 25,
    maxWidth: 50,
    force: { blankLightest: true },
    generate: (g, s) => generateLogipix(g, { maxLen: s.logipixMaxLen, color: s.logipixColor, seed: s.seed }),
  },
  {
    id: 'labymage',
    name: 'Labymage',
    tagline: 'A maze. Shade your route to find the picture.',
    rules:
      'Find the way from the entrance arrow to the exit arrow. As you go, shade every corridor you are sure of. The route itself draws the picture.',
    kind: () => 'binary',
    settings: ['threshold', 'maze'],
    defaultWidth: 24,
    maxWidth: 50,
    generate: (g, s) => generateLabymage(g, { twist: s.mazeTwist, seed: s.seed }),
  },
  {
    id: 'dots',
    name: 'Connect the dots',
    tagline: 'Numbered dots along the outline.',
    rules:
      'Join the dots in order, starting at the circled 1. When you reach a star, close the shape by drawing back to the circled dot where that section started, then carry on from the next number.',
    kind: () => 'binary',
    settings: ['threshold', 'dots'],
    defaultWidth: 60,
    maxWidth: 120,
    generate: (g, s) => generateDots(g, { detail: s.dotsDetail, minRegion: s.dotsMinRegion, maxDots: s.dotsMaxDots, maxGap: s.dotsMaxGap }),
  },
];

export const MODE_BY_ID: Record<ModeId, ModeDef> = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;

export function defaultSettings(mode: ModeId, seed: number): MosaicSettings {
  const def = MODE_BY_ID[mode];
  return {
    gridWidth: def.defaultWidth,
    gridHeight: def.defaultWidth,
    lockAspect: true,
    rotate: 0,
    flipH: false,
    flipV: false,
    straighten: 0,
    zoom: 1,
    cx: 0.5,
    cy: 0.5,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    autoLevels: false,
    localContrast: 0,
    smooth: 0,
    darkDetails: 0,
    outlines: 0,
    threshold: 50,
    invert: false,
    dither: false,
    despeckle: 1,
    colors: 8,
    blankLightest: true,
    labelStyle: 'number',
    sumOps: 'addsub',
    dotsDetail: 0.7,
    dotsMinRegion: 6,
    dotsMaxDots: 300,
    dotsMaxGap: 4,
    logipixMaxLen: 8,
    logipixColor: false,
    fillapixDifficulty: 'normal',
    mazeTwist: 70,
    seed,
    ...def.defaults,
    ...def.force,
  };
}

/** Apply a mode's forced settings and clamp the grid to what the mode can handle. */
export function normalizeSettings(mode: ModeId, s: MosaicSettings): MosaicSettings {
  const def = MODE_BY_ID[mode];
  const next = { ...s, ...def.force };
  if (next.gridWidth > def.maxWidth) {
    const ratio = next.gridHeight / next.gridWidth;
    next.gridWidth = def.maxWidth;
    next.gridHeight = Math.max(2, Math.round(def.maxWidth * ratio));
  }
  if (next.gridHeight > def.maxWidth * 1.5) {
    const ratio = next.gridWidth / next.gridHeight;
    next.gridHeight = Math.round(def.maxWidth * 1.5);
    next.gridWidth = Math.max(2, Math.round(next.gridHeight * ratio));
  }
  return next;
}

export function generatePuzzle(mode: ModeId, grid: PixelGrid, s: MosaicSettings): Puzzle {
  return MODE_BY_ID[mode].generate(grid, s);
}
