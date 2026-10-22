// Data validation (JSON-schema equivalent). Used by admin forms, import, and scripts/validate.js.
import { DAYS, isValidPhone, byId } from './util.js';
import { norm } from './search.js';

export const ENTITIES = ['buses', 'routes', 'schedules', 'counters'];
export const BUNDLE_FORMAT = 'bustime-bd-dataset';

const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const PLACE_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DT_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;
const PHONE_LABELS = ['counter', 'booking', 'supervisor', 'other'];

export function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const text = (v, max = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const addDay = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

/** @returns {{field:string, code:string}[]} */
export function validateRecord(entity, r, today = new Date().toISOString().slice(0, 10)) {
  const e = [];
  const add = (field, code) => e.push({ field, code });
  if (!r || typeof r !== 'object') return [{ field: '', code: 'type' }];
  if (!ID_RE.test(r.id || '')) add('id', 'id');
  if (!['draft', 'published', 'archived'].includes(r.status)) add('status', 'enum');
  const v = r.verification || {};
  if (!['unverified', 'verified'].includes(v.status)) add('verification.status', 'enum');
  if (!text(v.source, 200)) add('verification.source', 'required');
  if (v.lastVerified != null && v.lastVerified !== '') {
    if (!validDate(v.lastVerified)) add('verification.lastVerified', 'date');
    else if (v.lastVerified > addDay(today)) add('verification.lastVerified', 'future-date');
  }
  if (v.status === 'verified' && !v.lastVerified) add('verification.lastVerified', 'verified-date');
  if (r.updatedAt != null && !DT_RE.test(r.updatedAt)) add('updatedAt', 'date');

  switch (entity) {
    case 'buses':
      for (const k of ['name_bn', 'name_en', 'operator_bn', 'operator_en']) if (!text(r[k], 80)) add(k, 'required');
      if (!['AC', 'NON_AC'].includes(r.type)) add('type', 'enum');
      if (!Array.isArray(r.counterIds) || r.counterIds.some((x) => !ID_RE.test(x))) add('counterIds', 'list');
      if (!Array.isArray(r.supervisors)) add('supervisors', 'list');
      else if (r.supervisors.some((s) => !text(s.name_bn, 80) || !text(s.name_en, 80) || !isValidPhone(s.phone))) add('supervisors', 'supervisor-line');
      break;
    case 'routes': {
      for (const k of ['name_bn', 'name_en']) if (!text(r[k], 80)) add(k, 'required');
      const st = r.stops;
      if (!Array.isArray(st) || st.length < 2) add('stops', 'stops-min');
      else {
        if (st.some((x) => !PLACE_RE.test(x.id || '') || !text(x.bn, 60) || !text(x.en, 60))) add('stops', 'stop-line');
        else if (new Set(st.map((x) => x.id)).size !== st.length) add('stops', 'dup-stop');
      }
      if (!Number.isInteger(r.approxDurationMin) || r.approxDurationMin < 10 || r.approxDurationMin > 1440) add('approxDurationMin', 'duration');
      if (typeof r.durationIsEstimate !== 'boolean') add('durationIsEstimate', 'enum');
      break;
    }
    case 'schedules':
      if (!ID_RE.test(r.busId || '')) add('busId', 'required');
      if (!ID_RE.test(r.routeId || '')) add('routeId', 'required');
      if (!['outbound', 'return'].includes(r.direction)) add('direction', 'enum');
      if (!TIME_RE.test(r.departureTime || '')) add('departureTime', 'time');
      if (!Array.isArray(r.operatingDays) || !r.operatingDays.length || r.operatingDays.some((d) => !DAYS.includes(d)) || new Set(r.operatingDays).size !== r.operatingDays.length) add('operatingDays', 'days');
      if (r.counterId && !ID_RE.test(r.counterId)) add('counterId', 'id');
      break;
    case 'counters':
      for (const k of ['name_bn', 'name_en']) if (!text(r[k], 80)) add(k, 'required');
      for (const k of ['address_bn', 'address_en']) if (!text(r[k], 200)) add(k, 'required');
      if (!PLACE_RE.test(r.placeId || '')) add('placeId', 'id');
      if (!Array.isArray(r.phones)) add('phones', 'list');
      else if (r.phones.some((p) => !PHONE_LABELS.includes(p.label) || !isValidPhone(p.number))) add('phones', 'phone-line');
      break;
    default:
      add('', 'type');
  }
  return e;
}

const dupKey = (ent, r) => {
  switch (ent) {
    case 'buses': return norm(r.name_en) + '|' + norm(r.operator_en);
    case 'routes': return (r.stops || []).map((s) => s.id).join('>');
    case 'schedules': return [r.busId, r.routeId, r.direction, r.departureTime].join('|');
    case 'counters': return r.placeId + '|' + norm(r.name_en);
    default: return '';
  }
};

/** First other record that looks like the same thing (different id, same key). */
export function findDuplicate(ent, r, data) {
  const k = dupKey(ent, r);
  return (data[ent] || []).find((x) => x.id !== r.id && dupKey(ent, x) === k) || null;
}

export function deleteBlockers(ent, id, data) {
  const out = [];
  if (ent === 'buses') (data.schedules || []).filter((s) => s.busId === id).forEach((s) => out.push({ entity: 'schedules', id: s.id }));
  if (ent === 'routes') (data.schedules || []).filter((s) => s.routeId === id).forEach((s) => out.push({ entity: 'schedules', id: s.id }));
  if (ent === 'counters') {
    (data.buses || []).filter((b) => (b.counterIds || []).includes(id)).forEach((b) => out.push({ entity: 'buses', id: b.id }));
    (data.schedules || []).filter((s) => s.counterId === id).forEach((s) => out.push({ entity: 'schedules', id: s.id }));
  }
  return out;
}

/** Whole-dataset validation: per-record rules, unique ids, duplicates, references. */
export function validateDataset(d, today) {
  const errors = [], warnings = [];
  const push = (arr, file, id, field, code) => arr.push({ file, id, field, code });
  if (!d || typeof d !== 'object') return { errors: [{ file: '', id: '', field: '', code: 'type' }], warnings };
  for (const ent of ENTITIES) {
    if (!Array.isArray(d[ent])) { push(errors, ent, '', '', 'missing-array'); continue; }
    const ids = new Set(), keys = new Map();
    for (const r of d[ent]) {
      validateRecord(ent, r, today).forEach((x) => push(errors, ent, r?.id, x.field, x.code));
      if (ids.has(r?.id)) push(errors, ent, r.id, 'id', 'dup-id');
      ids.add(r?.id);
      const k = dupKey(ent, r || {});
      if (keys.has(k)) push(errors, ent, r.id, '', 'duplicate');
      keys.set(k, r?.id);
    }
  }
  if (errors.some((x) => x.code === 'missing-array')) return { errors, warnings };
  const buses = byId(d.buses), routes = byId(d.routes), counters = byId(d.counters);
  const places = new Set(d.routes.flatMap((r) => (r.stops || []).map((s) => s.id)));
  for (const b of d.buses) for (const c of b.counterIds || []) if (!counters.has(c)) push(errors, 'buses', b.id, 'counterIds', 'ref');
  for (const s of d.schedules) {
    if (!buses.has(s.busId)) push(errors, 'schedules', s.id, 'busId', 'ref');
    if (!routes.has(s.routeId)) push(errors, 'schedules', s.id, 'routeId', 'ref');
    if (s.counterId && !counters.has(s.counterId)) push(errors, 'schedules', s.id, 'counterId', 'ref');
    if (s.status === 'published') {
      if (buses.get(s.busId) && buses.get(s.busId).status !== 'published') push(warnings, 'schedules', s.id, 'busId', 'ref-unpublished');
      if (routes.get(s.routeId) && routes.get(s.routeId).status !== 'published') push(warnings, 'schedules', s.id, 'routeId', 'ref-unpublished');
    }
    if (s.counterId && buses.get(s.busId) && !(buses.get(s.busId).counterIds || []).includes(s.counterId)) push(warnings, 'schedules', s.id, 'counterId', 'counter-not-owned');
  }
  for (const c of d.counters) if (!places.has(c.placeId)) push(warnings, 'counters', c.id, 'placeId', 'place-unknown');
  const cfg = d.config;
  if (cfg !== undefined) {
    if (!cfg || typeof cfg !== 'object') push(errors, 'config', '', '', 'type');
    else {
      if (!validDate(cfg.dataUpdated)) push(errors, 'config', '', 'dataUpdated', 'date');
      if (!TIME_RE.test(cfg.dayStart || '') || !TIME_RE.test(cfg.nightStart || '')) push(errors, 'config', '', 'dayStart', 'time');
      if (!cfg.appName?.bn || !cfg.appName?.en || !cfg.dataVersion) push(errors, 'config', '', 'appName', 'required');
    }
  }
  return { errors, warnings };
}

/** Import bundle check: format header + dataset rules. */
export function validateBundle(b, today) {
  if (!b || b.format !== BUNDLE_FORMAT || b.schemaVersion !== 1) {
    return { errors: [{ file: 'bundle', id: '', field: 'format', code: 'bundle-format' }], warnings: [] };
  }
  return validateDataset(b, today);
}

export function toBundle(data) {
  return { format: BUNDLE_FORMAT, schemaVersion: 1, exportedAt: new Date().toISOString(), buses: data.buses, routes: data.routes, schedules: data.schedules, counters: data.counters, config: data.config };
}
