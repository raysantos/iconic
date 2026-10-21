// Design panel: Variations (masters for weight, fill, grade and optical size).
import * as A from '../actions';
import { fitAll } from '../canvas';
import { el, renderShapes } from '../svg';
import { AXIS_LABEL, baseLoc, baseOf, combos, compatibility, FILLS, GRADES, interpolate, locLabel, mastersOf, snapToGrid, WEIGHTS, type Master } from '../masters';
import { GENERAL_SIZES, ICON_SIZES, type AxisTag, type Loc } from '../model';
import { activeArtboard, state } from '../store';
import { h, toast } from './dom';
import { renderDesign } from './design';
import { section, labeled, numField } from './controls';

// Preview position and picked values to generate, per axis (kept while you work).
export const previewLoc: Partial<Loc> = { wght: 500, FILL: 1 };
export const picks: Record<AxisTag, Set<number>> = { wght: new Set(WEIGHTS), FILL: new Set(FILLS), GRAD: new Set(GRADES), opsz: new Set(ICON_SIZES) };

export function variationsSection(): Node {
  const ab = activeArtboard();
  const base = baseOf(ab);
  const title = 'Variations';
  if (ab.generated) return section(title, h('p', { class: 'd-hint', textContent: `Generated at ${locLabel(ab.generated.loc)}. Edit the masters and generate again.` }));

  const ms = base ? mastersOf(base) : [];
  const master = (axis: AxisTag) => ms.find((m) => m.axis === axis);
  const owner = base ?? ab;
  const kids: Node[] = [];
  if (!ms.length) kids.push(h('p', { class: 'd-hint', textContent: 'Draw this icon once more per axis — bolder, filled, graded, or at another size — and Iconic makes every combination in between.' }));

  // One block per master: what it is, whether it matches the base, and unlink.
  const head = (axis: AxisTag, m: Master) => {
    const x = h('button', { class: 'icon-btn', textContent: '×', title: `Unlink ${m.ab.name} (the artboard stays)` });
    x.addEventListener('click', () => A.removeMaster(owner.id, m.ab.id));
    return h('div', { class: 'master-head' }, h('h4', { class: 'd-subtitle', textContent: AXIS_LABEL[axis] }), x);
  };
  const status = (m: Master) => {
    const problems = compatibility(owner, m.ab);
    if (!problems.length) return [h('p', { class: 'd-hint ok', textContent: `✓ ${m.ab.name} is compatible` })];
    const ul = h('ul', { class: 'audit-list' });
    for (const p of problems.slice(0, 6)) ul.append(h('li', {}, h('span', { class: 'audit-dot' }), h('span', { class: 'audit-text', textContent: p })));
    return [h('p', { class: 'd-hint warn', textContent: `${m.ab.name} isn’t compatible yet:` }), ul];
  };
  const at = baseLoc(owner);

  const wm = master('wght');
  if (wm) {
    kids.push(
      head('wght', wm),
      h(
        'div',
        { class: 'd-grid' },
        numField({ label: 'Base', title: `Weight of ${owner.name}`, value: at.wght, min: 1, step: 100, wide: false, onCommit: (v) => A.setAxisValue(owner.id, 'wght', false, v) }),
        numField({ label: 'Master', title: `Weight of ${wm.ab.name}`, value: wm.value, min: 1, step: 100, wide: false, onCommit: (v) => A.setAxisValue(owner.id, 'wght', true, v) }),
      ),
      ...status(wm),
    );
  }
  const fm = master('FILL');
  if (fm) kids.push(head('FILL', fm), h('p', { class: 'd-hint', textContent: 'Outlined (fill 0) → filled (fill 1). Holes shrink to nothing in the filled master.' }), ...status(fm));
  const gm = master('GRAD');
  if (gm) {
    kids.push(
      head('GRAD', gm),
      h(
        'div',
        { class: 'd-grid' },
        numField({ label: 'Base', title: `Grade of ${owner.name}`, value: at.GRAD, step: 25, wide: false, onCommit: (v) => A.setAxisValue(owner.id, 'GRAD', false, v) }),
        numField({ label: 'Master', title: `Grade of ${gm.ab.name}`, value: gm.value, step: 25, wide: false, onCommit: (v) => A.setAxisValue(owner.id, 'GRAD', true, v) }),
      ),
      h('p', { class: 'd-hint', textContent: 'Thicken the lines a touch, inward, so the icon keeps its size.' }),
      ...status(gm),
    );
  }
  const om = master('opsz');
  if (om) kids.push(head('opsz', om), h('p', { class: 'd-hint', textContent: `${at.opsz}dp → ${om.value}dp. Adjust line weights for the size; Iconic scales the rest.` }), ...status(om));

  // Add the missing masters.
  const added = (r: ReturnType<typeof A.addMaster>, msg: string) => {
    if (!r) return;
    fitAll();
    toast(r.approx ? `${msg} — check ${r.approx} outline${r.approx > 1 ? 's' : ''} that could only be filled roughly` : msg);
  };
  const adds: Node[] = [];
  if (!wm) {
    const b = h('button', { class: 'secondary-btn', textContent: 'Add bold master' });
    b.addEventListener('click', () => added(A.addMaster(owner.id, 'wght'), 'Bold master added — make it bolder, then generate'));
    adds.push(b);
  }
  if (!fm) {
    const b = h('button', { class: 'secondary-btn', textContent: 'Add filled master', title: 'Copies the icon with its holes shrunk to nothing' });
    b.addEventListener('click', () => added(A.addMaster(owner.id, 'FILL'), 'Filled master added — tidy it up, then generate'));
    adds.push(b);
  }
  if (!gm) {
    const b = h('button', { class: 'secondary-btn', textContent: 'Add grade master', title: 'A slightly heavier version for emphasis; -25 for dark mode comes for free' });
    b.addEventListener('click', () => added(A.addMaster(owner.id, 'GRAD'), 'Grade master added — thicken the lines a touch, then generate'));
    adds.push(b);
  }
  if (!om) {
    const chips = h('div', { class: 'chips' });
    for (const n of (state.prefs.materialMode ? ICON_SIZES : GENERAL_SIZES).filter((n) => n !== owner.w)) {
      const c = h('button', { class: 'chip', textContent: String(n), title: `Add a master at ${n}dp` });
      c.addEventListener('click', () => added(A.addMaster(owner.id, 'opsz', n), `${n}dp master added — adjust its line weights, then generate`));
      chips.append(c);
    }
    adds.push(labeled('Size master', chips, 'Add a master at another optical size'));
  }
  if (adds.length) kids.push(h('div', { class: 'master-adds' }, ...adds));

  if (!base || !ms.length || ms.some((m) => compatibility(base, m.ab).length)) return section(title, ...kids);

  // Live preview: one slider per axis.
  const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  preview.setAttribute('class', 'weight-preview');
  preview.setAttribute('viewBox', `${base.x} ${base.y} ${base.w} ${base.h}`);
  const loc = (): Loc => ({ ...at, ...Object.fromEntries(ms.map((m) => [m.axis, previewLoc[m.axis] ?? m.value])) });
  const draw = () => {
    const list = interpolate(base, loc()) ?? [];
    list.forEach(snapToGrid); // same as Generate
    preview.replaceChildren(el('rect', { x: base.x, y: base.y, width: base.w, height: base.h, fill: '#fff' }), ...renderShapes(list));
  };
  const controls = h('div', { class: 'weight-controls' });
  for (const m of ms) {
    const [lo, hi, step] = m.axis === 'wght' ? [100, 900, 10] : m.axis === 'FILL' ? [0, 1, 0.05] : m.axis === 'GRAD' ? [Math.min(-25, at.GRAD, m.value), Math.max(200, at.GRAD, m.value), 5] : [Math.min(20, at.opsz, m.value), Math.max(48, at.opsz, m.value), 1];
    const value = h('span', { class: 'weight-value' });
    const slider = h('input', { type: 'range', min: String(lo), max: String(hi), step: String(step), value: String(loc()[m.axis]), class: 'weight-slider' });
    slider.setAttribute('aria-label', `Preview ${AXIS_LABEL[m.axis].toLowerCase()}`);
    const show = () => (value.textContent = m.axis === 'opsz' ? `${slider.value}dp` : slider.value);
    slider.addEventListener('input', () => {
      previewLoc[m.axis] = Number(slider.value);
      show();
      draw();
    });
    show();
    controls.append(h('span', { class: 'd-label', textContent: AXIS_LABEL[m.axis] }), value, slider);
  }
  draw();
  kids.push(h('h4', { class: 'd-subtitle', textContent: 'Preview' }), h('div', { class: 'weight-preview-row' }, preview, controls));

  // Values to generate per axis; every combination is made.
  const chipRow = (axis: AxisTag, values: number[]) => {
    const chips = h('div', { class: 'chips' });
    for (const v of values) {
      const on = picks[axis].has(v);
      const c = h('button', { class: 'chip' + (on ? ' on' : ''), textContent: String(v), title: `${on ? 'Skip' : 'Include'} ${AXIS_LABEL[axis].toLowerCase()} ${v}` });
      c.addEventListener('click', () => {
        if (picks[axis].has(v)) picks[axis].delete(v);
        else picks[axis].add(v);
        renderDesign();
      });
      chips.append(c);
    }
    return h('div', { class: 'gen-axis' }, h('span', { class: 'd-label', textContent: AXIS_LABEL[axis] }), chips);
  };
  const rows: Node[] = [];
  if (wm) rows.push(chipRow('wght', WEIGHTS));
  if (fm) rows.push(chipRow('FILL', FILLS));
  if (gm) rows.push(chipRow('GRAD', [...new Set([...GRADES, at.GRAD, gm.value])].sort((a, b) => a - b)));
  if (om) rows.push(chipRow('opsz', [...new Set([...(state.prefs.materialMode ? ICON_SIZES : GENERAL_SIZES), at.opsz, om.value])].sort((a, b) => a - b)));
  const chosen = () => ({ wght: [...picks.wght], FILL: [...picks.FILL], GRAD: [...picks.GRAD], opsz: [...picks.opsz] });
  const n = combos(base, chosen()).length;
  const gen = h('button', { class: 'secondary-btn', textContent: n ? `Generate ${n} icon${n > 1 ? 's' : ''}` : 'Pick values to generate', disabled: !n });
  gen.title = 'Makes every combination of the picked values (replacing the last set)';
  gen.addEventListener('click', () => {
    const made = A.generateVariations(base.id, chosen());
    if (made.length) {
      fitAll();
      toast(`Generated ${made.length} icon${made.length > 1 ? 's' : ''}`);
    }
  });
  kids.push(h('h4', { class: 'd-subtitle', textContent: 'Generate' }), ...rows, gen);
  return section(title, ...kids);
}
