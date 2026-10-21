// Selection, duplicate, nudge, arrange, lock and hide.
import { moveShape } from '../geometry';
import { type Shape } from '../model';
import { allShapes, containerOf, commit, newId, removeShape, selected, shapes, state } from '../store';
import { editable, edit } from './edit';
import { deleteArtboard } from './artboards';

// ---- Selection ---------------------------------------------------------

export function selectAll() {
  state.selection = shapes()
    .filter((s) => !s.hidden && !s.locked)
    .map((s) => s.id);
  commit();
}

export function deselect() {
  state.selection = [];
  state.artboardSelected = false;
  commit();
}

export function deleteSelection() {
  if (!state.selection.length && state.artboardSelected) return void deleteArtboard();
  if (!state.selection.length) return;
  edit(() => {
    state.selection.forEach(removeShape);
    state.selection = [];
  });
}

// A copy needs fresh ids all the way down (boolean groups contain shapes).
export function withNewIds<T extends Shape>(s: T): T {
  const c = { ...s, id: newId() };
  if (c.type === 'boolean') c.children = c.children.map(withNewIds);
  return c;
}

export function duplicateSelection(dx = 0, dy = 0): Shape[] {
  const clones: Shape[] = [];
  for (const s of editable()) {
    const list = containerOf(s.id)?.list ?? shapes();
    const c = withNewIds(structuredClone(s));
    moveShape(c, structuredClone(c), dx, dy);
    list.splice(list.indexOf(s) + 1, 0, c);
    clones.push(c);
  }
  return clones;
}

// Ctrl+D: repeat the last move (and copy, if it was an Alt-drag duplicate).
export function transformAgain() {
  const t = state.lastTransform;
  if (!t || !state.selection.length) return;
  edit(() => {
    if (t.copy) state.selection = duplicateSelection(t.dx, t.dy).map((s) => s.id);
    else for (const s of editable()) moveShape(s, structuredClone(s), t.dx, t.dy);
  });
}

export function nudge(dx: number, dy: number) {
  const sel = editable();
  if (!sel.length) return;
  edit(() => sel.forEach((s) => moveShape(s, structuredClone(s), dx, dy)));
  state.lastTransform = { dx, dy, copy: false };
}

// ---- Arrange -----------------------------------------------------------

export function arrange(how: 'forward' | 'backward' | 'front' | 'back') {
  if (!state.selection.length) return;
  edit(() => {
    // Arranges within the container of the first selected shape (top level or a group).
    const list = containerOf(state.selection[0])?.list ?? shapes();
    const sel = (s: Shape) => state.selection.includes(s.id);
    const reorder = (next: Shape[]) => list.splice(0, list.length, ...next);
    if (how === 'front') reorder([...list.filter((s) => !sel(s)), ...list.filter(sel)]);
    else if (how === 'back') reorder([...list.filter(sel), ...list.filter((s) => !sel(s))]);
    else if (how === 'forward') {
      for (let i = list.length - 2; i >= 0; i--) if (sel(list[i]) && !sel(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else {
      for (let i = 1; i < list.length; i++) if (sel(list[i]) && !sel(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
  });
}

// ---- Lock & hide (Ctrl+2 / Ctrl+3, with Alt to undo for everything) ----

export function lockSelection() {
  if (!state.selection.length) return;
  edit(() => {
    selected().forEach((s) => (s.locked = true));
    state.selection = [];
  });
}

export function unlockAll() {
  const locked = allShapes().filter((s) => s.locked);
  if (!locked.length) return;
  edit(() => {
    locked.forEach((s) => (s.locked = false));
    state.selection = locked.map((s) => s.id);
  });
}

export function hideSelection() {
  if (!state.selection.length) return;
  edit(() => {
    selected().forEach((s) => (s.hidden = true));
    state.selection = [];
  });
}

export function showAll() {
  const hidden = allShapes().filter((s) => s.hidden);
  if (!hidden.length) return;
  edit(() => {
    hidden.forEach((s) => (s.hidden = false));
    state.selection = hidden.map((s) => s.id);
  });
}
