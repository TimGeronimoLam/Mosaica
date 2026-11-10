import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ModeId, MosaicRecord, MosaicSettings } from '../types';
import { useHistory } from '../hooks';
import type { History } from '../lib/history';
import { getMosaic, newId, putMosaic } from '../lib/db';
import { applyEdits, editCount, type CellEdits } from '../lib/edits';
import { CROP_RATIOS, currentBox, dragRatio, largestBox, ratioValue, reconcile, withRatio, type CropRatio } from '../lib/crop';
import { createCropRenderer, cropRect, loadImageElement, prepareSourceBlob, rasterize, renderTransformed, type SourceRaster } from '../lib/image';
import { MASK_MAX, decodeMask, encodeMask, maskCoverage, resizeMask, transformMask, transformMaskMax, type PhotoMask } from '../lib/mask';
import { MODES, MODE_BY_ID, defaultSettings, editorPath, generatePuzzle, loadSettings, normalizeSettings } from '../lib/modes';
import { pixelize, suggestThreshold } from '../lib/pixelize';
import { makeSampler } from '../lib/sampler';
import { randomSeed } from '../lib/rng';
import { renderThumbnail } from '../lib/thumbnail';
import { flipView, rotateView, transformedAspect } from '../lib/transform';
import { href, navigate } from '../router';
import { Logo } from './Header';
import {
  IconChevronDown,
  IconCrop,
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
import { analyzeNonogram, type NonogramAnalysis } from '../lib/modes/nonogramSolver';
import { Segmented, Slider, Toggle } from './ui';
import { tr, useT, type Messages } from '../i18n';

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
  /** Areas marked as detail (eyes, mouth…) that the converter protects. */
  detail: PhotoMask | null;
  /** Outlines traced by the line-art network, which "Outline edges" darkens. */
  lineart: PhotoMask | null;
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
const CLEANUP_DEFAULTS = { brightness: 0, contrast: 0, saturation: 0, autoLevels: false, localContrast: 0, smooth: 0, darkDetails: 0, outlines: 0, restoreContrast: 0 } satisfies Partial<MosaicSettings>;

function makeSource(blob: Blob, img: HTMLImageElement): Source {
  return { blob, img, maskBase: rasterize(img, MASK_MAX) };
}

/** The whole pipeline for one document: photo → (mask) → pixel art → touch-ups → puzzle. */
function build(source: Source, d: Doc) {
  const effective = normalizeSettings(d.mode, d.settings);
  const photo = renderTransformed(source.img, effective);
  const toMask = photoToMask(photo, source.maskBase.width, source.maskBase.height);
  const legacy = effective.converter < 2;
  const photoMask = d.mask && legacy ? transformMask(d.mask, toMask, photo.raster.width, photo.raster.height) : null;
  const photoDetail = d.detail && legacy ? transformMask(d.detail, toMask, photo.raster.width, photo.raster.height) : null;
  const photoLineart = d.lineart && legacy ? transformMaskMax(d.lineart, toMask, photo.raster.width, photo.raster.height) : null;
  const sampler = makeSampler({
    photo,
    settings: effective,
    mask: d.mask,
    detail: d.detail,
    lineart: d.lineart,
    toMask,
    photoMask,
    photoDetail,
    photoLineart,
    renderer: legacy ? null : createCropRenderer(source.img, photo),
  });
  const grid = applyEdits(pixelize(sampler, effective, MODE_BY_ID[d.mode].kind(effective)), d.edits);
  return { effective, grid, puzzle: generatePuzzle(d.mode, grid, effective) };
}

/** Width / height of the photo after rotating. */
function photoAspect(img: HTMLImageElement, s: Pick<MosaicSettings, 'rotate'>): number {
  return transformedAspect(img.naturalWidth, img.naturalHeight, s);
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
  const t = useT();
  const e_ = t.editor;
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const history = useHistory<Doc>(() => ({ mode: 'colorByCode', settings: defaultSettings('colorByCode', randomSeed()), mask: null, detail: null, lineart: null, edits: null }));
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
        if (!rec) throw new Error(tr().errors.mosaicGone);
        if (MODE_BY_ID[rec.mode]?.standalone) {
          // Made in its own editor; a stale /edit link lands there instead.
          window.location.replace(href(editorPath(rec.mode, id)));
          return;
        }
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
            settings: loadSettings(rec.mode, rec.settings),
            mask: rec.mask ? resizeMask(decodeMask(rec.mask), src.maskBase.width, src.maskBase.height) : null,
            detail: rec.detail ? resizeMask(decodeMask(rec.detail), src.maskBase.width, src.maskBase.height) : null,
            lineart: rec.lineart ? resizeMask(decodeMask(rec.lineart), src.maskBase.width, src.maskBase.height) : null,
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
        return { ...prev, settings: source ? reconcile(next, photoAspect(source.img, next)) : next };
      }, mergeKey);
    },
    [source, setDoc],
  );
  const slide = (key: keyof MosaicSettings) => (v: number) => update({ [key]: v }, key);
  const setMask = useCallback((mask: PhotoMask | null) => setDoc((prev) => ({ ...prev, mask })), [setDoc]);
  const setDetail = useCallback((detail: PhotoMask | null) => setDoc((prev) => ({ ...prev, detail })), [setDoc]);
  const setLineart = useCallback((lineart: PhotoMask | null) => setDoc((prev) => ({ ...prev, lineart })), [setDoc]);
  const setEdits = useCallback((edits: CellEdits | null) => setDoc((prev) => ({ ...prev, edits })), [setDoc]);
  const onCrop = useCallback((crop: MosaicSettings['crop']) => update({ crop }, 'crop'), [update]);

  const changeMode = (m: ModeId) => {
    const d = MODE_BY_ID[m];
    if (d.standalone) {
      // A whodunit is built from several photos in its own editor.
      if (!dirty || window.confirm(t.whodunit.leave)) navigate(editorPath(m));
      return;
    }
    setDoc((prev) => {
      const next = { ...prev.settings, ...d.force, gridWidth: d.defaultWidth };
      next.gridHeight = Math.max(2, Math.round((prev.settings.gridHeight / prev.settings.gridWidth) * next.gridWidth));
      const fitted = normalizeSettings(m, source ? reconcile(next, photoAspect(source.img, next)) : next);
      return { ...prev, mode: m, settings: fitted };
    });
  };

  const turn = (dir: 1 | -1) => {
    setDoc((prev) => {
      const s = prev.settings;
      const next = { ...s, ...rotateView(s, dir) };
      if (!s.lockAspect) {
        next.gridWidth = s.gridHeight;
        next.gridHeight = s.gridWidth;
      }
      return { ...prev, settings: normalizeSettings(prev.mode, source ? reconcile(next, photoAspect(source.img, next)) : next) };
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t.errors.notImage);
      return;
    }
    try {
      setError(null);
      const img = await loadImageElement(file);
      const blob = await prepareSourceBlob(file, img);
      setSource(makeSource(blob, img));
      // A new photo starts upright and uncropped, without the old photo's mask or touch-ups.
      const base: MosaicSettings = { ...settings, rotate: 0, flipH: false, flipV: false, straighten: 0, zoom: 1, cx: 0.5, cy: 0.5 };
      const A = photoAspect(img, base);
      const s = reconcile({ ...base, crop: largestBox(base.lockAspect ? ratioValue(base.cropRatio, A) : base.gridWidth / base.gridHeight, A) }, A);
      history.reset({ mode, settings: normalizeSettings(mode, s), mask: null, detail: null, lineart: null, edits: null });
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
  const legacy = effective.converter < 2;
  // Converter 1 samples a mask resampled onto the working copy; converter 2 maps it per crop.
  const photoMask = useMemo(
    () => (legacy && photo && toMask && deferred.mask ? transformMask(deferred.mask, toMask, photo.raster.width, photo.raster.height) : null),
    [legacy, photo, toMask, deferred.mask],
  );
  const photoDetail = useMemo(
    () => (legacy && photo && toMask && deferred.detail ? transformMask(deferred.detail, toMask, photo.raster.width, photo.raster.height) : null),
    [legacy, photo, toMask, deferred.detail],
  );
  const photoLineart = useMemo(
    () => (legacy && photo && toMask && deferred.lineart ? transformMaskMax(deferred.lineart, toMask, photo.raster.width, photo.raster.height) : null),
    [legacy, photo, toMask, deferred.lineart],
  );
  const renderer = useMemo(() => (!legacy && source && photo ? createCropRenderer(source.img, photo) : null), [legacy, source, photo]);
  const sampler = useMemo(
    () =>
      photo
        ? makeSampler({
            photo,
            settings: effective,
            mask: deferred.mask,
            detail: deferred.detail,
            lineart: deferred.lineart,
            toMask,
            photoMask,
            photoDetail,
            photoLineart,
            renderer,
          })
        : null,
    [photo, effective, deferred.mask, deferred.detail, deferred.lineart, toMask, photoMask, photoDetail, photoLineart, renderer],
  );
  const baseGrid = useMemo(() => (sampler ? pixelize(sampler, effective, deferredDef.kind(effective)) : null), [sampler, effective, deferredDef]);
  const grid = useMemo(() => (baseGrid ? applyEdits(baseGrid, deferred.edits) : null), [baseGrid, deferred.edits]);
  const puzzle = useMemo(() => (grid ? generatePuzzle(deferred.mode, grid, effective) : null), [grid, deferred.mode, effective]);
  const pixelPreview = useMemo(() => (grid ? renderThumbnail(grid, 260) : ''), [grid]);
  const analysis = useMemo(() => (puzzle?.kind === 'nonogram' ? analyzeNonogram(puzzle, { budgetMs: 300 }) : null), [puzzle]);
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
        detail: doc.detail ? encodeMask(doc.detail) : undefined,
        lineart: doc.lineart ? encodeMask(doc.lineart) : undefined,
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

  if (loading) return <div className="page narrow muted">{e_.loading}</div>;

  const crop = photo ? cropRect(photo.raster, settings.gridWidth, settings.gridHeight, settings) : null;
  const A = photo ? photo.raster.width / photo.raster.height : 1;
  const box = photo ? currentBox(photo.raster, settings.gridWidth, settings.gridHeight, settings) : null;
  const ratio = dragRatio(settings, A);
  const setCropRatio = (r: CropRatio) => {
    if (!box) return;
    const value = ratioValue(r, A);
    update({ cropRatio: r, crop: value === null ? box : withRatio(box, value, A) });
  };
  const resetCrop = () => update({ crop: largestBox(ratio, A) });
  const openCrop = () => {
    setPhotoTools((t) => ({ ...t, tool: 'crop' }));
    openView('photo');
  };
  const autoThreshold = () => sampler && update({ threshold: suggestThreshold(sampler, effective, deferredDef.kind(effective)) });
  const upgradeConverter = () =>
    update({ converter: 2, cellColor: 'main', minRegion: 3, despeckle: 0, ditherStyle: settings.dither ? 'diffusion' : 'pattern' });
  const ditherValue = !settings.dither ? 'off' : settings.ditherStyle;
  const show = (key: string) => def.settings.includes(key as never);
  const isBinary = def.kind(settings) === 'binary' || def.kind(settings) === 'mystery';
  const usesSeed = mode === 'fillapix' || mode === 'logipix' || mode === 'labymage' || (mode === 'colorByCode' && settings.labelStyle === 'sums') || def.kind(settings) === 'palette';
  const chooseFile = () => fileInput.current?.click();
  const zoomOut = ZOOM_STEPS.filter((z) => z < zoom).pop();
  const zoomIn = ZOOM_STEPS.find((z) => z > zoom);
  const saveState = saving ? 'saving' : dirty ? 'dirty' : savedAt ? 'saved' : 'empty';
  const removedShare = maskCoverage(doc.mask);
  const detailShare = maskCoverage(doc.detail);
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
      restoreContrast: 50,
      despeckle: Math.max(1, settings.despeckle),
    });
  const openDetail = () => {
    setPhotoTools((t) => ({ ...t, tool: 'brush', layer: 'detail', erase: true }));
    openView('photo');
  };

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
        <input className="title-input" value={title} placeholder={e_.titlePlaceholder} aria-label={e_.titleLabel} onChange={(e) => setTitle(e.target.value)} />
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
          <button className="btn" onClick={() => void save()} disabled={!source || saving} title={e_.saveTitle}>
            <IconSave size={17} />
            <span>{e_.save}</span>
          </button>
          <button className="btn primary" onClick={() => void print()} disabled={!source || saving}>
            <IconPrinter size={17} />
            <span>{e_.print}</span>
          </button>
        </div>
      </div>

      <aside className="sidebar" aria-label={e_.settings}>
        <section className="panel">
          <h2 className="panel-title">
            <span className="step">1</span> {e_.stepImage}
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
            aria-label={source ? e_.editPhoto : e_.chooseImage}
            title={source ? e_.editPhotoTitle : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (source) openView('photo');
                else chooseFile();
              }
            }}
          >
            {source && photo && crop && toMask ? (
              <PhotoThumb photo={photo} mask={deferred.mask} detail={deferred.detail} lineart={deferred.lineart} toMask={toMask} crop={crop} />
            ) : (
              <div className="dropzone-empty">
                <span className="dropzone-icon">
                  <IconUpload size={22} />
                </span>
                <strong>{e_.dropHere}</strong>
                <span>{e_.dropSub}</span>
              </div>
            )}
          </div>
          {source && (
            <>
              <div className="panel-row">
                <div className="icon-group" role="group" aria-label={e_.orientation}>
                  <button className="btn small icon-only" onClick={() => turn(-1)} aria-label={e_.rotateLeft} title={e_.rotateLeft}>
                    <IconRotateLeft size={17} />
                  </button>
                  <button className="btn small icon-only" onClick={() => turn(1)} aria-label={e_.rotateRight} title={e_.rotateRight}>
                    <IconRotateRight size={17} />
                  </button>
                  <button className="btn small icon-only" onClick={() => update(flipView(settings, 'h'))} aria-label={e_.mirror} title={e_.mirror} aria-pressed={settings.flipH}>
                    <IconFlipH size={17} />
                  </button>
                  <button className="btn small icon-only" onClick={() => update(flipView(settings, 'v'))} aria-label={e_.flip} title={e_.flip} aria-pressed={settings.flipV}>
                    <IconFlipV size={17} />
                  </button>
                </div>
                <button className="btn small" onClick={chooseFile}>
                  <IconImage size={16} /> {e_.replace}
                </button>
              </div>
              <Slider label={e_.straighten} value={settings.straighten} min={-45} max={45} step={0.5} onChange={slide('straighten')} format={(v) => `${v > 0 ? '+' : ''}${v}°`} />
              <div className="panel-row">
                <label className="field inline">
                  <span>{e_.cropShape}</span>
                  <select value={settings.lockAspect ? settings.cropRatio : 'grid'} disabled={!settings.lockAspect} onChange={(e) => setCropRatio(e.target.value as CropRatio)}>
                    {!settings.lockAspect && <option value="grid">{e_.sameAsGrid}</option>}
                    {CROP_RATIOS.map((r) => (
                      <option key={r} value={r}>
                        {t.cropRatios[r]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="panel-row">
                <button className="btn small" onClick={openCrop}>
                  <IconCrop size={16} /> {e_.crop}
                </button>
                <button className="btn small ghost" onClick={resetCrop}>
                  {e_.resetCrop}
                </button>
              </div>
              <p className="hint">
                {e_.cropHintBefore}
                <button className="link" onClick={openCrop}>
                  {e_.cropHintLink}
                </button>
                {e_.cropHintAfter}
              </p>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">2</span> {e_.stepType}
          </h2>
          <div className="mode-list">
            {MODES.map((m) => (
              <button key={m.id} className={`mode-card ${m.id === mode ? 'active' : ''}`} aria-pressed={m.id === mode} title={t.modes[m.id].tagline} onClick={() => changeMode(m.id)}>
                <ModeBadge mode={m.id} size={30} />
                <span>{t.modes[m.id].name}</span>
              </button>
            ))}
          </div>
          <p className="mode-desc">
            <strong>{t.modes[mode].name}.</strong> {t.modes[mode].tagline}
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">3</span> {e_.stepGrid}
          </h2>
          <Slider label={e_.width} value={settings.gridWidth} min={5} max={def.maxWidth} onChange={slide('gridWidth')} />
          {!settings.lockAspect && <Slider label={e_.height} value={settings.gridHeight} min={5} max={Math.round(def.maxWidth * 1.5)} onChange={slide('gridHeight')} />}
          <Toggle
            label={e_.heightFollows}
            checked={settings.lockAspect}
            onChange={(v) => update({ lockAspect: v })}
            hint={e_.heightFollowsHint}
          />
          <span className="size-chip">
            {e_.cells(settings.gridWidth, settings.gridHeight)}
            {mode === 'labymage' ? e_.mazeSize(settings.gridWidth * 2, settings.gridHeight * 2) : ''}
          </span>
          <div className="field">
            <span>{e_.cellTakes}</span>
            <Segmented
              className="block"
              label={e_.cellTakes}
              value={settings.cellColor}
              onChange={(v) => update({ cellColor: v })}
              options={[
                { value: 'main', label: e_.mainColour },
                { value: 'average', label: e_.average },
              ]}
            />
            <span className="hint">
              {settings.cellColor === 'main'
                ? e_.mainHint
                : e_.averageHint}
            </span>
          </div>
          {settings.converter < 2 && (
            <div className="alert info compact">
              <span>{e_.legacy}</span>
              <button className="link" onClick={upgradeConverter}>
                {e_.upgrade}
              </button>
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">4</span> {e_.modeSettings(t.modes[mode].name)}
          </h2>
          {show('threshold') && isBinary && (
            <>
              <Slider label={e_.threshold} value={settings.threshold} min={5} max={95} onChange={slide('threshold')} format={(v) => `${v}%`} />
              <div className="panel-row tight">
                <button className="btn small" onClick={autoThreshold} title={e_.autoThresholdTitle}>
                  <IconSparkles size={16} /> {e_.autoThreshold}
                </button>
              </div>
            </>
          )}
          {show('colors') && !isBinary && <Slider label={e_.colours} value={settings.colors} min={2} max={16} onChange={slide('colors')} />}
          {show('blankLightest') && !isBinary && (
            <Toggle label={e_.lightestWhite} checked={settings.blankLightest} onChange={(v) => update({ blankLightest: v })} hint={e_.lightestWhiteHint} />
          )}
          {show('dither') &&
            (settings.converter < 2 || def.kind(settings) === 'mystery' ? (
              <Toggle label={e_.dither} checked={settings.dither} onChange={(v) => update({ dither: v })} />
            ) : (
              <div className="field">
                <span>{e_.shading}</span>
                <Segmented
                  className="block"
                  label={e_.shading}
                  value={ditherValue}
                  onChange={(v) => update(v === 'off' ? { dither: false } : { dither: true, ditherStyle: v })}
                  options={[
                    { value: 'off', label: e_.flat },
                    { value: 'pattern', label: e_.pattern },
                    { value: 'diffusion', label: e_.speckle },
                  ]}
                />
              </div>
            ))}
          {show('dither') && settings.dither && <Slider label={e_.shadingStrength} value={settings.ditherAmount} min={10} max={100} step={5} onChange={slide('ditherAmount')} format={(v) => `${v}%`} />}
          {def.kind(settings) !== 'mystery' && (
            <>
              <Slider
                label={e_.mergeSmaller}
                value={settings.minRegion}
                min={0}
                max={12}
                onChange={slide('minRegion')}
                format={(v) => (settings.dither ? e_.offWhileShading : v < 2 ? e_.off : e_.nCells(v))}
              />
              <p className="hint">{e_.mergeHint}</p>
            </>
          )}
          {show('labelStyle') && (
            <>
              <label className="field">
                <span>{e_.cellLabels}</span>
                <select value={settings.labelStyle} onChange={(e) => update({ labelStyle: e.target.value as MosaicSettings['labelStyle'] })}>
                  <option value="number">{e_.numbers}</option>
                  <option value="sums">{e_.sums}</option>
                </select>
              </label>
              {settings.labelStyle === 'sums' && (
                <label className="field">
                  <span>{e_.operations}</span>
                  <select value={settings.sumOps} onChange={(e) => update({ sumOps: e.target.value as MosaicSettings['sumOps'] })}>
                    <option value="add">{e_.opAdd}</option>
                    <option value="addsub">{e_.opAddSub}</option>
                    <option value="mul">{e_.opMul}</option>
                    <option value="mixed">{e_.opMixed}</option>
                  </select>
                </label>
              )}
            </>
          )}
          {show('dots') && (
            <>
              <Slider label={e_.dotsDetail} value={settings.dotsDetail} min={0.3} max={4} step={0.1} onChange={slide('dotsDetail')} format={(v) => v.toFixed(1)} />
              <Slider label={e_.dotsMinRegion} value={settings.dotsMinRegion} min={1} max={60} onChange={slide('dotsMinRegion')} format={e_.nCells} />
              <Slider label={e_.dotsMaxGap} value={settings.dotsMaxGap} min={1} max={12} step={0.5} onChange={slide('dotsMaxGap')} format={e_.nCells} />
              <Slider label={e_.dotsMax} value={settings.dotsMaxDots} min={20} max={600} step={10} onChange={slide('dotsMaxDots')} />
            </>
          )}
          {show('logipix') && (
            <>
              <Toggle label={e_.colourVersion} checked={settings.logipixColor} onChange={(v) => update({ logipixColor: v })} />
              <Slider label={e_.longestPath} value={settings.logipixMaxLen} min={2} max={12} onChange={slide('logipixMaxLen')} />
            </>
          )}
          {show('fillapix') && (
            <label className="field">
              <span>{e_.difficulty}</span>
              <select value={settings.fillapixDifficulty} onChange={(e) => update({ fillapixDifficulty: e.target.value as MosaicSettings['fillapixDifficulty'] })}>
                <option value="easy">{e_.easy}</option>
                <option value="normal">{e_.normal}</option>
              </select>
            </label>
          )}
          {show('maze') && <Slider label={e_.twist} value={settings.mazeTwist} min={0} max={100} onChange={slide('mazeTwist')} format={(v) => `${v}%`} />}
          {usesSeed && (
            <div className="panel-row">
              <button className="btn small" onClick={() => update({ seed: randomSeed() })}>
                <IconShuffle size={16} /> {e_.shuffle}
              </button>
              <span className="hint">{e_.shuffleHint}</span>
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">5</span> {e_.stepCleanup}
          </h2>
          <div className="panel-row">
            <button className="btn small" onClick={autoFix} disabled={!source} title={e_.autoFixTitle}>
              <IconSparkles size={16} /> {e_.autoFix}
            </button>
            <button className="btn small ghost" onClick={() => update(CLEANUP_DEFAULTS)} disabled={cleanupIsDefault}>
              {e_.reset}
            </button>
          </div>
          <Toggle label={e_.autoLevels} checked={settings.autoLevels} onChange={(v) => update({ autoLevels: v })} hint={e_.autoLevelsHint} />
          <Slider label={e_.brightness} value={settings.brightness} min={-100} max={100} onChange={slide('brightness')} />
          <Slider label={e_.contrast} value={settings.contrast} min={-100} max={100} onChange={slide('contrast')} />
          {!isBinary && <Slider label={e_.saturation} value={settings.saturation} min={-100} max={100} onChange={slide('saturation')} />}
          <Slider label={e_.evenLighting} value={settings.localContrast} min={0} max={100} onChange={slide('localContrast')} format={pct} />
          <Slider label={e_.simplify} value={settings.smooth} min={0} max={100} onChange={slide('smooth')} format={pct} />
          <Slider label={e_.darkDetails} value={settings.darkDetails} min={0} max={100} onChange={slide('darkDetails')} format={pct} />
          <Slider label={e_.restoreContrast} value={settings.restoreContrast} min={0} max={100} onChange={slide('restoreContrast')} format={pct} />
          <p className="hint">{e_.restoreHint}</p>
          <Slider label={doc.lineart ? e_.outlinesTraced : e_.outlines} value={settings.outlines} min={0} max={100} onChange={slide('outlines')} format={pct} />
          {doc.lineart && <p className="hint">{e_.outlinesHint}</p>}
          {(settings.despeckle > 0 || settings.converter < 2) && (
            <Slider label={e_.despeckle} value={settings.despeckle} min={0} max={3} onChange={slide('despeckle')} format={(v) => (v === 0 ? e_.off : `${v}`)} />
          )}
          <Toggle label={e_.invert} checked={settings.invert} onChange={(v) => update({ invert: v })} />
          {source && (
            <div className="cleanup-status">
              <div>
                <span>{removedShare > 0 ? e_.bgRemoved(Math.round(removedShare * 100)) : e_.bgKept}</span>
                <button className="link" onClick={() => openView('photo')}>
                  {removedShare > 0 ? e_.editLink : e_.removeLink}
                </button>
              </div>
              <div>
                <span title={e_.detailTitle}>
                  {detailShare > 0 ? e_.detailMarked(detailShare < 0.005 ? e_.under1 : String(Math.round(detailShare * 100))) : e_.detailNone}
                </span>
                <button className="link" onClick={openDetail}>
                  {detailShare > 0 ? e_.editLink : e_.markLink}
                </button>
              </div>
              <div>
                <span title={e_.outlinesTitle}>{doc.lineart ? e_.outlinesYes : e_.outlinesNo}</span>
                <button className="link" onClick={() => openView('photo')}>
                  {doc.lineart ? e_.editLink : e_.traceLink}
                </button>
              </div>
              <div>
                <span>{touchUps ? e_.touchUps(touchUps) : e_.noTouchUps}</span>
                <button className="link" onClick={() => openView('pixels')}>
                  {touchUps ? e_.editLink : e_.touchUpLink}
                </button>
              </div>
            </div>
          )}
          {pixelPreview && (
            <div className="pixel-preview">
              <span className="pixel-preview-label">{e_.pixelArt}</span>
              <img src={pixelPreview} alt={e_.pixelArtAlt} />
            </div>
          )}
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
        {puzzle && photo && crop && grid && baseGrid && source ? (
          <>
            <div className="preview-bar">
              <Segmented
                className="view-switch"
                label={e_.show}
                value={view}
                onChange={setView}
                options={[
                  { value: 'photo', label: e_.viewPhoto },
                  { value: 'pixels', label: e_.viewPixels },
                  { value: 'puzzle', label: e_.viewPuzzle },
                  { value: 'solution', label: e_.viewSolution },
                ]}
              />
              <span className="preview-meta">
                <ModeChip mode={mode} name={t.modes[mode].name} />
                <span>{puzzleSummary(puzzle, t)}</span>
                {analysis && <SolvabilityChip analysis={analysis} t={t} />}
                {busy && <span className="busy">{e_.updating}</span>}
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
            {view === 'photo' && (
              <PhotoToolbar
                tools={photoTools}
                onTools={(p) => setPhotoTools((t) => ({ ...t, ...p }))}
                mask={doc.mask}
                detail={doc.detail}
                lineart={doc.lineart}
                maskBase={source.maskBase}
                cropRatio={settings.cropRatio}
                ratioFree={settings.lockAspect}
                onRatio={setCropRatio}
                onResetCrop={resetCrop}
                onMask={setMask}
                onDetail={setDetail}
                onLineart={setLineart}
              />
            )}
            {view === 'pixels' && <PixelToolbar grid={grid} edits={doc.edits} tools={pixelTools} onTools={(p) => setPixelTools((t) => ({ ...t, ...p }))} onEdits={setEdits} />}
            {(view === 'puzzle' || view === 'solution') && (
              <details className="rules" open={rulesOpen} onToggle={(e) => setRulesOpen(e.currentTarget.open)}>
                <summary>
                  <IconInfo size={16} />
                  {e_.howToPlay}
                  <IconChevronDown size={16} className="rules-chevron" />
                </summary>
                <p>{t.modes[mode].rules}</p>
              </details>
            )}
            {(view === 'puzzle' || view === 'solution') && analysis?.status === 'ambiguous' && (
              <div className="alert compact">
                <span>{e_.ambiguous}</span>
              </div>
            )}
            <div className={`preview view-${view}`} ref={previewRef}>
              {view === 'photo' ? (
                <PhotoStage
                  photo={photo}
                  mask={doc.mask}
                  detail={doc.detail}
                  lineart={doc.lineart}
                  maskBase={source.maskBase}
                  box={box ?? { x: 0, y: 0, w: 1, h: 1 }}
                  ratio={ratio}
                  gridWidth={settings.gridWidth}
                  gridHeight={settings.gridHeight}
                  cellSize={crop.w / settings.gridWidth}
                  displayWidth={stageWidth}
                  tools={photoTools}
                  onCrop={onCrop}
                  onMask={setMask}
                  onDetail={setDetail}
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
                  <PuzzleSvg puzzle={puzzle} solution={view === 'solution'} marks={analysis?.ambiguous} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-editor">
            <span className="empty-art">
              <Logo size={56} />
            </span>
            <h2>{e_.startTitle}</h2>
            <p>{e_.startLead}</p>
            <button className="btn primary large" onClick={chooseFile}>
              <IconUpload /> {e_.chooseImage}
            </button>
            <p className="muted small">{e_.startTip}</p>
          </div>
        )}
      </main>
    </div>
  );
}

const pct = (v: number) => (v === 0 ? tr().editor.off : `${v}%`);

function SolvabilityChip({ analysis, t }: { analysis: NonogramAnalysis; t: Messages }) {
  const n = analysis.ambiguous.length;
  return (
    <span className={`check check-${analysis.status}`} title={t.editor.checkTitle[analysis.status]}>
      {t.editor.check[analysis.status]}
      {analysis.status === 'ambiguous' && t.editor.checkCells(n)}
    </span>
  );
}
