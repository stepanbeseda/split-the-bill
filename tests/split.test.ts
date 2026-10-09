import { describe, expect, it } from 'vitest';
import demo from '../bills/demo.json';
import { roundShares } from '../src/core/money';
import { compileBill, computeSplit } from '../src/core/split';
import type { Bill, Cells } from '../src/core/types';

const bill = demo as Bill;
const cb = compileBill(bill);
const cell = (q: number, s: 0 | 1 = 0) => ({ q, s, t: 1 });

/** Everyone eats something, bread is shared by the whole table, waters by two people. */
function fullCells(): Cells {
  const c: Cells = {};
  const own: [number, number, number][] = [
    [0, 1, 1], [1, 1, 1], [2, 2, 1], [3, 2, 1], [4, 3, 1], [5, 3, 1],
    [0, 4, 2], [1, 4, 2], [2, 4, 2], [3, 4, 2], [4, 4, 2],
    [5, 7, 1], [0, 8, 1], [1, 9, 1], [2, 9, 1], [3, 9, 1],
  ];
  for (const [p, i, q] of own) c[`${p}.${i}`] = cell(q);
  for (let p = 0; p < 6; p++) c[`${p}.0`] = cell(0, 1);
  c['4.5'] = cell(0, 1); c['5.5'] = cell(0, 1);
  c['4.6'] = cell(0, 1); c['5.6'] = cell(0, 1);
  return c;
}

describe('roundShares', () => {
  it('keeps the rounded total', () => {
    const exact = [333.333, 333.333, 333.334];
    expect(roundShares(exact).reduce((a, b) => a + b, 0)).toBe(1000);
  });
  it('is never off by more than one unit', () => {
    const exact = [10.9, 20.1, 30.5, 0.4];
    roundShares(exact).forEach((r, i) => expect(Math.abs(r - exact[i])).toBeLessThan(1));
  });
});

describe('computeSplit', () => {
  it('adds up exactly to what was paid when everything is assigned', () => {
    const S = computeSplit(cb, fullCells());
    expect(S.unassigned).toBe(0);
    expect(S.over).toBe(0);
    expect(S.owe.reduce((a, b) => a + b, 0)).toBe(28490);
    expect(Math.round(S.spent.reduce((a, b) => a + b, 0))).toBe(25900);
  });

  it('splits leftover units among sharers only', () => {
    const S = computeSplit(cb, { '0.0': cell(0, 1), '1.0': cell(0, 1) });
    expect(S.spent[0]).toBe(300);
    expect(S.spent[1]).toBe(300);
    expect(S.items[0].unassigned).toBe(0);
  });

  it('gives sharers only what nobody took for themselves', () => {
    // 10 beers: Alex takes 4, the remaining 6 are shared by Sam and Kim
    const S = computeSplit(cb, { '0.4': cell(4), '1.4': cell(0, 1), '4.4': cell(0, 1) });
    expect(S.spent[0]).toBe(2400);
    expect(S.spent[1]).toBe(1800);
    expect(S.spent[4]).toBe(1800);
  });

  it('reports unassigned and over-claimed items', () => {
    const S = computeSplit(cb, { '0.1': cell(3) });
    expect(S.items[1].over).toBe(1);
    expect(S.over).toBe(2100);
    expect(S.unassigned).toBe(25900 - 4200);
  });

  it('converts to the settlement currency with an exact total', () => {
    const czk = compileBill({ ...bill, settlement: { currency: 'CZK', amount: 6980.94 } });
    const S = computeSplit(czk, fullCells());
    expect(S.oweSettled!.reduce((a, b) => a + b, 0)).toBe(698094);
  });
});
