import type { ColorByCodePuzzle, FillAPixPuzzle, LogipixPuzzle, MysteryPuzzle, NonogramPuzzle } from '../../types';
import { contrastText, darken, hexLuminance } from '../../lib/color';
import { MYSTERY_POLYGONS } from '../../lib/pixelize';
import { CELL, CellFills, CellText, GridLines, SvgFrame, legendLayout } from './common';

const PAD = 4;

/* ---------------- Nonogram ---------------- */

export function NonogramSvg({ puzzle, solution }: { puzzle: NonogramPuzzle; solution: boolean }) {
  const { width, height, rows, cols, color, palette } = puzzle;
  const slot = 8;
  const maxRow = Math.max(1, ...rows.map((r) => r.length));
  const maxCol = Math.max(1, ...cols.map((c) => c.length));
  const left = PAD + maxRow * slot + 3;
  const top = PAD + maxCol * slot + 3;
  const W = left + width * CELL + PAD;
  const H = top + height * CELL + PAD;

  const clue = (n: number, c: number, cx: number, cy: number, key: string) => {
    if (!color) {
      return (
        <text key={key} x={cx} y={cy + 0.2} fontSize={5.4}>
          {n}
        </text>
      );
    }
    const hex = palette[c] ?? '#000';
    const light = hexLuminance(hex) > 0.8;
    return (
      <g key={key}>
        <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} rx={1.2} fill={hex} stroke={light ? darken(hex, 0.35) : 'none'} strokeWidth={0.3} />
        <text x={cx} y={cy + 0.2} fontSize={4.8} fill={contrastText(hex)}>
          {n}
        </text>
      </g>
    );
  };

  return (
    <SvgFrame width={W} height={H}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      {/* light bands every 5 clue rows/cols for readability */}
      <g fill="#f1f1f1">
        {Array.from({ length: Math.ceil(height / 5) }, (_, k) =>
          k % 2 === 1 ? <rect key={`rb${k}`} x={PAD} y={top + k * 5 * CELL} width={left - PAD} height={Math.min(5, height - k * 5) * CELL} /> : null,
        )}
        {Array.from({ length: Math.ceil(width / 5) }, (_, k) =>
          k % 2 === 1 ? <rect key={`cb${k}`} x={left + k * 5 * CELL} y={PAD} width={Math.min(5, width - k * 5) * CELL} height={top - PAD} /> : null,
        )}
      </g>
      {solution && <CellFills x={left} y={top} width={width} cells={puzzle.cells} palette={palette} blank />}
      <GridLines x={left} y={top} cols={width} rows={height} />
      <g textAnchor="middle" dominantBaseline="central" fill="#111">
        {rows.map((r, y) =>
          r.map((c, i) => {
            const cx = left - 3 - (r.length - 1 - i) * slot - slot / 2;
            const cy = top + y * CELL + CELL / 2;
            return clue(c.n, c.c, cx, cy, `r${y}-${i}`);
          }),
        )}
        {cols.map((col, x) =>
          col.map((c, i) => {
            const cx = left + x * CELL + CELL / 2;
            const cy = top - 3 - (col.length - 1 - i) * slot - slot / 2;
            return clue(c.n, c.c, cx, cy, `c${x}-${i}`);
          }),
        )}
      </g>
    </SvgFrame>
  );
}

/* ---------------- Colour by code ---------------- */

export function ColorByCodeSvg({ puzzle, solution }: { puzzle: ColorByCodePuzzle; solution: boolean }) {
  const { width, height, labels, legend, palette, cells, blank } = puzzle;
  const gridW = width * CELL;
  const entryW = 26;
  const rowH = 13;
  const lay = legendLayout(legend.length, gridW, entryW, rowH);
  const top = PAD + lay.height + 4;
  const W = PAD * 2 + gridW;
  const H = top + height * CELL + PAD;
  const longest = Math.max(...labels.map((l) => l.length));
  const fontSize = longest <= 1 ? 5.6 : longest === 2 ? 5 : longest <= 4 ? 3.6 : 3;

  return (
    <SvgFrame width={W} height={H}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      <g fontSize={5} dominantBaseline="central" fill="#111">
        {legend.map((e, i) => {
          const lx = PAD + (i % lay.perRow) * entryW;
          const ly = PAD + Math.floor(i / lay.perRow) * rowH;
          const isBlank = blank && e.code === 0;
          return (
            <g key={e.code}>
              <text x={lx + 8} y={ly + 6} textAnchor="end" fontWeight={600}>
                {e.code}
              </text>
              <rect x={lx + 10} y={ly + 1} width={10} height={10} rx={1} fill={isBlank ? '#fff' : e.color} stroke="#333" strokeWidth={0.4} />
            </g>
          );
        })}
      </g>
      {solution ? (
        <CellFills x={PAD} y={top} width={width} cells={cells} palette={palette} blank={blank} />
      ) : (
        <CellText x={PAD} y={top} width={width} labels={labels} fontSize={fontSize} />
      )}
      <GridLines x={PAD} y={top} cols={width} rows={height} bold={solution ? 0 : 5} thin={solution ? 0.15 : 0.25} color={solution ? '#999' : '#222'} />
    </SvgFrame>
  );
}

/* ---------------- Mystery portrait ---------------- */

function ShapeGlyph({ code, x, y, size }: { code: number; x: number; y: number; size: number }) {
  const poly = MYSTERY_POLYGONS[code];
  if (!poly) return null;
  const pts = poly
    .split(' ')
    .map((p) => p.split(',').map(Number))
    .map(([px, py]) => `${x + px * size},${y + py * size}`)
    .join(' ');
  return <polygon points={pts} fill="#111" />;
}

export function MysterySvg({ puzzle, solution }: { puzzle: MysteryPuzzle; solution: boolean }) {
  const { width, height, cells } = puzzle;
  const gridW = width * CELL;
  const entryW = 24;
  const rowH = 13;
  const lay = legendLayout(10, gridW, entryW, rowH);
  const top = PAD + lay.height + 4;
  const W = PAD * 2 + gridW;
  const H = top + height * CELL + PAD;
  return (
    <SvgFrame width={W} height={H}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      <g fontSize={5} dominantBaseline="central" fill="#111">
        {Array.from({ length: 10 }, (_, code) => {
          const lx = PAD + (code % lay.perRow) * entryW;
          const ly = PAD + Math.floor(code / lay.perRow) * rowH;
          return (
            <g key={code}>
              <text x={lx + 6} y={ly + 6} textAnchor="end" fontWeight={600}>
                {code}
              </text>
              <rect x={lx + 8} y={ly + 1} width={10} height={10} fill="#fff" stroke="#333" strokeWidth={0.4} />
              <ShapeGlyph code={code} x={lx + 8} y={ly + 1} size={10} />
            </g>
          );
        })}
      </g>
      {solution ? (
        <g>
          {cells.map((c, i) => (c ? <ShapeGlyph key={i} code={c} x={PAD + (i % width) * CELL} y={top + Math.floor(i / width) * CELL} size={CELL} /> : null))}
        </g>
      ) : (
        <CellText x={PAD} y={top} width={width} labels={cells.map(String)} fontSize={5.4} />
      )}
      <GridLines x={PAD} y={top} cols={width} rows={height} bold={solution ? 0 : 5} thin={solution ? 0.1 : 0.25} color={solution ? '#aaa' : '#222'} />
    </SvgFrame>
  );
}

/* ---------------- Fill-a-Pix ---------------- */

export function FillAPixSvg({ puzzle, solution }: { puzzle: FillAPixPuzzle; solution: boolean }) {
  const { width, height, clues, givens } = puzzle;
  const W = PAD * 2 + width * CELL;
  const H = PAD * 2 + height * CELL;
  const givenSet = new Set(givens);
  const labels = clues.map((c) => (c >= 0 ? String(c) : null));
  return (
    <SvgFrame width={W} height={H}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      {solution ? (
        <CellFills x={PAD} y={PAD} width={width} cells={puzzle.solution} palette={['#fff', '#222']} blank />
      ) : (
        <g>
          {givens.map((g) => {
            const gx = PAD + (g % width) * CELL;
            const gy = PAD + Math.floor(g / width) * CELL;
            return puzzle.solution[g] ? (
              <rect key={g} x={gx} y={gy} width={CELL} height={CELL} fill="#b9b9b9" />
            ) : (
              <path key={g} d={`M${gx + 3} ${gy + 3}l4 4m0 -4l-4 4`} stroke="#777" strokeWidth={0.6} />
            );
          })}
        </g>
      )}
      {solution ? (
        <CellText x={PAD} y={PAD} width={width} labels={labels.map((l, i) => (l && !puzzle.solution[i] ? l : null))} fontSize={5} color="#555" />
      ) : (
        <CellText x={PAD} y={PAD} width={width} labels={labels.map((l, i) => (givenSet.has(i) && !puzzle.solution[i] ? null : l))} fontSize={5.4} />
      )}
      {solution && <CellText x={PAD} y={PAD} width={width} labels={labels.map((l, i) => (l && puzzle.solution[i] ? l : null))} fontSize={5} color="#fff" />}
      <GridLines x={PAD} y={PAD} cols={width} rows={height} />
    </SvgFrame>
  );
}

/* ---------------- Logipix ---------------- */

export function LogipixSvg({ puzzle, solution }: { puzzle: LogipixPuzzle; solution: boolean }) {
  const { width, height, paths, color, palette } = puzzle;
  const W = PAD * 2 + width * CELL;
  const H = PAD * 2 + height * CELL;
  const centre = (c: number): [number, number] => [PAD + (c % width) * CELL + CELL / 2, PAD + Math.floor(c / width) * CELL + CELL / 2];
  const colorOf = (p: { color: number }) => (color ? palette[p.color] ?? '#000' : '#222');

  return (
    <SvgFrame width={W} height={H}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      {solution && (
        <g>
          {paths.map((p, i) => {
            const fill = colorOf(p);
            const d = p.cells.map((c) => `M${PAD + (c % width) * CELL} ${PAD + Math.floor(c / width) * CELL}h${CELL}v${CELL}h${-CELL}z`).join('');
            const line = p.cells.map((c, k) => `${k === 0 ? 'M' : 'L'}${centre(c)[0]} ${centre(c)[1]}`).join('');
            const stroke = hexLuminance(fill) > 0.5 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.6)';
            return (
              <g key={i}>
                <path d={d} fill={fill} />
                {p.cells.length > 1 ? (
                  <path d={line} fill="none" stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
                ) : (
                  <circle cx={centre(p.cells[0])[0]} cy={centre(p.cells[0])[1]} r={1.2} fill={stroke} />
                )}
              </g>
            );
          })}
        </g>
      )}
      <GridLines x={PAD} y={PAD} cols={width} rows={height} bold={solution ? 0 : 5} thin={solution ? 0.15 : 0.25} color={solution ? '#999' : '#222'} />
      {!solution && (
        <g textAnchor="middle" dominantBaseline="central" fontWeight={500}>
          {paths.map((p, i) => {
            const ends = p.cells.length === 1 ? [p.cells[0]] : [p.cells[0], p.cells[p.cells.length - 1]];
            const n = p.cells.length;
            return ends.map((c, k) => {
              const [cx, cy] = centre(c);
              if (!color) {
                return (
                  <text key={`${i}-${k}`} x={cx} y={cy + 0.2} fontSize={n >= 10 ? 4.6 : 5.6} fill="#111">
                    {n}
                  </text>
                );
              }
              const hex = colorOf(p);
              return (
                <g key={`${i}-${k}`}>
                  <circle cx={cx} cy={cy} r={3.9} fill={hex} stroke={darken(hex, 0.4)} strokeWidth={0.35} />
                  <text x={cx} y={cy + 0.2} fontSize={n >= 10 ? 4 : 4.8} fill={contrastText(hex)}>
                    {n}
                  </text>
                </g>
              );
            });
          })}
        </g>
      )}
    </SvgFrame>
  );
}
