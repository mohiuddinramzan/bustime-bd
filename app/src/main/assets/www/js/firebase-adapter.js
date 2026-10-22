// Firebase adapter using the Firestore + Identity Toolkit REST APIs (no SDK bundle needed, works under the strict CSP).
// Inactive until js/firebase-config.js holds a real apiKey. Security comes from Firestore Rules (admin custom claim).
import { DataRepository, isDatasetShape } from './repository.js';
import { AuthProvider, AuthError } from './auth.js';
import { ENTITIES } from './validate.js';
import { FIREBASE_CONFIG as C } from './firebase-config.js';

export class NotConfiguredError extends Error {
  constructor() { super('Firebase is not configured. Put your apiKey in js/firebase-config.js.'); }
}
export class ConflictError extends Error {
  constructor(server) { super('conflict'); this.server = server; }
}

export const isFirebaseConfigured = () => !!C.apiKey && !C.apiKey.startsWith('PASTE');
const need = () => { if (!isFirebaseConfigured()) throw new NotConfiguredError(); };
const DOCS = `https://firestore.googleapis.com/v1/projects/${C.projectId}/databases/(default)/documents`;
const NAME = (path) => `projects/${C.projectId}/databases/(default)/documents/${path}`;

export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
}
export function fromFs(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}
const docToObj = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, fromFs(x)]));

async function api(url, { method = 'GET', body, token } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method, signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(timer); }
}

const readCollection = async (ent, token, publishedOnly) => {
  const q = { from: [{ collectionId: ent }] };
  if (publishedOnly) q.where = { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } };
  const rows = await api(`${DOCS}:runQuery`, { method: 'POST', body: { structuredQuery: q }, token });
  return rows.filter((x) => x.document).map((x) => x.document);
};

const decodeClaims = (jwt) => {
  const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(p + '='.repeat((4 - (p.length % 4)) % 4)))));
};

export class FirebaseAuthAdapter extends AuthProvider {
  #token = null;
  claims = null;
  async signIn({ email, password }) {
    need();
    let res;
    try {
      res = await api(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${C.apiKey}`,
        { method: 'POST', body: { email, password, returnSecureToken: true } });
    } catch (e) { throw new AuthError(e.message); }
    const claims = decodeClaims(res.idToken);
    if (claims.admin !== true) throw new AuthError('not-admin');
    this.#token = res.idToken; this.claims = claims;
  }
  async signOut() { this.#token = null; this.claims = null; }
  session() { return this.claims ? { mode: 'firebase' } : null; }
  token() {
    if (!this.#token || this.claims.exp * 1000 < Date.now()) throw new AuthError('session-expired');
    return this.#token;
  }
  // UI hint only. Firestore Security Rules are what actually enforce this.
  can(a) { return !!this.claims?.admin && ['edit-local', 'export', 'import', 'publish'].includes(a); }
}

export class FirebaseRepository extends DataRepository {
  capabilities() { return { mode: 'firebase', canPublish: true, offlineCache: false }; }

  /** Anonymous users get status=='published' only; pass {token} (admin) to read everything. */
  async load({ token } = {}) {
    need();
    const data = {};
    for (const ent of ENTITIES) data[ent] = (await readCollection(ent, token, !token)).map(docToObj);
    try { data.config = docToObj(await api(`${DOCS}/config/app`, { token })); } catch (e) { if (e.status !== 404) throw e; data.config = {}; }
    if (!isDatasetShape(data)) throw new Error('invalid remote data');
    return { data, meta: { source: 'remote', hasLocal: false, loadedAt: new Date().toISOString() } };
  }

  /** Writes every record + config, and deletes remote records that no longer exist locally. Needs an admin token. */
  async publish(data, token) {
    need();
    if (!token) throw new AuthError('forbidden:publish');
    const writes = [];
    for (const ent of ENTITIES) {
      const ids = new Set(data[ent].map((r) => r.id));
      for (const d of await readCollection(ent, token, false)) {
        if (!ids.has(d.name.split('/').pop())) writes.push({ delete: d.name });
      }
      for (const r of data[ent]) writes.push({ update: { name: NAME(`${ent}/${r.id}`), fields: toFs(r).mapValue.fields } });
    }
    writes.push({ update: { name: NAME('config/app'), fields: toFs(data.config).mapValue.fields } });
    for (let i = 0; i < writes.length; i += 400) {
      await api(`${DOCS}:commit`, { method: 'POST', body: { writes: writes.slice(i, i + 400) }, token });
    }
    return writes.length;
  }
}
