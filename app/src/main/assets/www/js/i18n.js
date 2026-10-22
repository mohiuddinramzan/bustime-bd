// Language helpers: strings, Bengali digits, 12-hour time with Bengali day-parts, dates, durations.
import { STRINGS } from './strings.js';
import { toBnDigits, DAY_ORDER } from './util.js';

let lang = 'bn';
export const setLang = (l) => { lang = l === 'en' ? 'en' : 'bn'; };
export const getLang = () => lang;
export const num = (v) => (lang === 'bn' ? toBnDigits(v) : String(v));

export function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (typeof vars[k] === 'number' ? num(vars[k]) : vars[k] ?? ''));
  return s;
}

/** pick(obj,'name') -> obj.name_bn / obj.name_en in the current language, falling back to the other. */
export function pick(o, base) {
  const other = lang === 'bn' ? 'en' : 'bn';
  return o?.[`${base}_${lang}`] || o?.[`${base}_${other}`] || '';
}
/** loc({bn,en}) */
export const loc = (o) => o?.[lang] || o?.bn || o?.en || '';

export function timeParts(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  const h12 = h % 12 || 12;
  if (lang === 'bn') {
    const period = h < 4 ? 'রাত' : h < 6 ? 'ভোর' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
    return { clock: toBnDigits(`${h12}:${mm}`), period };
  }
  return { clock: `${h12}:${mm}`, period: h < 12 ? 'AM' : 'PM' };
}
export function formatTime(hhmm) {
  const p = timeParts(hhmm);
  return lang === 'bn' ? `${p.period} ${p.clock}` : `${p.clock} ${p.period}`;
}

export function formatDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (lang === 'bn') return 'প্রায় ' + [h ? `${num(h)} ঘণ্টা` : '', m ? `${num(m)} মিনিট` : ''].filter(Boolean).join(' ');
  return 'about ' + [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

const MONTH = {
  bn: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '—';
  return `${num(+m[3])} ${MONTH[lang][+m[2] - 1]} ${num(m[1])}`;
}

export function dayLabel(days) {
  if (days.length === 7) return t('days.daily');
  if (days.length === 6) return t('days.except', { day: t('day.' + DAY_ORDER.find((d) => !days.includes(d))) });
  return DAY_ORDER.filter((d) => days.includes(d)).map((d) => t('day.' + d)).join(', ');
}
