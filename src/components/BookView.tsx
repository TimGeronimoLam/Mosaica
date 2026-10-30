import { useEffect, useMemo, useState } from 'react';
import type { MosaicRecord, PaperSize } from '../types';
import { useMosaics } from '../hooks';
import { MODE_BY_ID, MODES } from '../lib/modes';
import { href } from '../router';
import { Logo } from './Header';
import { PrintRoot, PuzzleSheet, Sheet, SheetFooter } from './Sheet';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';

interface BookOptions {
  title: string;
  subtitle: string;
  paper: PaperSize;
  includeSolutions: boolean;
  includeHowTo: boolean;
  includeContents: boolean;
  showRules: boolean;
}

const DEFAULTS: BookOptions = {
  title: 'My Mosaic Book',
  subtitle: '',
  paper: 'A4',
  includeSolutions: true,
  includeHowTo: true,
  includeContents: true,
  showRules: true,
};

function loadOptions(): BookOptions {
  try {
    const raw = localStorage.getItem('mosaica.book');
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<BookOptions>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function BookView({ query }: { query: URLSearchParams }) {
  const { mosaics, loading } = useMosaics();
  const [opts, setOpts] = useState<BookOptions>(loadOptions);
  const [order, setOrder] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('mosaica.book', JSON.stringify(opts));
    } catch {
      /* ignore */
    }
  }, [opts]);

  // Initial order: oldest first (a book reads chronologically); honour ?ids= from the gallery.
  useEffect(() => {
    if (loading || order) return;
    const ids = mosaics
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => m.id);
    setOrder(ids);
    const wanted = query.get('ids');
    setSelected(new Set(wanted ? wanted.split(',').filter((id) => ids.includes(id)) : ids));
  }, [loading, mosaics, order, query]);

  const byId = useMemo(() => new Map(mosaics.map((m) => [m.id, m])), [mosaics]);
  const chosen: MosaicRecord[] = useMemo(
    () => (order ?? []).filter((id) => selected?.has(id)).map((id) => byId.get(id)!).filter(Boolean),
    [order, selected, byId],
  );

  const set = <K extends keyof BookOptions>(k: K, v: BookOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const move = (id: string, dir: -1 | 1) => {
    setOrder((o) => {
      if (!o) return o;
      const i = o.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = o.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const modesUsed = MODES.filter((m) => chosen.some((c) => c.mode === m.id));

  // Page numbering: cover is page 1 (unnumbered), then front matter, puzzles, solutions.
  let page = 1;
  const frontPages: React.ReactNode[] = [];
  if (opts.includeHowTo && modesUsed.length) {
    page++;
    frontPages.push(
      <Sheet key="howto" className="text-sheet">
        <div className="sheet-head">
          <h2 className="sheet-title">How to play</h2>
        </div>
        <div className="sheet-body text-body">
          {modesUsed.map((m) => (
            <div key={m.id} className="howto-entry">
              <h3>{m.name}</h3>
              <p>{m.rules}</p>
            </div>
          ))}
        </div>
        <SheetFooter page={page} />
      </Sheet>,
    );
  }
  if (opts.includeContents && chosen.length) {
    page++;
    frontPages.push(
      <Sheet key="contents" className="text-sheet">
        <div className="sheet-head">
          <h2 className="sheet-title">Contents</h2>
        </div>
        <div className="sheet-body text-body">
          <ol className="contents-list">
            {chosen.map((c, i) => (
              <li key={c.id}>
                <span className="contents-title">
                  {c.title || 'Untitled mosaic'} <em>{MODE_BY_ID[c.mode].name}</em>
                </span>
                <span className="contents-dots" />
                <span className="contents-page">{page + 1 + i}</span>
              </li>
            ))}
          </ol>
        </div>
        <SheetFooter page={page} />
      </Sheet>,
    );
  }
  const firstPuzzlePage = page + 1;
  const puzzlePages = chosen.map((c, i) => <PuzzleSheet key={c.id} record={c} number={i + 1} solution={false} showRules={opts.showRules} page={firstPuzzlePage + i} />);
  page = firstPuzzlePage + chosen.length - 1;

  const solutionPages: React.ReactNode[] = [];
  if (opts.includeSolutions) {
    for (let i = 0; i < chosen.length; i += 2) {
      page++;
      const pair = chosen.slice(i, i + 2);
      solutionPages.push(
        <Sheet key={`sol-${i}`} className="solution-sheet">
          <div className="sheet-head">
            <h2 className="sheet-title">Solutions</h2>
          </div>
          <div className="sheet-body solutions-grid">
            {pair.map((c, k) => (
              <div key={c.id} className="solution-cell">
                <div className="solution-label">
                  <span className="sheet-number small">{i + k + 1}</span> {c.title || 'Untitled mosaic'} <span className="sheet-meta">{puzzleSummary(c.puzzle)}</span>
                </div>
                <div className="solution-svg">
                  <PuzzleSvg puzzle={c.puzzle} solution />
                </div>
              </div>
            ))}
          </div>
          <SheetFooter page={page} />
        </Sheet>,
      );
    }
  }

  return (
    <div className="print-page book-page">
      <div className="book-toolbar no-print">
        <div className="book-toolbar-row">
          <a className="btn" href={href('/')}>
            ← My mosaics
          </a>
          <button className="btn primary" onClick={() => window.print()} disabled={chosen.length === 0}>
            Print book
          </button>
        </div>
        <div className="book-options">
          <label>
            Book title
            <input value={opts.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <label>
            Subtitle
            <input value={opts.subtitle} onChange={(e) => set('subtitle', e.target.value)} placeholder="e.g. Puzzles for Grandma" />
          </label>
          <label>
            Paper
            <select value={opts.paper} onChange={(e) => set('paper', e.target.value as PaperSize)}>
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.includeHowTo} onChange={(e) => set('includeHowTo', e.target.checked)} /> How-to-play page
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.includeContents} onChange={(e) => set('includeContents', e.target.checked)} /> Contents page
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.showRules} onChange={(e) => set('showRules', e.target.checked)} /> Rules on each puzzle
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.includeSolutions} onChange={(e) => set('includeSolutions', e.target.checked)} /> Solutions at the back
          </label>
        </div>
        <div className="book-picker">
          <div className="book-picker-head">
            <strong>
              {chosen.length} of {mosaics.length} mosaics in the book
            </strong>
            <span>
              <button className="link" onClick={() => setSelected(new Set(order ?? []))}>
                Select all
              </button>
              {' · '}
              <button className="link" onClick={() => setSelected(new Set())}>
                None
              </button>
            </span>
          </div>
          <ul className="book-list">
            {(order ?? []).map((id, i) => {
              const m = byId.get(id);
              if (!m) return null;
              return (
                <li key={id} className={selected?.has(id) ? 'on' : ''}>
                  <label>
                    <input type="checkbox" checked={!!selected?.has(id)} onChange={() => toggle(id)} />
                    <img src={m.thumbnail} alt="" />
                    <span className="book-list-title">{m.title || 'Untitled mosaic'}</span>
                    <span className="book-list-mode">{MODE_BY_ID[m.mode].name}</span>
                  </label>
                  <span className="book-list-actions">
                    <button className="icon" title="Move up" onClick={() => move(id, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button className="icon" title="Move down" onClick={() => move(id, 1)} disabled={i === (order?.length ?? 0) - 1}>
                      ↓
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {!loading && mosaics.length === 0 && (
            <p className="muted">
              You have no saved mosaics yet. <a href={href('/new')}>Make one</a> and it will appear here.
            </p>
          )}
        </div>
      </div>

      {chosen.length > 0 && (
        <PrintRoot paper={opts.paper} orientation="portrait">
          <Sheet className="cover-sheet">
            <div className="cover">
              <div className="cover-art">
                {chosen.slice(0, 9).map((c) => (
                  <img key={c.id} src={c.thumbnail} alt="" />
                ))}
              </div>
              <h1 className="cover-title">{opts.title || 'My Mosaic Book'}</h1>
              {opts.subtitle && <p className="cover-subtitle">{opts.subtitle}</p>}
              <p className="cover-meta">
                {chosen.length} {chosen.length === 1 ? 'puzzle' : 'puzzles'} · {modesUsed.map((m) => m.name).join(', ')}
              </p>
              <div className="cover-brand">
                <Logo size={18} /> Made with Mosaica
              </div>
            </div>
          </Sheet>
          {frontPages}
          {puzzlePages}
          {solutionPages}
        </PrintRoot>
      )}
    </div>
  );
}
