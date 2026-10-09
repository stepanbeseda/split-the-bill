// Local server: static files from dist/ plus the state API backed by memory.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import bills from '../src/generated/bills-index.json';
import { handleState } from '../src/server/handler';
import { MemoryStore } from '../src/server/store';

const port = Number(process.env.PORT ?? 8888);
const store = new MemoryStore();
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/api/state') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await handleState(
      new Request(url, { method: req.method, headers: req.headers as HeadersInit, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }),
      { store, bills, adminToken: process.env.ADMIN_TOKEN ?? 'dev' },
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
    return;
  }
  let file = join('dist', normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (url.pathname === '/' || url.pathname.startsWith('/b/') || !existsSync(file)) file = 'dist/index.html';
  if (url.pathname.startsWith('/bills/') && !existsSync(join('dist', url.pathname))) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Tabby dev server: http://localhost:${port}/b/demo  (admin token: ${process.env.ADMIN_TOKEN ?? 'dev'})`));
