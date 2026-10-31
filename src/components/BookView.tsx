import { useEffect, useMemo, useState } from 'react';
import type { MosaicRecord, PaperSize } from '../types';
import { useMosaics } from '../hooks';
import { MODE_BY_ID, MODES } from '../lib/modes';
import { href } from '../router';
import { Logo } from './Header';
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconBook, IconInfo, IconPlus, IconPrinter } from './Icons';
import { PrintRoot, PuzzleSheet, Sheet, SheetFooter } from './Sheet';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';
import { Segmented, Toggle } from './ui';

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

  const totalPages = chosen.length ? page : 0;

  return (
    <div className="print-layout book-page">
      <aside className="print-panel no-print" aria-label="Book options">
        <div className="print-panel-body">
          <a className="back-link" href={href('/')}>
            <IconArrowLeft size={16} /> My mosaics
          </a>
          <h1>Print a book</h1>
          <p className="lead">A cover, a how-to-play page, contents, one puzzle per page and the solutions at the back.</p>

          <div className="option-group">
            <label className="field">
              <span>Book title</span>
              <input value={opts.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="field">
              <span>Subtitle</span>
              <input value={opts.subtitle} onChange={(e) => set('subtitle', e.target.value)} placeholder="e.g. Puzzles for Grandma" />
            </label>
            <div className="option-row">
              <span className="option-label">Paper</span>
              <Segmented
                className="block"
                label="Paper"
                value={opts.paper}
                onChange={(v) => set('paper', v)}
                options={[
                  { value: 'A4', label: 'A4' },
                  { value: 'Letter', label: 'Letter' },
                ]}
              />
            </div>
          </div>

          <div className="option-group">
            <Toggle label="How-to-play page" checked={opts.includeHowTo} onChange={(v) => set('includeHowTo', v)} />
            <Toggle label="Contents page" checked={opts.includeContents} onChange={(v) => set('includeContents', v)} />
            <Toggle label="Rules on each puzzle" checked={opts.showRules} onChange={(v) => set('showRules', v)} />
            <Toggle label="Solutions at the back" checked={opts.includeSolutions} onChange={(v) => set('includeSolutions', v)} />
          </div>

          <div className="option-group book-picker">
            <div className="book-picker-head">
              <span className="option-label">
                Mosaics{' '}
                <span className="muted">
                  ({chosen.length} of {mosaics.length})
                </span>
              </span>
              {mosaics.length > 0 && (
                <span className="book-picker-tools">
                  <button className="link" aria-label="Select all" onClick={() => setSelected(new Set(order ?? []))}>
                    All
                  </button>
                  <button className="link" aria-label="Select none" onClick={() => setSelected(new Set())}>
                    None
                  </button>
                </span>
              )}
            </div>
            {mosaics.length > 0 && (
              <ul className="book-list">
                {(order ?? []).map((id, i) => {
                  const m = byId.get(id);
                  if (!m) return null;
                  const title = m.title || 'Untitled mosaic';
                  return (
                    <li key={id} className={selected?.has(id) ? 'on' : ''}>
                      <label>
                        <input type="checkbox" checked={!!selected?.has(id)} onChange={() => toggle(id)} />
                        <img src={m.thumbnail} alt="" />
                        <span className="book-list-text">
                          <span className="book-list-title">{title}</span>
                          <span className="book-list-mode">{MODE_BY_ID[m.mode].name}</span>
                        </span>
                      </label>
                      <span className="book-list-actions">
                        <button className="btn ghost icon-only" aria-label={`Move ${title} up`} title="Move up" onClick={() => move(id, -1)} disabled={i === 0}>
                          <IconArrowUp size={16} />
                        </button>
                        <button className="btn ghost icon-only" aria-label={`Move ${title} down`} title="Move down" onClick={() => move(id, 1)} disabled={i === (order?.length ?? 0) - 1}>
                          <IconArrowDown size={16} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {!loading && mosaics.length === 0 && (
              <p className="muted small">
                You have no saved mosaics yet. <a href={href('/new')}>Make one</a> and it will appear here.
              </p>
            )}
          </div>
        </div>
        <div className="print-panel-foot">
          <button className="btn primary large block" onClick={() => window.print()} disabled={chosen.length === 0}>
            <IconPrinter /> {totalPages ? `Print ${totalPages} pages` : 'Print book'}
          </button>
          <p className="print-tip">
            <IconInfo size={15} />
            <span>In the print dialog, choose {opts.paper} paper and turn off headers and footers.</span>
          </p>
        </div>
      </aside>

      <div className="print-stage">
        {chosen.length === 0 ? (
          !loading && (
            <div className="stage-empty">
              <IconBook size={32} />
              {mosaics.length === 0 ? (
                <>
                  <p>Your book is built from the mosaics in your gallery.</p>
                  <a className="btn primary" href={href('/new')}>
                    <IconPlus /> Make a mosaic
                  </a>
                </>
              ) : (
                <p>Pick at least one mosaic to see the pages of your book.</p>
              )}
            </div>
          )
        ) : (
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
    </div>
  );
}
