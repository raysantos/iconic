// Assets tab (components and badges) and the variant generator.
import * as A from '../actions';
import { fitAll } from '../canvas';
import { BADGES, resolveSource, type BadgeKey } from '../components';
import { renderShapes } from '../svg';
import { pretty } from '../shortcuts';
import { artboards, selected, state } from '../store';
import { q, h, toast } from './dom';
import { left } from './layers';
import { segmented, numField } from './controls';

export let badgeCircle = false;

// A small live preview of a component or badge.
export function thumb(ref: string): SVGSVGElement {
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const src = resolveSource(ref);
  if (src) {
    const b = src.box;
    const pad = Math.max(b.w, b.h) * 0.08;
    svgEl.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`);
    svgEl.append(...renderShapes(src.shapes));
  }
  svgEl.setAttribute('class', 'asset-thumb');
  svgEl.setAttribute('aria-hidden', 'true');
  return svgEl;
}

export function renderAssets() {
  const body = q<HTMLElement>('[data-body="assets"]', left);
  if (body.hidden) return;
  const comps = artboards().filter((a) => a.component);
  const cg = q('.comp-grid', body);
  cg.replaceChildren(
    ...(comps.length
      ? comps.map((a) => {
          const b = h('button', { class: 'asset-tile', title: `Place ${a.name} in the current icon` }, thumb(a.id), h('span', { textContent: a.name }));
          b.addEventListener('click', () => {
            if (!A.placeComponent(a.id)) toast('Pick a different artboard first — a component can’t contain itself');
          });
          return b;
        })
      : [h('p', { class: 'd-hint', textContent: `Turn an artboard into a component (Design panel or ${pretty('Ctrl+Alt+K')}) to reuse it in other icons.` })]),
  );
  q('.badge-style', body).replaceChildren(
    segmented<string>(
      [
        ['bare', 'Bare'],
        ['circle', 'Circle'],
      ],
      badgeCircle ? 'circle' : 'bare',
      (v) => {
        badgeCircle = v === 'circle';
        renderAssets();
      },
    ),
  );
  q('.badge-grid', body).replaceChildren(
    ...BADGES.map((bd) => {
      const ref = `badge:${bd.key}${badgeCircle ? '_circle' : ''}`;
      const b = h('button', { class: 'asset-tile badge', title: `${bd.label} badge` }, thumb(ref), h('span', { textContent: bd.label }));
      b.addEventListener('click', () => {
        // With a badge selected, swap it; otherwise add one to the active icon.
        const sel = selected();
        if (sel.length && sel.every((x) => x.type === 'instance' && x.ref.startsWith('badge:'))) A.swapBadge(bd.key, badgeCircle);
        else A.placeBadge(bd.key, badgeCircle);
      });
      return b;
    }),
  );
}

left.addEventListener('click', (e) => {
  if ((e.target as Element).closest('[data-variants]')) openVariants();
});

// ---- Variant generator ------------------------------------------------------------

export function openVariants() {
  const dlg = q<HTMLDialogElement>('#reviewDialog');
  const bases = new Set(artboards().filter((a) => a.component || a.id === state.activeArtboard).map((a) => a.id));
  const keys = new Set<BadgeKey>(['plus', 'minus']);
  let circle = badgeCircle;
  let gap = A.BADGE_GAP;

  const baseList = h('div', { class: 'pick-list' });
  for (const a of artboards()) {
    const cb = h('input', { type: 'checkbox', checked: bases.has(a.id) });
    cb.addEventListener('change', () => (cb.checked ? bases.add(a.id) : bases.delete(a.id), update()));
    baseList.append(h('label', { class: 'pick' }, cb, thumb(a.id), h('span', { textContent: a.name })));
  }
  const badgeList = h('div', { class: 'pick-list badges' });
  const drawBadges = () => {
    badgeList.replaceChildren(
      ...BADGES.map((bd) => {
        const cb = h('input', { type: 'checkbox', checked: keys.has(bd.key) });
        cb.addEventListener('change', () => (cb.checked ? keys.add(bd.key) : keys.delete(bd.key), update()));
        return h('label', { class: 'pick' }, cb, thumb(`badge:${bd.key}${circle ? '_circle' : ''}`), h('span', { textContent: `${bd.label} → _${bd.suffix}` }));
      }),
    );
  };
  drawBadges();
  const style = segmented<string>(
    [
      ['bare', 'Bare'],
      ['circle', 'Circle'],
    ],
    circle ? 'circle' : 'bare',
    (v) => {
      circle = v === 'circle';
      style.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === (circle ? 'Circle' : 'Bare')));
      drawBadges();
      update();
    },
  );
  const gapField = numField({ label: 'Gap', value: gap, min: 0, step: 0.25, wide: true, onCommit: (v) => (gap = v) });
  const create = h('button', { class: 'primary-btn' });
  const cancel = h('button', { class: 'secondary-btn', textContent: 'Cancel' });
  function update() {
    const n = bases.size * keys.size;
    create.textContent = n ? `Create ${n} variant${n > 1 ? 's' : ''}` : 'Create variants';
    create.disabled = !n;
  }
  update();
  create.addEventListener('click', () => {
    const made = A.generateVariants([...bases], [...keys], circle, gap);
    dlg.close();
    if (made.length) {
      fitAll();
      toast(`Created ${made.length} linked variant${made.length > 1 ? 's' : ''} — edit the base and they all update`);
    }
  });
  cancel.addEventListener('click', () => dlg.close());
  dlg.replaceChildren(
    h('h2', { textContent: 'Make variants' }),
    h('p', { class: 'd-hint', textContent: 'Each base icon gets a copy with each badge in the corner, cut out with a knockout gap. Bases become components, so the variants stay linked.' }),
    h('h3', { class: 'd-subtitle', textContent: 'Base icons' }),
    baseList,
    h('div', { class: 'd-row' }, h('h3', { class: 'd-subtitle', textContent: 'Badges' }), style),
    badgeList,
    h('div', { class: 'd-grid gap-row' }, gapField),
    h('div', { class: 'dialog-actions' }, cancel, create),
  );
  dlg.showModal();
}
