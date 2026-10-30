import type { LabymagePuzzle, MazePortal, PixelGrid, Side } from '../../types';
import { createRng } from '../rng';

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export interface LabymageOptions {
  /** 0..100: how strongly decoy corridors prefer to keep winding. */
  twist: number;
  seed: number;
}

/**
 * Labymage: a maze whose only route from entrance to exit visits every cell of the picture,
 * so shading the route as you solve reveals the image.
 *
 * Construction: pick the largest inked region, build a random spanning tree over it,
 * then double the resolution. Walking around the tree gives a Hamiltonian cycle over
 * all doubled cells; cutting the cycle once gives the solution path. Decoy corridors
 * fill the empty area as a spanning tree, so the route stays unique.
 */
export function generateLabymage(grid: PixelGrid, opts: LabymageOptions): LabymagePuzzle {
  const { width: w, height: h, cells } = grid;
  const rng = createRng(opts.seed ^ 0x1ab7);
  const W2 = w * 2;
  const H2 = h * 2;

  // 1. Largest 4-connected inked component (fall back to a single cell).
  const comp = new Int32Array(w * h).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  let compCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (cells[i] !== 1 || comp[i] >= 0) continue;
    const id = compCount++;
    const stack = [i];
    comp[i] = id;
    let size = 0;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const x = c % w;
      const y = Math.floor(c / w);
      const nbs = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1];
      for (const nIdx of nbs) {
        if (nIdx >= 0 && cells[nIdx] === 1 && comp[nIdx] < 0) {
          comp[nIdx] = id;
          stack.push(nIdx);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestComp = id;
    }
  }
  const inComp = new Uint8Array(w * h);
  if (bestComp >= 0) {
    for (let i = 0; i < w * h; i++) if (comp[i] === bestComp) inComp[i] = 1;
  } else {
    inComp[0] = 1;
  }

  // 2. Random spanning tree over the component (iterative DFS).
  const visited = new Uint8Array(w * h);
  const treeEdges: [number, number][] = [];
  let root = -1;
  for (let i = 0; i < w * h; i++) {
    if (inComp[i]) {
      root = i;
      break;
    }
  }
  const stack = [root];
  visited[root] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % w;
    const y = Math.floor(c / w);
    const options = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1].filter(
      (j) => j >= 0 && inComp[j] && !visited[j],
    );
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const nxt = rng.pick(options);
    visited[nxt] = 1;
    treeEdges.push([c, nxt]);
    stack.push(nxt);
  }

  // 3. Doubled grid with the Hamiltonian cycle around the tree.
  const open = new Uint8Array(W2 * H2);
  const fine = (x: number, y: number) => y * W2 + x;
  const link = (a: number, b: number) => {
    const ax = a % W2;
    const ay = Math.floor(a / W2);
    const bx = b % W2;
    const by = Math.floor(b / W2);
    if (bx === ax + 1) {
      open[a] |= E;
      open[b] |= W;
    } else if (bx === ax - 1) {
      open[a] |= W;
      open[b] |= E;
    } else if (by === ay + 1) {
      open[a] |= S;
      open[b] |= N;
    } else if (by === ay - 1) {
      open[a] |= N;
      open[b] |= S;
    }
  };
  const unlink = (a: number, b: number) => {
    const ax = a % W2;
    const ay = Math.floor(a / W2);
    const bx = b % W2;
    const by = Math.floor(b / W2);
    if (bx === ax + 1) {
      open[a] &= ~E;
      open[b] &= ~W;
    } else if (bx === ax - 1) {
      open[a] &= ~W;
      open[b] &= ~E;
    } else if (by === ay + 1) {
      open[a] &= ~S;
      open[b] &= ~N;
    } else if (by === ay - 1) {
      open[a] &= ~N;
      open[b] &= ~S;
    }
  };
  const quad = (c: number) => {
    const x = (c % w) * 2;
    const y = Math.floor(c / w) * 2;
    return { tl: fine(x, y), tr: fine(x + 1, y), bl: fine(x, y + 1), br: fine(x + 1, y + 1) };
  };
  const inCompFine = new Uint8Array(W2 * H2);
  for (let c = 0; c < w * h; c++) {
    if (!inComp[c]) continue;
    const q = quad(c);
    inCompFine[q.tl] = inCompFine[q.tr] = inCompFine[q.bl] = inCompFine[q.br] = 1;
    link(q.tl, q.tr);
    link(q.tr, q.br);
    link(q.br, q.bl);
    link(q.bl, q.tl);
  }
  for (const [a0, b0] of treeEdges) {
    let a = a0;
    let b = b0;
    const ax = a % w;
    const ay = Math.floor(a / w);
    const bx = b % w;
    const by = Math.floor(b / w);
    if (bx < ax || by < ay) {
      [a, b] = [b, a];
    }
    const A = quad(a);
    const B = quad(b);
    if (Math.abs(bx - ax) === 1) {
      // B is right of A
      unlink(A.tr, A.br);
      unlink(B.tl, B.bl);
      link(A.tr, B.tl);
      link(A.br, B.bl);
    } else {
      // B is below A
      unlink(A.bl, A.br);
      unlink(B.tl, B.tr);
      link(A.bl, B.tl);
      link(A.br, B.tr);
    }
  }

  // 4. Walk the cycle to get its order.
  const nextOf = (c: number, prev: number): number => {
    const x = c % W2;
    const y = Math.floor(c / W2);
    const cand: number[] = [];
    if (open[c] & N) cand.push(fine(x, y - 1));
    if (open[c] & E) cand.push(fine(x + 1, y));
    if (open[c] & S) cand.push(fine(x, y + 1));
    if (open[c] & W) cand.push(fine(x - 1, y));
    return cand.find((j) => j !== prev) ?? cand[0];
  };
  const startFine = quad(root).tl;
  const order: number[] = [startFine];
  let prev = -1;
  let cur = startFine;
  for (let guard = 0; guard < W2 * H2 + 2; guard++) {
    const nxt = nextOf(cur, prev);
    if (nxt === startFine || nxt === undefined) break;
    order.push(nxt);
    prev = cur;
    cur = nxt;
  }
  const L = order.length;

  // 5. Distance from every free cell to the border (through free cells only).
  const isFree = (c: number) => !inCompFine[c];
  const onBorder = (c: number) => {
    const x = c % W2;
    const y = Math.floor(c / W2);
    return x === 0 || y === 0 || x === W2 - 1 || y === H2 - 1;
  };
  const fineNbs = (c: number): number[] => {
    const x = c % W2;
    const y = Math.floor(c / W2);
    const out: number[] = [];
    if (y > 0) out.push(c - W2);
    if (x < W2 - 1) out.push(c + 1);
    if (y < H2 - 1) out.push(c + W2);
    if (x > 0) out.push(c - 1);
    return out;
  };
  const distB = new Int32Array(W2 * H2).fill(-1);
  const bfs: number[] = [];
  for (let c = 0; c < W2 * H2; c++) {
    if (isFree(c) && onBorder(c)) {
      distB[c] = 0;
      bfs.push(c);
    }
  }
  for (let qi = 0; qi < bfs.length; qi++) {
    const c = bfs[qi];
    for (const j of fineNbs(c)) {
      if (isFree(j) && distB[j] < 0) {
        distB[j] = distB[c] + 1;
        bfs.push(j);
      }
    }
  }
  const exitCost = (c: number): number => {
    if (onBorder(c)) return 0;
    let best = Infinity;
    for (const j of fineNbs(c)) if (isFree(j) && distB[j] >= 0) best = Math.min(best, distB[j] + 1);
    return best;
  };

  // 6. Choose where to cut the cycle and dig corridors to the border.
  const candidates: { i: number; cost: number }[] = [];
  for (let i = 0; i < L; i++) {
    const cost = exitCost(order[i]) + exitCost(order[(i + 1) % L]);
    if (Number.isFinite(cost)) candidates.push({ i, cost });
  }
  let minCost = Infinity;
  for (const c of candidates) minCost = Math.min(minCost, c.cost);
  const shortlist = rng.shuffle(candidates.filter((c) => c.cost <= minCost + 6));

  const borderSide = (c: number): Side => {
    const x = c % W2;
    const y = Math.floor(c / W2);
    if (y === 0) return 'N';
    if (x === W2 - 1) return 'E';
    if (y === H2 - 1) return 'S';
    return 'W';
  };
  /**
   * Dig through free cells from `from` to the border. With `farFrom` set, prefer a border cell
   * far away from that cell (so entrance and exit end up on different parts of the frame).
   */
  const corridor = (from: number, blocked: Set<number>, farFrom: number | null): number[] | null => {
    if (farFrom === null && onBorder(from)) return [];
    const parent = new Map<number, number>();
    const dist = new Map<number, number>();
    const queue: number[] = [];
    const seed = (j: number, p: number, d: number) => {
      if (isFree(j) && !blocked.has(j) && !parent.has(j)) {
        parent.set(j, p);
        dist.set(j, d);
        queue.push(j);
      }
    };
    for (const j of fineNbs(from)) seed(j, from, 1);
    const manhattan = (a: number, b: number) => Math.abs((a % W2) - (b % W2)) + Math.abs(Math.floor(a / W2) - Math.floor(b / W2));
    let best = -1;
    let bestScore = -Infinity;
    if (farFrom !== null && onBorder(from)) {
      best = from;
      bestScore = manhattan(from, farFrom);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      const d = dist.get(c)!;
      if (onBorder(c)) {
        if (farFrom === null) {
          best = c;
          break;
        }
        const score = manhattan(c, farFrom) - 0.5 * d;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      for (const j of fineNbs(c)) seed(j, c, d + 1);
    }
    if (best < 0) return null;
    if (best === from) return [];
    const path: number[] = [];
    let k = best;
    while (k !== from) {
      path.push(k);
      k = parent.get(k)!;
    }
    return path.reverse();
  };

  let cutIndex = 0;
  let corrU: number[] = [];
  let corrV: number[] = [];
  let found = false;
  for (const cand of shortlist.slice(0, 60)) {
    const u = order[cand.i];
    const v = order[(cand.i + 1) % L];
    const cu = corridor(u, new Set(), null);
    if (!cu) continue;
    const entranceCell = cu.length ? cu[cu.length - 1] : u;
    const cv = corridor(v, new Set(cu), entranceCell);
    if (!cv) continue;
    cutIndex = cand.i;
    corrU = cu;
    corrV = cv;
    found = true;
    break;
  }

  const u = order[cutIndex];
  const v = order[(cutIndex + 1) % L];
  let entrance: MazePortal | null = null;
  let exit: MazePortal | null = null;
  if (L > 1) unlink(u, v);
  const inTree = inCompFine.slice();
  if (found) {
    let last = u;
    for (const c of corrU) {
      link(last, c);
      inTree[c] = 1;
      last = c;
    }
    entrance = { cell: last, side: borderSide(last) };
    last = v;
    for (const c of corrV) {
      link(last, c);
      inTree[c] = 1;
      last = c;
    }
    exit = { cell: last, side: borderSide(last) };
  }

  // 7. Grow decoy corridors over all remaining cells (keeps the maze a tree).
  const frontier: [number, number][] = [];
  for (let c = 0; c < W2 * H2; c++) {
    if (!inTree[c]) continue;
    for (const j of fineNbs(c)) if (!inTree[j]) frontier.push([c, j]);
  }
  const twist = Math.max(0, Math.min(1, opts.twist / 100));
  while (frontier.length) {
    const idx = rng.next() < twist ? frontier.length - 1 : rng.int(frontier.length);
    const [from, to] = frontier[idx];
    frontier[idx] = frontier[frontier.length - 1];
    frontier.pop();
    if (inTree[to]) continue;
    link(from, to);
    inTree[to] = 1;
    for (const j of fineNbs(to)) if (!inTree[j]) frontier.push([to, j]);
  }

  // 8. Solution route: entrance corridor, the long way round the cycle, exit corridor.
  const route: number[] = [];
  for (let k = corrU.length - 1; k >= 0; k--) route.push(corrU[k]);
  for (let k = 0; k < L; k++) route.push(order[(cutIndex - k + L) % L]);
  for (const c of corrV) route.push(c);

  return { kind: 'labymage', width: W2, height: H2, open: Array.from(open), path: route, entrance, exit };
}
