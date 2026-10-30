import type { Puzzle } from '../types';
import { ColorByCodeSvg, FillAPixSvg, LogipixSvg, MysterySvg, NonogramSvg } from './svg/Grids';
import { LabymageSvg } from './svg/Labymage';
import { DotsSvg } from './svg/Dots';

export function PuzzleSvg({ puzzle, solution = false }: { puzzle: Puzzle; solution?: boolean }) {
  switch (puzzle.kind) {
    case 'nonogram':
      return <NonogramSvg puzzle={puzzle} solution={solution} />;
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
  }
}

/** Short description printed next to the title, e.g. "30 × 40 cells · dots 1–270". */
export function puzzleSummary(p: Puzzle): string {
  switch (p.kind) {
    case 'dots':
      return `${p.width} × ${p.height} · dots 1–${p.total}`;
    case 'labymage':
      return `maze ${p.width} × ${p.height}`;
    case 'fillapix':
      return `${p.width} × ${p.height} · ${p.clues.filter((c) => c >= 0).length} clues`;
    case 'logipix':
      return `${p.width} × ${p.height} · ${p.paths.length} paths`;
    case 'colorByCode':
      return `${p.width} × ${p.height} · ${p.legend.length} codes`;
    default:
      return `${p.width} × ${p.height}`;
  }
}
