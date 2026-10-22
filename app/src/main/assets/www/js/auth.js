// Admin authorization is kept separate from UI visibility.
// The UI asks provider.can(action); repository/publish paths call provider.require(action).
// Real, shared authorization is only possible server-side (Firebase Security Rules).
export class AuthError extends Error {}

export class AuthProvider {
  async signIn(_creds) { throw new Error('signIn() not implemented'); }
  async signOut() {}
  session() { return null; }
  can(_action) { return false; }
  require(action) {
    if (!this.can(action)) throw new AuthError('forbidden:' + action);
  }
}

/**
 * Local demo mode. This is NOT authentication and NOT secure: it only unlocks editing a copy of the data
 * on this device. It never grants 'publish'. Session lives in memory only (cleared on page reload).
 */
export class LocalDemoAuth extends AuthProvider {
  #s = null;
  async signIn() { this.#s = { mode: 'local-demo' }; }
  async signOut() { this.#s = null; }
  session() { return this.#s; }
  can(action) { return !!this.#s && ['edit-local', 'export', 'import'].includes(action); }
}
