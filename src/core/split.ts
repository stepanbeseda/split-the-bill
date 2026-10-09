import { roundShares, toMinor } from './money';
import type { Bill, BillShape, Cells } from './types';

/** A bill with amounts in minor units and the payer resolved to an index. */
export interface CompiledBill {
  bill: Bill;
  people: string[];
  payer: number;
  items: { name: string; note: string; qty: number; price: number; category: string }[];
  receipt: number;
  paid: number;
  /** Paid amount in settlement currency (minor units), if any. */
  settlement: { currency: string; amount: number } | null;
}

export function compileBill(bill: Bill): CompiledBill {
  return {
    bill,
    people: bill.people,
    payer: bill.people.indexOf(bill.payer),
    items: bill.items.map((it) => ({
      name: it.name,
      note: it.note ?? '',
      qty: it.qty,
      price: toMinor(it.unitPrice),
      category: it.category ?? '',
    })),
    receipt: toMinor(bill.receiptTotal),
    paid: toMinor(bill.paidTotal),
    settlement: bill.settlement ? { currency: bill.settlement.currency, amount: toMinor(bill.settlement.amount) } : null,
  };
}

export const shapeOf = (bill: Bill): BillShape => ({ people: bill.people.length, qty: bill.items.map((it) => it.qty) });

export interface Line {
  item: number;
  /** Own units; 0 for a share of the leftover. */
  q: number;
  /** For shares: leftover units and how many people split them. */
  rest?: number;
  k?: number;
  amount: number;
}

export interface ItemState {
  claims: [person: number, q: number][];
  sharers: number[];
  claimed: number;
  /** Units nobody took for themselves. */
  rest: number;
  /** Units claimed beyond the receipt quantity. */
  over: number;
  /** Price per sharer of the leftover. */
  per: number;
  /** Leftover units with no sharers. */
  unassigned: number;
}

export interface Split {
  /** Consumption per person before tip (minor units, fractional). */
  spent: number[];
  /** What each person owes in the bill currency, tip included (minor units). */
  owe: number[];
  /** Same in the settlement currency, if the bill has one. */
  oweSettled: number[] | null;
  lines: Line[][];
  items: ItemState[];
  unassigned: number;
  over: number;
}

/**
 * Units a person takes are theirs. Units nobody took are split evenly among everyone who
 * marked the item as shared. The tip is distributed in proportion to consumption.
 */
export function computeSplit(cb: CompiledBill, cells: Cells): Split {
  const n = cb.people.length;
  const spent = new Array<number>(n).fill(0);
  const lines: Line[][] = Array.from({ length: n }, () => []);
  const items = cb.items.map((it, i): ItemState => {
    const claims: [number, number][] = [];
    const sharers: number[] = [];
    let claimed = 0;
    for (let p = 0; p < n; p++) {
      const c = cells[`${p}.${i}`];
      if (!c) continue;
      if (c.q > 0) {
        claims.push([p, c.q]);
        claimed += c.q;
      }
      if (c.s) sharers.push(p);
    }
    const rest = Math.max(0, it.qty - claimed);
    const over = Math.max(0, claimed - it.qty);
    for (const [p, q] of claims) {
      spent[p] += q * it.price;
      lines[p].push({ item: i, q, amount: q * it.price });
    }
    const per = rest && sharers.length ? (rest * it.price) / sharers.length : 0;
    if (per) {
      for (const p of sharers) {
        spent[p] += per;
        lines[p].push({ item: i, q: 0, rest, k: sharers.length, amount: per });
      }
    }
    return { claims, sharers, claimed, rest, over, per, unassigned: sharers.length ? 0 : rest };
  });
  const owe = roundShares(spent.map((c) => (c * cb.paid) / cb.receipt));
  const oweSettled = cb.settlement ? roundShares(spent.map((c) => (c * cb.settlement!.amount) / cb.receipt)) : null;
  const unassigned = items.reduce((s, x, i) => s + x.unassigned * cb.items[i].price, 0);
  const over = items.reduce((s, x, i) => s + x.over * cb.items[i].price, 0);
  return { spent, owe, oweSettled, lines, items, unassigned, over };
}

/** Units of the item that are taken or covered by sharers. */
export const assignedUnits = (cb: CompiledBill, x: ItemState, i: number) =>
  Math.min(x.claimed, cb.items[i].qty) + (x.sharers.length ? x.rest : 0);
