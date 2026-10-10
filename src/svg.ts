import { bbox, bezierToPath, center, pointsToPath, round } from './geometry';
import { SVG_NS, type Doc, type Shape } from './model';

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
  }
  if (s.rotation) {
    const [cx, cy] = center(bbox(s));
    setAttrs(e, { transform: `rotate(${round(s.rotation)} ${round(cx)} ${round(cy)})` });
  }
  return e;
}

export function shapeToElement(s: Shape): SVGElement {
  const e = shapeGeometry(s);
  setAttrs(e, {
    fill: s.type === 'line' ? 'none' : s.fill,
    stroke: s.strokeWidth > 0 ? s.stroke : 'none',
    'stroke-width': s.strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  return e;
}

export function exportSvgString(doc: Doc) {
  const root = el('svg', { xmlns: SVG_NS, viewBox: `0 0 ${doc.size} ${doc.size}`, width: doc.size, height: doc.size });
  for (const s of doc.shapes) if (!s.hidden) root.append(shapeToElement(s));
  return new XMLSerializer().serializeToString(root);
}
