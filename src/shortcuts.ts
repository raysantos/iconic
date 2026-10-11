// Adobe Illustrator-style keyboard shortcuts (Ctrl = Cmd and Alt = Option on Mac).
import * as A from './actions';
import { actualSize, deleteAnchors, finishPen, fitAll, fitArtboard, fitSelection, joinPaths, nudgeAnchors, isDrawingPath, penBackspace, setSpaceHeld, zoomAt } from './canvas';
import type { BoolOp, Tool } from './model';
import { activeArtboard, commit, redo, savePrefs, state, undo } from './store';

export interface AppHooks {
  setTool: (t: Tool) => void;
  togglePanels: () => void;
  openExport: () => void;
  openHelp: () => void;
  toast: (msg: string) => void;
}

interface Shortcut {
  group: string;
  label: string;
  keys: string[]; // first one is shown in menus and tooltips
  run?: () => void;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

let hooks: AppHooks;
const tool = (t: Tool) => () => hooks.setTool(t);

export const SHORTCUTS: Shortcut[] = [
  // Tools
  { group: 'Tools', label: 'Selection', keys: ['V'], run: tool('select') },
  { group: 'Tools', label: 'Direct Selection', keys: ['A'], run: tool('direct') },
  { group: 'Tools', label: 'Artboard', keys: ['Shift+O'], run: tool('artboard') },
  { group: 'Tools', label: 'Pen', keys: ['P'], run: tool('pen') },
  { group: 'Tools', label: 'Add Anchor Point', keys: ['+', '=', 'Shift+='], run: tool('addAnchor') },
  { group: 'Tools', label: 'Delete Anchor Point', keys: ['-'], run: tool('deleteAnchor') },
  { group: 'Tools', label: 'Anchor Point (convert)', keys: ['Shift+C'], run: tool('convertAnchor') },
  { group: 'Tools', label: 'Rectangle', keys: ['M'], run: tool('rect') },
  { group: 'Tools', label: 'Ellipse', keys: ['L'], run: tool('ellipse') },
  { group: 'Tools', label: 'Line Segment', keys: ['\\'], run: tool('line') },
  { group: 'Tools', label: 'Pencil', keys: ['N'], run: tool('pencil') },
  { group: 'Tools', label: 'Hand', keys: ['H'], run: tool('hand') },
  { group: 'Tools', label: 'Zoom (Alt-click to zoom out)', keys: ['Z'], run: tool('zoom') },
  { group: 'Tools', label: 'Temporary Hand', keys: ['Space (hold)'] },

  // Edit
  { group: 'Edit', label: 'Undo', keys: ['Ctrl+Z'], run: undo },
  { group: 'Edit', label: 'Redo', keys: ['Ctrl+Shift+Z'], run: redo },
  { group: 'Edit', label: 'Cut', keys: ['Ctrl+X'], run: A.cut },
  { group: 'Edit', label: 'Copy', keys: ['Ctrl+C'], run: A.copy },
  { group: 'Edit', label: 'Paste', keys: ['Ctrl+V'], run: () => A.paste('center') },
  { group: 'Edit', label: 'Paste in Front', keys: ['Ctrl+F'], run: () => A.paste('front') },
  { group: 'Edit', label: 'Paste in Back', keys: ['Ctrl+B'], run: () => A.paste('back') },
  { group: 'Edit', label: 'Paste in Place', keys: ['Ctrl+Shift+V'], run: () => A.paste('inPlace') },
  { group: 'Edit', label: 'Delete', keys: ['Delete', 'Backspace'], run: () => deleteAnchors() || A.deleteSelection() },
  { group: 'Edit', label: 'Select All', keys: ['Ctrl+A'], run: A.selectAll },
  { group: 'Edit', label: 'Deselect', keys: ['Ctrl+Shift+A'], run: A.deselect },
  { group: 'Edit', label: 'Duplicate while dragging', keys: ['Alt+Drag'] },
  { group: 'Edit', label: 'Transform Again', keys: ['Ctrl+D'], run: A.transformAgain },

  // Object
  { group: 'Object', label: 'Bring to Front', keys: ['Ctrl+Shift+]'], run: () => A.arrange('front') },
  { group: 'Object', label: 'Bring Forward', keys: ['Ctrl+]'], run: () => A.arrange('forward') },
  { group: 'Object', label: 'Send Backward', keys: ['Ctrl+['], run: () => A.arrange('backward') },
  { group: 'Object', label: 'Send to Back', keys: ['Ctrl+Shift+['], run: () => A.arrange('back') },
  { group: 'Object', label: 'Union', keys: ['Ctrl+Alt+U'], run: () => bool('union') },
  { group: 'Object', label: 'Subtract', keys: ['Ctrl+Alt+S'], run: () => bool('subtract') },
  { group: 'Object', label: 'Intersect', keys: ['Ctrl+Alt+I'], run: () => bool('intersect') },
  { group: 'Object', label: 'Exclude', keys: ['Ctrl+Alt+X'], run: () => bool('exclude') },
  { group: 'Object', label: 'Release Boolean Group', keys: ['Ctrl+Shift+G'], run: () => void A.releaseBoolean() },
  { group: 'Object', label: 'Create Component (artboard)', keys: ['Ctrl+Alt+K'], run: () => {
    const ab = activeArtboard();
    A.setComponent(ab.id, !ab.component);
    hooks.toast(ab.component ? `${ab.name} is now a component` : `${ab.name} is no longer a component`);
  } },
  { group: 'Object', label: 'Detach Instance', keys: ['Ctrl+Alt+B'], run: () => {
    if (A.detachSelection()) hooks.toast('Detached — the knockout gap was removed');
  } },
  { group: 'Object', label: 'Join Paths', keys: ['Ctrl+J'], run: () => { const err = joinPaths(); if (err) hooks.toast(err); } },
  { group: 'Object', label: 'Lock Selection', keys: ['Ctrl+2'], run: A.lockSelection },
  { group: 'Object', label: 'Unlock All', keys: ['Ctrl+Alt+2'], run: A.unlockAll },
  { group: 'Object', label: 'Hide Selection', keys: ['Ctrl+3'], run: A.hideSelection },
  { group: 'Object', label: 'Show All', keys: ['Ctrl+Alt+3'], run: A.showAll },
  { group: 'Object', label: 'Nudge 1px', keys: ['Arrows'] },
  { group: 'Object', label: 'Nudge 10px', keys: ['Shift+Arrows'] },

  // Color
  { group: 'Color', label: 'Default Fill & Stroke', keys: ['D'], run: A.defaultColors },
  { group: 'Color', label: 'Toggle Fill / Stroke', keys: ['X'], run: A.toggleFocus },
  { group: 'Color', label: 'Swap Fill & Stroke', keys: ['Shift+X'], run: A.swapFillStroke },
  { group: 'Color', label: 'None', keys: ['/'], run: A.setNone },

  // View
  { group: 'View', label: 'Zoom In', keys: ['Ctrl+=', 'Ctrl+Shift+=', 'Ctrl++'], run: () => zoomAt(2) },
  { group: 'View', label: 'Zoom Out', keys: ['Ctrl+-'], run: () => zoomAt(0.5) },
  { group: 'View', label: 'Fit Artboard in Window', keys: ['Ctrl+0', 'Shift+1'], run: fitArtboard },
  { group: 'View', label: 'Fit All Artboards', keys: ['Ctrl+Alt+0'], run: fitAll },
  { group: 'View', label: 'Actual Size', keys: ['Ctrl+1'], run: actualSize },
  { group: 'View', label: 'Zoom to Selection', keys: ['Shift+2'], run: fitSelection },
  { group: 'View', label: 'Show / Hide Grid', keys: ["Ctrl+'"], run: () => togglePref('grid', 'Grid') },
  { group: 'View', label: 'Merged Preview (export)', keys: ['Ctrl+Y'], run: () => togglePref('mergedPreview', 'Merged preview') },
  { group: 'View', label: 'Smart Guides', keys: ['Ctrl+U'], run: () => togglePref('smartGuides', 'Smart guides') },
  { group: 'View', label: 'Material Keylines', keys: ['Ctrl+;'], run: () => togglePref('keylines', 'Keylines') },
  { group: 'View', label: 'Snap to Grid', keys: ["Ctrl+Shift+'"], run: () => togglePref('snap', 'Snap to grid') },
  { group: 'View', label: 'Hide Panels', keys: ['Tab'], run: () => hooks.togglePanels() },

  // File
  { group: 'File', label: 'New Icon', keys: ['Ctrl+Alt+N', 'Ctrl+N'], run: A.newDoc },
  { group: 'File', label: 'Save (saves automatically)', keys: ['Ctrl+S'], run: () => hooks.toast('Saved on this device') },
  { group: 'File', label: 'Export', keys: ['Ctrl+Shift+E', 'Ctrl+Alt+E'], run: () => hooks.openExport() },
  { group: 'File', label: 'Keyboard Shortcuts', keys: ['Ctrl+/', 'Shift+/'], run: () => hooks.openHelp() },
];

function bool(op: BoolOp) {
  const err = A.makeBoolean(op);
  if (err) hooks.toast(err);
}

function togglePref(key: 'grid' | 'snap' | 'keylines' | 'smartGuides' | 'mergedPreview', name: string) {
  state.prefs[key] = !state.prefs[key];
  savePrefs();
  hooks.toast(`${name} ${state.prefs[key] ? 'on' : 'off'}`);
  commit();
}

// Physical keys, so Ctrl+Shift+] matches even though Shift turns "]" into "}".
const CODE_NAMES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Backslash: '\\',
  Equal: '=',
  Minus: '-',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  Space: 'Space',
};

function comboOf(e: KeyboardEvent) {
  let key = CODE_NAMES[e.code];
  if (!key && e.code.startsWith('Key')) key = e.code.slice(3);
  if (!key && e.code.startsWith('Digit')) key = e.code.slice(5);
  if (!key) key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && key !== '+' && 'Shift'].filter(Boolean);
  return [...mods, key].join('+');
}

// Display form: ⌘⌥⇧ on Mac.
export function pretty(keys: string) {
  if (!isMac) return keys;
  return keys.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧');
}

export function keyFor(label: string) {
  const s = SHORTCUTS.find((x) => x.label === label);
  return s ? pretty(s.keys[0]) : '';
}

// Held-down keys only auto-repeat for these (like Illustrator).
const REPEATABLE = new Set(['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+=', 'Ctrl+Shift+=', 'Ctrl++', 'Ctrl+-', 'Ctrl+D', 'Ctrl+V']);

const typing =(t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function installShortcuts(h: AppHooks) {
  hooks = h;
  const table = new Map<string, () => void>();
  for (const s of SHORTCUTS) for (const k of s.keys) if (s.run) table.set(k, s.run);

  document.addEventListener('keydown', (e) => {
    if (typing(e.target)) return;
    if (e.code === 'Space') {
      if (!e.repeat) setSpaceHeld(true);
      e.preventDefault();
      return;
    }

    // The pen tool owns Enter / Esc / Backspace while a path is open.
    if (isDrawingPath()) {
      if (e.key === 'Enter' || e.key === 'Escape') return void finishPen(false);
      if (e.key === 'Backspace' || e.key === 'Delete') return void (penBackspace(), e.preventDefault());
    }
    if (e.key === 'Escape') {
      if (state.selection.length || state.artboardSelected) A.deselect();
      return;
    }

    if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && nudgeAnchors(d[0], d[1])) e.preventDefault();
      else if (d && state.selection.length) {
        A.nudge(d[0], d[1]);
        e.preventDefault();
      }
      return;
    }

    const combo = comboOf(e);
    const run = table.get(combo);
    if (run) {
      e.preventDefault();
      if (!e.repeat || REPEATABLE.has(combo)) run();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') setSpaceHeld(false);
  });
  window.addEventListener('blur', () => setSpaceHeld(false));
}
