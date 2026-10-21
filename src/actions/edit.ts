// The edit wrapper (one undo step per command) and helpers every command uses.
import { center } from '../geometry';
import { type Pt } from '../model';
import { activeArtboard, checkpoint, commit, emit, selected } from '../store';

// Set by the canvas so paste lands in the middle of what you're looking at.
export const view = { center: (): Pt => center(activeArtboard()) };

export const editable = () => selected().filter((s) => !s.locked);

// Live edits (scrubbing a field, dragging the color picker) redraw without
// touching history; the caller checkpoints once at the start and commits at the end.
export interface EditOpts {
  live?: boolean;
}

export function edit(fn: () => void, opts: EditOpts = {}) {
  if (opts.live) {
    fn();
    return emit('live');
  }
  checkpoint();
  fn();
  commit();
}
