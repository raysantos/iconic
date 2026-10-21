// Masters and generated variations (weight, fill, grade, optical size).
import { combos, fillIn, interpolate, locSuffix, mastersOf, scaleWhole, snapToGrid } from '../masters';
import { type Artboard, type AxisTag } from '../model';
import { artboardById, artboards, newArtboard, newId, setActiveArtboard, shapes, state } from '../store';
import { edit } from './edit';
import { withNewIds } from './selection';
import { shapesOn, freeSlot } from './artboards';

// ---- Masters (weight, fill, optical size) ------------------------------------

export const MASTER_NAME: Record<AxisTag, (v: number) => string> = { wght: (v) => `@${v}`, FILL: () => '@filled', GRAD: (v) => `@grad${v}`, opsz: (v) => `@${v}dp` };

// Copy the icon onto a new master artboard for one axis: bolder (to be drawn
// bolder), filled (holes shrunk to nothing), graded (to be drawn a touch
// heavier, same size), or at another optical size (scaled).
// Returns the master and how many filled shapes are only approximate.
export function addMaster(id: string, axis: AxisTag, size = 48): { master: Artboard; approx: number } | null {
  const base = artboardById(id);
  if (!base || base.generated || (base.masterOf && artboardById(base.masterOf))) return null;
  if (mastersOf(base).some((m) => m.axis === axis)) return null;
  const value = axis === 'wght' ? (base.variations?.wght === 700 ? 100 : 700) : axis === 'FILL' ? 1 : axis === 'GRAD' ? 200 : size;
  const k = axis === 'opsz' ? size / base.w : 1;
  const [w, h] = [Math.round(base.w * k), Math.round(base.h * k)];
  const [x, y] = freeSlot(w, h);
  const master: Artboard = { id: newId(), name: base.name + MASTER_NAME[axis](value), x, y, w, h, masterOf: base.id };
  let approx = 0;
  edit(() => {
    const copies = structuredClone(shapesOn(base)).map(withNewIds);
    for (const s of copies) {
      scaleWhole(s, base, { x, y, w, h });
      if (axis === 'FILL') approx += fillIn(s);
    }
    shapes().push(...copies);
    const after = [base, ...mastersOf(base).map((m) => m.ab)].reduce((i, a) => Math.max(i, artboards().indexOf(a)), 0);
    artboards().splice(after + 1, 0, master);
    base.variations ??= { wght: 400, FILL: 0, masters: [] };
    base.variations.masters = base.variations.masters.filter((m) => artboardById(m.id));
    base.variations.masters.push({ id: master.id, axis, value });
    delete base.masterOf;
    setActiveArtboard(master.id, true);
  });
  return { master, approx };
}

// Unlink a master; its artboard stays as a plain icon.
export function removeMaster(baseId: string, masterId: string) {
  const base = artboardById(baseId);
  if (!base?.variations) return;
  edit(() => {
    base.variations!.masters = base.variations!.masters.filter((m) => m.id !== masterId);
    if (!base.variations!.masters.length) delete base.variations;
    const m = artboardById(masterId);
    if (m) delete m.masterOf;
  });
}

// The weight or grade of the base (`master` = false) or of that axis's master.
export function setAxisValue(baseId: string, axis: 'wght' | 'GRAD', master: boolean, value: number) {
  const base = artboardById(baseId);
  const v = base?.variations;
  const m = v?.masters.find((x) => x.axis === axis);
  if (!v || !m || !Number.isFinite(value) || value === (master ? m.value : (v[axis] ?? 0))) return;
  edit(() => {
    if (master) {
      m.value = value;
      const ab = artboardById(m.id);
      if (ab) ab.name = ab.name.replace(axis === 'wght' ? /@\d+$/ : /@grad-?\d+$/, MASTER_NAME[axis](value));
    } else v[axis] = value;
  });
}

// Generate an artboard for every combination of the picked values
// (replacing earlier generated ones).
export function generateVariations(baseId: string, picks: Partial<Record<AxisTag, number[]>>): Artboard[] {
  const base = artboardById(baseId);
  if (!base?.variations) return [];
  const locs = combos(base, picks);
  const made: Artboard[] = [];
  edit(() => {
    // Drop the previous set (and its artwork).
    for (const old of artboards().filter((a) => a.generated?.from === base.id)) {
      const gone = new Set(shapesOn(old));
      state.doc.shapes = shapes().filter((s) => !gone.has(s));
      artboards().splice(artboards().indexOf(old), 1);
    }
    for (const loc of locs) {
      const list = interpolate(base, loc);
      if (!list) continue;
      const k = loc.opsz / base.w;
      const [w, h] = [Math.round(base.w * k), Math.round(base.h * k)];
      const [x, y] = freeSlot(w, h);
      const ab: Artboard = { ...newArtboard(`${base.name}_${locSuffix(loc)}`, x, y, w), h, generated: { from: base.id, loc } };
      artboards().push(ab);
      for (const s of list.map(withNewIds)) {
        scaleWhole(s, base, { x, y, w, h });
        snapToGrid(s);
        shapes().push(s);
      }
      made.push(ab);
    }
  });
  return made;
}
