import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { MosaicRecord, Orientation, PaperSize } from '../types';
import { MODE_BY_ID } from '../lib/modes';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';
import { Logo } from './Header';

export const PAPER_MM: Record<PaperSize, [number, number]> = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
};

const PX_PER_MM = 96 / 25.4;

export function PrintRoot({ paper, orientation, children }: { paper: PaperSize; orientation: Orientation; children: React.ReactNode }) {
  const [a, b] = PAPER_MM[paper];
  const [pw, ph] = orientation === 'portrait' ? [a, b] : [b, a];
  const root = useRef<HTMLDivElement>(null);
  // On screen, sheets shrink to fit the available width (the CSS applies it only in @media screen).
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const available = el.clientWidth;
      if (available > 0) setFit(Math.min(1, Math.floor((available / (pw * PX_PER_MM)) * 1000) / 1000));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pw]);
  const style = { '--pw': `${pw}mm`, '--ph': `${ph}mm`, '--sheet-fit': fit } as CSSProperties;
  return (
    <div className="print-root" style={style} ref={root}>
      <style>{`@page { size: ${paper} ${orientation}; margin: 0; }`}</style>
      {children}
    </div>
  );
}

export function Sheet({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={`sheet ${className ?? ''}`}>{children}</section>;
}

export function SheetFooter({ page, label }: { page?: number; label?: string }) {
  return (
    <div className="sheet-foot">
      <span className="sheet-brand">
        <Logo size={12} /> Mosaica
      </span>
      <span>{label}</span>
      <span>{page ?? ''}</span>
    </div>
  );
}

export function PuzzleSheet({
  record,
  number,
  solution,
  showRules,
  page,
}: {
  record: MosaicRecord;
  number?: number;
  solution: boolean;
  showRules: boolean;
  page?: number;
}) {
  const def = MODE_BY_ID[record.mode];
  return (
    <Sheet className={solution ? 'solution-sheet' : ''}>
      <div className="sheet-head">
        <div className="sheet-title-row">
          {number !== undefined && <span className="sheet-number">{number}</span>}
          <h2 className="sheet-title">
            {record.title || 'Untitled mosaic'}
            {solution && <span className="sheet-solution-tag">Solution</span>}
          </h2>
          <span className="sheet-meta">
            {def.name} · {puzzleSummary(record.puzzle)}
          </span>
        </div>
        {showRules && !solution && <p className="sheet-rules">{def.rules}</p>}
      </div>
      <div className="sheet-body">
        <PuzzleSvg puzzle={record.puzzle} solution={solution} />
      </div>
      <SheetFooter page={page} />
    </Sheet>
  );
}
