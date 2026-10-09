import type { BillShape, Cells } from '../core/types';
import type { StateStore } from './store';

export interface HandlerDeps {
  store: StateStore;
  bills: Record<string, BillShape>;
  /** Required for resetting a bill; when unset, reset is disabled. */
  adminToken?: string;
  /** Prefix that separates preview deployments from production data. */
  keyPrefix?: string;
  now?: () => number;
}

const MAX_Q = 35;
const MAX_ATTEMPTS = 10;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function sanitize(raw: unknown, shape: BillShape): Record<string, { q: number; s: 0 | 1 }> {
  const out: Record<string, { q: number; s: 0 | 1 }> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, c] of Object.entries(raw as Record<string, { q?: unknown; s?: unknown }>)) {
    const m = /^(\d+)\.(\d+)$/.exec(k);
    if (!m || +m[1] >= shape.people || +m[2] >= shape.qty.length || !c || typeof c !== 'object') continue;
    out[k] = { q: Math.max(0, Math.min(MAX_Q, Math.floor(Number(c.q)) || 0)), s: c.s ? 1 : 0 };
  }
  return out;
}

/**
 * Applies changes in place, stamps them with server time and caps added units at what is
 * still free on the receipt. Returns keys whose request had to be cut down.
 */
export function applyChanges(cells: Cells, incoming: Record<string, { q: number; s: 0 | 1 }>, shape: BillShape, now: number): string[] {
  const rejected: string[] = [];
  const claimed = shape.qty.map(() => 0);
  for (const [k, c] of Object.entries(cells)) claimed[+k.split('.')[1]] += c.q;
  for (const [k, c] of Object.entries(incoming)) {
    const i = +k.split('.')[1];
    const old = cells[k] ?? { q: 0, s: 0, t: 0 };
    let q = c.q;
    if (q > old.q) {
      const free = shape.qty[i] - (claimed[i] - old.q);
      if (q > free) {
        q = Math.max(old.q, free);
        rejected.push(k);
      }
    }
    claimed[i] += q - old.q;
    cells[k] = { q, s: c.s, t: Math.max(now, old.t + 1) };
  }
  return rejected;
}

/**
 * `GET  /api/state?bill=<slug>` → `{ cells }`
 * `POST /api/state?bill=<slug>` with `{ cells }` → `{ cells, rejected }`
 * `POST /api/state?bill=<slug>` with `{ reset: true }` and `Authorization: Bearer <ADMIN_TOKEN>`
 */
export async function handleState(req: Request, deps: HandlerDeps): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('bill') ?? '';
  const shape = Object.hasOwn(deps.bills, slug) ? deps.bills[slug] : undefined;
  if (!shape) return json({ error: 'Unknown bill' }, 404);
  const key = (deps.keyPrefix ?? '') + slug;
  const now = deps.now ?? Date.now;

  if (req.method === 'GET') return json({ cells: (await deps.store.read(key)).cells });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { cells?: unknown; reset?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (body.reset) {
    const auth = req.headers.get('authorization') ?? '';
    if (!deps.adminToken) return json({ error: 'Reset is disabled. Set ADMIN_TOKEN to enable it.' }, 403);
    if (auth !== `Bearer ${deps.adminToken}`) return json({ error: 'Wrong admin token' }, 401);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { cells, etag } = await deps.store.read(key);
    let rejected: string[] = [];
    if (body.reset) {
      for (const k of Object.keys(cells)) cells[k] = { q: 0, s: 0, t: Math.max(now(), cells[k].t + 1) };
    } else {
      rejected = applyChanges(cells, sanitize(body.cells, shape), shape, now());
    }
    if (await deps.store.write(key, cells, etag)) return json({ cells, rejected });
  }
  return json({ error: 'Too many people at once, try again' }, 409);
}
