// Firebase adapter for a LATER phase. INACTIVE and UNTESTED until configureFirebase() is called
// with a real project's SDK. Nothing here ships credentials; see docs/FIREBASE_GUIDE.md.
import { DataRepository, isDatasetShape } from './repository.js';
import { AuthProvider, AuthError } from './auth.js';
import { ENTITIES } from './validate.js';

export class NotConfiguredError extends Error {
  constructor() { super('Firebase is not configured. See docs/FIREBASE_GUIDE.md.'); }
}
export class ConflictError extends Error {
  constructor(server) { super('conflict'); this.server = server; }
}

let ctx = null;
/**
 * @param {{db:object, auth:object, sdk:object}} c  sdk = the modular Firebase functions you bundle yourself:
 *   collection, doc, getDocs, query, where, runTransaction, writeBatch, signInWithEmailAndPassword, signOut
 */
export function configureFirebase(c) { ctx = c; }
export const isFirebaseConfigured = () => ctx !== null;
const need = () => { if (!ctx) throw new NotConfiguredError(); return ctx; };

export class FirebaseAuthAdapter extends AuthProvider {
  claims = null;
  async signIn({ email, password }) {
    const { sdk, auth } = need();
    const cred = await sdk.signInWithEmailAndPassword(auth, email, password);
    const tok = await cred.user.getIdTokenResult(true);
    if (tok.claims.admin !== true) { await sdk.signOut(auth); throw new AuthError('not-admin'); }
    this.claims = tok.claims;
  }
  async signOut() { if (ctx) await ctx.sdk.signOut(ctx.auth); this.claims = null; }
  session() { return this.claims ? { mode: 'firebase' } : null; }
  // UI hint only. Firestore Security Rules are what actually enforce this.
  can(a) { return !!this.claims?.admin && ['edit-local', 'export', 'import', 'publish'].includes(a); }
}

export class FirebaseRepository extends DataRepository {
  status = 'idle'; // idle | syncing | synced | offline | error
  listeners = new Set();
  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #set(s) { this.status = s; this.listeners.forEach((f) => f(s)); }

  capabilities() { return { mode: 'firebase', canPublish: true, offlineCache: true }; }

  /** Users read only status=='published'; admins may pass {admin:true} to read everything. */
  async load({ admin = false } = {}) {
    const { sdk, db } = need();
    this.#set('syncing');
    try {
      const data = {};
      for (const ent of ENTITIES) {
        const q = admin ? sdk.collection(db, ent) : sdk.query(sdk.collection(db, ent), sdk.where('status', '==', 'published'));
        data[ent] = (await sdk.getDocs(q)).docs.map((d) => d.data());
      }
      const cfgSnap = await sdk.getDocs(sdk.collection(db, 'config'));
      data.config = cfgSnap.docs[0]?.data() ?? {};
      if (!isDatasetShape(data)) throw new Error('invalid remote data');
      this.#set('synced');
      return { data, meta: { source: 'remote', hasLocal: false, loadedAt: new Date().toISOString() } };
    } catch (e) {
      this.#set(navigator.onLine ? 'error' : 'offline');
      throw e;
    }
  }

  async saveDraft(data) { return this.publish(data, { asDraft: true }); }

  /** Optimistic-concurrency write: each record carries `rev`; a stale rev raises ConflictError. */
  async saveRecord(ent, rec) {
    const { sdk, db } = need();
    return sdk.runTransaction(db, async (tx) => {
      const ref = sdk.doc(db, ent, rec.id);
      const snap = await tx.get(ref);
      const serverRev = snap.exists() ? snap.data().rev ?? 0 : 0;
      if (serverRev !== (rec.rev ?? 0)) throw new ConflictError(snap.data());
      tx.set(ref, { ...rec, rev: serverRev + 1 });
    });
  }

  /** JSON -> Firestore migration (batched; Firestore allows 500 writes per batch). */
  async publish(data) {
    const { sdk, db } = need();
    const writes = ENTITIES.flatMap((ent) => data[ent].map((r) => [sdk.doc(db, ent, r.id), { ...r, rev: (r.rev ?? 0) + 1 }]));
    for (let i = 0; i < writes.length; i += 450) {
      const batch = sdk.writeBatch(db);
      writes.slice(i, i + 450).forEach(([ref, val]) => batch.set(ref, val));
      await batch.commit();
    }
    this.#set('synced');
  }
}
