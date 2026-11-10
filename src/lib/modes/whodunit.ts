import type {
  Compass,
  WhodunitDifficulty,
  PixelGrid,
  WhodunitClue,
  WhodunitObject,
  WhodunitObjectKind,
  WhodunitPerson,
  WhodunitPuzzle,
  WhodunitRoomKind,
} from '../../types';
import { createRng, type Rng } from '../rng';

/*
 * Whodunit: a flat seen from above, split into rooms and furnished with a few
 * objects. Everyone stands on their own square, one person per row and per
 * column. Each person comes with statements about where they were; together
 * they pin down every position, and the culprit is whoever was alone in a
 * room with the victim.
 */

export const WHODUNIT_MIN = 5;
export const WHODUNIT_MAX = 8;

/** Names for people who have not been given one. Their first letters differ, so tokens can be told apart. */
export const DEFAULT_NAMES = ['Alex', 'Billie', 'Charlie', 'Dana', 'Eli', 'Frankie', 'Gio', 'Hana'];

/** Floor tint of each room, light enough to pencil on. */
export const ROOM_TINT: Record<WhodunitRoomKind, string> = {
  kitchen: '#fdf1d0',
  living: '#e3eefb',
  study: '#ebe6f8',
  bedroom: '#fbe6ea',
  hallway: '#efede6',
  balcony: '#e2f3df',
  bathroom: '#dcf2f2',
};

/** Objects nobody can stand on. The futon is the exception: you can sit on it. */
export function blocksCell(kind: WhodunitObjectKind): boolean {
  return kind !== 'futon';
}

export function defaultPeople(count: number): WhodunitPerson[] {
  return DEFAULT_NAMES.slice(0, count).map((name) => ({ name }));
}

/** A short, distinct label per person for the tokens: the initial, or as many letters as it takes to tell them apart. */
export function personLabels(people: WhodunitPerson[]): string[] {
  const names = people.map((p, i) => p.name.trim() || String(i + 1));
  const cut = (name: string, len: number) => name[0].toUpperCase() + name.slice(1, len).toLowerCase();
  return names.map((name, i) => {
    for (let len = 1; len <= 3; len++) {
      const label = cut(name, len);
      if (names.every((other, j) => j === i || cut(other, len) !== label)) return label;
    }
    return `${cut(name, 1)}${i + 1}`;
  });
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Split the square into rectangular rooms, each at least two cells wide. */
function makeRooms(n: number, rng: Rng): { rooms: number[]; kinds: WhodunitRoomKind[] } {
  const target = n <= 5 ? 4 : n === 6 ? 5 : n === 7 ? 6 : 7;
  let rects: Rect[] = [{ x: 0, y: 0, w: n, h: n }];
  while (rects.length < target) {
    const splittable = rects.filter((r) => r.w >= 4 || r.h >= 4).sort((a, b) => b.w * b.h - a.w * a.h);
    if (!splittable.length) break;
    // Mostly the largest room, sometimes the runner-up, so the plans vary.
    const r = splittable[splittable.length > 1 && rng.next() < 0.25 ? 1 : 0];
    const vertical = r.w >= 4 && (r.h < 4 || r.w > r.h || (r.w === r.h && rng.next() < 0.5));
    const len = vertical ? r.w : r.h;
    const cut = 2 + rng.int(len - 3);
    const a = vertical ? { ...r, w: cut } : { ...r, h: cut };
    const b = vertical ? { ...r, x: r.x + cut, w: r.w - cut } : { ...r, y: r.y + cut, h: r.h - cut };
    rects = rects.filter((x) => x !== r).concat(a, b);
  }
  // Number the rooms in reading order.
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  const rooms = new Array<number>(n * n).fill(0);
  rects.forEach((r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) rooms[y * n + x] = i;
  });
  // Big rooms become the living room and kitchen, small ones the hallway, bathroom or balcony.
  const bySize: WhodunitRoomKind[] = ['living', 'kitchen', 'bedroom', 'study', 'hallway', 'bathroom', 'balcony'];
  for (let i = 0; i < bySize.length - 1; i++) {
    if (rng.next() < 0.35) [bySize[i], bySize[i + 1]] = [bySize[i + 1], bySize[i]];
  }
  const order = rects.map((r, i) => ({ i, area: r.w * r.h + rng.next() * 0.5 })).sort((a, b) => b.area - a.area);
  const kinds = new Array<WhodunitRoomKind>(rects.length);
  order.forEach((o, rank) => {
    kinds[o.i] = bySize[rank];
  });
  return { rooms, kinds };
}

/** Where each object belongs, most fitting room first. */
const HOMES: Record<WhodunitObjectKind, WhodunitRoomKind[]> = {
  bread: ['kitchen'],
  futon: ['living', 'bedroom', 'study'],
  desk: ['study', 'bedroom', 'living'],
  crochet: ['living', 'bedroom', 'balcony'],
  bags: ['hallway', 'kitchen', 'balcony'],
  bong: ['balcony', 'living', 'bedroom'],
  ivy: ['balcony', 'bathroom', 'living', 'study', 'bedroom', 'hallway', 'kitchen'],
};

function furnish(n: number, rooms: number[], kinds: WhodunitRoomKind[], rng: Rng): WhodunitObject[] {
  const taken = new Array<boolean>(n * n).fill(false);
  const roomCells = kinds.map((_, r) => rooms.map((v, c) => (v === r ? c : -1)).filter((c) => c >= 0));
  const used = kinds.map(() => 0);
  const objects: WhodunitObject[] = [];

  /** Cells on the edge of their room: furniture stands against a wall. */
  const atWall = (c: number) => {
    const x = c % n;
    const y = Math.floor(c / n);
    return x === 0 || y === 0 || x === n - 1 || y === n - 1 || rooms[c - 1] !== rooms[c] || rooms[c + 1] !== rooms[c] || rooms[c - n] !== rooms[c] || rooms[c + n] !== rooms[c];
  };

  const place = (kind: WhodunitObjectKind, wide: boolean, skipRooms: number[] = []): number => {
    const preferred = HOMES[kind].map((k) => kinds.indexOf(k)).filter((r) => r >= 0);
    const others = rng.shuffle(kinds.map((_, r) => r).filter((r) => !preferred.includes(r)));
    for (const r of [...preferred, ...others]) {
      if (skipRooms.includes(r)) continue;
      const size = wide ? 2 : 1;
      // Keep more than half of every room free to stand in.
      if ((used[r] + size) * 2 >= roomCells[r].length) continue;
      const free = roomCells[r].filter((c) => !taken[c] && atWall(c));
      let cells: number[] | null = null;
      if (wide) {
        const pairs = free.filter((c) => c % n < n - 1 && rooms[c + 1] === r && !taken[c + 1] && atWall(c + 1)).map((c) => [c, c + 1]);
        if (pairs.length) cells = rng.pick(pairs);
      } else if (free.length) {
        cells = [rng.pick(free)];
      }
      if (!cells) continue;
      for (const c of cells) taken[c] = true;
      used[r] += cells.length;
      objects.push({ kind, cells });
      return r;
    }
    return -1;
  };

  if (place('futon', true) < 0) place('futon', false);
  if (n < 6 || place('desk', true) < 0) place('desk', false);
  place('bread', false);
  place('crochet', false);
  place('bags', false);
  place('bong', false);
  // Devil's ivy grows everywhere: a few pots, each in a different room.
  const ivyRooms: number[] = [];
  for (let i = 0; i < (n >= 7 ? 3 : 2); i++) {
    const r = place('ivy', false, ivyRooms);
    if (r >= 0) ivyRooms.push(r);
  }
  return objects;
}

/** One person per row and column, nobody on a blocked cell. Returns the column of each row, or null. */
function randomPlacement(n: number, blocked: boolean[], rng: Rng): number[] | null {
  const cols = new Array<number>(n).fill(-1);
  const usedCol = new Array<boolean>(n).fill(false);
  const fill = (row: number): boolean => {
    if (row === n) return true;
    const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    for (const c of order) {
      if (usedCol[c] || blocked[row * n + c]) continue;
      usedCol[c] = true;
      cols[row] = c;
      if (fill(row + 1)) return true;
      usedCol[c] = false;
    }
    return false;
  };
  return fill(0) ? cols : null;
}

/** The fixed part of a puzzle that clues are checked against. */
interface Board {
  n: number;
  rooms: number[];
  blocked: boolean[];
  /** Per cell: the kind of object on it, if any. */
  objectAt: (WhodunitObjectKind | null)[];
  /** Per cell: kinds of objects on a cell of the same room sharing an edge with it. A wall in between does not count. */
  beside: Set<WhodunitObjectKind>[];
}

function makeBoard(n: number, rooms: number[], objects: WhodunitObject[]): Board {
  const objectAt = new Array<WhodunitObjectKind | null>(n * n).fill(null);
  for (const o of objects) for (const c of o.cells) objectAt[c] = o.kind;
  const beside = objectAt.map((own, c) => {
    const set = new Set<WhodunitObjectKind>();
    const x = c % n;
    const y = Math.floor(c / n);
    const look = (d: number) => {
      const k = objectAt[c + d];
      // Sitting on the futon is not "beside" it, and nothing is beside you through a wall.
      if (k && k !== own && rooms[c + d] === rooms[c]) set.add(k);
    };
    if (x > 0) look(-1);
    if (x < n - 1) look(1);
    if (y > 0) look(-n);
    if (y < n - 1) look(n);
    return set;
  });
  return { n, rooms, blocked: objectAt.map((k) => k !== null && blocksCell(k)), objectAt, beside };
}

function dirHolds(n: number, a: number, b: number, dir: Compass): boolean {
  switch (dir) {
    case 'N':
      return Math.floor(a / n) < Math.floor(b / n);
    case 'S':
      return Math.floor(a / n) > Math.floor(b / n);
    case 'W':
      return a % n < b % n;
    case 'E':
      return a % n > b % n;
  }
}

const UNKNOWN = 99;

/**
 * How many ways everyone can be placed so that all clues hold, counted up to
 * `limit`. Returns a large number when the search runs out of budget, so an
 * unfinished check never passes for "exactly one".
 */
export function countPlacements(
  p: Pick<WhodunitPuzzle, 'width' | 'rooms' | 'objects' | 'people'>,
  clues: WhodunitClue[],
  limit = 2,
  budget = 12000,
): number {
  const n = p.width;
  const people = p.people.length;
  const board = makeBoard(n, p.rooms, p.objects);

  const unary: WhodunitClue[][] = Array.from({ length: people }, () => []);
  const pairs: WhodunitClue[][] = Array.from({ length: people }, () => []);
  const alone = new Array<boolean>(people).fill(false);
  for (const c of clues) {
    if (c.type === 'alone') alone[c.who] = true;
    else if (c.type === 'sameRoom' || c.type === 'apart' || c.type === 'dir') {
      pairs[c.who].push(c);
      pairs[c.other].push(c);
    } else unary[c.who].push(c);
  }

  const domains = unary.map((list) => {
    const cells: number[] = [];
    for (let c = 0; c < n * n; c++) {
      if (board.blocked[c]) continue;
      const ok = list.every((clue) =>
        clue.type === 'room' ? board.rooms[c] === clue.room : clue.type === 'notRoom' ? board.rooms[c] !== clue.room : clue.type === 'on' ? board.objectAt[c] === clue.object : clue.type === 'beside' ? board.beside[c].has(clue.object) : true,
      );
      if (ok) cells.push(c);
    }
    return cells;
  });
  const order = domains.map((_, i) => i).sort((a, b) => domains[a].length - domains[b].length);

  const at = new Array<number>(people).fill(-1);
  const rowUsed = new Array<boolean>(n).fill(false);
  const colUsed = new Array<boolean>(n).fill(false);
  const inRoom = new Array<number>(Math.max(...p.rooms) + 1).fill(0);
  /** Rooms that may not take anyone else: someone alone is in them, or the victim and one other. */
  const sealed = new Array<number>(inRoom.length).fill(0);
  let found = 0;
  let nodes = 0;

  const pairOk = (who: number, cell: number): boolean => {
    for (const c of pairs[who]) {
      if (c.type !== 'sameRoom' && c.type !== 'apart' && c.type !== 'dir') continue;
      const mate = c.who === who ? c.other : c.who;
      if (at[mate] < 0) continue;
      const a = c.who === who ? cell : at[mate];
      const b = c.who === who ? at[mate] : cell;
      const together = board.rooms[a] === board.rooms[b];
      if (c.type === 'sameRoom' ? !together : c.type === 'apart' ? together : !dirHolds(n, a, b, c.dir)) return false;
    }
    return true;
  };

  const search = (k: number): void => {
    if (k === people) {
      // The victim was with exactly one other person.
      if (inRoom[board.rooms[at[0]]] === 2) found++;
      return;
    }
    const who = order[k];
    for (const cell of domains[who]) {
      if (found >= limit || nodes > budget) return;
      const x = cell % n;
      const y = (cell - x) / n;
      if (rowUsed[y] || colUsed[x]) continue;
      const room = board.rooms[cell];
      if (sealed[room]) continue;
      if (alone[who] && inRoom[room] > 0) continue;
      if (who === 0 && inRoom[room] > 1) continue;
      if (!pairOk(who, cell)) continue;
      nodes++;
      // Once the victim has company, or someone must be alone, the room is closed to others.
      const victimHere = at[0] >= 0 && board.rooms[at[0]] === room;
      const seals = alone[who] || (who === 0 && inRoom[room] === 1) || victimHere;
      at[who] = cell;
      rowUsed[y] = colUsed[x] = true;
      inRoom[room]++;
      if (seals) sealed[room]++;
      search(k + 1);
      if (seals) sealed[room]--;
      inRoom[room]--;
      rowUsed[y] = colUsed[x] = false;
      at[who] = -1;
    }
  };
  search(0);
  return nodes > budget && found < limit ? UNKNOWN : found;
}

/** Every true statement worth making about the solution. Together they always pin it down. */
function candidateClues(board: Board, solution: number[], rng: Rng, denials: boolean): WhodunitClue[] {
  const { n, rooms } = board;
  const people = solution.length;
  const inRoom = new Map<number, number>();
  for (const c of solution) inRoom.set(rooms[c], (inRoom.get(rooms[c]) ?? 0) + 1);
  const out: WhodunitClue[] = [];
  for (let who = 0; who < people; who++) {
    const cell = solution[who];
    out.push({ type: 'room', who, room: rooms[cell] });
    if (denials) {
      // Weak statements for the hard cases: where someone was not.
      const elsewhere = rng.shuffle(Array.from({ length: Math.max(...rooms) + 1 }, (_, r) => r).filter((r) => r !== rooms[cell]));
      for (const room of elsewhere.slice(0, 2)) out.push({ type: 'notRoom', who, room });
    }
    const on = board.objectAt[cell];
    if (on) out.push({ type: 'on', who, object: on });
    for (const object of board.beside[cell]) out.push({ type: 'beside', who, object });
    if (who > 0 && inRoom.get(rooms[cell]) === 1) out.push({ type: 'alone', who });
    for (let other = who + 1; other < people; other++) {
      const [a, b] = rng.next() < 0.5 ? [who, other] : [other, who];
      // Sharing a room with the victim would name the culprit outright.
      if (who > 0 && rooms[solution[a]] === rooms[solution[b]]) out.push({ type: 'sameRoom', who: a, other: b });
      else if (who > 0 && denials && rng.next() < 0.5) out.push({ type: 'apart', who: a, other: b });
      // Rows and columns never repeat, so every pair has a north/south and an east/west order.
      out.push({ type: 'dir', who: a, other: b, dir: dirHolds(n, solution[a], solution[b], 'N') ? 'N' : 'S' });
      const [c, d] = rng.next() < 0.5 ? [who, other] : [other, who];
      out.push({ type: 'dir', who: c, other: d, dir: dirHolds(n, solution[c], solution[d], 'W') ? 'W' : 'E' });
    }
  }
  return out;
}

/**
 * Thin the statements down to a set that still has exactly one answer and
 * leaves everybody with at least one. The order in which statements are tried
 * for removal sets the flavour: what is tried first mostly disappears.
 */
function chooseClues(base: Pick<WhodunitPuzzle, 'width' | 'rooms' | 'objects' | 'people'>, pool: WhodunitClue[], difficulty: WhodunitDifficulty, rng: Rng): WhodunitClue[] {
  // Easy keeps the plain "was in the kitchen" statements; normal drops them first and leans on relations.
  // Hard also drops the other statements that settle a lot at once, and lets people say nothing at all.
  const ranks: Record<WhodunitDifficulty, Record<WhodunitClue['type'], number>> = {
    easy: { dir: 0, sameRoom: 1, room: 2, alone: 3, beside: 4, on: 5, notRoom: 6, apart: 6 },
    normal: { room: 0, dir: 1, sameRoom: 2, alone: 3, on: 4, beside: 5, notRoom: 6, apart: 6 },
    hard: { room: 0, alone: 1, on: 2, sameRoom: 3, dir: 4, beside: 5, notRoom: 6, apart: 6 },
  };
  const rank = ranks[difficulty];
  const least = difficulty === 'hard' ? 0 : 1;
  const order = rng.shuffle(pool.slice()).sort((a, b) => rank[a.type] - rank[b.type]);
  const kept = new Set(order);
  const perPerson = new Array<number>(base.people.length).fill(0);
  for (const c of order) perPerson[c.who]++;
  for (const c of order) {
    if (perPerson[c.who] <= least) continue;
    kept.delete(c);
    if (countPlacements(base, [...kept]) === 1) perPerson[c.who]--;
    else kept.add(c);
  }
  // Present them in a calm order: where someone was first, then who they were with.
  const show: Record<WhodunitClue['type'], number> = { room: 0, on: 1, beside: 2, alone: 3, notRoom: 4, sameRoom: 5, apart: 6, dir: 7 };
  return [...kept].sort((a, b) => a.who - b.who || show[a.type] - show[b.type]);
}

export interface WhodunitOptions {
  size: number;
  difficulty: WhodunitDifficulty;
  seed: number;
  /** Victim first, then the suspects. Missing people get default names. */
  people?: WhodunitPerson[];
}

export function generateWhodunit(opts: WhodunitOptions): WhodunitPuzzle {
  const n = Math.max(WHODUNIT_MIN, Math.min(WHODUNIT_MAX, Math.round(opts.size)));
  const people = withPeople(n, opts.people);
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = createRng(opts.seed + attempt * 7919);
    const { rooms, kinds } = makeRooms(n, rng);
    const objects = furnish(n, rooms, kinds, rng);
    const board = makeBoard(n, rooms, objects);
    const cols = randomPlacement(n, board.blocked, rng);
    if (!cols) continue;
    const cells = cols.map((c, row) => row * n + c);
    // The crime needs a room with exactly two people in it.
    const pairs = kinds.map((_, r) => cells.filter((c) => rooms[c] === r)).filter((list) => list.length === 2);
    if (!pairs.length) continue;
    const scene = rng.shuffle(rng.pick(pairs).slice());
    const rest = rng.shuffle(cells.filter((c) => !scene.includes(c)));
    const suspects = rng.shuffle(Array.from({ length: n - 1 }, (_, i) => i + 1));
    const murderer = suspects[0];
    const solution = new Array<number>(n);
    solution[0] = scene[0];
    solution[murderer] = scene[1];
    suspects.slice(1).forEach((who, i) => {
      solution[who] = rest[i];
    });
    const base = { width: n, rooms, objects, people };
    const clues = chooseClues(base, candidateClues(board, solution, rng, opts.difficulty === 'hard'), opts.difficulty, rng);
    return { kind: 'whodunit', width: n, height: n, rooms, roomKinds: kinds, objects, people, clues, solution, murderer };
  }
  throw new Error('Could not lay out a whodunit');
}

/** The first `n` people, padded with default names that are not taken yet. */
export function withPeople(n: number, people: WhodunitPerson[] = []): WhodunitPerson[] {
  const out = people.slice(0, n).map((p) => ({ ...p }));
  const spare = DEFAULT_NAMES.filter((name) => !out.some((p) => p.name === name));
  while (out.length < n) out.push({ name: spare.shift() ?? `#${out.length + 1}` });
  return out;
}

/** The floor plan as a small pixel grid, for the gallery thumbnail. */
export function whodunitGrid(p: WhodunitPuzzle): PixelGrid {
  const scale = 4;
  const w = p.width * scale;
  const tints = p.roomKinds.map((k) => ROOM_TINT[k]);
  const palette = [...tints, '#3b3b3b', '#8a6f4d', '#c9463d'];
  const [wall, thing, person] = [tints.length, tints.length + 1, tints.length + 2];
  const cells = new Array<number>(w * w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / scale);
      const cy = Math.floor(y / scale);
      const room = p.rooms[cy * p.width + cx];
      const edge =
        (x % scale === 0 && (cx === 0 || p.rooms[cy * p.width + cx - 1] !== room)) ||
        (y % scale === 0 && (cy === 0 || p.rooms[(cy - 1) * p.width + cx] !== room)) ||
        x === w - 1 ||
        y === w - 1;
      cells[y * w + x] = edge ? wall : room;
    }
  }
  const dot = (cell: number, v: number) => {
    const x = (cell % p.width) * scale;
    const y = Math.floor(cell / p.width) * scale;
    for (let dy = 1; dy <= 2; dy++) for (let dx = 1; dx <= 2; dx++) cells[(y + dy) * w + x + dx] = v;
  };
  for (const o of p.objects) for (const c of o.cells) dot(c, thing);
  dot(p.solution[0], person);
  return { width: w, height: w, cells, palette, blank: false, kind: 'palette' };
}
