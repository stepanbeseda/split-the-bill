/** ISO 13616 check: moves the country code to the end and verifies mod 97 == 1. */
export function isValidIban(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  return mod97(s.slice(4) + s.slice(0, 4)) === 1;
}

function mod97(alnum: string): number {
  let r = 0;
  for (const ch of alnum) {
    const v = parseInt(ch, 36).toString();
    for (const d of v) r = (r * 10 + +d) % 97;
  }
  return r;
}

/** Converts a Czech account number like "19-2000145399/0800" or "2000145399/0800" to an IBAN. */
export function czechAccountToIban(account: string): string {
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(account.replace(/\s+/g, ''));
  if (!m) throw new Error(`Not a Czech account number: ${account}`);
  const bban = m[3] + (m[1] ?? '').padStart(6, '0') + m[2].padStart(10, '0');
  const check = 98 - mod97(bban + 'CZ00');
  return 'CZ' + String(check).padStart(2, '0') + bban;
}

export const formatIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

/** Strips diacritics and characters that Czech banking apps do not handle in QR messages. */
export const asciiMessage = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\*/g, '').trim();

/** Czech "QR Platba" payload (SPAYD 1.0). */
export function spaydPayload(o: { iban: string; amount: number; currency: string; message: string; beneficiary?: string }) {
  const parts = ['SPD', '1.0', `ACC:${o.iban.replace(/\s+/g, '')}`, `AM:${(o.amount / 100).toFixed(2)}`, `CC:${o.currency}`];
  if (o.beneficiary) parts.push(`RN:${asciiMessage(o.beneficiary).slice(0, 35)}`);
  parts.push(`MSG:${asciiMessage(o.message).slice(0, 60)}`);
  return parts.join('*');
}

/** European Payments Council QR (SEPA credit transfer, version 002, UTF-8). EUR only. */
export function epcPayload(o: { iban: string; amount: number; beneficiary: string; message: string }) {
  return [
    'BCD', '002', '1', 'SCT',
    '', // BIC is optional within the EEA
    o.beneficiary.slice(0, 70),
    o.iban.replace(/\s+/g, ''),
    `EUR${(o.amount / 100).toFixed(2)}`,
    '', '',
    o.message.slice(0, 140),
  ].join('\n');
}
