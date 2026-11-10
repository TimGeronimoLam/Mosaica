import { describe, expect, it } from 'vitest';
import { blocksCell, countPlacements, generateWhodunit, personLabels, withPeople } from '../lib/modes/whodunit';
import type { WhodunitPuzzle } from '../types';

function roomOf(p: WhodunitPuzzle, who: number): number {
  return p.rooms[p.solution[who]];
}

describe('whodunit', () => {
  const cases: WhodunitPuzzle[] = [];
  for (const size of [5, 6, 7, 8]) {
    for (let seed = 1; seed <= 12; seed++) {
      cases.push(generateWhodunit({ size, seed: seed * 977 + size, difficulty: (['easy', 'normal', 'hard'] as const)[seed % 3] }));
    }
  }

  it('puts one person in every row and column, off the furniture', () => {
    for (const p of cases) {
      const n = p.width;
      expect(p.people).toHaveLength(n);
      expect(new Set(p.solution.map((c) => c % n)).size).toBe(n);
      expect(new Set(p.solution.map((c) => Math.floor(c / n))).size).toBe(n);
      const blocked = new Set(p.objects.filter((o) => blocksCell(o.kind)).flatMap((o) => o.cells));
      for (const c of p.solution) expect(blocked.has(c)).toBe(false);
    }
  });

  it('leaves the culprit alone in a room with the victim', () => {
    for (const p of cases) {
      const together = p.people.map((_, i) => i).filter((i) => roomOf(p, i) === roomOf(p, 0));
      expect(together.sort()).toEqual([0, p.murderer].sort());
    }
  });

  it('has exactly one answer and a statement about everybody', () => {
    for (const p of cases) {
      expect(countPlacements(p, p.clues, 2, 5_000_000)).toBe(1);
    }
  });

  it('gets everybody to say something, except on hard', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      let silent = 0;
      let statements = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const p = generateWhodunit({ size: 7, seed: seed * 4409, difficulty });
        statements += p.clues.length;
        silent += p.people.filter((_, who) => !p.clues.some((c) => c.who === who)).length;
      }
      console.log(difficulty, 'statements per case', statements / 10, 'silent people per case', silent / 10);
      if (difficulty === 'hard') expect(silent).toBeGreaterThan(0);
      else expect(silent).toBe(0);
    }
  });

  it('furnishes the flat with all seven objects', () => {
    for (const p of cases) {
      expect(new Set(p.objects.map((o) => o.kind))).toEqual(new Set(['bread', 'crochet', 'bags', 'ivy', 'desk', 'futon', 'bong']));
    }
  });

  it('never calls someone beside an object through a wall', () => {
    let seen = 0;
    for (const p of cases) {
      const n = p.width;
      for (const c of p.clues) {
        if (c.type !== 'beside') continue;
        seen++;
        const cell = p.solution[c.who];
        const touching = p.objects
          .filter((o) => o.kind === c.object)
          .flatMap((o) => o.cells)
          .filter((oc) => Math.abs((oc % n) - (cell % n)) + Math.abs(Math.floor(oc / n) - Math.floor(cell / n)) === 1 && p.rooms[oc] === p.rooms[cell]);
        expect(touching.length).toBeGreaterThan(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('is reproducible from its seed', () => {
    const a = generateWhodunit({ size: 7, seed: 42, difficulty: 'normal' });
    const b = generateWhodunit({ size: 7, seed: 42, difficulty: 'normal' });
    expect(a).toEqual(b);
  });

  it('keeps the people it is given and labels them apart', () => {
    const people = withPeople(6, [{ name: 'Oma' }, { name: 'Anna' }, { name: 'Anton' }]);
    expect(people.map((p) => p.name)).toEqual(['Oma', 'Anna', 'Anton', 'Alex', 'Billie', 'Charlie']);
    expect(new Set(personLabels(people)).size).toBe(6);
  });
});
