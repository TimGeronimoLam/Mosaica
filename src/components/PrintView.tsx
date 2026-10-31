import { useEffect, useState } from 'react';
import type { MosaicRecord, Orientation, PaperSize } from '../types';
import { getMosaic } from '../lib/db';
import { MODE_BY_ID } from '../lib/modes';
import { href } from '../router';
import { IconArrowLeft, IconInfo, IconPrinter, ModeChip } from './Icons';
import { PrintRoot, PuzzleSheet } from './Sheet';
import { puzzleSummary } from './PuzzleSvg';
import { Segmented, Toggle } from './ui';

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export function PrintView({ id }: { id: string }) {
  const [record, setRecord] = useState<MosaicRecord | null | undefined>(undefined);
  const [paper, setPaper] = useState<PaperSize>(() => readPref('mosaica.paper', 'A4'));
  const [orientation, setOrientation] = useState<Orientation | 'auto'>('auto');
  const [includeSolution, setIncludeSolution] = useState(true);
  const [showRules, setShowRules] = useState(true);

  useEffect(() => {
    getMosaic(id).then((r) => setRecord(r ?? null));
  }, [id]);

  useEffect(() => {
    try {
      localStorage.setItem('mosaica.paper', paper);
    } catch {
      /* ignore */
    }
  }, [paper]);

  if (record === undefined) return <div className="page narrow muted">Loading…</div>;
  if (record === null) {
    return (
      <div className="page narrow">
        <h1>Mosaic not found</h1>
        <a href={href('/')}>Back to your mosaics</a>
      </div>
    );
  }

  const p = record.puzzle;
  const wide = p.width > p.height * 1.15;
  const effectiveOrientation: Orientation = orientation === 'auto' ? (wide ? 'landscape' : 'portrait') : orientation;
  const pages = includeSolution ? 2 : 1;
  const def = MODE_BY_ID[record.mode];

  return (
    <div className="print-layout">
      <aside className="print-panel no-print" aria-label="Print options">
        <div className="print-panel-body">
          <a className="back-link" href={href(`/edit/${record.id}`)}>
            <IconArrowLeft size={16} /> Back to editor
          </a>
          <h1>Print</h1>
          <p className="lead">
            {record.title || 'Untitled mosaic'} · {puzzleSummary(p)}
          </p>
          {def && <ModeChip mode={record.mode} name={def.name} />}

          <div className="option-group">
            <div className="option-row">
              <span className="option-label">Paper</span>
              <Segmented
                className="block"
                label="Paper"
                value={paper}
                onChange={setPaper}
                options={[
                  { value: 'A4', label: 'A4' },
                  { value: 'Letter', label: 'Letter' },
                ]}
              />
            </div>
            <div className="option-row">
              <span className="option-label">Orientation</span>
              <Segmented
                className="block"
                label="Orientation"
                value={orientation}
                onChange={setOrientation}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'portrait', label: 'Portrait' },
                  { value: 'landscape', label: 'Landscape' },
                ]}
              />
            </div>
          </div>
          <div className="option-group">
            <Toggle label="How to play" checked={showRules} onChange={setShowRules} />
            <Toggle label="Solution page" checked={includeSolution} onChange={setIncludeSolution} />
          </div>
        </div>
        <div className="print-panel-foot">
          <button className="btn primary large block" onClick={() => window.print()}>
            <IconPrinter /> Print {pages} {pages === 1 ? 'page' : 'pages'}
          </button>
          <p className="print-tip">
            <IconInfo size={15} />
            <span>
              In the print dialog, choose {paper} paper and turn off headers and footers.
            </span>
          </p>
        </div>
      </aside>
      <div className="print-stage">
        <PrintRoot paper={paper} orientation={effectiveOrientation}>
          <PuzzleSheet record={record} solution={false} showRules={showRules} />
          {includeSolution && <PuzzleSheet record={record} solution showRules={false} />}
        </PrintRoot>
      </div>
    </div>
  );
}
