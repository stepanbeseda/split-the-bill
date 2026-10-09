/** A bill as written by the agent into `bills/<slug>.json`. Amounts are decimals in the bill currency. */
export interface Bill {
  slug: string;
  title: string;
  place?: string;
  /** ISO date of the meal, e.g. "2026-10-06". */
  date: string;
  locale: Locale;
  /** ISO 4217 currency of the receipt, e.g. "EUR". */
  currency: string;
  /** Receipt total before tip. Must equal the sum of all items. */
  receiptTotal: number;
  /** What the payer actually paid, tip included. */
  paidTotal: number;
  /** Optional: what the payment cost in the payer's home currency (from the bank statement). */
  settlement?: { currency: string; amount: number };
  /** Name of the person who paid. Must be one of `people`. */
  payer: string;
  /** How to write "send to <payer>" in languages with cases, e.g. Czech "Petrovi". Defaults to `payer`. */
  payerDative?: string;
  people: string[];
  payment: Payment;
  /** Show this bill on the landing page (only for the demo). */
  listed?: boolean;
  /**
   * Order matters: people and items are stored by index.
   * Append new entries at the end; never reorder or delete once the bill is live.
   */
  items: BillItem[];
}

export interface BillItem {
  name: string;
  note?: string;
  qty: number;
  unitPrice: number;
  category?: string;
}

export type Locale = 'en' | 'cs';

export type Payment =
  | { scheme: 'none' }
  /** Czech "QR Platba" (SPAYD). Any currency, typically CZK. */
  | { scheme: 'spayd'; iban: string; accountLabel?: string; beneficiary?: string }
  /** European EPC / SEPA credit transfer QR. EUR only. */
  | { scheme: 'epc'; iban: string; beneficiary: string; accountLabel?: string };

/** One person's claim on one item. */
export interface Cell {
  /** Units this person takes for themselves. */
  q: number;
  /** 1 = shares whatever units of the item nobody took. */
  s: 0 | 1;
  /** Server timestamp of the last change. */
  t: number;
}

/** Keyed by `${personIndex}.${itemIndex}`. */
export type Cells = Record<string, Cell>;

/** What the server needs to know about a bill to guard claims. */
export interface BillShape {
  people: number;
  qty: number[];
}
