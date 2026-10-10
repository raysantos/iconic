// Core document types shared by every module.

export type Pt = [number, number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Style {
  fill: string; // 'none' or a color
  stroke: string;
  strokeWidth: number;
}

export interface Base extends Style {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  rotation?: number; // degrees, around the shape's bounding-box center
}

// A Bezier anchor point with optional absolute-position control handles.
export interface BNode {
  p: Pt;
  in?: Pt;
  out?: Pt;
  smooth?: boolean; // handles stay collinear when one is dragged
}

export type Shape =
  | (Base & { type: 'rect'; x: number; y: number; w: number; h: number })
  | (Base & { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
  | (Base & { type: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (Base & { type: 'path'; points: Pt[] }) // freehand
  | (Base & { type: 'bezier'; nodes: BNode[]; closed: boolean });

export type BezierShape = Extract<Shape, { type: 'bezier' }>;

export interface Doc {
  name: string;
  size: number;
  shapes: Shape[];
}

export type Tool =
  | 'select' // V
  | 'direct' // A
  | 'pen' // P
  | 'addAnchor' // +
  | 'deleteAnchor' // -
  | 'convertAnchor' // Shift+C
  | 'rect' // M
  | 'ellipse' // L
  | 'line' // \
  | 'pencil' // N
  | 'hand' // H
  | 'zoom'; // Z

export const SIZES = [16, 24, 32, 48]; // artboard sizes in px (viewBox 0 0 size size)
export const SVG_NS = 'http://www.w3.org/2000/svg';

export const TYPE_LABEL: Record<Shape['type'], string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  path: 'Pencil',
  bezier: 'Path',
};
