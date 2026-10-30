import type { MosaicRecord } from '../types';
import { newId } from './db';

export interface MosaicExport {
  app: 'mosaica';
  version: 1;
  exportedAt: number;
  mosaics: SerializedMosaic[];
}

export type SerializedMosaic = Omit<MosaicRecord, 'source'> & { source: string; sourceType: string };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

export async function exportMosaics(records: MosaicRecord[]): Promise<MosaicExport> {
  const mosaics: SerializedMosaic[] = [];
  for (const rec of records) {
    const { source, ...rest } = rec;
    mosaics.push({ ...rest, source: await blobToDataUrl(source), sourceType: source.type });
  }
  return { app: 'mosaica', version: 1, exportedAt: Date.now(), mosaics };
}

export async function importMosaics(json: unknown): Promise<MosaicRecord[]> {
  const data = json as Partial<MosaicExport>;
  if (!data || data.app !== 'mosaica' || !Array.isArray(data.mosaics)) {
    throw new Error('This file is not a Mosaica export.');
  }
  const out: MosaicRecord[] = [];
  for (const m of data.mosaics) {
    if (!m || typeof m !== 'object' || !m.grid || !m.puzzle || !m.settings || typeof m.source !== 'string') continue;
    const { source, sourceType: _type, ...rest } = m;
    const blob = await dataUrlToBlob(source);
    out.push({ ...rest, id: newId(), source: blob, updatedAt: Date.now() });
  }
  return out;
}

export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
