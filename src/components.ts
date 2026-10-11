// Components (artboards reused as linked instances) and the built-in badge
// library used for modifier icons like file + plus.
import { center, worldBox } from './geometry';
import type { BNode, Box, InstanceShape, Shape } from './model';
import { artboardById, inside, shapes } from './store';

export interface Source {
  name: string;
  box: Box; // the source's own frame; instance x/y/scale map it onto the canvas
  shapes: Shape[];
  artboardId?: string;
}

// ---- Badges --------------------------------------------------------------------

// Drawn in a 10×10 box (a 10dp badge on a 24dp icon), Material-style 2dp strokes.
export const BADGES = [
  { key: 'plus', label: 'Plus', suffix: 'add' },
  { key: 'minus', label: 'Minus', suffix: 'remove' },
  { key: 'check', label: 'Check', suffix: 'check' },
  { key: 'close', label: 'Close', suffix: 'close' },
  { key: 'alert', label: 'Alert', suffix: 'alert' },
  { key: 'up', label: 'Up', suffix: 'upload' },
  { key: 'down', label: 'Down', suffix: 'download' },
] as const;
export type BadgeKey = (typeof BADGES)[number]['key'];
export const BADGE_BOX: Box = { x: 0, y: 0, w: 10, h: 10 };

const ink = { fill: '#000000', stroke: '#000000', strokeWidth: 0 };
const line = (pts: [number, number][], w = 2): Shape => ({
  id: '',
  type: 'bezier',
  nodes: pts.map((p) => ({ p }) as BNode),
  closed: false,
  fill: 'none',
  stroke: '#000000',
  strokeWidth: w,
  cap: 'butt',
  join: 'miter',
});
const bar = (x: number, y: number, w: number, h: number): Shape => ({ id: '', type: 'rect', x, y, w, h, ...ink });

// Glyphs drawn to fill the whole 10×10 box (bare style).
function glyph(key: BadgeKey): Shape[] {
  switch (key) {
    case 'plus':
      return [bar(4, 0, 2, 10), bar(0, 4, 10, 2)];
    case 'minus':
      return [bar(0, 4, 10, 2)];
    case 'check':
      return [line([[0.6, 5.2], [3.6, 8.2], [9.4, 2.2]])];
    case 'close':
      return [line([[1.2, 1.2], [8.8, 8.8]]), line([[8.8, 1.2], [1.2, 8.8]])];
    case 'alert':
      return [bar(4, 0, 2, 6.5), bar(4, 8, 2, 2)];
    case 'up':
      return [line([[5, 10], [5, 1.5]]), line([[1, 5], [5, 1], [9, 5]])];
    case 'down':
      return [line([[5, 0], [5, 8.5]]), line([[1, 5], [5, 9], [9, 5]])];
  }
}

// Shrink a glyph into a smaller box (for the circle style).
function inset(list: Shape[], k: number, off: number): Shape[] {
  const f = (v: number) => off + v * k;
  return list.map((s) => {
    if (s.type === 'rect') return { ...s, x: f(s.x), y: f(s.y), w: s.w * k, h: s.h * k };
    if (s.type === 'bezier') return { ...s, strokeWidth: s.strokeWidth * k, nodes: s.nodes.map((n) => ({ p: [f(n.p[0]), f(n.p[1])] as [number, number] })) };
    return s;
  });
}

const badgeCache = new Map<string, Source>();

// "badge:plus" (bare) or "badge:plus_circle" (glyph cut out of a solid circle).
function badgeSource(ref: string): Source | null {
  const hit = badgeCache.get(ref);
  if (hit) return hit;
  const [key, style] = ref.slice(6).split('_') as [BadgeKey, string | undefined];
  const def = BADGES.find((b) => b.key === key);
  if (!def) return null;
  let list: Shape[];
  if (style === 'circle') {
    list = [
      {
        id: `${ref}-circle`,
        type: 'boolean',
        op: 'subtract',
        children: [{ id: '', type: 'ellipse', cx: 5, cy: 5, rx: 5, ry: 5, ...ink }, ...inset(glyph(key), 0.56, 2.2)],
        ...ink,
      },
    ];
  } else list = glyph(key);
  list = list.map((s, i) => ({ ...s, id: `${ref}-${i}` }) as Shape);
  const src: Source = { name: `${def.label}${style === 'circle' ? ' (circle)' : ''}`, box: BADGE_BOX, shapes: list };
  badgeCache.set(ref, src);
  return src;
}

// ---- Resolving instances ----------------------------------------------------------

// Just the frame (no shapes), so bounds never recurse through nested instances.
export function sourceBox(ref: string): Box | null {
  if (ref.startsWith('badge:')) return BADGE_BOX;
  const ab = artboardById(ref);
  return ab ? { x: ab.x, y: ab.y, w: ab.w, h: ab.h } : null;
}

let depth = 0;
const MAX_DEPTH = 6; // guards against a component containing itself

export function resolveSource(ref: string): Source | null {
  if (ref.startsWith('badge:')) return badgeSource(ref);
  const ab = artboardById(ref);
  if (!ab || depth >= MAX_DEPTH) return null;
  depth++;
  try {
    const list = shapes().filter((s) => !s.hidden && inside(ab, center(worldBox(s))));
    return { name: ab.name, box: ab, shapes: list, artboardId: ab.id };
  } finally {
    depth--;
  }
}

// Run \`fn\` one level deeper (rendering or measuring an instance's contents).
export function nested<T>(fn: () => T, fallback: T): T {
  if (depth >= MAX_DEPTH) return fallback;
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}

export function instanceBox(s: InstanceShape): Box {
  const b = sourceBox(s.ref) ?? BADGE_BOX;
  return { x: s.x, y: s.y, w: b.w * s.scale, h: b.h * s.scale };
}

export const instanceName = (s: InstanceShape) => (s.ref.startsWith('badge:') ? badgeSource(s.ref)?.name : artboardById(s.ref)?.name) ?? 'Missing component';
