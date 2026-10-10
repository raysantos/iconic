# Icon Forge

A lightweight vector icon editor that runs on PC and phone. It's a Progressive Web App (PWA): open it in a browser, then "Install" (desktop Chrome/Edge) or "Add to Home Screen" (iOS Safari / Android Chrome) to use it like a native app, including offline.

## Features (v0.1)

- 24×24 icon artboard with pixel grid and half-pixel snapping
- Tools: select/move, rectangle, ellipse, line, freehand pen
- Fill, stroke color and stroke width (applies to the selected shape too)
- Undo/redo, delete, autosave to the device
- Export to SVG or 512px PNG
- Mouse, touch and stylus input (Pointer Events)

Shortcuts: `V` select, `R` rect, `E` ellipse, `L` line, `P` pen, `Ctrl+Z` / `Ctrl+Y`, `Del`.

## Develop

```bash
npm install
npm run dev
```

`npm run dev` listens on your local network, so you can open the printed `Network:` URL on your phone (same Wi-Fi) to test touch.

## Build

```bash
npm run build
```

Output goes to `dist/`. Host it on any static host with HTTPS (GitHub Pages, Netlify, Vercel, Cloudflare Pages) so phones can install it.

## Roadmap ideas

- Bezier pen tool and node editing
- Resize handles, rotation, layers panel
- Multiple icons / icon sets, export as sprite or icon font
- Configurable artboard size (16, 24, 32, 48)
