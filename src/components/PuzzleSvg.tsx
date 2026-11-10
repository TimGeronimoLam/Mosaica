import type { Puzzle } from '../types';
import type { Messages } from '../i18n';
import { ColorByCodeSvg, FillAPixSvg, LogipixSvg, MysterySvg, NonogramSvg } from './svg/Grids';
import { LabymageSvg } from './svg/Labymage';
import { DotsSvg } from './svg/Dots';
import { WhodunitSvg } from './svg/Whodunit';

/** `marks` outlines cells (row-major indices) the editor wants to point at, e.g. an ambiguity. */
export function PuzzleSvg({ puzzle, solution = false, marks }: { puzzle: Puzzle; solution?: boolean; marks?: number[] }) {
  switch (puzzle.kind) {
    case 'nonogram':
      return <NonogramSvg puzzle={puzzle} solution={solution} marks={marks} />;
    case 'colorByCode':
      return <ColorByCodeSvg puzzle={puzzle} solution={solution} />;
    case 'mystery':
      return <MysterySvg puzzle={puzzle} solution={solution} />;
    case 'fillapix':
      return <FillAPixSvg puzzle={puzzle} solution={solution} />;
    case 'logipix':
      return <LogipixSvg puzzle={puzzle} solution={solution} />;
    case 'labymage':
      return <LabymageSvg puzzle={puzzle} solution={solution} />;
    case 'dots':
      return <DotsSvg puzzle={puzzle} solution={solution} />;
    case 'whodunit':
      return <WhodunitSvg puzzle={puzzle} solution={solution} />;
  }
}

/** Short description printed next to the title, e.g. "30 × 40 cells · dots 1–270". */
export function puzzleSummary(p: Puzzle, t: Messages): string {
  const s = t.summary;
  switch (p.kind) {
    case 'dots':
      return s.dots(p.width, p.height, p.total);
    case 'labymage':
      return s.maze(p.width, p.height);
    case 'fillapix':
      return s.clues(p.width, p.height, p.clues.filter((c) => c >= 0).length);
    case 'logipix':
      return s.paths(p.width, p.height, p.paths.length);
    case 'whodunit':
      return s.whodunit(p.width, p.people.length - 1);
    case 'colorByCode':
      return s.codes(p.width, p.height, p.legend.length);
    default:
      return s.size(p.width, p.height);
  }
}
