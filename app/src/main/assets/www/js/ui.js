// Tiny shared UI helpers: toast + modal confirm (own dialog; WebView has no window.confirm).
import { esc } from './util.js';

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2800);
}

export function confirmDialog({ title, body, ok, cancel, danger = false }) {
  return new Promise((resolve) => {
    const d = document.getElementById('dlg');
    d.innerHTML = `<div class="dlg"><h2>${esc(title)}</h2><p>${esc(body)}</p>
      <div class="row"><button type="button" class="btn ghost" data-v="cancel">${esc(cancel)}</button>
      <button type="button" class="btn ${danger ? 'danger' : ''}" data-v="ok">${esc(ok)}</button></div></div>`;
    d.querySelectorAll('button').forEach((b) => { b.onclick = () => d.close(b.dataset.v); });
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.returnValue = '';
    d.showModal();
  });
}
