import { useEffect, useState } from 'react';
import type { MosaicRecord, Orientation, PaperSize } from '../types';
import { getMosaic } from '../lib/db';
import { href } from '../router';
import { PrintRoot, PuzzleSheet } from './Sheet';

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

  if (record === undefined) return <div className="page narrow">Loading…</div>;
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

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <a className="btn" href={href(`/edit/${record.id}`)}>
          ← Back to editor
        </a>
        <div className="print-options">
          <label>
            Paper
            <select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </label>
          <label>
            Orientation
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation | 'auto')}>
              <option value="auto">Auto</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={showRules} onChange={(e) => setShowRules(e.target.checked)} /> How to play
          </label>
          <label className="check">
            <input type="checkbox" checked={includeSolution} onChange={(e) => setIncludeSolution(e.target.checked)} /> Solution page
          </label>
        </div>
        <button className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <PrintRoot paper={paper} orientation={effectiveOrientation}>
        <PuzzleSheet record={record} solution={false} showRules={showRules} />
        {includeSolution && <PuzzleSheet record={record} solution showRules={false} />}
      </PrintRoot>
    </div>
  );
}
