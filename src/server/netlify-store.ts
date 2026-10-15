import { getStore } from '@netlify/blobs';
import type { Cells } from '../core/types';
import type { StateStore } from './store';

/** Netlify Blobs with strong consistency; conditional writes use the blob ETag. */
export function netlifyStore(name = 'split-the-bill'): StateStore {
  const store = getStore({ name, consistency: 'strong' });
  return {
    async read(key) {
      const r = await store.getWithMetadata(key, { type: 'json' });
      return r ? { cells: (r.data ?? {}) as Cells, etag: r.etag ?? null } : { cells: {}, etag: null };
    },
    async write(key, cells, etag) {
      const res = etag
        ? await store.setJSON(key, cells, { onlyIfMatch: etag })
        : await store.setJSON(key, cells, { onlyIfNew: true });
      return res.modified;
    },
  };
}
