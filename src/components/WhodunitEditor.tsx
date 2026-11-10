import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MosaicRecord, WhodunitDifficulty, WhodunitPerson } from '../types';
import { useHistory } from '../hooks';
import type { History } from '../lib/history';
import { getMosaic, newId, putMosaic } from '../lib/db';
import { loadImageElement } from '../lib/image';
import { defaultSettings, editorPath } from '../lib/modes';
import { WHODUNIT_MAX, WHODUNIT_MIN, generateWhodunit, personLabels, whodunitGrid, withPeople } from '../lib/modes/whodunit';
import { randomSeed } from '../lib/rng';
import { renderThumbnail } from '../lib/thumbnail';
import { href, navigate } from '../router';
import { IconChevronDown, IconEye, IconInfo, IconMinus, IconPlus, IconPrinter, IconRedo, IconSave, IconShuffle, IconSliders, IconUndo, IconUpload, IconX, ModeChip } from './Icons';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';
import { Segmented, Slider } from './ui';
import { tr, useT } from '../i18n';

/** Everything undo/redo covers. `people` always holds the largest cast, so shrinking the flat keeps the photos. */
interface Doc {
  size: number;
  difficulty: WhodunitDifficulty;
  seed: number;
  people: WhodunitPerson[];
}

type View = 'puzzle' | 'solution';

/** Carries the session over the first save, which moves the editor to /whodunit/<id>. */
const handoff = new Map<string, { history: History<Doc>; view: View; zoom: number }>();

const ZOOM_STEPS = [50, 60, 75, 100, 125, 150, 200];
const PORTRAIT_PX = 240;
/** Width / height of the printed case, roughly: the preview is fitted to it. */
const SHEET_ASPECT = 0.77;

function newDoc(): Doc {
  return { size: 6, difficulty: 'normal', seed: randomSeed(), people: withPeople(WHODUNIT_MAX) };
}

/** A square portrait from the middle of a photo (a little above the middle of tall ones, where faces are). */
async function portraitFromFile(file: Blob): Promise<string> {
  const img = await loadImageElement(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PORTRAIT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(tr().errors.canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PORTRAIT_PX, PORTRAIT_PX);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) * 0.3, side, side, 0, 0, PORTRAIT_PX, PORTRAIT_PX);
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** A name from a file name, unless it is a camera's serial number. */
function nameFromFile(file: File): string | null {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (!base || /\d{3,}/.test(base)) return null;
  return base.slice(0, 18);
}

export function WhodunitEditor({ id }: { id: string | null }) {
  const t = useT();
  const e_ = t.editor;
  const w = t.whodunit;
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const history = useHistory<Doc>(newDoc);
  const doc = history.present;
  const setDoc = history.set;
  /** The document as last saved, or as first dealt for a new case. */
  const [baseline, setBaseline] = useState<Doc>(doc);
  const [savedTitle, setSavedTitle] = useState('');
  const [createdAt, setCreatedAt] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [view, setView] = useState<View>('puzzle');
  const [zoom, setZoom] = useState(100);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [rulesOpen, setRulesOpen] = useState(() => window.matchMedia('(min-width: 720px)').matches);
  const [dragOver, setDragOver] = useState(false);
  const manyInput = useRef<HTMLInputElement>(null);
  const oneInput = useRef<HTMLInputElement>(null);
  const oneTarget = useRef(0);
  const [previewEl, setPreviewEl] = useState<HTMLElement | null>(null);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });

  const dirty = doc !== baseline || title !== savedTitle;

  useLayoutEffect(() => {
    if (!previewEl) return;
    const ro = new ResizeObserver(([entry]) => setPreviewSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(previewEl);
    return () => ro.disconnect();
  }, [previewEl]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getMosaic(id);
        if (cancelled) return;
        if (!rec) throw new Error(tr().errors.mosaicGone);
        if (rec.puzzle.kind !== 'whodunit') {
          window.location.replace(href(editorPath(rec.mode, id)));
          return;
        }
        const loaded: Doc = {
          size: rec.puzzle.width,
          difficulty: rec.settings.whodunitDifficulty ?? 'normal',
          seed: rec.settings.seed,
          people: withPeople(WHODUNIT_MAX, rec.puzzle.people),
        };
        const carried = handoff.get(id);
        handoff.delete(id);
        if (carried) {
          history.restore(carried.history);
          setBaseline(carried.history.present);
          setView(carried.view);
          setZoom(carried.zoom);
        } else {
          history.reset(loaded);
          setBaseline(loaded);
        }
        setTitle(rec.title);
        setSavedTitle(rec.title);
        setCreatedAt(rec.createdAt);
        setSavedAt(rec.updatedAt);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The case depends only on its size, difficulty and seed; names and photos are laid over it.
  const dealt = useMemo(() => generateWhodunit({ size: doc.size, difficulty: doc.difficulty, seed: doc.seed }), [doc.size, doc.difficulty, doc.seed]);
  const puzzle = useMemo(() => ({ ...dealt, people: withPeople(doc.size, doc.people) }), [dealt, doc.size, doc.people]);
  const labels = personLabels(puzzle.people);

  const setPerson = (i: number, patch: Partial<WhodunitPerson>, mergeKey: string | null = null) =>
    setDoc((prev) => ({ ...prev, people: prev.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) }), mergeKey);

  /** Hand out photos to the people who have none: suspects first, the victim last. Grows the flat if they do not fit. */
  const addPhotos = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) {
      if (files.length) setError(t.errors.notImage);
      return;
    }
    try {
      setError(null);
      const made = await Promise.all(images.slice(0, WHODUNIT_MAX).map(async (f) => ({ photo: await portraitFromFile(f), name: nameFromFile(f) })));
      setDoc((prev) => {
        const free = (size: number) => [...Array.from({ length: size - 1 }, (_, i) => i + 1), 0].filter((i) => !prev.people[i].photo);
        let size = prev.size;
        while (size < WHODUNIT_MAX && free(size).length < made.length) size++;
        const slots = free(size);
        const people = prev.people.slice();
        made.slice(0, slots.length).forEach((m, k) => {
          people[slots[k]] = { name: m.name ?? people[slots[k]].name, photo: m.photo };
        });
        return { ...prev, size, people };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const replacePhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t.errors.notImage);
      return;
    }
    try {
      setError(null);
      setPerson(oneTarget.current, { photo: await portraitFromFile(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = useCallback(async (): Promise<string | null> => {
    setSaving(true);
    try {
      const recId = id ?? newId();
      const now = Date.now();
      const grid = whodunitGrid(puzzle);
      const thumbnail = renderThumbnail(grid, 320);
      const rec: MosaicRecord = {
        id: recId,
        title: title.trim(),
        mode: 'whodunit',
        createdAt,
        updatedAt: now,
        settings: { ...defaultSettings('whodunit', doc.seed), whodunitSize: doc.size, whodunitDifficulty: doc.difficulty },
        // A whodunit has no single source picture; the floor plan stands in for it.
        source: await (await fetch(thumbnail)).blob(),
        sourceWidth: grid.width,
        sourceHeight: grid.height,
        grid,
        puzzle,
        thumbnail,
      };
      await putMosaic(rec);
      setBaseline(doc);
      setSavedTitle(title);
      setSavedAt(now);
      if (!id) {
        handoff.set(recId, { history: history.state, view, zoom });
        navigate(`/whodunit/${recId}`);
      }
      return recId;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  }, [id, title, doc, puzzle, createdAt, history.state, view, zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (key !== 'z' && key !== 'y') return;
      // Leave text fields their own undo.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)))) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, history.undo, history.redo]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const print = async () => {
    const recId = dirty || !id ? await save() : id;
    if (recId) navigate(`/print/${recId}`);
  };

  if (loading) return <div className="page narrow muted">{w.loading}</div>;

  const zoomOut = ZOOM_STEPS.filter((z) => z < zoom).pop();
  const zoomIn = ZOOM_STEPS.find((z) => z > zoom);
  const saveState = saving ? 'saving' : dirty ? 'dirty' : savedAt ? 'saved' : 'empty';
  // Fit the whole sheet in the preview where there is room; on phones the page scrolls instead.
  const fitWidth = previewSize.h > 300 ? Math.min(previewSize.w, previewSize.h * SHEET_ASPECT) : previewSize.w;
  const sheetWidth = Math.max(240, Math.round((fitWidth * zoom) / 100));
  const role = (i: number) => (i === 0 ? w.victim : w.suspect(i));

  return (
    <div className="editor" data-pane={pane}>
      <input
        ref={manyInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addPhotos(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={oneInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void replacePhoto(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <div className="editor-toolbar">
        <input className="title-input" value={title} placeholder={w.titlePlaceholder} aria-label={w.titleLabel} onChange={(e) => setTitle(e.target.value)} />
        <span className={`save-state ${saveState}`} role="status">
          {saving ? e_.saving : dirty ? e_.unsaved : savedAt ? e_.saved(new Date(savedAt).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' })) : ''}
        </span>
        <div className="history-buttons" role="group" aria-label={e_.history}>
          <button className="btn ghost icon-only" onClick={history.undo} disabled={!history.canUndo} aria-label={e_.undo} title={e_.undoTitle}>
            <IconUndo size={18} />
          </button>
          <button className="btn ghost icon-only" onClick={history.redo} disabled={!history.canRedo} aria-label={e_.redo} title={e_.redoTitle}>
            <IconRedo size={18} />
          </button>
        </div>
        <div className="editor-actions">
          <Segmented
            className="pane-switch"
            label={e_.show}
            value={pane}
            onChange={(v) => {
              setPane(v);
              window.scrollTo({ top: 0 });
            }}
            options={[
              { value: 'edit', label: e_.edit, icon: <IconSliders size={16} /> },
              { value: 'preview', label: e_.preview, icon: <IconEye size={16} /> },
            ]}
          />
          <button className="btn" onClick={() => void save()} disabled={saving} title={e_.saveTitle}>
            <IconSave size={17} />
            <span>{e_.save}</span>
          </button>
          <button className="btn primary" onClick={() => void print()} disabled={saving}>
            <IconPrinter size={17} />
            <span>{e_.print}</span>
          </button>
        </div>
      </div>

      <aside className="sidebar" aria-label={w.settings}>
        <section className="panel">
          <h2 className="panel-title">
            <span className="step">1</span> {w.stepPeople}
          </h2>
          <button
            className={`photo-drop ${dragOver ? 'over' : ''}`}
            onClick={() => manyInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void addPhotos(Array.from(e.dataTransfer.files));
            }}
          >
            <IconUpload size={18} />
            <span>{dragOver ? w.dropPhotos : w.addPhotos}</span>
          </button>
          <p className="hint">{w.photosHint}</p>
          <ul className="people-list">
            {puzzle.people.map((person, i) => {
              const shown = person.name.trim() || labels[i];
              return (
                <li key={i} className="person-row">
                  <button
                    className={`person-photo ${person.photo ? 'has-photo' : ''}`}
                    onClick={() => {
                      oneTarget.current = i;
                      oneInput.current?.click();
                    }}
                    aria-label={w.choosePhoto(shown)}
                    title={w.choosePhoto(shown)}
                  >
                    {person.photo ? <img src={person.photo} alt="" /> : <span>{labels[i]}</span>}
                  </button>
                  <label className="person-fields">
                    <span className="person-role">{role(i)}</span>
                    <input value={person.name} maxLength={18} aria-label={w.nameOf(role(i))} onChange={(e) => setPerson(i, { name: e.target.value }, `name${i}`)} />
                  </label>
                  {person.photo && (
                    <button className="btn ghost small icon-only" onClick={() => setPerson(i, { photo: undefined })} aria-label={w.removePhoto(shown)} title={w.removePhoto(shown)}>
                      <IconX size={16} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">2</span> {w.stepCase}
          </h2>
          <Slider label={w.people} value={doc.size} min={WHODUNIT_MIN} max={WHODUNIT_MAX} onChange={(v) => setDoc((prev) => ({ ...prev, size: v }), 'size')} />
          <p className="hint">{w.peopleHint(doc.size)}</p>
          <label className="field">
            <span>{w.difficulty}</span>
            <select value={doc.difficulty} onChange={(e) => setDoc((prev) => ({ ...prev, difficulty: e.target.value as WhodunitDifficulty }))}>
              <option value="easy">{w.easy}</option>
              <option value="normal">{w.normal}</option>
              <option value="hard">{w.hard}</option>
            </select>
          </label>
          <div className="panel-row">
            <button className="btn small" onClick={() => setDoc((prev) => ({ ...prev, seed: randomSeed() }))}>
              <IconShuffle size={16} /> {w.newCase}
            </button>
            <span className="hint">{w.newCaseHint}</span>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">{w.stepOther}</h2>
          <a className="btn small" href={href('/new')}>
            {w.otherTypes}
          </a>
        </section>
      </aside>

      <main className="editor-main">
        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button className="link" onClick={() => setError(null)}>
              {t.dismiss}
            </button>
          </div>
        )}
        <div className="preview-bar">
          <Segmented
            className="view-switch"
            label={e_.show}
            value={view}
            onChange={setView}
            options={[
              { value: 'puzzle', label: e_.viewPuzzle },
              { value: 'solution', label: e_.viewSolution },
            ]}
          />
          <span className="preview-meta">
            <ModeChip mode="whodunit" name={t.modes.whodunit.name} />
            <span>{puzzleSummary(puzzle, t)}</span>
            <span>{w.statements(puzzle.clues.length)}</span>
          </span>
          <div className="zoom-stepper" role="group" aria-label={e_.zoom}>
            <button className="btn ghost icon-only" onClick={() => zoomOut && setZoom(zoomOut)} disabled={!zoomOut} aria-label={e_.zoomOut}>
              <IconMinus size={16} />
            </button>
            <button className="zoom-value" onClick={() => setZoom(100)} title={e_.resetZoom}>
              {zoom}%
            </button>
            <button className="btn ghost icon-only" onClick={() => zoomIn && setZoom(zoomIn)} disabled={!zoomIn} aria-label={e_.zoomIn}>
              <IconPlus size={16} />
            </button>
          </div>
        </div>
        <details className="rules" open={rulesOpen} onToggle={(e) => setRulesOpen(e.currentTarget.open)}>
          <summary>
            <IconInfo size={16} />
            {e_.howToPlay}
            <IconChevronDown size={16} className="rules-chevron" />
          </summary>
          <p>{t.modes.whodunit.rules}</p>
        </details>
        <div className={`preview view-${view}`} ref={setPreviewEl}>
          <div className="preview-inner" style={{ width: sheetWidth }}>
            <PuzzleSvg puzzle={puzzle} solution={view === 'solution'} />
          </div>
        </div>
      </main>
    </div>
  );
}
