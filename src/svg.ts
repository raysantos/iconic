import { bbox, bezierToPath, center, intersects, pointsToPath, round, worldBox } from './geometry';
import { nested, resolveSource } from './components';
import { booleanResult, geometryPath, knockoutPath } from './pathops';
import { SVG_NS, type Box, type Shape } from './model';

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, cls?: string) {
  const e = document.createElementNS(SVG_NS, tag);
  setAttrs(e, attrs);
  if (cls) e.setAttribute('class', cls);
  return e;
}

export function setAttrs(e: Element, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(typeof v === 'number' ? round(v) : v));
}

// Geometry only (no paint), used for hover outlines.
export function shapeGeometry(s: Shape): SVGElement {
  let e: SVGElement;
  switch (s.type) {
    case 'rect':
      e = el('rect', { x: s.x, y: s.y, width: s.w, height: s.h });
      if (s.r) setAttrs(e, { rx: Math.min(s.r, s.w / 2, s.h / 2) });
      break;
    case 'ellipse':
      e = el('ellipse', { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry });
      break;
    case 'line':
      e = el('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
      break;
    case 'path':
      e = el('path', { d: pointsToPath(s.points) });
      break;
    case 'bezier':
      e = el('path', { d: bezierToPath(s.nodes, s.closed) });
      break;
    case 'instance': {
      // Outline/hit area: the instance's frame.
      const b = bbox(s);
      e = el('rect', { x: b.x, y: b.y, width: b.w, height: b.h });
      break;
    }
    case 'boolean': {
      const r = booleanResult(s);
      // Until the geometry engine has loaded, show the children merged visually.
      e = el('path', { d: r ? r.d : s.children.filter((c) => !c.hidden).map(geometryPath).join(' '), 'fill-rule': r?.fillRule ?? 'nonzero' });
      break;
    }
  }
  if (s.rotation) {
    const [cx, cy] = center(bbox(s));
    setAttrs(e, { transform: `rotate(${round(s.rotation)} ${round(cx)} ${round(cy)})` });
  }
  return e;
}

export function shapeToElement(s: Shape): SVGElement {
  if (s.type === 'instance') return instanceElement(s);
  const e = shapeGeometry(s);
  setAttrs(e, {
    fill: s.type === 'line' ? 'none' : s.fill,
    stroke: s.strokeWidth > 0 ? s.stroke : 'none',
    'stroke-width': s.strokeWidth,
    'stroke-linecap': s.cap ?? 'round',
    'stroke-linejoin': s.join ?? 'round',
  });
  return e;
}

// An instance draws its source's artwork, placed by x/y/scale (and rotation).
function instanceElement(s: Extract<Shape, { type: 'instance' }>): SVGElement {
  const outer = el('g');
  const src = resolveSource(s.ref);
  const b = bbox(s);
  if (s.rotation) {
    const [cx, cy] = center(b);
    setAttrs(outer, { transform: `rotate(${round(s.rotation)} ${round(cx)} ${round(cy)})` });
  }
  if (!src) {
    // Its component was deleted: show a placeholder rather than nothing.
    outer.append(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: '#E91E63', 'stroke-width': 0.25, 'stroke-dasharray': '0.5 0.5' }));
    return outer;
  }
  const inner = el('g', { transform: `translate(${round(s.x)} ${round(s.y)}) scale(${s.scale}) translate(${round(-src.box.x)} ${round(-src.box.y)})` });
  inner.append(...nested(() => renderShapes(src.shapes), []));
  // A fill on the instance recolors its artwork (badges take the icon's color).
  if (s.fill !== 'none') {
    for (const n of inner.querySelectorAll('[fill],[stroke]')) {
      if (n.closest('mask')) continue;
      if (n.getAttribute('fill') && n.getAttribute('fill') !== 'none') n.setAttribute('fill', s.fill);
      if (n.getAttribute('stroke') && n.getAttribute('stroke') !== 'none') n.setAttribute('stroke', s.fill);
    }
  }
  outer.append(inner);
  return outer;
}

let maskSeq = 0;

// Render a list bottom to top. Knockout instances mask the shapes beneath them
// (a gap of `knockout` around the badge); `decorate` lets the canvas tag elements.
export function renderShapes(list: Shape[], decorate?: (e: SVGElement, s: Shape) => void): SVGElement[] {
  const out: SVGElement[] = [];
  const masks: { id: string; box: ReturnType<typeof worldBox>; index: number }[] = [];
  const defs = el('defs');
  list.forEach((s, i) => {
    if (s.hidden || s.type !== 'instance' || !(s.knockout && s.knockout > 0)) return;
    const d = knockoutPath(s);
    if (!d) return;
    const id = `ko${++maskSeq}`;
    const g = s.knockout;
    const b = worldBox(s);
    const area = { x: b.x - g - 1, y: b.y - g - 1, w: b.w + 2 * g + 2, h: b.h + 2 * g + 2 };
    // White = keep, black = cut. The mask only needs to cover the badge region.
    const m = el('mask', { id, maskUnits: 'userSpaceOnUse', x: -1e5, y: -1e5, width: 2e5, height: 2e5 });
    m.append(el('rect', { x: -1e5, y: -1e5, width: 2e5, height: 2e5, fill: '#fff' }), el('path', { d, fill: '#000' }));
    defs.append(m);
    masks.push({ id, box: area, index: i });
  });
  if (masks.length) out.push(defs);
  list.forEach((s, i) => {
    if (s.hidden) return;
    let e: SVGElement = shapeToElement(s);
    decorate?.(e, s);
    const b = worldBox(s);
    for (const m of masks) {
      if (m.index <= i || !intersects(m.box, b)) continue;
      const g = el('g', { mask: `url(#${m.id})` });
      g.append(e);
      e = g;
    }
    out.push(e);
  });
  return out;
}

// The shapes that overlap `box`, as a standalone SVG of that region.
export function exportSvgString(shapes: Shape[], box: Box) {
  const root = el('svg', { xmlns: SVG_NS, viewBox: `${round(box.x)} ${round(box.y)} ${round(box.w)} ${round(box.h)}`, width: box.w, height: box.h });
  root.append(...renderShapes(shapes.filter((s) => !s.hidden && intersects(worldBox(s), box))));
  return new XMLSerializer().serializeToString(root);
}
