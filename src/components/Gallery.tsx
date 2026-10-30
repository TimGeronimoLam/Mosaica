import { useRef, useState } from 'react';
import type { MosaicRecord } from '../types';
import { formatDate, useMosaics } from '../hooks';
import { deleteMosaic, newId, putMosaic } from '../lib/db';
import { MODE_BY_ID } from '../lib/modes';
import { downloadJson, exportMosaics, importMosaics } from '../lib/serialize';
import { href, navigate } from '../router';
import { puzzleSummary } from './PuzzleSvg';

export function Gallery() {
  const { mosaics, loading, error, refresh } = useMosaics();
  const [notice, setNotice] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const duplicate = async (m: MosaicRecord) => {
    const now = Date.now();
    await putMosaic({ ...m, id: newId(), title: `${m.title || 'Untitled mosaic'} (copy)`, createdAt: now, updatedAt: now });
    await refresh();
  };

  const remove = async (m: MosaicRecord) => {
    if (!window.confirm(`Delete "${m.title || 'Untitled mosaic'}"? This cannot be undone.`)) return;
    await deleteMosaic(m.id);
    await refresh();
  };

  const exportOne = async (m: MosaicRecord) => {
    downloadJson(await exportMosaics([m]), `${(m.title || 'mosaic').replace(/[^\w-]+/g, '_')}.mosaica.json`);
  };

  const exportAll = async () => {
    downloadJson(await exportMosaics(mosaics), `mosaica-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const records = await importMosaics(JSON.parse(await file.text()));
      for (const r of records) await putMosaic(r);
      await refresh();
      setNotice(`Imported ${records.length} ${records.length === 1 ? 'mosaic' : 'mosaics'}.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My mosaics</h1>
          <p className="muted">Every puzzle you save lives here, in this browser. Export a backup to move them elsewhere.</p>
        </div>
        <div className="page-actions">
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
          <button className="btn" onClick={() => importInput.current?.click()}>
            Import
          </button>
          <button className="btn" onClick={() => void exportAll()} disabled={mosaics.length === 0}>
            Export all
          </button>
          <a className={`btn ${mosaics.length ? '' : 'disabled'}`} href={href('/book')}>
            Print a book
          </a>
          <a className="btn primary" href={href('/new')}>
            + New mosaic
          </a>
        </div>
      </div>
      {notice && (
        <div className="alert info">
          {notice}{' '}
          <button className="link" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      )}
      {error && <div className="alert">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : mosaics.length === 0 ? (
        <div className="empty">
          <h2>No mosaics yet</h2>
          <p>Turn a photo into a nonogram, a colour-by-code grid, a mystery portrait, a Logipix, a Labymage maze, a connect-the-dots or a Fill-a-Pix.</p>
          <a className="btn primary" href={href('/new')}>
            Make your first mosaic
          </a>
        </div>
      ) : (
        <div className="cards">
          {mosaics.map((m) => (
            <article key={m.id} className="card">
              <a className="card-thumb" href={href(`/edit/${m.id}`)}>
                <img src={m.thumbnail} alt="" />
              </a>
              <div className="card-body">
                <h3>{m.title || 'Untitled mosaic'}</h3>
                <p className="muted small">
                  {MODE_BY_ID[m.mode]?.name ?? m.mode} · {puzzleSummary(m.puzzle)}
                </p>
                <p className="muted small">Updated {formatDate(m.updatedAt)}</p>
              </div>
              <div className="card-actions">
                <button className="btn small primary" onClick={() => navigate(`/edit/${m.id}`)}>
                  Open
                </button>
                <button className="btn small" onClick={() => navigate(`/print/${m.id}`)}>
                  Print
                </button>
                <button className="btn small" onClick={() => void duplicate(m)}>
                  Duplicate
                </button>
                <button className="btn small" onClick={() => void exportOne(m)}>
                  Export
                </button>
                <button className="btn small danger" onClick={() => void remove(m)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
