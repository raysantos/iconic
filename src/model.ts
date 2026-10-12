// Core document types shared by every module.

export type Pt = [number, number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Cap = 'round' | 'butt' | 'square';
export type Join = 'round' | 'miter' | 'bevel';

export interface Style {
  fill: string; // 'none' or a color
  stroke: string;
  strokeWidth: number;
  cap?: Cap; // default round
  join?: Join; // default round
}

// Material Symbols styles; each maps to stroke ends, corners and corner radius.
export type IconStyle = 'outlined' | 'rounded' | 'sharp';
export const ICON_STYLES: Record<IconStyle, { cap: Cap; join: Join; radius: number }> = {
  outlined: { cap: 'butt', join: 'miter', radius: 2 },
  rounded: { cap: 'round', join: 'round', radius: 2 },
  sharp: { cap: 'butt', join: 'miter', radius: 0 },
};

// Optical sizes offered by Material Symbols.
export const ICON_SIZES = [20, 24, 40, 48];
// Common icon sizes when Material mode is off.
export const GENERAL_SIZES = [16, 24, 32, 48, 64];

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
  radius?: number; // Smart Corner: live rounding of a sharp point
}

export type Shape =
  | (Base & { type: 'rect'; x: number; y: number; w: number; h: number; r?: number }) // r = corner radius
  | (Base & { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
  | (Base & { type: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (Base & { type: 'path'; points: Pt[] }) // freehand
  | (Base & { type: 'bezier'; nodes: BNode[]; closed: boolean })
  // Non-destructive boolean group: children stay editable, the result is live.
  | (Base & { type: 'boolean'; op: BoolOp; children: Shape[] })
  // A linked copy of a component artboard (or a built-in badge). `knockout` > 0
  // cuts that much clearance out of everything below it on its artboard.
  | (Base & { type: 'instance'; ref: string; x: number; y: number; scale: number; knockout?: number });

export type BezierShape = Extract<Shape, { type: 'bezier' }>;
export type BooleanShape = Extract<Shape, { type: 'boolean' }>;
export type InstanceShape = Extract<Shape, { type: 'instance' }>;

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';
export const BOOL_LABEL: Record<BoolOp, string> = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' };

// A region of the canvas that exports as one icon (like Illustrator).
export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  component?: boolean; // can be placed in other icons as a linked instance
  // Masters (like Material Symbols' variable axes): on the base artboard, its own
  // weight and fill, plus one extra master artboard per axis. Its optical size is its width.
  variations?: { wght: number; FILL: number; GRAD?: number; masters: { id: string; axis: AxisTag; value: number }[] };
  masterOf?: string; // this artboard is a master of another (the base)
  generated?: { from: string; loc: Loc }; // made by Generate
}

// Material Symbols' variable axes: weight, fill, grade and optical size.
export type AxisTag = 'wght' | 'FILL' | 'GRAD' | 'opsz';
export type Loc = Record<AxisTag, number>;

export interface Doc {
  name: string;
  iconStyle?: IconStyle;
  artboards: Artboard[];
  shapes: Shape[]; // canvas coordinates, shared by all artboards
}

export type Tool =
  | 'select' // V
  | 'artboard' // Shift+O
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

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const TYPE_LABEL: Record<Shape['type'], string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  path: 'Pencil',
  bezier: 'Path',
  boolean: 'Boolean',
  instance: 'Instance',
};
