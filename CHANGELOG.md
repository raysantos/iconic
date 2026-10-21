# Changelog

## 1.1.0 — 2026-10-21

A stability and speed release: no new tools, but drawing, panning and selecting in big files are much faster, and several bugs are fixed.

### Faster
Measured on a 480-shape, 48-artboard file:

| | 1.0.0 | 1.1.0 |
|---|---|---|
| Dragging a shape or point (one frame) | 17–19 ms | ~5 ms |
| Dragging with Merged preview (`Ctrl+Y`) on | 132–145 ms | ~6.5 ms |
| Panning (one step) | 26–27 ms | ~2 ms |
| Selecting a shape | 26–35 ms | ~9 ms |

- The canvas only draws what's on screen (plus a margin), and panning just moves the drawing
- Audit results and the merged preview are remembered until a shape changes, instead of being worked out again on every redraw
- The Layers panel only rebuilds its rows when they change; selecting just moves the highlight

### Fixed
- **Undo while drawing:** `Ctrl+Z` or a two-finger tap while placing points with the Pen now removes the last point and lets you keep drawing (as in Illustrator). Undo in the middle of any drag now cancels that drag cleanly; before, the tool kept editing a shape that was no longer in the file
- **Shapes inside boolean groups:** Delete Anchor Point removing a whole path and **Join** now work inside groups (before, nothing happened, or a duplicate path was left behind). A group left empty is removed
- **SVG export with `currentColor`** no longer breaks badge knockout gaps
- **Android Vector Drawable (layered)** keeps the even-odd fill of Exclude and Subtract groups, so their holes stay holes
- **Icon font:** two glyphs can no longer end up with the same name (e.g. two artboards called `x` and one called `x_2`)
- **Escape** with a menu or the pen tool wheel open only closes it; it no longer also deselects your shapes
- **Number fields:** dragging a label to scrub no longer leaves a stray listener that could add an extra undo step
- A Subtract whose result is empty no longer reports its position at the canvas origin
- **Offline and updates:** the app is now saved for offline use on your first visit, each update replaces the old offline copy completely, and error pages are never cached (before, an unlucky moment could leave the installed app with a broken file)

### Under the hood
- 75 automated tests (`npm test`) for geometry, path parsing, booleans, export and SVG import; deploys stop if a test fails
- Large source files split by area (`src/actions/`, `src/ui/`, `src/canvas/`)
- Stricter TypeScript checks and dead code removed

## 1.0.0 — 2026-10-13

First release: Material-first icon editor with Figma-style panels, Illustrator shortcuts, FontLab-style type-design tools (masters, Tunni lines, Power Nudge, Smart Corners, Audit, Overview, icon-font export), components and badges, live boolean groups, SVG import, Google-format single-path export and Tablet mode for pen displays. About dialog in the main menu.
