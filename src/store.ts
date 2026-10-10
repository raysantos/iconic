import { SIZES, TYPE_LABEL, type Doc, type Shape, type Style, type Tool } from './model';

const DOC_KEY = 'iconic:doc';
const PREFS_KEY = 'iconic:prefs';

interface Prefs {
  style: Style; // applied to new shapes; follows the last edited selection, like Illustrator
  grid: boolean;
  snap: boolean;
  pngSizes: number[];
  exportFormat: 'png' | 'svg';
}

const DEFAULT_PREFS: Prefs = {
  style: { fill: '#D9D9D9', stroke: '#000000', strokeWidth: 0 },
  grid: true,
  snap: true,
  pngSizes: [512],
  exportFormat: 'svg',
};

export const state = {
  doc: loadDoc(),
  prefs: loadPrefs(),
  selection: [] as string[],
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

function loadDoc(): Doc {
  const data = read<Doc | Shape[]>(DOC_KEY);
  if (Array.isArray(data)) return { name: 'Untitled', size: 24, shapes: data }; // v0.1 format
  if (data && SIZES.includes(data.size)) return { ...data, name: data.name || 'Untitled' };
  return { name: 'Untitled', size: 24, shapes: [] };
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
  const ids = new Set(state.doc.shapes.map((s) => s.id));
  state.selection = state.selection.filter((id) => ids.has(id));
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

export const shapes = () => state.doc.shapes;
export const byId = (id: string) => state.doc.shapes.find((s) => s.id === id);
export const selected = () => state.doc.shapes.filter((s) => state.selection.includes(s.id));
export const isSelected = (id: string) => state.selection.includes(id);

export function select(ids: string[]) {
  state.selection = ids;
  emit('full');
}

export function nextName(type: Shape['type']) {
  return `${TYPE_LABEL[type]} ${state.doc.shapes.filter((s) => s.type === type).length + 1}`;
}

export const newId = () => crypto.randomUUID();
