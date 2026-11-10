import { useEffect, useMemo, useState } from 'react';
import type { MosaicRecord, PaperSize } from '../types';
import { useMosaics } from '../hooks';
import { MODES } from '../lib/modes';
import { href } from '../router';
import { Logo } from './Header';
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconBook, IconInfo, IconPlus, IconPrinter } from './Icons';
import { PrintRoot, PuzzleSheet, Sheet, SheetFooter } from './Sheet';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';
import { Segmented, Toggle } from './ui';
import { useT } from '../i18n';

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
  title: '',
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
    const saved = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<BookOptions>) } : DEFAULTS;
    // The old English default was stored as a real title; clear it so the default follows the language.
    return saved.title === 'My Mosaic Book' ? { ...saved, title: '' } : saved;
  } catch {
    return DEFAULTS;
  }
}

export function BookView({ query }: { query: URLSearchParams }) {
  const t = useT();
  const b = t.book;
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
          <h2 className="sheet-title">{t.sheet.howToPlay}</h2>
        </div>
        <div className="sheet-body text-body">
          {modesUsed.map((m) => (
            <div key={m.id} className="howto-entry">
              <h3>{t.modes[m.id].name}</h3>
              <p>{t.modes[m.id].rules}</p>
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
          <h2 className="sheet-title">{t.sheet.contents}</h2>
        </div>
        <div className="sheet-body text-body">
          <ol className="contents-list">
            {chosen.map((c, i) => (
              <li key={c.id}>
                <span className="contents-title">
                  {c.title || t.untitled} <em>{t.modes[c.mode].name}</em>
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
            <h2 className="sheet-title">{t.sheet.solutions}</h2>
          </div>
          <div className="sheet-body solutions-grid">
            {pair.map((c, k) => (
              <div key={c.id} className="solution-cell">
                <div className="solution-label">
                  <span className="sheet-number small">{i + k + 1}</span> {c.title || t.untitled} <span className="sheet-meta">{puzzleSummary(c.puzzle, t)}</span>
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
      <aside className="print-panel no-print" aria-label={b.options}>
        <div className="print-panel-body">
          <a className="back-link" href={href('/')}>
            <IconArrowLeft size={16} /> {b.back}
          </a>
          <h1>{b.title}</h1>
          <p className="lead">{b.lead}</p>

          <div className="option-group">
            <label className="field">
              <span>{b.bookTitle}</span>
              <input value={opts.title} onChange={(e) => set('title', e.target.value)} placeholder={b.defaultTitle} />
            </label>
            <label className="field">
              <span>{b.subtitle}</span>
              <input value={opts.subtitle} onChange={(e) => set('subtitle', e.target.value)} placeholder={b.subtitlePlaceholder} />
            </label>
            <div className="option-row">
              <span className="option-label">{b.paper}</span>
              <Segmented
                className="block"
                label={b.paper}
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
            <Toggle label={b.howTo} checked={opts.includeHowTo} onChange={(v) => set('includeHowTo', v)} />
            <Toggle label={b.contents} checked={opts.includeContents} onChange={(v) => set('includeContents', v)} />
            <Toggle label={b.rules} checked={opts.showRules} onChange={(v) => set('showRules', v)} />
            <Toggle label={b.solutions} checked={opts.includeSolutions} onChange={(v) => set('includeSolutions', v)} />
          </div>

          <div className="option-group book-picker">
            <div className="book-picker-head">
              <span className="option-label">
                {b.mosaics} <span className="muted">{b.count(chosen.length, mosaics.length)}</span>
              </span>
              {mosaics.length > 0 && (
                <span className="book-picker-tools">
                  <button className="link" aria-label={b.selectAll} onClick={() => setSelected(new Set(order ?? []))}>
                    {b.all}
                  </button>
                  <button className="link" aria-label={b.selectNone} onClick={() => setSelected(new Set())}>
                    {b.none}
                  </button>
                </span>
              )}
            </div>
            {mosaics.length > 0 && (
              <ul className="book-list">
                {(order ?? []).map((id, i) => {
                  const m = byId.get(id);
                  if (!m) return null;
                  const title = m.title || t.untitled;
                  return (
                    <li key={id} className={selected?.has(id) ? 'on' : ''}>
                      <label>
                        <input type="checkbox" checked={!!selected?.has(id)} onChange={() => toggle(id)} />
                        <img src={m.thumbnail} alt="" />
                        <span className="book-list-text">
                          <span className="book-list-title">{title}</span>
                          <span className="book-list-mode">{t.modes[m.mode].name}</span>
                        </span>
                      </label>
                      <span className="book-list-actions">
                        <button className="btn ghost icon-only" aria-label={b.moveUpTitle(title)} title={b.moveUp} onClick={() => move(id, -1)} disabled={i === 0}>
                          <IconArrowUp size={16} />
                        </button>
                        <button className="btn ghost icon-only" aria-label={b.moveDownTitle(title)} title={b.moveDown} onClick={() => move(id, 1)} disabled={i === (order?.length ?? 0) - 1}>
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
                {b.emptyBefore}
                <a href={href('/new')}>{b.emptyLink}</a>
                {b.emptyAfter}
              </p>
            )}
          </div>
        </div>
        <div className="print-panel-foot">
          <button className="btn primary large block" onClick={() => window.print()} disabled={chosen.length === 0}>
            <IconPrinter /> {totalPages ? b.printPages(totalPages) : b.printBook}
          </button>
          <p className="print-tip">
            <IconInfo size={15} />
            <span>{t.print.tip(opts.paper)}</span>
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
                  <p>{b.builtFrom}</p>
                  <a className="btn primary" href={href('/new')}>
                    <IconPlus /> {b.makeMosaic}
                  </a>
                </>
              ) : (
                <p>{b.pickOne}</p>
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
                <h1 className="cover-title">{opts.title || b.defaultTitle}</h1>
                {opts.subtitle && <p className="cover-subtitle">{opts.subtitle}</p>}
                <p className="cover-meta">
                  {t.sheet.puzzles(chosen.length)} · {modesUsed.map((m) => t.modes[m.id].name).join(', ')}
                </p>
                <div className="cover-brand">
                  <Logo size={18} /> {t.sheet.madeWith}
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
