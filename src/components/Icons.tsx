import type { ReactNode, SVGProps } from 'react';
import type { ModeId } from '../types';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconMosaics = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconMinus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
  </Svg>
);

export const IconPrinter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9V3h12v6" />
    <path d="M6 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1" />
    <rect x="6" y="14" width="12" height="7" rx="1" />
  </Svg>
);

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-4.5-4.5L6 21" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </Svg>
);

export const IconMore = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </Svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Svg>
);

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Svg>
);

export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const IconShuffle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 16v-4.5M12 8h.01" />
  </Svg>
);

export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </Svg>
);

export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconArchive = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
  </Svg>
);

/* ---------- Puzzle type glyphs ---------- */

const PINK = '#ef476f';
const YELLOW = '#ffd166';
const GREEN = '#06d6a0';
const BLUE = '#118ab2';

/** Accent colours used for a puzzle type's chip and icon tile. */
export const MODE_TINT: Record<ModeId, { fg: string; bg: string }> = {
  nonogram: { fg: '#1f2430', bg: '#ebe8e1' },
  colorNonogram: { fg: '#c2255c', bg: '#fde7ee' },
  colorByCode: { fg: '#a66a00', bg: '#fff1cf' },
  mystery: { fg: '#6741d9', bg: '#efeafd' },
  fillapix: { fg: '#0b7499', bg: '#e1f2f8' },
  logipix: { fg: '#08875f', bg: '#dcf5ec' },
  labymage: { fg: '#c9431d', bg: '#fdeae3' },
  dots: { fg: '#0b7285', bg: '#ddf2f5' },
};

/** 3×3 cell positions on a 24px canvas. */
const C = [2.5, 9, 15.5];
const S = 6;

function Cells({ on, colors }: { on: number[]; colors?: string[] }) {
  return (
    <>
      {C.flatMap((y, r) =>
        C.map((x, c) => {
          const i = r * 3 + c;
          const k = on.indexOf(i);
          return k >= 0 ? (
            <rect key={i} x={x} y={y} width={S} height={S} rx={1.2} fill={colors ? colors[k % colors.length] : 'currentColor'} stroke="none" />
          ) : (
            <rect key={i} x={x + 0.5} y={y + 0.5} width={S - 1} height={S - 1} rx={1} strokeWidth={1} opacity={0.35} />
          );
        }),
      )}
    </>
  );
}

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);

export const IconRotateLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);

export const IconRotateRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
);

export const IconFlipH = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 7 5 5-5 5V7" />
    <path d="m21 7-5 5 5 5V7" />
    <path d="M12 2v2M12 8v2M12 14v2M12 20v2" />
  </Svg>
);

export const IconFlipV = (p: IconProps) => (
  <Svg {...p}>
    <path d="m17 3-5 5-5-5h10" />
    <path d="m17 21-5-5-5 5h10" />
    <path d="M2 12h2M8 12h2M14 12h2M20 12h2" />
  </Svg>
);

export const IconMove = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2v20M2 12h20" />
    <path d="m15 19-3 3-3-3M19 9l3 3-3 3M5 9l-3 3 3 3M9 5l3-3 3 3" />
  </Svg>
);

export const IconBrush = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
  </Svg>
);

export const IconWand = (p: IconProps) => (
  <Svg {...p}>
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
    <path d="m14 7 3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9" />
  </Svg>
);

export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
    <path d="m15 5 4 4" />
  </Svg>
);

export const IconBucket = (p: IconProps) => (
  <Svg {...p}>
    <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
    <path d="m5 2 5 5M2 13h15" />
    <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" />
  </Svg>
);

export const IconPipette = (p: IconProps) => (
  <Svg {...p}>
    <path d="m2 22 1-1h3l9-9" />
    <path d="M3 21v-3l9-9" />
    <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
  </Svg>
);

export const IconEraser = (p: IconProps) => (
  <Svg {...p}>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7M5 11l9 9" />
  </Svg>
);

export const IconSparkles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
    <path d="M20 3v4M22 5h-4" />
  </Svg>
);

export const IconInvert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
  </Svg>
);

export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </Svg>
);

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export function ModeIcon({ mode, size = 22 }: { mode: ModeId; size?: number }) {
  switch (mode) {
    case 'nonogram':
      return (
        <Svg size={size}>
          <Cells on={[1, 3, 4, 5, 7]} />
        </Svg>
      );
    case 'colorNonogram':
      return (
        <Svg size={size}>
          <Cells on={[0, 1, 4, 5, 6, 8]} colors={[PINK, PINK, YELLOW, BLUE, GREEN, BLUE]} />
        </Svg>
      );
    case 'colorByCode':
      return (
        <Svg size={size} strokeWidth={1.5}>
          <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill={YELLOW} stroke="none" />
          <rect x="12.5" y="12.5" width="9" height="9" rx="1.5" fill={PINK} stroke="none" />
          <rect x="13" y="3" width="8" height="8" rx="1.2" opacity={0.45} />
          <rect x="3" y="13" width="8" height="8" rx="1.2" opacity={0.45} />
          <text x="17" y="10" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
            2
          </text>
          <text x="7" y="20" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
            1
          </text>
        </Svg>
      );
    case 'mystery':
      return (
        <Svg size={size} strokeWidth={1.5}>
          <path d="M3 3h9v9z" fill="currentColor" stroke="none" />
          <rect x="12" y="3" width="9" height="9" fill="currentColor" stroke="none" />
          <path d="M3 21V12h9z" fill="currentColor" stroke="none" opacity={0.55} />
          <path d="M12 21h9v-9z" fill="currentColor" stroke="none" />
          <rect x="3" y="3" width="18" height="18" rx="1" opacity={0.4} />
        </Svg>
      );
    case 'fillapix':
      return (
        <Svg size={size}>
          <Cells on={[0, 2, 3, 6]} />
          <text x="12" y="17" fontSize="7.5" fontWeight="800" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
            4
          </text>
        </Svg>
      );
    case 'logipix':
      return (
        <Svg size={size}>
          <path d="M5.5 5.5v13h13v-6" strokeWidth={3.5} opacity={0.3} />
          <path d="M5.5 5.5v13h13v-6" strokeWidth={1.6} />
          <circle cx="5.5" cy="5.5" r="3" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12.5" r="3" fill="currentColor" stroke="none" />
        </Svg>
      );
    case 'labymage':
      return (
        <Svg size={size} strokeWidth={1.8}>
          <path d="M10 3H3v18h18V3h-7" />
          <path d="M7 7v10h10V7h-3M10 7v6h4" />
        </Svg>
      );
    case 'dots':
      return (
        <Svg size={size} strokeWidth={1.4}>
          <path d="M4.5 18 8 6.5l7.5-2.5 4 8" strokeDasharray="2 2" opacity={0.6} />
          <circle cx="4.5" cy="18" r="2" fill="currentColor" stroke="none" />
          <circle cx="8" cy="6.5" r="2" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="4" r="2" fill="currentColor" stroke="none" />
          <circle cx="19.5" cy="12" r="2" fill="currentColor" stroke="none" />
          <circle cx="13" cy="19.5" r="2" fill="none" />
        </Svg>
      );
  }
}

/** Coloured tile with the puzzle type's glyph. */
export function ModeBadge({ mode, size = 34 }: { mode: ModeId; size?: number }) {
  const t = MODE_TINT[mode];
  return (
    <span className="mode-badge" style={{ width: size, height: size, color: t.fg, background: t.bg }}>
      <ModeIcon mode={mode} size={Math.round(size * 0.62)} />
    </span>
  );
}

/** Small pill with the puzzle type name. */
export function ModeChip({ mode, name }: { mode: ModeId; name: string }) {
  const t = MODE_TINT[mode];
  return (
    <span className="mode-chip" style={{ color: t.fg, background: t.bg }}>
      <ModeIcon mode={mode} size={14} />
      {name}
    </span>
  );
}
