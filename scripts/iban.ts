// Usage: npm run iban -- 19-2000145399/0800   → prints the IBAN for a Czech account number
import { czechAccountToIban, formatIban, isValidIban } from '../src/core/payments';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run iban -- <czech account like 19-2000145399/0800 | IBAN to check>');
  process.exit(1);
}
if (/^[A-Z]{2}/i.test(arg)) {
  console.log(isValidIban(arg) ? `✓ valid IBAN ${formatIban(arg.toUpperCase())}` : '✗ invalid IBAN');
  process.exit(isValidIban(arg) ? 0 : 1);
}
const iban = czechAccountToIban(arg);
console.log(iban);
