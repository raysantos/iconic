// The canvas view (zoom, pan, fit) and drawing: artwork, artboards, grids, selection and point overlays, audit markers.
import { selectionBox } from '../actions/transform';
import { view as actionsView } from '../actions/edit';
import { bbox, center, intersects, toBezier, unionBox, worldBox } from '../geometry';
import { type Artboard, type BezierShape, type Box, type Pt, type Shape } from '../model';
import { activeArtboard, allShapes, artboards, byId, isSelected, selected, shapes, state } from '../store';
import { paintColor } from '../export';
import { AUDIT_LABEL, auditShape } from '../audit';
import { segmentAt } from '../curvetools';
import { flattenArtboard, hasPathOps, type Flattened } from '../pathops';
import { el, renderShapes, setAttrs, shapeGeometry } from '../svg';
import { guides, marquee, penPath, penHover, gesture, isOpen, groupInterior, isAnchorSel } from '../canvas';

export const svg = document.getElementById('canvas') as unknown as SVGSVGElement;
export const world = el('g');
svg.append(world);

// ---- View ----------------------------------------------------------------

// screen = world * zoom + (x, y), in CSS px relative to the canvas element.
export const viewState = { zoom: 1, x: 0, y: 0 };
export const viewListeners: (() => void)[] = [];
export const onViewChange = (fn: () => void) => viewListeners.push(fn);

export const u = () => 1 / viewState.zoom; // world units per screen pixel

// Only what's on screen, plus half a screen around it, is drawn. Line widths and
// marker sizes depend only on the zoom, so panning just moves the drawing until
// the view leaves the drawn area.
export let renderedZoom = NaN;
export let drawnArea: Box | null = null;
// The canvas size as last seen by the ResizeObserver: measuring it while drawing
// would force a page layout right after the panels change.
export let canvasSize = { w: 0, h: 0 };
export const setCanvasSize = (size: { w: number; h: number }) => (canvasSize = size);

export function viewArea(margin: number): Box | null {
  const { w, h } = canvasSize;
  if (!w || !h) return null; // not laid out yet: draw everything
  const [x0, y0] = toWorld(-w * margin, -h * margin);
  const [x1, y1] = toWorld(w * (1 + margin), h * (1 + margin));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const covers = (outer: Box | null, inner: Box | null) =>
  !inner || (!!outer && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h);

export function applyView() {
  setAttrs(world, { transform: `translate(${viewState.x} ${viewState.y}) scale(${viewState.zoom})` });
  if (viewState.zoom !== renderedZoom || !covers(drawnArea, viewArea(0))) render();
  viewListeners.forEach((fn) => fn());
}

export function screenSize() {
  const r = svg.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

export function zoomTo(box: Box, fill = 0.7) {
  const { w, h } = screenSize();
  if (!w || !h) return;
  const z = clampZoom(Math.min((w * fill) / Math.max(box.w, 1), (h * fill) / Math.max(box.h, 1)));
  viewState.zoom = z;
  viewState.x = w / 2 - (box.x + box.w / 2) * z;
  viewState.y = h / 2 - (box.y + box.h / 2) * z;
  applyView();
}

export const fitArtboard = () => zoomTo(activeArtboard());
export const fitAll = () => zoomTo(unionBox(artboards()), 0.85);

export function fitSelection() {
  const b = selectionBox();
  if (b) zoomTo(b.w || b.h ? b : { ...b, x: b.x - 1, y: b.y - 1, w: 2, h: 2 }, 0.6);
}

export const clampZoom = (z: number) => Math.min(256, Math.max(0.5, z));

export function zoomAt(factor: number, sx?: number, sy?: number) {
  const { w, h } = screenSize();
  [sx, sy] = [sx ?? w / 2, sy ?? h / 2];
  const z = clampZoom(viewState.zoom * factor);
  viewState.x = sx - ((sx - viewState.x) * z) / viewState.zoom;
  viewState.y = sy - ((sy - viewState.y) * z) / viewState.zoom;
  viewState.zoom = z;
  applyView();
}

// 100% = one icon pixel per screen pixel (Illustrator's Actual Size).
export const actualSize = () => zoomAt(1 / viewState.zoom);

actionsView.center = () => {
  const { w, h } = screenSize();
  return toWorld(w / 2, h / 2);
};

export function toWorld(sx: number, sy: number): Pt {
  return [(sx - viewState.x) / viewState.zoom, (sy - viewState.y) / viewState.zoom];
}

export function eventPoint(e: PointerEvent | MouseEvent): Pt {
  const r = svg.getBoundingClientRect();
  return toWorld(e.clientX - r.left, e.clientY - r.top);
}

// Snap increment: ½ px, 1 px, or the major grid spacing.
export function snapStep() {
  const p = state.prefs;
  return p.snapTo === 'half' ? 0.5 : p.snapTo === 'grid' ? p.gridSize : 1;
}
export const snap = (v: number) => {
  if (!state.prefs.snap) return Math.round(v * 100) / 100;
  const k = snapStep();
  return Math.round(v / k) * k;
};
export const snapPt = (p: Pt): Pt => [snap(p[0]), snap(p[1])];

export function guideOverlay(): SVGGElement {
  const g = el('g', {}, 'smart-guides');
  for (const gd of guides) {
    const [[x1, y1], [x2, y2]] = gd.line;
    if (x1 !== x2 || y1 !== y2) g.append(el('line', { x1, y1, x2, y2, 'stroke-width': u() }, 'smart-guide'));
    if (gd.label) {
      const [x, y] = gd.label.at;
      const w = (gd.label.text.length * 6 + 8) * u();
      const t = el('text', { x: x + 8 * u() + w / 2, y: y - 8 * u(), 'font-size': 10 * u(), 'text-anchor': 'middle' });
      t.textContent = gd.label.text;
      g.append(el('rect', { x: x + 8 * u(), y: y - 19 * u(), width: w, height: 15 * u(), rx: 2 * u() }, 'guide-label'), t);
      g.append(el('circle', { cx: x, cy: y, r: 2.5 * u() }, 'guide-dot'));
    }
  }
  return g;
}

// ---- Rendering -----------------------------------------------------------

export let hoverId: string | null = null;

// Hovering a row in the Layers panel outlines the shape here.
export function setHover(id: string | null) {
  if (id === hoverId) return;
  hoverId = id;
  render();
}

// Pointing at (or tapping) an issue in the Audit panel spotlights it here.
export let auditFocus: Pt | null = null;
export function setAuditFocus(at: Pt | null) {
  if (at === auditFocus || (at && auditFocus && at[0] === auditFocus[0] && at[1] === auditFocus[1])) return;
  auditFocus = at;
  render();
}

// Tools that edit points show anchors instead of the bounding box.
export const pointTools = new Set(['direct', 'addAnchor', 'deleteAnchor', 'convertAnchor']);

export function render() {
  renderedZoom = viewState.zoom;
  drawnArea = viewArea(0.5);
  const area = drawnArea;
  const near = (b: Box) => !area || intersects(b, area);
  world.replaceChildren();

  for (const ab of artboards()) {
    if (!near(ab)) continue;
    const bg = el('rect', { x: ab.x, y: ab.y, width: ab.w, height: ab.h }, 'artboard' + (state.artboardSelected && ab.id === state.activeArtboard ? ' selected' : ''));
    bg.dataset.artboardBg = ab.id;
    world.append(bg);
    if (state.prefs.keylines && state.prefs.materialMode) world.append(keylineTemplate(ab));
    if (state.prefs.grid) world.append(...gridLines(ab));
  }

  // Merged preview (Ctrl+Y): each icon as the single path it exports to. The
  // real shapes stay on top, invisible, so they can still be picked and edited.
  const merged = state.prefs.mergedPreview && hasPathOps();
  if (merged) {
    // Each shape's box once, not once per artboard (it was most of a merged redraw).
    const boxes = new Map(shapes().map((s) => [s, worldBox(s)]));
    for (const ab of artboards()) {
      if (!near(ab)) continue;
      const on = shapes().filter((s) => !s.hidden && intersects(boxes.get(s)!, ab)); // as export's visibleOn
      const flat = mergedOf(ab, on);
      if (!flat?.d) continue;
      const color = on.map(paintColor).find(Boolean) ?? '#000000';
      world.append(el('path', { d: flat.d, transform: `translate(${ab.x} ${ab.y})`, fill: color, 'fill-rule': flat.fillRule }, 'merged'));
    }
  }

  const onScreen = shapes().filter((s) => near(worldBox(s)));
  const drawn = renderShapes(onScreen, (e, s) => {
    e.dataset.id = s.id;
    if (s.locked) e.classList.add('locked');
    if (merged) e.classList.add('ghost');
  });
  world.append(...drawn);
  for (const s of onScreen) if (!s.hidden && s.type === 'boolean' && isOpen(s)) world.append(groupInterior(s));

  const overlay = el('g', {}, 'overlay');
  world.append(overlay);
  const sel = selected().filter((s) => !s.hidden);
  const busy = gesture && gesture.kind !== 'pan';

  const hovered = hoverId && !isSelected(hoverId) && !busy ? byId(hoverId) : null;
  if (hovered && !hovered.hidden) overlay.append(outline(hovered, 'hover-outline', 1.5));

  if (penPath) {
    overlay.append(nodeOverlay(penPath));
  } else if (pointTools.has(state.tool)) {
    for (const s of sel) {
      overlay.append(outline(s, 'sel-outline', 1));
      if (!s.locked) overlay.append(nodeOverlay(s.type === 'bezier' ? s : toBezier(s), s.id));
    }
  } else if (sel.length && gesture?.kind !== 'create') {
    if (sel.length > 1) for (const s of sel) overlay.append(outline(s, 'sel-outline', 1));
    overlay.append(transformBox(sel, state.tool === 'select'));
  }

  // Artboard labels sit above the artwork so they stay clickable.
  for (const ab of artboards()) if (near(ab)) world.insertBefore(artboardLabel(ab), overlay);
  const ab = activeArtboard();
  if (state.artboardSelected || state.tool === 'artboard') overlay.append(artboardBox(ab, state.tool === 'artboard' || state.tool === 'select'));

  // Audit markers: geometry problems, with the reason on hover.
  if (state.prefs.audit && !penPath) {
    for (const s of allShapes()) {
      if (s.hidden || s.locked || !near(worldBox(s))) continue;
      for (const issue of auditShape(s)) {
        const m = el('circle', { cx: issue.at[0], cy: issue.at[1], r: 4 * u(), 'stroke-width': 1.5 * u() }, 'audit-mark');
        m.dataset.audit = s.id;
        const t = el('title');
        t.textContent = `${AUDIT_LABEL[issue.kind]}: ${issue.message}`;
        m.append(t);
        overlay.append(m);
      }
    }
    if (auditFocus) {
      const [x, y] = auditFocus;
      const r = 14 * u();
      const arm = 10 * u();
      overlay.append(
        el('circle', { cx: x, cy: y, r, 'stroke-width': 2 * u() }, 'audit-focus'),
        el('path', { d: `M${x - r - arm} ${y}h${arm}M${x + r} ${y}h${arm}M${x} ${y - r - arm}v${arm}M${x} ${y + r}v${arm}`, 'stroke-width': 2 * u() }, 'audit-focus-cross'),
        el('circle', { cx: x, cy: y, r: 2.5 * u() }, 'audit-focus-dot'),
      );
    }
  }
  if (guides.length) overlay.append(guideOverlay());
  if (marquee) overlay.append(el('rect', { x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h, 'stroke-width': u() }, 'marquee'));
}

// Merging is the slowest part of a redraw (a Skia union per artboard), so each
// artboard's result is kept until its shapes change. Artboards with component
// instances are always redone: their look also depends on other artboards.
export const mergedCache = new Map<string, { key: string; flat: Flattened | null }>();
export function mergedOf(ab: Artboard, on: Shape[]): Flattened | null {
  if (allShapes(on).some((s) => s.type === 'instance')) return flattenArtboard(on, ab);
  const key = `${ab.x} ${ab.y} ${ab.w} ${ab.h}` + JSON.stringify(on);
  const hit = mergedCache.get(ab.id);
  if (hit?.key === key) return hit.flat;
  const flat = flattenArtboard(on, ab);
  mergedCache.set(ab.id, { key, flat });
  return flat;
}

// Pixel lines (when zoomed in enough) plus a stronger line every `gridSize` px.
export function gridLines(ab: Artboard): SVGElement[] {
  const out: SVGElement[] = [];
  const lines = (step: number) => {
    let d = '';
    for (let x = step; x < ab.w; x += step) d += `M${ab.x + x} ${ab.y}v${ab.h}`;
    for (let y = step; y < ab.h; y += step) d += `M${ab.x} ${ab.y + y}h${ab.w}`;
    return d;
  };
  if (viewState.zoom >= 6) out.push(el('path', { d: lines(1), 'stroke-width': u() }, 'grid'));
  const g = state.prefs.gridSize;
  if (g > 1 && viewState.zoom * g >= 6) out.push(el('path', { d: lines(g), 'stroke-width': u() }, 'grid grid-major'));
  return out;
}

// Material Design system icon template, scaled to the artboard: 2dp padding
// (trim area), 20dp live area, and the four keyline shapes.
export function keylineTemplate(ab: Artboard): SVGGElement {
  const k = Math.min(ab.w, ab.h) / 24;
  const [cx, cy] = center(ab);
  const g = el('g', { 'stroke-width': u() }, 'keylines');
  const pad = 2 * k;
  g.append(
    el('path', { d: `M${ab.x} ${ab.y}h${ab.w}v${ab.h}h${-ab.w}z M${ab.x + pad} ${ab.y + pad}v${ab.h - 2 * pad}h${ab.w - 2 * pad}v${-(ab.h - 2 * pad)}z`, 'fill-rule': 'evenodd' }, 'trim'),
    el('circle', { cx, cy, r: 10 * k }),
    el('rect', { x: cx - 9 * k, y: cy - 9 * k, width: 18 * k, height: 18 * k }),
    el('rect', { x: cx - 8 * k, y: cy - 10 * k, width: 16 * k, height: 20 * k }),
    el('rect', { x: cx - 10 * k, y: cy - 8 * k, width: 20 * k, height: 16 * k }),
    el('path', { d: `M${cx} ${ab.y}V${ab.y + ab.h}M${ab.x} ${cy}H${ab.x + ab.w}M${ab.x} ${ab.y}L${ab.x + ab.w} ${ab.y + ab.h}M${ab.x + ab.w} ${ab.y}L${ab.x} ${ab.y + ab.h}` }, 'axes'),
  );
  return g;
}

export function artboardLabel(ab: Artboard): SVGGElement {
  const g = el('g', {}, 'artboard-label' + (ab.id === state.activeArtboard ? ' active' : ''));
  g.dataset.artboard = ab.id;
  const fs = 11 * u();
  const text = el('text', { x: ab.x, y: ab.y - 6 * u(), 'font-size': fs });
  // Like Figma, long names are cut short to fit (the active artboard shows its full name).
  const fits = Math.max(1, Math.floor((ab.w + state.prefs.abGap) / u() / 6.5));
  const short = ab.id !== state.activeArtboard && ab.name.length > fits;
  const shown = short ? ab.name.slice(0, Math.max(1, fits - 1)) + '…' : ab.name;
  text.textContent = shown;
  if (short) {
    const tip = el('title');
    tip.textContent = ab.name;
    text.append(tip);
  }
  // Generous invisible hit area: text alone is hard to click.
  g.append(el('rect', { x: ab.x, y: ab.y - 20 * u(), width: Math.max(ab.w, (shown.length * 6.5 + 8) * u()), height: 18 * u() }, 'label-hit'), text);
  return g;
}

export type AbHandle = 'nw' | 'ne' | 'se' | 'sw';

export function artboardBox(ab: Artboard, interactive: boolean): SVGGElement {
  const g = el('g');
  g.append(el('rect', { x: ab.x, y: ab.y, width: ab.w, height: ab.h, 'stroke-width': 1.5 * u() }, 'bounds artboard-bounds'));
  if (!interactive) return g;
  const pos: Record<AbHandle, Pt> = { nw: [ab.x, ab.y], ne: [ab.x + ab.w, ab.y], se: [ab.x + ab.w, ab.y + ab.h], sw: [ab.x, ab.y + ab.h] };
  for (const [h, [x, y]] of Object.entries(pos) as [AbHandle, Pt][]) {
    const r = 4 * u();
    g.append(el('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, 'stroke-width': u() }, 'handle-sq'));
    const hit = el('rect', { x: x - 3 * r, y: y - 3 * r, width: 6 * r, height: 6 * r }, `handle-hit h-${h}`);
    hit.dataset.abHandle = h;
    g.append(hit);
  }
  return g;
}

export function outline(s: Shape, cls: string, px: number) {
  const g = shapeGeometry(s);
  g.setAttribute('class', cls);
  g.setAttribute('stroke-width', String(px * u()));
  return g;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const coarse = matchMedia('(pointer: coarse)');

// Figma-style bounding box: 8 square handles, rotate zones off the corners,
// and a size badge underneath. A single shape's box follows its rotation.
// Handles only respond to the Selection tool (as in Illustrator).
export function transformBox(sel: Shape[], interactive: boolean): SVGGElement {
  const g = el('g');
  const single = sel.length === 1 ? sel[0] : null;
  const b = single ? bbox(single) : unionBox(sel.map(worldBox));
  const rot = single?.rotation ?? 0;
  const [cx, cy] = center(b);
  if (rot) g.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);
  const locked = sel.every((s) => s.locked);

  g.append(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, 'stroke-width': u() }, 'bounds'));
  if (locked || !interactive) return g;

  const pos: Record<Handle, Pt> = {
    nw: [b.x, b.y],
    n: [cx, b.y],
    ne: [b.x + b.w, b.y],
    e: [b.x + b.w, cy],
    se: [b.x + b.w, b.y + b.h],
    s: [cx, b.y + b.h],
    sw: [b.x, b.y + b.h],
    w: [b.x, cy],
  };
  const tiny = b.w * viewState.zoom < 24 || b.h * viewState.zoom < 24;

  for (const h of HANDLES) {
    if (h.length === 1 && tiny) continue; // edge handles crowd small boxes
    const [x, y] = pos[h];
    if (h.length === 2) {
      // Rotate zone hugging each corner on the diagonal (mouse).
      const ox = (h.includes('e') ? 1 : -1) * 6 * u();
      const oy = (h.includes('s') ? 1 : -1) * 6 * u();
      const zone = el('circle', { cx: x + ox, cy: y + oy, r: 10 * u() }, 'rot-zone');
      zone.dataset.rotate = '1';
      g.append(zone);
    }
    const r = 4 * u();
    // Corner resize hits stay snug (mouse) so the rotate zone starts close to the box.
    const hr = h.length === 2 && !coarse.matches ? 1.75 * r : 3 * r;
    const sq = el('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, 'stroke-width': u() }, 'handle-sq');
    const hit = el('rect', { x: x - hr, y: y - hr, width: hr * 2, height: hr * 2 }, `handle-hit h-${h}`);
    hit.dataset.handle = h;
    g.append(sq, hit);
  }

  // Touch has no hover, so give it a visible rotate handle.
  if (coarse.matches) {
    const ry = b.y - 28 * u();
    g.append(el('line', { x1: cx, y1: b.y, x2: cx, y2: ry, 'stroke-width': u() }, 'bounds'));
    g.append(el('circle', { cx, cy: ry, r: 5 * u(), 'stroke-width': u() }, 'handle-sq'));
    const hit = el('circle', { cx, cy: ry, r: 16 * u() }, 'handle-hit');
    hit.dataset.rotate = '1';
    g.append(hit);
  }

  // Size badge (always upright, below the box).
  const wb = single ? worldBox(single) : b;
  const text = `${fmt(b.w)} × ${fmt(b.h)}`;
  const fs = 11 * u();
  const bw = (text.length * 6.4 + 10) * u();
  const bx = wb.x + wb.w / 2 - bw / 2;
  const by = wb.y + wb.h + 8 * u();
  const badge = el('g', {}, 'size-badge');
  badge.append(el('rect', { x: bx, y: by, width: bw, height: 16 * u(), rx: 2 * u() }));
  const t = el('text', { x: bx + bw / 2, y: by + 11.5 * u(), 'font-size': fs, 'text-anchor': 'middle' });
  t.textContent = text;
  badge.append(t);
  const outer = el('g');
  outer.append(g, badge);
  return outer;
}

export const fmt = (v: number) => String(Math.round(v * 100) / 100);

// ---- Bezier points overlay ---------------------------------------------

export type NodePart = 'p' | 'in' | 'out';

export function nodeOverlay(s: BezierShape, sid = s.id): SVGGElement {
  const g = el('g');
  if (s.rotation) {
    const [cx, cy] = center(bbox(s));
    g.setAttribute('transform', `rotate(${s.rotation} ${cx} ${cy})`);
  }
  if (s === penPath && penHover && !gesture) {
    const last = s.nodes[s.nodes.length - 1];
    const c = last.out ?? last.p;
    const d = `M${last.p[0]} ${last.p[1]} C${c[0]} ${c[1]} ${penHover[0]} ${penHover[1]} ${penHover[0]} ${penHover[1]}`;
    g.append(el('path', { d, 'stroke-width': u() }, 'pen-preview'));
  }
  // Tunni lines (Direct Selection): drag to tune both handles of a curve,
  // double-click to balance them.
  if (state.tool === 'direct' && s !== penPath) {
    const count = s.closed ? s.nodes.length : s.nodes.length - 1;
    for (let seg = 0; seg < count; seg++) {
      const { b, c } = segmentAt(s.nodes, seg);
      if (!b || !c) continue;
      g.append(el('line', { x1: b[0], y1: b[1], x2: c[0], y2: c[1], 'stroke-width': u(), 'stroke-dasharray': `${3 * u()} ${3 * u()}` }, 'tunni'));
      const hit = el('line', { x1: b[0], y1: b[1], x2: c[0], y2: c[1], 'stroke-width': 10 * u() }, 'tunni-hit');
      Object.assign(hit.dataset, { tunni: String(seg), sid });
      g.append(hit);
    }
  }
  s.nodes.forEach((n, i) => {
    for (const part of ['in', 'out'] as const) {
      const h = n[part];
      if (!h) continue;
      g.append(el('line', { x1: n.p[0], y1: n.p[1], x2: h[0], y2: h[1], 'stroke-width': u() }, 'node-arm'));
      g.append(nodeTarget(h, sid, i, part, 'node-handle'));
    }
  });
  s.nodes.forEach((n, i) => {
    const closeTarget = s === penPath && i === 0 && s.nodes.length > 1;
    const picked = isAnchorSel(sid, i) ? ' picked' : '';
    g.append(nodeTarget(n.p, sid, i, 'p', 'node-point' + (closeTarget ? ' close-target' : '') + picked));
  });
  return g;
}

export function nodeTarget([x, y]: Pt, sid: string, i: number, part: NodePart, cls: string) {
  const g = el('g', {}, cls);
  Object.assign(g.dataset, { sid, node: String(i), part });
  const r = (part === 'p' ? 3.5 : 3) * u();
  g.append(
    part === 'p'
      ? el('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, 'stroke-width': u() })
      : el('circle', { cx: x, cy: y, r, 'stroke-width': u() }),
    el('circle', { cx: x, cy: y, r: 12 * u() }, 'hit'),
  );
  return g;
}
