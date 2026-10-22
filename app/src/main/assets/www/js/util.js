// Small pure helpers shared by the user app, admin panel and Node tests.
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // index = Date.getDay()
export const DAY_ORDER = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']; // Bangladesh week order

const BN = '০১২৩৪৫৬৭৮৯';
export const toBnDigits = (s) => String(s).replace(/\d/g, (d) => BN[+d]);
export const fromBnDigits = (s) => String(s ?? '').replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));

export function getPath(o, p) {
  return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}
export function setPath(o, p, v) {
  const ks = p.split('.');
  let c = o;
  for (const k of ks.slice(0, -1)) {
    if (typeof c[k] !== 'object' || c[k] === null) c[k] = {};
    c = c[k];
  }
  c[ks[ks.length - 1]] = v;
}

const p2 = (n) => String(n).padStart(2, '0');
export const localISODate = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const localHHMM = (d = new Date()) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

/** Digits only, Bangladesh national form: +8801712345678 -> 01712345678 */
export function phoneDigits(raw) {
  let d = fromBnDigits(raw).replace(/\D/g, '');
  if (d.startsWith('880')) d = '0' + d.slice(3);
  return d;
}
export const isValidPhone = (raw) => /^0\d{8,10}$/.test(phoneDigits(raw));
export function formatPhone(raw) {
  const d = phoneDigits(raw);
  return /^01\d{9}$/.test(d) ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
/** Dialable form for tel: links, e.g. +8801712345678 */
export function toTel(raw) {
  const d = phoneDigits(raw);
  return d.startsWith('0') ? '+88' + d : '+' + d;
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
