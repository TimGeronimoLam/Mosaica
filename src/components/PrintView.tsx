import { useEffect, useState } from 'react';
import type { MosaicRecord, Orientation, PaperSize } from '../types';
import { getMosaic } from '../lib/db';
import { MODE_BY_ID, editorPath } from '../lib/modes';
import { href } from '../router';
import { IconArrowLeft, IconInfo, IconPrinter, ModeChip } from './Icons';
import { PrintRoot, PuzzleSheet } from './Sheet';
import { puzzleSummary } from './PuzzleSvg';
import { Segmented, Toggle } from './ui';
import { useT } from '../i18n';

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export function PrintView({ id }: { id: string }) {
  const t = useT();
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

  if (record === undefined) return <div className="page narrow muted">{t.loading}</div>;
  if (record === null) {
    return (
      <div className="page narrow">
        <h1>{t.print.notFound}</h1>
        <a href={href('/')}>{t.backToMosaics}</a>
      </div>
    );
  }

  const p = record.puzzle;
  const wide = p.width > p.height * 1.15;
  const effectiveOrientation: Orientation = orientation === 'auto' ? (wide ? 'landscape' : 'portrait') : orientation;
  const pages = includeSolution ? 2 : 1;
  const modeName = MODE_BY_ID[record.mode] ? t.modes[record.mode].name : null;

  return (
    <div className="print-layout">
      <aside className="print-panel no-print" aria-label={t.print.options}>
        <div className="print-panel-body">
          <a className="back-link" href={href(editorPath(record.mode, record.id))}>
            <IconArrowLeft size={16} /> {t.print.backToEditor}
          </a>
          <h1>{t.print.title}</h1>
          <p className="lead">
            {record.title || t.untitled} · {puzzleSummary(p, t)}
          </p>
          {modeName && <ModeChip mode={record.mode} name={modeName} />}

          <div className="option-group">
            <div className="option-row">
              <span className="option-label">{t.print.paper}</span>
              <Segmented
                className="block"
                label={t.print.paper}
                value={paper}
                onChange={setPaper}
                options={[
                  { value: 'A4', label: 'A4' },
                  { value: 'Letter', label: 'Letter' },
                ]}
              />
            </div>
            <div className="option-row">
              <span className="option-label">{t.print.orientation}</span>
              <Segmented
                className="block"
                label={t.print.orientation}
                value={orientation}
                onChange={setOrientation}
                options={[
                  { value: 'auto', label: t.print.auto },
                  { value: 'portrait', label: t.print.portrait },
                  { value: 'landscape', label: t.print.landscape },
                ]}
              />
            </div>
          </div>
          <div className="option-group">
            <Toggle label={t.print.howToPlay} checked={showRules} onChange={setShowRules} />
            <Toggle label={t.print.solutionPage} checked={includeSolution} onChange={setIncludeSolution} />
          </div>
        </div>
        <div className="print-panel-foot">
          <button className="btn primary large block" onClick={() => window.print()}>
            <IconPrinter /> {t.print.printPages(pages)}
          </button>
          <p className="print-tip">
            <IconInfo size={15} />
            <span>{t.print.tip(paper)}</span>
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
