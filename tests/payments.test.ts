import { describe, expect, it } from 'vitest';
import { czechAccountToIban, epcPayload, isValidIban, spaydPayload } from '../src/core/payments';

describe('IBAN', () => {
  it('validates checksums', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('DE89370400440532013001')).toBe(false);
  });
  it('converts Czech account numbers', () => {
    expect(czechAccountToIban('19-2000145399/0800')).toBe('CZ6508000000192000145399');
    expect(isValidIban(czechAccountToIban('2000145399/0800'))).toBe(true);
  });
  it('rejects malformed accounts', () => {
    expect(() => czechAccountToIban('hello')).toThrow();
  });
});

describe('QR payloads', () => {
  it('builds SPAYD without diacritics', () => {
    expect(spaydPayload({ iban: 'CZ6508000000192000145399', amount: 146625, currency: 'CZK', message: 'Jiří Č. večeře' })).toBe(
      'SPD*1.0*ACC:CZ6508000000192000145399*AM:1466.25*CC:CZK*MSG:Jiri C. vecere',
    );
  });
  it('builds an EPC SEPA payload', () => {
    const lines = epcPayload({ iban: 'DE89370400440532013000', amount: 4750, beneficiary: 'Alex Example', message: 'Sam dinner' }).split('\n');
    expect(lines).toEqual(['BCD', '002', '1', 'SCT', '', 'Alex Example', 'DE89370400440532013000', 'EUR47.50', '', '', 'Sam dinner']);
  });
});
