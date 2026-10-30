/** Identifiers of the puzzle modes Mosaica can generate. */
export type ModeId =
  | 'nonogram'
  | 'colorNonogram'
  | 'colorByCode'
  | 'mystery'
  | 'fillapix'
  | 'logipix'
  | 'labymage'
  | 'dots';

/** How the source image is reduced to cells for a given mode. */
export type PixelKind = 'binary' | 'palette' | 'mystery';

export type LabelStyle = 'number' | 'sums';
export type SumOps = 'add' | 'addsub' | 'mul' | 'mixed';
export type Difficulty = 'easy' | 'normal';

export interface MosaicSettings {
  gridWidth: number;
  gridHeight: number;
  lockAspect: boolean;
  /** Crop: zoom factor (1 = whole image, cover-fit) and centre point in 0..1. */
  zoom: number;
  cx: number;
  cy: number;
  /** Image adjustments, each -100..100. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Binary modes: luminance cut 0..100 (cells darker than this are filled). */
  threshold: number;
  invert: boolean;
  dither: boolean;
  /** 0..3 passes of speckle removal. */
  despeckle: number;
  /** Palette modes. */
  colors: number;
  blankLightest: boolean;
  /** Colour-by-code. */
  labelStyle: LabelStyle;
  sumOps: SumOps;
  /** Connect the dots. */
  dotsDetail: number;
  dotsMinRegion: number;
  dotsMaxDots: number;
  /** Longest allowed gap between two dots, in cells. */
  dotsMaxGap: number;
  /** Logipix. */
  logipixMaxLen: number;
  logipixColor: boolean;
  /** Fill-a-Pix. */
  fillapixDifficulty: Difficulty;
  /** Labymage: how twisty the decoy corridors are (0..100). */
  mazeTwist: number;
  /** Seed for every random choice so a saved puzzle regenerates identically. */
  seed: number;
}

/** The pixel-art version of the image: one palette index per cell. */
export interface PixelGrid {
  width: number;
  height: number;
  /** Row-major palette indices. In 'mystery' kind these are shape codes 0..9. */
  cells: number[];
  /** Hex colours. For binary grids: [blank, ink]. */
  palette: string[];
  /** True when index 0 means "leave the cell empty". */
  blank: boolean;
  kind: PixelKind;
}

/* ---------- Puzzle data (what gets printed) ---------- */

export interface Clue {
  n: number;
  c: number;
}

export interface NonogramPuzzle {
  kind: 'nonogram';
  width: number;
  height: number;
  rows: Clue[][];
  cols: Clue[][];
  color: boolean;
  palette: string[];
  cells: number[];
}

export interface LegendEntry {
  code: number;
  color: string;
}

export interface ColorByCodePuzzle {
  kind: 'colorByCode';
  width: number;
  height: number;
  cells: number[];
  labels: string[];
  palette: string[];
  legend: LegendEntry[];
  blank: boolean;
}

export interface MysteryPuzzle {
  kind: 'mystery';
  width: number;
  height: number;
  /** Shape code per cell, 0..9. */
  cells: number[];
}

export interface FillAPixPuzzle {
  kind: 'fillapix';
  width: number;
  height: number;
  /** -1 = no clue, otherwise 0..9. */
  clues: number[];
  solution: number[];
  /** Cells that had to be given away because logic alone could not reach them. */
  givens: number[];
}

export interface LogipixPath {
  cells: number[];
  color: number;
}

export interface LogipixPuzzle {
  kind: 'logipix';
  width: number;
  height: number;
  color: boolean;
  palette: string[];
  paths: LogipixPath[];
}

export type Side = 'N' | 'E' | 'S' | 'W';

export interface MazePortal {
  cell: number;
  side: Side;
}

export interface LabymagePuzzle {
  kind: 'labymage';
  /** Maze dimensions (twice the picture grid). */
  width: number;
  height: number;
  /** Bitmask per cell of open sides: 1 = N, 2 = E, 4 = S, 8 = W. */
  open: number[];
  /** Cells of the solution route from entrance to exit. */
  path: number[];
  entrance: MazePortal | null;
  exit: MazePortal | null;
}

export interface DotLoop {
  /** Vertex positions in cell units, in drawing order. */
  points: [number, number][];
  /** Label direction hints (outward normal) per point. */
  normals: [number, number][];
  /** Number of the first dot in this loop. */
  start: number;
}

export interface DotsPuzzle {
  kind: 'dots';
  width: number;
  height: number;
  loops: DotLoop[];
  total: number;
}

export type Puzzle =
  | NonogramPuzzle
  | ColorByCodePuzzle
  | MysteryPuzzle
  | FillAPixPuzzle
  | LogipixPuzzle
  | LabymagePuzzle
  | DotsPuzzle;

/* ---------- Persistence ---------- */

export interface MosaicRecord {
  id: string;
  title: string;
  mode: ModeId;
  createdAt: number;
  updatedAt: number;
  settings: MosaicSettings;
  /** Source image, kept so the mosaic can be re-tuned later. */
  source: Blob;
  sourceWidth: number;
  sourceHeight: number;
  grid: PixelGrid;
  puzzle: Puzzle;
  /** PNG data URL of the pixel art, for the gallery. */
  thumbnail: string;
}

export type PaperSize = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
