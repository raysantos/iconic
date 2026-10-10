// Figma-style chrome: top bar, Layers panel, Design panel, menus, dialogs.
import * as A from './actions';
import { actualSize, finishPen, fitAll, fitArtboard, fitSelection, onViewChange, setCursor, setHover, viewState, zoomAt, zoomTo } from './canvas';
import { checkSinglePath, DENSITIES, exportArtboards, fileBase, type ExportFormat, type ExportIssue } from './export';
import { openColorPicker } from './colorpicker';
import { icon } from './icons';
import { BOOL_LABEL, ICON_SIZES, TYPE_LABEL, type BoolOp, type Cap, type IconStyle, type Join, type Shape, type Tool } from './model';
import { installShortcuts, keyFor, pretty, SHORTCUTS } from './shortcuts';
import { activeArtboard, allShapes, artboards, byId, checkpoint, commit, discardIfUnchanged, emit, redo, savePrefs, selected, setActiveArtboard, shapes, state, subscribe, undo } from './store';

const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string; html?: string } = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, html, ...rest } = props;
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---- Tools -------------------------------------------------------------

const TOOLS: Record<Tool, { label: string; key: string; icon: string }> = {
  select: { label: 'Selection', key: 'Selection', icon: 'select' },
  artboard: { label: 'Artboard', key: 'Artboard', icon: 'artboard' },
  direct: { label: 'Direct Selection', key: 'Direct Selection', icon: 'direct' },
  rect: { label: 'Rectangle', key: 'Rectangle', icon: 'rect' },
  ellipse: { label: 'Ellipse', key: 'Ellipse', icon: 'ellipse' },
  line: { label: 'Line Segment', key: 'Line Segment', icon: 'line' },
  pen: { label: 'Pen', key: 'Pen', icon: 'pen' },
  addAnchor: { label: 'Add Anchor Point', key: 'Add Anchor Point', icon: 'addAnchor' },
  deleteAnchor: { label: 'Delete Anchor Point', key: 'Delete Anchor Point', icon: 'deleteAnchor' },
  convertAnchor: { label: 'Anchor Point', key: 'Anchor Point (convert)', icon: 'convertAnchor' },
  pencil: { label: 'Pencil', key: 'Pencil', icon: 'pencil' },
  hand: { label: 'Hand', key: 'Hand', icon: 'hand' },
  zoom: { label: 'Zoom', key: 'Zoom (Alt-click to zoom out)', icon: 'zoom' },
};

const GROUPS: Tool[][] = [['select', 'direct'], ['artboard'], ['rect', 'ellipse', 'line'], ['pen', 'addAnchor', 'deleteAnchor', 'convertAnchor'], ['pencil'], ['hand', 'zoom']];
const groupShown = GROUPS.map((g) => g[0]);

const tip = (t: Tool) => `${TOOLS[t].label} (${keyFor(TOOLS[t].key)})`;

export function setTool(t: Tool) {
  if (state.tool === 'pen' && t !== 'pen') finishPen(false);
  state.tool = t;
  if (t !== 'direct') state.anchors = [];
  const gi = GROUPS.findIndex((g) => g.includes(t));
  if (gi >= 0) groupShown[gi] = t;
  setCursor();
  renderTools();
  emit();
}

const topbar = q('#topbar');

function buildTopbar() {
  topbar.innerHTML = `
    <div class="tb-left">
      <button class="tb-btn menu-btn" data-menu="main" title="Main menu">${icon('logo', 22)}${icon('chevron', 12)}</button>
      <div class="tools" role="toolbar" aria-label="Tools"></div>
    </div>
    <div class="tb-center">
      <input class="doc-name" aria-label="Icon name" spellcheck="false" />
      <span class="doc-meta"></span>
    </div>
    <div class="tb-right">
      <button class="tb-btn sheet-btn" data-sheet="left" title="Layers">${icon('layers', 18)}</button>
      <button class="tb-btn sheet-btn" data-sheet="right" title="Design">${icon('design', 18)}</button>
      <button class="zoom-btn" data-menu="zoom" title="Zoom"><span class="zoom-val"></span>${icon('chevron', 12)}</button>
      <button class="export-btn" data-menu="export" title="Export (${pretty('Ctrl+Shift+E')})">Export</button>
    </div>`;

  const name = q<HTMLInputElement>('.doc-name', topbar);
  name.addEventListener('change', () => A.renameDoc(name.value));
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Escape') name.value = state.doc.name;
      name.blur();
    }
  });

  topbar.addEventListener('click', (e) => {
    const t = e.target as Element;
    const toolBtn = t.closest<HTMLElement>('[data-tool]');
    if (toolBtn) return setTool(toolBtn.dataset.tool as Tool);
    const flyout = t.closest<HTMLElement>('[data-flyout]');
    if (flyout) return openFlyout(flyout, Number(flyout.dataset.flyout));
    const menu = t.closest<HTMLElement>('[data-menu]');
    if (menu) return openMenu(menu, menu.dataset.menu!);
    const sheet = t.closest<HTMLElement>('[data-sheet]');
    if (sheet) toggleSheet(sheet.dataset.sheet as 'left' | 'right');
  });
  renderTools();
}

function renderTools() {
  const tools = q('.tools', topbar);
  tools.innerHTML = GROUPS.map((g, i) => {
    const shown = groupShown[i];
    const active = g.includes(state.tool);
    return `<div class="tool-group${active ? ' active' : ''}">
      <button class="tb-btn tool" data-tool="${shown}" title="${tip(shown)}" aria-pressed="${active}">${icon(TOOLS[shown].icon, 18)}</button>
      ${g.length > 1 ? `<button class="caret" data-flyout="${i}" title="More tools">${icon('chevron', 10)}</button>` : ''}
    </div>`;
  }).join('');
}

function updateTopbar() {
  const name = q<HTMLInputElement>('.doc-name', topbar);
  if (document.activeElement !== name) name.value = state.doc.name;
  const ab = activeArtboard();
  q('.doc-meta', topbar).textContent = `${ab.name} · ${ab.w} × ${ab.h}`;
}

const updateZoomLabel = () => (q('.zoom-val', topbar).textContent = `${Math.round(viewState.zoom * 100)}%`);

// ---- Menus & popovers ------------------------------------------------------

interface MenuItem {
  label?: string;
  keys?: string;
  icon?: string;
  checked?: boolean;
  run?: () => void;
  sep?: boolean;
}

let openPop: HTMLElement | null = null;

function closePop() {
  openPop?.remove();
  openPop = null;
}

function showPop(anchor: HTMLElement, content: HTMLElement, align: 'left' | 'right' = 'left') {
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

function menuList(items: MenuItem[]) {
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

function openFlyout(anchor: HTMLElement, gi: number) {
  const items = GROUPS[gi].map((t) => ({ label: TOOLS[t].label, keys: keyFor(TOOLS[t].key), icon: TOOLS[t].icon, checked: state.tool === t, run: () => setTool(t) }));
  showPop(anchor.parentElement!, menuList(items));
}

function togglePref(key: 'grid' | 'snap' | 'keylines' | 'smartGuides' | 'mergedPreview') {
  state.prefs[key] = !state.prefs[key];
  savePrefs();
  commit();
}

function openMenu(anchor: HTMLElement, which: string) {
  if (openPop && openPop.dataset.for === which) return closePop();
  if (which === 'main') {
    showPop(
      anchor,
      menuList([
        { label: 'New icon', keys: 'Ctrl+Alt+N', run: A.newDoc },
        { sep: true },
        { label: 'Undo', keys: 'Ctrl+Z', run: undo },
        { label: 'Redo', keys: 'Ctrl+Shift+Z', run: redo },
        { sep: true },
        { label: 'Select all', keys: 'Ctrl+A', run: A.selectAll },
        { label: 'Unlock all', keys: 'Ctrl+Alt+2', run: A.unlockAll },
        { label: 'Show all', keys: 'Ctrl+Alt+3', run: A.showAll },
        { sep: true },
        { label: 'New artboard', run: () => A.addArtboard() },
        { label: 'Arrange artboards', run: () => A.arrangeArtboards() },
        { sep: true },
        { label: 'Pixel grid', keys: "Ctrl+'", checked: state.prefs.grid, run: () => togglePref('grid') },
        { label: 'Merged preview (export)', keys: 'Ctrl+Y', checked: state.prefs.mergedPreview, run: () => togglePref('mergedPreview') },
        { label: 'Material keylines', keys: 'Ctrl+;', checked: state.prefs.keylines, run: () => togglePref('keylines') },
        { label: 'Smart guides', keys: 'Ctrl+U', checked: state.prefs.smartGuides, run: () => togglePref('smartGuides') },
        { label: 'Snap to grid', keys: "Ctrl+Shift+'", checked: state.prefs.snap, run: () => togglePref('snap') },
        { label: 'Hide panels', keys: 'Tab', run: togglePanels },
        { sep: true },
        { label: 'Export…', keys: 'Ctrl+Shift+E', run: openExport },
        { label: 'Keyboard shortcuts', keys: 'Ctrl+/', run: openHelp },
      ]),
    );
  } else if (which === 'zoom') {
    showPop(
      anchor,
      menuList([
        { label: 'Zoom in', keys: 'Ctrl+=', run: () => zoomAt(2) },
        { label: 'Zoom out', keys: 'Ctrl+-', run: () => zoomAt(0.5) },
        { label: 'Zoom to artboard', keys: 'Ctrl+0', run: fitArtboard },
        { label: 'Fit all artboards', keys: 'Ctrl+Alt+0', run: fitAll },
        { label: 'Zoom to selection', keys: 'Shift+2', run: fitSelection },
        { label: 'Actual size (100%)', keys: 'Ctrl+1', run: actualSize },
        { sep: true },
        ...[800, 1600, 3200].map((p) => ({ label: `${p}%`, run: () => zoomAt(p / 100 / viewState.zoom) })),
      ]),
      'right',
    );
  } else if (which === 'export') {
    showPop(anchor, h('div', { class: 'export-pop' }, exportControls()), 'right');
  }
  if (openPop) openPop.dataset.for = which;
}

document.addEventListener('pointerdown', (e) => {
  if (openPop && !openPop.contains(e.target as Node) && !(e.target as Element).closest('[data-menu],[data-flyout]')) closePop();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closePop());

function openExport() {
  openMenu(q('.export-btn', topbar), 'export');
}

// ---- Layers panel ----------------------------------------------------------

const left = q('#leftPanel');
left.innerHTML = `
  <div class="panel-header"><span class="panel-title">Artboards</span>
    <span class="header-actions">
      <button class="icon-btn" data-ab-act="add" title="New artboard (next grid cell)">${icon('plus', 14)}</button>
      <button class="sheet-close" data-close="left" aria-label="Close">×</button>
    </span>
  </div>
  <ul class="ab-list" aria-label="Artboards"></ul>
  <div class="panel-header sub"><span class="panel-title">Layers</span></div>
  <ul class="layer-list" role="tree" aria-label="Layers"></ul>`;
const layerList = q<HTMLUListElement>('.layer-list', left);
const abList = q<HTMLUListElement>('.ab-list', left);

// ---- Artboards list (like Illustrator's Artboards panel) ----------------

function renderArtboards() {
  if (abList.querySelector('input')) return; // renaming
  abList.innerHTML = artboards()
    .map((ab) => {
      const on = ab.id === state.activeArtboard;
      const cls = ['layer-row ab-row', on && 'active', on && state.artboardSelected && 'selected'].filter(Boolean).join(' ');
      return `<li class="${cls}" data-ab="${ab.id}">
        <span class="layer-icon">${icon('artboard', 14)}</span>
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
let renamingId: string | null = null;

const TYPE_ICON: Record<Shape['type'], string> = { rect: 'rect', ellipse: 'ellipse', line: 'line', path: 'pencil', bezier: 'path', boolean: 'union' };

function renderLayers() {
  if (renamingId) return; // don't steal focus from the rename field
  if (!shapes().length) {
    layerList.innerHTML = `<li class="layers-empty">Pick a tool and draw on the artboard.<br>Press <kbd>${pretty('Ctrl+/')}</kbd> for shortcuts.</li>`;
    return;
  }
  // Topmost first; shapes inside boolean groups are indented under them.
  const rows = (list: Shape[], depth: number): string[] =>
    [...list].reverse().flatMap((s) => [row(s, depth), ...(s.type === 'boolean' ? rows(s.children, depth + 1) : [])]);
  layerList.innerHTML = rows(shapes(), 0).join('');
}

function row(s: Shape, depth: number) {
  const cls = ['layer-row', state.selection.includes(s.id) && 'selected', s.hidden && 'is-hidden', s.locked && 'is-locked'].filter(Boolean).join(' ');
  const ic = s.type === 'boolean' ? s.op : TYPE_ICON[s.type];
  return `<li class="${cls}" data-id="${s.id}" data-depth="${depth}" style="padding-left:${16 + depth * 16}px" role="treeitem" aria-level="${depth + 1}" aria-selected="${state.selection.includes(s.id)}">
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
let rowDrag: { id: string; startY: number; active: boolean; timer?: number; pointerId: number } | null = null;
let dragJustEnded = false;
const indicator = h('div', { class: 'drop-indicator' });

layerList.addEventListener('pointerdown', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('.layer-row');
  if (!row || row.dataset.depth !== '0' || (e.target as Element).closest('[data-act], input')) return;
  rowDrag = { id: row.dataset.id!, startY: e.clientY, active: false, pointerId: e.pointerId };
  if (e.pointerType === 'touch') {
    rowDrag.timer = window.setTimeout(() => rowDrag && startRowDrag(), 350);
  }
});

function startRowDrag() {
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

function dropSlot(clientY: number) {
  const rows = [...layerList.querySelectorAll<HTMLElement>('.layer-row[data-depth="0"]')];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { slot: i, y: r.top };
  }
  const last = rows[rows.length - 1].getBoundingClientRect();
  return { slot: rows.length, y: last.bottom };
}

function endRowDrag(e: PointerEvent) {
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

// ---- Design panel ----------------------------------------------------------

const right = q('#rightPanel');
right.innerHTML = `
  <div class="panel-header"><span class="panel-title">Design</span><button class="sheet-close" data-close="right" aria-label="Close">×</button></div>
  <div class="design-body"></div>`;
const designBody = q('.design-body', right);
let pendingDesign = false;

function renderDesign() {
  // Rebuilding while typing would steal focus; wait for the field to blur.
  const active = document.activeElement;
  if (active && designBody.contains(active) && active.tagName === 'INPUT' && (active as HTMLInputElement).type !== 'color') {
    pendingDesign = true;
    return;
  }
  pendingDesign = false;
  const sel = selected();
  designBody.replaceChildren(
    ...(sel.length ? [alignSection(), booleanSection(sel), layoutSection(sel)] : [artboardSection(), materialSection(), gridSection()]),
    fillSection(sel),
    strokeSection(sel),
    section('Export', exportControls()),
  );
}
designBody.addEventListener('focusout', () => setTimeout(() => pendingDesign && renderDesign()));

function section(title: string, ...kids: Node[]) {
  return h('section', { class: 'd-section' }, h('h3', { class: 'd-title' }, title), ...kids);
}

function segmented<T extends string | number>(opts: [T, string, string?][], current: T, pick: (v: T) => void) {
  const seg = h('div', { class: 'segmented', role: 'radiogroup' } as Partial<HTMLDivElement>);
  for (const [v, label, title] of opts) {
    const b = h('button', { class: v === current ? 'on' : '', textContent: label, title: title ?? label });
    b.addEventListener('click', () => pick(v));
    seg.append(b);
  }
  return seg;
}

const labeled = (label: string, control: Node, title = '') => h('div', { class: 'd-row', title }, h('span', { class: 'd-label', textContent: label }), control);

// The active artboard: name, position/size, Material icon size, and grid layout.
function artboardSection() {
  const ab = activeArtboard();
  const name = h('input', { class: 'text-input', value: ab.name, spellcheck: false, title: 'Material icon names are snake_case, e.g. arrow_back' });
  name.addEventListener('change', () => A.renameArtboard(ab.id, name.value));
  name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
  const field = (label: string, f: 'x' | 'y' | 'w' | 'h', min?: number) =>
    numField({
      label,
      value: ab[f],
      field: `ab:${f}`,
      min,
      onCommit: (v) => A.setArtboardGeometry(f, v),
      onScrub: (v) => A.setArtboardGeometry(f, v, { live: true }),
    });
  // Material's optical sizes; a square artboard of another size (e.g. 16 from an
  // older document) is shown too, so the current size is always visible.
  const custom = ab.w === ab.h && !ICON_SIZES.includes(ab.w) ? [ab.w] : [];
  const sizes = segmented(
    [...ICON_SIZES, ...custom]
      .sort((a, b) => a - b)
      .map((n) => [n, String(n), custom.includes(n) ? `Current size (${n} dp) — not a Material optical size` : `Scale icon to ${n} dp`] as [number, string, string]),
    ab.w === ab.h ? ab.w : -1,
    (n) => A.setIconSize(n),
  );

  const cols = numField({ label: 'Cols', value: state.prefs.abColumns, min: 1, wide: false, onCommit: (v) => A.arrangeArtboards(v, state.prefs.abGap) });
  const gap = numField({ label: 'Gap', value: state.prefs.abGap, min: 0, onCommit: (v) => A.arrangeArtboards(state.prefs.abColumns, v) });
  const arrange = h('button', { class: 'secondary-btn', textContent: 'Arrange all artboards', title: 'Lay out every artboard in a grid (artwork moves too)' });
  arrange.addEventListener('click', () => A.arrangeArtboards());

  return section(
    'Artboard',
    name,
    h('div', { class: 'd-grid' }, field('X', 'x'), field('Y', 'y'), field('W', 'w', 1), field('H', 'h', 1)),
    labeled('Icon size', sizes, 'Material Symbols optical sizes; scales the artwork'),
    h('h4', { class: 'd-subtitle', textContent: 'Artboard grid' }),
    h('div', { class: 'd-grid' }, cols, gap),
    arrange,
  );
}

function materialSection() {
  const style = segmented<IconStyle>(
    [
      ['outlined', 'Outlined'],
      ['rounded', 'Rounded'],
      ['sharp', 'Sharp'],
    ],
    A.iconStyle(),
    (s) => A.setIconStyle(s),
  );
  return section(
    'Material',
    labeled('Style', style, 'Sets line ends, corners and rectangle corner radius for every shape'),
    toggleRow('Keylines', 'Ctrl+;', state.prefs.keylines, () => togglePref('keylines')),
    toggleRow('Merged preview', 'Ctrl+Y', state.prefs.mergedPreview, () => togglePref('mergedPreview')),
  );
}

function gridSection() {
  const p = state.prefs;
  const setPref = <K extends 'gridSize' | 'snapTo'>(key: K, v: (typeof p)[K]) => {
    p[key] = v;
    savePrefs();
    commit();
  };
  return section(
    'Grid',
    toggleRow('Smart guides', 'Ctrl+U', p.smartGuides, () => togglePref('smartGuides')),
    toggleRow('Show grid', "Ctrl+'", p.grid, () => togglePref('grid')),
    labeled('Every', segmented([1, 2, 4, 8].map((n) => [n, n === 1 ? '1 px' : String(n), n === 1 ? 'Pixel grid only' : `Stronger line every ${n} px`] as [number, string, string]), p.gridSize, (n) => setPref('gridSize', n))),
    toggleRow('Snap', "Ctrl+Shift+'", p.snap, () => togglePref('snap')),
    labeled(
      'Snap to',
      segmented(
        [
          ['half', '½ px'],
          ['pixel', '1 px'],
          ['grid', 'Grid', `Every ${p.gridSize} px`],
        ],
        p.snapTo,
        (v) => setPref('snapTo', v),
      ),
    ),
  );
}

function toggleRow(label: string, keys: string, on: boolean, run: () => void) {
  const input = h('input', { type: 'checkbox', checked: on, class: 'switch' });
  input.addEventListener('change', run);
  return h('label', { class: 'd-row toggle', title: pretty(keys) }, h('span', { class: 'd-label', textContent: label }), input);
}

// Union / Subtract / Intersect / Exclude (non-destructive, like Figma).
function booleanSection(sel: Shape[]): Node {
  const g = sel.length === 1 && sel[0].type === 'boolean' ? sel[0] : null;
  if (!g && sel.length < 2) return h('span');
  const row = h('div', { class: 'align-row' });
  const ops: [BoolOp, string][] = [
    ['union', 'Ctrl+Alt+U'],
    ['subtract', 'Ctrl+Alt+S'],
    ['intersect', 'Ctrl+Alt+I'],
    ['exclude', 'Ctrl+Alt+X'],
  ];
  for (const [op, keys] of ops) {
    const b = h('button', { class: 'icon-btn' + (g?.op === op ? ' on' : ''), title: `${BOOL_LABEL[op]} (${pretty(keys)})`, html: icon(op, 18) });
    b.addEventListener('click', () => {
      const err = A.makeBoolean(op);
      if (err) toast(err);
    });
    row.append(b);
  }
  const kids: Node[] = [row];
  if (g) {
    const release = h('button', { class: 'secondary-btn', textContent: 'Release shapes', title: `Ungroup (${pretty('Ctrl+Shift+G')})` });
    release.addEventListener('click', () => A.releaseBoolean());
    kids.push(release, h('p', { class: 'd-hint', textContent: 'Shapes inside stay editable: double-click the result to select one.' }));
  }
  return section(g ? 'Boolean group' : 'Boolean', ...kids);
}

function alignSection() {
  const row = h('div', { class: 'align-row' });
  const items: [A.Align, string, string][] = [
    ['left', 'alignLeft', 'Align left'],
    ['hcenter', 'alignHCenter', 'Align horizontal centers'],
    ['right', 'alignRight', 'Align right'],
    ['top', 'alignTop', 'Align top'],
    ['vcenter', 'alignVCenter', 'Align vertical centers'],
    ['bottom', 'alignBottom', 'Align bottom'],
  ];
  const target = selected().length > 1 ? 'selection' : 'artboard';
  for (const [how, ic, label] of items) {
    const b = h('button', { class: 'icon-btn', title: `${label} (to ${target})`, html: icon(ic, 16) });
    b.addEventListener('click', () => A.align(how));
    row.append(b);
  }
  return h('section', { class: 'd-section' }, row);
}

function layoutSection(sel: Shape[]) {
  const box = A.selectionBox(sel)!;
  const rot = sel.length === 1 ? (sel[0].rotation ?? 0) : 0;
  const field = (label: string, f: A.GeoField, value: number, extra: Partial<NumOpts> = {}) =>
    numField({
      label,
      value,
      field: f,
      onCommit: (v) => A.setGeometry(f, v),
      onScrub: (v) => A.setGeometry(f, v, { live: true }),
      ...extra,
    });
  return section(
    'Layout',
    h('div', { class: 'd-grid' }, field('X', 'x', box.x), field('Y', 'y', box.y), field('W', 'w', box.w, { min: 0.01 }), field('H', 'h', box.h, { min: 0.01 })),
    h('div', { class: 'd-grid' }, field(icon('rotate', 12), 'rotation', rot, { suffix: '°', title: 'Rotation' }), radiusField(sel)),
  );
}

// Corner radius, shown when every selected shape is a rectangle.
function radiusField(sel: Shape[]): Node {
  const rects = sel.filter((s) => s.type === 'rect');
  if (!rects.length || rects.length !== sel.length) return h('span');
  const values = [...new Set(rects.map((s) => (s.type === 'rect' ? (s.r ?? 0) : 0)))];
  return numField({
    label: 'R',
    title: 'Corner radius (Material: 2dp)',
    value: values.length > 1 ? null : values[0],
    field: 'r',
    min: 0,
    step: 0.5,
    onCommit: (v) => A.setCornerRadius(v),
    onScrub: (v) => A.setCornerRadius(v, { live: true }),
  });
}

function updateLayoutFields() {
  const sel = selected();
  const box = A.selectionBox(sel) ?? { x: 0, y: 0, w: 0, h: 0 };
  const ab = activeArtboard();
  const first = sel[0];
  const values: Record<string, number> = {
    ...box,
    rotation: sel.length === 1 ? (sel[0].rotation ?? 0) : 0,
    r: first?.type === 'rect' ? (first.r ?? 0) : 0,
    'ab:x': ab.x,
    'ab:y': ab.y,
    'ab:w': ab.w,
    'ab:h': ab.h,
  };
  designBody.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((inp) => {
    if (document.activeElement !== inp) inp.value = fmt(values[inp.dataset.field!], inp.dataset.suffix);
  });
}

// Fill and stroke act on the selection, or set the style for new shapes.
function fillSection(sel: Shape[]) {
  const targets = sel.length ? sel.filter((s) => s.type !== 'line') : [state.prefs.style];
  if (!targets.length) return h('div'); // lines have no fill
  const fills = [...new Set(targets.map((s) => s.fill))];
  const none = fills.every((f) => f === 'none');
  const sec = paintSection('Fill', 'fill', none, () => A.setStyle({ fill: none ? lastFill() : 'none' }));
  if (!none && targets.length) sec.append(colorRow(fills.length > 1 ? null : fills[0], (c, live) => A.setStyle({ fill: c }, { live }), 'Fill'));
  if (!sel.length) sec.append(h('p', { class: 'd-hint', textContent: 'Used for new shapes' }));
  return sec;
}

function strokeSection(sel: Shape[]) {
  const targets = sel.length ? sel : [state.prefs.style];
  const none = targets.every((s) => s.strokeWidth <= 0);
  const sec = paintSection('Stroke', 'stroke', none, () => A.setStyle(none ? { strokeWidth: 1 } : { strokeWidth: 0 }));
  if (!none) {
    const strokes = [...new Set(targets.map((s) => s.stroke))];
    const widths = [...new Set(targets.map((s) => s.strokeWidth))];
    sec.append(
      colorRow(strokes.length > 1 ? null : strokes[0], (c, live) => A.setStyle({ stroke: c }, { live }), 'Stroke'),
      h(
        'div',
        { class: 'd-grid' },
        numField({
          label: 'Weight',
          value: widths.length > 1 ? null : widths[0],
          min: 0,
          step: 0.25,
          onCommit: (v) => A.setStyle({ strokeWidth: v }),
          onScrub: (v) => A.setStyle({ strokeWidth: v }, { live: true }),
          wide: true,
        }),
      ),
      labeled(
        'Ends',
        segmented<Cap>(
          [
            ['butt', 'Butt'],
            ['round', 'Round'],
            ['square', 'Square'],
          ],
          common(targets.map((s) => s.cap ?? 'round')),
          (cap) => A.setStyle({ cap }),
        ),
      ),
      labeled(
        'Corners',
        segmented<Join>(
          [
            ['miter', 'Miter'],
            ['round', 'Round'],
            ['bevel', 'Bevel'],
          ],
          common(targets.map((s) => s.join ?? 'round')),
          (join) => A.setStyle({ join }),
        ),
      ),
    );
  }
  return sec;
}

// The shared value, or a sentinel that matches no option when mixed.
const common = <T,>(vals: T[]) => (new Set(vals).size === 1 ? vals[0] : ('' as T));

const lastFill = () => (state.prefs.style.fill !== 'none' ? state.prefs.style.fill : '#D9D9D9');

// Section header with Illustrator's fill/stroke focus (X) and a +/− toggle.
function paintSection(title: string, which: 'fill' | 'stroke', none: boolean, toggle: () => void) {
  const head = h('div', { class: 'd-title-row' });
  const t = h('button', {
    class: 'd-title focus-title' + (state.focus === which ? ' focused' : ''),
    textContent: title,
    title: `Make ${title.toLowerCase()} active — X toggles, / sets none`,
  });
  t.addEventListener('click', () => {
    state.focus = which;
    emit();
  });
  const add = h('button', { class: 'icon-btn', title: none ? `Add ${title.toLowerCase()}` : `Remove ${title.toLowerCase()}`, html: icon(none ? 'plus' : 'minus', 14) });
  add.addEventListener('click', toggle);
  head.append(t, add);
  return h('section', { class: 'd-section' + (none ? ' empty' : '') }, head);
}

function colorRow(value: string | null, apply: (c: string, live: boolean) => void, title = 'Color') {
  const color = value ?? '#888888';
  const swatch = h('button', { class: 'swatch' + (value ? '' : ' mixed'), title: `Edit ${title.toLowerCase()} color` });
  swatch.setAttribute('aria-label', `${title} color ${value ?? 'mixed'}`);
  swatch.style.setProperty('--c', color);
  const hex = h('input', { class: 'hex', value: value ? value.replace('#', '').toUpperCase() : 'Mixed', spellcheck: false, title: 'Hex color' });

  // The picker previews live; the whole visit is one undo step.
  swatch.addEventListener('click', () => {
    let started = false;
    openColorPicker(swatch, {
      title,
      color,
      documentColors: allShapes().flatMap((s) => [s.type !== 'line' ? s.fill : '', s.strokeWidth > 0 ? s.stroke : '']).filter((c) => c && c !== 'none'),
      onInput: (c) => {
        if (!started) {
          checkpoint();
          started = true;
        }
        swatch.style.setProperty('--c', c);
        swatch.classList.remove('mixed');
        hex.value = c.slice(1);
        apply(c, true);
      },
      onClose: () => {
        if (!started) return;
        discardIfUnchanged();
        commit();
      },
    });
  });
  hex.addEventListener('focus', () => hex.select());
  hex.addEventListener('change', () => {
    const c = normalizeHex(hex.value);
    if (c) apply(c, false);
    else hex.value = value ? value.slice(1).toUpperCase() : 'Mixed';
  });
  hex.addEventListener('keydown', (e) => e.key === 'Enter' && hex.blur());
  return h('div', { class: 'color-row' }, swatch, hex);
}

function normalizeHex(v: string) {
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = [...s].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
}

// ---- Number fields ---------------------------------------------------------

interface NumOpts {
  label: string; // text or icon HTML
  value: number | null; // null = mixed
  field?: string;
  suffix?: string;
  title?: string;
  min?: number;
  step?: number;
  wide?: boolean;
  onCommit: (v: number) => void;
  onScrub?: (v: number) => void;
}

const fmt = (v: number, suffix = '') => `${Math.round(v * 100) / 100}${suffix}`;

// Figma-style: drag the label to scrub, arrows to step (Shift ×10), and
// simple math like "12+4" or "*2" in the box.
function numField(o: NumOpts) {
  const step = o.step ?? 1;
  const input = h('input', { class: 'num-input', inputMode: 'decimal', value: o.value === null ? 'Mixed' : fmt(o.value, o.suffix), spellcheck: false });
  if (o.field) input.dataset.field = o.field;
  if (o.suffix) input.dataset.suffix = o.suffix;
  const label = h('span', { class: 'num-label', html: o.label, title: o.title ?? `Drag to adjust ${o.label}` });
  const wrap = h('label', { class: 'num' + (o.wide ? ' wide' : '') }, label, input);

  const current = () => parseFloat(input.value) || 0;
  const clamp = (v: number) => (o.min !== undefined ? Math.max(o.min, v) : v);
  const commitValue = (v: number) => o.onCommit(clamp(Math.round(v * 100) / 100));

  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => {
    const v = evaluate(input.value, o.value);
    if (v === null) input.value = o.value === null ? 'Mixed' : fmt(o.value, o.suffix);
    else commitValue(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = current() + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      input.value = fmt(clamp(v), o.suffix);
      commitValue(v);
      input.select();
    }
  });

  // Scrub by dragging the label.
  label.addEventListener('pointerdown', (e) => {
    if (o.value === null || !o.onScrub) return;
    e.preventDefault();
    label.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const v0 = o.value;
    checkpoint();
    document.body.classList.add('scrubbing');
    const move = (ev: PointerEvent) => {
      const v = clamp(Math.round((v0 + ((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1)) * 100) / 100);
      input.value = fmt(v, o.suffix);
      o.onScrub!(v);
    };
    const up = () => {
      label.removeEventListener('pointermove', move);
      document.body.classList.remove('scrubbing');
      discardIfUnchanged();
      commit();
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up, { once: true });
    label.addEventListener('pointercancel', up, { once: true });
  });
  return wrap;
}

// "12", "12+4", "*2" (applies to the current value), "(8+4)/2".
function evaluate(text: string, current: number | null): number | null {
  let s = text.replace(/[°px\s]/g, '');
  if (/^[*/+]/.test(s) && current !== null) s = current + s;
  if (!/^[\d.+\-*/()]+$/.test(s)) return null;
  try {
    const v = Function(`"use strict"; return (${s})`)();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// ---- Export ----------------------------------------------------------------

function exportControls() {
  const box = h('div', { class: 'export-controls' });
  const set = <K extends keyof typeof state.prefs>(key: K, v: (typeof state.prefs)[K]) => {
    state.prefs[key] = v;
    savePrefs();
    draw();
  };
  const draw = () => {
    const p = state.prefs;
    const count = artboards().length;
    const kids: Node[] = [];
    if (count > 1) kids.push(segmented<string>([['one', 'This artboard'], ['all', `All ${count}`]], p.exportAll ? 'all' : 'one', (v) => set('exportAll', v === 'all')));
    kids.push(
      segmented<ExportFormat>(
        [
          ['svg', 'SVG', 'Web / Material Symbols SVG'],
          ['xml', 'Android', 'Android Vector Drawable (.xml)'],
          ['png', 'PNG', 'PNG at Android densities'],
        ],
        p.exportFormat,
        (v) => set('exportFormat', v),
      ),
    );
    if (p.exportFormat === 'png') {
      const chips = h('div', { class: 'chips' });
      const ab = activeArtboard();
      for (const d of DENSITIES) {
        const on = p.densities.includes(d.name);
        const c = h('button', { class: 'chip' + (on ? ' on' : ''), textContent: d.name, title: `${d.scale}x · ${Math.round(ab.w * d.scale)} px` });
        c.addEventListener('click', () => {
          const next = on ? p.densities.filter((x) => x !== d.name) : [...p.densities, d.name];
          if (next.length) set('densities', next);
        });
        chips.append(c);
      }
      kids.push(chips);
    } else {
      kids.push(toggleRow('Single path (Google format)', '', p.singlePath, () => set('singlePath', !p.singlePath)));
      if (p.exportFormat === 'svg' && p.singlePath) kids.push(toggleRow('960 grid (Material Symbols)', '', p.grid960, () => set('grid960', !p.grid960)));
      kids.push(toggleRow(p.exportFormat === 'svg' ? 'Use currentColor' : 'Tintable (colorControlNormal)', '', p.currentColor, () => set('currentColor', !p.currentColor)));
    }
    const boards = p.exportAll ? artboards() : [activeArtboard()];
    const ext = p.exportFormat;
    const single = boards.length === 1 && (p.exportFormat !== 'png' || p.densities.length === 1);
    const label = single ? `Export ${fileBase(boards[0])}.${ext}` : `Export ${boards.length > 1 ? `${boards.length} icons` : fileBase(boards[0])} (.zip)`;
    const go = h('button', { class: 'primary-btn', textContent: label });
    go.addEventListener('click', async () => {
      const opts = { format: p.exportFormat, densities: p.densities, currentColor: p.currentColor, singlePath: p.singlePath, grid960: p.grid960 };
      if (p.singlePath && p.exportFormat !== 'png') {
        go.textContent = 'Checking…';
        const issues = await checkSinglePath(state.doc, boards);
        go.textContent = label;
        if (issues.length && !(await reviewIssues(issues))) return;
      }
      closePop();
      await exportArtboards(state.doc, boards, opts);
    });
    kids.push(go);
    box.replaceChildren(...kids);
  };
  draw();
  return box;
}

// Lists what would make the merged icon differ, with fixes where possible.
// Resolves true to export anyway, false to cancel.
function reviewIssues(issues: ExportIssue[]): Promise<boolean> {
  return new Promise((resolve) => {
    closePop();
    const dlg = q<HTMLDialogElement>('#reviewDialog');
    const list = h('ul', { class: 'issues' });
    for (const it of issues) {
      const li = h('li', {}, h('strong', { textContent: it.artboard ? `${it.artboard}: ` : '' }), it.message);
      if (it.kind === 'white') {
        const fix = h('button', { class: 'secondary-btn inline', textContent: 'Convert to Subtract' });
        fix.addEventListener('click', () => {
          const ab = artboards().find((a) => a.name === it.artboard);
          if (ab && A.whitesToSubtract(ab.id)) {
            li.classList.add('fixed');
            fix.replaceWith(h('span', { class: 'fixed-note', textContent: 'Fixed' }));
          }
        });
        li.append(fix);
      }
      list.append(li);
    }
    const cancel = h('button', { class: 'secondary-btn', textContent: 'Cancel' });
    const go = h('button', { class: 'primary-btn', textContent: 'Export anyway' });
    dlg.replaceChildren(
      h('h2', { textContent: 'Check before exporting' }),
      h('p', { class: 'd-hint', textContent: 'The single-path export would not match what you see:' }),
      list,
      h('div', { class: 'dialog-actions' }, cancel, go),
    );
    const done = (ok: boolean) => {
      dlg.close();
      resolve(ok);
    };
    cancel.addEventListener('click', () => done(false));
    go.addEventListener('click', () => done(true));
    dlg.addEventListener('cancel', () => resolve(false), { once: true });
    dlg.showModal();
  });
}

// ---- Help, toast, panels -----------------------------------------------------

const helpDialog = q<HTMLDialogElement>('#helpDialog');

function openHelp() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  helpDialog.innerHTML = `
    <div class="help-head"><h2>Keyboard shortcuts</h2><span class="help-sub">Adobe Illustrator layout${navigator.platform.includes('Mac') ? '' : ' · Ctrl = ⌘ on Mac'}</span><button class="sheet-close" value="close" aria-label="Close">×</button></div>
    <div class="help-cols">${groups
      .map(
        (g) => `<section><h3>${g}</h3><dl>${SHORTCUTS.filter((s) => s.group === g)
          .map((s) => `<div><dt>${escapeHtml(s.label)}</dt><dd>${s.keys.slice(0, 2).map((k) => `<kbd>${escapeHtml(pretty(k))}</kbd>`).join(' ')}</dd></div>`)
          .join('')}</dl></section>`,
      )
      .join('')}</div>
    <p class="help-note">Tip: in a browser tab, Chrome keeps a few keys for itself (Ctrl+1–3, Ctrl+N). Install Iconic as an app to use every shortcut.</p>`;
  q('.sheet-close', helpDialog).addEventListener('click', () => helpDialog.close());
  helpDialog.showModal();
}
helpDialog.addEventListener('click', (e) => e.target === helpDialog && helpDialog.close());

const toastEl = q('#toast');
let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1600);
}

const mobile = matchMedia('(max-width: 767px)');

// Tab hides panels on desktop (Illustrator); on phones the panels are sheets.
function togglePanels() {
  if (mobile.matches) {
    document.body.classList.remove('sheet-left', 'sheet-right');
    return;
  }
  document.body.classList.toggle('panels-hidden');
}

function toggleSheet(which: 'left' | 'right') {
  const cls = `sheet-${which}`;
  const open = !document.body.classList.contains(cls);
  document.body.classList.remove('sheet-left', 'sheet-right');
  if (open) document.body.classList.add(cls);
}
document.addEventListener('click', (e) => {
  const close = (e.target as Element).closest<HTMLElement>('[data-close]');
  if (close) document.body.classList.remove(`sheet-${close.dataset.close}`);
});

// ---- Boot --------------------------------------------------------------------

export function initUI() {
  buildTopbar();
  installShortcuts({ setTool, togglePanels, openExport, openHelp, toast });
  subscribe((kind) => {
    if (kind === 'live') return updateLayoutFields();
    renderTools();
    updateTopbar();
    renderArtboards();
    renderLayers();
    renderDesign();
  });
  onViewChange(updateZoomLabel);
  setTool('select');
}
