import type { CSSProperties } from 'react';

export const CELL = 10;
export const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export interface SvgFrameProps {
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
  children: React.ReactNode;
}

export function SvgFrame({ width, height, className, style, children }: SvgFrameProps) {
  return (
    <svg
      className={`puzzle-svg ${className ?? ''}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      fontFamily={FONT}
    >
      {children}
    </svg>
  );
}

/** Thin grid lines plus a bolder line every `bold` cells and around the outside. */
export function GridLines({
  x,
  y,
  cols,
  rows,
  bold = 5,
  cell = CELL,
  thin = 0.25,
  thick = 0.9,
  color = '#222',
}: {
  x: number;
  y: number;
  cols: number;
  rows: number;
  bold?: number;
  cell?: number;
  thin?: number;
  thick?: number;
  color?: string;
}) {
  const thinPath: string[] = [];
  const thickPath: string[] = [];
  const w = cols * cell;
  const h = rows * cell;
  for (let i = 0; i <= cols; i++) {
    const px = x + i * cell;
    (i === 0 || i === cols || (bold > 0 && i % bold === 0) ? thickPath : thinPath).push(`M${px} ${y}v${h}`);
  }
  for (let j = 0; j <= rows; j++) {
    const py = y + j * cell;
    (j === 0 || j === rows || (bold > 0 && j % bold === 0) ? thickPath : thinPath).push(`M${x} ${py}h${w}`);
  }
  return (
    <g fill="none" stroke={color} strokeLinecap="square">
      <path d={thinPath.join('')} strokeWidth={thin} />
      <path d={thickPath.join('')} strokeWidth={thick} />
    </g>
  );
}

/** Coloured cells of a grid, batched per colour for a lighter SVG. */
export function CellFills({
  x,
  y,
  width,
  cells,
  palette,
  blank,
  cell = CELL,
}: {
  x: number;
  y: number;
  width: number;
  cells: number[];
  palette: string[];
  blank: boolean;
  cell?: number;
}) {
  const byColor = new Map<number, string[]>();
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (blank && v === 0) continue;
    const cx = x + (i % width) * cell;
    const cy = y + Math.floor(i / width) * cell;
    const list = byColor.get(v) ?? [];
    list.push(`M${cx} ${cy}h${cell}v${cell}h${-cell}z`);
    byColor.set(v, list);
  }
  return (
    <g>
      {Array.from(byColor.entries()).map(([v, d]) => (
        <path key={v} d={d.join('')} fill={palette[v] ?? '#000'} stroke="none" />
      ))}
    </g>
  );
}

/** Text labels centred in cells. */
export function CellText({
  x,
  y,
  width,
  labels,
  cell = CELL,
  fontSize,
  color = '#111',
  weight = 400,
}: {
  x: number;
  y: number;
  width: number;
  labels: (string | null)[];
  cell?: number;
  fontSize: number;
  color?: string;
  weight?: number;
}) {
  return (
    <g fontSize={fontSize} fill={color} textAnchor="middle" dominantBaseline="central" fontWeight={weight}>
      {labels.map((t, i) =>
        t ? (
          <text key={i} x={x + (i % width) * cell + cell / 2} y={y + Math.floor(i / width) * cell + cell / 2 + fontSize * 0.04}>
            {t}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** How tall a wrapped legend is, and how many entries fit per row. */
export function legendLayout(count: number, totalWidth: number, entryWidth: number, rowHeight: number) {
  const perRow = Math.max(1, Math.floor(totalWidth / entryWidth));
  const rows = Math.ceil(count / perRow);
  return { perRow, rows, height: rows * rowHeight };
}
