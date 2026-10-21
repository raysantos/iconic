// Help (keyboard shortcuts) and About dialogs.
import { icon } from '../icons';
import { isMac, pretty, SHORTCUTS } from '../shortcuts';
import { q, escapeHtml } from './dom';

export const helpDialog = q<HTMLDialogElement>('#helpDialog');

export function openHelp() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  helpDialog.classList.remove('about');
  helpDialog.innerHTML = `
    <div class="help-head"><h2>Keyboard shortcuts</h2><span class="help-sub">Adobe Illustrator layout${isMac ? '' : ' · Ctrl = ⌘ on Mac'}</span><button class="sheet-close" value="close" aria-label="Close">×</button></div>
    <div class="help-cols">${groups
      .map(
        (g) => `<section><h3>${g}</h3><dl>${SHORTCUTS.filter((s) => s.group === g)
          .map((s) => `<div><dt>${escapeHtml(s.label)}</dt><dd>${s.keys.slice(0, 2).map((k) => `<kbd>${escapeHtml(pretty(k))}</kbd>`).join(' ')}</dd></div>`)
          .join('')}</dl></section>`,
      )
      .join('')}</div>
    <div class="help-cols"><section><h3>Pen &amp; touch (Tablet mode, in the main menu)</h3><dl>
      <div><dt>Draw, select, edit</dt><dd>Pen</dd></div>
      <div><dt>Pan / zoom</dt><dd>1 finger / pinch</dd></div>
      <div><dt>Undo / Redo</dt><dd>2-finger tap / 3-finger tap</dd></div>
      <div><dt>Shift, Alt, Hand</dt><dd>tap to lock on · hold for a moment</dd></div>
      <div><dt>Pen side button</dt><dd>drag to pan · click for the tool wheel</dd></div>
    </dl></section></div>
    <p class="help-note">Tip: in a browser tab, Chrome keeps a few keys for itself (Ctrl+1–3, Ctrl+N). Install Iconic as an app to use every shortcut.</p>`;
  q('.sheet-close', helpDialog).addEventListener('click', () => helpDialog.close());
  helpDialog.showModal();
}
helpDialog.addEventListener('click', (e) => e.target === helpDialog && helpDialog.close());

export function openAbout() {
  helpDialog.classList.add('about');
  helpDialog.innerHTML = `
    <div class="help-head"><h2>Iconic</h2><span class="help-sub">Version ${__APP_VERSION__}</span><button class="sheet-close" value="close" aria-label="Close">×</button></div>
    <div class="about-body">${icon('logo', 48)}<p>A vector icon editor for PC, phone and pen tablet.<br>Made by Raysan Designs.</p></div>
    <p class="help-note"><a href="https://github.com/raysantos/iconic" target="_blank" rel="noopener">Source on GitHub</a></p>`;
  q('.sheet-close', helpDialog).addEventListener('click', () => helpDialog.close());
  helpDialog.showModal();
}
