// Usage: npm run validate [-- bills/<slug>.json ...]
import { loadBills } from './lib';

const files = process.argv.slice(2);
loadBills(files.length ? files : undefined);
