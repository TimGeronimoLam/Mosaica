import { useCallback, useEffect, useState } from 'react';
import { listMosaics } from './lib/db';
import { initHistory, pushHistory, redoHistory, undoHistory, type History } from './lib/history';
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

/** State with undo/redo. `set` takes an optional merge key so one slider drag is one undo step. */
export function useHistory<T>(initial: () => T) {
  const [h, setH] = useState(() => initHistory(initial()));
  const set = useCallback((update: (prev: T) => T, mergeKey: string | null = null) => {
    setH((prev) => pushHistory(prev, update(prev.present), mergeKey, Date.now()));
  }, []);
  const undo = useCallback(() => setH(undoHistory), []);
  const redo = useCallback(() => setH(redoHistory), []);
  const reset = useCallback((present: T) => setH(initHistory(present)), []);
  /** Put back a whole stack, e.g. one carried over from another instance of the same editor. */
  const restore = useCallback((state: History<T>) => setH(state), []);
  return { present: h.present, state: h, set, undo, redo, reset, restore, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
