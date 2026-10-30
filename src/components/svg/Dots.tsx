import type { DotsPuzzle } from '../../types';
import { SvgFrame } from './common';

const CELL = 10;
const MARGIN = 14;

function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`);
  }
  return `M${pts.join('L')}z`;
}

export function DotsSvg({ puzzle, solution }: { puzzle: DotsPuzzle; solution: boolean }) {
  const { width, height, loops, total } = puzzle;
  const W = width * CELL + MARGIN * 2;
  const H = height * CELL + MARGIN * 2;
  const px = (v: number) => MARGIN + v * CELL;
  // Sizes follow the drawing size so labels print at roughly the same physical size for any grid.
  const D = Math.max(W, H);
  const fontSize = Math.min(14, Math.max(4.5, D * 0.016)) * (total >= 100 ? 0.9 : 1);
  const r = Math.min(3, Math.max(1.1, D * 0.004));
  const labelOffset = fontSize * 1.05;

  return (
    <SvgFrame width={W} height={H}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      {solution && (
        <path
          d={loops.map((l) => `M${l.points.map(([x, y]) => `${px(x)} ${px(y)}`).join('L')}z`).join('')}
          fill="rgba(0,0,0,0.12)"
          fillRule="evenodd"
          stroke="#111"
          strokeWidth={0.8}
          strokeLinejoin="round"
        />
      )}
      {loops.map((loop, li) => (
        <g key={li}>
          {loop.points.map(([x, y], i) => {
            const n = loop.start + i;
            const [nx, ny] = loop.normals[i];
            const cx = px(x);
            const cy = px(y);
            // Dots closer than a label width get their label pushed further out on alternate dots.
            const [qx, qy] = loop.points[(i - 1 + loop.points.length) % loop.points.length];
            const close = Math.hypot(x - qx, y - qy) * CELL < fontSize * 1.8;
            const k = close && i % 2 === 1 ? 1.9 : 1;
            const lx = cx + nx * labelOffset * k;
            const ly = cy + ny * labelOffset * k;
            const first = i === 0;
            const last = i === loop.points.length - 1;
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r} fill="#111" />
                {first && <circle cx={cx} cy={cy} r={r + fontSize * 0.3} fill="none" stroke="#111" strokeWidth={r * 0.4} />}
                <text x={lx} y={ly} fontSize={fontSize} textAnchor="middle" dominantBaseline="central" fill="#111" fontWeight={500}>
                  {n}
                </text>
                {last && (
                  <path
                    d={starPath(
                      lx + nx * fontSize * 0.35 + (Math.abs(nx) < 0.5 ? fontSize * 1.05 : 0),
                      ly + ny * fontSize * 0.35 + (Math.abs(nx) < 0.5 ? 0 : fontSize * 0.85),
                      fontSize * 0.4,
                    )}
                    fill="#111"
                  />
                )}
              </g>
            );
          })}
        </g>
      ))}
    </SvgFrame>
  );
}
