import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { shapeOf } from '../src/core/split';
import { loadBills } from './lib';

const bills = loadBills();

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/bills', { recursive: true });
mkdirSync('src/generated', { recursive: true });

await build({
  entryPoints: ['src/web/app.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/app.js',
});
copyFileSync('src/web/index.html', 'dist/index.html');
copyFileSync('src/web/style.css', 'dist/style.css');

for (const b of bills) writeFileSync(`dist/bills/${b.slug}.json`, JSON.stringify(b));
writeFileSync('dist/bills/index.json', JSON.stringify(bills.filter((b) => b.listed).map((b) => ({ slug: b.slug, title: b.title }))));
// The API only needs the shape of each bill to guard claims.
writeFileSync('src/generated/bills-index.json', JSON.stringify(Object.fromEntries(bills.map((b) => [b.slug, shapeOf(b)])), null, 2));
writeFileSync('src/generated/listed.json', JSON.stringify(bills.filter((b) => b.listed).map((b) => b.slug)));

console.log(`Built ${bills.length} bill(s) into dist/.`);
