// The document: rename and start over.
import { activeArtboard, newArtboard, setActiveArtboard, shapes, state } from '../store';
import { edit } from './edit';
import { iconStyle } from './style';

// ---- Document ----------------------------------------------------------

export function renameDoc(name: string) {
  const clean = name.trim() || 'Untitled';
  if (clean === state.doc.name) return;
  edit(() => (state.doc.name = clean));
}

export function newDoc() {
  if (shapes().length && !confirm('Start a new document? You can undo this.')) return;
  const size = activeArtboard().w;
  edit(() => {
    const ab = newArtboard('icon_1', 0, 0, size);
    state.doc = { name: 'Untitled', iconStyle: iconStyle(), artboards: [ab], shapes: [] };
    state.selection = [];
    setActiveArtboard(ab.id);
  });
}
