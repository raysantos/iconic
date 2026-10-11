// Boolean operations and outline stroke via Google's Skia PathOps (WebAssembly).
import PathKitInit, { type PathKit, type SkPath } from 'pathkit-wasm/bin/pathkit.js';
import wasmUrl from 'pathkit-wasm/bin/pathkit.wasm?url';
import { nested, resolveSource } from './components';
import { bbox, bezierToPath, center, toBezier } from './geometry';
import type { Box, BooleanShape, InstanceShape, Shape } from './model';

let PK: PathKit | null = null;

export const pathOpsReady: Promise<void> = PathKitInit({ locateFile: () => wasmUrl })
  .then((pk) => {
    PK = pk;
  })
  .catch((err) => console.warn('Path operations unavailable:', err));

export const hasPathOps = () => !!PK;

// A shape's outline as SVG path data in canvas coordinates (rotation baked in).
export function geometryPath(s: Shape): string {
  if (s.type === 'boolean') return booleanResult(s)?.d ?? '';
  const b = toBezier(s);
  return bezierToPath(b.nodes, b.closed);
}

function unionInto(acc: SkPath | null, p: SkPath | null): SkPath | null {
  if (!p) return acc;
  if (!acc) return p;
  acc.op(p, PK!.PathOp.UNION);
  p.delete();
  return acc;
}

// A shape's outline as a Skia path, keeping a boolean result's fill rule
// (Subtract/Exclude holes rely on even-odd).
function toSkPath(s: Shape): SkPath | null {
  const d = geometryPath(s);
  if (!PK || !d) return null;
  const p = PK.FromSVGString(d);
  if (p && s.type === 'boolean' && booleanResult(s)?.fillRule === 'evenodd') p.setFillType(PK.FillType.EVENODD);
  return p;
}

// Everything a shape paints: its fill area plus its stroke turned into an outline.
// Shapes with neither still contribute their geometry (so they can cut holes).
function paintedArea(s: Shape): SkPath | null {
  if (!PK || s.hidden) return null;
  if (s.type === 'instance') return instanceArea(s);
  if (!geometryPath(s)) return null;
  const fills = s.type !== 'line' && s.fill !== 'none';
  let area = fills || s.strokeWidth <= 0 ? toSkPath(s) : null;
  if (s.strokeWidth > 0) {
    const stroke = toSkPath(s);
    const caps = { butt: PK.StrokeCap.BUTT, round: PK.StrokeCap.ROUND, square: PK.StrokeCap.SQUARE };
    const joins = { miter: PK.StrokeJoin.MITER, round: PK.StrokeJoin.ROUND, bevel: PK.StrokeJoin.BEVEL };
    if (stroke?.stroke({ width: s.strokeWidth, cap: caps[s.cap ?? 'round'], join: joins[s.join ?? 'round'], miter_limit: 4 })) {
      area = unionInto(area, stroke);
    } else stroke?.delete();
  }
  return area;
}

// ---- Instances & knockouts -----------------------------------------------------

// Paint a list bottom to top; a knockout instance first cuts its outline,
// grown by its gap, out of everything below it.
function areaOfList(list: Shape[]): SkPath | null {
  let acc: SkPath | null = null;
  for (const s of list) {
    if (s.hidden) continue;
    if (acc && s.type === 'instance' && (s.knockout ?? 0) > 0) {
      const cut = knockoutArea(s);
      if (cut) {
        acc.op(cut, PK!.PathOp.DIFFERENCE);
        cut.delete();
      }
    }
    acc = unionInto(acc, paintedArea(s));
  }
  return acc;
}

// An instance's artwork, placed: source frame -> instance box (+ rotation).
function instanceArea(s: InstanceShape): SkPath | null {
  const src = resolveSource(s.ref);
  if (!src || !PK) return null;
  const area = nested(() => areaOfList(src.shapes), null);
  if (!area) return null;
  const k = s.scale;
  let [a, b, c, d] = [k, 0, 0, k];
  let [tx, ty] = [s.x - src.box.x * k, s.y - src.box.y * k];
  if (s.rotation) {
    const r = (s.rotation * Math.PI) / 180;
    const [cos, sin] = [Math.cos(r), Math.sin(r)];
    const [cx, cy] = center(bbox(s));
    // rotate(placed) around the instance center
    [a, b, c, d] = [k * cos, -k * sin, k * sin, k * cos];
    const [px, py] = [tx - cx, ty - cy];
    [tx, ty] = [cx + px * cos - py * sin, cy + px * sin + py * cos];
  }
  area.transform(a, b, tx, c, d, ty, 0, 0, 1);
  return area;
}

// The clearance a knockout instance cuts: its area grown by the gap (round).
function knockoutArea(s: InstanceShape): SkPath | null {
  const area = instanceArea(s);
  if (!area || !PK) return area;
  const gap = s.knockout ?? 0;
  const ring = area.copy();
  if (ring.stroke({ width: gap * 2, join: PK.StrokeJoin.ROUND, cap: PK.StrokeCap.ROUND })) {
    area.op(ring, PK.PathOp.UNION);
  }
  ring.delete();
  return area;
}

const koCache = new Map<string, { key: string; d: string }>();

// SVG path data of a knockout's clearance, for masking the shapes below it.
export function knockoutPath(s: InstanceShape): string {
  if (!PK) return '';
  const src = resolveSource(s.ref);
  const key = JSON.stringify([s, src?.box, src?.shapes]);
  const hit = koCache.get(s.id);
  if (hit?.key === key) return hit.d;
  const area = knockoutArea(s);
  const d = area ? area.toSVGString() : '';
  area?.delete();
  koCache.set(s.id, { key, d });
  return d;
}

// Filled outline of any shape (used where a format has no masks, e.g. Android).
export function shapeAreaPath(s: Shape): string {
  const p = paintedArea(s);
  if (!p) return '';
  const d = p.toSVGString();
  p.delete();
  return d;
}


// ---- Boolean groups ----------------------------------------------------------

interface BoolResult {
  d: string;
  fillRule: 'nonzero' | 'evenodd';
  bounds: Box | null;
}

const cache = new Map<string, { key: string; result: BoolResult }>();

// Live result of a boolean group, cached until its children or operation change.
export function booleanResult(s: BooleanShape): BoolResult | null {
  if (!PK) return null;
  const key = s.op + JSON.stringify(s.children);
  const hit = cache.get(s.id);
  if (hit?.key === key) return hit.result;

  const parts = s.children.map(paintedArea).filter((p): p is SkPath => !!p);
  let acc: SkPath | null = parts.shift() ?? null;
  if (acc) {
    if (s.op === 'subtract') {
      // Figma/Illustrator "Minus Front": the bottom shape minus everything above it.
      const rest = parts.reduce<SkPath | null>((a, p) => unionInto(a, p), null);
      if (rest) {
        acc.op(rest, PK.PathOp.DIFFERENCE);
        rest.delete();
      }
    } else {
      const op = { union: PK.PathOp.UNION, intersect: PK.PathOp.INTERSECT, exclude: PK.PathOp.XOR }[s.op];
      for (const p of parts) {
        acc.op(p, op);
        p.delete();
      }
    }
  }
  const result: BoolResult = acc
    ? { d: acc.toSVGString(), fillRule: acc.getFillTypeString(), bounds: toBox(acc) }
    : { d: '', fillRule: 'nonzero', bounds: null };
  acc?.delete();
  cache.set(s.id, { key, result });
  return result;
}

function toBox(p: SkPath): Box | null {
  const b = p.computeTightBounds();
  if (!Number.isFinite(b.fLeft) || b.fRight < b.fLeft) return null;
  return { x: b.fLeft, y: b.fTop, w: b.fRight - b.fLeft, h: b.fBottom - b.fTop };
}

// ---- Single-path ("Google format") export -------------------------------------

export interface Flattened {
  d: string;
  fillRule: 'nonzero' | 'evenodd';
}

// Union of everything painted on the artboard, clipped to it, moved to (0,0)
// and scaled by `k` (e.g. 40 for Material Symbols' 960-unit grid).
export function flattenArtboard(shapes: Shape[], ab: Box, k = 1, yOffset = 0): Flattened | null {
  if (!PK) return null;
  let acc = areaOfList(shapes);
  if (!acc) return { d: '', fillRule: 'nonzero' };
  const clip = PK.FromSVGString(`M${ab.x} ${ab.y}h${ab.w}v${ab.h}h${-ab.w}z`);
  if (clip) {
    acc.op(clip, PK.PathOp.INTERSECT);
    clip.delete();
  }
  acc.simplify();
  acc.transform(k, 0, -ab.x * k, 0, k, -ab.y * k + yOffset, 0, 0, 1);
  const out: Flattened = { d: acc.toSVGString(), fillRule: acc.getFillTypeString() };
  acc.delete();
  return out;
}

// Path data moved/scaled: (x, y) -> (x * k + tx, y * k + ty).
export function transformPath(d: string, k: number, tx: number, ty: number): string {
  if (!PK || !d) return d;
  const p = PK.FromSVGString(d);
  if (!p) return d;
  p.transform(k, 0, tx, 0, k, ty, 0, 0, 1);
  const out = p.toSVGString();
  p.delete();
  return out;
}
