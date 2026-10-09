import type { Cells } from '../core/types';

/**
 * Minimal storage the API needs: read a document with a version tag and write it
 * only if nobody changed it in the meantime (compare-and-set).
 */
export interface StateStore {
  read(key: string): Promise<{ cells: Cells; etag: string | null }>;
  /** `etag: null` means "only if the document does not exist yet". Returns false on conflict. */
  write(key: string, cells: Cells, etag: string | null): Promise<boolean>;
}

/** In-memory store for tests and local development. */
export class MemoryStore implements StateStore {
  private docs = new Map<string, { json: string; version: number }>();

  async read(key: string) {
    const d = this.docs.get(key);
    return d ? { cells: JSON.parse(d.json) as Cells, etag: String(d.version) } : { cells: {}, etag: null };
  }

  async write(key: string, cells: Cells, etag: string | null) {
    const d = this.docs.get(key);
    if ((d ? String(d.version) : null) !== etag) return false;
    this.docs.set(key, { json: JSON.stringify(cells), version: (d?.version ?? 0) + 1 });
    return true;
  }
}
