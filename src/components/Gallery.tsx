import { useRef, useState } from 'react';
import type { MosaicRecord } from '../types';
import { formatDate, useMosaics } from '../hooks';
import { deleteMosaic, newId, putMosaic } from '../lib/db';
import { MODES, MODE_BY_ID, editorPath } from '../lib/modes';
import { downloadJson, exportMosaics, importMosaics } from '../lib/serialize';
import { href } from '../router';
import { Logo } from './Header';
import { IconArchive, IconBook, IconChevronDown, IconCopy, IconDownload, IconMore, IconPlus, IconPrinter, IconTrash, IconUpload, ModeBadge, ModeChip } from './Icons';
import { puzzleSummary } from './PuzzleSvg';
import { Menu, MenuItem } from './ui';
import { useT } from '../i18n';

export function Gallery() {
  const t = useT();
  const g = t.gallery;
  const { mosaics, loading, error, refresh } = useMosaics();
  const [notice, setNotice] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const duplicate = async (m: MosaicRecord) => {
    const now = Date.now();
    await putMosaic({ ...m, id: newId(), title: g.copyTitle(m.title || t.untitled), createdAt: now, updatedAt: now });
    await refresh();
  };

  const remove = async (m: MosaicRecord) => {
    if (!window.confirm(g.confirmDelete(m.title || t.untitled))) return;
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
      setNotice(g.imported(records.length));
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
            {t.dismiss}
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
        <p className="muted">{t.loading}</p>
      ) : mosaics.length === 0 ? (
        <>
          {alerts}
          <section className="hero">
            <div>
              <span className="eyebrow">
                <Logo size={18} /> {g.eyebrow}
              </span>
              <h1>
                {g.heroTitle}
                <em>{g.heroTitleEm}</em>
              </h1>
              <p className="hero-lead">
                {g.heroLead}
              </p>
              <div className="hero-actions">
                <a className="btn primary large" href={href('/new')}>
                  <IconPlus /> {g.makeFirst}
                </a>
                <button className="btn large" onClick={chooseImport}>
                  <IconUpload /> {g.importBackup}
                </button>
              </div>
              <p className="hero-note">{g.heroNote}</p>
            </div>
            <ul className="mode-showcase" aria-label={g.puzzleTypes}>
              {MODES.map((m) => (
                <li key={m.id}>
                  <ModeBadge mode={m.id} size={36} />
                  <div>
                    <strong>{t.modes[m.id].name}</strong>
                    <span className="tagline">{t.modes[m.id].tagline}</span>
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
                {g.title} <span className="count">{mosaics.length}</span>
              </h1>
              <p className="muted">{g.lead}</p>
            </div>
            <div className="page-actions">
              <Menu
                label={g.backup}
                triggerClassName="btn"
                trigger={
                  <>
                    <IconArchive /> {g.backup} <IconChevronDown size={16} />
                  </>
                }
              >
                <MenuItem icon={<IconDownload />} onSelect={() => void exportAll()}>
                  {g.exportAll}
                </MenuItem>
                <MenuItem icon={<IconUpload />} onSelect={chooseImport}>
                  {g.importFile}
                </MenuItem>
              </Menu>
              <a className="btn" href={href('/book')}>
                <IconBook /> {g.printBook}
              </a>
              <a className="btn primary" href={href('/new')}>
                <IconPlus /> {g.newMosaic}
              </a>
            </div>
          </div>
          {alerts}
          <div className="cards">
            {mosaics.map((m) => {
              const title = m.title || t.untitled;
              const mode = MODE_BY_ID[m.mode];
              return (
                <article key={m.id} className="card">
                  <a className="card-thumb" href={href(editorPath(m.mode, m.id))} tabIndex={-1} aria-hidden="true">
                    <img src={m.thumbnail} alt="" />
                  </a>
                  <div className="card-main">
                    <div className="card-body">
                      {mode ? <ModeChip mode={m.mode} name={t.modes[m.mode].name} /> : <span className="mode-chip">{m.mode}</span>}
                      <h2 className="card-title" title={title}>
                        <a href={href(editorPath(m.mode, m.id))}>{title}</a>
                      </h2>
                      <p className="card-meta">
                        {puzzleSummary(m.puzzle, t)} · {formatDate(m.updatedAt)}
                      </p>
                    </div>
                    <div className="card-actions">
                      <a className="btn small primary" href={href(editorPath(m.mode, m.id))} aria-label={g.openTitle(title)}>
                        {g.open}
                      </a>
                      <a className="btn small print-btn" href={href(`/print/${m.id}`)} aria-label={g.printTitle(title)}>
                        <IconPrinter size={16} />
                        <span className="btn-label">{g.print}</span>
                      </a>
                      <Menu label={g.moreActions(title)} trigger={<IconMore />}>
                        <MenuItem icon={<IconCopy size={16} />} onSelect={() => void duplicate(m)}>
                          {g.duplicate}
                        </MenuItem>
                        <MenuItem icon={<IconDownload size={16} />} onSelect={() => void exportOne(m)}>
                          {g.exportJson}
                        </MenuItem>
                        <MenuItem danger icon={<IconTrash size={16} />} onSelect={() => void remove(m)}>
                          {g.delete}
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
