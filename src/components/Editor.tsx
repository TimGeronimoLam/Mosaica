import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ModeId, MosaicRecord, MosaicSettings } from '../types';
import { getMosaic, newId, putMosaic } from '../lib/db';
import { cropRect, loadImageElement, prepareSourceBlob, rasterize, type SourceRaster } from '../lib/image';
import { MODES, MODE_BY_ID, defaultSettings, generatePuzzle, normalizeSettings } from '../lib/modes';
import { pixelize } from '../lib/pixelize';
import { randomSeed } from '../lib/rng';
import { renderThumbnail } from '../lib/thumbnail';
import { navigate } from '../router';
import { Logo } from './Header';
import { IconChevronDown, IconEye, IconImage, IconInfo, IconMinus, IconPlus, IconPrinter, IconSave, IconShuffle, IconSliders, IconUpload, ModeBadge, ModeChip } from './Icons';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';
import { Segmented, Slider, Toggle } from './ui';

interface Source {
  blob: Blob;
  img: HTMLImageElement;
  raster: SourceRaster;
  url: string;
}

const ZOOM_STEPS = [40, 50, 60, 75, 100, 125, 150, 200, 250, 300];

function heightForAspect(img: HTMLImageElement, width: number): number {
  return Math.max(2, Math.round((width * img.naturalHeight) / img.naturalWidth));
}

export function Editor({ id }: { id: string | null }) {
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<ModeId>('colorByCode');
  const [settings, setSettings] = useState<MosaicSettings>(() => defaultSettings('colorByCode', randomSeed()));
  const [source, setSource] = useState<Source | null>(null);
  const [createdAt, setCreatedAt] = useState<number>(() => Date.now());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [dragOver, setDragOver] = useState(false);
  /** Which half of the editor is visible on phones (both are shown on wider screens). */
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  /** "How to play" starts open on wide screens and folded on phones, where space is tight. */
  const [rulesOpen, setRulesOpen] = useState(() => window.matchMedia('(min-width: 720px)').matches);
  const fileInput = useRef<HTMLInputElement>(null);

  const def = MODE_BY_ID[mode];

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
        setTitle(rec.title);
        setMode(rec.mode);
        setSettings({ ...defaultSettings(rec.mode, rec.settings.seed), ...rec.settings });
        setCreatedAt(rec.createdAt);
        setSavedAt(rec.updatedAt);
        setSource({ blob: rec.source, img, raster: rasterize(img), url: URL.createObjectURL(rec.source) });
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

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source.url);
  }, [source]);

  const update = useCallback(
    (patch: Partial<MosaicSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        if (source && next.lockAspect && (patch.gridWidth !== undefined || patch.lockAspect)) {
          next.gridHeight = heightForAspect(source.img, next.gridWidth);
        }
        return next;
      });
      setDirty(true);
    },
    [source],
  );

  const changeMode = (m: ModeId) => {
    const d = MODE_BY_ID[m];
    setMode(m);
    setSettings((prev) => {
      const next = { ...prev, ...d.force, gridWidth: d.defaultWidth };
      if (source && prev.lockAspect) next.gridHeight = heightForAspect(source.img, next.gridWidth);
      else next.gridHeight = Math.round((prev.gridHeight / prev.gridWidth) * next.gridWidth);
      return normalizeSettings(m, next);
    });
    setDirty(true);
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
      if (source) URL.revokeObjectURL(source.url);
      setSource({ blob, img, raster: rasterize(img), url: URL.createObjectURL(blob) });
      setSettings((prev) => ({ ...prev, gridHeight: prev.lockAspect ? heightForAspect(img, prev.gridWidth) : prev.gridHeight, zoom: 1, cx: 0.5, cy: 0.5 }));
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      setDirty(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Heavy work runs on a deferred copy of the settings so sliders stay responsive.
  const deferred = useDeferredValue(settings);
  const effective = useMemo(() => normalizeSettings(mode, deferred), [mode, deferred]);
  const grid = useMemo(() => (source ? pixelize(source.raster, effective, def.kind(effective)) : null), [source, effective, def]);
  const puzzle = useMemo(() => (grid ? generatePuzzle(mode, grid, effective) : null), [grid, mode, effective]);
  const pixelPreview = useMemo(() => (grid ? renderThumbnail(grid, 260) : ''), [grid]);
  const busy = deferred !== settings;

  const save = useCallback(async (): Promise<string | null> => {
    if (!source || !grid || !puzzle) return null;
    setSaving(true);
    try {
      const recId = id ?? newId();
      const now = Date.now();
      const rec: MosaicRecord = {
        id: recId,
        title: title.trim(),
        mode,
        createdAt,
        updatedAt: now,
        settings: effective,
        source: source.blob,
        sourceWidth: source.img.naturalWidth,
        sourceHeight: source.img.naturalHeight,
        grid,
        puzzle,
        thumbnail: renderThumbnail(grid, 320),
      };
      await putMosaic(rec);
      setDirty(false);
      setSavedAt(now);
      if (!id) navigate(`/edit/${recId}`);
      return recId;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  }, [source, grid, puzzle, id, title, mode, createdAt, effective]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty && source) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, source]);

  const print = async () => {
    const recId = dirty || !id ? await save() : id;
    if (recId) navigate(`/print/${recId}`);
  };

  if (loading) return <div className="page narrow muted">Loading mosaic…</div>;

  const crop = source ? cropRect({ width: source.img.naturalWidth, height: source.img.naturalHeight }, settings.gridWidth, settings.gridHeight, settings) : null;
  const show = (key: string) => def.settings.includes(key as never);
  const isBinary = def.kind(settings) === 'binary' || def.kind(settings) === 'mystery';
  const usesSeed = mode === 'fillapix' || mode === 'logipix' || mode === 'labymage' || (mode === 'colorByCode' && settings.labelStyle === 'sums') || def.kind(settings) === 'palette';
  const chooseFile = () => fileInput.current?.click();
  const zoomOut = ZOOM_STEPS.filter((z) => z < zoom).pop();
  const zoomIn = ZOOM_STEPS.find((z) => z > zoom);
  const saveState = saving ? 'saving' : dirty ? 'dirty' : savedAt ? 'saved' : 'empty';

  return (
    <div className="editor" data-pane={pane}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />

      <div className="editor-toolbar">
        <input
          className="title-input"
          value={title}
          placeholder="Untitled mosaic"
          aria-label="Mosaic title"
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
        <span className={`save-state ${saveState}`} role="status">
          {saving ? 'Saving…' : dirty ? 'Unsaved' : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
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
            onClick={chooseFile}
            role="button"
            tabIndex={0}
            aria-label={source ? 'Replace image' : 'Choose an image'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                chooseFile();
              }
            }}
          >
            {source && crop ? (
              <div className="crop-preview">
                <img src={source.url} alt="" />
                <div
                  className="crop-box"
                  style={{
                    left: `${(crop.x / source.img.naturalWidth) * 100}%`,
                    top: `${(crop.y / source.img.naturalHeight) * 100}%`,
                    width: `${(crop.w / source.img.naturalWidth) * 100}%`,
                    height: `${(crop.h / source.img.naturalHeight) * 100}%`,
                  }}
                />
              </div>
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
                <button className="btn small" onClick={chooseFile}>
                  <IconImage size={16} /> Replace image
                </button>
              </div>
              <Slider label="Zoom" value={settings.zoom} min={1} max={4} step={0.05} onChange={(v) => update({ zoom: v })} format={(v) => `${v.toFixed(2)}×`} />
              {(settings.zoom > 1 || !settings.lockAspect) && (
                <>
                  <Slider label="Pan left / right" value={settings.cx} min={0} max={1} step={0.01} onChange={(v) => update({ cx: v })} format={(v) => `${Math.round(v * 100)}%`} />
                  <Slider label="Pan up / down" value={settings.cy} min={0} max={1} step={0.01} onChange={(v) => update({ cy: v })} format={(v) => `${Math.round(v * 100)}%`} />
                </>
              )}
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
          <Slider label="Width (cells)" value={settings.gridWidth} min={5} max={def.maxWidth} onChange={(v) => update({ gridWidth: v })} />
          {!settings.lockAspect && <Slider label="Height (cells)" value={settings.gridHeight} min={5} max={Math.round(def.maxWidth * 1.5)} onChange={(v) => update({ gridHeight: v })} />}
          <Toggle label="Keep image proportions" checked={settings.lockAspect} onChange={(v) => update({ lockAspect: v })} />
          <span className="size-chip">
            {settings.gridWidth} × {settings.gridHeight} cells{mode === 'labymage' ? ` · maze ${settings.gridWidth * 2} × ${settings.gridHeight * 2}` : ''}
          </span>
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <span className="step">4</span> {def.name} settings
          </h2>
          {show('threshold') && isBinary && (
            <Slider label="Ink threshold" value={settings.threshold} min={5} max={95} onChange={(v) => update({ threshold: v })} format={(v) => `${v}%`} />
          )}
          {show('colors') && !isBinary && <Slider label="Colours" value={settings.colors} min={2} max={16} onChange={(v) => update({ colors: v })} />}
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
              <Slider label="Detail (smaller = more dots)" value={settings.dotsDetail} min={0.3} max={4} step={0.1} onChange={(v) => update({ dotsDetail: v })} format={(v) => v.toFixed(1)} />
              <Slider label="Ignore blobs smaller than" value={settings.dotsMinRegion} min={1} max={60} onChange={(v) => update({ dotsMinRegion: v })} format={(v) => `${v} cells`} />
              <Slider label="Longest gap between dots" value={settings.dotsMaxGap} min={1} max={12} step={0.5} onChange={(v) => update({ dotsMaxGap: v })} format={(v) => `${v} cells`} />
              <Slider label="Maximum dots" value={settings.dotsMaxDots} min={20} max={600} step={10} onChange={(v) => update({ dotsMaxDots: v })} />
            </>
          )}
          {show('logipix') && (
            <>
              <Toggle label="Colour version" checked={settings.logipixColor} onChange={(v) => update({ logipixColor: v })} />
              <Slider label="Longest path" value={settings.logipixMaxLen} min={2} max={12} onChange={(v) => update({ logipixMaxLen: v })} />
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
          {show('maze') && <Slider label="Corridor twistiness" value={settings.mazeTwist} min={0} max={100} onChange={(v) => update({ mazeTwist: v })} format={(v) => `${v}%`} />}
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
            <span className="step">5</span> Image adjustments
          </h2>
          <Slider label="Brightness" value={settings.brightness} min={-100} max={100} onChange={(v) => update({ brightness: v })} />
          <Slider label="Contrast" value={settings.contrast} min={-100} max={100} onChange={(v) => update({ contrast: v })} />
          {!isBinary && <Slider label="Saturation" value={settings.saturation} min={-100} max={100} onChange={(v) => update({ saturation: v })} />}
          <Slider label="Remove specks" value={settings.despeckle} min={0} max={3} onChange={(v) => update({ despeckle: v })} format={(v) => (v === 0 ? 'off' : `${v}`)} />
          <Toggle label="Invert" checked={settings.invert} onChange={(v) => update({ invert: v })} />
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
        {puzzle ? (
          <>
            <div className="preview-bar">
              <Segmented
                label="Show"
                value={showSolution ? 'solution' : 'puzzle'}
                onChange={(v) => setShowSolution(v === 'solution')}
                options={[
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
            <details className="rules" open={rulesOpen} onToggle={(e) => setRulesOpen(e.currentTarget.open)}>
              <summary>
                <IconInfo size={16} />
                How to play
                <IconChevronDown size={16} className="rules-chevron" />
              </summary>
              <p>{def.rules}</p>
            </details>
            <div className="preview">
              <div className="preview-inner" style={{ width: `${zoom}%` }}>
                <PuzzleSvg puzzle={puzzle} solution={showSolution} />
              </div>
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
            <p className="muted small">Faces, animals, simple logos and high-contrast pictures work best. You can crop, zoom and tune the result afterwards.</p>
          </div>
        )}
      </main>
    </div>
  );
}
