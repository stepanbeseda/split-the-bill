import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bill } from '../src/core/types';
import { validateBill } from '../src/core/validate';

export const BILLS_DIR = 'bills';

/** Loads and validates every bill. Exits the process with a readable report on errors. */
export function loadBills(files = readdirSync(BILLS_DIR).filter((f) => f.endsWith('.json')).map((f) => join(BILLS_DIR, f))) {
  const bills: Bill[] = [];
  let failed = false;
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`✗ ${file}: invalid JSON – ${(e as Error).message}`);
      failed = true;
      continue;
    }
    const { errors, warnings } = validateBill(raw);
    const bill = raw as Bill;
    if (!file.endsWith(`${bill.slug}.json`)) errors.push(`file name must be ${bill.slug}.json`);
    for (const w of warnings) console.warn(`! ${file}: ${w}`);
    if (errors.length) {
      failed = true;
      for (const e of errors) console.error(`✗ ${file}: ${e}`);
    } else {
      console.log(`✓ ${file}: ${bill.items.length} items, ${bill.people.length} people, ${bill.receiptTotal.toFixed(2)} ${bill.currency}`);
      bills.push(bill);
    }
  }
  const slugs = bills.map((b) => b.slug);
  if (new Set(slugs).size !== slugs.length) {
    console.error('✗ duplicate slugs');
    failed = true;
  }
  if (failed) process.exit(1);
  return bills;
}
