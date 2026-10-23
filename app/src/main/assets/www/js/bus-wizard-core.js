// Pure logic for the 4-step "add bus" wizard: builds records in the EXISTING schema (buses/routes/schedules/counters).
// No DOM, no storage. Records are validated with the same validateRecord/findDuplicate as the generic admin forms.
import { DAY_ORDER, slugify, isValidPhone, fromBnDigits } from './util.js';
import { validateRecord, findDuplicate } from './validate.js';

export const blank = () => ({
  step: 1, name: '', operator: '', type: 'AC', active: 'published',
  routeMode: 'existing', routeId: '', origin: '', dest: '', newOrigin: '', newDest: '', via: [], direct: 'yes', duration: '',
  sch: [{ direction: 'outbound', time: '', days: [...DAY_ORDER] }],
  counters: [{ place: '', name: '', address: '', phone: '' }],
  sups: [{ name: '', phone: '' }],
  vstatus: 'unverified', vdate: '', source: '',
});

const hash = (s) => Array.from(String(s)).reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7).toString(36);
const phone = (v) => fromBnDigits(String(v || '')).replace(/[\s-]/g, '');

export function placeMap(data) {
  const m = new Map();
  for (const r of data.routes) for (const p of r.stops) if (!m.has(p.id)) m.set(p.id, p);
  return m;
}

function placeFrom(text, id, places) {
  const tx = String(text || '').trim();
  if (tx) {
    const hit = [...places.values()].find((p) => p.bn === tx || p.en.toLowerCase() === tx.toLowerCase());
    return hit || { id: 'p-' + (slugify(tx) || hash(tx)), bn: tx, en: tx };
  }
  return places.get(id) || null;
}

/** Returns { error } or { route, isNew, stops }. */
export function resolveRoute(s, data) {
  if (s.routeMode === 'existing') {
    const route = data.routes.find((r) => r.id === s.routeId);
    return route ? { route, isNew: false, stops: route.stops } : { error: 'route' };
  }
  const places = placeMap(data);
  const o = placeFrom(s.newOrigin, s.origin, places), d = placeFrom(s.newDest, s.dest, places);
  if (!o) return { error: 'origin' };
  if (!d) return { error: 'dest' };
  const mid = s.direct === 'yes' ? [] : s.via.map((id) => places.get(id)).filter(Boolean);
  const stops = [o, ...mid, d];
  if (new Set(stops.map((p) => p.id)).size !== stops.length) return { error: 'same' };
  const key = stops.map((p) => p.id).join('>');
  const same = data.routes.find((r) => r.stops.map((p) => p.id).join('>') === key);
  if (same) return { route: same, isNew: false, stops: same.stops };
  const dur = Number(s.duration);
  if (!Number.isInteger(dur) || dur < 10 || dur > 1440) return { error: 'duration' };
  let id = ('route-' + stops.map((p) => p.id).join('-')).slice(0, 60), n = 1;
  while (data.routes.some((r) => r.id === id)) id = id.slice(0, 56) + '-' + ++n;
  return { isNew: true, stops, route: { id, name_bn: stops.map((p) => p.bn).join(' – '), name_en: stops.map((p) => p.en).join(' – '), stops, approxDurationMin: dur, durationIsEstimate: true, status: 'published' } };
}

/** Light per-step checks (full validation happens in build()). Returns a list of error codes. */
export function stepErrors(step, s, data) {
  const e = [];
  if (step === 1) { if (!s.name.trim()) e.push('name'); if (!s.operator.trim()) e.push('operator'); }
  if (step === 2) { const r = resolveRoute(s, data); if (r.error) e.push(r.error); }
  if (step === 3) {
    const rows = s.sch.filter((x) => x.time || true);
    if (!rows.length) e.push('sch');
    const seen = new Set();
    for (const x of rows) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time)) e.push('time');
      else if (!x.days.length) e.push('days');
      else if (seen.has(x.direction + x.time)) e.push('dupTime');
      seen.add(x.direction + x.time);
    }
  }
  if (step === 4) {
    if (!s.source.trim()) e.push('source');
    for (const c of s.counters) if (c.phone.trim() && !isValidPhone(phone(c.phone))) e.push('phone');
    for (const x of s.sups) if (x.phone.trim() && !isValidPhone(phone(x.phone))) e.push('phone');
    for (const x of s.sups) if (x.phone.trim() && !x.name.trim()) e.push('supName');
    if (s.vstatus === 'verified' && !s.vdate) e.push('vdate');
  }
  return [...new Set(e)];
}

/** Builds every record to save. Returns { records, errors } where errors are strings like 'buses:name_bn:required'. */
export function build(s, data, now = new Date()) {
  const errors = [];
  const rr = resolveRoute(s, data);
  if (rr.error) return { records: null, errors: ['route:' + rr.error] };
  const ts = now.toISOString();
  const ver = { status: s.vstatus, lastVerified: s.vdate || null, source: s.source.trim() };
  const name = s.name.trim(), op = s.operator.trim();
  let busId = 'bus-' + (slugify(name) || hash(name)), n = 1;
  while (data.buses.some((b) => b.id === busId)) busId = busId.slice(0, 56) + '-' + ++n;
  const base = busId.slice(4);
  const counters = [];
  s.counters.filter((c) => c.name.trim() || c.phone.trim() || c.address.trim()).forEach((c, i) => {
    const place = rr.stops.find((p) => p.id === c.place) || rr.stops[0];
    const nm = c.name.trim() || place.bn;
    counters.push({ id: `counter-${base}-${i + 1}`.slice(0, 64), name_bn: nm, name_en: nm, placeId: place.id, address_bn: c.address.trim() || place.bn, address_en: c.address.trim() || place.en,
      phones: c.phone.trim() ? [{ label: 'counter', number: phone(c.phone), demo: false }] : [], status: s.active, verification: ver, updatedAt: ts });
  });
  const bus = { id: busId, name_bn: name, name_en: name, operator_bn: op, operator_en: op, type: s.type, counterIds: counters.map((c) => c.id),
    supervisors: s.sups.filter((x) => x.name.trim() || x.phone.trim()).map((x) => ({ name_bn: x.name.trim(), name_en: x.name.trim(), phone: phone(x.phone), demo: false })),
    status: s.active, verification: ver, updatedAt: ts };
  const route = rr.isNew ? { ...rr.route, verification: ver, updatedAt: ts } : null;
  const schedules = s.sch.map((x, i) => {
    const boardAt = x.direction === 'outbound' ? rr.stops[0].id : rr.stops[rr.stops.length - 1].id;
    const c = counters.find((k) => k.placeId === boardAt);
    const rec = { id: `sch-${base}-${i + 1}`.slice(0, 64), busId, routeId: rr.route.id, direction: x.direction, departureTime: x.time, operatingDays: DAY_ORDER.filter((d) => x.days.includes(d)),
      status: s.active, verification: ver, updatedAt: ts };
    if (c) rec.counterId = c.id;
    return rec;
  });
  const records = { buses: [bus], routes: route ? [route] : [], schedules, counters };
  const merged = { buses: [...data.buses], routes: [...data.routes], schedules: [...data.schedules], counters: [...data.counters] };
  for (const ent of Object.keys(records)) {
    for (const r of records[ent]) {
      for (const er of validateRecord(ent, r)) errors.push(`${ent}:${er.field}:${er.code}`);
      if (findDuplicate(ent, r, merged)) errors.push(`${ent}:${r.id}:duplicate`);
      merged[ent].push(r);
    }
  }
  return { records, errors, route: rr.route, isNewRoute: rr.isNew };
}
