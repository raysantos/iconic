// Panels: hide them (Tab) on desktop; slide-up sheets on phones.

export const mobile = matchMedia('(max-width: 767px)');

// Tab hides panels on desktop (Illustrator); on phones the panels are sheets.
export function togglePanels() {
  if (mobile.matches) {
    document.body.classList.remove('sheet-left', 'sheet-right');
    return;
  }
  document.body.classList.toggle('panels-hidden');
}

export function toggleSheet(which: 'left' | 'right') {
  const cls = `sheet-${which}`;
  const open = !document.body.classList.contains(cls);
  document.body.classList.remove('sheet-left', 'sheet-right');
  if (open) document.body.classList.add(cls);
}
document.addEventListener('click', (e) => {
  const close = (e.target as Element).closest<HTMLElement>('[data-close]');
  if (close) document.body.classList.remove(`sheet-${close.dataset.close}`);
});
