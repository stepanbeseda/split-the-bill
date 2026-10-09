import { toMinor } from './money';
import { isValidIban } from './payments';
import type { Bill } from './types';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_QTY = 35;

/**
 * Deterministic checks for a bill transcribed from a receipt photo.
 * The most important one: items must add up to the receipt total to the cent.
 */
export function validateBill(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);
  if (!raw || typeof raw !== 'object') return { errors: ['Bill must be a JSON object.'], warnings };
  const b = raw as Bill;

  if (typeof b.slug !== 'string' || !SLUG.test(b.slug)) err('slug: use lowercase letters, digits and dashes.');
  else if (b.slug !== 'demo' && !/-[a-z0-9]{6,}$/.test(b.slug))
    warnings.push('slug: end it with a random suffix (npm run new-slug) so the link cannot be guessed.');
  if (typeof b.title !== 'string' || !b.title.trim()) err('title is required.');
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) err('date must be YYYY-MM-DD.');
  if (b.locale !== 'en' && b.locale !== 'cs') err('locale must be "en" or "cs".');
  if (typeof b.currency !== 'string' || !CURRENCY.test(b.currency)) err('currency must be an ISO code like "EUR".');

  if (!Array.isArray(b.people) || b.people.length < 2) err('people: at least two names.');
  else {
    if (b.people.length > 36) err('people: at most 36.');
    if (new Set(b.people.map((p) => p.trim().toLowerCase())).size !== b.people.length) err('people: names must be unique.');
    if (b.people.some((p) => typeof p !== 'string' || !p.trim())) err('people: empty name.');
    if (!b.people.includes(b.payer)) err(`payer "${b.payer}" is not in people.`);
  }

  let sum = 0;
  if (!Array.isArray(b.items) || !b.items.length) err('items: at least one item.');
  else {
    if (b.items.length > 36) err('items: at most 36.');
    b.items.forEach((it, i) => {
      const at = `items[${i}] (${it?.name ?? '?'})`;
      if (!it || typeof it.name !== 'string' || !it.name.trim()) err(`${at}: name is required.`);
      if (!Number.isInteger(it?.qty) || it.qty < 1 || it.qty > MAX_QTY) err(`${at}: qty must be a whole number 1–${MAX_QTY}.`);
      const price = toMinor(it?.unitPrice);
      if (!(price >= 0)) err(`${at}: unitPrice must be a non-negative amount with at most 2 decimals.`);
      else sum += price * it.qty;
    });
  }

  const receipt = toMinor(b.receiptTotal);
  const paid = toMinor(b.paidTotal);
  if (!(receipt > 0)) err('receiptTotal must be a positive amount with at most 2 decimals.');
  else if (!errors.some((e) => e.startsWith('items')) && sum !== receipt)
    err(`items add up to ${(sum / 100).toFixed(2)} but receiptTotal is ${(receipt / 100).toFixed(2)} (difference ${((receipt - sum) / 100).toFixed(2)}). Re-read the receipt.`);
  if (!(paid > 0)) err('paidTotal must be a positive amount with at most 2 decimals.');
  else if (receipt > 0 && paid < receipt) err('paidTotal is lower than receiptTotal.');
  else if (receipt > 0 && paid > receipt * 1.5) warnings.push('paidTotal is over 150 % of the receipt – is the tip right?');

  if (b.settlement) {
    if (!CURRENCY.test(b.settlement.currency ?? '')) err('settlement.currency must be an ISO code.');
    if (!(toMinor(b.settlement.amount) > 0)) err('settlement.amount must be positive with at most 2 decimals.');
  }

  const pay = b.payment;
  const payCurrency = b.settlement?.currency ?? b.currency;
  if (!pay || !['none', 'spayd', 'epc'].includes(pay.scheme)) err('payment.scheme must be "none", "spayd" or "epc".');
  else if (pay.scheme !== 'none') {
    if (!isValidIban(pay.iban ?? '')) err('payment.iban is not a valid IBAN (checksum failed).');
    if (pay.scheme === 'epc') {
      if (payCurrency !== 'EUR') err('payment: EPC QR codes only work for EUR.');
      if (!pay.beneficiary?.trim()) err('payment.beneficiary is required for EPC QR codes.');
    }
    if (pay.scheme === 'spayd' && !pay.iban?.startsWith('CZ') && !pay.iban?.startsWith('SK'))
      warnings.push('payment: SPAYD is read by Czech and Slovak banks; consider "epc" for other accounts.');
  }
  return { errors, warnings };
}
