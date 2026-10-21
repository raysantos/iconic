// Artboards: add, duplicate, delete, rename, resize and arrange (artwork moves along).
import { center, moveShape, scaleShape, worldBox } from '../geometry';
import { type Artboard, type Box, type InstanceShape, type Pt, type Shape } from '../model';
import { activeArtboard, allShapes, artboardById, artboards, inside, newArtboard, newId, nextArtboardName, savePrefs, setActiveArtboard, shapes, state } from '../store';
import { type EditOpts, edit } from './edit';
import { withNewIds } from './selection';
import { replaceWithDetached } from './components';

// ---- Artboards -----------------------------------------------------------

// The artboard a shape belongs to: the one its center sits on (else the active one).
export function artboardOf(s: Shape): Artboard {
  const c = center(worldBox(s));
  return artboards().find((a) => inside(a, c)) ?? activeArtboard();
}

// Shapes that move, scale and duplicate with an artboard.
export function shapesOn(ab: Artboard) {
  return shapes().filter((s) => inside(ab, center(worldBox(s))));
}

export function moveArtboardBy(ab: Artboard, dx: number, dy: number, artwork = shapesOn(ab)) {
  ab.x += dx;
  ab.y += dy;
  for (const s of artwork) moveShape(s, structuredClone(s), dx, dy);
}

export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Next free cell in the artboard grid (columns × gap from the prefs).
export function freeSlot(w: number, h: number): Pt {
  const all = artboards();
  const o = all[0] ?? { x: 0, y: 0 };
  const { abColumns: cols, abGap: gap } = state.prefs;
  const px = Math.max(w, ...all.map((a) => a.w)) + gap;
  const py = Math.max(h, ...all.map((a) => a.h)) + gap;
  for (let i = 0; ; i++) {
    const box = { x: o.x + (i % cols) * px, y: o.y + Math.floor(i / cols) * py, w, h };
    if (!all.some((a) => overlaps(a, box))) return [box.x, box.y];
  }
}

export function addArtboard(): Artboard {
  const src = activeArtboard();
  const [x, y] = freeSlot(src.w, src.h);
  const ab = newArtboard(nextArtboardName(), x, y, src.w);
  ab.h = src.h;
  edit(() => {
    artboards().push(ab);
    setActiveArtboard(ab.id, true);
  });
  return ab;
}

// Artboard plus its artwork, placed in the next free grid cell.
export function duplicateArtboard(id = state.activeArtboard): Artboard | undefined {
  const src = artboardById(id);
  if (!src) return;
  const [x, y] = freeSlot(src.w, src.h);
  const ab = { ...src, id: newId(), name: `${src.name}_copy`, x, y };
  delete ab.variations; // a copy is a plain icon, not part of the master family
  delete ab.masterOf;
  delete ab.generated;
  edit(() => {
    const copies = structuredClone(shapesOn(src)).map(withNewIds);
    for (const s of copies) moveShape(s, structuredClone(s), x - src.x, y - src.y);
    shapes().push(...copies);
    artboards().splice(artboards().indexOf(src) + 1, 0, ab);
    setActiveArtboard(ab.id, true);
  });
  return ab;
}

// Removes the artboard only; its artwork stays on the canvas (as in Illustrator).
// Instances of it elsewhere are detached first so they keep their artwork.
export function deleteArtboard(id = state.activeArtboard) {
  if (artboards().length < 2) return false;
  edit(() => {
    for (const inst of allShapes().filter((x): x is InstanceShape => x.type === 'instance' && x.ref === id)) replaceWithDetached(inst);
    const i = artboards().findIndex((a) => a.id === id);
    artboards().splice(i, 1);
    setActiveArtboard(artboards()[Math.max(0, i - 1)].id);
  });
  return true;
}

export function renameArtboard(id: string, name: string) {
  const ab = artboardById(id);
  const clean = name.trim();
  if (!ab || !clean || clean === ab.name) return;
  edit(() => (ab.name = clean));
}

// X/Y move the artboard with its artwork; W/H resize it from the top-left.
export function setArtboardGeometry(field: 'x' | 'y' | 'w' | 'h', value: number, opts: EditOpts = {}) {
  const ab = activeArtboard();
  if (!Number.isFinite(value)) return;
  const v = field === 'w' || field === 'h' ? Math.max(1, Math.round(value)) : Math.round(value);
  edit(() => {
    if (field === 'x') moveArtboardBy(ab, v - ab.x, 0);
    else if (field === 'y') moveArtboardBy(ab, 0, v - ab.y);
    else ab[field] = v;
  }, opts);
}

// Icon size presets scale the artwork too (strokes included), so the icon looks the same.
export function setIconSize(next: number) {
  const ab = activeArtboard();
  const k = next / Math.max(ab.w, ab.h);
  if (k === 1) return;
  edit(() => {
    const from: Box = { ...ab };
    const to: Box = { x: ab.x, y: ab.y, w: Math.round(ab.w * k), h: Math.round(ab.h * k) };
    for (const s of shapesOn(ab)) {
      scaleShape(s, structuredClone(s), from, to);
      for (const x of allShapes([s])) x.strokeWidth *= k;
    }
    Object.assign(ab, { w: to.w, h: to.h });
  });
}

// Illustrator's "Rearrange All Artboards": lay them out in a grid, artwork included.
export function arrangeArtboards(columns = state.prefs.abColumns, gap = state.prefs.abGap) {
  state.prefs.abColumns = Math.max(1, Math.round(columns));
  state.prefs.abGap = Math.max(0, Math.round(gap));
  savePrefs();
  const all = artboards();
  const { abColumns: cols, abGap: g } = state.prefs;
  const o = { x: Math.min(...all.map((a) => a.x)), y: Math.min(...all.map((a) => a.y)) };
  // Uniform cells sized to the largest artboard keep the icons lined up.
  const cw = Math.max(...all.map((a) => a.w)) + g;
  const ch = Math.max(...all.map((a) => a.h)) + g;
  edit(() => {
    const artwork = all.map((ab) => shapesOn(ab)); // capture before anything moves
    all.forEach((ab, i) => {
      const x = o.x + (i % cols) * cw;
      const y = o.y + Math.floor(i / cols) * ch;
      moveArtboardBy(ab, x - ab.x, y - ab.y, artwork[i]);
    });
  });
}
