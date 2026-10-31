/**
 * Merge every connected area (4-neighbour, same value) smaller than `minSize`
 * cells into the neighbouring value it shares the most border with. With
 * `colors` (one OKLab triple per value) similar neighbours are preferred, so a
 * small dark-red island joins the red around it rather than a black outline.
 * Cells flagged in `locked` (removed background) never change.
 *
 * This is what paint-by-number generators do: islands of one or two cells are
 * tedious to colour and mostly noise from the photo.
 */
export function mergeSmallRegions(
  cells: number[],
  w: number,
  h: number,
  minSize: number,
  colors?: ArrayLike<number>[] | null,
  locked?: Uint8Array | null,
): number[] {
  if (minSize < 2) return cells;
  const cur = cells.slice();
  const n = w * h;
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  for (let pass = 0; pass < 8; pass++) {
    label.fill(-1);
    const comps: number[][] = [];
    for (let start = 0; start < n; start++) {
      if (label[start] >= 0) continue;
      const v = cur[start];
      const id = comps.length;
      const members: number[] = [];
      let top = 0;
      stack[top++] = start;
      label[start] = id;
      while (top) {
        const p = stack[--top];
        members.push(p);
        const x = p % w;
        if (x > 0 && label[p - 1] < 0 && cur[p - 1] === v) (label[p - 1] = id), (stack[top++] = p - 1);
        if (x < w - 1 && label[p + 1] < 0 && cur[p + 1] === v) (label[p + 1] = id), (stack[top++] = p + 1);
        if (p >= w && label[p - w] < 0 && cur[p - w] === v) (label[p - w] = id), (stack[top++] = p - w);
        if (p < n - w && label[p + w] < 0 && cur[p + w] === v) (label[p + w] = id), (stack[top++] = p + w);
      }
      comps.push(members);
    }
    const small = comps.filter((m) => m.length < minSize && !(locked && m.some((p) => locked[p]))).sort((a, b) => a.length - b.length);
    let changed = false;
    for (const members of small) {
      const v = cur[members[0]];
      // A smaller island merged earlier in this pass may already have taken these cells.
      if (members.some((p) => cur[p] !== v)) continue;
      const border = new Map<number, number>();
      for (const p of members) {
        const x = p % w;
        const around = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
        for (const q of around) {
          if (q < 0) continue;
          const u = cur[q];
          if (u !== v) border.set(u, (border.get(u) ?? 0) + 1);
        }
      }
      let best = -1;
      let bestScore = -Infinity;
      for (const [u, count] of border) {
        let score = count;
        if (colors) {
          const a = colors[v];
          const b = colors[u];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          score = count / (1 + 6 * d);
        }
        if (score > bestScore) {
          bestScore = score;
          best = u;
        }
      }
      if (best < 0) continue;
      for (const p of members) cur[p] = best;
      changed = true;
    }
    if (!changed) break;
  }
  return cur;
}

/**
 * Otsu's method: the cut between dark and light (0..1) that separates the two
 * groups best. `skip` marks values to ignore (removed background).
 */
export function otsuThreshold(values: ArrayLike<number>, skip?: Uint8Array | null): number {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (skip?.[i]) continue;
    hist[Math.max(0, Math.min(255, Math.round(values[i] * 255)))]++;
    total++;
  }
  if (!total) return 0.5;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  // Cells darker than the cut are ink, so the cut sits just above the dark group.
  return (bestT + 1) / 255;
}
