import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ModeId, MosaicRecord, MosaicSettings } from '../types';
import { getMosaic, newId, putMosaic } from '../lib/db';
import { cropRect, loadImageElement, prepareSourceBlob, rasterize, type SourceRaster } from '../lib/image';
import { MODES, MODE_BY_ID, defaultSettings, generatePuzzle, normalizeSettings } from '../lib/modes';
import { pixelize } from '../lib/pixelize';
import { randomSeed } from '../lib/rng';
import { renderThumbnail } from '../lib/thumbnail';
import { href, navigate } from '../router';
import { PuzzleSvg, puzzleSummary } from './PuzzleSvg';

interface Source {
  blob: Blob;
  img: HTMLImageElement;
  raster: SourceRaster;
  url: string;
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <output>{format ? format(value) : value}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

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

  if (loading) return <div className="page narrow">Loading mosaic…</div>;

  const crop = source ? cropRect({ width: source.img.naturalWidth, height: source.img.naturalHeight }, settings.gridWidth, settings.gridHeight, settings) : null;
  const show = (key: string) => def.settings.includes(key as never);
  const isBinary = def.kind(settings) === 'binary' || def.kind(settings) === 'mystery';
  const usesSeed = mode === 'fillapix' || mode === 'logipix' || mode === 'labymage' || (mode === 'colorByCode' && settings.labelStyle === 'sums') || def.kind(settings) === 'palette';

  return (
    <div className="editor">
      <aside className="sidebar">
        <section className="panel">
          <h3>Image</h3>
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
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
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
                <strong>Drop an image here</strong>
                <span>or click to choose a photo, drawing or logo</span>
              </div>
            )}
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          {source && (
            <>
              <button className="btn small" onClick={() => fileInput.current?.click()}>
                Replace image
              </button>
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
          <h3>Puzzle type</h3>
          <div className="mode-list">
            {MODES.map((m) => (
              <button key={m.id} className={`mode-card ${m.id === mode ? 'active' : ''}`} onClick={() => changeMode(m.id)}>
                <strong>{m.name}</strong>
                <span>{m.tagline}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Grid</h3>
          <Slider label="Width (cells)" value={settings.gridWidth} min={5} max={def.maxWidth} onChange={(v) => update({ gridWidth: v })} />
          {!settings.lockAspect && <Slider label="Height (cells)" value={settings.gridHeight} min={5} max={Math.round(def.maxWidth * 1.5)} onChange={(v) => update({ gridHeight: v })} />}
          <Toggle label="Keep image proportions" checked={settings.lockAspect} onChange={(v) => update({ lockAspect: v })} />
          <p className="muted small">
            {settings.gridWidth} × {settings.gridHeight} cells{mode === 'labymage' ? ` · maze ${settings.gridWidth * 2} × ${settings.gridHeight * 2}` : ''}
          </p>
        </section>

        <section className="panel">
          <h3>{def.name} settings</h3>
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
              <label className="select">
                <span>Cell labels</span>
                <select value={settings.labelStyle} onChange={(e) => update({ labelStyle: e.target.value as MosaicSettings['labelStyle'] })}>
                  <option value="number">Numbers</option>
                  <option value="sums">Little sums (maths practice)</option>
                </select>
              </label>
              {settings.labelStyle === 'sums' && (
                <label className="select">
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
            <label className="select">
              <span>Difficulty</span>
              <select value={settings.fillapixDifficulty} onChange={(e) => update({ fillapixDifficulty: e.target.value as MosaicSettings['fillapixDifficulty'] })}>
                <option value="easy">Easy (one clue at a time)</option>
                <option value="normal">Normal (combine clues)</option>
              </select>
            </label>
          )}
          {show('maze') && <Slider label="Corridor twistiness" value={settings.mazeTwist} min={0} max={100} onChange={(v) => update({ mazeTwist: v })} format={(v) => `${v}%`} />}
          {usesSeed && (
            <button className="btn small" onClick={() => update({ seed: randomSeed() })}>
              Shuffle (new random variation)
            </button>
          )}
        </section>

        <section className="panel">
          <h3>Image adjustments</h3>
          <Slider label="Brightness" value={settings.brightness} min={-100} max={100} onChange={(v) => update({ brightness: v })} />
          <Slider label="Contrast" value={settings.contrast} min={-100} max={100} onChange={(v) => update({ contrast: v })} />
          {!isBinary && <Slider label="Saturation" value={settings.saturation} min={-100} max={100} onChange={(v) => update({ saturation: v })} />}
          <Slider label="Remove specks" value={settings.despeckle} min={0} max={3} onChange={(v) => update({ despeckle: v })} format={(v) => (v === 0 ? 'off' : `${v}`)} />
          <Toggle label="Invert" checked={settings.invert} onChange={(v) => update({ invert: v })} />
          {pixelPreview && (
            <div className="pixel-preview">
              <img src={pixelPreview} alt="Pixel art preview" />
            </div>
          )}
        </section>
      </aside>

      <main className="editor-main">
        <div className="toolbar">
          <input
            className="title-input"
            value={title}
            placeholder="Untitled mosaic"
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
          <span className={`save-state ${dirty ? 'dirty' : ''}`}>
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : ''}
          </span>
          <div className="toolbar-actions">
            {id && (
              <a className="btn" href={href('/')}>
                Gallery
              </a>
            )}
            <button className="btn" onClick={() => void save()} disabled={!source || saving}>
              Save
            </button>
            <button className="btn primary" onClick={() => void print()} disabled={!source || saving}>
              Print…
            </button>
          </div>
        </div>
        {error && (
          <div className="alert">
            {error}{' '}
            <button className="link" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}
        {puzzle ? (
          <>
            <div className="preview-bar">
              <div className="segmented">
                <button className={!showSolution ? 'on' : ''} onClick={() => setShowSolution(false)}>
                  Puzzle
                </button>
                <button className={showSolution ? 'on' : ''} onClick={() => setShowSolution(true)}>
                  Solution
                </button>
              </div>
              <span className="muted small">
                {def.name} · {puzzleSummary(puzzle)}
                {busy ? ' · updating…' : ''}
              </span>
              <label className="zoom">
                Zoom
                <input type="range" min={40} max={300} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              </label>
            </div>
            <p className="rules">{def.rules}</p>
            <div className="preview">
              <div className="preview-inner" style={{ width: `${zoom}%` }}>
                <PuzzleSvg puzzle={puzzle} solution={showSolution} />
              </div>
            </div>
          </>
        ) : (
          <div className="empty-editor">
            <h2>Start with an image</h2>
            <p>Drop a photo, a drawing or a logo in the panel on the left. Mosaica turns it into pixel art and then into a printable puzzle.</p>
            <p className="muted">Faces, animals, simple logos and high-contrast pictures work best. You can crop, zoom and tune the result afterwards.</p>
          </div>
        )}
      </main>
    </div>
  );
}
