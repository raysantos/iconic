// Top bar: tools, main menu, zoom and export buttons.
import * as A from '../actions';
import { actualSize, finishPen, fitAll, fitArtboard, fitSelection, setCursor, viewState, zoomAt } from '../canvas';
import { setTabletMode } from '../tablet';
import { openImport, pasteFromMenu } from '../importer';
import { toggleOverview } from '../overview';
import { icon } from '../icons';
import { type Tool } from '../model';
import { keyFor, pretty } from '../shortcuts';
import { activeArtboard, commit, emit, redo, savePrefs, state, undo } from '../store';
import { togglePanels, toggleSheet } from './panels';
import { q, h } from './dom';
import { openHelp, openAbout } from './dialogs';
import { exportControls } from './exportpanel';
import { openPop, closePop, showPop, menuList } from './popover';

export const TOOLS: Record<Tool, { label: string; key: string; icon: string }> = {
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

export const GROUPS: Tool[][] = [['select', 'direct'], ['artboard'], ['rect', 'ellipse', 'line'], ['pen', 'addAnchor', 'deleteAnchor', 'convertAnchor'], ['pencil'], ['hand', 'zoom']];
export const groupShown = GROUPS.map((g) => g[0]);

export const tip = (t: Tool) => `${TOOLS[t].label} (${keyFor(TOOLS[t].key)})`;

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

export const topbar = q('#topbar');

// On launch the menu logo shows the full-colour app icon, sweeps the brand gradient
// like raysandesigns.com's header, settles on coral to peach, then fades to the mono mark.
export function playLogoIntro() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const btn = topbar.querySelector<HTMLElement>('.menu-btn');
  if (!btn) return;
  const o = document.createElement('span');
  o.className = 'logo-intro';
  o.setAttribute('aria-hidden', 'true');
  o.innerHTML = `<svg width="22" height="22" viewBox="0 0 48 48"><defs><linearGradient id="logo-intro-g" x1="0" y1="0" x2="3" y2="0"><stop offset="0" stop-color="#18988b"/><stop offset=".33" stop-color="#3cb4e5"/><stop offset=".67" stop-color="#ff7e5f"/><stop offset="1" stop-color="#feb47b"/><animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="-2 0" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".42 0 .58 1"/></linearGradient></defs><rect width="48" height="48" rx="10" fill="url(#logo-intro-g)"/><rect x="9" y="9" width="17" height="17" fill="#fff" fill-opacity=".5"/><circle cx="29.5" cy="29.5" r="9.5" fill="#fff"/></svg>`;
  btn.append(o);
  setTimeout(() => o.classList.add('out'), 2300);
  setTimeout(() => o.remove(), 3000);
}

export function buildTopbar() {
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
      <button class="tb-btn" data-overview title="All icons (${pretty('Ctrl+Shift+O')})">${icon('grid', 18)}</button>
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
    if (t.closest('[data-overview]')) return toggleOverview();
    const sheet = t.closest<HTMLElement>('[data-sheet]');
    if (sheet) toggleSheet(sheet.dataset.sheet as 'left' | 'right');
  });
  renderTools();
  playLogoIntro();
}

export function renderTools() {
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

export function updateTopbar() {
  const name = q<HTMLInputElement>('.doc-name', topbar);
  if (document.activeElement !== name) name.value = state.doc.name;
  const ab = activeArtboard();
  q('.doc-meta', topbar).textContent = `${ab.name} · ${ab.w} × ${ab.h}`;
}

// Magnification, not percent: 24× means one icon pixel spans 24 screen pixels.
export const fmtZoom = (z: number) => `${z >= 10 ? Math.round(z) : +z.toFixed(1)}×`;
export const updateZoomLabel = () => (q('.zoom-val', topbar).textContent = fmtZoom(viewState.zoom));

export function openFlyout(anchor: HTMLElement, gi: number) {
  const items = GROUPS[gi].map((t) => ({ label: TOOLS[t].label, keys: keyFor(TOOLS[t].key), icon: TOOLS[t].icon, checked: state.tool === t, run: () => setTool(t) }));
  showPop(anchor.parentElement!, menuList(items));
}

export function togglePref(key: 'grid' | 'snap' | 'keylines' | 'smartGuides' | 'mergedPreview' | 'materialMode' | 'powerNudge' | 'audit') {
  state.prefs[key] = !state.prefs[key];
  savePrefs();
  commit();
}

export function openMenu(anchor: HTMLElement, which: string) {
  if (openPop && openPop.dataset.for === which) return closePop();
  if (which === 'main') {
    showPop(
      anchor,
      menuList([
        { label: 'New icon', keys: 'Ctrl+Alt+N', run: A.newDoc },
        { label: 'Import SVG…', keys: 'Ctrl+Shift+P', run: openImport },
        { label: 'Paste SVG', keys: 'Ctrl+V', run: () => void pasteFromMenu() },
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
        { label: 'Material mode', checked: state.prefs.materialMode, run: () => togglePref('materialMode') },
        { label: 'Merged preview (export)', keys: 'Ctrl+Y', checked: state.prefs.mergedPreview, run: () => togglePref('mergedPreview') },
        ...(state.prefs.materialMode ? [{ label: 'Material keylines', keys: 'Ctrl+;', checked: state.prefs.keylines, run: () => togglePref('keylines') }] : []),
        { label: 'Power nudge', checked: state.prefs.powerNudge, run: () => togglePref('powerNudge') },
        { label: 'Audit', checked: state.prefs.audit, run: () => togglePref('audit') },
        { label: 'Smart guides', keys: 'Ctrl+U', checked: state.prefs.smartGuides, run: () => togglePref('smartGuides') },
        { label: 'Snap to grid', keys: "Ctrl+Shift+'", checked: state.prefs.snap, run: () => togglePref('snap') },
        { label: 'Hide panels', keys: 'Tab', run: togglePanels },
        { label: 'Tablet mode (pen + touch)', checked: !!state.prefs.tabletMode, run: () => setTabletMode(!state.prefs.tabletMode) },
        { sep: true },
        { label: 'Export…', keys: 'Ctrl+Shift+E', run: openExport },
        { label: 'Keyboard shortcuts', keys: 'Ctrl+/', run: openHelp },
        { label: 'About Iconic', run: openAbout },
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
        { label: 'All icons (overview)', keys: 'Ctrl+Shift+O', run: () => toggleOverview() },
        { label: 'Zoom to selection', keys: 'Shift+2', run: fitSelection },
        { label: 'Actual size (1×)', keys: 'Ctrl+1', run: actualSize },
        { sep: true },
        ...[8, 16, 32].map((m) => ({ label: fmtZoom(m), run: () => zoomAt(m / viewState.zoom) })),
      ]),
      'right',
    );
  } else if (which === 'export') {
    showPop(anchor, h('div', { class: 'export-pop' }, exportControls()), 'right');
  }
  if (openPop) openPop.dataset.for = which;
}

export function openExport() {
  openMenu(q('.export-btn', topbar), 'export');
}
