import { describe, expect, it } from 'vitest';
import { handleState } from '../src/server/handler';
import { MemoryStore } from '../src/server/store';

const bills = { demo: { people: 3, qty: [2, 1] } };
const url = 'http://x/api/state?bill=demo';
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('state API', () => {
  it('stores claims and returns them', async () => {
    const deps = { store: new MemoryStore(), bills, now: () => 1000 };
    const r = await handleState(post({ cells: { '0.0': { q: 1, s: 0 } } }), deps);
    expect((await r.json()).cells['0.0']).toEqual({ q: 1, s: 0, t: 1000 });
    const g = await handleState(new Request(url), deps);
    expect((await g.json()).cells['0.0'].q).toBe(1);
  });

  it('never hands out more units than the receipt has', async () => {
    const deps = { store: new MemoryStore(), bills };
    await handleState(post({ cells: { '0.0': { q: 2, s: 0 } } }), deps);
    const r = await (await handleState(post({ cells: { '1.0': { q: 1, s: 0 } } }), deps)).json();
    expect(r.rejected).toEqual(['1.0']);
    expect(r.cells['1.0'].q).toBe(0);
  });

  it('survives concurrent writers without losing updates', async () => {
    const deps = { store: new MemoryStore(), bills };
    await Promise.all([
      handleState(post({ cells: { '0.0': { q: 1, s: 0 } } }), deps),
      handleState(post({ cells: { '1.0': { q: 1, s: 0 } } }), deps),
      handleState(post({ cells: { '2.0': { q: 1, s: 0 } } }), deps),
    ]);
    const cells = (await (await handleState(new Request(url), deps)).json()).cells;
    const total = ['0.0', '1.0', '2.0'].reduce((s, k) => s + (cells[k]?.q ?? 0), 0);
    expect(total).toBe(2);
  });

  it('ignores unknown people and items', async () => {
    const deps = { store: new MemoryStore(), bills };
    const r = await (await handleState(post({ cells: { '9.0': { q: 1 }, '0.7': { q: 1 }, junk: 1 } }), deps)).json();
    expect(r.cells).toEqual({});
  });

  it('protects reset with the admin token', async () => {
    const store = new MemoryStore();
    await handleState(post({ cells: { '0.1': { q: 1, s: 0 } } }), { store, bills });
    expect((await handleState(post({ reset: true }), { store, bills })).status).toBe(403);
    expect((await handleState(post({ reset: true }, { authorization: 'Bearer nope' }), { store, bills, adminToken: 'secret' })).status).toBe(401);
    const ok = await handleState(post({ reset: true }, { authorization: 'Bearer secret' }), { store, bills, adminToken: 'secret' });
    expect((await ok.json()).cells['0.1'].q).toBe(0);
  });

  it('404s for unknown bills', async () => {
    expect((await handleState(new Request('http://x/api/state?bill=nope'), { store: new MemoryStore(), bills })).status).toBe(404);
    expect((await handleState(new Request('http://x/api/state?bill=toString'), { store: new MemoryStore(), bills })).status).toBe(404);
  });
});
