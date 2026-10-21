// Menus and popovers (one open at a time).
import { icon } from '../icons';
import { pretty } from '../shortcuts';
import { h, escapeHtml } from './dom';

export interface MenuItem {
  label?: string;
  keys?: string;
  icon?: string;
  checked?: boolean;
  run?: () => void;
  sep?: boolean;
}

export let openPop: HTMLElement | null = null;

export function closePop() {
  openPop?.remove();
  openPop = null;
}

export function showPop(anchor: HTMLElement, content: HTMLElement, align: 'left' | 'right' = 'left') {
  closePop();
  const pop = h('div', { class: 'popover' }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  let left = align === 'left' ? r.left : r.right - pw;
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + 6}px`;
  openPop = pop;
}

export function menuList(items: MenuItem[]) {
  const ul = h('ul', { class: 'menu', role: 'menu' } as Partial<HTMLUListElement>);
  for (const it of items) {
    if (it.sep) {
      ul.append(h('li', { class: 'sep', role: 'separator' } as Partial<HTMLLIElement>));
      continue;
    }
    const li = h('li', {
      class: 'menu-item',
      role: 'menuitem',
      tabIndex: 0,
      html: `<span class="mi-check">${it.checked ? '✓' : ''}</span>${it.icon ? icon(it.icon, 16) : ''}<span class="mi-label">${escapeHtml(it.label!)}</span><span class="mi-keys">${it.keys ? pretty(it.keys) : ''}</span>`,
    } as Partial<HTMLLIElement>);
    const run = () => {
      closePop();
      it.run?.();
    };
    li.addEventListener('click', run);
    li.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    ul.append(li);
  }
  return ul;
}

document.addEventListener('pointerdown', (e) => {
  if (openPop && !openPop.contains(e.target as Node) && !(e.target as Element).closest('[data-menu],[data-flyout]')) closePop();
});
// Esc closes an open menu and stops there (it doesn't also deselect).
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !openPop) return;
    closePop();
    e.stopPropagation();
  },
  true,
);
