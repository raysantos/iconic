// Position, size, rotation and alignment (Design panel and handles).
import { bbox, center, moveShape, rotate, scaleKeepingRotation, scaleShape, unionBox, worldBox } from '../geometry';
import { type Box, type Pt, type Shape } from '../model';
import { selected } from '../store';
import { editable, type EditOpts, edit } from './edit';
import { artboardOf } from './artboards';

// ---- Geometry (Design panel and resize handles) -------------------------

// Scale shapes from box `from` to box `to`. Rotated shapes keep their
// rotation: their center moves with the box and their own size scales.
export function scaleShapes(list: Shape[], originals: Shape[], from: Box, to: Box) {
  list.forEach((s, i) => scaleKeepingRotation(s, originals[i], from, to));
}

// Rotate shapes as a group around `pivot`.
export function rotateShapes(list: Shape[], originals: Shape[], deg: number, pivot: Pt) {
  list.forEach((s, i) => {
    const o = originals[i];
    // A boolean group rotates the shapes inside it, so they stay directly editable.
    if (s.type === 'boolean' && o.type === 'boolean') return rotateShapes(s.children, o.children, deg, pivot);
    const c = center(bbox(o));
    const [nx, ny] = rotate(c, deg, pivot);
    moveShape(s, o, nx - c[0], ny - c[1]);
    s.rotation = (((o.rotation ?? 0) + deg) % 360 + 360) % 360;
  });
}

// Bounds shown in the Design panel: the shape's own box for a single
// selection (like Figma), otherwise the selection's bounds.
export function selectionBox(list = selected()): Box | null {
  if (!list.length) return null;
  return list.length === 1 ? bbox(list[0]) : unionBox(list.map(worldBox));
}

export type GeoField = 'x' | 'y' | 'w' | 'h' | 'rotation';

export function setGeometry(field: GeoField, value: number, opts: EditOpts = {}) {
  const list = editable();
  const box = selectionBox(list);
  if (!box || !Number.isFinite(value)) return;
  edit(() => {
    const originals = structuredClone(list);
    if (field === 'rotation') {
      const current = list.length === 1 ? (list[0].rotation ?? 0) : 0;
      rotateShapes(list, originals, value - current, center(box));
    } else if (field === 'x' || field === 'y') {
      const d = value - box[field];
      list.forEach((s, i) => moveShape(s, originals[i], field === 'x' ? d : 0, field === 'y' ? d : 0));
    } else {
      const to = { ...box, [field]: Math.max(0.01, value) };
      if (list.length === 1) scaleShape(list[0], originals[0], box, to);
      else scaleShapes(list, originals, box, to);
    }
  }, opts);
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

// One shape aligns to its artboard; several align to their combined bounds.
export function align(how: Align) {
  const list = editable();
  if (!list.length) return;
  const target = list.length === 1 ? artboardOf(list[0]) : unionBox(list.map(worldBox));
  edit(() => {
    for (const s of list) {
      const b = worldBox(s);
      let [dx, dy] = [0, 0];
      if (how === 'left') dx = target.x - b.x;
      if (how === 'hcenter') dx = target.x + target.w / 2 - (b.x + b.w / 2);
      if (how === 'right') dx = target.x + target.w - (b.x + b.w);
      if (how === 'top') dy = target.y - b.y;
      if (how === 'vcenter') dy = target.y + target.h / 2 - (b.y + b.h / 2);
      if (how === 'bottom') dy = target.y + target.h - (b.y + b.h);
      moveShape(s, structuredClone(s), dx, dy);
    }
  });
}
