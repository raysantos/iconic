// Figma-style chrome: top bar, Layers panel, Design panel, menus, dialogs.
import { onViewChange, setSpaceHeld } from './canvas';
import { installTablet } from './tablet';
import { installImport } from './importer';
import { installShortcuts } from './shortcuts';
import { subscribe } from './store';
import { togglePanels } from './ui/panels';
import { toast } from './ui/dom';
import { openHelp } from './ui/dialogs';
import { renderAssets } from './ui/assets';
import { renderDesign, updateLayoutFields } from './ui/design';
import { renderArtboards, renderLayers } from './ui/layers';
import { setTool, buildTopbar, renderTools, updateTopbar, updateZoomLabel, openExport } from './ui/topbar';

// ---- Boot --------------------------------------------------------------------

export function initUI() {
  buildTopbar();
  installShortcuts({ setTool, togglePanels, openExport, openHelp, toast });
  installTablet({ setTool, setHand: setSpaceHeld, toast });
  installImport({ toast });
  subscribe((kind) => {
    if (kind === 'live') return updateLayoutFields();
    renderTools();
    updateTopbar();
    renderArtboards();
    renderLayers();
    renderAssets();
    renderDesign();
  });
  onViewChange(updateZoomLabel);
  setTool('select');
}
