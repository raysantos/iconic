import type { BNode, Pt, Shape } from '../src/model';

const style = { fill: '#000000', stroke: 'none', strokeWidth: 0, cap: 'butt', join: 'miter' } as const;

export const rect = (id: string, x: number, y: number, w: number, h = w, r?: number): Shape => ({ id, type: 'rect', x, y, w, h, ...(r ? { r } : {}), ...style });
export const path = (id: string, pts: Pt[], closed = false): Shape => ({ id, type: 'bezier', nodes: pts.map((p) => ({ p })), closed, ...style });
export const group = (id: string, op: 'union' | 'subtract' | 'intersect' | 'exclude', children: Shape[]): Shape => ({ id, type: 'boolean', op, children, ...style });

export const closeTo = (a: Pt, b: Pt, eps = 1e-6) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
export const pts = (nodes: BNode[]) => nodes.map((n) => n.p);
