// DataRepository: the only thing the UI talks to for data.
// JsonRepository (bundled JSON + offline cache + local edits) is active in v1.
// FirebaseRepository (firebase-adapter.js) implements the same contract for a later phase.
import { store } from './store.js';

export const KEYS = { cache: 'bt_cache_v1', local: 'bt_local_edits_v1', useLocal: 'bt_use_local' };

/**
 * Dataset = { buses[], routes[], schedules[], counters[], config{} }
 * Meta    = { source: 'bundled'|'cache'|'local-edits'|'remote', hasLocal, localSavedAt, localBaseMismatch, loadedAt }
 */
export class DataRepository {
  /** @returns {Promise<{data:object, meta:object}>} */
  async load(_opts) { throw new Error('load() not implemented'); }
  /** Save an unpublished working copy (device-local in JSON mode, draft docs in Firebase). */
  async saveDraft(_data) { throw new Error('saveDraft() not implemented'); }
  /** Make data visible to every user. Needs a trusted backend; unsupported in JSON mode. */
  async publish(_data) { throw new Error('publish() not implemented'); }
  capabilities() { return { mode: 'none', canPublish: false, offlineCache: false }; }
}

const FILES = ['buses', 'routes', 'schedules', 'counters'];

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

export const isDatasetShape = (d) =>
  !!d && FILES.every((k) => Array.isArray(d[k])) && !!d.config && typeof d.config === 'object';

export class JsonRepository extends DataRepository {
  constructor(base = 'data/') {
    super();
    this.base = base;
  }

  capabilities() { return { mode: 'json-local', canPublish: false, offlineCache: true }; }

  async fetchBundled() {
    const [b, r, s, c, cfg] = await Promise.all([...FILES.map((f) => getJson(`${this.base}${f}.json`)), getJson(`${this.base}app-config.json`)]);
    return { buses: b.items, routes: r.items, schedules: s.items, counters: c.items, config: cfg };
  }

  /** preferLocal: use this device's local edits when present. */
  async load({ preferLocal = store.get(KEYS.useLocal, true) } = {}) {
    let data, source;
    try {
      data = await this.fetchBundled();
      source = 'bundled';
      store.set(KEYS.cache, { savedAt: new Date().toISOString(), data });
    } catch (err) {
      const cached = store.get(KEYS.cache);
      if (!isDatasetShape(cached?.data)) throw err;
      data = cached.data;
      source = 'cache';
    }
    const bundledVersion = data.config.dataVersion;
    const local = store.get(KEYS.local);
    const localOk = isDatasetShape(local?.data);
    const useLocal = preferLocal && localOk;
    if (useLocal) data = local.data;
    return {
      data,
      meta: {
        source: useLocal ? 'local-edits' : source,
        bundledSource: source,
        hasLocal: localOk,
        localSavedAt: localOk ? local.savedAt : null,
        localBaseMismatch: localOk && local.baseVersion !== bundledVersion,
        bundledVersion,
        loadedAt: new Date().toISOString(),
      },
    };
  }

  async saveDraft(data, baseVersion) {
    store.set(KEYS.local, { savedAt: new Date().toISOString(), baseVersion, data });
  }

  discardLocal() { store.del(KEYS.local); }

  async publish() {
    throw new Error('NOT_SUPPORTED: publishing for all users needs a trusted backend (see docs/FIREBASE_GUIDE.md).');
  }
}
