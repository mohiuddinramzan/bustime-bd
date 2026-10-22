// Search + filter engine. Pure functions (no DOM) so it can be tested in Node.
import { fromBnDigits, phoneDigits, byId, DAYS } from './util.js';

/** Normalise Bengali/English text so spelling variants compare equal. */
export function norm(s) {
  return fromBnDigits(s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u200c\u200d\u09cd\u09bc]/g, '') // ZWNJ/ZWJ, hasanta, nukta
    .replace(/ী/g, 'ি')
    .replace(/ূ/g, 'ু')
    .replace(/ণ/g, 'ন')
    .replace(/[শষ]/g, 'স')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\bnon ?ac\b/g, 'nonac')
    .replace(/নন ?এসি/g, 'ননএসি')
    .trim();
}

export const tokens = (q) => {
  const n = norm(q);
  return n ? n.split(' ') : [];
};

function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** aliases: { group: [variant, ...] } -> Map(normalisedVariant -> Set(all normalised variants of the group)) */
export function buildAliasIndex(aliases = {}) {
  const map = new Map();
  for (const group of Object.values(aliases)) {
    const vs = group.map(norm).filter((v) => v && !v.includes(' '));
    for (const v of vs) {
      if (!map.has(v)) map.set(v, new Set());
      vs.forEach((x) => map.get(v).add(x));
    }
  }
  return map;
}

/** One entry per published schedule, joined with bus, route and counters. */
export function buildIndex(data, { publishedOnly = true } = {}) {
  const buses = byId(data.buses), routes = byId(data.routes), counters = byId(data.counters);
  const { dayStart = '06:00', nightStart = '18:00' } = data.config || {};
  const out = [];
  for (const s of data.schedules || []) {
    const b = buses.get(s.busId), r = routes.get(s.routeId);
    if (!b || !r) continue;
    if (publishedOnly && (s.status !== 'published' || b.status !== 'published' || r.status !== 'published')) continue;
    const stops = s.direction === 'return' ? [...r.stops].reverse() : r.stops;
    const stopIds = new Set(r.stops.map((x) => x.id));
    const okCounter = (c) => c && (!publishedOnly || c.status === 'published');
    const busCounters = (b.counterIds || []).map((id) => counters.get(id)).filter((c) => okCounter(c) && stopIds.has(c.placeId));
    const boarding = okCounter(counters.get(s.counterId)) ? counters.get(s.counterId) : null;
    const parts = [
      b.name_bn, b.name_en, b.operator_bn, b.operator_en,
      b.type === 'AC' ? 'ac এসি' : 'nonac ননএসি',
      r.name_bn, r.name_en, ...r.stops.flatMap((x) => [x.bn, x.en]),
    ];
    for (const c of busCounters) {
      parts.push(c.name_bn, c.name_en, c.address_bn, c.address_en, ...(c.phones || []).map((p) => phoneDigits(p.number)));
    }
    for (const sp of b.supervisors || []) parts.push(sp.name_bn, sp.name_en, phoneDigits(sp.phone));
    const hay = norm(parts.join(' '));
    const t = s.departureTime;
    out.push({
      id: s.id, s, b, r, c: boarding, busCounters, stops,
      origin: stops[0], destination: stops[stops.length - 1],
      period: t >= dayStart && t < nightStart ? 'day' : 'night',
      hay, words: new Set(hay.split(' ')),
    });
  }
  return out.sort((a, c) => a.s.departureTime.localeCompare(c.s.departureTime));
}

function tokenMatches(e, tok, aliasIdx) {
  const variants = aliasIdx.has(tok) ? [...aliasIdx.get(tok)] : [tok];
  for (const v of variants) {
    const short = v.length <= 2 || (/^\d+$/.test(v) && v.length < 3);
    if (short ? e.words.has(v) : e.hay.includes(v)) return true;
  }
  if (/^\d{3,}$/.test(tok) && e.hay.includes(tok.replace(/^88(?=01)/, ''))) return true; // +880 phone form
  if (tok.length >= 5 && !/\d/.test(tok)) {
    for (const w of e.words) if (Math.abs(w.length - tok.length) <= 1 && lev(w, tok) <= 1) return true;
  }
  return false;
}

export function searchEntries(entries, q, aliasIdx = new Map()) {
  const toks = tokens(q);
  if (!toks.length) return entries;
  return entries.filter((e) => toks.every((t) => tokenMatches(e, t, aliasIdx)));
}

/** f: {origin, destination, operator, type, period, direction, after, today} */
export function applyFilters(entries, f = {}) {
  return entries.filter(
    (e) =>
      (!f.origin || e.origin.id === f.origin) &&
      (!f.destination || e.destination.id === f.destination) &&
      (!f.operator || e.b.operator_en === f.operator) &&
      (!f.type || e.b.type === f.type) &&
      (!f.period || e.period === f.period) &&
      (!f.direction || e.s.direction === f.direction) &&
      (!f.after || e.s.departureTime >= f.after) &&
      (!f.today || e.s.operatingDays.includes(f.today)),
  );
}

/** Upcoming departures today (by device clock). */
export function nextDepartures(entries, now = new Date(), limit = 4) {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return applyFilters(entries, { after: hhmm, today: DAYS[now.getDay()] }).slice(0, limit);
}

/** Distinct filter choices from the indexed entries. */
export function listOptions(entries) {
  const origins = new Map(), destinations = new Map(), operators = new Map();
  for (const e of entries) {
    origins.set(e.origin.id, e.origin);
    destinations.set(e.destination.id, e.destination);
    operators.set(e.b.operator_en, e.b);
  }
  return { origins: [...origins.values()], destinations: [...destinations.values()], operators: [...operators.values()] };
}
