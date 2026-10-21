// Small DOM helpers and the toast.

export const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string; html?: string } = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, html, ...rest } = props;
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const toastEl = q('#toast');
export let toastTimer = 0;
export function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), Math.max(1600, msg.length * 55)); // long hints stay up to be read
}
