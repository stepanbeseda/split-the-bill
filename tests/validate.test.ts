import { describe, expect, it } from 'vitest';
import demo from '../bills/demo.json';
import { validateBill } from '../src/core/validate';

const clone = () => structuredClone(demo) as Record<string, any>;

describe('validateBill', () => {
  it('accepts the demo bill', () => {
    expect(validateBill(demo).errors).toEqual([]);
  });
  it('catches a misread price via the receipt total', () => {
    const b = clone();
    b.items[1].unitPrice = 12;
    expect(validateBill(b).errors.join()).toMatch(/add up to 241\.00 but receiptTotal is 259\.00/);
  });
  it('requires the payer to be one of the people', () => {
    const b = clone();
    b.payer = 'Nobody';
    expect(validateBill(b).errors.join()).toMatch(/payer/);
  });
  it('rejects bad IBANs and EPC in other currencies', () => {
    const b = clone();
    b.payment.iban = 'DE00370400440532013000';
    b.settlement = { currency: 'CZK', amount: 7000 };
    const errs = validateBill(b).errors.join();
    expect(errs).toMatch(/not a valid IBAN/);
    expect(errs).toMatch(/only work for EUR/);
  });
  it('warns about guessable slugs', () => {
    const b = clone();
    b.slug = 'dinner';
    expect(validateBill(b).warnings.join()).toMatch(/random suffix/);
  });
});
