import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ModeId, MosaicRecord, MosaicSettings } from '../types';
import { useHistory } from '../hooks';
import type { History } from '../lib/history';
import { getMosaic, newId, putMosaic } from '../lib/db';
import { applyEdits, editCount, type CellEdits } from '../lib/edits';
import { cropRect, loadImageElement, prepareSourceBlob, rasterize, renderTransformed, type SourceRaster } from '../lib/image';
import { MASK_MAX, decodeMask, encodeMask, maskCoverage, resizeMask, transformMask, type PhotoMask } from '../lib/mask';
import { MODES, MODE_BY_ID, defaultSettings, generatePuzzle, normalizeSettings } from '../lib/modes';
import { pixelize } from '../lib/pixelize';
import { randomSeed } from '../lib/rng';
import { renderThumbnail } from '../lib/thumbnail';
import { flipView, rotateView, transformedAspect } from '../lib/transform';
import { navigate } from '../router';
import { Logo } from './Header';
import {
  IconChevronDown,
  IconEye,
  IconFlipH,
  IconFlipV,
  IconImage,
  IconInfo,
  IconMinus,
  IconPlus,
  IconPrinter,
  IconRedo,
  IconRotateLeft,
  IconRotateRight,
  IconSave,
  IconShuffle,
  IconSliders,
  IconSparkles,
  IconUndo,
  IconUpload,
  ModeBadge,
  ModeChip,
} from './Icons';
import { DEFAULT_PHOTO_TOOLS, PhotoStage, PhotoThumb, PhotoToolbar, photoToMask, type PhotoTools } from './PhotoStage';
import { DEFAULT_PIXEL_TOOLS, PixelStage, PixelToolbar, type PixelTools } from './PixelStage';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';
import { Segmented, Slider, Toggle } from './ui';

interface Source {
  blob: Blob;
  img: HTMLImageElement;
  /** The untransformed photo at mask resolution, for the magic wand. */
  maskBase: SourceRaster;
}

/** Everything undo/redo covers. */
interface Doc {
  mode: ModeId;
  settings: MosaicSettings;
  mask: PhotoMask | null;
  edits: CellEdits | null;
}

type View = 'photo' | 'pixels' | 'puzzle' | 'solution';

/**
 * Saving a new mosaic moves the editor to /edit/<id>, which mounts a fresh
 * editor. This carries the session over so undo history, the open view and the
 * tool choices survive the first save.
 */
const handoff = new Map<
  string,
  { history: History<Doc>; savedDoc: Doc; view: View; zoom: number; pane: 'edit' | 'preview'; photoTools: PhotoTools; pixelTools: PixelTools }
>();

const ZOOM_STEPS = [40, 50, 60, 75, 100, 125, 150, 200, 250, 300];

/** Settings the clean-up "Reset" puts back. */
const CLEANUP_DEFAULTS = { brightness: 0, contrast: 0, saturation: 0, autoLevels: false, localContrast: 0, smooth: 0, darkDetails: 0, outlines: 0 } satisfies Partial<MosaicSettings>;

function makeSource(blob: Blob, img: HTMLImageElement): Source {
  return { blob, img, maskBase: rasterize(img, MASK_MAX) };
}

/** The whole pipeline for one document: photo → (mask) → pixel art → touch-ups → puzzle. */
function build(source: Source, d: Doc) {
  const effective = normalizeSettings(d.mode, d.settings);
  const photo = renderTransformed(source.img, effective);
  const mask = d.mask ? transformMask(d.mask, photoToMask(photo, source.maskBase.width, source.maskBase.height), photo.raster.width, photo.raster.height) : null;
  const grid = applyEdits(pixelize(photo.raster, effective, MODE_BY_ID[d.mode].kind(effective), mask), d.edits);
  return { effective, grid, puzzle: generatePuzzle(d.mode, grid, effective) };
}

function heightFor(img: HTMLImageElement, s: Pick<MosaicSettings, 'rotate'>, width: number): number {
  return Math.max(2, Math.round(width / transformedAspect(img.naturalWidth, img.naturalHeight, s)));
}

/** Size of an element's content box, kept up to date. */
function useContentSize() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 719px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 719px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Editor({ id }: { id: string | null }) {
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const history = useHistory<Doc>(() => ({ mode: 'colorByCode', settings: defaultSettings('colorByCode', randomSeed()), mask: null, edits: null }));
  const doc = history.present;
  const { mode, settings } = doc;
  const setDoc = history.set;
  const [source, setSource] = useState<Source | null>(null);
  const [createdAt, setCreatedAt] = useState<number>(() => Date.now());
  const [savedDoc, setSavedDoc] = useState<Doc | null>(null);
  const [savedTitle, setSavedTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [view, setView] = useState<View>('puzzle');
  const [zoom, setZoom] = useState(100);
  const [dragOver, setDragOver] = useState(false);
  const [photoTools, setPhotoTools] = useState<PhotoTools>(DEFAULT_PHOTO_TOOLS);
  const [pixelTools, setPixelTools] = useState<PixelTools>(DEFAULT_PIXEL_TOOLS);
  /** Which half of the editor is visible on phones (both are shown on wider screens). */
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  /** "How to play" starts open on wide screens and folded on phones, where space is tight. */
  const [rulesOpen, setRulesOpen] = useState(() => window.matchMedia('(min-width: 720px)').matches);
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewRef, previewSize] = useContentSize();
  const narrow = useNarrow();

  const def = MODE_BY_ID[mode];
  const dirty = !!source && (doc !== savedDoc || title !== savedTitle);

  // Load an existing mosaic.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getMosaic(id);
        if (!rec) throw new Error('This mosaic no longer exists.');
        const img = await loadImageElement(rec.source);
        if (cancelled) return;
        const src = makeSource(rec.source, img);
        const carried = handoff.get(id);
        handoff.delete(id);
        if (carried) {
          history.restore(carried.history);
          setSavedDoc(carried.savedDoc);
          setView(carried.view);
          setZoom(carried.zoom);
          setPane(carried.pane);
          setPhotoTools(carried.photoTools);
          setPixelTools(carried.pixelTools);
        } else {
          const loaded: Doc = {
            mode: rec.mode,
            settings: { ...defaultSettings(rec.mode, rec.settings.seed), ...rec.settings },
            mask: rec.mask ? resizeMask(decodeMask(rec.mask), src.maskBase.width, src.maskBase.height) : null,
            edits: rec.edits ?? null,
          };
          history.reset(loaded);
          setSavedDoc(loaded);
        }
        setTitle(rec.title);
        setSavedTitle(rec.title);
        setCreatedAt(rec.createdAt);
        setSavedAt(rec.updatedAt);
        setSource(src);
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

  /** Change settings. Slider drags pass a merge key so one drag is one undo step. */
  const update = useCallback(
    (patch: Partial<MosaicSettings>, mergeKey: string | null = null) => {
      setDoc((prev) => {
        const next = { ...prev.settings, ...patch };
        if (source && next.lockAspect && (patch.gridWidth !== undefined || patch.lockAspect || patch.rotate !== undefined)) {
          next.gridHeight = heightFor(source.img, next, next.gridWidth);
        }
        return { ...prev, settings: next };
      }, mergeKey);
    },
    [source, setDoc],
  );
  const slide = (key: keyof MosaicSettings) => (v: number) => update({ [key]: v }, key);
  const setMask = useCallback((mask: PhotoMask | null) => setDoc((prev) => ({ ...prev, mask })), [setDoc]);
  const setEdits = useCallback((edits: CellEdits | null) => setDoc((prev) => ({ ...prev, edits })), [setDoc]);
  const onCrop = useCallback((patch: { cx?: number; cy?: number; zoom?: number }) => update(patch, 'crop'), [update]);

  const changeMode = (m: ModeId) => {
    const d = MODE_BY_ID[m];
    setDoc((prev) => {
      const next = { ...prev.settings, ...d.force, gridWidth: d.defaultWidth };
      if (source && prev.settings.lockAspect) next.gridHeight = heightFor(source.img, next, next.gridWidth);
      else next.gridHeight = Math.round((prev.settings.gridHeight / prev.settings.gridWidth) * next.gridWidth);
      return { ...prev, mode: m, settings: normalizeSettings(m, next) };
    });
  };

  const turn = (dir: 1 | -1) => {
    setDoc((prev) => {
      const s = prev.settings;
      const next = { ...s, ...rotateView(s, dir) };
      if (source && s.lockAspect) next.gridHeight = heightFor(source.img, next, next.gridWidth);
      else {
        next.gridWidth = s.gridHeight;
        next.gridHeight = s.gridWidth;
      }
      return { ...prev, settings: normalizeSettings(prev.mode, next) };
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG, JPEG, WebP, GIF…).');
      return;
    }
    try {
      setError(null);
      const img = await loadImageElement(file);
      const blob = await prepareSourceBlob(file, img);
      setSource(makeSource(blob, img));
      // A new photo starts upright and uncropped, without the old photo's mask or touch-ups.
      const s: MosaicSettings = { ...settings, rotate: 0, flipH: false, flipV: false, straighten: 0, zoom: 1, cx: 0.5, cy: 0.5 };
      if (s.lockAspect) s.gridHeight = heightFor(img, s, s.gridWidth);
      history.reset({ mode, settings: s, mask: null, edits: null });
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Heavy work runs on a deferred copy of the document so sliders and brushes stay responsive.
  const deferred = useDeferredValue(doc);
  const effective = useMemo(() => normalizeSettings(deferred.mode, deferred.settings), [deferred.mode, deferred.settings]);
  const deferredDef = MODE_BY_ID[deferred.mode];
  const { rotate, flipH, flipV, straighten } = effective;
  const photo = useMemo(() => (source ? renderTransformed(source.img, { rotate, flipH, flipV, straighten }) : null), [source, rotate, flipH, flipV, straighten]);
  const toMask = useMemo(() => (photo && source ? photoToMask(photo, source.maskBase.width, source.maskBase.height) : null), [photo, source]);
  const photoMask = useMemo(
    () => (photo && toMask && deferred.mask ? transformMask(deferred.mask, toMask, photo.raster.width, photo.raster.height) : null),
    [photo, toMask, deferred.mask],
  );
  const baseGrid = useMemo(() => (photo ? pixelize(photo.raster, effective, deferredDef.kind(effective), photoMask) : null), [photo, effective, deferredDef, photoMask]);
  const grid = useMemo(() => (baseGrid ? applyEdits(baseGrid, deferred.edits) : null), [baseGrid, deferred.edits]);
  const puzzle = useMemo(() => (grid ? generatePuzzle(deferred.mode, grid, effective) : null), [grid, deferred.mode, effective]);
  const pixelPreview = useMemo(() => (grid ? renderThumbnail(grid, 260) : ''), [grid]);
  const busy = deferred !== doc;

  const save = useCallback(async (): Promise<string | null> => {
    if (!source || !grid || !puzzle) return null;
    setSaving(true);
    try {
      // Save what is on screen now, even if the preview has not caught up with the last change.
      const latest = deferred === doc ? { effective, grid, puzzle } : build(source, doc);
      const recId = id ?? newId();
      const now = Date.now();
      const rec: MosaicRecord = {
        id: recId,
        title: title.trim(),
        mode: doc.mode,
        createdAt,
        updatedAt: now,
        settings: latest.effective,
        source: source.blob,
        sourceWidth: source.img.naturalWidth,
        sourceHeight: source.img.naturalHeight,
        grid: latest.grid,
        puzzle: latest.puzzle,
        thumbnail: renderThumbnail(latest.grid, 320),
        mask: doc.mask ? encodeMask(doc.mask) : undefined,
        edits: doc.edits ?? undefined,
      };
      await putMosaic(rec);
      setSavedDoc(doc);
      setSavedTitle(title);
      setSavedAt(now);
      if (!id) {
        handoff.set(recId, { history: history.state, savedDoc: doc, view, zoom, pane, photoTools, pixelTools });
        navigate(`/edit/${recId}`);
      }
      return recId;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  }, [source, grid, puzzle, id, title, doc, deferred, createdAt, effective, history.state, view, zoom, pane, photoTools, pixelTools]);

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
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'color'].includes((t as HTMLInputElement).type)))) return;
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

  if (loading) return <div className="page narrow muted">Loading mosaic…</div>;

  const crop = photo ? cropRect(photo.raster, settings.gridWidth, settings.gridHeight, settings) : null;
  const show = (key: string) => def.settings.includes(key as never);
  const isBinary = def.kind(settings) === 'binary' || def.kind(settings) === 'mystery';
  const usesSeed = mode === 'fillapix' || mode === 'logipix' || mode === 'labymage' || (mode === 'colorByCode' && settings.labelStyle === 'sums') || def.kind(settings) === 'palette';
  const chooseFile = () => fileInput.current?.click();
  const zoomOut = ZOOM_STEPS.filter((z) => z < zoom).pop();
  const zoomIn = ZOOM_STEPS.find((z) => z > zoom);
  const saveState = saving ? 'saving' : dirty ? 'dirty' : savedAt ? 'saved' : 'empty';
  const removedShare = maskCoverage(doc.mask);
  const touchUps = editCount(doc.edits);
  const cleanupIsDefault = (Object.keys(CLEANUP_DEFAULTS) as (keyof typeof CLEANUP_DEFAULTS)[]).every((k) => settings[k] === CLEANUP_DEFAULTS[k]);
  const openView = (v: View) => {
    setView(v);
    setPane('preview');
    if (narrow) window.scrollTo({ top: 0 });
  };
  const autoFix = () =>
    update({
      autoLevels: true,
      localContrast: 45,
      smooth: 30,
      darkDetails: isBinary ? 40 : 25,
      despeckle: Math.max(1, settings.despeckle),
    });

  // Photo and pixel views fit the picture inside the preview (by width only on phones, where the page scrolls).
  const stageAspect = view === 'pixels' && grid ? grid.width / grid.height : photo ? photo.raster.width / photo.raster.height : 1;
  const fitWidth = Math.max(160, Math.min(previewSize.w, narrow ? Infinity : Math.max(200, previewSize.h) * stageAspect));
  const stageWidth = Math.round((fitWidth * zoom) / 100);

  return (
    <div className="editor" data-pane={pane}>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          // Allow choosing the same file again (to start over from it).
          e.target.value = '';
        }}
      />

      <div className="editor-toolbar">
        <input className="title-input" value={title} placeholder="Untitled mosaic" aria-label="Mosaic title" onChange={(e) => setTitle(e.target.value)} />
        <span className={`save-state ${saveState}`} role="status">
          {saving ? 'Saving…' : dirty ? 'Unsaved' : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <div className="history-buttons" role="group" aria-label="History">
          <button className="btn ghost icon-only" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <IconUndo size={18} />
          </button>
          <button className="btn ghost icon-only" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <IconRedo size={18} />
          </button>
        </div>
        <div className="editor-actions">
          <Segmented
            className="pane-switch"
            label="Show"
            value={pane}
            onChange={(v) => {
              setPane(v);
              window.scrollTo({ top: 0 });
            }}
            options={[
              { value: 'edit', label: 'Edit', icon: <IconSliders size={16} /> },
              { value: 'preview', label: 'Preview', icon: <IconEye size={16} /> },
            ]}
          />
          <button className="btn" onClick={() => void save()} disabled={!source || saving} title="Save (Ctrl+S)">
            <IconSave size={17} />
            <span>Save</span>
          </button>
          <button className="btn primary" onClick={() => void print()} disabled={!source || saving}>
            <IconPrinter size={17} />
            <span>Print…</span>
          </button>
        </div>
      </div>

      <aside className="sidebar" aria-label="Mosaic settings">
        <section className="panel">
          <h2 className="panel-title">
            <span className="step">1</span> Image
          </h2>
          <div
            className={`dropzone ${dragOver ? 'over' : ''} ${source ? 'has-image' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void onFile(e.dataTransfer.files[0]);
            }}
            onClick={() => (source ? openView('photo') : chooseFile())}
            role="button"
            tabIndex={0}
            aria-label={source ? 'Edit the photo: crop and remove background' : 'Choose an image'}
            title={source ? 'Crop and remove background' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (source) openView('photo');
                else chooseFile();
              }
            }}
          >
            {source && photo && crop && toMask ? (
              <PhotoThumb photo={photo} mask={deferred.mask} toMask={toMask} crop={crop} />
            ) : (
              <div className="dropzone-empty">
                <span className="dropzone-icon">
                  <IconUpload size={22} />
                </span>
                <strong>Drop an image here</strong>
                <span>or choose a photo, a drawing or a logo</span>
              </div>
            )}
          </div>
          {source && (
            <>
              <div className="panel-row">
                <div className="icon-group" role="group" aria-label="Orientation">
                  <button className="btn small icon-only" onClick={() => turn(-1)} aria-label="Rotate left" title="Rotate left">
                    <IconRotateLeft size={17} />
                  </button>
                  <button className="btn small icon-only" onClick={() => turn(1)} aria-label="Rotate right" title="Rotate right">
                    <IconRotateRight size={17} />
                  </button>
                  <button className="btn small icon-only" onClick={() => update(flipView(settings, 'h'))} aria-label="Mirror left to right" title="Mirror left to right" aria-pressed={settings.flipH}>
                    <IconFlipH size={17} />
                  </button>
                  <button className="btn small icon-only" onClick={() => update(flipView(settings, 'v'))} aria-label="Flip upside down" title="Flip upside down" aria-pressed={settings.flipV}>
                    <IconFlipV size={17} />
                  </button>
                </div>
                <button className="btn small" onClick={chooseFile}>
                  <IconImage size={16} /> Replace
                </button>
              </div>
              <Slider label="Straighten" value={settings.straighten} min={-45} max={45} step={0.5} onChange={slide('straighten')} format={(v) => `${v > 0 ? '+' : ''}${v}°`} />
              <Slider label="Zoom" value={settings.zoom} min={1} max={4} step={0.05} onChange={slide('zoom')} format={(v) => `${v.toFixed(2)}×`} />
              {(settings.zoom > 1 || !settings.lockAspect) && (
                <>
                  <Slider label="Pan left / right" value={settings.cx} min={0} max={1} step={0.01} onChange={slide('cx')} format={(v) => `${Math.round(v * 100)}%`} />
                  <Slider label="Pan up / down" value={settings.cy} min={0} max={1} step={0.01} onChange={slide('cy')} format={(v) => `${Math.round(v * 100)}%`} />
                </>
              )}
              <p className="hint">
                Tip: in the <button className="link" onClick={() => openView('photo')}>Photo view</button> you can drag the frame and remove a busy background.
              </p>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">2</span> Puzzle type
          </h2>
          <div className="mode-list">
            {MODES.map((m) => (
              <button key={m.id} className={`mode-card ${m.id === mode ? 'active' : ''}`} aria-pressed={m.id === mode} title={m.tagline} onClick={() => changeMode(m.id)}>
                <ModeBadge mode={m.id} size={30} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
          <p className="mode-desc">
            <strong>{def.name}.</strong> {def.tagline}
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">3</span> Grid
          </h2>
          <Slider label="Width (cells)" value={settings.gridWidth} min={5} max={def.maxWidth} onChange={slide('gridWidth')} />
          {!settings.lockAspect && <Slider label="Height (cells)" value={settings.gridHeight} min={5} max={Math.round(def.maxWidth * 1.5)} onChange={slide('gridHeight')} />}
          <Toggle label="Keep image proportions" checked={settings.lockAspect} onChange={(v) => update({ lockAspect: v })} />
          <span className="size-chip">
            {settings.gridWidth} × {settings.gridHeight} cells{mode === 'labymage' ? ` · maze ${settings.gridWidth * 2} × ${settings.gridHeight * 2}` : ''}
          </span>
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">4</span> {def.name} settings
          </h2>
          {show('threshold') && isBinary && <Slider label="Ink threshold" value={settings.threshold} min={5} max={95} onChange={slide('threshold')} format={(v) => `${v}%`} />}
          {show('colors') && !isBinary && <Slider label="Colours" value={settings.colors} min={2} max={16} onChange={slide('colors')} />}
          {show('blankLightest') && !isBinary && (
            <Toggle label="Lightest colour stays white" checked={settings.blankLightest} onChange={(v) => update({ blankLightest: v })} hint="The lightest colour becomes code 0 and is left unpainted." />
          )}
          {show('dither') && <Toggle label="Dither (textured shading)" checked={settings.dither} onChange={(v) => update({ dither: v })} />}
          {show('labelStyle') && (
            <>
              <label className="field">
                <span>Cell labels</span>
                <select value={settings.labelStyle} onChange={(e) => update({ labelStyle: e.target.value as MosaicSettings['labelStyle'] })}>
                  <option value="number">Numbers</option>
                  <option value="sums">Little sums (maths practice)</option>
                </select>
              </label>
              {settings.labelStyle === 'sums' && (
                <label className="field">
                  <span>Operations</span>
                  <select value={settings.sumOps} onChange={(e) => update({ sumOps: e.target.value as MosaicSettings['sumOps'] })}>
                    <option value="add">Addition only</option>
                    <option value="addsub">Addition and subtraction</option>
                    <option value="mul">Multiplication and division</option>
                    <option value="mixed">Everything</option>
                  </select>
                </label>
              )}
            </>
          )}
          {show('dots') && (
            <>
              <Slider label="Detail (smaller = more dots)" value={settings.dotsDetail} min={0.3} max={4} step={0.1} onChange={slide('dotsDetail')} format={(v) => v.toFixed(1)} />
              <Slider label="Ignore blobs smaller than" value={settings.dotsMinRegion} min={1} max={60} onChange={slide('dotsMinRegion')} format={(v) => `${v} cells`} />
              <Slider label="Longest gap between dots" value={settings.dotsMaxGap} min={1} max={12} step={0.5} onChange={slide('dotsMaxGap')} format={(v) => `${v} cells`} />
              <Slider label="Maximum dots" value={settings.dotsMaxDots} min={20} max={600} step={10} onChange={slide('dotsMaxDots')} />
            </>
          )}
          {show('logipix') && (
            <>
              <Toggle label="Colour version" checked={settings.logipixColor} onChange={(v) => update({ logipixColor: v })} />
              <Slider label="Longest path" value={settings.logipixMaxLen} min={2} max={12} onChange={slide('logipixMaxLen')} />
            </>
          )}
          {show('fillapix') && (
            <label className="field">
              <span>Difficulty</span>
              <select value={settings.fillapixDifficulty} onChange={(e) => update({ fillapixDifficulty: e.target.value as MosaicSettings['fillapixDifficulty'] })}>
                <option value="easy">Easy (one clue at a time)</option>
                <option value="normal">Normal (combine clues)</option>
              </select>
            </label>
          )}
          {show('maze') && <Slider label="Corridor twistiness" value={settings.mazeTwist} min={0} max={100} onChange={slide('mazeTwist')} format={(v) => `${v}%`} />}
          {usesSeed && (
            <div className="panel-row">
              <button className="btn small" onClick={() => update({ seed: randomSeed() })}>
                <IconShuffle size={16} /> Shuffle
              </button>
              <span className="hint">Try a new random variation</span>
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">5</span> Photo clean-up
          </h2>
          <div className="panel-row">
            <button className="btn small" onClick={autoFix} disabled={!source} title="Even out lighting, simplify textures and keep small dark details">
              <IconSparkles size={16} /> Auto-fix photo
            </button>
            <button className="btn small ghost" onClick={() => update(CLEANUP_DEFAULTS)} disabled={cleanupIsDefault}>
              Reset
            </button>
          </div>
          <Toggle label="Auto levels" checked={settings.autoLevels} onChange={(v) => update({ autoLevels: v })} hint="Stretch the darkest and lightest parts of the crop to black and white." />
          <Slider label="Brightness" value={settings.brightness} min={-100} max={100} onChange={slide('brightness')} />
          <Slider label="Contrast" value={settings.contrast} min={-100} max={100} onChange={slide('contrast')} />
          {!isBinary && <Slider label="Saturation" value={settings.saturation} min={-100} max={100} onChange={slide('saturation')} />}
          <Slider label="Even out lighting" value={settings.localContrast} min={0} max={100} onChange={slide('localContrast')} format={pct} />
          <Slider label="Simplify textures" value={settings.smooth} min={0} max={100} onChange={slide('smooth')} format={pct} />
          <Slider label="Keep dark details" value={settings.darkDetails} min={0} max={100} onChange={slide('darkDetails')} format={pct} />
          <Slider label="Outline edges" value={settings.outlines} min={0} max={100} onChange={slide('outlines')} format={pct} />
          <Slider label="Remove specks" value={settings.despeckle} min={0} max={3} onChange={slide('despeckle')} format={(v) => (v === 0 ? 'off' : `${v}`)} />
          <Toggle label="Invert" checked={settings.invert} onChange={(v) => update({ invert: v })} />
          {source && (
            <div className="cleanup-status">
              <div>
                <span>{removedShare > 0 ? `Background: ${Math.round(removedShare * 100)}% removed` : 'Background: kept'}</span>
                <button className="link" onClick={() => openView('photo')}>
                  {removedShare > 0 ? 'Edit' : 'Remove…'}
                </button>
              </div>
              <div>
                <span>{touchUps ? `${touchUps} cell${touchUps === 1 ? '' : 's'} touched up` : 'No touch-ups'}</span>
                <button className="link" onClick={() => openView('pixels')}>
                  {touchUps ? 'Edit' : 'Touch up…'}
                </button>
              </div>
            </div>
          )}
          {pixelPreview && (
            <div className="pixel-preview">
              <span className="pixel-preview-label">Pixel art</span>
              <img src={pixelPreview} alt="Pixel art preview" />
            </div>
          )}
        </section>
      </aside>

      <main className="editor-main">
        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button className="link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {puzzle && photo && crop && grid && baseGrid && source ? (
          <>
            <div className="preview-bar">
              <Segmented
                className="view-switch"
                label="Show"
                value={view}
                onChange={setView}
                options={[
                  { value: 'photo', label: 'Photo' },
                  { value: 'pixels', label: 'Pixels' },
                  { value: 'puzzle', label: 'Puzzle' },
                  { value: 'solution', label: 'Solution' },
                ]}
              />
              <span className="preview-meta">
                <ModeChip mode={mode} name={def.name} />
                <span>{puzzleSummary(puzzle)}</span>
                {busy && <span className="busy">Updating</span>}
              </span>
              <div className="zoom-stepper" role="group" aria-label="Zoom">
                <button className="btn ghost icon-only" onClick={() => zoomOut && setZoom(zoomOut)} disabled={!zoomOut} aria-label="Zoom out">
                  <IconMinus size={16} />
                </button>
                <button className="zoom-value" onClick={() => setZoom(100)} title="Reset zoom">
                  {zoom}%
                </button>
                <button className="btn ghost icon-only" onClick={() => zoomIn && setZoom(zoomIn)} disabled={!zoomIn} aria-label="Zoom in">
                  <IconPlus size={16} />
                </button>
              </div>
            </div>
            {view === 'photo' && (
              <PhotoToolbar
                tools={photoTools}
                onTools={(p) => setPhotoTools((t) => ({ ...t, ...p }))}
                mask={doc.mask}
                maskBase={source.maskBase}
                zoom={settings.zoom}
                onZoom={slide('zoom')}
                onMask={setMask}
              />
            )}
            {view === 'pixels' && <PixelToolbar grid={grid} edits={doc.edits} tools={pixelTools} onTools={(p) => setPixelTools((t) => ({ ...t, ...p }))} onEdits={setEdits} />}
            {(view === 'puzzle' || view === 'solution') && (
              <details className="rules" open={rulesOpen} onToggle={(e) => setRulesOpen(e.currentTarget.open)}>
                <summary>
                  <IconInfo size={16} />
                  How to play
                  <IconChevronDown size={16} className="rules-chevron" />
                </summary>
                <p>{def.rules}</p>
              </details>
            )}
            <div className={`preview view-${view}`} ref={previewRef}>
              {view === 'photo' ? (
                <PhotoStage
                  photo={photo}
                  mask={doc.mask}
                  maskBase={source.maskBase}
                  crop={crop}
                  cellSize={crop.w / settings.gridWidth}
                  zoom={settings.zoom}
                  displayWidth={stageWidth}
                  tools={photoTools}
                  onCrop={onCrop}
                  onMask={setMask}
                />
              ) : view === 'pixels' ? (
                <PixelStage
                  grid={grid}
                  base={baseGrid}
                  edits={doc.edits}
                  photo={photo}
                  crop={cropRect(photo.raster, effective.gridWidth, effective.gridHeight, effective)}
                  displayWidth={stageWidth}
                  tools={pixelTools}
                  onTools={(p) => setPixelTools((t) => ({ ...t, ...p }))}
                  onEdits={setEdits}
                />
              ) : (
                <div className="preview-inner" style={{ width: `${zoom}%` }}>
                  <PuzzleSvg puzzle={puzzle} solution={view === 'solution'} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-editor">
            <span className="empty-art">
              <Logo size={56} />
            </span>
            <h2>Start with an image</h2>
            <p>Mosaica turns a photo, a drawing or a logo into pixel art, and then into a puzzle you can print.</p>
            <button className="btn primary large" onClick={chooseFile}>
              <IconUpload /> Choose an image
            </button>
            <p className="muted small">Faces, animals, simple logos and high-contrast pictures work best. You can crop, rotate, remove the background and touch up the result afterwards.</p>
          </div>
        )}
      </main>
    </div>
  );
}

const pct = (v: number) => (v === 0 ? 'off' : `${v}%`);
