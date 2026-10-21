// Boolean groups (non-destructive, like Figma).
import { BOOL_LABEL, type BoolOp, type BooleanShape, type Shape } from '../model';
import { allShapes, artboardById, containerOf, newId, shapes, state } from '../store';
import { editable, edit } from './edit';
import { shapesOn } from './artboards';

// ---- Boolean groups (non-destructive, like Figma) ---------------------------

// Two or more shapes -> a live boolean group; one selected group -> switch its
// operation. The shapes inside stay editable.
export function makeBoolean(op: BoolOp): string | null {
  const sel = editable();
  if (sel.length === 1 && sel[0].type === 'boolean') {
    const g = sel[0];
    if (g.op !== op) edit(() => ((g.op = op), (g.name = nextBoolName(op))));
    return null;
  }
  if (sel.length < 2) return 'Select two or more shapes';
  const c = containerOf(sel[0].id);
  if (!c || sel.some((s) => containerOf(s.id)?.list !== c.list)) return 'Shapes must be in the same group';
  const list = c.list;
  const inOrder = list.filter((s) => sel.includes(s)); // bottom to top
  const bottom = inOrder[0];
  const group: BooleanShape = {
    id: newId(),
    type: 'boolean',
    op,
    name: nextBoolName(op),
    children: inOrder,
    // Like Figma, the group takes the bottom shape's paint.
    fill: bottom.type === 'line' || bottom.fill === 'none' ? bottom.stroke : bottom.fill,
    stroke: bottom.stroke,
    strokeWidth: 0,
    cap: bottom.cap,
    join: bottom.join,
  };
  edit(() => {
    const at = list.indexOf(inOrder[inOrder.length - 1]);
    list.splice(at + 1, 0, group);
    for (const s of inOrder) list.splice(list.indexOf(s), 1);
    state.selection = [group.id];
  });
  return null;
}

// Fix for single-path export: white shapes drawn on top to fake holes become
// a Subtract group (everything else minus the white shapes), as Google does it.
export function whitesToSubtract(abId: string): boolean {
  const ab = artboardById(abId);
  if (!ab) return false;
  const on = shapesOn(ab).filter((s) => !s.hidden && !s.locked);
  const isWhite = (s: Shape) => (s.type !== 'line' && s.fill !== 'none' ? s.fill : s.strokeWidth > 0 ? s.stroke : '').toUpperCase() === '#FFFFFF';
  const whites = on.filter(isWhite);
  const rest = on.filter((s) => !isWhite(s));
  if (!whites.length || !rest.length) return false;
  const list = shapes();
  const base = rest.find((s) => s.type !== 'line' && s.fill !== 'none') ?? rest[0];
  const color = base.type !== 'line' && base.fill !== 'none' ? base.fill : base.stroke;
  const paint = { fill: color, stroke: base.stroke, strokeWidth: 0, cap: base.cap, join: base.join };
  const bottom: Shape = rest.length === 1 ? rest[0] : { id: newId(), type: 'boolean', op: 'union', name: nextBoolName('union'), children: rest, ...paint };
  const group: BooleanShape = { id: newId(), type: 'boolean', op: 'subtract', name: nextBoolName('subtract'), children: [bottom, ...whites], ...paint };
  edit(() => {
    const at = Math.max(...on.map((s) => list.indexOf(s)));
    list.splice(at + 1, 0, group);
    for (const s of on) list.splice(list.indexOf(s), 1);
    state.selection = [group.id];
  });
  return true;
}

export function nextBoolName(op: BoolOp) {
  return `${BOOL_LABEL[op]} ${allShapes().filter((s) => s.type === 'boolean' && s.op === op).length + 1}`;
}

// Release (Ctrl+Shift+G): put the shapes back where the group was.
export function releaseBoolean(): boolean {
  const groups = editable().filter((s): s is BooleanShape => s.type === 'boolean');
  if (!groups.length) return false;
  edit(() => {
    const freed: string[] = [];
    for (const g of groups) {
      const c = containerOf(g.id);
      if (!c) continue;
      c.list.splice(c.list.indexOf(g), 1, ...g.children);
      freed.push(...g.children.map((x) => x.id));
    }
    state.selection = freed;
  });
  return true;
}
