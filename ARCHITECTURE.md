# Architecture — Arcada Planner v2

Technical documentation for developers who want to understand, modify, or extend the codebase.

---

## Tech stack

| Layer | Technology |
|---|---|
| UI framework | React 18 |
| Canvas rendering | Konva.js + react-konva |
| State management | Zustand v5 |
| Icons | lucide-react |
| Build tool | Vite 5 |
| Language | TypeScript 5.6 |

---

## Project structure

```
arcada-v2/
├── public/
│   └── assets/2d/            # SVG furniture sprites
├── src/
│   ├── main.tsx              # Entry point, renders <App />
│   ├── App.tsx               # Root layout + SelectionPanel (furniture / text), RestoreDialog, theme & language on <html>
│   ├── App.css               # All styles; colours are CSS variables with a dark set under [data-theme="dark"]
│   ├── constants.ts          # METER, WALL_THICKNESS, WORLD size, AUTOSAVE_KEY, Tool enum
│   ├── types.ts              # WallNode, Wall, FurnitureItem, Dimension, TextNote, FloorState, CatalogItem
│   ├── helpers.ts            # localToWorld, worldToLocal, sortByZ
│   ├── store.ts              # Zustand store (project data, undo, selection) + parseProject()
│   ├── prefs.ts              # UI preferences remembered in the browser: language, theme, label modes, gaps
│   ├── theme.ts              # Canvas palettes (LIGHT / DARK), useIsDark(), usePalette()
│   ├── catalog.json          # Furniture catalog data (categories + items, English names)
│   ├── geometry/             # Pure geometry, no React — covered by tests
│   │   ├── hit.ts            # dist, pointInRotatedRect, distToSegment, rectCorners
│   │   ├── walls.ts          # Wall faces with mitred joints, inside lengths, room detection
│   │   ├── raycast.ts        # Rays to obstacles, free space (gaps) around an item
│   │   └── snap.ts           # Ruler snapping targets, 45° constraint
│   ├── i18n/                 # Translations
│   │   ├── index.ts          # useT(), t(), translate(), catalogName()
│   │   └── en.json, pl.json, ru.json, ua.json
│   └── ui/
│       ├── EditorStage.tsx   # Main canvas: grid, layers, hit detection, pointer / drag logic for all tools
│       ├── WallsLayer.tsx    # Wall outlines + length labels (editor and print)
│       ├── DimensionsLayer.tsx # Ruler dimension lines (editor and print)
│       ├── AnnotationsLayer.tsx # Furniture labels, text notes, text measuring (editor and print)
│       ├── GapsLayer.tsx     # Free space around the selected item
│       ├── TextEditor.tsx    # In-place textarea for editing text notes
│       ├── images.ts         # Sprite loader with cache; recolours SVGs for the dark theme
│       ├── Toolbar.tsx       # Left sidebar: tools, floors, snap, lengths, names, gaps, language, theme, save/open/print/help
│       ├── FurniturePanel.tsx # Right sidebar: category tabs + furniture grid
│       └── PrintView.tsx     # Hidden print-only rendering of all floors (always light)
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Core concepts

### Coordinate system

The world is a square of `WORLD × WORLD` pixels (default 5000×5000). One meter equals `METER = 100` world units. So a 3m wall is 300 world units long.

All positions (nodes, furniture, handles) are in world coordinates. The Stage has a pan offset (`pos.x`, `pos.y`) and a `scale` that convert between world and screen space:

```
screenX = pos.x + worldX * scale
worldX  = (screenX - pos.x) / scale
```

### Tool enum

```typescript
enum Tool { Select, Remove, WallAdd, Measure, Text }
```

- **Select** — default. Select furniture or text, drag to move, use handles to resize/rotate, drag wall nodes and ruler ends.
- **Remove** — click any text, dimension, furniture, node, or wall to delete it.
- **WallAdd** — drag to draw walls (chained). Click an existing node to connect, click a wall to split it.
- **Measure** — drag to add a dimension line; ends snap via `geometry/snap.ts`, Shift = 45° steps.
- **Text** — click empty space to add a note, click a note to edit it (opens `TextEditor`).

### Why there is no `Tool.View` or `Tool.Edit`

Originally there were separate View (pan-only) and Edit (allows dragging) tools. These were merged into a single **Select** tool because:
- Pan is always available via right-click drag, so a dedicated View tool was redundant.
- Users expected to be able to click and drag things in any mode.

---

## State management (Zustand)

All application state lives in a single Zustand store (`src/store.ts`). Key slices:

| Field | Type | Purpose |
|---|---|---|
| `tool` | `Tool` | Current active tool |
| `snapSize` | `number` | Snap grid size in world units (0 = off, 10 = 10cm default) |
| `floors` | `FloorState[]` | Array of floors, each with nodes, walls, furniture |
| `fi` | `number` | Current floor index |
| `selection` | `number[]` | Selected object ids (groups: furniture + texts; a single wall or dimension can be selected too) |
| `selectedId` | `number \| null` | The single selected object (kept in sync: `selection.length === 1 ? selection[0] : null`) |
| `textEdit` | `{ id, x, y } \| null` | Text note being edited in place |
| `wallStartId` | `number \| null` | Node where the current wall chain starts |
| `histories` | `{ undo, redo }[]` | Undo/redo history per floor (same index as `floors`), up to 50 steps each |
| `clipboard` | `{ furniture: FurnitureItem[]; texts: TextNote[] }` | Copy/paste buffer (whole groups) |
| `dirty` | `boolean` | Unsaved changes exist (controls the leave-page warning and autosave) |

### Undo/Redo

Floors are **immutable**: every change produces a new `FloorState` object, so the previous object itself is the undo snapshot (no deep cloning).

Every mutation goes through `upFloor()`, which applies the change and, outside a gesture, pushes the previous floor onto the current floor's `undo` stack (max 50) and clears `redo`.

**Gestures** group many changes into one undo step:
- `EditorStage` calls `beginGesture()` on pointer-down and `endGesture()` on pointer-up, so a whole drag / resize / rotate / wall-draw is a single step. A window-level `mouseup`/`touchend` listener closes the gesture if the pointer is released outside the canvas.
- `endGesture()` pushes the floor state from the start of the gesture only if the floor actually changed.
- Multi-step store actions (`splitWall`, `cutSelected`) use an internal `transact()` helper for the same effect.

Each floor has its own history, so switching floors keeps undo/redo intact.

### Saving and autosave

- `save()` serialises the project; `load()` validates it via `parseProject()` (throws a readable `Error` for broken files, fills defaults, drops walls pointing to missing nodes, fixes `nextId`).
- **Ctrl+S** writes to `localStorage` (`AUTOSAVE_KEY`), and the app also autosaves there every 30 s while `dirty`. On startup `RestoreDialog` offers to restore a non-empty saved project.

### ID generation

A monotonically increasing `nextId` counter is stored in state. Every new node, wall, or furniture item gets a unique ID via `newId()`. IDs are persisted in save files to maintain consistency.

---

## Rendering architecture

### Why `listening={false}` everywhere

Konva's built-in hit detection uses a hidden "hit canvas" that re-renders shapes with unique colors. This approach was **fundamentally broken** in our setup — clicks consistently went to the Stage instead of individual shapes, regardless of configuration.

**Solution:** All Konva shapes are set to `listening={false}` (purely visual). Hit detection is done entirely through manual geometry math at the Stage level.

### Hit detection pipeline

On `mouseDown` with the Select tool, the code checks (in priority order): handles, ruler ends, text notes, furniture, wall nodes. Erase checks texts, dimensions, furniture, nodes, walls. The original order was:

1. **Resize/rotate handles** — distance from cursor to each handle's world position
2. **Furniture** — `pointInRotatedRect()`: transforms cursor into item-local space, checks bounding box
3. **Wall nodes** — distance to each node (with threshold)
4. **Walls** — `distToSegment()`: perpendicular distance to wall line segment

```typescript
// Point-in-rotated-rect: transform to local space, then simple AABB check
function pointInRotatedRect(px, py, rx, ry, rw, rh, rotDeg) {
  const rad = -rotDeg * Math.PI / 180;
  const localX = (px - rx) * cos(rad) - (py - ry) * sin(rad);
  const localY = (px - rx) * sin(rad) + (py - ry) * cos(rad);
  return localX >= 0 && localX <= rw && localY >= 0 && localY <= rh;
}
```

### Pointer actions in the Select tool

Priority on pointer-down: resize/rotate handles → ruler ends → texts / furniture → wall nodes → ruler lines → walls → empty space.
Ctrl/Shift+click toggles an item in the selection; dragging any selected item moves the whole selection (`moveItems`).
Empty space: plain drag pans the plan (`pan` drag, screen coordinates); Ctrl/Shift+drag draws a frame (`marquee`) that selects items whose centre is inside.

**Flush snapping**: while a single furniture item is dragged, its position is grid-snapped and then `flushShift()` (`geometry/raycast.ts`) pulls it against a wall face or neighbouring item closer than 10 screen px, so gaps of exactly 0 cm are easy to get. Rugs (layer below 100) are ignored; Alt disables it. Rays that start on an obstacle report distance 0.

### Manual drag system

Dragging is a state machine stored in `dragRef`:

```typescript
type DragState =
  | { type: 'furniture'; id; offX; offY }    // dragging furniture
  | { type: 'node'; id; offX; offY }          // dragging wall node
  | { type: 'resize'; id; anchor; startItem }  // resizing furniture
  | { type: 'rotate'; id; centerX; centerY; startAngle; startRot }
  | null;
```

- **mouseDown** sets the appropriate drag state
- **mouseMove** applies the transform in real-time
- **mouseUp** snaps to grid (for furniture/node drags) and clears drag state

### Resize handles

8 resize handles (corners + midpoints) + 1 rotation handle. Positions are computed using `localToWorld()` to account for item rotation. Resize math uses `worldToLocal()` to convert the cursor back to item-local space, then adjusts width/height/origin based on which anchor is being dragged.

### Image loading

`ui/images.ts` keeps one cache for the editor and print. `getSprite(path, dark, onLoad)` returns `null` while loading or if loading failed (a placeholder rect is drawn) and calls `onLoad` when the image is ready, which triggers a re-render. Light and dark variants are cached separately.

---

## Grid system

The visual grid uses a dynamic interval system — grid lines get coarser as you zoom out:

```typescript
const INTERVALS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
// Pick the smallest interval where lines are at least N pixels apart
```

**Important:** The snap grid is independent from the visual grid. Snap uses a fixed `snapSize` value chosen by the user (Off / 5cm / 10cm / 25cm / 50cm), while the visual grid adapts to zoom level.

---

## Walls and nodes

Walls are defined as edges between two nodes. Each wall stores:
- `a`, `b` — node IDs
- `exterior` — boolean (affects thickness and color)

Wall thickness:
- Exterior: `WALL_THICKNESS = 20` (20cm)
- Interior: `INTERIOR_WALL_THICKNESS = 16` (16cm)

### Wall faces and inside lengths (`geometry/walls.ts`)

`computeWallGeometry(nodes, walls)` returns, for every wall, its **left and right faces** (offset by half the thickness) and an outline polygon:

1. Around every node the attached walls are sorted by angle. For each pair of neighbouring walls the offset lines facing each other are intersected — that point is the shared corner (a mitre). A miter limit avoids spikes at very sharp angles; a wall end with nothing attached gets a square end.
2. Nodes where 3+ walls meet get a filler "hub" polygon.
3. Face length is measured along the wall direction — this is the inside length shown on labels.
4. `roomSides()` walks the faces of the planar wall graph (half-edges, always turning to the same side). Faces with positive signed area are enclosed rooms; the outer boundary has negative area. This tells which side of each wall faces a room, so the *Inside* label mode can label only room sides.

Labels (`WallsLayer.tsx`): *Inside* shows room-facing faces (a wall not yet enclosing a room shows both faces, once if equal), *Both* shows both, *Axis* shows the centre-line length.

### Splitting walls

Clicking on an existing wall in WallAdd mode:
1. Projects the click point onto the wall segment (parametric `t` value); if it lands on an endpoint, that node is reused and nothing is split
2. In one atomic change (one undo step): removes the original wall, adds a node at the projected point and two walls to the original endpoints
3. Preserves the exterior flag on both new segments

---

## Multi-floor

Each floor is an independent `FloorState` (nodes, walls, furniture, dimensions, texts) with its own undo/redo history. Floor navigation resets the selection. At least one floor must always exist.

---

## Save format

Files use `.arcada` extension (JSON content). Current format version **2.1.0** (`FILE_VERSION` in `store.ts`); 2.0.0 files load fine — `parseProject()` fills missing fields.

```json
{
  "version": "2.1.0",
  "createdAt": "2026-11-14T10:30:00.000Z",
  "lastModified": "2026-11-14T12:45:00.000Z",
  "floors": [
    {
      "nodes": [{ "id": 1, "x": 500, "y": 500 }],
      "walls": [{ "id": 10, "a": 1, "b": 2, "exterior": true, "thickness": 25 }],
      "furniture": [{ "id": 20, "path": "couch", "x": 600, "y": 400, "w": 240, "h": 100, "rot": 0, "zi": 100, "name": "Couch",
                     "label": "Guest sofa", "labelPos": "tl", "labelSize": 12, "labelBold": true, "labelColor": "#1a73e8" }],
      "dimensions": [{ "id": 30, "x1": 510, "y1": 700, "x2": 890, "y2": 700 }],
      "texts": [{ "id": 31, "x": 520, "y": 520, "text": "Living room", "size": 20, "rot": 0, "bold": true, "color": null }]
    }
  ],
  "nextId": 32
}
```

- `name` — English catalog name (shown translated when *Names* is on); `label` — the user's own label.
- `labelPos` — `c`, `t`, `b`, `l`, `r`, `tl`, `tr`, `bl`, `br`; labels are drawn in the item's frame (they turn with it, flipped back when upside down). `labelSize` missing = fitted automatically.
- `flipX` / `flipY` mirror the sprite. `flipFurniture()` shifts a door when `flipY` changes so the frame band (top 25/133 of door.svg) stays in place.
- `textMode` / `sizeMode`: missing = follow the toolbar (Names / Sizes), `'on'` = always, `'off'` = never — see `src/labels.ts`.
- `simple: true` draws the item as a plain rectangle (`SimpleFurniture`) instead of its sprite.
- Wall `thickness` is optional; without it 20 cm (exterior) or 16 cm (interior) is used (`wallThickness()`).
- `color: null` on a text means "theme text colour".
- `cables`: `{ id, points: [{x, y}], color, width?, label?, showLength? }` — polylines drawn above furniture (`ui/CablesLayer.tsx`, helpers in `geometry/cable.ts`). The Cable tool keeps the unfinished run in component state and stores it with one `addCable()` (one undo step).
  Display paths come from `layoutCables()`: segments of different cables that are parallel, within 4 cm sideways and overlapping are put into lanes (ordered by cable list order, spaced by width + 1.5 cm) and joined with mitred corners. Labels are placed by `placeCableLabels()` along each path, avoiding earlier labels and `labelObstacles()` (wall length labels, small equipment).

---

## Print system

`PrintView.tsx` renders all floors in a hidden `div` (`.print-view`) that becomes visible only during `@media print`. Each floor:

1. Computes the bounding box of nodes, furniture, dimensions and texts (accounting for rotation)
2. Scales to fit A4 (794 × 1123 px at 96dpi) and centres the content
3. Renders the same layers as the editor (`WallsLayer`, furniture, `AnnotationsLayer`, `DimensionsLayer`) with the **light** palette, regardless of the chosen theme

---

## Wiring mode and layers (`src/layers.ts`)

- Furniture, texts, dimensions and cables have an optional `layer: 'wiring' | 'both'`; trays always belong to the wiring layer. `onLayer()` tells whether an object is on a layer; `layerView(floor, 'main' | 'wiring', own?)` splits a floor (`own` leaves out 'both' objects).
- `layerPasses(floor, choice)` gives the passes for print / export so 'both' objects are drawn once.
- `store.mode` is `'plan'` or `'wiring'`. New objects get `layer: 'wiring'` while in Wiring mode (`curLayer()` in the store); `setLayer()` moves an object.
- `EditorStage` edits only the current layer (`act`, including 'both' objects); in Wiring mode the main plan (`base`) is drawn under it at `wiring.planDim` % opacity and walls / nodes are not interactive.
- `store.wiring` (`WiringSettings`, saved in the file as `wiring`): default cable width, label sizes, label / length display, new tray width, plan brightness. `styleCables()` applies them before drawing.
- Cable links (`src/geometry/links.ts`): `fromLink` / `toLink` = `{ id, u, v }` (item id, spot as fractions of its size). `addCable` / `updateCable` set them with `relink()` for ends lying on an item of the current layer; `upFloor()` runs `syncLinks()` whenever furniture changes, so linked ends follow their items (and links to deleted items drop). Empty From / To show the linked item's name (`itemNamer()` passed to `styleCables()`). Items up to 60 cm are ports: snapping over one goes to its centre.
- Cable chains (`src/geometry/chain.ts`): `parent` = the cable this one continues (its first point lies on it). `styleCables()` gives the chain root a `route` (start → every consumer sorted by distance along the run) and `totalLength`; other members get `route: ''`. `collapseToChains()` lists a chain once (tray tip / panel). Store: `addCable(points, color, parent)`, `attachCable`, `detachCable`, `updateChain`; `chainPick` is the pending "click a cable" action of the panel buttons.
- Cable groups: `floor.groups` (local, undoable) and `store.commonGroups` (saved as `cableGroups`); cables list group ids in `groups`. `store.litGroups` (not saved) dims cables outside the highlighted groups.
- Bundles (`layoutCables(cables, groupOrder)`): parallel overlapping segments form corridors; each line (a chain counts as one) keeps one lane per corridor. Lanes are sorted by group rank (first group on the side away from the middle of the drawing), then by where the line first turns off (that side, earliest outermost). Offset ends get a lead back to the real end; continuations are joined to the parent's drawn path.
- Heights (`src/geometry/heights.ts`): each cable point gets a height — its own `z`, else the mounting height of the connected item (`elev`, or the height of the tray the item stands in), else the parent's height for a continuation start, else the height of a tray it lies in (not for `noTray` cables), else the cable's run `height`; unknown points take the neighbour's height. `styleCables(…, heightCtx(floor))` sets `totalLength` = plan length + vertical runs. Cables with `noTray` are laid out by `tidyFree` without trays and are not listed by `cablesInTray`.
- Cable points (`src/geometry/segdrag.ts`): `tidyAfterDrag` drops repeated and straight-through points after a part or point drag; `simplifyPath` also drops the tips of back-and-forth spikes (store `simplifyCable`). Points with an own `z` or `joint` are kept. `removeCablePoint` removes a middle point only.
- Switch ports: `portCount(item)` (own `ports`, or from "Switch N"); `fromPort` / `toPort` on the cable; `itemNamer(…)(id, port)` gives "Switch A, port 1" for routes. A port is kept only while the end stays on the same item (`withLinks` in the store).
- `routeViaTrays()` builds a graph of tray segments (crossings and ends next to another tray connect) and finds the shortest way between the access points of both cable ends (≤ 3 m away); `tidyCables()` uses it first and falls back to the free layout.
- `tidyCables()` (`src/geometry/tidy.ts`): orthogonalise, remove staircases, add short stubs at the ends, then merge close overlapping parallel inner runs (snapping them to tray centre lines). One undo step via `upFloor`.
- Trays have `layer?: 'plan' | 'both'` (missing = wiring); `trayLayer()` maps it to the object layer used by the panel.
- Object colour: `color` on furniture and trays. Sprites are recoloured by `colorSvg()` (greys → shades of the colour); the sprite cache and export key is `spriteKey()` (path + colour).
- Trays (`Tray`: points, width, label) are drawn by `TraysLayerContent`; `cablesInTray()` lists cables with ≥ 20 cm inside a tray band. Cables snap to tray centre lines.
- Export: `layers` = `plan` (main only), `all`, `wiring` (main drawn with `fadePalette()` colours, wiring on top).

## Export (`src/export`)

- `planSvg.ts` (pure, tested) builds one floor as an SVG string in world units (1 = 1 cm): walls with lengths, furniture (sprites inlined as nested `<svg>`; their classes and ids are prefixed by `prepareSprite()` so styles of different sprites don't clash), labels, sizes, texts, dimensions. `contentBounds()` gives the area: `room` = walls that enclose rooms, `all` = everything.
- `exporter.ts` (browser): loads Roboto TTF from `public/fonts/` (Latin, Polish, Cyrillic) and the sprites (dark variant via `darkSvg()`), then
  - **PNG** — the SVG (with the font embedded as `@font-face`) is drawn into a canvas at N px per cm and saved;
  - **PDF** — `jspdf` + `svg2pdf.js` (lazy-loaded) draw the same SVG as vectors; the font is registered in jsPDF so non-Latin text works.
- `ui/ExportDialog.tsx` — format, area, theme, floors, PNG quality, PDF page (A4 / A3 / 1:50).

## Languages (`src/i18n`)

- Flat key → text JSON files: `en.json`, `pl.json`, `ru.json`, `ua.json`. Placeholders look like `{n}`.
- `useT()` in components (re-renders on language change), `t()` outside React (alerts), `catalogName(lang, 'cat' | 'item', englishName)` for the catalog.
- Missing keys fall back to English. `i18n.test.ts` checks that all files have the same keys and placeholders and that every catalog item is translated.
- To add a string: add the key to all four files (the test fails otherwise).

## Theme

- UI colours: CSS variables in `App.css`, dark values under `:root[data-theme="dark"]`; `App.tsx` sets `data-theme` from `useIsDark()` (preference *Auto* follows the OS).
- Canvas colours: `LIGHT` / `DARK` palettes in `theme.ts` (Konva can't read CSS variables).
- Furniture sprites in dark mode: `images.ts` fetches the SVG text, inverts its colours (`darkSvg()`), and loads it from a blob URL, so sprites stay vector-sharp. Embedded raster images inside SVGs are inverted with a CSS filter.

---

## Key dependencies

| Package | Why |
|---|---|
| `konva` + `react-konva` | Canvas rendering with layer support, transforms, image rendering |
| `zustand` | Minimal state management with no boilerplate, supports `get()` for imperative access inside actions |
| `lucide-react` | Clean icon set for toolbar |
| `vite` | Fast HMR, simple config, good production builds |

---

## Adding new furniture

1. Add an SVG file to `public/assets/2d/` (e.g., `my-item.svg`)
2. Add an entry to `src/catalog.json`:

```json
{
  "name": "My Item",
  "imagePath": "my-item",
  "width": 1.2,
  "height": 0.8,
  "zIndex": 100
}
```

- `width` / `height` are in **meters**
- `imagePath` is the filename without `.svg` and without the `assets/2d/` prefix
- `zIndex` (optional, default 100) controls layering order (higher = on top): rugs use 50, doors and windows 200

3. Place it under the appropriate category in the catalog JSON.
4. Add the translation key `"item.My Item"` to all four files in `src/i18n/` (`npm run test` checks this). The SVG is recoloured automatically for the dark theme.
