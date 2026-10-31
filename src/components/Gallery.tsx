import { useRef, useState } from 'react';
import type { MosaicRecord } from '../types';
import { formatDate, useMosaics } from '../hooks';
import { deleteMosaic, newId, putMosaic } from '../lib/db';
import { MODES, MODE_BY_ID } from '../lib/modes';
import { downloadJson, exportMosaics, importMosaics } from '../lib/serialize';
import { href } from '../router';
import { Logo } from './Header';
import { IconArchive, IconBook, IconChevronDown, IconCopy, IconDownload, IconMore, IconPlus, IconPrinter, IconTrash, IconUpload, ModeBadge, ModeChip } from './Icons';
import { puzzleSummary } from './PuzzleSvg';
import { Menu, MenuItem } from './ui';

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
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };

  const chooseImport = () => importInput.current?.click();

  const alerts = (
    <>
      {notice && (
        <div className="alert info" role="status">
          <span>{notice}</span>
          <button className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
    </>
  );

  return (
    <div className="page">
      <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
      {loading ? (
        <p className="muted">Loading…</p>
      ) : mosaics.length === 0 ? (
        <>
          {alerts}
          <section className="hero">
            <div>
              <span className="eyebrow">
                <Logo size={18} /> Picture puzzles from your photos
              </span>
              <h1>
                Turn any picture into a puzzle <em>you can print.</em>
              </h1>
              <p className="hero-lead">
                Drop in a photo, a drawing or a logo. Mosaica turns it into pixel art, then into a nonogram, a colour-by-code grid, a maze and more, ready to print on its own or as a whole book.
              </p>
              <div className="hero-actions">
                <a className="btn primary large" href={href('/new')}>
                  <IconPlus /> Make your first mosaic
                </a>
                <button className="btn large" onClick={chooseImport}>
                  <IconUpload /> Import a backup
                </button>
              </div>
              <p className="hero-note">Everything stays in this browser. Nothing is uploaded.</p>
            </div>
            <ul className="mode-showcase" aria-label="Puzzle types">
              {MODES.map((m) => (
                <li key={m.id}>
                  <ModeBadge mode={m.id} size={36} />
                  <div>
                    <strong>{m.name}</strong>
                    <span className="tagline">{m.tagline}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <>
          <div className="page-head">
            <div>
              <h1>
                My mosaics <span className="count">{mosaics.length}</span>
              </h1>
              <p className="muted">Every puzzle you save lives here, in this browser. Export a backup to move them elsewhere.</p>
            </div>
            <div className="page-actions">
              <Menu
                label="Backup"
                triggerClassName="btn"
                trigger={
                  <>
                    <IconArchive /> Backup <IconChevronDown size={16} />
                  </>
                }
              >
                <MenuItem icon={<IconDownload />} onSelect={() => void exportAll()}>
                  Export all as JSON
                </MenuItem>
                <MenuItem icon={<IconUpload />} onSelect={chooseImport}>
                  Import from a file
                </MenuItem>
              </Menu>
              <a className="btn" href={href('/book')}>
                <IconBook /> Print a book
              </a>
              <a className="btn primary" href={href('/new')}>
                <IconPlus /> New mosaic
              </a>
            </div>
          </div>
          {alerts}
          <div className="cards">
            {mosaics.map((m) => {
              const title = m.title || 'Untitled mosaic';
              const mode = MODE_BY_ID[m.mode];
              return (
                <article key={m.id} className="card">
                  <a className="card-thumb" href={href(`/edit/${m.id}`)} tabIndex={-1} aria-hidden="true">
                    <img src={m.thumbnail} alt="" />
                  </a>
                  <div className="card-main">
                    <div className="card-body">
                      {mode ? <ModeChip mode={m.mode} name={mode.name} /> : <span className="mode-chip">{m.mode}</span>}
                      <h2 className="card-title" title={title}>
                        <a href={href(`/edit/${m.id}`)}>{title}</a>
                      </h2>
                      <p className="card-meta">
                        {puzzleSummary(m.puzzle)} · {formatDate(m.updatedAt)}
                      </p>
                    </div>
                    <div className="card-actions">
                      <a className="btn small primary" href={href(`/edit/${m.id}`)} aria-label={`Open ${title}`}>
                        Open
                      </a>
                      <a className="btn small print-btn" href={href(`/print/${m.id}`)} aria-label={`Print ${title}`}>
                        <IconPrinter size={16} />
                        <span className="btn-label">Print</span>
                      </a>
                      <Menu label={`More actions for ${title}`} trigger={<IconMore />}>
                        <MenuItem icon={<IconCopy size={16} />} onSelect={() => void duplicate(m)}>
                          Duplicate
                        </MenuItem>
                        <MenuItem icon={<IconDownload size={16} />} onSelect={() => void exportOne(m)}>
                          Export as JSON
                        </MenuItem>
                        <MenuItem danger icon={<IconTrash size={16} />} onSelect={() => void remove(m)}>
                          Delete
                        </MenuItem>
                      </Menu>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
