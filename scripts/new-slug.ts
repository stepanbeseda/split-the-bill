// Usage: npm run new-slug -- "Osteria Mediterranea" 2026-10-06  → osteria-mediterranea-2026-10-06-k3f9x2
import { randomBytes } from 'node:crypto';

const [title = 'bill', date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const suffix = randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6).padEnd(6, '0');
console.log(`${base}-${date}-${suffix}`);
