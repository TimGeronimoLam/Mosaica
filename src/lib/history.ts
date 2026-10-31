/** Undo/redo stack. Changes with the same merge key in quick succession (one slider drag) form one step. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  mergeKey: string | null;
  mergeAt: number;
}

const LIMIT = 100;
const MERGE_MS = 1200;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], mergeKey: null, mergeAt: 0 };
}

export function pushHistory<T>(h: History<T>, next: T, mergeKey: string | null, now: number): History<T> {
  if (next === h.present) return h;
  if (mergeKey !== null && mergeKey === h.mergeKey && now - h.mergeAt < MERGE_MS) {
    return { ...h, present: next, future: [], mergeAt: now };
  }
  const past = h.past.length >= LIMIT ? h.past.slice(h.past.length - LIMIT + 1) : h.past.slice();
  past.push(h.present);
  return { past, present: next, future: [], mergeKey, mergeAt: now };
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], mergeKey: null, mergeAt: 0 };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), mergeKey: null, mergeAt: 0 };
}
