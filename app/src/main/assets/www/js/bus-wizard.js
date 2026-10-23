// 4-step "add bus" wizard UI (logic lives in bus-wizard-core.js). Saves into the existing JsonRepository draft via ctx.persist().
import { esc, DAY_ORDER } from './util.js';
import { t, getLang } from './i18n.js';
import { store } from './store.js';
import { blank, placeMap, resolveRoute, stepErrors, build } from './bus-wizard-core.js';

const L = {
  bn: { add: '+ নতুন বাস যোগ করুন', title: 'নতুন বাস যোগ করুন', s1: 'বাস', s2: 'রুট', s3: 'সময়', s4: 'যোগাযোগ', name: 'বাসের নাম', operator: 'পরিবহন কোম্পানি', type: 'ধরন', ac: 'এসি', nonac: 'নন-এসি', active: 'অবস্থা', pub: 'সক্রিয়', arch: 'আর্কাইভ',
    mode: 'রুট', existing: 'বিদ্যমান রুট', fresh: 'নতুন রুট', route: 'রুট বেছে নিন', origin: 'যাত্রা শুরুর স্থান', dest: 'গন্তব্য', newPlace: 'অথবা নতুন স্থানের নাম', direct: 'সরাসরি বাস?', yes: 'হ্যাঁ', no: 'না', via: 'মধ্যবর্তী স্টপেজ', dur: 'আনুমানিক সময়কাল (মিনিট)', durHint: 'আনুমানিক। প্রকৃত সময় বদলাতে পারে।',
    dir: 'যাত্রার দিক', time: 'ছাড়ার সময়', days: 'চলাচলের দিন', addSch: '+ আরও সময় যোগ করুন', del: 'মুছুন', place: 'স্থান', cname: 'কাউন্টারের নাম', addr: 'ঠিকানা', cphone: 'কাউন্টার ফোন', addC: '+ আরও কাউন্টার', sname: 'সুপারভাইজারের নাম', sphone: 'সুপারভাইজারের ফোন', addS: '+ আরও সুপারভাইজার',
    source: 'তথ্যের উৎস', vstatus: 'যাচাই', unv: 'অযাচাইকৃত', ver: 'যাচাইকৃত', vdate: 'যাচাইয়ের তারিখ', next: 'পরবর্তী', back: 'আগের ধাপ', review: 'পর্যালোচনা', save: 'সংরক্ষণ করুন', cancel: 'বাতিল', go: 'ঢাকা থেকে/দিক ১', 
    note: 'সংরক্ষণের আগে বর্তমান ডেটার ব্যাকআপ রাখা হবে। পরিবর্তন শুধু এই ডিভাইসে থাকবে; সবার কাছে পৌঁছাতে Firebase-এ প্রকাশ করতে হবে।', saved: 'বাস যোগ হয়েছে', nobackup: 'ব্যাকআপ রাখা যায়নি, তবুও সংরক্ষণ হয়েছে।',
    sBus: 'বাস', sRoute: 'রুট', sNew: '(নতুন)', sOld: '(বিদ্যমান)', sSch: 'সময়সূচি', sCnt: 'কাউন্টার', sSup: 'সুপারভাইজার', fix: 'সংরক্ষণের আগে এগুলো ঠিক করুন:', outW: 'যাওয়া', retW: 'ফেরা',
    'e.name': 'বাসের নাম দিন', 'e.operator': 'কোম্পানির নাম দিন', 'e.route': 'একটি রুট বেছে নিন', 'e.origin': 'যাত্রা শুরুর স্থান দিন', 'e.dest': 'গন্তব্য দিন', 'e.same': 'স্থানগুলো আলাদা হতে হবে', 'e.duration': 'সময়কাল ১০–১৪৪০ মিনিটের মধ্যে দিন',
    'e.time': 'সঠিক সময় দিন', 'e.days': 'অন্তত একটি দিন বেছে নিন', 'e.dupTime': 'একই দিক ও সময় দুইবার আছে', 'e.phone': 'ফোন নম্বর সঠিক নয়', 'e.supName': 'সুপারভাইজারের নাম দিন', 'e.source': 'তথ্যের উৎস লিখুন', 'e.vdate': 'যাচাইকৃত হলে তারিখ দিন' },
  en: { add: '+ Add new bus', title: 'Add new bus', s1: 'Bus', s2: 'Route', s3: 'Times', s4: 'Contact', name: 'Bus name', operator: 'Operator', type: 'Type', ac: 'AC', nonac: 'Non-AC', active: 'Status', pub: 'Active', arch: 'Archived',
    mode: 'Route', existing: 'Existing route', fresh: 'New route', route: 'Choose route', origin: 'Origin', dest: 'Destination', newPlace: 'Or type a new place name', direct: 'Direct bus?', yes: 'Yes', no: 'No', via: 'Intermediate stops', dur: 'Approx. duration (minutes)', durHint: 'Approximate. Real time may vary.',
    dir: 'Direction', time: 'Departure time', days: 'Operating days', addSch: '+ Add another time', del: 'Remove', place: 'Place', cname: 'Counter name', addr: 'Address', cphone: 'Counter phone', addC: '+ Add counter', sname: 'Supervisor name', sphone: 'Supervisor phone', addS: '+ Add supervisor',
    source: 'Information source', vstatus: 'Verification', unv: 'Unverified', ver: 'Verified', vdate: 'Verified on', next: 'Next', back: 'Previous', review: 'Review', save: 'Save', cancel: 'Cancel', go: '',
    note: 'A backup of the current data is kept before saving. Changes stay on this device until you publish to Firebase.', saved: 'Bus added', nobackup: 'Backup could not be kept, but the bus was saved.',
    sBus: 'Bus', sRoute: 'Route', sNew: '(new)', sOld: '(existing)', sSch: 'Schedules', sCnt: 'Counters', sSup: 'Supervisors', fix: 'Fix these before saving:', outW: 'Outbound', retW: 'Return',
    'e.name': 'Enter the bus name', 'e.operator': 'Enter the operator', 'e.route': 'Choose a route', 'e.origin': 'Enter the origin', 'e.dest': 'Enter the destination', 'e.same': 'Places must be different', 'e.duration': 'Duration must be 10–1440 minutes',
    'e.time': 'Enter a valid time', 'e.days': 'Pick at least one day', 'e.dupTime': 'Same direction and time twice', 'e.phone': 'Phone number is not valid', 'e.supName': 'Enter the supervisor name', 'e.source': 'Enter the information source', 'e.vdate': 'Enter the date when verified' },
};
const w = (k) => (L[getLang()] || L.bn)[k] ?? L.bn[k] ?? k;
export const wizardLabel = () => w('add');

let s = blank();
let errs = [];
export const wizardReset = () => { s = blank(); errs = []; };

const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), s);
function set(path, v) {
  const ks = path.split('.'); const last = ks.pop();
  ks.reduce((o, k) => o[k], s)[last] = v;
}
const opt = (v, lab, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(lab)}</option>`;
const field = (label, input, hint = '') => `<div class="field"><label class="f">${esc(label)}</label>${input}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
const inp = (k, type = 'text', extra = '') => `<input data-wz="${k}" type="${type}" value="${esc(get(k) ?? '')}" ${extra}>`;
const sel = (k, opts, rr = false) => `<select data-wz="${k}" ${rr ? 'data-rr="1"' : ''}>${opts.map(([v, l]) => opt(v, l, get(k))).join('')}</select>`;
const row = (...c) => `<div class="grid2">${c.join('')}</div>`;

function stepBody(data) {
  const places = [...placeMap(data).values()];
  const pOpts = [['', '—'], ...places.map((p) => [p.id, p.bn])];
  const rr = resolveRoute(s, data);
  const stops = rr.stops || [];
  if (s.step === 1) return field(w('name'), inp('name', 'text', 'dir="auto" autocomplete="off"')) + field(w('operator'), inp('operator', 'text', 'dir="auto"'))
    + row(field(w('type'), sel('type', [['AC', w('ac')], ['NON_AC', w('nonac')]])), field(w('active'), sel('active', [['published', w('pub')], ['archived', w('arch')]])));
  if (s.step === 2) {
    const head = field(w('mode'), sel('routeMode', [['existing', w('existing')], ['new', w('fresh')]], true));
    if (s.routeMode === 'existing') return head + field(w('route'), sel('routeId', [['', '—'], ...data.routes.filter((r) => r.status !== 'archived').map((r) => [r.id, r.name_bn])]));
    return head + row(field(w('origin'), sel('origin', pOpts)), field(w('dest'), sel('dest', pOpts)))
      + row(field(w('newPlace') + ' · ' + w('origin'), inp('newOrigin', 'text', 'dir="auto"')), field(w('newPlace') + ' · ' + w('dest'), inp('newDest', 'text', 'dir="auto"')))
      + field(w('direct'), sel('direct', [['yes', w('yes')], ['no', w('no')]], true))
      + (s.direct === 'no' ? field(w('via'), `<div class="checks">${places.map((p) => `<label><input type="checkbox" data-wz="via" data-val="${esc(p.id)}" ${s.via.includes(p.id) ? 'checked' : ''}> ${esc(p.bn)}</label>`).join('')}</div>`) : '')
      + field(w('dur'), inp('duration', 'number', 'inputmode="numeric" min="10"'), w('durHint'));
  }
  if (s.step === 3) {
    const a = stops[0]?.bn, b = stops[stops.length - 1]?.bn;
    const dl = [['outbound', a && b ? `${a} → ${b}` : w('outW')], ['return', a && b ? `${b} → ${a}` : w('retW')]];
    return s.sch.map((x, i) => `<div class="rowcard">${row(field(w('dir'), sel(`sch.${i}.direction`, dl)), field(w('time'), inp(`sch.${i}.time`, 'time')))}
      ${field(w('days'), `<div class="checks">${DAY_ORDER.map((d) => `<label><input type="checkbox" data-wz="sch.${i}.days" data-val="${d}" ${x.days.includes(d) ? 'checked' : ''}> ${esc(t('day.' + d))}</label>`).join('')}</div>`)}
      ${s.sch.length > 1 ? `<button type="button" class="btn ghost sm" data-wzact="del-sch" data-i="${i}">${w('del')}</button>` : ''}</div>`).join('')
      + `<button type="button" class="btn ghost block" data-wzact="add-sch">${w('addSch')}</button>`;
  }
  if (s.step === 4) {
    const cOpts = stops.map((p) => [p.id, p.bn]);
    return s.counters.map((c, i) => `<div class="rowcard">${cOpts.length ? field(w('place'), sel(`counters.${i}.place`, cOpts)) : ''}
      ${field(w('cname'), inp(`counters.${i}.name`, 'text', 'dir="auto"'))}${field(w('addr'), inp(`counters.${i}.address`, 'text', 'dir="auto"'))}${field(w('cphone'), inp(`counters.${i}.phone`, 'tel', 'inputmode="tel"'))}
      ${s.counters.length > 1 ? `<button type="button" class="btn ghost sm" data-wzact="del-counter" data-i="${i}">${w('del')}</button>` : ''}</div>`).join('')
      + `<button type="button" class="btn ghost block" data-wzact="add-counter">${w('addC')}</button>`
      + s.sups.map((x, i) => `<div class="rowcard">${row(field(w('sname'), inp(`sups.${i}.name`, 'text', 'dir="auto"')), field(w('sphone'), inp(`sups.${i}.phone`, 'tel', 'inputmode="tel"')))}
      ${s.sups.length > 1 ? `<button type="button" class="btn ghost sm" data-wzact="del-sup" data-i="${i}">${w('del')}</button>` : ''}</div>`).join('')
      + `<button type="button" class="btn ghost block" data-wzact="add-sup">${w('addS')}</button>`
      + field(w('source'), inp('source', 'text', 'dir="auto"')) + row(field(w('vstatus'), sel('vstatus', [['unverified', w('unv')], ['verified', w('ver')]])), field(w('vdate'), inp('vdate', 'date')));
  }
  const b = build(s, data);
  if (!b.records) return `<div class="notice err">${esc(w('e.' + b.errors[0].split(':')[1]))}</div>`;
  const r = b.records;
  const li = (k, v) => `<div class="list-item"><span class="grow muted">${esc(k)}</span><b>${esc(v)}</b></div>`;
  return `<div class="card stack">${li(w('sBus'), `${r.buses[0].name_bn} · ${r.buses[0].operator_bn} · ${r.buses[0].type === 'AC' ? w('ac') : w('nonac')}`)}
    ${li(w('sRoute'), `${b.route.name_bn} ${b.isNewRoute ? w('sNew') : w('sOld')}`)}
    ${r.schedules.map((x) => li(x.direction === 'outbound' ? w('outW') : w('retW'), `${x.departureTime} · ${x.operatingDays.map((d) => t('day.' + d)).join(', ')}`)).join('')}
    ${r.counters.map((c) => li(w('sCnt'), `${c.name_bn}${c.phones[0] ? ' · ' + c.phones[0].number : ''}`)).join('')}
    ${r.buses[0].supervisors.map((x) => li(w('sSup'), `${x.name_bn} · ${x.phone}`)).join('')}</div>
    ${b.errors.length ? `<div class="notice err"><b>${w('fix')}</b><br>${b.errors.map(esc).join('<br>')}</div>` : `<div class="notice">${w('note')}</div>`}`;
}

export function wizardHtml(data) {
  const names = [w('s1'), w('s2'), w('s3'), w('s4')];
  return `<div class="stack"><h1>${w('title')}</h1>
    <ol class="wz-steps">${names.map((n, i) => `<li class="${s.step === i + 1 ? 'on' : s.step > i + 1 ? 'done' : ''}"><b>${i + 1}</b><span>${esc(n)}</span></li>`).join('')}</ol>
    ${s.step === 5 ? `<h2 class="sec">${w('review')}</h2>` : ''}
    ${errs.length ? `<div class="notice err">${errs.map((e) => esc(w('e.' + e))).join('<br>')}</div>` : ''}
    <div class="card stack">${stepBody(data)}</div>
    <div class="wz-nav">
      ${s.step > 1 ? `<button type="button" class="btn ghost" data-wzact="back">${w('back')}</button>` : `<button type="button" class="btn ghost" data-wzact="cancel">${w('cancel')}</button>`}
      ${s.step < 5 ? `<button type="button" class="btn" data-wzact="next">${s.step === 4 ? w('review') : w('next')}</button>` : `<button type="button" class="btn cta" data-wzact="save" ${build(s, data).errors.length ? 'disabled' : ''}>${w('save')}</button>`}
    </div></div>`;
}

/** ctx: { getData, render, persist, toast, clone, isActive } */
export function wizardBind(ctx) {
  const onField = (e) => {
    const el = e.target.closest?.('[data-wz]');
    if (!el || !ctx.isActive()) return;
    const k = el.dataset.wz;
    let v = el.value;
    if (el.type === 'checkbox') { const arr = get(k) || []; v = el.checked ? [...new Set([...arr, el.dataset.val])] : arr.filter((x) => x !== el.dataset.val); }
    set(k, v);
    if (el.dataset.rr && e.type === 'change') ctx.render();
  };
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);
  document.addEventListener('click', async (e) => {
    const b = e.target.closest?.('[data-wzact]');
    if (!b || !ctx.isActive()) return;
    const data = ctx.getData(), i = Number(b.dataset.i);
    switch (b.dataset.wzact) {
      case 'next': errs = stepErrors(s.step, s, data); if (!errs.length) s.step += 1; break;
      case 'back': errs = []; s.step -= 1; break;
      case 'add-sch': s.sch.push({ direction: s.sch.at(-1)?.direction === 'outbound' ? 'return' : 'outbound', time: '', days: [...DAY_ORDER] }); break;
      case 'del-sch': s.sch.splice(i, 1); break;
      case 'add-counter': s.counters.push({ place: '', name: '', address: '', phone: '' }); break;
      case 'del-counter': s.counters.splice(i, 1); break;
      case 'add-sup': s.sups.push({ name: '', phone: '' }); break;
      case 'del-sup': s.sups.splice(i, 1); break;
      case 'cancel': wizardReset(); location.hash = '#/'; return;
      case 'save': {
        const r = build(s, data);
        if (!r.records || r.errors.length) break;
        let backed = true;
        try { store.set('bt_backup_v1', { at: new Date().toISOString(), data: ctx.clone(data) }); } catch { backed = false; }
        for (const ent of Object.keys(r.records)) data[ent].push(...r.records[ent]);
        await ctx.persist();
        ctx.toast(backed ? w('saved') : w('nobackup'));
        wizardReset(); location.hash = '#/list/buses'; return;
      }
    }
    ctx.render();
    window.scrollTo(0, 0);
  });
}
