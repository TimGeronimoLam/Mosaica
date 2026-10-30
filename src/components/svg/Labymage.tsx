import type { LabymagePuzzle, Side } from '../../types';
import { SvgFrame } from './common';

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const CELL = 6;
const MARGIN = 12;

export function LabymageSvg({ puzzle, solution }: { puzzle: LabymagePuzzle; solution: boolean }) {
  const { width, height, open, entrance, exit, path } = puzzle;
  const ox = MARGIN;
  const oy = MARGIN;
  const Wd = width * CELL + MARGIN * 2;
  const Hd = height * CELL + MARGIN * 2;

  const portalAt = (cell: number, side: Side) => (entrance?.cell === cell && entrance.side === side) || (exit?.cell === cell && exit.side === side);

  // Horizontal walls: top edges of row y (y = 0..height), merged into runs.
  const segs: string[] = [];
  for (let y = 0; y <= height; y++) {
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      let wall = false;
      if (x < width) {
        if (y < height) {
          const c = y * width + x;
          wall = !(open[c] & N) && !(y === 0 && portalAt(c, 'N'));
        } else {
          const c = (height - 1) * width + x;
          wall = !(open[c] & S) && !portalAt(c, 'S');
        }
      }
      if (wall && runStart < 0) runStart = x;
      if (!wall && runStart >= 0) {
        segs.push(`M${ox + runStart * CELL} ${oy + y * CELL}h${(x - runStart) * CELL}`);
        runStart = -1;
      }
    }
  }
  for (let x = 0; x <= width; x++) {
    let runStart = -1;
    for (let y = 0; y <= height; y++) {
      let wall = false;
      if (y < height) {
        if (x < width) {
          const c = y * width + x;
          wall = !(open[c] & W) && !(x === 0 && portalAt(c, 'W'));
        } else {
          const c = y * width + width - 1;
          wall = !(open[c] & E) && !portalAt(c, 'E');
        }
      }
      if (wall && runStart < 0) runStart = y;
      if (!wall && runStart >= 0) {
        segs.push(`M${ox + x * CELL} ${oy + runStart * CELL}v${(y - runStart) * CELL}`);
        runStart = -1;
      }
    }
  }

  const arrow = (p: { cell: number; side: Side }, inward: boolean, key: string) => {
    const cx = ox + (p.cell % width) * CELL + CELL / 2;
    const cy = oy + Math.floor(p.cell / width) * CELL + CELL / 2;
    const d = CELL * 1.1;
    let ax = cx;
    let ay = cy;
    let angle = 0; // pointing direction in degrees, 0 = right
    if (p.side === 'N') {
      ay = oy - d;
      angle = inward ? 90 : -90;
    } else if (p.side === 'S') {
      ay = oy + height * CELL + d;
      angle = inward ? -90 : 90;
    } else if (p.side === 'W') {
      ax = ox - d;
      angle = inward ? 0 : 180;
    } else {
      ax = ox + width * CELL + d;
      angle = inward ? 180 : 0;
    }
    const s = CELL * 0.55;
    return (
      <g key={key} transform={`translate(${ax} ${ay}) rotate(${angle})`}>
        <path d={`M${-s} ${-s * 0.8}L${s} 0L${-s} ${s * 0.8}z`} fill="#111" />
      </g>
    );
  };

  const solutionCells = solution
    ? path.map((c) => `M${ox + (c % width) * CELL} ${oy + Math.floor(c / width) * CELL}h${CELL}v${CELL}h${-CELL}z`).join('')
    : '';

  return (
    <SvgFrame width={Wd} height={Hd}>
      <rect x={0} y={0} width={Wd} height={Hd} fill="#fff" />
      {solution && <path d={solutionCells} fill="#8c8c8c" />}
      <path d={segs.join('')} fill="none" stroke="#111" strokeWidth={CELL * 0.14} strokeLinecap="square" />
      {entrance && arrow(entrance, true, 'in')}
      {exit && arrow(exit, false, 'out')}
      {!entrance && path.length > 0 && (
        <circle cx={ox + (path[0] % width) * CELL + CELL / 2} cy={oy + Math.floor(path[0] / width) * CELL + CELL / 2} r={CELL * 0.3} fill="#111" />
      )}
      {!exit && path.length > 0 && (
        <circle
          cx={ox + (path[path.length - 1] % width) * CELL + CELL / 2}
          cy={oy + Math.floor(path[path.length - 1] / width) * CELL + CELL / 2}
          r={CELL * 0.3}
          fill="none"
          stroke="#111"
          strokeWidth={CELL * 0.12}
        />
      )}
    </SvgFrame>
  );
}
