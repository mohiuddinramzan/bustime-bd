// Dependency-free tests: node scripts/test.js
// Covers search, aliases, filters, phone helpers, i18n formatting, admin validation rules, duplicates, delete safety.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { norm, buildIndex, buildAliasIndex, searchEntries, applyFilters, nextDepartures, listOptions } from '../app/src/main/assets/www/js/search.js';
import { validateRecord, validateDataset, validateBundle, findDuplicate, deleteBlockers, toBundle } from '../app/src/main/assets/www/js/validate.js';
import { phoneDigits, isValidPhone, formatPhone, toTel, clone } from '../app/src/main/assets/www/js/util.js';
import { setLang, formatTime, formatDuration, formatDate, dayLabel, t } from '../app/src/main/assets/www/js/i18n.js';
import { STRINGS } from '../app/src/main/assets/www/js/strings.js';
import { LocalDemoAuth, AuthError } from '../app/src/main/assets/www/js/auth.js';
import { FirebaseRepository, toFs, fromFs } from '../app/src/main/assets/www/js/firebase-adapter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'app/src/main/assets/www/data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const data = { buses: J('buses.json').items, routes: J('routes.json').items, schedules: J('schedules.json').items, counters: J('counters.json').items, config: J('app-config.json') };
const index = buildIndex(data);
const alias = buildAliasIndex(data.config.aliases);
const q = (s, f) => searchEntries(applyFilters(index, f), s, alias);
const routeIds = (list) => new Set(list.map((e) => e.r.id));

let pass = 0, failed = 0;
const pending = [];
const done = (name, err) => {
  if (err) { failed++; console.error('FAIL ' + name + '\n     ' + err.message); } else { pass++; console.log('ok   ' + name); }
};
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => done(name), (e) => done(name, e)));
    else done(name);
  } catch (e) { done(name, e); }
}

test('dataset is valid', () => assert.deepEqual(validateDataset(data).errors, []));
test('drafts/archived are hidden from users', () => {
  assert.ok(data.schedules.some((s) => s.status !== 'published'), 'demo has a draft schedule');
  assert.ok(index.length < data.schedules.length);
  assert.ok(index.every((e) => e.s.status === 'published' && e.b.status === 'published'));
});

test('normalization: Bengali digits, vowel/spelling variants', () => {
  assert.equal(norm('১০:৩০'), '10 30');
  assert.equal(norm('শ্রীবরদী'), norm('শ্রীবর্দী'));
  assert.equal(norm('  Dhaka-City! '), 'dhaka city');
});

test('search: Bengali, English and alias spellings find the same route', () => {
  for (const term of ['শ্রীবরদী', 'sreebardi', 'Shribordi', 'sribardi', 'শ্রীবর্দী']) {
    const r = routeIds(q(term));
    assert.ok(r.has('route-dhaka-sreebardi') && !r.has('route-dhaka-bakshiganj') && !r.has('route-dhaka-sherpur'), term);
  }
  for (const term of ['bakshiganj', 'বকশীগঞ্জ']) {
    const r = routeIds(q(term));
    assert.ok(r.has('route-dhaka-bakshiganj') && !r.has('route-dhaka-sreebardi') && !r.has('route-dhaka-sherpur'), term);
  }
});
test('search: fuzzy typo (distance 1) and multi-word', () => {
  assert.ok(q('sreebrdi').length > 0);
  assert.ok(q('dhaka sreebardi').length > 0);
});
test('search: bus name, operator, counter name, address', () => {
  assert.ok(q('Demo Express').every((e) => e.b.id === 'bus-demo-001') && q('Demo Express').length > 0);
  assert.ok(q('ডেমো পরিবহন এ').length > 0);
  assert.ok(q('counter sreebardi').length > 0);
  assert.ok(q('ডেমো ঠিকানা').length > 0);
});
test('search: phone number in several forms', () => {
  const c = data.counters.find((x) => x.status === 'published' && x.phones.length);
  const num = c.phones[0].number;
  assert.ok(q(num).length > 0);
  assert.ok(q('+88' + num).length > 0);
  assert.ok(q(num.slice(0, 6)).length > 0);
  const sup = data.buses.find((b) => b.status === 'published').supervisors[0].phone;
  assert.ok(q(sup).length > 0);
});
test('search: AC / non-AC words do not collide', () => {
  assert.ok(q('ac').every((e) => e.b.type === 'AC') && q('ac').length > 0);
  assert.ok(q('non-ac').every((e) => e.b.type === 'NON_AC') && q('non-ac').length > 0);
});
test('search: empty result and empty query', () => {
  assert.equal(q('zzzzqqqq').length, 0);
  assert.equal(q('').length, index.length);
});

test('filters: origin, destination, type, period, direction, time, operator', () => {
  assert.ok(q('', { origin: 'dhaka' }).every((e) => e.origin.id === 'dhaka'));
  assert.ok(q('', { destination: 'dhaka' }).every((e) => e.destination.id === 'dhaka' && e.s.direction === 'return'));
  assert.ok(q('', { destination: 'bakshiganj' }).every((e) => e.destination.id === 'bakshiganj'));
  assert.ok(q('', { type: 'AC' }).every((e) => e.b.type === 'AC'));
  assert.ok(q('', { period: 'night' }).every((e) => e.s.departureTime >= '18:00' || e.s.departureTime < '06:00'));
  assert.ok(q('', { period: 'day' }).every((e) => e.s.departureTime >= '06:00' && e.s.departureTime < '18:00'));
  assert.ok(q('', { direction: 'return' }).every((e) => e.s.direction === 'return'));
  assert.ok(q('', { after: '20:00' }).every((e) => e.s.departureTime >= '20:00'));
  const ops = listOptions(index).operators;
  assert.ok(ops.length >= 2);
  assert.ok(q('', { operator: ops[0].operator_en }).every((e) => e.b.operator_en === ops[0].operator_en));
  assert.ok(q('sreebardi', { type: 'AC', direction: 'outbound' }).every((e) => e.b.type === 'AC'));
});
test('results are sorted by departure time; nextDepartures honours day and time', () => {
  const times = index.map((e) => e.s.departureTime);
  assert.deepEqual(times, [...times].sort());
  const now = new Date(2026, 9, 22, 12, 0); // Thursday 12:00
  const n = nextDepartures(index, now, 50);
  assert.ok(n.every((e) => e.s.departureTime >= '12:00' && e.s.operatingDays.includes('thu')));
});
test('arrival times are never part of the data model', () => {
  assert.ok(data.schedules.every((s) => !('arrivalTime' in s)));
  assert.ok(data.routes.every((r) => r.durationIsEstimate === true));
});

test('phone helpers', () => {
  assert.equal(phoneDigits('+৮৮০১৭১২-৩৪৫৬৭৮'), '01712345678');
  assert.equal(formatPhone('8801712345678'), '01712-345678');
  assert.equal(toTel('01712345678'), '+8801712345678');
  assert.ok(isValidPhone('01000000101'));
  assert.ok(!isValidPhone('12345') && !isValidPhone('abc') && !isValidPhone(''));
});
test('i18n formatting (Bengali + English)', () => {
  setLang('bn');
  assert.equal(formatTime('22:30'), 'রাত ১০:৩০');
  assert.equal(formatTime('07:05'), 'সকাল ৭:০৫');
  assert.equal(formatDuration(330), 'প্রায় ৫ ঘণ্টা ৩০ মিনিট');
  assert.equal(formatDate('2026-10-21'), '২১ অক্টোবর ২০২৬');
  assert.equal(dayLabel(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']), t('days.daily'));
  setLang('en');
  assert.equal(formatTime('22:30'), '10:30 PM');
  assert.equal(formatTime('00:15'), '12:15 AM');
  assert.equal(formatDuration(330), 'about 5 h 30 min');
  setLang('bn');
});
test('i18n: bn and en have identical keys; every t() key used in code exists', () => {
  const bn = Object.keys(STRINGS.bn), en = Object.keys(STRINGS.en);
  assert.deepEqual(bn.filter((k) => !en.includes(k)), []);
  assert.deepEqual(en.filter((k) => !bn.includes(k)), []);
  const jsDir = path.join(root, 'app/src/main/assets/www/js');
  const used = new Set();
  for (const f of fs.readdirSync(jsDir).filter((x) => x !== 'strings.js')) {
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  }
  const dynamic = ['type.', 'dir.', 'day.', 'a.f.', 'a.ent.', 'a.status.', 'a.v.', 'e.', 'period.', 'phone.', 'src.', 'nav.', 'theme.'];
  const missing = [...used].filter((k) => !bn.includes(k) && !dynamic.some((d) => k.startsWith(d)));
  assert.deepEqual(missing, []);
});

/* ---- admin validation ---- */
const codes = (ent, r) => validateRecord(ent, r).map((e) => `${e.field}:${e.code}`);
test('admin validation: required fields, enums, ids', () => {
  const bus = clone(data.buses[0]);
  assert.deepEqual(codes('buses', bus), []);
  bus.name_bn = ''; bus.type = 'VIP'; bus.id = 'X';
  const c = codes('buses', bus);
  assert.ok(c.includes('name_bn:required') && c.includes('type:enum') && c.includes('id:id'));
});
test('admin validation: time, days, verified date, future date, bad phone', () => {
  const s = clone(data.schedules[0]);
  s.departureTime = '25:61'; s.operatingDays = ['mon', 'xyz'];
  assert.ok(codes('schedules', s).includes('departureTime:time') && codes('schedules', s).includes('operatingDays:days'));
  const b = clone(data.buses[0]);
  b.verification = { status: 'verified', lastVerified: null, source: 'x' };
  assert.ok(codes('buses', b).includes('verification.lastVerified:verified-date'));
  b.verification.lastVerified = '2999-01-01';
  assert.ok(codes('buses', b).includes('verification.lastVerified:future-date'));
  b.verification.lastVerified = '2026-02-30';
  assert.ok(codes('buses', b).includes('verification.lastVerified:date'));
  b.supervisors = [{ name_bn: 'ক', name_en: 'A', phone: '123' }];
  assert.ok(codes('buses', b).includes('supervisors:supervisor-line'));
});
test('admin validation: route stops and counter phones', () => {
  const r = clone(data.routes[0]);
  r.stops = [r.stops[0]];
  assert.ok(codes('routes', r).includes('stops:stops-min'));
  r.stops = [r.stops[0], { ...r.stops[0] }];
  assert.ok(codes('routes', r).includes('stops:dup-stop'));
  const c = clone(data.counters[0]);
  c.phones = [{ label: 'counter', number: 'abc' }];
  assert.ok(codes('counters', c).includes('phones:phone-line'));
});
test('duplicate detection (bus, route, schedule, counter)', () => {
  const b = { ...clone(data.buses[0]), id: 'bus-copy-001' };
  assert.equal(findDuplicate('buses', b, data).id, data.buses[0].id);
  const s = { ...clone(data.schedules[0]), id: 'sch-copy-001' };
  assert.equal(findDuplicate('schedules', s, data).id, data.schedules[0].id);
  const r = { ...clone(data.routes[0]), id: 'route-copy-001' };
  assert.equal(findDuplicate('routes', r, data).id, data.routes[0].id);
  const c = { ...clone(data.counters[0]), id: 'counter-copy-001' };
  assert.equal(findDuplicate('counters', c, data).id, data.counters[0].id);
  assert.equal(findDuplicate('buses', data.buses[0], data), null);
});
test('dataset validation catches broken references and duplicate ids', () => {
  const d = clone(data);
  d.schedules[0].busId = 'bus-missing-1';
  d.counters.push(clone(d.counters[0]));
  const c = validateDataset(d).errors.map((e) => e.code);
  assert.ok(c.includes('ref') && c.includes('dup-id'));
});
test('delete is blocked while records are referenced', () => {
  assert.ok(deleteBlockers('buses', data.schedules[0].busId, data).length > 0);
  assert.ok(deleteBlockers('routes', data.schedules[0].routeId, data).length > 0);
  assert.ok(deleteBlockers('counters', data.buses[0].counterIds[0], data).length > 0);
  assert.equal(deleteBlockers('schedules', data.schedules[0].id, data).length, 0);
});
test('export bundle round-trips through validateBundle; foreign JSON rejected', () => {
  assert.deepEqual(validateBundle(toBundle(data)).errors, []);
  assert.equal(validateBundle({ foo: 1 }).errors[0].code, 'bundle-format');
});

/* ---- authorization + Firebase stays inactive ---- */
test('local demo auth never grants publish; signed-out grants nothing', async () => {
  const a = new LocalDemoAuth();
  assert.equal(a.can('edit-local'), false);
  assert.throws(() => a.require('edit-local'), AuthError);
  await a.signIn();
  assert.ok(a.can('edit-local') && a.can('export') && a.can('import'));
  assert.equal(a.can('publish'), false);
  await a.signOut();
  assert.equal(a.can('export'), false);
});
test('Firebase publish is refused without an admin token', async () => {
  await assert.rejects(() => new FirebaseRepository().publish({}, null));
});
test('Firestore value encoding round-trips', () => {
  const o = { a: 'x', n: 3, f: 1.5, b: true, z: null, l: [1, 'b', { k: [] }], m: { p: 'বাংলা' } };
  assert.deepEqual(fromFs(toFs(o)), o);
});

test('bus wizard builds valid records in the existing schema', async () => {
  const { build, blank, stepErrors } = await import('../app/src/main/assets/www/js/bus-wizard-core.js');
  const fs = await import('node:fs');
  const ld = (f) => JSON.parse(fs.readFileSync(new URL('../app/src/main/assets/www/data/' + f + '.json', import.meta.url), 'utf8')).items;
  const data = { buses: ld('buses'), routes: ld('routes'), schedules: ld('schedules'), counters: ld('counters') };
  const s = { ...blank(), name: 'টেস্ট এক্সপ্রেস', operator: 'টেস্ট পরিবহন', routeMode: 'new', origin: 'dhaka', dest: 'sherpur', source: 'test', active: 'published',
    sch: [{ direction: 'outbound', time: '07:30', days: ['sat', 'sun'] }, { direction: 'return', time: '15:00', days: ['sat'] }],
    counters: [{ place: 'dhaka', name: 'ঢাকা কাউন্টার', address: 'গুলিস্তান', phone: '০১৭১২৩৪৫৬৭৮' }], sups: [{ name: 'রহিম', phone: '01712345678' }] };
  assert.deepEqual(stepErrors(1, s, data), []);
  assert.deepEqual(stepErrors(2, s, data), []);
  assert.deepEqual(stepErrors(3, s, data), []);
  assert.deepEqual(stepErrors(4, s, data), []);
  const r = build(s, data);
  assert.deepEqual(r.errors, []);
  assert.equal(r.isNewRoute, false, 'existing dhaka>sherpur route is reused');
  assert.equal(r.records.schedules.length, 2);
  assert.equal(r.records.counters[0].phones[0].number, '01712345678');
  const np = build({ ...s, newDest: 'নতুন স্থান', duration: '200' }, data);
  assert.equal(np.isNewRoute, true);
  assert.deepEqual(np.errors, []);
  assert.ok(stepErrors(3, { ...s, sch: [{ direction: 'outbound', time: '', days: [] }] }, data).includes('time'));
});

await Promise.all(pending);
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
