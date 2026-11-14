# Arcada Planner v2

A free, browser-based 2D floor plan editor. Draw walls, furnish rooms from a catalog of 60+ items, measure, label and annotate your plan, manage multiple floors, and print — all from the browser, no install needed. Available in English, Polish, Russian and Ukrainian, with light and dark themes.

> **Credit:** This project is heavily inspired by (and shares its name with) the original [Arcada](https://github.com/mehanix/arcada) floor planner. We rewrote the entire codebase from scratch with a different tech stack and added new features.

![Editor overview](docs/screenshots/editor-overview.png)
<!-- TODO: replace with an actual screenshot -->

---

## How it works

### 1. Draw the walls

Select the **Wall** tool and drag from point to point — walls are drawn between them, and you can keep dragging from the last point to continue the chain. A live length is shown while you draw. Click on an existing wall to split it. Right-click a wall to mark it as **exterior** (thicker, darker). Wall joints are drawn with clean mitred corners.

![Wall drawing](docs/screenshots/wall-drawing.gif)
<!-- TODO: replace with a GIF -->

### 2. See real inside lengths

Each wall is labelled with the length of its face **inside the room** — what a tape measure along the wall shows, with wall thickness and joints taken into account (a 4 × 3 m room on wall centre-lines with 20 cm walls shows 3.80 × 2.80). The **Lengths** selector switches between *Inside*, *Both* sides, centre-line *Axis* and *Off*.

### 3. Furnish the rooms

Browse the catalog on the right panel: Bedroom, Kitchen, Living room, Bathroom, Office, Structure and Openings. Click any item to drop it on the canvas — it's auto-selected and ready to move. Rugs stay under furniture, doors and windows on top; the panel under a selected item can bring it to front or send it to back.

![Furniture placement](docs/screenshots/furniture-catalog.gif)
<!-- TODO: replace with a GIF -->

### 4. Adjust everything

Click any furniture to select it. Drag to move, pull the handles to resize, or drag the top circle to rotate. Items snap flush (0 cm) to walls and neighbours when dragged close — hold **Alt** to place freely. The floating panel lets you type exact values in **cm** and **degrees** and give the item a **label** with its own position (centre, side or corner), size, bold and colour. The square button switches an item (or a whole selection) between the detailed picture and a **simple plain rectangle**. The mirror buttons flip an item; for a **door** they choose the hinge side and which side of the wall it opens to (the frame stays in the wall). With **Gaps** on, the selected item shows the free space to the nearest wall or furniture on each side; less than 60 cm is highlighted.

Select several items with **Ctrl/Shift+click** or a **Ctrl/Shift+drag** frame and move, copy or delete them together. Click a **wall** to change its type, thickness and length or drag it; click a **ruler line** to change its length or move it.

![Resize and rotate](docs/screenshots/resize-rotate.gif)
<!-- TODO: replace with a GIF -->

### 5. Measure and annotate

- **Ruler** — drag between two points to add a dimension line. Ends snap to wall corners and faces, furniture and other dimensions; hold **Shift** for straight / 45° lines. Dimensions stay on the plan and print with it.
- **Text** — click anywhere to add a note, edit it in place; set size, rotation, bold and colour in the panel.
- **Names** — show the (translated) catalog name on every item without its own label.

### 6. Multiple floors

Use the arrows in the toolbar to add and navigate floors. Each floor is independent — its own walls, furniture, dimensions, texts and undo history. Remove a floor with the trash icon.

![Multi-floor](docs/screenshots/multi-floor.png)
<!-- TODO: replace with a screenshot -->

### 7. Save, load, print

- **Save** your project as a `.arcada` file and open it back anytime
- **Ctrl+S** for a quick save to browser storage; the app also autosaves every 30 s and offers to restore your last project on start
- **Print** renders all floors on A4 pages with lengths, dimensions and labels (always in the light theme), ready for PDF or paper

![Print view](docs/screenshots/print-view.png)
<!-- TODO: replace with a screenshot -->

---

## Tools

| Tool | What it does |
|---|---|
| **Select** | Click to select furniture, text, a wall or a ruler line; drag to move (walls and rulers too), pull handles to resize/rotate, drag wall nodes and ruler ends; Ctrl/Shift+click or Ctrl/Shift+drag a frame to select a group; double-click a text to edit |
| **Wall** | Drag to draw walls, click on walls to split them |
| **Ruler** | Drag to measure; the dimension stays on the plan. Drag an existing end to adjust it |
| **Text** | Click to add a note, click a note to edit it |
| **Erase** | Click any element to delete it |

## Toolbar options

| Option | What it does |
|---|---|
| **Snap** | Grid snap: Off, 5, 10, 25 or 50 cm |
| **Lengths** | Wall length labels: Inside / Both / Axis / Off |
| **Names** | Show catalog names on furniture |
| **Sizes** | Show width × depth (cm) on every item, in the chosen corner |
| **Gaps** | Show free space around the selected item |
| **Language** | EN / PL / RU / UA |
| **Theme** | Auto (system) → Light → Dark |

## Controls

| Input | Action |
|---|---|
| **Drag empty space** (or right / middle button) | Pan the canvas |
| **Ctrl / Shift + drag empty space** | Frame selection |
| **Ctrl / Shift + click** | Add / remove an item from the selection |
| **Alt while dragging** | Place freely, without snapping flush to walls / neighbours |
| **Scroll wheel** | Zoom in / out |
| **Right-click on wall** | Toggle exterior / interior |
| **One finger on empty space / two fingers** (touch) | Pan / pan and zoom |

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Escape** | Return to Select tool |
| **Ctrl+S** | Quick save |
| **Ctrl+Z** | Undo |
| **Ctrl+Shift+Z** / **Ctrl+Y** | Redo |
| **Ctrl+C / V / X** | Copy / Paste / Cut furniture or text |
| **Delete** | Remove the selection (furniture, texts, wall, ruler) |
| **Ctrl+A** | Select all furniture and texts |
| **Arrows** / **Shift+Arrows** | Move the selection by 1 cm / 10 cm |
| **Shift** (while measuring) | Keep the ruler straight / at 45° |

---

## Gallery

<!-- TODO: add your screenshots and GIFs here -->

| | | |
|---|---|---|
| ![](docs/screenshots/editor-overview.png) | ![](docs/screenshots/wall-drawing.gif) | ![](docs/screenshots/furniture-catalog.gif) |
| Editor overview | Drawing walls | Placing furniture |
| ![](docs/screenshots/resize-rotate.gif) | ![](docs/screenshots/multi-floor.png) | ![](docs/screenshots/print-view.png) |
| Resize & rotate | Multiple floors | Print view |

---

## For developers

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the code works under the hood
- [DEPLOY.md](DEPLOY.md) — how to build and deploy to GitHub Pages
- [CHANGELOG.md](CHANGELOG.md) — numbered log of every change
- `npm run test` — unit tests (store, geometry, language files, sprite recolouring)
