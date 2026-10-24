// Bridge to Android (window.BusTimeNative, see MainActivity.kt) with browser fallbacks.
import { toTel, formatPhone } from './util.js';

const N = typeof window !== 'undefined' ? window.BusTimeNative : undefined;

export function callNumber(raw) {
  const tel = toTel(raw);
  if (N && N.dial) return N.dial(tel);
  window.location.href = 'tel:' + tel; // intercepted by the WebView client -> dialer
  return true;
}

export async function copyText(text) {
  if (N && N.copyText && N.copyText(text)) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}
/** Opens the system share sheet (native bridge, then Web Share API, then clipboard). */
export async function shareText(text) {
  if (N && N.shareText) return !!N.shareText(text);
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ text }); return true; } catch { return false; }
  }
  return copyText(text);
}
export const copyPhone = (raw) => copyText(formatPhone(raw));

/** Returns a location string on success, '' on failure. */
export function saveJson(fileName, text) {
  if (N && N.saveText) return N.saveText(fileName, text) || '';
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = fileName;
    a.click();
    return fileName;
  } catch {
    return '';
  }
}
