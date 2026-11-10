import type { ModeId, MosaicSettings, PixelGrid, PixelKind, Puzzle } from '../../types';
import { generateColorByCode } from './colorByCode';
import { generateDots } from './dots';
import { generateFillAPix } from './fillapix';
import { generateLabymage } from './labymage';
import { generateLogipix } from './logipix';
import { generateMystery } from './mystery';
import { generateNonogram } from './nonogram';
import { generateWhodunit } from './whodunit';

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
  kind: (s: MosaicSettings) => PixelKind;
  /** Which optional setting groups the sidebar shows. */
  settings: SettingKey[];
  defaultWidth: number;
  maxWidth: number;
  /** Settings forced on by the mode. */
  force?: Partial<MosaicSettings>;
  /** Made in its own editor from several photos, not from the pixel art of one picture. */
  standalone?: boolean;
  /** Defaults applied when the mode is chosen (the user can still change them). */
  defaults?: Partial<MosaicSettings>;
  generate: (grid: PixelGrid, s: MosaicSettings) => Puzzle;
}

export const MODES: ModeDef[] = [
  {
    id: 'nonogram',
    kind: () => 'binary',
    settings: ['threshold', 'dither'],
    defaultWidth: 30,
    maxWidth: 80,
    generate: (g) => generateNonogram(g, false),
  },
  {
    id: 'colorNonogram',
    kind: () => 'palette',
    settings: ['colors', 'dither'],
    defaultWidth: 25,
    maxWidth: 60,
    force: { blankLightest: true },
    generate: (g) => generateNonogram(g, true),
  },
  {
    id: 'colorByCode',
    kind: () => 'palette',
    settings: ['colors', 'blankLightest', 'dither', 'labelStyle'],
    defaultWidth: 30,
    maxWidth: 70,
    generate: (g, s) => generateColorByCode(g, s.labelStyle, s.sumOps, s.seed),
  },
  {
    id: 'mystery',
    kind: () => 'mystery',
    settings: ['threshold', 'dither'],
    defaultWidth: 30,
    maxWidth: 60,
    defaults: { dither: true, ditherAmount: 100, threshold: 60 },
    generate: (g) => generateMystery(g),
  },
  {
    id: 'fillapix',
    kind: () => 'binary',
    settings: ['threshold', 'fillapix'],
    defaultWidth: 25,
    maxWidth: 45,
    generate: (g, s) => generateFillAPix(g, { difficulty: s.fillapixDifficulty, seed: s.seed }),
  },
  {
    id: 'logipix',
    kind: (s) => (s.logipixColor ? 'palette' : 'binary'),
    settings: ['threshold', 'colors', 'logipix'],
    defaultWidth: 25,
    maxWidth: 50,
    force: { blankLightest: true },
    generate: (g, s) => generateLogipix(g, { maxLen: s.logipixMaxLen, color: s.logipixColor, seed: s.seed }),
  },
  {
    id: 'labymage',
    kind: () => 'binary',
    settings: ['threshold', 'maze'],
    defaultWidth: 24,
    maxWidth: 50,
    generate: (g, s) => generateLabymage(g, { twist: s.mazeTwist, seed: s.seed }),
  },
  {
    id: 'dots',
    kind: () => 'binary',
    settings: ['threshold', 'dots'],
    defaultWidth: 60,
    maxWidth: 120,
    generate: (g, s) => generateDots(g, { detail: s.dotsDetail, minRegion: s.dotsMinRegion, maxDots: s.dotsMaxDots, maxGap: s.dotsMaxGap }),
  },
  {
    id: 'whodunit',
    kind: () => 'palette',
    settings: [],
    defaultWidth: 6,
    maxWidth: 8,
    standalone: true,
    generate: (_g, s) => generateWhodunit({ size: s.whodunitSize, difficulty: s.whodunitDifficulty, seed: s.seed }),
  },
];

/** Where a mosaic of this mode is edited. */
export function editorPath(mode: ModeId, id?: string): string {
  const base = MODE_BY_ID[mode]?.standalone ? '/whodunit' : id ? '/edit' : '/new';
  return id ? `${base}/${id}` : base;
}

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
    cropRatio: 'free',
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
    restoreContrast: 0,
    threshold: 50,
    invert: false,
    dither: false,
    despeckle: 0,
    converter: 2,
    cellColor: 'main',
    minRegion: 3,
    ditherStyle: 'pattern',
    ditherAmount: 50,
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
    whodunitSize: 6,
    whodunitDifficulty: 'normal',
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

/**
 * Values for settings that mosaics saved before they existed must get, so
 * reopening one regenerates the same puzzle. Applied under the saved settings.
 */
export const LEGACY_SETTINGS: Partial<MosaicSettings> = {
  converter: 1,
  cellColor: 'average',
  minRegion: 0,
  ditherStyle: 'diffusion',
  ditherAmount: 100,
  despeckle: 1,
};

/** Settings of a saved mosaic, with anything it predates filled in the way it was made. */
export function loadSettings(mode: ModeId, saved: MosaicSettings): MosaicSettings {
  const legacy = saved.converter === undefined ? LEGACY_SETTINGS : {};
  return { ...defaultSettings(mode, saved.seed), ...legacy, ...saved };
}
