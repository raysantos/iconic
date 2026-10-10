import type { ExportFormat } from './export';
import { TYPE_LABEL, type Artboard, type Doc, type Shape, type Style, type Tool } from './model';

const DOC_KEY = 'iconic:doc';
const PREFS_KEY = 'iconic:prefs';

interface Prefs {
  style: Style; // applied to new shapes; follows the last edited selection, like Illustrator
  grid: boolean;
  snap: boolean;
  keylines: boolean; // Material icon template overlay
  smartGuides: boolean; // Ctrl+U
  gridSize: number; // major grid spacing in px (1 = pixel grid only)
  snapTo: 'half' | 'pixel' | 'grid';
  abColumns: number; // artboard grid layout
  abGap: number;
  exportFormat: ExportFormat;
  exportAll: boolean; // all artboards vs the active one
  densities: string[]; // Android PNG densities
  currentColor: boolean;
  singlePath: boolean; // Google format export
  grid960: boolean; // Material Symbols 960-unit SVG
  mergedPreview: boolean; // show icons as their merged single path (Ctrl+Y)
}

const DEFAULT_PREFS: Prefs = {
  // Material icons are solid black; Outlined is the default Material Symbols style.
  style: { fill: '#000000', stroke: '#000000', strokeWidth: 0, cap: 'butt', join: 'miter' },
  grid: true,
  snap: true,
  keylines: true,
  smartGuides: true,
  gridSize: 1,
  snapTo: 'pixel',
  abColumns: 4,
  abGap: 8,
  exportFormat: 'svg',
  exportAll: false,
  densities: ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'],
  currentColor: false,
  singlePath: true,
  grid960: true,
  mergedPreview: false,
};

export const state = {
  doc: loadDoc(),
  prefs: loadPrefs(),
  selection: [] as string[],
  // Direct Selection: individually selected anchor points.
  anchors: [] as { sid: string; i: number }[],
  activeArtboard: '', // the artboard that align, icon size and export use
  artboardSelected: false, // the active artboard itself is selected (not shapes)
  tool: 'select' as Tool,
  focus: 'fill' as 'fill' | 'stroke', // which swatch X / "/" act on
  clipboard: [] as Shape[],
  // Last move, so Ctrl+D (Transform Again) can repeat it.
  lastTransform: null as null | { dx: number; dy: number; copy: boolean },
};

// ---- Persistence -------------------------------------------------------

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; ignore */
  }
}

export function newArtboard(name: string, x = 0, y = 0, size = 24): Artboard {
  return { id: newId(), name, x, y, w: size, h: size };
}

type OldDoc = { name?: string; size: number; shapes: Shape[] };

function loadDoc(): Doc {
  const data = read<Doc | OldDoc | Shape[]>(DOC_KEY);
  // Older saves had a single fixed-size artboard.
  if (Array.isArray(data)) return { name: 'Untitled', artboards: [newArtboard('icon_1')], shapes: data };
  if (data && 'size' in data) return { name: data.name || 'Untitled', artboards: [newArtboard(data.name && data.name !== 'Untitled' ? snake(data.name) : 'icon_1', 0, 0, data.size)], shapes: data.shapes };
  if (data && 'artboards' in data && data.artboards.length) return data;
  return { name: 'Untitled', iconStyle: 'outlined', artboards: [newArtboard('icon_1')], shapes: [] };
}

function loadPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...read<Partial<Prefs>>(PREFS_KEY) };
}

export const savePrefs = () => write(PREFS_KEY, state.prefs);

// ---- Change notification -----------------------------------------------

// 'live': geometry changing mid-gesture (canvas + numbers only)
// 'full': document or selection changed (rebuild everything)
type Kind = 'live' | 'full';
const listeners: ((kind: Kind) => void)[] = [];
export const subscribe = (fn: (kind: Kind) => void) => listeners.push(fn);
export const emit = (kind: Kind = 'full') => listeners.forEach((fn) => fn(kind));

// Save and redraw after a finished edit.
export function commit() {
  write(DOC_KEY, state.doc);
  emit('full');
}

// ---- History -----------------------------------------------------------

const undoStack: string[] = [];
const redoStack: string[] = [];
const snapshot = () => JSON.stringify(state.doc);

export function checkpoint() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

// Drop the last checkpoint if nothing actually changed (e.g. a plain click).
export function discardIfUnchanged() {
  if (undoStack.at(-1) === snapshot()) undoStack.pop();
}

export const dropCheckpoint = () => undoStack.pop();

function restore(json: string) {
  state.doc = JSON.parse(json);
  const ids = new Set(allShapes().map((s) => s.id));
  state.selection = state.selection.filter((id) => ids.has(id));
  // Keep selected points that still exist (as Illustrator does after undo).
  state.anchors = state.anchors.filter((a) => {
    const s = allShapes().find((x) => x.id === a.sid);
    return s && (s.type !== 'bezier' || a.i < s.nodes.length);
  });
  if (!state.doc.artboards.some((a) => a.id === state.activeArtboard)) {
    state.activeArtboard = state.doc.artboards[0].id;
    state.artboardSelected = false;
  }
}

export function undo() {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(snapshot());
  restore(prev);
  commit();
}

export function redo() {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(snapshot());
  restore(next);
  commit();
}

// ---- Queries -----------------------------------------------------------

export const shapes = () => state.doc.shapes; // top level

// Every shape, including those inside boolean groups (depth-first, bottom to top).
export function allShapes(list = state.doc.shapes): Shape[] {
  return list.flatMap((s) => (s.type === 'boolean' ? [s, ...allShapes(s.children)] : [s]));
}

// The array holding a shape (top level or a boolean group's children) and its group.
export function containerOf(id: string, list = state.doc.shapes, owner: Shape | null = null): { list: Shape[]; owner: Shape | null } | null {
  for (const s of list) {
    if (s.id === id) return { list, owner };
    if (s.type === 'boolean') {
      const hit = containerOf(id, s.children, s);
      if (hit) return hit;
    }
  }
  return null;
}

export const byId = (id: string) => allShapes().find((s) => s.id === id);
export const selected = () => allShapes().filter((s) => state.selection.includes(s.id));
export const isSelected = (id: string) => state.selection.includes(id);

export function select(ids: string[]) {
  state.selection = ids;
  emit('full');
}

// ---- Artboards -----------------------------------------------------------

export const artboards = () => state.doc.artboards;
export const activeArtboard = () => artboards().find((a) => a.id === state.activeArtboard) ?? artboards()[0];
export const artboardById = (id: string) => artboards().find((a) => a.id === id);

export const inside = (a: { x: number; y: number; w: number; h: number }, [x, y]: [number, number]) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;

export function setActiveArtboard(id: string, select = false) {
  state.activeArtboard = id;
  state.artboardSelected = select;
  if (select) state.selection = [];
}

// Material icon names are snake_case.
export function nextArtboardName() {
  const used = new Set(artboards().map((a) => a.name));
  let n = artboards().length + 1;
  while (used.has(`icon_${n}`)) n++;
  return `icon_${n}`;
}

function snake(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'icon_1';
}

export function nextName(type: Shape['type']) {
  return `${TYPE_LABEL[type]} ${state.doc.shapes.filter((s) => s.type === type).length + 1}`;
}

export function newId() {
  return crypto.randomUUID();
}

state.activeArtboard = state.doc.artboards[0].id;
