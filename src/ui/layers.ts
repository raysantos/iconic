// Left panel: artboards list and layers list (rename, lock, hide, drag to reorder).
import * as A from '../actions';
import { fitArtboard, setHover } from '../canvas';
import { icon } from '../icons';
import { TYPE_LABEL, type Shape } from '../model';
import { pretty } from '../shortcuts';
import { artboards, byId, checkpoint, commit, discardIfUnchanged, emit, setActiveArtboard, shapes, state } from '../store';
import { q, h, escapeHtml } from './dom';
import { renderAssets } from './assets';

export const left = q('#leftPanel');
left.innerHTML = `
  <div class="panel-header tabs" role="tablist">
    <button role="tab" class="tab on" data-tab="layers" aria-selected="true">Layers</button>
    <button role="tab" class="tab" data-tab="assets" aria-selected="false">Assets</button>
    <button class="sheet-close" data-close="left" aria-label="Close">×</button>
  </div>
  <div class="tab-body" data-body="layers">
    <div class="panel-header sub first"><span class="panel-title">Artboards</span>
      <button class="icon-btn" data-ab-act="add" title="New artboard (next grid cell)">${icon('plus', 14)}</button>
    </div>
    <ul class="ab-list" aria-label="Artboards"></ul>
    <div class="panel-header sub"><span class="panel-title">Layers</span></div>
    <ul class="layer-list" role="tree" aria-label="Layers"></ul>
  </div>
  <div class="tab-body assets" data-body="assets" hidden>
    <div class="panel-header sub first"><span class="panel-title">Components</span></div>
    <div class="asset-grid comp-grid"></div>
    <div class="panel-header sub"><span class="panel-title">Badges</span><span class="badge-style"></span></div>
    <div class="asset-grid badge-grid"></div>
    <p class="d-hint asset-hint">Click a badge to add it to the corner of the current icon, with a knockout gap.</p>
    <div class="asset-actions"><button class="secondary-btn" data-variants>Make variants…</button></div>
  </div>`;

left.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) =>
  t.addEventListener('click', () => {
    for (const x of left.querySelectorAll<HTMLElement>('[data-tab]')) {
      const on = x === t;
      x.classList.toggle('on', on);
      x.setAttribute('aria-selected', String(on));
    }
    for (const b of left.querySelectorAll<HTMLElement>('[data-body]')) b.hidden = b.dataset.body !== t.dataset.tab;
    renderAssets();
  }),
);
export const layerList = q<HTMLUListElement>('.layer-list', left);
export const abList = q<HTMLUListElement>('.ab-list', left);

// ---- Artboards list (like Illustrator's Artboards panel) ----------------

export function renderArtboards() {
  if (abList.querySelector('input')) return; // renaming
  abList.innerHTML = artboards()
    .map((ab) => {
      const on = ab.id === state.activeArtboard;
      const cls = ['layer-row ab-row', on && 'active', on && state.artboardSelected && 'selected'].filter(Boolean).join(' ');
      return `<li class="${cls}" data-ab="${ab.id}">
        <span class="layer-icon${ab.component ? ' is-component' : ''}">${icon(ab.component ? 'component' : 'artboard', 14)}</span>
        <span class="layer-name">${escapeHtml(ab.name)}</span>
        <span class="ab-size">${ab.w}×${ab.h}</span>
        <button class="row-btn" data-ab-act="dup" title="Duplicate artboard with artwork">${icon('copy', 14)}</button>
        <button class="row-btn" data-ab-act="del" title="Delete artboard (artwork stays)" ${artboards().length < 2 ? 'disabled' : ''}>${icon('trash', 14)}</button>
      </li>`;
    })
    .join('');
}

left.addEventListener('click', (e) => {
  const t = e.target as Element;
  const act = t.closest<HTMLElement>('[data-ab-act]')?.dataset.abAct;
  const id = t.closest<HTMLElement>('[data-ab]')?.dataset.ab;
  if (act === 'add') return void (A.addArtboard(), fitArtboard());
  if (!id) return;
  if (act === 'dup') return void (A.duplicateArtboard(id), fitArtboard());
  if (act === 'del') return void A.deleteArtboard(id);
  setActiveArtboard(id, true);
  emit();
  fitArtboard();
});

abList.addEventListener('dblclick', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('[data-ab]');
  const ab = row && artboards().find((a) => a.id === row.dataset.ab);
  if (!row || !ab || (e.target as Element).closest('[data-ab-act]')) return;
  const input = h('input', { class: 'layer-rename', value: ab.name });
  q('.layer-name', row).replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const end = (save: boolean) => {
    if (done) return;
    done = true;
    input.remove();
    if (save) A.renameArtboard(ab.id, input.value);
    renderArtboards();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') end(true);
    if (ev.key === 'Escape') end(false);
  });
  input.addEventListener('blur', () => end(true));
});
export let renamingId: string | null = null;

export const TYPE_ICON: Record<Shape['type'], string> = { rect: 'rect', ellipse: 'ellipse', line: 'line', path: 'pencil', bezier: 'path', boolean: 'union', instance: 'component' };

// Rebuilding every row was most of a click's cost in big files, so the rows are
// only replaced when they change; a new selection just moves the highlight.
export let layersHtml = '';

export function renderLayers() {
  if (renamingId) return; // don't steal focus from the rename field
  if (!shapes().length) {
    layerList.innerHTML = `<li class="layers-empty">Pick a tool and draw on the artboard.<br>Press <kbd>${pretty('Ctrl+/')}</kbd> for shortcuts.</li>`;
    layersHtml = '';
    return;
  }
  // Topmost first; shapes inside boolean groups are indented under them.
  const rows = (list: Shape[], depth: number): string[] =>
    [...list].reverse().flatMap((s) => [row(s, depth), ...(s.type === 'boolean' ? rows(s.children, depth + 1) : [])]);
  const html = rows(shapes(), 0).join('');
  if (html !== layersHtml) layerList.innerHTML = layersHtml = html;
  const sel = new Set(state.selection);
  for (const li of layerList.children as HTMLCollectionOf<HTMLElement>) {
    const on = sel.has(li.dataset.id!);
    li.classList.toggle('selected', on);
    li.setAttribute('aria-selected', String(on));
  }
}

export function row(s: Shape, depth: number) {
  const cls = ['layer-row', s.hidden && 'is-hidden', s.locked && 'is-locked'].filter(Boolean).join(' ');
  const ic = s.type === 'boolean' ? s.op : TYPE_ICON[s.type];
  return `<li class="${cls}" data-id="${s.id}" data-depth="${depth}" style="padding-left:${16 + depth * 16}px" role="treeitem" aria-level="${depth + 1}">
    <span class="layer-icon">${icon(ic, 14)}</span>
    <span class="layer-name">${escapeHtml(s.name ?? TYPE_LABEL[s.type])}</span>
    <button class="row-btn${s.locked ? ' on' : ''}" data-act="lock" title="${s.locked ? 'Unlock' : 'Lock'} (${pretty('Ctrl+2')})">${icon(s.locked ? 'lock' : 'unlock', 14)}</button>
    <button class="row-btn${s.hidden ? ' on' : ''}" data-act="eye" title="${s.hidden ? 'Show' : 'Hide'} (${pretty('Ctrl+3')})">${icon(s.hidden ? 'eyeOff' : 'eye', 14)}</button>
  </li>`;
}

layerList.addEventListener('click', (e) => {
  if (dragJustEnded) return;
  const row = (e.target as Element).closest<HTMLElement>('.layer-row');
  if (!row) return;
  const id = row.dataset.id!;
  const s = byId(id)!;
  const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act) {
    checkpoint();
    if (act === 'lock') s.locked = !s.locked;
    else s.hidden = !s.hidden;
    if (s.locked || s.hidden) state.selection = state.selection.filter((x) => x !== id);
    return commit();
  }
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    state.selection = state.selection.includes(id) ? state.selection.filter((x) => x !== id) : [...state.selection, id];
  } else {
    state.selection = [id];
  }
  emit();
});

layerList.addEventListener('dblclick', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('.layer-row');
  if (!row || (e.target as Element).closest('[data-act]')) return;
  const s = byId(row.dataset.id!)!;
  renamingId = s.id;
  layersHtml = ''; // the row is edited in place, so rebuild it afterwards
  const input = h('input', { class: 'layer-rename', value: s.name ?? TYPE_LABEL[s.type] });
  q('.layer-name', row).replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const end = (save: boolean) => {
    if (done) return;
    done = true;
    renamingId = null;
    const name = input.value.trim();
    if (save && name && name !== s.name) {
      checkpoint();
      s.name = name;
    }
    commit();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') end(true);
    if (ev.key === 'Escape') end(false);
  });
  input.addEventListener('blur', () => end(true));
});

layerList.addEventListener('pointerover', (e) => setHover((e.target as Element).closest<HTMLElement>('.layer-row')?.dataset.id ?? null));
layerList.addEventListener('pointerleave', () => setHover(null));

// Drag rows to reorder (mouse: after a small move; touch: after a short hold).
export let rowDrag: { id: string; startY: number; active: boolean; timer?: number; pointerId: number } | null = null;
export let dragJustEnded = false;
export const indicator = h('div', { class: 'drop-indicator' });

layerList.addEventListener('pointerdown', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('.layer-row');
  if (!row || row.dataset.depth !== '0' || (e.target as Element).closest('[data-act], input')) return;
  rowDrag = { id: row.dataset.id!, startY: e.clientY, active: false, pointerId: e.pointerId };
  if (e.pointerType === 'touch') {
    rowDrag.timer = window.setTimeout(() => rowDrag && startRowDrag(), 350);
  }
});

export function startRowDrag() {
  if (!rowDrag) return;
  rowDrag.active = true;
  layerList.setPointerCapture(rowDrag.pointerId);
  layerList.classList.add('dragging');
  left.append(indicator);
}

layerList.addEventListener('pointermove', (e) => {
  if (!rowDrag) return;
  if (!rowDrag.active) {
    if (Math.abs(e.clientY - rowDrag.startY) < 4) return;
    if (e.pointerType === 'touch') {
      clearTimeout(rowDrag.timer); // moved before the hold: it's a scroll
      rowDrag = null;
      return;
    }
    startRowDrag();
  }
  e.preventDefault();
  const { slot, y } = dropSlot(e.clientY);
  indicator.style.top = `${y - left.getBoundingClientRect().top + left.scrollTop}px`;
  indicator.dataset.slot = String(slot);
});

export function dropSlot(clientY: number) {
  const rows = [...layerList.querySelectorAll<HTMLElement>('.layer-row[data-depth="0"]')];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { slot: i, y: r.top };
  }
  const last = rows[rows.length - 1].getBoundingClientRect();
  return { slot: rows.length, y: last.bottom };
}

export function endRowDrag(e: PointerEvent) {
  if (!rowDrag) return;
  clearTimeout(rowDrag.timer);
  const d = rowDrag;
  rowDrag = null;
  if (!d.active) return;
  layerList.classList.remove('dragging');
  indicator.remove();
  dragJustEnded = true;
  setTimeout(() => (dragJustEnded = false));
  const { slot } = dropSlot(e.clientY);
  // Rows are shown top-first; the shapes array is bottom-first.
  const list = shapes();
  const from = list.findIndex((s) => s.id === d.id);
  const rowsCount = list.length;
  let to = rowsCount - slot; // array index the shape should end up before
  checkpoint();
  const [moved] = list.splice(from, 1);
  if (from < to) to--;
  list.splice(Math.max(0, Math.min(list.length, to)), 0, moved);
  state.selection = [d.id];
  discardIfUnchanged();
  commit();
}
layerList.addEventListener('pointerup', endRowDrag);
layerList.addEventListener('pointercancel', endRowDrag);
