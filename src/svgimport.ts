// SVG import: files, drag-and-drop and paste (Figma "Copy as SVG", Illustrator,
// web pages). Turns SVG elements into editable Iconic shapes: rects, ellipses and
// lines stay live shapes; paths become Bezier paths; a path with holes becomes an
// Exclude group so its holes stay holes.
import { mapNodes, toBezier } from './geometry';
import type { BNode, Pt, Shape, Style } from './model';
import { windingAsEvenOdd } from './pathops';

type M = [number, number, number, number, number, number]; // a b c d e f
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M) => ([x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface SvgSize {
  w: number;
  h: number;
}

export interface ImportResult {
  shapes: Shape[];
  skipped: string[]; // element kinds that can't be imported (text, images…)
}

// Pull the SVG out of whatever was copied: raw SVG code or a web page's HTML.
export function extractSvg(text: string): string | null {
  const m = text.match(/<svg[\s>][\s\S]*<\/svg>/i);
  return m ? m[0] : null;
}

function parse(text: string): SVGSVGElement | null {
  const svg = extractSvg(text);
  if (!svg) return null;
  let doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  // Inline SVG from a web page is HTML, not strict XML (missing xmlns, &nbsp;…).
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
    doc = new DOMParser().parseFromString(svg, 'text/html');
  }
  const root = doc.querySelector('svg');
  return root as SVGSVGElement | null;
}

const num = (v: string | null | undefined, d = 0) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : d;
};

function viewport(root: Element) {
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const dim = (a: string) => {
    const v = root.getAttribute(a);
    return v && !v.trim().endsWith('%') ? num(v, NaN) : NaN;
  };
  let [w, h] = [dim('width'), dim('height')];
  if (hasVb) {
    if (!(w > 0) && !(h > 0)) [w, h] = [vb[2], vb[3]];
    else if (!(w > 0)) w = (h * vb[2]) / vb[3];
    else if (!(h > 0)) h = (w * vb[3]) / vb[2];
  }
  if (!(w > 0) || !(h > 0)) [w, h] = [24, 24];
  // viewBox -> width/height, uniformly scaled and centered (preserveAspectRatio meet).
  let m: M = I;
  if (hasVb) {
    const k = Math.min(w / vb[2], h / vb[3]);
    m = [k, 0, 0, k, -vb[0] * k + (w - vb[2] * k) / 2, -vb[1] * k + (h - vb[3] * k) / 2];
  }
  return { w, h, m };
}

// The SVG's size in its own units (width/height, else its viewBox).
export function svgSize(text: string): SvgSize | null {
  const root = parse(text);
  if (!root) return null;
  const { w, h } = viewport(root);
  return { w, h };
}

// ---- Styles ----------------------------------------------------------------------

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'visibility', 'color', 'fill-opacity', 'stroke-opacity'];
const OWN = ['opacity', 'display'];
type Props = Record<string, string>;

interface Ctx {
  rules: { sel: string; decl: Props }[];
  root: Element;
  skipped: Set<string>;
}

function declarations(text: string): Props {
  const out: Props = {};
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!important/i, '').trim();
  }
  return out;
}

// Simple <style> rules (Illustrator writes .cls-1{fill:#231f20;}).
function cssRules(root: Element) {
  const rules: Ctx['rules'] = [];
  for (const st of root.querySelectorAll('style')) {
    const css = (st.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const decl = declarations(m[2]);
      for (const sel of m[1].split(',')) if (sel.trim()) rules.push({ sel: sel.trim(), decl });
    }
  }
  return rules;
}

function ownProps(e: Element, ctx: Ctx): Props {
  const out: Props = {};
  for (const k of [...INHERITED, ...OWN]) {
    const v = e.getAttribute(k);
    if (v !== null) out[k] = v.trim();
  }
  for (const r of ctx.rules) {
    try {
      if (e.matches(r.sel)) Object.assign(out, r.decl);
    } catch {
      /* selector the browser can't parse */
    }
  }
  const style = e.getAttribute('style');
  if (style) Object.assign(out, declarations(style));
  for (const k in out) if (out[k] === 'inherit') delete out[k];
  return out;
}

let probe: CanvasRenderingContext2D | null = null;

// Any CSS color -> '#RRGGBB' (or 'none' when fully transparent).
function color(v: string | undefined, props: Props, ctx: Ctx, fallback: string): string {
  if (v === undefined) return fallback;
  v = v.trim();
  if (v === 'none' || v === 'transparent') return 'none';
  if (v === 'currentColor' || v === 'currentcolor') return props.color ? color(props.color, {}, ctx, '#000000') : '#000000';
  const url = v.match(/url\(\s*['"]?#([^'")\s]+)/);
  if (url) {
    // Gradients and patterns fall back to their first stop's color.
    const ref = ctx.root.querySelector(`[id="${CSS.escape(url[1])}"]`);
    const stop = ref?.querySelector('stop');
    const sc = stop && (declarations(stop.getAttribute('style') ?? '')['stop-color'] ?? stop.getAttribute('stop-color'));
    return sc ? color(sc, props, ctx, '#000000') : v.includes(')') && v.split(')')[1].trim() ? color(v.split(')')[1], props, ctx, '#000000') : '#000000';
  }
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return fallback;
  probe.fillStyle = '#000000';
  probe.fillStyle = v;
  const c = String(probe.fillStyle);
  if (c.startsWith('#')) return c.toUpperCase();
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return fallback;
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  if (a === 0) return 'none';
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function paint(props: Props, m: M, ctx: Ctx): (Style & { evenodd: boolean }) | null {
  if (props.display === 'none' || props.visibility === 'hidden' || props.visibility === 'collapse') return null;
  if (num(props.opacity, 1) <= 0) return null;
  let fill = color(props.fill, props, ctx, '#000000'); // SVG's default fill is black
  let stroke = color(props.stroke, props, ctx, 'none');
  if (num(props['fill-opacity'], 1) <= 0) fill = 'none';
  if (num(props['stroke-opacity'], 1) <= 0) stroke = 'none';
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  let strokeWidth = stroke === 'none' ? 0 : num(props['stroke-width'], 1) * scale;
  if (!(strokeWidth > 0)) [strokeWidth, stroke] = [0, 'none'];
  // Invisible helpers (e.g. Material's <path d="M0 0h24v24H0z" fill="none"/>) are skipped.
  if (fill === 'none' && strokeWidth === 0) return null;
  const cap = props['stroke-linecap'];
  const join = props['stroke-linejoin'];
  return {
    fill,
    stroke: stroke === 'none' ? (fill === 'none' ? '#000000' : fill) : stroke,
    strokeWidth: Math.round(strokeWidth * 1000) / 1000,
    cap: cap === 'round' || cap === 'square' ? cap : 'butt', // SVG defaults: butt caps, miter joins
    join: join === 'round' || join === 'bevel' ? join : 'miter',
    evenodd: props['fill-rule'] === 'evenodd',
  };
}

// ---- Transforms ------------------------------------------------------------------

function transformOf(e: Element): M {
  const t = e.getAttribute('transform');
  let m: M = I;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    let n: M = I;
    switch (fn) {
      case 'matrix':
        if (a.length === 6) n = a as M;
        break;
      case 'translate':
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const [c, s] = [Math.cos(r), Math.sin(r)];
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

// A matrix that is only a uniform scale + rotation + move keeps rects and
// ellipses as live shapes (with rotation); anything else becomes a path.
function similarity(m: M): { k: number; deg: number } | null {
  const k = Math.hypot(m[0], m[1]);
  if (k < 1e-9 || Math.abs(m[0] - m[3]) > 1e-6 * k || Math.abs(m[1] + m[2]) > 1e-6 * k) return null;
  let deg = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  deg = Math.round(deg * 1000) / 1000;
  if (Math.abs(deg % 90) < 1e-3) deg = Math.round(deg);
  return { k, deg: ((deg % 360) + 360) % 360 };
}

// ---- Path data -------------------------------------------------------------------

interface Sub {
  nodes: BNode[];
  closed: boolean;
}

function tokens(d: string) {
  return d.match(/[a-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
}

// Path data -> subpaths of Bezier nodes (arcs and quadratics become cubics).
export function parsePathData(d: string): Sub[] {
  const t = tokens(d);
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  let pos: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastCtrl: Pt | null = null; // reflected by S
  let lastQuad: Pt | null = null; // reflected by T
  let cmd = '';
  let i = 0;
  const isCmd = (s: string | undefined) => !!s && /^[a-z]$/i.test(s);
  const n = () => Number(t[i++]);
  // Arc flags can be written without separators ("a1 1 0 011 1").
  const flag = () => {
    const s = t[i];
    if (s.length > 1 && /^[01]/.test(s)) {
      t[i] = s.slice(1);
      return Number(s[0]);
    }
    i++;
    return Number(s);
  };
  const begin = (p: Pt) => {
    cur = { nodes: [{ p }], closed: false };
    subs.push(cur);
  };
  const ensure = () => {
    if (!cur) begin(pos);
    return cur!;
  };
  const lineTo = (p: Pt) => {
    ensure().nodes.push({ p });
    pos = p;
  };
  const curveTo = (c1: Pt, c2: Pt, p: Pt) => {
    const s = ensure();
    s.nodes[s.nodes.length - 1].out = c1;
    s.nodes.push({ p, in: c2 });
    pos = p;
  };

  while (i < t.length) {
    if (isCmd(t[i])) cmd = t[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const [ox, oy] = rel ? pos : [0, 0];
    const C = cmd.toUpperCase();
    if (C !== 'Z' && (i >= t.length || isCmd(t[i]))) {
      cmd = ''; // command without numbers
      continue;
    }
    let ctrl: Pt | null = null;
    let quad: Pt | null = null;
    switch (C) {
      case 'M': {
        const p: Pt = [ox + n(), oy + n()];
        begin(p);
        pos = start = p;
        cmd = rel ? 'l' : 'L'; // extra pairs after M are lines
        break;
      }
      case 'L':
        lineTo([ox + n(), oy + n()]);
        break;
      case 'H':
        lineTo([ox + n(), pos[1]]);
        break;
      case 'V':
        lineTo([pos[0], (rel ? pos[1] : 0) + n()]);
        break;
      case 'C': {
        const c1: Pt = [ox + n(), oy + n()];
        const c2: Pt = [ox + n(), oy + n()];
        curveTo(c1, c2, [ox + n(), oy + n()]);
        ctrl = c2;
        break;
      }
      case 'S': {
        const c1: Pt = lastCtrl ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
        const c2: Pt = [ox + n(), oy + n()];
        curveTo(c1, c2, [ox + n(), oy + n()]);
        ctrl = c2;
        break;
      }
      case 'Q':
      case 'T': {
        const q: Pt = C === 'Q' ? [ox + n(), oy + n()] : lastQuad ? [2 * pos[0] - lastQuad[0], 2 * pos[1] - lastQuad[1]] : pos;
        const p: Pt = [ox + n(), oy + n()];
        const p0 = pos;
        curveTo([p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])], [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p);
        quad = q;
        break;
      }
      case 'A': {
        const [rx, ry, rot] = [n(), n(), n()];
        const [large, sweep] = [flag(), flag()];
        const p: Pt = [ox + n(), oy + n()];
        for (const [c1, c2, e] of arcToCubics(pos, rx, ry, rot, large, sweep, p)) curveTo(c1, c2, e);
        pos = p;
        break;
      }
      case 'Z': {
        if (cur) {
          const s: Sub = cur;
          const first = s.nodes[0];
          const last = s.nodes[s.nodes.length - 1];
          // The closing point usually repeats the first one: merge them.
          if (s.nodes.length > 1 && Math.hypot(last.p[0] - first.p[0], last.p[1] - first.p[1]) < 1e-6) {
            first.in = last.in;
            s.nodes.pop();
          }
          s.closed = true;
        }
        cur = null;
        pos = start;
        cmd = '';
        break;
      }
    }
    lastCtrl = ctrl;
    lastQuad = quad;
  }
  for (const s of subs) tidy(s.nodes);
  return subs.filter((s) => s.nodes.length > 1 || (s.nodes.length === 1 && s.closed));
}

// Drop handles that sit on their point; mark smooth points (collinear handles).
function tidy(nodes: BNode[]) {
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
  for (const nd of nodes) {
    if (nd.in && near(nd.in, nd.p)) delete nd.in;
    if (nd.out && near(nd.out, nd.p)) delete nd.out;
    if (nd.in && nd.out) {
      const a = [nd.p[0] - nd.in[0], nd.p[1] - nd.in[1]];
      const b = [nd.out[0] - nd.p[0], nd.out[1] - nd.p[1]];
      const cross = a[0] * b[1] - a[1] * b[0];
      const dot = a[0] * b[0] + a[1] * b[1];
      if (dot > 0 && Math.abs(cross) < 1e-3 * Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1])) nd.smooth = true;
    }
  }
}

// Elliptical arc (SVG endpoint form) as cubic segments of at most 90°.
function arcToCubics(p0: Pt, rx: number, ry: number, rotDeg: number, large: number, sweep: number, p: Pt): [Pt, Pt, Pt][] {
  if ((p0[0] === p[0] && p0[1] === p[1]) || !rx || !ry) return [[p0, p, p]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (p0[0] - p[0]) / 2;
  const dy = (p0[1] - p[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
  const step = dt / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Pt => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = (t: number): Pt => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: [Pt, Pt, Pt][] = [];
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * step;
    const b = a + step;
    const [pa, pb, da, db] = [at(a), s === segs - 1 ? p : at(b), deriv(a), deriv(b)];
    out.push([[pa[0] + k * da[0], pa[1] + k * da[1]], [pb[0] - k * db[0], pb[1] - k * db[1]], pb]);
  }
  return out;
}

// ---- Elements -> shapes ------------------------------------------------------------

const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'title', 'desc', 'metadata', 'style', 'script', 'lineargradient', 'radialgradient', 'pattern', 'filter', 'marker', 'foreignobject']);
const UNSUPPORTED: Record<string, string> = { text: 'text', image: 'images' };

const layerName = (e: Element) => e.getAttribute('data-name') ?? e.getAttribute('inkscape:label') ?? e.getAttribute('id') ?? undefined;

function walk(e: Element, m: M, inherited: Props, ctx: Ctx, out: Shape[], depth = 0) {
  const tag = e.localName.toLowerCase();
  if (SKIP.has(tag) || depth > 64) return;
  if (UNSUPPORTED[tag]) return void ctx.skipped.add(UNSUPPORTED[tag]);
  const own = ownProps(e, ctx);
  if (own.display === 'none' || num(own.opacity, 1) <= 0) return;
  const props: Props = { ...inherited };
  for (const k of INHERITED) if (k in own) props[k] = own[k];
  props.opacity = own.opacity ?? '1';
  props.display = own.display ?? '';
  let mm = mul(m, transformOf(e));

  if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'switch') {
    if (tag === 'svg' && depth > 0) mm = mul(mm, [1, 0, 0, 1, num(e.getAttribute('x')), num(e.getAttribute('y'))]);
    for (const c of e.children) walk(c, mm, props, ctx, out, depth + 1);
    return;
  }
  if (tag === 'use') {
    const href = (e.getAttribute('href') ?? e.getAttribute('xlink:href') ?? '').replace(/^#/, '');
    const ref = href && ctx.root.querySelector(`[id="${CSS.escape(href)}"]`);
    if (!ref) return;
    mm = mul(mm, [1, 0, 0, 1, num(e.getAttribute('x')), num(e.getAttribute('y'))]);
    const kids = ref.localName === 'symbol' ? [...ref.children] : [ref];
    for (const c of kids) walk(c, mm, props, ctx, out, depth + 1);
    return;
  }

  const style = paint(props, mm, ctx);
  if (!style) return;
  const { evenodd, ...base } = style;
  const name = layerName(e);
  const common = { id: '', ...(name ? { name } : {}), ...base };
  const sim = similarity(mm);
  const P = apply(mm);
  const attr = (k: string) => num(e.getAttribute(k) ?? declarations(e.getAttribute('style') ?? '')[k]);

  switch (tag) {
    case 'rect': {
      const [x, y, w, h] = [attr('x'), attr('y'), attr('width'), attr('height')];
      if (!(w > 0 && h > 0)) return;
      let rx = e.hasAttribute('rx') ? attr('rx') : NaN;
      let ry = e.hasAttribute('ry') ? attr('ry') : NaN;
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      const rect: Shape = { ...common, type: 'rect', x, y, w, h, ...(rx > 0 ? { r: Math.min((rx + ry) / 2, w / 2, h / 2) } : {}) };
      return void out.push(place(rect, mm, sim));
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [attr('cx'), attr('cy')];
      const rx = tag === 'circle' ? attr('r') : attr('rx');
      const ry = tag === 'circle' ? rx : attr('ry');
      if (!(rx > 0 && ry > 0)) return;
      return void out.push(place({ ...common, type: 'ellipse', cx, cy, rx, ry }, mm, sim));
    }
    case 'line': {
      const [a, b] = [P([attr('x1'), attr('y1')]), P([attr('x2'), attr('y2')])];
      return void out.push({ ...common, type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    }
    case 'polyline':
    case 'polygon': {
      const v = (e.getAttribute('points') ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
      const pts: Pt[] = [];
      for (let k = 0; k + 1 < v.length; k += 2) pts.push(P([v[k], v[k + 1]]));
      if (pts.length < 2) return;
      return void out.push({ ...common, type: 'bezier', nodes: pts.map((p) => ({ p })), closed: tag === 'polygon' });
    }
    case 'path': {
      const d = e.getAttribute('d') ?? '';
      const shape = pathShape(d, mm, evenodd, common as Shape & Style);
      if (shape) out.push(...shape);
      return;
    }
  }
}

// A rect/ellipse under a similarity transform stays a live shape (with rotation).
function place(s: Shape, m: M, sim: { k: number; deg: number } | null): Shape {
  if (!sim) {
    const b = toBezier(s);
    return { ...b, nodes: mapNodes(b.nodes, apply(m)) };
  }
  const P = apply(m);
  const flip = m[0] * m[3] - m[1] * m[2] < 0; // mirrored: corners just swap
  if (s.type === 'rect') {
    const [cx, cy] = P([s.x + s.w / 2, s.y + s.h / 2]);
    const [w, h] = [s.w * sim.k, s.h * sim.k];
    return { ...s, x: cx - w / 2, y: cy - h / 2, w, h, ...(s.r ? { r: s.r * sim.k } : {}), ...(sim.deg && !flip ? { rotation: sim.deg } : {}) };
  }
  if (s.type === 'ellipse') {
    const [cx, cy] = P([s.cx, s.cy]);
    return { ...s, cx, cy, rx: s.rx * sim.k, ry: s.ry * sim.k, ...(sim.deg && !flip ? { rotation: sim.deg } : {}) };
  }
  return s;
}

function pathShape(d: string, m: M, evenodd: boolean, common: Shape & Style): Shape[] | null {
  let subs = parsePathData(d);
  if (!subs.length) return null;
  const filled = common.fill !== 'none';
  const bez = (s: Sub, extra: Partial<Shape> = {}): Shape => ({ ...common, type: 'bezier', nodes: mapNodes(s.nodes, apply(m)), closed: s.closed || (filled && !common.strokeWidth), ...extra }) as Shape;
  if (subs.length === 1) return [bez(subs[0])];
  // Outline only: each subpath is its own path (they look the same side by side).
  if (!filled) return subs.map((s) => bez(s));
  // Filled with holes: an Exclude group fills like even-odd. Under the default
  // nonzero rule, overlapping contours are first re-cut so even-odd matches.
  if (!evenodd) {
    const fixed = windingAsEvenOdd(d);
    if (fixed) subs = parsePathData(fixed);
  }
  const children = subs.map((s) => bez(s, { name: undefined, stroke: common.fill, strokeWidth: 0, closed: true } as Partial<Shape>));
  for (const c of children) delete (c as { name?: string }).name;
  return [{ ...common, type: 'boolean', op: 'exclude', children } as Shape];
}

// SVG text -> shapes in the SVG's own units, then mapped by `outer`
// (scale k, then moved by tx/ty) onto the canvas.
export function importSvg(text: string, outer: { k: number; tx: number; ty: number }): ImportResult | null {
  const root = parse(text);
  if (!root) return null;
  const { w, h, m } = viewport(root);
  const ctx: Ctx = { rules: cssRules(root), root, skipped: new Set() };
  const start = mul([outer.k, 0, 0, outer.k, outer.tx, outer.ty], m);
  const out: Shape[] = [];
  const rootProps = ownProps(root, ctx);
  const props: Props = {};
  for (const k of INHERITED) if (k in rootProps) props[k] = rootProps[k];
  for (const c of root.children) walk(c, start, props, ctx, out, 1);
  // A Figma frame's white background (a rect covering the whole SVG) isn't part of the icon.
  const bg = out[0];
  if (out.length > 1 && bg.type === 'rect' && bg.fill === '#FFFFFF' && !bg.strokeWidth && !bg.rotation) {
    const [x0, y0] = [outer.tx, outer.ty];
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-3 * Math.max(1, w * outer.k);
    if (near(bg.x, x0) && near(bg.y, y0) && near(bg.w, w * outer.k) && near(bg.h, h * outer.k)) out.shift();
  }
  return { shapes: out, skipped: [...ctx.skipped] };
}
