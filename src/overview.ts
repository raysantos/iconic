// Overview grid (like FontLab's font window): every icon at a glance with its
// name, size and status; click one to jump to it.
import { auditShape } from './audit';
import { fitArtboard } from './canvas';
import { center, intersects, worldBox } from './geometry';
import { AXIS_LABEL, locSuffix } from './masters';
import { SVG_NS } from './model';
import { allShapes, artboardById, artboards, emit, inside, setActiveArtboard, shapes, state, subscribe } from './store';
import { el, renderShapes } from './svg';

const viewport = document.querySelector<HTMLElement>('.viewport')!;
const panel = document.createElement('div');
panel.className = 'overview';
panel.hidden = true;
panel.setAttribute('role', 'dialog');
panel.setAttribute('aria-label', 'All icons');
panel.innerHTML = `
  <div class="ov-bar">
    <strong>All icons</strong><span class="ov-count"></span>
    <input class="ov-search" type="search" placeholder="Search names" aria-label="Search icons" spellcheck="false">
    <button class="ov-close" aria-label="Close overview" title="Close (Esc)">×</button>
  </div>
  <div class="ov-grid"></div>`;
viewport.append(panel);

const grid = panel.querySelector<HTMLElement>('.ov-grid')!;
const search = panel.querySelector<HTMLInputElement>('.ov-search')!;

export function toggleOverview(open = panel.hidden) {
  panel.hidden = !open;
  document.body.classList.toggle('overview-open', open);
  if (open) {
    render();
    search.focus();
  }
}

function thumb(ab: { x: number; y: number; w: number; h: number }) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `${ab.x} ${ab.y} ${ab.w} ${ab.h}`);
  svg.setAttribute('class', 'ov-thumb');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(el('rect', { x: ab.x, y: ab.y, width: ab.w, height: ab.h, fill: '#fff' }));
  svg.append(...renderShapes(shapes().filter((s) => !s.hidden && intersects(worldBox(s), ab))));
  return svg;
}

function render() {
  if (panel.hidden) return;
  const q = search.value.trim().toLowerCase();
  const list = artboards().filter((a) => !q || a.name.toLowerCase().includes(q));
  panel.querySelector('.ov-count')!.textContent = `${list.length}${q ? ` of ${artboards().length}` : ''}`;
  grid.replaceChildren(
    ...list.map((ab) => {
      const on = shapes().filter((s) => inside(ab, center(worldBox(s))));
      const issues = on.flatMap((s) => allShapes([s])).reduce((n, s) => n + auditShape(s).length, 0);
      const linked = on.some((s) => s.type === 'instance' && !s.ref.startsWith('badge:'));
      const master = ab.masterOf ? artboardById(ab.masterOf)?.variations?.masters.find((m) => m.id === ab.id) : undefined;
      const card = document.createElement('button');
      card.className = 'ov-card' + (ab.id === state.activeArtboard ? ' active' : '');
      card.title = `Go to ${ab.name}`;
      const chips = [
        ab.component ? '<span class="chip component">Component</span>' : '',
        linked ? '<span class="chip linked">Linked</span>' : '',
        issues ? `<span class="chip issues">${issues} issue${issues > 1 ? 's' : ''}</span>` : '',
        ab.variations ? '<span class="chip linked">Base</span>' : '',
        master ? `<span class="chip linked">${AXIS_LABEL[master.axis]} master</span>` : '',
        ab.generated ? `<span class="chip">${locSuffix(ab.generated.loc).replace(/_GRAD0_/, '_').replace(/_/g, ' ')}</span>` : '',
        !on.length ? '<span class="chip empty">Empty</span>' : '',
      ].join('');
      card.append(thumb(ab));
      const meta = document.createElement('div');
      meta.className = 'ov-meta';
      meta.innerHTML = `<span class="ov-name"></span><span class="ov-size">${ab.w}×${ab.h}</span><span class="ov-chips">${chips}</span>`;
      meta.querySelector('.ov-name')!.textContent = ab.name;
      card.append(meta);
      card.addEventListener('click', () => {
        setActiveArtboard(ab.id, true);
        toggleOverview(false);
        emit();
        fitArtboard();
      });
      return card;
    }),
  );
}

search.addEventListener('input', render);
panel.querySelector('.ov-close')!.addEventListener('click', () => toggleOverview(false));
panel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    toggleOverview(false);
  }
});
subscribe(() => render());
