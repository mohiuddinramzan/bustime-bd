// BusTime BD user app: hash-routed single page, event delegation (no inline handlers: CSP-safe).
import { t, setLang, getLang, pick, loc, num, formatTime, timeParts, formatDuration, formatDate, dayLabel } from './i18n.js';
import { esc, formatPhone, byId } from './util.js';
import { store } from './store.js';
import { JsonRepository, KEYS } from './repository.js';
import { buildIndex, buildAliasIndex, searchEntries, applyFilters, nextDepartures, listOptions } from './search.js';
import { callNumber, copyPhone } from './native.js';
import { toast, confirmDialog } from './ui.js';

const repo = new JsonRepository();
const $ = (s) => document.querySelector(s);
const app = {
  data: null, meta: null, index: [], aliasIdx: new Map(), opts: null, status: 'loading',
  favs: new Set(store.get('bt_favs', [])), recents: store.get('bt_recents', []), q: '', filters: {},
};
let theme = store.get('bt_theme', 'system');
setLang(store.get('bt_lang', 'bn'));

const ICON = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  heart: '<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
};
const svg = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
const NAV = [['home', 'home'], ['search', 'search'], ['routes', 'route'], ['favorites', 'heart'], ['settings', 'sliders']];

/* ---------- boot / data ---------- */
function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
function applyLang() {
  document.documentElement.lang = getLang();
  document.title = t('app.name');
}

async function load() {
  app.status = 'loading';
  render();
  try {
    const { data, meta } = await repo.load();
    app.data = data;
    app.meta = meta;
    app.index = buildIndex(data);
    app.aliasIdx = buildAliasIndex(data.config.aliases);
    app.status = 'ready';
  } catch (e) {
    console.error(e);
    app.status = 'error';
  }
  render();
}

/* ---------- small view helpers ---------- */
const verifyBadge = (v) =>
  v?.status === 'verified'
    ? `<span class="badge ok">${t('verified')} · ${esc(formatDate(v.lastVerified))}</span>`
    : `<span class="badge warn">${t('unverified')}</span>`;

function staleNote(v) {
  const days = app.data?.config?.staleAfterDays;
  if (v?.status !== 'verified' || !v.lastVerified || !days) return '';
  const age = (Date.now() - Date.parse(v.lastVerified + 'T00:00:00Z')) / 86400000;
  return age > days ? `<div class="notice">${t('stale')}</div>` : '';
}

const typeLabel = (b) => t('type.' + b.type);
const routeLabel = (e) => `${esc(loc(e.origin))} → ${esc(loc(e.destination))}`;

function tripCard(e) {
  const tp = timeParts(e.s.departureTime);
  const fav = app.favs.has(e.b.id);
  return `<article class="trip">
    <a class="trip-link" href="#/trip/${esc(e.s.id)}">
      <div class="stub"><b>${esc(tp.clock)}</b><span>${esc(tp.period)}</span></div>
      <div class="body">
        <h3>${routeLabel(e)}</h3>
        <div class="muted">${esc(pick(e.b, 'name'))} · ${esc(pick(e.b, 'operator'))}</div>
        <div class="chips">
          <span class="chip">${typeLabel(e.b)}</span>
          <span class="chip">${t('period.' + e.period)}</span>
          <span class="chip">${esc(dayLabel(e.s.operatingDays))}</span>
          ${verifyBadge(e.s.verification)}
        </div>
      </div>
    </a>
    <button type="button" class="fav ${fav ? 'on' : ''}" data-action="fav" data-bus="${esc(e.b.id)}" aria-pressed="${fav}" aria-label="${t('fav.toggle')}">${svg('heart')}</button>
  </article>`;
}

function phoneRow(number, label, demo) {
  const f = formatPhone(number);
  const shown = getLang() === 'bn' ? num(f) : f;
  return `<div class="phone"><div><small>${esc(label)}${demo ? ` <span class="badge warn">${t('demo')}</span>` : ''}</small><b dir="ltr">${esc(shown)}</b></div>
    <button type="button" class="btn sm" data-action="call" data-num="${esc(number)}" data-demo="${demo ? 1 : 0}">${t('call')}</button>
    <button type="button" class="btn sm ghost" data-action="copy" data-num="${esc(number)}">${t('copy')}</button></div>`;
}

const empty = (title, hint = '') => `<div class="empty"><h3>${esc(title)}</h3>${hint ? `<p>${esc(hint)}</p>` : ''}</div>`;

function selectHtml(key, label, options, value) {
  return `<div class="field"><label class="f" for="f-${key}">${label}</label><select id="f-${key}" data-filter="${key}">
    <option value="">${t('f.any')}</option>${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
}
function filterFields() {
  const o = app.opts, f = app.filters;
  return `<div class="grid2">${selectHtml('origin', t('f.origin'), o.origins.map((p) => [p.id, loc(p)]), f.origin)}
    ${selectHtml('destination', t('f.destination'), o.destinations.map((p) => [p.id, loc(p)]), f.destination)}</div>`;
}

/* ---------- pages ---------- */
const pages = {
  home() {
    const nx = nextDepartures(app.index, new Date());
    const quick = app.data.routes.filter((r) => r.status === 'published');
    return `${app.data.config.isDemoData ? `<div class="notice">${esc(loc(app.data.config.disclaimer))}</div>` : ''}
    ${app.meta.source === 'local-edits' ? `<div class="notice">${t('banner.local')}</div>` : ''}
    <section class="card stack"><h1>${t('home.title')}</h1>${filterFields()}
      <button type="button" class="btn block" data-action="go-search">${t('home.go')}</button></section>
    <h2 class="sec">${t('home.shortcuts')}</h2>
    <div class="pills">${quick.map((r) => `<a href="#/route/${esc(r.id)}">${esc(pick(r, 'name'))}</a>`).join('')}</div>
    <h2 class="sec">${t('home.next')}</h2>
    <p class="muted">${t('home.nextNote')}</p>
    ${nx.length ? nx.map(tripCard).join('') : empty(t('home.noNext'))}
    ${app.recents.length ? `<h2 class="sec">${t('home.recent')}</h2><div class="pills">${app.recents.map((q) => `<button type="button" data-action="recent" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <p><button type="button" class="btn ghost sm" data-action="clear-recents">${t('settings.clearRecents')}</button></p>` : ''}`;
  },

  search() {
    const o = app.opts, f = app.filters;
    return `<div class="field"><label class="f" for="q">${t('search.label')}</label>
      <input id="q" type="search" data-q autocomplete="off" enterkeyhint="search" placeholder="${esc(t('search.placeholder'))}" value="${esc(app.q)}"></div>
    <details class="filters card" ${Object.values(f).some(Boolean) ? 'open' : ''}><summary>${t('search.filters')}</summary>
      ${filterFields()}
      <div class="grid2">${selectHtml('operator', t('f.operator'), o.operators.map((b) => [b.operator_en, pick(b, 'operator')]), f.operator)}
      ${selectHtml('type', t('f.type'), [['AC', t('type.AC')], ['NON_AC', t('type.NON_AC')]], f.type)}</div>
      <div class="grid2">${selectHtml('period', t('f.period'), [['day', t('period.day')], ['night', t('period.night')]], f.period)}
      ${selectHtml('direction', t('f.direction'), [['outbound', t('dir.outbound')], ['return', t('dir.return')]], f.direction)}</div>
      <div class="field"><label class="f" for="f-after">${t('f.after')}</label><input id="f-after" type="time" data-filter="after" value="${esc(f.after || '')}"></div>
      <button type="button" class="btn ghost sm" data-action="reset-filters">${t('f.reset')}</button></details>
    <div id="results" aria-live="polite">${resultsHtml()}</div>`;
  },

  routes() {
    const rs = app.data.routes.filter((r) => r.status === 'published');
    if (!rs.length) return empty(t('routes.empty'));
    return `<h1 class="sec">${t('routes.title')}</h1>` + rs.map((r) => {
      const n = app.index.filter((e) => e.r.id === r.id).length;
      return `<a class="card stack linkcard" href="#/route/${esc(r.id)}"><h3>${esc(pick(r, 'name'))}</h3>
        <div class="muted">${esc(r.stops.map(loc).join(' → '))}</div>
        <div class="chips"><span class="chip">${esc(formatDuration(r.approxDurationMin))} · ${t('estimate')}</span><span class="chip">${t('routes.count', { n })}</span></div></a>`;
    }).join('');
  },

  route(id) {
    const r = byId(app.data.routes).get(id);
    if (!r || r.status !== 'published') return notFound();
    const list = app.index.filter((e) => e.r.id === id);
    const sect = (dir) => {
      const l = list.filter((e) => e.s.direction === dir);
      return `<h2 class="sec">${t('dir.' + dir)}</h2>${l.length ? l.map(tripCard).join('') : empty(t('results.empty'))}`;
    };
    return `${backLink('#/routes')}<section class="card"><h1>${esc(pick(r, 'name'))}</h1>
      <p class="muted">${t('route.duration')}: ${esc(formatDuration(r.approxDurationMin))} (${t('estimate')})</p>
      <ol class="stops">${r.stops.map((s, i) => `<li class="${i === 0 || i === r.stops.length - 1 ? 'end' : ''}">${esc(loc(s))}</li>`).join('')}</ol>
      <div class="mt8">${verifyBadge(r.verification)}</div></section>${sect('outbound')}${sect('return')}`;
  },

  trip(id) {
    const e = app.index.find((x) => x.s.id === id);
    if (!e) return notFound();
    const fav = app.favs.has(e.b.id);
    const others = e.busCounters.filter((c) => c.id !== e.c?.id);
    const counterCard = (c, title) => `<div class="card"><h3>${esc(title)}: ${esc(pick(c, 'name'))}</h3>
      <p class="muted">${esc(pick(c, 'address'))}</p>${(c.phones || []).map((p) => phoneRow(p.number, t('phone.' + p.label), p.demo)).join('') || `<p class="muted">${t('trip.noPhones')}</p>`}
      ${verifyBadge(c.verification)}</div>`;
    const tp = timeParts(e.s.departureTime);
    return `${backLink('#/search')}
    <section class="card stack"><div class="row between"><h1>${esc(tp.period)} ${esc(tp.clock)}</h1>
      <button type="button" class="btn ghost sm ${fav ? 'on' : ''}" data-action="fav" data-bus="${esc(e.b.id)}" aria-pressed="${fav}">${svg('heart')}<span>${t('fav.toggle')}</span></button></div>
      <h2>${routeLabel(e)}</h2>
      <div>${esc(pick(e.b, 'name'))} · ${esc(pick(e.b, 'operator'))}</div>
      <div class="chips row"><span class="chip">${typeLabel(e.b)}</span><span class="chip">${t('period.' + e.period)}</span><span class="chip">${t('dir.' + e.s.direction)}</span></div>
      <div class="muted">${t('trip.operates')}: ${esc(dayLabel(e.s.operatingDays))}</div></section>
    <div class="notice">${t('trip.estimateNote')}</div>
    <section class="card"><h3>${t('route.stops')}</h3>
      <p class="muted">${t('route.duration')}: ${esc(formatDuration(e.r.approxDurationMin))} (${t('estimate')})</p>
      <ol class="stops">${e.stops.map((s, i) => `<li class="${i === 0 || i === e.stops.length - 1 ? 'end' : ''}">${esc(loc(s))}</li>`).join('')}</ol></section>
    ${e.c ? counterCard(e.c, t('trip.boarding')) : `<div class="card muted">${t('trip.noCounter')}</div>`}
    ${others.length ? `<h2 class="sec">${t('trip.counters')}</h2>${others.map((c) => counterCard(c, t('counter'))).join('')}` : ''}
    <section class="card"><h3>${t('trip.supervisors')}</h3>${(e.b.supervisors || []).map((s) => phoneRow(s.phone, pick(s, 'name'), s.demo)).join('') || `<p class="muted">${t('trip.noSupervisor')}</p>`}</section>
    <section class="card stack"><h3>${t('trip.dataInfo')}</h3>
      <div>${verifyBadge(e.s.verification)}</div>${staleNote(e.s.verification)}
      <div class="muted">${t('lastUpdated')}: ${esc(formatDate((e.s.updatedAt || '').slice(0, 10)))}</div>
      <div class="muted">${t('lastVerified')}: ${e.s.verification?.lastVerified ? esc(formatDate(e.s.verification.lastVerified)) : t('never')}</div></section>`;
  },

  favorites() {
    const groups = [...app.favs].map((id) => ({ id, list: app.index.filter((e) => e.b.id === id) })).filter((g) => g.list.length);
    if (!groups.length) return `<h1 class="sec">${t('fav.title')}</h1>${empty(t('fav.empty'), t('fav.emptyHint'))}`;
    return `<h1 class="sec">${t('fav.title')}</h1>` + groups.map(({ list }) => {
      const b = list[0].b;
      return `<section class="card stack"><div class="row between"><div><h3>${esc(pick(b, 'name'))}</h3><div class="muted">${esc(pick(b, 'operator'))} · ${typeLabel(b)}</div></div>
        <button type="button" class="fav on" data-action="fav" data-bus="${esc(b.id)}" aria-pressed="true" aria-label="${t('fav.toggle')}">${svg('heart')}</button></div>
        <div class="pills">${list.map((e) => `<a href="#/trip/${esc(e.s.id)}">${esc(formatTime(e.s.departureTime))} · ${routeLabel(e)}</a>`).join('')}</div></section>`;
    }).join('');
  },

  settings() {
    const c = app.data.config, m = app.meta;
    const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
    return `<h1 class="sec">${t('settings.title')}</h1>
    <section class="card stack">
      <div class="field"><label class="f" for="s-lang">${t('settings.language')}</label><select id="s-lang" data-setting="lang">${opt('bn', 'বাংলা', getLang())}${opt('en', 'English', getLang())}</select></div>
      <div class="field"><label class="f" for="s-theme">${t('settings.theme')}</label><select id="s-theme" data-setting="theme">${opt('system', t('theme.system'), theme)}${opt('light', t('theme.light'), theme)}${opt('dark', t('theme.dark'), theme)}</select></div>
      ${m.hasLocal ? `<label class="row"><input type="checkbox" data-setting="useLocal" ${store.get(KEYS.useLocal, true) ? 'checked' : ''}> <span>${t('settings.useLocal')}</span></label><div class="muted">${t('settings.useLocalHint')}</div>` : ''}
    </section>
    <section class="card stack"><h3>${t('settings.data')}</h3>
      <div class="muted">${t('settings.version')}: ${esc(num(c.dataVersion))}</div>
      <div class="muted">${t('lastUpdated')}: ${esc(formatDate(c.dataUpdated))}</div>
      <div class="muted">${t('settings.mode')}: ${t('src.' + m.source)}</div>
      <div class="muted">${t('settings.firebase')}: ${t('settings.firebase.off')}</div>
      ${c.isDemoData ? `<div class="notice">${esc(loc(c.disclaimer))}</div>` : ''}</section>
    <section class="card stack"><div class="row">
      <button type="button" class="btn ghost" data-action="clear-recents">${t('settings.clearRecents')}</button>
      <button type="button" class="btn ghost" data-action="clear-favs">${t('settings.clearFavs')}</button></div>
      <a class="btn" href="admin.html">${t('settings.admin')}</a></section>
    <p class="muted">BusTime BD 1.0.0 · bd.bustime.app</p>`;
  },
};

const backLink = (href) => `<p><a href="${href}">← ${t('back')}</a></p>`;
const notFound = () => empty(t('notFound')) + `<p class="tc"><a class="btn" href="#/home">${t('nav.home')}</a></p>`;

function resultsHtml() {
  const list = searchEntries(applyFilters(app.index, app.filters), app.q, app.aliasIdx);
  if (!list.length) return empty(t('results.empty'), t('results.emptyHint'));
  return `<p class="muted">${t('results', { n: list.length })}</p>${list.map(tripCard).join('')}`;
}

/* ---------- render / router ---------- */
function parseHash() {
  const [page, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return [pages[page] ? page : 'home', arg ? decodeURIComponent(arg) : undefined];
}

function render(resetScroll = false) {
  const [page, arg] = parseHash();
  const top = $('#top');
  const chips = [];
  if (!navigator.onLine) chips.push(`<span class="chip amber">${t('chip.offline')}</span>`);
  if (app.meta) chips.push(`<span class="chip">${t('src.' + app.meta.source)}</span>`);
  top.innerHTML = `<span class="brand">${esc(t('app.name'))}</span><span class="chips">${chips.join('')}</span>`;
  const active = { route: 'routes', trip: 'search' }[page] || page;
  $('#nav').innerHTML = NAV.map(([p, ic]) => `<a href="#/${p}" ${p === active ? 'aria-current="page"' : ''}>${svg(ic)}<span>${t('nav.' + p)}</span></a>`).join('');
  const view = $('#view');
  if (app.status === 'loading') view.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  else if (app.status === 'error') view.innerHTML = `<div class="notice err">${t('err.load')}</div><button type="button" class="btn" data-action="retry">${t('retry')}</button>`;
  else {
    app.opts = listOptions(app.index);
    view.innerHTML = pages[page](arg);
  }
  if (resetScroll) window.scrollTo(0, 0);
}

/* ---------- actions ---------- */
function saveFavs() { store.set('bt_favs', [...app.favs]); }
function addRecent(q) {
  q = q.trim();
  if (!q) return;
  app.recents = [q, ...app.recents.filter((x) => x !== q)].slice(0, 8);
  store.set('bt_recents', app.recents);
}
const refreshResults = () => { const r = $('#results'); if (r) r.innerHTML = resultsHtml(); };

document.addEventListener('click', async (ev) => {
  const link = ev.target.closest('.trip-link');
  if (link && app.q) addRecent(app.q);
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'fav': {
      const on = !app.favs.has(d.bus);
      on ? app.favs.add(d.bus) : app.favs.delete(d.bus);
      saveFavs();
      if (parseHash()[0] === 'favorites') render();
      else document.querySelectorAll(`[data-action="fav"][data-bus="${CSS.escape(d.bus)}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      toast(on ? t('fav.added') : t('fav.removed'));
      break;
    }
    case 'call': {
      if (d.demo === '1') {
        const ok = await confirmDialog({ title: t('demoCall.title'), body: t('demoCall.body'), ok: t('call'), cancel: t('cancel') });
        if (!ok) return;
      }
      callNumber(d.num);
      break;
    }
    case 'copy': toast((await copyPhone(d.num)) ? t('copied') : t('copyFail')); break;
    case 'retry': load(); break;
    case 'go-search': location.hash = '#/search'; break;
    case 'reset-filters': app.filters = {}; render(); break;
    case 'recent': app.q = d.q; location.hash = '#/search'; break;
    case 'clear-recents':
      app.recents = []; store.del('bt_recents'); render(); toast(t('cleared')); break;
    case 'clear-favs':
      if (await confirmDialog({ title: t('settings.clearFavs'), body: t('settings.confirmClear'), ok: t('ok'), cancel: t('cancel'), danger: true })) {
        app.favs.clear(); saveFavs(); toast(t('cleared'));
      }
      break;
  }
});

let debounce;
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.matches('[data-q]')) {
    app.q = el.value;
    clearTimeout(debounce);
    debounce = setTimeout(refreshResults, 150);
  } else if (el.matches('[data-filter]')) {
    app.filters[el.dataset.filter] = el.value || undefined;
    refreshResults();
  }
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.matches('[data-q]')) addRecent(el.value); // fires on Enter / blur
  if (!el.matches('[data-setting]')) return;
  const k = el.dataset.setting;
  if (k === 'lang') { setLang(el.value); store.set('bt_lang', getLang()); applyLang(); }
  if (k === 'theme') { theme = el.value; store.set('bt_theme', theme); applyTheme(); }
  if (k === 'useLocal') { store.set(KEYS.useLocal, el.checked); load(); return; }
  render();
});
window.addEventListener('hashchange', () => render(true));
window.addEventListener('online', () => render());
window.addEventListener('offline', () => render());

applyTheme();
applyLang();
load();
