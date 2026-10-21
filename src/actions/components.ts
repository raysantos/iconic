// Components, instances and badges.
import { center, moveShape, scaleKeepingRotation, unionBox, worldBox } from '../geometry';
import { BADGES, BADGE_BOX, resolveSource, type BadgeKey } from '../components';
import { type Artboard, type InstanceShape, type Pt, type Shape } from '../model';
import { activeArtboard, allShapes, artboardById, artboards, containerOf, inside, newArtboard, newId, setActiveArtboard, shapes, state } from '../store';
import { editable, type EditOpts, edit } from './edit';
import { withNewIds } from './selection';
import { rotateShapes } from './transform';
import { shapesOn, freeSlot } from './artboards';

// ---- Components & badges ------------------------------------------------------

// Elements: turn the selected shapes into a reusable component. They move to a
// new component artboard and a linked instance takes their place.
export function componentFromSelection(): Artboard | null {
  const sel = editable();
  if (!sel.length) return null;
  const list = shapes();
  const top = sel.filter((s) => list.includes(s)); // top level only
  if (top.length !== sel.length) return null;
  const b = unionBox(top.map(worldBox));
  const [x0, y0] = [Math.floor(b.x), Math.floor(b.y)];
  const [w, h] = [Math.max(1, Math.ceil(b.x + b.w) - x0), Math.max(1, Math.ceil(b.y + b.h) - y0)];
  const [ax, ay] = freeSlot(w, h);
  const name = top.length === 1 && top[0].name ? top[0].name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'element' : 'element';
  const ab: Artboard = { ...newArtboard(name, ax, ay, w), h, component: true };
  edit(() => {
    const at = Math.max(...top.map((s) => list.indexOf(s)));
    const inst = newInstance(ab.id, x0, y0, 1);
    list.splice(at + 1, 0, inst);
    for (const s of top) {
      list.splice(list.indexOf(s), 1);
      moveShape(s, structuredClone(s), ax - x0, ay - y0);
    }
    list.push(...top);
    artboards().push(ab);
    inst.name = ab.name;
    state.selection = [inst.id];
  });
  return ab;
}

export function setComponent(id: string, on: boolean) {
  const ab = artboardById(id);
  if (!ab || !!ab.component === on) return;
  edit(() => (ab.component = on));
}

export function newInstance(ref: string, x: number, y: number, scale: number, knockout = 0): InstanceShape {
  const src = resolveSource(ref);
  return { id: newId(), type: 'instance', ref, x, y, scale, knockout, name: src?.name ?? 'Instance', fill: 'none', stroke: '#000000', strokeWidth: 0 };
}

// Place a component in the active artboard, scaled to fill it (aligned like a base icon).
export function placeComponent(ref: string): InstanceShape | null {
  const src = artboardById(ref);
  const ab = activeArtboard();
  if (!src || src.id === ab.id) return null;
  const k = Math.min(ab.w / src.w, ab.h / src.h);
  const inst = newInstance(ref, ab.x + (ab.w - src.w * k) / 2, ab.y + (ab.h - src.h * k) / 2, k);
  edit(() => {
    shapes().push(inst);
    state.selection = [inst.id];
  });
  return inst;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

// Badge slot: a corner of the artboard, 1dp in from the edge (scaled to the icon size).
export function slot(ab: Artboard, size: number, corner: Corner): Pt {
  const k = Math.min(ab.w, ab.h) / 24;
  const pad = 1 * k;
  return [corner.includes('w') ? ab.x + pad : ab.x + ab.w - size - pad, corner.includes('n') ? ab.y + pad : ab.y + ab.h - size - pad];
}

// The color most of an artboard's shapes use (a badge matches its icon).
export function iconColorOf(ab: Artboard): string {
  const counts = new Map<string, number>();
  for (const s of shapesOn(ab)) {
    if (s.hidden || s.type === 'instance') continue;
    const c = s.type !== 'line' && s.fill !== 'none' ? s.fill : s.strokeWidth > 0 ? s.stroke : null;
    if (c) counts.set(c.toUpperCase(), (counts.get(c.toUpperCase()) ?? 0) + 1);
  }
  return [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? (state.prefs.style.fill !== 'none' ? state.prefs.style.fill : '#000000');
}

// Defaults for a 24dp icon: a 10dp badge with a 1.5dp knockout gap.
export const BADGE_SIZE = 10;
export const BADGE_GAP = 1.5;

export function placeBadge(key: BadgeKey, circle: boolean, corner: Corner = 'se'): InstanceShape {
  const ab = activeArtboard();
  const k = Math.min(ab.w, ab.h) / 24;
  const size = BADGE_SIZE * k;
  const [x, y] = slot(ab, size, corner);
  const inst = newInstance(`badge:${key}${circle ? '_circle' : ''}`, x, y, size / BADGE_BOX.w, BADGE_GAP * k);
  inst.fill = iconColorOf(ab);
  edit(() => {
    shapes().push(inst); // on top, so its knockout cuts the icon below
    state.selection = [inst.id];
  });
  return inst;
}

export const selectedInstances = () => editable().filter((s): s is InstanceShape => s.type === 'instance');

export function moveBadgeTo(corner: Corner) {
  const list = selectedInstances();
  if (!list.length) return;
  edit(() => {
    for (const inst of list) {
      const ab = artboards().find((a) => inside(a, center(worldBox(inst)))) ?? activeArtboard();
      [inst.x, inst.y] = slot(ab, worldBox(inst).w, corner);
    }
  });
}

export function setKnockout(gap: number, opts: EditOpts = {}) {
  const list = selectedInstances();
  if (!list.length || !Number.isFinite(gap)) return;
  edit(() => list.forEach((i) => (i.knockout = Math.max(0, gap))), opts);
}

export function swapBadge(key: BadgeKey, circle: boolean) {
  const list = selectedInstances().filter((i) => i.ref.startsWith('badge:'));
  if (!list.length) return;
  const ref = `badge:${key}${circle ? '_circle' : ''}`;
  edit(() => list.forEach((i) => ((i.ref = ref), (i.name = resolveSource(ref)?.name ?? i.name))));
}

// The instance's artwork as ordinary, editable shapes in the same place.
export function detachedShapes(inst: InstanceShape): Shape[] {
  const src = resolveSource(inst.ref);
  if (!src) return [];
  const to = { x: inst.x, y: inst.y, w: src.box.w * inst.scale, h: src.box.h * inst.scale };
  const clones = structuredClone(src.shapes).map(withNewIds);
  for (const c of clones) {
    scaleKeepingRotation(c, structuredClone(c), src.box, to);
    for (const x of allShapes([c])) {
      x.strokeWidth *= inst.scale;
      if (x.type === 'rect' && x.r) x.r *= inst.scale;
    }
  }
  if (inst.rotation) rotateShapes(clones, structuredClone(clones), inst.rotation, center(to));
  if (inst.fill !== 'none') {
    // Keep the instance's color override.
    for (const x of clones.flatMap((c) => allShapes([c]))) {
      if (x.fill !== 'none') x.fill = inst.fill;
      x.stroke = inst.fill;
    }
  }
  return clones;
}

export function replaceWithDetached(inst: InstanceShape): Shape[] {
  const c = containerOf(inst.id);
  if (!c) return [];
  const clones = detachedShapes(inst);
  c.list.splice(c.list.indexOf(inst), 1, ...clones);
  return clones;
}

// Detach instance (Figma: Ctrl+Alt+B). Returns how many had a knockout, which
// detaching removes (use Subtract to keep that gap).
export function detachSelection(): number {
  const list = selectedInstances();
  if (!list.length) return 0;
  let lostKnockouts = 0;
  edit(() => {
    const freed: string[] = [];
    for (const inst of list) {
      if ((inst.knockout ?? 0) > 0) lostKnockouts++;
      freed.push(...replaceWithDetached(inst).map((x) => x.id));
    }
    state.selection = freed;
  });
  return lostKnockouts;
}

// Variant generator: every base x badge combination as a new artboard holding a
// linked instance of the base plus the badge (with knockout). Edit the base
// once and every variant follows.
export function generateVariants(baseIds: string[], keys: BadgeKey[], circle: boolean, gap = BADGE_GAP, corner: Corner = 'se'): Artboard[] {
  const bases = baseIds.map(artboardById).filter((a): a is Artboard => !!a);
  if (!bases.length || !keys.length) return [];
  const made: Artboard[] = [];
  edit(() => {
    for (const base of bases) {
      base.component = true;
      for (const key of keys) {
        const def = BADGES.find((b) => b.key === key)!;
        const [x, y] = freeSlot(base.w, base.h);
        const ab = newArtboard(`${base.name}_${def.suffix}${circle ? '_circle' : ''}`, x, y, base.w);
        ab.h = base.h;
        artboards().push(ab);
        const k = Math.min(ab.w, ab.h) / 24;
        const size = BADGE_SIZE * k;
        const [bx, by] = slot(ab, size, corner);
        const badge = newInstance(`badge:${key}${circle ? '_circle' : ''}`, bx, by, size / BADGE_BOX.w, gap * k);
        badge.fill = iconColorOf(base);
        shapes().push(newInstance(base.id, ab.x, ab.y, 1), badge);
        made.push(ab);
      }
    }
    if (made.length) setActiveArtboard(made[0].id, true);
  });
  return made;
}
