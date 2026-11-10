import { useId } from 'react';
import type { WhodunitClue, WhodunitObjectKind, WhodunitPuzzle } from '../../types';
import { ROOM_TINT, personLabels } from '../../lib/modes/whodunit';
import { useT, type Messages } from '../../i18n';
import { SvgFrame } from './common';

const W = 200;
const BOARD = 150;
const BX = (W - BOARD) / 2;
const BY = 4;
const INK = '#2b2b2b';
const RED = '#c62828';

/** One statement as a sentence. The person it is about heads the card, so the sentence has no subject. */
export function clueText(c: WhodunitClue, p: WhodunitPuzzle, t: Messages): string {
  const w = t.whodunit;
  const name = (i: number) => p.people[i]?.name.trim() || personLabels(p.people)[i];
  switch (c.type) {
    case 'room':
      return w.clue.room(w.rooms[p.roomKinds[c.room]].at);
    case 'notRoom':
      return w.clue.notRoom(w.rooms[p.roomKinds[c.room]].at);
    case 'apart':
      return w.clue.apart(name(c.other));
    case 'on':
      return w.clue.on(w.objects[c.object].ref);
    case 'beside':
      return w.clue.beside(w.objects[c.object].ref);
    case 'alone':
      return w.clue.alone;
    case 'sameRoom':
      return w.clue.sameRoom(name(c.other));
    case 'dir':
      return w.clue.dir[c.dir](name(c.other));
  }
}

/** Rough width of a string in Helvetica, good enough to wrap lines without measuring. */
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    if (/[ iljI.,:;'’!|]/.test(ch)) w += 0.28;
    else if (/[ftr\-()]/.test(ch)) w += 0.34;
    else if (/[mwMW]/.test(ch)) w += 0.86;
    else if (/[A-ZÄÖÜ]/.test(ch)) w += 0.69;
    else w += 0.55;
  }
  return w * size;
}

function wrap(s: string, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The six things in the flat, drawn in a box one cell high and `w` cells wide. */
function ObjectIcon({ kind, w = 1 }: { kind: WhodunitObjectKind; w?: number }) {
  const s = { fill: 'none', stroke: INK, strokeWidth: 0.035, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  switch (kind) {
    case 'bread':
      return (
        <g {...s}>
          <ellipse cx={0.5} cy={0.58} rx={0.33} ry={0.24} fill="#e3b574" />
          <path d="M.27 .56Q.34 .4 .43 .52M.42 .5Q.5 .34 .58 .5M.57 .52Q.66 .4 .73 .56" stroke="#8a5a22" />
          <path d="M.3 .72Q.5 .8 .7 .72" stroke="#b98443" />
        </g>
      );
    case 'crochet':
      return (
        <g {...s}>
          <path d="M.56 .44L.83 .19q.07 -.03 .03 .05" stroke="#666" strokeWidth={0.045} />
          <circle cx={0.44} cy={0.6} r={0.25} fill="#e88fab" />
          <path d="M.22 .52Q.44 .42 .66 .5M.2 .64Q.44 .54 .69 .64M.27 .77Q.45 .68 .63 .77" stroke="#a84c6b" />
          <path d="M.66 .72q.1 .14 .22 .02" stroke="#a84c6b" />
        </g>
      );
    case 'bags':
      return (
        <g {...s}>
          <path d="M.58 .46h.2v.34h-.2z" fill="#a9dcb8" />
          <path d="M.58 .63h.2" strokeDasharray=".03 .04" />
          <rect x={0.24} y={0.34} width={0.36} height={0.46} rx={0.07} fill="#4f9d69" />
          <ellipse cx={0.42} cy={0.36} rx={0.18} ry={0.06} fill="#7cc292" />
          <path d="M.33 .5v.2M.42 .52v.2M.51 .5v.2" stroke="#2f6e45" />
        </g>
      );
    case 'ivy':
      return (
        <g {...s}>
          <path d="M.5 .62Q.47 .4 .33 .3M.5 .62Q.56 .42 .68 .33M.5 .62Q.32 .52 .2 .62M.5 .62Q.7 .52 .8 .66M.5 .62V.42" stroke="#3f7d3a" />
          {[
            [0.31, 0.27, -30],
            [0.7, 0.3, 30],
            [0.18, 0.64, -60],
            [0.82, 0.68, 60],
            [0.5, 0.38, 0],
          ].map(([x, y, r], i) => (
            <path key={i} d="M0 .08Q-.1 0 -.06 -.06Q-.02 -.1 0 -.05Q.02 -.1 .06 -.06Q.1 0 0 .08z" transform={`translate(${x} ${y}) rotate(${r})`} fill="#63ad58" stroke="#3f7d3a" strokeWidth={0.025} />
          ))}
          <path d="M.37 .62h.26l-.04 .24h-.18z" fill="#c9774f" />
        </g>
      );
    case 'desk': {
      // A sit-stand desk from the front: telescopic legs on flat feet, a keypad under the top, a screen on it.
      const legs = [0.27, w - 0.27];
      const mid = w / 2;
      return (
        <g {...s}>
          {legs.map((x) => (
            <g key={x}>
              <rect x={x - 0.11} y={0.84} width={0.22} height={0.045} rx={0.02} fill="#6f757e" />
              <rect x={x - 0.045} y={0.64} width={0.09} height={0.2} fill="#8d939c" />
              <rect x={x - 0.028} y={0.46} width={0.056} height={0.18} fill="#c3c8cf" />
            </g>
          ))}
          <path d={`M${legs[0] + 0.03} .5H${legs[1] - 0.03}`} stroke="#8d939c" strokeWidth={0.03} />
          <rect x={0.08} y={0.4} width={w - 0.16} height={0.07} rx={0.025} fill="#d2a56d" />
          <rect x={w - 0.24} y={0.47} width={0.12} height={0.045} rx={0.01} fill="#3c4048" stroke="none" />
          <path d={`M${mid} .56v.22M${mid - 0.06} .62l.06 -.07l.06 .07M${mid - 0.06} .72l.06 .07l.06 -.07`} stroke="#555" />
          <path d={`M${mid} .34v.06M${mid - 0.08} .4h.16`} strokeWidth={0.04} />
          <rect x={mid - 0.19} y={0.12} width={0.38} height={0.23} rx={0.025} fill="#dfe9f3" />
          {w > 1 && (
            <>
              <path d="M.3 .4v-.1h.1v.1zM.4 .32q.06 0 .06 .03t-.06 .03" fill="#fff" />
              <path d={`M${w - 0.5} .39h.26l-.03 -.03h-.2z`} fill="#b9bec6" />
            </>
          )}
        </g>
      );
    }
    case 'futon': {
      // A real futon: a thick tufted cotton mattress folded over a low slatted wooden frame.
      const wood = '#b98a55';
      const tufts: number[] = [];
      for (let x = 0.3; x < w - 0.25; x += 0.2) tufts.push(x);
      return (
        <g {...s}>
          <path d={`M.2 .76v.08M${w - 0.2} .76v.08`} strokeWidth={0.05} />
          <rect x={0.14} y={0.69} width={w - 0.28} height={0.07} rx={0.015} fill={wood} />
          <path d={tufts.map((x) => `M${x - 0.1} .7v.05`).join('')} stroke="#7d5a30" strokeWidth={0.02} />
          <rect x={0.15} y={0.2} width={w - 0.3} height={0.33} rx={0.09} fill="#efe4c9" />
          <rect x={0.13} y={0.49} width={w - 0.26} height={0.2} rx={0.09} fill="#e6d8b6" />
          {tufts.map((x) => (
            <g key={x} fill="#8a6a3c" stroke="none">
              <circle cx={x} cy={0.36} r={0.018} />
              <circle cx={x} cy={0.59} r={0.018} />
            </g>
          ))}
          <rect x={0.06} y={0.4} width={0.09} height={0.06} rx={0.02} fill={wood} />
          <rect x={w - 0.15} y={0.4} width={0.09} height={0.06} rx={0.02} fill={wood} />
          <path d={`M.105 .46v.38M${w - 0.105} .46v.38`} stroke={wood} strokeWidth={0.06} strokeLinecap="butt" />
          <path d={`M.075 .46v.38M.135 .46v.38M${w - 0.135} .46v.38M${w - 0.075} .46v.38`} strokeWidth={0.02} />
        </g>
      );
    }
    case 'bong':
      return (
        <g {...s}>
          <path d="M.6 .66L.78 .46" stroke="#666" strokeWidth={0.05} />
          <path d="M.72 .46h.13l-.03 -.09h-.07z" fill="#8d8d8d" />
          <path d="M.38 .2v.34a.19 .19 0 1 0 .14 0v-.34z" fill="#d3ece3" />
          <path d="M.275 .7a.19 .19 0 0 0 .35 0z" fill="#86c8b4" stroke="none" />
          <path d="M.38 .2v.34a.19 .19 0 1 0 .14 0v-.34z" />
          <path d="M.35 .2h.2" strokeWidth={0.05} />
          <path d="M.38 .38h.14" stroke="#7fb5a5" />
        </g>
      );
  }
}

/** A person: their photo in a circle, or their letter. */
function Token({
  cx,
  cy,
  r,
  photo,
  label,
  clip,
  ring = '#555',
  ringWidth = 0.08,
}: {
  cx: number;
  cy: number;
  r: number;
  photo?: string;
  label: string;
  clip: string;
  ring?: string;
  ringWidth?: number;
}) {
  const badge = r * 0.42;
  return (
    <g>
      {photo ? (
        <>
          <clipPath id={clip}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
          <image href={photo} x={cx - r} y={cy - r} width={r * 2} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={ring} strokeWidth={r * ringWidth} />
          <circle cx={cx + r * 0.72} cy={cy + r * 0.72} r={badge} fill="#fff" stroke={ring} strokeWidth={r * 0.05} />
          <text x={cx + r * 0.72} y={cy + r * 0.72} fontSize={badge * (label.length > 1 ? 1 : 1.35)} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#111">
            {label}
          </text>
        </>
      ) : (
        <>
          <circle cx={cx} cy={cy} r={r} fill="#fff" stroke={ring} strokeWidth={r * ringWidth} />
          <text x={cx} y={cy} fontSize={r * (label.length > 1 ? 0.85 : 1.15)} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#111">
            {label}
          </text>
        </>
      )}
    </g>
  );
}

/** The desk comes last: its name is long (in German above all) and gets a legend row to itself. */
const OBJECT_ORDER: WhodunitObjectKind[] = ['bread', 'crochet', 'bags', 'ivy', 'futon', 'bong', 'desk'];

export function WhodunitSvg({ puzzle: p, solution }: { puzzle: WhodunitPuzzle; solution: boolean }) {
  const t = useT();
  const w = t.whodunit;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const n = p.width;
  const cell = BOARD / n;
  const labels = personLabels(p.people);
  const cx = (c: number) => BX + (c % n) * cell;
  const cy = (c: number) => BY + Math.floor(c / n) * cell;

  // Walls run wherever two rooms meet.
  const walls: string[] = [];
  for (let c = 0; c < n * n; c++) {
    if (c % n < n - 1 && p.rooms[c] !== p.rooms[c + 1]) walls.push(`M${cx(c) + cell} ${cy(c)}v${cell}`);
    if (c + n < n * n && p.rooms[c] !== p.rooms[c + n]) walls.push(`M${cx(c)} ${cy(c) + cell}h${cell}`);
  }
  const grid: string[] = [];
  for (let i = 1; i < n; i++) grid.push(`M${BX + i * cell} ${BY}v${BOARD}M${BX} ${BY + i * cell}h${BOARD}`);

  // Legend of the objects that are in this flat.
  const kinds = OBJECT_ORDER.filter((k) => p.objects.some((o) => o.kind === k));
  const legendY = BY + BOARD + 5;
  const perRow = 3;
  const legendW = (W - 8) / perRow;
  const legendRows = Math.ceil(kinds.length / perRow);

  // Suspect cards in two columns; each row is as tall as its taller card.
  const colW = (W - 12) / 2;
  const textX = 17;
  const size = 3.5;
  const lead = 4.5;
  const cards = p.people.map((person, who) => {
    const lines = p.clues.filter((c) => c.who === who).flatMap((c) => wrap(clueText(c, p, t), size, colW - textX - 2).map((text, i) => ({ text, first: i === 0 })));
    // On hard, some people have nothing to say.
    const silent = lines.length === 0;
    if (silent) lines.push({ text: w.clue.silent, first: true });
    return { who, person, lines, silent, height: Math.max(15, 7.5 + lines.length * lead + 1.5) };
  });
  let y = legendY + legendRows * 9 + 4;
  const placed = cards.map((card, i) => {
    const mate = cards[i % 2 === 0 ? i + 1 : i - 1];
    const rowH = Math.max(card.height, mate?.height ?? 0);
    const pos = { ...card, x: 4 + (i % 2) * (colW + 4), y, rowH };
    if (i % 2 === 1) y += rowH + 3;
    return pos;
  });
  if (cards.length % 2 === 1) y += placed[placed.length - 1].rowH + 3;
  const H = y + 1;

  return (
    <SvgFrame width={W} height={H} className="whodunit-svg">
      {/* Floors */}
      {p.rooms.map((room, c) => (
        <rect key={c} x={cx(c)} y={cy(c)} width={cell} height={cell} fill={ROOM_TINT[p.roomKinds[room]]} />
      ))}
      <path d={grid.join('')} fill="none" stroke="#9a968c" strokeWidth={0.25} />
      <path d={walls.join('')} fill="none" stroke={INK} strokeWidth={1.1} strokeLinecap="square" />
      <rect x={BX} y={BY} width={BOARD} height={BOARD} fill="none" stroke={INK} strokeWidth={1.5} />

      {/* Room names, in the first cell of each room */}
      <g fontSize={Math.min(3.2, cell * 0.16)} fill="#6d6a63" fontWeight={700} letterSpacing={0.15}>
        {p.roomKinds.map((kind, room) => {
          const first = p.rooms.indexOf(room);
          return (
            <text key={room} x={cx(first) + cell * 0.07} y={cy(first) + cell * 0.19}>
              {w.rooms[kind].name.toUpperCase()}
            </text>
          );
        })}
      </g>

      {p.objects.map((o, i) => (
        <g key={i} transform={`translate(${cx(o.cells[0])} ${cy(o.cells[0]) + cell * 0.06}) scale(${cell})`}>
          <ObjectIcon kind={o.kind} w={o.cells.length} />
        </g>
      ))}

      {solution &&
        p.solution.map((c, who) => (
          <g key={who}>
            <Token
              cx={cx(c) + cell / 2}
              cy={cy(c) + cell / 2}
              r={cell * 0.34}
              photo={p.people[who].photo}
              label={labels[who]}
              clip={`${uid}s${who}`}
              ring={who === p.murderer ? RED : '#444'}
              ringWidth={who === p.murderer ? 0.2 : 0.08}
            />
            {who === 0 && (
              <path
                d={`M${cx(c) + cell * 0.2} ${cy(c) + cell * 0.2}l${cell * 0.6} ${cell * 0.6}M${cx(c) + cell * 0.8} ${cy(c) + cell * 0.2}l${-cell * 0.6} ${cell * 0.6}`}
                stroke={RED}
                strokeWidth={cell * 0.05}
                strokeLinecap="round"
                opacity={0.85}
              />
            )}
          </g>
        ))}

      {/* North is up */}
      <g transform={`translate(${BX + BOARD + 12} ${BY + 4})`} fill="none" stroke={INK} strokeWidth={0.6} strokeLinecap="round" strokeLinejoin="round">
        <text x={0} y={3.2} fontSize={4.6} fontWeight={700} textAnchor="middle" fill={INK} stroke="none">
          {w.north}
        </text>
        <path d="M0 18V6M-2.6 9.4L0 6l2.6 3.4" />
        <circle cx={0} cy={18} r={0.9} fill={INK} />
      </g>

      {kinds.map((kind, i) => {
        const x = 4 + (i % perRow) * legendW;
        const ly = legendY + Math.floor(i / perRow) * 9;
        const wide = p.objects.some((o) => o.kind === kind && o.cells.length > 1) ? 2 : 1;
        return (
          <g key={kind}>
            <g transform={`translate(${x + (wide === 1 ? 3.5 : 0)} ${ly}) scale(7)`}>
              <ObjectIcon kind={kind} w={wide} />
            </g>
            <text x={x + 16} y={ly + 4.6} fontSize={3.5} fill="#222">
              {w.objects[kind].name}
            </text>
          </g>
        );
      })}

      {placed.map(({ who, person, lines, silent, x, y: top, rowH }) => {
        const culprit = solution && who === p.murderer;
        const role = who === 0 ? w.victim : culprit ? w.culprit : null;
        const name = person.name.trim() || labels[who];
        return (
          <g key={who}>
            <rect x={x} y={top} width={colW} height={rowH} rx={2} fill={who === 0 ? '#f4f2ee' : '#fff'} stroke={culprit ? RED : '#bdb8ad'} strokeWidth={culprit ? 0.8 : 0.35} />
            <Token cx={x + 8.5} cy={top + 8} r={5.6} photo={person.photo} label={labels[who]} clip={`${uid}c${who}`} ring={culprit ? RED : '#444'} />
            <text x={x + textX} y={top + 5.6} fontSize={4.2} fontWeight={700} fill="#111">
              {name}
              {role && (
                <tspan dx={2} fontSize={2.9} fontWeight={700} fill={culprit ? RED : '#6d6a63'} letterSpacing={0.2}>
                  {role.toUpperCase()}
                </tspan>
              )}
            </text>
            <g fontSize={size} fill={silent ? '#77736b' : '#222'} fontStyle={silent ? 'italic' : undefined}>
              {lines.map((line, i) => (
                <text key={i} x={x + textX} y={top + 10.6 + i * lead}>
                  {line.text}
                </text>
              ))}
            </g>
          </g>
        );
      })}
    </SvgFrame>
  );
}
