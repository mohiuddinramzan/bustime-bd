// localStorage wrapper that never throws (private mode / quota / Node tests).
const mem = new Map();
export const store = {
  get(k, def = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch {
      return mem.has(k) ? mem.get(k) : def;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      mem.set(k, v);
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    mem.delete(k);
  },
};
