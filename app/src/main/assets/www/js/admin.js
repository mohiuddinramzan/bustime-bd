// BusTime BD admin: separate page, hash routes, generic CRUD driven by ENT definitions.
// Authorization: every write path calls provider.require(...). The UI hides controls too, but hiding is not security.
import { t, setLang, getLang, pick } from './i18n.js';
import { esc, clone, byId, getPath, setPath, localISODate, DAYS, DAY_ORDER } from './util.js';
import { store } from './store.js';
import { JsonRepository } from './repository.js';
import { LocalDemoAuth, AuthError } from './auth.js';
import { isFirebaseConfigured, FirebaseAuthAdapter, FirebaseRepository } from './firebase-adapter.js';
import { validateRecord, validateDataset, validateBundle, findDuplicate, deleteBlockers, toBundle, ENTITIES } from './validate.js';
import { saveJson, copyText } from './native.js';
import { toast, confirmDialog } from './ui.js';
import { wizardHtml, wizardBind, wizardLabel } from './bus-wizard.js';

const repo = new JsonRepository();
const $ = (s) => document.querySelector(s);
const st = { provider: null, data: null, meta: null, error: false, listStatus: 'all', pending: null, importMsg: '' };
setLang(store.get('bt_lang', 'bn'));
document.documentElement.lang = getLang();
if (store.get('bt_theme', 'system') !== 'system') document.documentElement.dataset.theme = store.get('bt_theme');

/* ---------- entity definitions ---------- */
const txt = (key, extra = {}) => ({ key, type: 'text', ...extra });
const STATUS_FIELDS = [
  { key: 'status', type: 'select', options: ['draft', 'published', 'archived'], optLabel: (v) => t('a.status.' + v) },
  { key: 'verification.status', type: 'select', options: ['unverified', 'verified'], optLabel: (v) => t('a.v.' + v) },
  { key: 'verification.lastVerified', type: 'date', hint: 'a.h.verified' },
  txt('verification.source'),
];
const ENT = {
  buses: {
    fields: [txt('id', { id: true }), txt('name_bn'), txt('name_en'), txt('operator_bn'), txt('operator_en'),
      { key: 'type', type: 'select', options: ['AC', 'NON_AC'], optLabel: (v) => t('type.' + v) },
      { key: 'counterIds', type: 'multi', from: 'counters' },
      { key: 'supervisors', type: 'lines', hint: 'a.h.supervisors', parts: ['name_bn', 'name_en', 'phone'] },
      ...STATUS_FIELDS],
    blank: () => ({ type: 'AC', counterIds: [], supervisors: [], status: 'draft', verification: { status: 'unverified', lastVerified: null, source: 'admin-local-entry' } }),
  },
  routes: {
    fields: [txt('id', { id: true }), txt('name_bn'), txt('name_en'),
      { key: 'stops', type: 'lines', hint: 'a.h.stops', parts: ['id', 'bn', 'en'] },
      { key: 'approxDurationMin', type: 'number' }, ...STATUS_FIELDS],
    blank: () => ({ stops: [], approxDurationMin: 60, durationIsEstimate: true, status: 'draft', verification: { status: 'unverified', lastVerified: null, source: 'admin-local-entry' } }),
  },
  schedules: {
    fields: [txt('id', { id: true }),
      { key: 'busId', type: 'select', from: 'buses' }, { key: 'routeId', type: 'select', from: 'routes' },
      { key: 'direction', type: 'select', options: ['outbound', 'return'], optLabel: (v) => t('dir.' + v) },
      { key: 'departureTime', type: 'time' }, { key: 'operatingDays', type: 'days' },
      { key: 'counterId', type: 'select', from: 'counters', optional: true }, ...STATUS_FIELDS],
    blank: () => ({ direction: 'outbound', operatingDays: [...DAY_ORDER], status: 'draft', verification: { status: 'unverified', lastVerified: null, source: 'admin-local-entry' } }),
  },
  counters: {
    fields: [txt('id', { id: true }), txt('name_bn'), txt('name_en'), txt('placeId'), txt('address_bn'), txt('address_en'),
      { key: 'phones', type: 'lines', hint: 'a.h.phones', parts: ['label', 'number'] }, ...STATUS_FIELDS],
    blank: () => ({ phones: [], status: 'draft', verification: { status: 'unverified', lastVerified: null, source: 'admin-local-entry' } }),
  },
};

const title = (ent, r) => {
  if (ent === 'schedules') return `${pick(byId(st.data.buses).get(r.busId) || {}, 'name') || r.busId} · ${r.departureTime} · ${t('dir.' + r.direction)}`;
  return pick(r, 'name') || r.id;
};
const optionsFor = (f) => (f.from ? st.data[f.from].map((r) => [r.id, title(f.from, r)]) : f.options.map((v) => [v, f.optLabel(v)]));
const fid = (key) => 'f_' + key.replace(/\./g, '_');

/* ---------- lines <-> text ---------- */
const toLines = (f, arr) => (arr || []).map((o) => f.parts.map((p) => o[p] ?? '').join(' | ')).join('\n');
const fromLines = (f, s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const v = l.split('|').map((x) => x.trim());
  const o = {};
  if (v.length === f.parts.length) f.parts.forEach((p, i) => { o[p] = v[i]; });
  if (f.key === 'supervisors' && o.phone !== undefined) o.demo = false;
  if (f.key === 'phones' && o.number !== undefined) o.demo = false;
  return o;
});

/* ---------- form ---------- */
function fieldHtml(f, rec, isNew) {
  const v = getPath(rec, f.key);
  const id = fid(f.key);
  let input = '';
  if (f.type === 'select') {
    const opts = optionsFor(f);
    input = `<select id="${id}" data-key="${f.key}">${f.optional ? `<option value="">${t('a.none.option')}</option>` : ''}${
      opts.map(([val, lab]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  } else if (f.type === 'multi' || f.type === 'days') {
    const opts = f.type === 'days' ? DAY_ORDER.map((d) => [d, t('day.' + d)]) : optionsFor({ from: f.from });
    input = `<div class="checks">${opts.map(([val, lab]) => `<label><input type="checkbox" data-key="${f.key}" value="${esc(val)}" ${(v || []).includes(val) ? 'checked' : ''}> ${esc(lab)}</label>`).join('')}</div>`;
  } else if (f.type === 'lines') {
    input = `<textarea id="${id}" data-key="${f.key}" rows="4" dir="auto">${esc(toLines(f, v))}</textarea>`;
  } else {
    const dis = f.id && !isNew ? 'disabled' : '';
    const extra = f.type === 'number' ? 'inputmode="numeric" min="1"' : f.id ? 'autocapitalize="off" spellcheck="false"' : '';
    input = `<input id="${id}" data-key="${f.key}" type="${f.type}" value="${esc(v ?? '')}" ${dis} ${extra}>`;
  }
  const hint = f.hint ? t(f.hint) : f.id ? (isNew ? t('a.f.id') : t('a.idLocked')) : '';
  return `<div class="field"><label class="f" for="${id}">${t('a.f.' + f.key)}</label>${input}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}<div class="err" data-err="${f.key}" hidden></div></div>`;
}

function collect(ent, base) {
  const r = clone(base);
  for (const f of ENT[ent].fields) {
    const els = [...document.querySelectorAll(`[data-key="${f.key}"]`)];
    let v;
    if (f.type === 'multi') v = els.filter((e) => e.checked).map((e) => e.value);
    else if (f.type === 'days') v = DAY_ORDER.filter((d) => els.some((e) => e.checked && e.value === d));
    else if (f.type === 'lines') v = fromLines(f, els[0].value);
    else if (f.type === 'number') v = els[0].value === '' ? null : Number(els[0].value);
    else v = els[0].value.trim();
    if (f.id && base.id) continue; // ids are locked on edit
    if ((f.key === 'counterId' || f.key === 'verification.lastVerified') && v === '') v = f.key === 'counterId' ? undefined : null;
    setPath(r, f.key, v);
  }
  if (r.counterId === undefined) delete r.counterId;
  r.updatedAt = new Date().toISOString();
  return r;
}

async function persist() {
  st.provider.require('edit-local');
  await repo.saveDraft(st.data, st.meta.bundledVersion);
}

async function saveRecord(ent, isNew, baseId) {
  const base = isNew ? ENT[ent].blank() : st.data[ent].find((r) => r.id === baseId);
  const r = collect(ent, isNew ? { ...base, id: '' } : base);
  const errs = validateRecord(ent, r);
  if (isNew && st.data[ent].some((x) => x.id === r.id)) errs.push({ field: 'id', code: 'dup-id' });
  const dup = findDuplicate(ent, r, st.data);
  if (dup) errs.push({ field: '', code: 'duplicate', id: dup.id });
  const refs = { schedules: [['busId', 'buses'], ['routeId', 'routes'], ['counterId', 'counters']] }[ent] || [];
  for (const [k, coll] of refs) if (r[k] && !st.data[coll].some((x) => x.id === r[k])) errs.push({ field: k, code: 'ref' });
  document.querySelectorAll('.err').forEach((e) => { e.hidden = true; e.textContent = ''; });
  if (errs.length) {
    for (const e of errs) {
      const box = document.querySelector(`[data-err="${e.field}"]`) || $('#formErr');
      box.hidden = false;
      box.textContent = e.code === 'duplicate' ? t('a.dup', { id: e.id }) : t('e.' + e.code);
    }
    toast(t('a.fixErrors'));
    return;
  }
  const i = st.data[ent].findIndex((x) => x.id === r.id);
  if (i >= 0) st.data[ent][i] = r; else st.data[ent].push(r);
  await persist();
  toast(t('a.saved'));
  location.hash = `#/list/${ent}`;
}

/* ---------- pages ---------- */
const notice = () => `<div class="notice">${t('a.banner')}</div>${st.meta?.localBaseMismatch ? `<div class="notice err">${t('a.mismatch')}</div>` : ''}`;

function loginPage() {
  const fb = isFirebaseConfigured();
  return `<div class="stack"><h1>${t('a.login.title')}</h1>
    <section class="card stack">${fb
      ? `<div class="field"><label class="f" for="fbEmail">${t('a.login.email')}</label><input id="fbEmail" type="email" autocomplete="username" inputmode="email"></div>
         <div class="field"><label class="f" for="fbPass">${t('a.login.pass')}</label><input id="fbPass" type="password" autocomplete="current-password"></div>
         <button class="btn block" data-action="fb-login">${t('a.login.btn')}</button>`
      : `<div class="notice">${t('a.login.fbOff')}</div>`}</section>
    ${fb ? '' : `<section class="card stack"><h2>${t('a.login.demoTitle')}</h2><div class="notice err">${t('a.login.demoWarn')}</div>
      <button class="btn block" data-action="demo-login">${t('a.login.demoBtn')}</button></section>`}
    <a class="btn ghost block" href="index.html">${t('a.toApp')}</a></div>`;
}

function dashboardPage() {
  const { errors, warnings } = validateDataset(st.data);
  const line = (x) => `<div class="list-item"><div class="grow"><b>${esc(x.file)}${x.id ? ' / ' + esc(x.id) : ''}</b><div class="muted">${esc(x.field)} – ${t('e.' + x.code)}</div></div></div>`;
  return `<div class="stack">${notice()}<h1>${t('a.home')}</h1>${st.provider?.claims?.email ? `<div class="muted" dir="ltr">${t('a.signedAs')} ${esc(st.provider.claims.email)}</div>` : ''}
    <section class="card"><h2>${t('a.counts')}</h2>${ENTITIES.map((e) =>
      `<a class="list-item" href="#/list/${e}"><span class="grow">${t('a.ent.' + e)}</span><b>${st.data[e].length}</b></a>`).join('')}</section>
    <section class="card stack"><h2>${t('a.checks')}</h2>
      ${errors.length || warnings.length ? `<div class="row"><span class="badge warn">${t('a.checks.errors', { n: errors.length })}</span><span class="badge">${t('a.checks.warnings', { n: warnings.length })}</span></div>` : `<span class="badge ok">${t('a.checks.ok')}</span>`}
      ${errors.slice(0, 15).map(line).join('')}${warnings.slice(0, 15).map(line).join('')}</section>
    <section class="card stack"><h2>${t('a.publish.title')}</h2>${st.provider?.can('publish') ? `<button class="btn block" data-action="fb-publish">${t('a.publish.btn')}</button>` : `<div class="notice">${t('a.publish.body')}</div>`}</section>
    <a class="btn cta block" href="#/new-bus">${wizardLabel()}</a>
    <a class="btn block" href="#/data">${t('a.data')}</a>
    <button class="btn ghost block" data-action="logout">${t('a.logout')}</button></div>`;
}

function listPage(ent) {
  const items = st.data[ent].filter((r) => st.listStatus === 'all' || r.status === st.listStatus);
  const pills = ['all', 'draft', 'published', 'archived'].map((s) =>
    `<button class="btn sm ${st.listStatus === s ? '' : 'ghost'}" data-action="lstat" data-v="${s}">${s === 'all' ? t('a.all') : t('a.status.' + s)}</button>`).join('');
  return `<div class="stack">${notice()}<div class="row between"><h1>${t('a.ent.' + ent)}</h1><a class="btn sm" href="#/edit/${ent}/new">${t('a.new')}</a></div>
    <div class="pills row">${pills}</div>
    ${items.length ? items.map((r) => `<div class="card stack"><div class="row between"><div class="grow"><b>${esc(title(ent, r))}</b><div class="muted" dir="ltr">${esc(r.id)}</div></div><span class="badge ${r.status === 'published' ? 'ok' : 'warn'}">${t('a.status.' + r.status)}</span></div>
      <div class="row"><a class="btn sm" href="#/edit/${ent}/${esc(r.id)}">${t('a.edit')}</a>
      <button class="btn sm ghost" data-action="${r.status === 'archived' ? 'restore' : 'archive'}" data-ent="${ent}" data-id="${esc(r.id)}">${r.status === 'archived' ? t('a.restore') : t('a.archive')}</button>
      <button class="btn sm danger" data-action="delete" data-ent="${ent}" data-id="${esc(r.id)}">${t('a.delete')}</button></div></div>`).join('') : `<div class="empty">${t('a.none')}</div>`}
    <a class="btn ghost block" href="#/">${t('a.home')}</a></div>`;
}

function editPage(ent, id) {
  const isNew = id === 'new';
  const rec = isNew ? ENT[ent].blank() : st.data[ent].find((r) => r.id === id);
  if (!rec) return `<div class="empty">${t('notFound')}</div>`;
  return `<div class="stack">${notice()}<h1>${t('a.ent.' + ent)} · ${isNew ? t('a.new') : esc(title(ent, rec))}</h1>
    <div class="notice err" id="formErr" hidden></div>
    <div class="card stack">${ENT[ent].fields.map((f) => fieldHtml(f, rec, isNew)).join('')}</div>
    <button class="btn block" data-action="save" data-ent="${ent}" data-id="${esc(id)}">${t('a.save')}</button>
    <a class="btn ghost block" href="#/list/${ent}">${t('cancel')}</a></div>`;
}

function dataPage() {
  return `<div class="stack">${notice()}<h1>${t('a.data')}</h1>
    <section class="card stack"><h2>${t('a.export.title')}</h2><p>${t('a.export.body')}</p>
      <button class="btn block" data-action="export-save">${t('a.export.save')}</button>
      <button class="btn ghost block" data-action="export-copy">${t('a.export.copy')}</button></section>
    <section class="card stack"><h2>${t('a.import.title')}</h2><p>${t('a.import.body')}</p>
      <label class="btn ghost block" for="impFile">${t('a.import.file')}</label>
      <input id="impFile" type="file" accept=".json,application/json" hidden>
      <div class="field"><label class="f" for="impText">${t('a.import.paste')}</label><textarea id="impText" rows="5" dir="ltr"></textarea></div>
      <button class="btn block" data-action="import-check">${t('a.import.check')}</button>
      <div id="impMsg">${st.importMsg}</div>
      ${st.pending ? `<button class="btn danger block" data-action="import-apply">${t('a.import.apply')}</button>` : ''}</section>
    <section class="card stack"><button class="btn danger block" data-action="discard">${t('a.discard')}</button></section>
    <a class="btn ghost block" href="#/">${t('a.home')}</a></div>`;
}

/* ---------- router / shell ---------- */
function header() {
  $('#top').innerHTML = `<span class="brand">${t('a.title')} · ${t('app.name')}</span><span class="chips">${
    st.provider ? `<button class="chip amber" data-action="logout">${t('a.logout')}</button>` : `<a class="chip" href="index.html">${t('a.toApp')}</a>`}</span>`;
}

function render() {
  header();
  const view = $('#view');
  const [, page = '', a, b] = location.hash.split('/');
  if (st.error) { view.innerHTML = `<div class="notice err">${t('err.load')}</div><button class="btn block" data-action="retry">${t('retry')}</button>`; return; }
  if (!st.data) { view.innerHTML = '<div class="skel"></div>'; return; }
  if (!st.provider) { if (page !== 'login') { location.hash = '#/login'; return; } view.innerHTML = loginPage(); return; }
  if (page === 'login') { location.hash = '#/'; return; }
  if (page === 'list' && ENT[a]) view.innerHTML = listPage(a);
  else if (page === 'edit' && ENT[a]) view.innerHTML = editPage(a, decodeURIComponent(b || 'new'));
  else if (page === 'new-bus') view.innerHTML = wizardHtml(st.data);
  else if (page === 'data') view.innerHTML = dataPage();
  else view.innerHTML = dashboardPage();
}

async function load(preferLocal = true) {
  try {
    const { data, meta } = await repo.load({ preferLocal });
    st.data = clone(data); st.meta = meta; st.error = false;
  } catch (e) { console.error(e); st.error = true; }
  render();
}

/* ---------- actions ---------- */
async function mutate(ent, id, action) {
  const r = st.data[ent].find((x) => x.id === id);
  if (!r) return;
  const name = title(ent, r);
  if (action === 'delete') {
    const blockers = deleteBlockers(ent, id, st.data);
    if (blockers.length) {
      await confirmDialog({ title: t('a.confirm.delete'), body: t('a.blocked', { list: blockers.slice(0, 5).map((x) => x.id).join(', ') }), ok: t('ok'), cancel: t('cancel') });
      return;
    }
    if (!(await confirmDialog({ title: t('a.confirm.delete'), body: t('a.confirm.deleteBody', { name }), ok: t('a.delete'), cancel: t('cancel'), danger: true }))) return;
    st.data[ent] = st.data[ent].filter((x) => x.id !== id);
    toast(t('a.deleted'));
  } else if (action === 'archive') {
    if (!(await confirmDialog({ title: t('a.confirm.archive'), body: t('a.confirm.archiveBody', { name }), ok: t('a.archive'), cancel: t('cancel') }))) return;
    r.status = 'archived'; r.updatedAt = new Date().toISOString();
    toast(t('a.archived'));
  } else {
    r.status = 'draft'; r.updatedAt = new Date().toISOString();
    toast(t('a.restored'));
  }
  await persist();
  render();
}

function checkImport() {
  st.pending = null;
  let obj;
  try { obj = JSON.parse($('#impText').value); } catch { st.importMsg = `<div class="notice err">${t('e.json')}</div>`; return; }
  const { errors } = validateBundle(obj);
  if (errors.length) {
    st.importMsg = errors.slice(0, 15).map((x) => `<div class="notice err">${esc(x.file)}${x.id ? '/' + esc(x.id) : ''} ${esc(x.field)}: ${t('e.' + x.code)}</div>`).join('');
    return;
  }
  st.pending = { buses: obj.buses, routes: obj.routes, schedules: obj.schedules, counters: obj.counters, config: obj.config || st.data.config };
  st.importMsg = `<div class="notice">${t('a.import.valid', { counts: ENTITIES.map((e) => `${t('a.ent.' + e)} ${obj[e].length}`).join(', ') })}</div>`;
}

const authMsg = (e) => {
  const m = String(e.message);
  if (/not-admin/.test(m)) return t('a.login.err.notAdmin');
  if (/expired/.test(m)) return t('a.login.err.expired');
  if (/forbidden/.test(m)) return t('a.login.title');
  if (/fetch|abort|network/i.test(m)) return t('a.login.err.net');
  return t('a.login.err.bad');
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'fbEmail' || e.target.id === 'fbPass')) {
    e.preventDefault();
    document.querySelector('[data-action="fb-login"]')?.click();
  }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  try {
    switch (d.action) {
      case 'demo-login': { const p = new LocalDemoAuth(); await p.signIn(); st.provider = p; location.hash = '#/'; render(); break; }
      case 'fb-login': {
        const p = new FirebaseAuthAdapter();
        el.disabled = true;
        try { await p.signIn({ email: $('#fbEmail').value.trim(), password: $('#fbPass').value }); } finally { el.disabled = false; }
        st.provider = p; location.hash = '#/'; render(); break;
      }
      case 'fb-publish': {
        st.provider.require('publish');
        if (validateDataset(st.data).errors.length) { toast(t('a.publish.errs')); break; }
        if (!(await confirmDialog({ title: t('a.publish.title'), body: t('a.publish.confirm'), ok: t('a.publish.btn'), cancel: t('cancel'), danger: true }))) break;
        const n = await new FirebaseRepository().publish(st.data, st.provider.token());
        toast(t('a.publish.done', { n }));
        break;
      }
      case 'logout': await st.provider?.signOut(); st.provider = null; location.hash = '#/login'; render(); break;
      case 'retry': load(); break;
      case 'lstat': st.listStatus = d.v; render(); break;
      case 'save': await saveRecord(d.ent, d.id === 'new', d.id); break;
      case 'archive': case 'restore': case 'delete': await mutate(d.ent, d.id, d.action); break;
      case 'export-save': {
        st.provider.require('export');
        const where = saveJson(`bustime-bd-export-${localISODate().replace(/-/g, '')}.json`, JSON.stringify(toBundle(st.data), null, 2));
        toast(where ? t('a.export.saved', { where }) : t('a.export.fail'));
        break;
      }
      case 'export-copy': st.provider.require('export'); toast((await copyText(JSON.stringify(toBundle(st.data), null, 2))) ? t('copied') : t('copyFail')); break;
      case 'import-check': st.provider.require('import'); checkImport(); { const keep = $('#impText').value; render(); $('#impText').value = keep; } break;
      case 'import-apply':
        st.provider.require('import');
        if (!st.pending || !(await confirmDialog({ title: t('a.import.apply'), body: t('a.import.confirm'), ok: t('a.import.apply'), cancel: t('cancel'), danger: true }))) break;
        st.data = clone(st.pending); st.pending = null; st.importMsg = '';
        await persist(); toast(t('a.import.applied')); render(); break;
      case 'discard':
        if (!(await confirmDialog({ title: t('a.discard'), body: t('a.discard.confirm'), ok: t('a.discard'), cancel: t('cancel'), danger: true }))) break;
        repo.discardLocal(); await load(false); toast(t('a.discarded')); break;
      default: break;
    }
  } catch (err) {
    console.error(err);
    toast(err instanceof AuthError ? authMsg(err) : String(err.message || err));
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'impFile' || !e.target.files[0]) return;
  const text = await e.target.files[0].text();
  $('#impText').value = text;
});

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
load();

wizardBind({ getData: () => st.data, render, persist, toast, clone, isActive: () => !!st.provider && location.hash.startsWith('#/new-bus') });
