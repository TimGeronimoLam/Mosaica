import { useCallback, useEffect, useState } from 'react';
import { listMosaics } from './lib/db';
import type { MosaicRecord } from './types';

export function useMosaics() {
  const [mosaics, setMosaics] = useState<MosaicRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setMosaics(await listMosaics());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { mosaics, loading, error, refresh };
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
