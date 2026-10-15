import { Redis } from '@upstash/redis';
import type { Cells } from '../core/types';
import type { StateStore } from './store';

// The document lives in a hash: `json` = cells, `v` = version. The write is a single atomic script.
const COMPARE_AND_SET = `
local v = redis.call('HGET', KEYS[1], 'v')
if (v or '') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'json', ARGV[2], 'v', tostring((tonumber(v) or 0) + 1))
return 1`;

/**
 * Upstash Redis (the Vercel Marketplace Redis). Reads the env vars the Vercel integration sets:
 * `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` or the legacy `KV_REST_API_URL`/`KV_REST_API_TOKEN`.
 */
export function upstashStore(env: Record<string, string | undefined> = process.env, prefix = 'split-the-bill:'): StateStore {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Missing Upstash Redis credentials (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).');
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    async read(key) {
      const h = await redis.hgetall<{ json?: string; v?: string }>(prefix + key);
      return h?.json ? { cells: JSON.parse(h.json) as Cells, etag: String(h.v) } : { cells: {}, etag: null };
    },
    async write(key, cells, etag) {
      const ok = await redis.eval<[string, string], number>(COMPARE_AND_SET, [prefix + key], [etag ?? '', JSON.stringify(cells)]);
      return Number(ok) === 1;
    },
  };
}
