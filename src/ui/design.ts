// Design panel: the sections shown for the selection.
import * as A from '../actions';
import { fitArtboard, setAuditFocus } from '../canvas';
import { AUDIT_LABEL, auditShape } from '../audit';
import { instanceName, type BadgeKey } from '../components';
import { icon } from '../icons';
import { toBezier } from '../geometry';
import { BOOL_LABEL, GENERAL_SIZES, ICON_SIZES, type BoolOp, type Cap, type InstanceShape, type IconStyle, type Join, type Pt, type Shape } from '../model';
import { pretty } from '../shortcuts';
import { activeArtboard, allShapes, artboardById, byId, commit, emit, savePrefs, selected, setActiveArtboard, shapes, state } from '../store';
import { q, h, toast } from './dom';
import { variationsSection } from './variations';
import { section, segmented, iconSegmented, labeled, toggleRow, common, colorRow, type NumOpts, fmt, numField } from './controls';
import { togglePref } from './topbar';

export const right = q('#rightPanel');
right.innerHTML = `
  <div class="panel-header"><span class="panel-title">Design</span><button class="sheet-close" data-close="right" aria-label="Close">×</button></div>
  <div class="design-body"></div>`;
export const designBody = q('.design-body', right);
export let pendingDesign = false;

export function renderDesign() {
  // Rebuilding while typing would steal focus; wait for the field to blur.
  const active = document.activeElement;
  if (active && designBody.contains(active) && active.tagName === 'INPUT' && !['checkbox', 'color', 'radio', 'range'].includes((active as HTMLInputElement).type)) {
    pendingDesign = true;
    return;
  }
  pendingDesign = false;
  const sel = selected();
  if (!sel.length) {
    auditPinned = null;
    setAuditFocus(null);
  }
  designBody.replaceChildren(
    ...(sel.length ? [alignSection(), booleanSection(sel), instanceSection(sel), layoutSection(sel), elementSection(sel), auditSection(sel)] : [artboardSection(), variationsSection(), materialSection(), gridSection()]),
    fillSection(sel),
    strokeSection(sel),
  );
}
designBody.addEventListener('focusout', () => setTimeout(() => pendingDesign && renderDesign()));

// The active artboard: name, position/size, Material icon size, and grid layout.
export function artboardSection() {
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
  const presets = state.prefs.materialMode ? ICON_SIZES : GENERAL_SIZES;
  const custom = ab.w === ab.h && !presets.includes(ab.w) ? [ab.w] : [];
  const sizes = segmented(
    [...presets, ...custom]
      .sort((a, b) => a - b)
      .map((n) => [n, String(n), custom.includes(n) ? `Current size (${n} px)` : `Scale icon to ${n} ${state.prefs.materialMode ? 'dp' : 'px'}`] as [number, string, string]),
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
    labeled('Icon size', sizes, state.prefs.materialMode ? 'Material Symbols optical sizes; scales the artwork' : 'Scales the artwork'),
    toggleRow('Component', 'Ctrl+Alt+K', !!ab.component, () => A.setComponent(ab.id, !ab.component)),
    h('h4', { class: 'd-subtitle', textContent: 'Artboard grid' }),
    h('div', { class: 'd-grid' }, cols, gap),
    arrange,
  );
}

export function materialSection() {
  const style = iconSegmented<IconStyle>(
    [
      ['outlined', 'styleOutlined', 'Outlined'],
      ['rounded', 'styleRounded', 'Rounded'],
      ['sharp', 'styleSharp', 'Sharp'],
    ],
    A.iconStyle(),
    (s) => A.setIconStyle(s),
  );
  // Material mode switch sits next to the section title; off collapses the section.
  const on = state.prefs.materialMode;
  const sw = h('input', { type: 'checkbox', checked: on, class: 'switch', title: on ? 'Turn off Material mode' : 'Turn on Material mode' });
  sw.setAttribute('aria-label', 'Material mode');
  sw.addEventListener('change', () => togglePref('materialMode'));
  const head = h('div', { class: 'd-title-row' }, h('h3', { class: 'd-title', textContent: 'Material' }), sw);
  if (!on) {
    return h('section', { class: 'd-section empty' }, head);
  }
  return h(
    'section',
    { class: 'd-section' },
    head,
    labeled('Style', style, 'Sets line ends, corners and rectangle corner radius for every shape'),
    toggleRow('Keylines', 'Ctrl+;', state.prefs.keylines, () => togglePref('keylines')),
    toggleRow('Merged preview', 'Ctrl+Y', state.prefs.mergedPreview, () => togglePref('mergedPreview')),
  );
}

export function gridSection() {
  const p = state.prefs;
  const setPref = <K extends 'gridSize' | 'snapTo'>(key: K, v: (typeof p)[K]) => {
    p[key] = v;
    savePrefs();
    commit();
  };
  return section(
    'Grid',
    toggleRow('Smart guides', 'Ctrl+U', p.smartGuides, () => togglePref('smartGuides')),
    toggleRow('Power nudge', '', p.powerNudge, () => togglePref('powerNudge')),
    toggleRow('Audit', '', p.audit, () => togglePref('audit')),
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

// Elements: make the selection a reusable component.
export function elementSection(sel: Shape[]): Node {
  if (sel.some((s) => s.type === 'instance') || !sel.every((s) => shapes().includes(s))) return h('span');
  const b = h('button', { class: 'secondary-btn', textContent: 'Create component', title: `Reuse this across icons (${pretty('Ctrl+Alt+K')})` });
  b.addEventListener('click', () => {
    const made = A.componentFromSelection();
    if (made) toast(`Created component ${made.name} — place it from Assets`);
  });
  return h('section', { class: 'd-section' }, b);
}

// Geometry problems in the selected paths, each with a fix.
export let auditShowAll = false; // survives re-renders so a Fix doesn't collapse the list
export let auditPinned: Pt | null = null; // the issue tapped in the list stays spotlit on the canvas
export const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
export function auditSection(sel: Shape[]): Node {
  const paths = state.prefs.audit ? sel.flatMap((s) => allShapes([s])) : [];
  const issues = paths.flatMap((s) => auditShape(s).map((issue, index) => ({ issue, index })));
  // Drop the spotlight once its issue is gone (fixed, or the selection changed).
  if (auditPinned && !issues.some((x) => samePt(x.issue.at, auditPinned!))) auditPinned = null;
  setAuditFocus(auditPinned);
  if (!issues.length) return h('span');
  const list = h('ul', { class: 'audit-list' });
  const fill = () => {
    list.replaceChildren();
    for (const { issue, index } of auditShowAll ? issues : issues.slice(0, 8)) {
      const fix = h('button', { class: 'icon-btn audit-fix', textContent: 'Fix', title: 'Apply the automatic fix' });
      fix.addEventListener('click', (e) => {
        e.stopPropagation();
        auditPinned = null;
        setAuditFocus(null);
        A.fixAuditIssue(issue.sid, index);
      });
      const pinned = !!auditPinned && samePt(auditPinned, issue.at);
      const row = h('li', { class: 'audit-item' + (pinned ? ' on' : ''), title: 'Show on canvas' }, h('span', { class: 'audit-dot' }), h('span', { class: 'audit-text' }, h('strong', { textContent: AUDIT_LABEL[issue.kind] }), h('span', { textContent: issue.message })), fix);
      // Pen hover previews it; a tap pins it (tap again to let go).
      row.addEventListener('pointerenter', () => setAuditFocus(issue.at));
      row.addEventListener('pointerleave', () => setAuditFocus(auditPinned));
      row.addEventListener('click', () => {
        auditPinned = pinned ? null : issue.at;
        setAuditFocus(auditPinned);
        fill();
      });
      list.append(row);
    }
    if (issues.length > 8) {
      const more = h('button', { class: 'audit-more', textContent: auditShowAll ? 'Show less' : `+ ${issues.length - 8} more` });
      more.addEventListener('click', () => {
        auditShowAll = !auditShowAll;
        fill();
      });
      list.append(h('li', {}, more));
    }
  };
  fill();
  const all = h('button', { class: 'secondary-btn', textContent: `Fix all (${issues.length})` });
  all.addEventListener('click', () => A.fixAllAudit([...new Set(issues.map((x) => x.issue.sid))]));
  return section(`Audit · ${issues.length}`, list, all);
}

// Union / Subtract / Intersect / Exclude (non-destructive, like Figma).
export function booleanSection(sel: Shape[]): Node {
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

export function alignSection() {
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

export function layoutSection(sel: Shape[]) {
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
export function radiusField(sel: Shape[]): Node {
  let values: number[];
  if (state.tool === 'direct' && state.anchors.length) {
    // Smart Corners on the picked points.
    values = state.anchors.flatMap((a) => {
      const s = byId(a.sid);
      if (!s || s.type === 'boolean' || s.type === 'instance') return [];
      const b = s.type === 'bezier' ? s : toBezier(s);
      return A.isCorner(b, a.i) ? [b.nodes[a.i].radius ?? 0] : [];
    });
  } else {
    if (!sel.length || !sel.every((s) => s.type === 'rect' || s.type === 'bezier')) return h('span');
    values = sel.flatMap((s) => (s.type === 'rect' ? [s.r ?? 0] : s.type === 'bezier' ? s.nodes.filter((_, i) => A.isCorner(s, i)).map((n) => n.radius ?? 0) : []));
  }
  if (!values.length) return h('span');
  values = [...new Set(values)];
  return numField({
    label: 'R',
    title: 'Corner radius — Smart Corners on paths (Material: 2dp)',
    value: values.length > 1 ? null : values[0],
    field: 'r',
    min: 0,
    step: 0.5,
    onCommit: (v) => A.setCornerRadius(v),
    onScrub: (v) => A.setCornerRadius(v, { live: true }),
  });
}

export function updateLayoutFields() {
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
export function fillSection(sel: Shape[]) {
  const targets = sel.length ? sel.filter((s) => s.type !== 'line') : [state.prefs.style];
  if (!targets.length) return h('div'); // lines have no fill
  const fills = [...new Set(targets.map((s) => s.fill))];
  const none = fills.every((f) => f === 'none');
  const sec = paintSection('Fill', 'fill', none, () => A.setStyle({ fill: none ? lastFill() : 'none' }));
  if (!none && targets.length) sec.append(colorRow(fills.length > 1 ? null : fills[0], (c, live) => A.setStyle({ fill: c }, { live }), 'Fill'));
  if (!sel.length) sec.append(h('p', { class: 'd-hint', textContent: 'Used for new shapes' }));
  return sec;
}

export function strokeSection(sel: Shape[]) {
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
        iconSegmented<Cap>(
          [
            ['butt', 'capButt', 'Butt — ends exactly at the point'],
            ['round', 'capRound', 'Round — rounded past the point'],
            ['square', 'capSquare', 'Square — squared off past the point'],
          ],
          common(targets.map((s) => s.cap ?? 'round')),
          (cap) => A.setStyle({ cap }),
        ),
      ),
      labeled(
        'Corners',
        iconSegmented<Join>(
          [
            ['miter', 'joinMiter', 'Miter — sharp corner'],
            ['round', 'joinRound', 'Round — rounded corner'],
            ['bevel', 'joinBevel', 'Bevel — corner cut off by a line'],
          ],
          common(targets.map((s) => s.join ?? 'round')),
          (join) => A.setStyle({ join }),
        ),
      ),
    );
  }
  return sec;
}

export const lastFill = () => (state.prefs.style.fill !== 'none' ? state.prefs.style.fill : '#D9D9D9');

// Section header with Illustrator's fill/stroke focus (X) and a +/− toggle.
export function paintSection(title: string, which: 'fill' | 'stroke', none: boolean, toggle: () => void) {
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

// ---- Instance section (Design panel) ----------------------------------------------

export function instanceSection(sel: Shape[]): Node {
  const insts = sel.filter((s): s is InstanceShape => s.type === 'instance');
  if (!insts.length || insts.length !== sel.length) return h('span');
  const one = insts.length === 1 ? insts[0] : null;
  const isBadge = insts.every((i) => i.ref.startsWith('badge:'));
  const kids: Node[] = [];
  if (one) kids.push(h('p', { class: 'd-hint inst-source', textContent: `${isBadge ? 'Badge' : 'Component'}: ${instanceName(one)}` }));

  const gaps = [...new Set(insts.map((i) => i.knockout ?? 0))];
  kids.push(
    h(
      'div',
      { class: 'd-grid' },
      numField({
        label: 'Gap',
        title: 'Knockout: clearance cut from the icon around this (0 = off)',
        value: gaps.length > 1 ? null : gaps[0],
        min: 0,
        step: 0.25,
        wide: true,
        onCommit: (v) => A.setKnockout(v),
        onScrub: (v) => A.setKnockout(v, { live: true }),
      }),
    ),
  );

  const corners = h('div', { class: 'corner-row' });
  for (const [c, label, sym] of [
    ['nw', 'Top left', '↖'],
    ['ne', 'Top right', '↗'],
    ['sw', 'Bottom left', '↙'],
    ['se', 'Bottom right', '↘'],
  ] as const) {
    const b = h('button', { class: 'icon-btn', textContent: sym, title: `Move to ${label.toLowerCase()} corner` });
    b.addEventListener('click', () => A.moveBadgeTo(c));
    corners.append(b);
  }
  kids.push(labeled('Corner', corners));

  if (isBadge) {
    const circle = insts.every((i) => i.ref.endsWith('_circle'));
    const key = insts[0].ref.slice(6).split('_')[0] as BadgeKey;
    kids.push(
      labeled(
        'Style',
        segmented<string>(
          [
            ['bare', 'Bare'],
            ['circle', 'Circle'],
          ],
          circle ? 'circle' : 'bare',
          (v) => A.swapBadge(key, v === 'circle'),
        ),
      ),
    );
  }

  const actions = h('div', { class: 'btn-row' });
  if (one && !isBadge && artboardById(one.ref)) {
    const go = h('button', { class: 'secondary-btn', textContent: 'Go to component' });
    go.addEventListener('click', () => {
      setActiveArtboard(one.ref, true);
      emit();
      fitArtboard();
    });
    actions.append(go);
  }
  const detach = h('button', { class: 'secondary-btn', textContent: 'Detach', title: `Turn into editable shapes (${pretty('Ctrl+Alt+B')})` });
  detach.addEventListener('click', () => {
    if (A.detachSelection()) toast('Detached — the knockout gap was removed (use Subtract to keep one)');
  });
  actions.append(detach);
  kids.push(actions);
  return section(isBadge ? 'Badge' : 'Instance', ...kids);
}
