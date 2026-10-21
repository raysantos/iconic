// Fill and stroke colors, the Material icon style, and corner radius.
import { toBezier } from '../geometry';
import { ICON_STYLES, type BezierShape, type IconStyle, type Style } from '../model';
import { allShapes, containerOf, commit, emit, savePrefs, state } from '../store';
import { editable, type EditOpts, edit } from './edit';

// ---- Color (Illustrator: D, X, Shift+X, /) -------------------------------

// Edits the current style and the selection together, so new shapes match.
export function setStyle(patch: Partial<Style>, opts: EditOpts = {}) {
  Object.assign(state.prefs.style, patch);
  savePrefs();
  const sel = editable();
  if (!sel.length) return opts.live ? emit('live') : commit();
  edit(() => sel.forEach((s) => Object.assign(s, patch)), opts);
}

export const defaultColors = () => setStyle({ fill: '#FFFFFF', stroke: '#000000', strokeWidth: 1 });

export function toggleFocus() {
  state.focus = state.focus === 'fill' ? 'stroke' : 'fill';
  commit();
}

export function swapFillStroke() {
  const s = editable()[0] ?? state.prefs.style;
  const fill = s.strokeWidth > 0 ? s.stroke : 'none';
  const stroke = s.fill;
  setStyle(stroke === 'none' ? { fill, strokeWidth: 0 } : { fill, stroke, strokeWidth: s.strokeWidth || 1 });
}

export function setNone() {
  setStyle(state.focus === 'fill' ? { fill: 'none' } : { strokeWidth: 0 });
}

// ---- Material icon style ------------------------------------------------

export const iconStyle = (): IconStyle => state.doc.iconStyle ?? 'outlined';

// Outlined / Rounded / Sharp: sets line ends, corners and rectangle corner
// radius for every shape and for new shapes.
export function setIconStyle(style: IconStyle) {
  if (style === iconStyle()) return;
  const { cap, join, radius } = ICON_STYLES[style];
  Object.assign(state.prefs.style, { cap, join });
  savePrefs();
  edit(() => {
    state.doc.iconStyle = style;
    for (const s of allShapes()) {
      Object.assign(s, { cap, join });
      if (s.type === 'rect') s.r = radius;
    }
  });
}

// A sharp point (no handles, not the end of an open path) can take a Smart Corner.
export const isCorner = (s: BezierShape, i: number) => !s.nodes[i].in && !s.nodes[i].out && (s.closed || (i > 0 && i < s.nodes.length - 1));

// Any shape as an editable path, in place (rotation baked in).
export function asBezier(id: string): BezierShape | null {
  const s = byIdAll(id);
  if (!s) return null;
  if (s.type === 'bezier' && !s.rotation) return s;
  if (s.type === 'boolean' || s.type === 'instance') return null;
  const b = toBezier(s);
  const c = containerOf(id);
  if (c) c.list[c.list.indexOf(s)] = b;
  return b;
}
export const byIdAll = (id: string) => allShapes().find((s) => s.id === id);

// Corner radius: picked points (Direct Selection), every sharp point of the
// selected paths, or rectangles' corners.
export function setCornerRadius(r: number, opts: EditOpts = {}) {
  if (!Number.isFinite(r)) return;
  const radius = Math.max(0, r);
  if (state.tool === 'direct' && state.anchors.length) {
    return edit(() => {
      for (const a of state.anchors) {
        const s = asBezier(a.sid);
        if (s && isCorner(s, a.i)) s.nodes[a.i].radius = radius;
      }
    }, opts);
  }
  const list = editable().filter((s) => s.type === 'rect' || s.type === 'bezier');
  if (!list.length) return;
  edit(() => {
    for (const s of list) {
      if (s.type === 'rect') s.r = radius;
      else if (s.type === 'bezier') s.nodes.forEach((n, i) => isCorner(s, i) && (n.radius = radius));
    }
  }, opts);
}
