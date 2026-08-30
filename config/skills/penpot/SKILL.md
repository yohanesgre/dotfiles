---
name: penpot
description: Create, modify, inspect, and export Penpot designs through Penpot MCP tools. Use for any Penpot design task — creating boards, adding shapes, applying layouts, managing components/variants, working with design tokens, prototyping interactions, inspecting designs, and exporting assets.
---

# Penpot Design Skill

## When to Use

Use this skill when the user asks to interact with Penpot designs through the MCP tools — creating, modifying, inspecting, or exporting design elements. This includes:

- Creating new designs from scratch (boards, shapes, text, paths)
- Inspecting/mapping an existing design's structure
- Applying styling (fills, strokes, shadows, blur, opacity, blend modes)
- Setting up flexible layouts (Flex Layout and Grid Layout)
- Creating and using components and variants
- Managing design tokens and themes
- Setting up prototyping interactions and flows
- Exporting layers and boards for development handoff
- Organizing layers into boards, groups, and boolean operations

## Available Tools

| Tool | Purpose |
|------|---------|
| `penpot_execute_code` | Run arbitrary JavaScript using the Penpot Plugin API. This is the primary workhorse for all design operations. |
| `penpot_penpot_api_info` | Look up API documentation for specific types and members. Use when unsure about a method signature. |
| `penpot_export_shape` | Export a shape as PNG or SVG by its ID. |
| `penpot_high_level_overview` | Get high-level API overview instructions. Re-read if context is stale. |

## Global Objects

| Object | Purpose |
|--------|---------|
| `penpot` | Root API object of type `Penpot`. Access selection, root node, library, create shapes, etc. |
| `penpotUtils` | Utility functions: `getPages()`, `findShape()`, `findShapes()`, `shapeStructure()`, `setParentXY()`, `isContainedIn()`, `analyzeDescendants()`, token utilities, layout helpers. |
| `storage` | Persistent key-value store that survives across `penpot_execute_code` calls. Use to save state between tool invocations. |

---

## Key Concepts

### Shape Hierarchy

Penpot uses a tree structure:

```
File
 └── Pages (tabs within a file)
      └── Boards (fixed-size containers; viewport sections)
           ├── Groups (logical collections)
           │    ├── Shapes (Rectangle, Ellipse, Text, Path, Image, etc.)
           │    └── Groups (nested)
           └── Boolean shapes (union, difference, intersection, exclusion, flatten)
```

**Shape types**: `Rectangle`, `Ellipse`, `Text`, `Path`, `Image`, `Board`, `Group`, `Boolean`, `SvgRaw`

**Hierarchy methods**: `appendChild()`, `insertChild()`, `removeChild()` — use these for reparenting shapes.

### Accessing the Document

```javascript
// Root of the current page
const root = penpot.root;

// Currently selected shapes (volatile!)
const selection = penpot.selection;

// CRITICAL: Always copy selection to storage immediately
storage.shapes = penpot.selection;

// Access pages
const pages = penpotUtils.getPages();
```

### Shape Properties

**Position**:
- `x`, `y` — writable, absolute coordinates
- `parentX`, `parentY` — read-only, position relative to parent

**Size** (read-only — must use `resize()`):
- `width`, `height` — read, cannot write directly
- `resize(newWidth, newHeight)` — the only way to change size

**Visual**:
- `fills[]` — array of fill objects. **Read-only array** — must replace entire array: `shape.fills = [newFill]`
- `strokes[]` — array of stroke objects. Same replacement rule as fills.
- `shadows[]` — array of shadow objects
- `borderRadius` — number or object for per-corner radius
- `blur` — blur effect value
- `blendMode` — blend mode string (normal, multiply, screen, overlay, etc.)
- `opacity` — number 0-1

**Transform**:
- `rotation` — degrees
- `flipX`, `flipY` — boolean
- `proportionLock` — boolean

**State**:
- `hidden` — boolean
- `blocked` — boolean (locked)
- `visible` — boolean (derived)

### Text Properties

Text shapes have additional properties:
- `characters` — the text content string
- `fontSize` — number
- `fontFamily` — string
- `fontWeight` — string (e.g., "400", "bold")
- `fontStyle` — "normal" or "italic"
- `textDecoration` — "none", "underline", "strikethrough"
- `textTransform` — "none", "uppercase", "lowercase", "titlecase"
- `letterSpacing` — number (pixels)
- `lineHeight` — number (pixels)
- `textAlign` — "left", "center", "right", "justify"
- `verticalAlign` — "top", "center", "bottom"
- `growType` — "auto-width", "auto-height", "fixed". Controls text box sizing behavior.
- `direction` — "ltr" or "rtl"

### Fills & Strokes

**Fill object structure**:
```javascript
{
  fillColor: "#FF0000",    // hex color
  fillOpacity: 0.8,         // 0-1
  fillImage: {              // optional, for image fills
    name: "image-name",
    width: 200,
    height: 150,
    id: "image-id",
    keepAspectRatio: true,
    mtype: "image/png"
  }
}
```

**Gradient fills** — use `fillColorGradient` instead of `fillColor`:
```javascript
{
  fillColorGradient: {
    type: "linear",           // "linear" or "radial"
    startX: 0, startY: 0,     // gradient start (0-1 relative)
    endX: 1, endY: 1,         // gradient end (0-1 relative)
    width: 1,
    stops: [
      { color: "#FF0000", opacity: 1, offset: 0 },
      { color: "#0000FF", opacity: 1, offset: 1 }
    ]
  },
  fillOpacity: 1
}
```

**Stroke object structure**:
```javascript
{
  strokeColor: "#000000",
  strokeOpacity: 1,
  strokeWidth: 2,               // pixels
  strokeAlignment: "center",    // "center", "inner", "outer"
  strokeStyle: "solid",         // "solid", "dotted", "dashed", "mixed"
  strokeCapStart: "round",      // stroke cap for open paths
  strokeCapEnd: "round"
}
```

### Layout Systems

Penpot has two layout systems that mirror CSS standards.

#### Flex Layout (Flexbox-based)

Properties:
- `dir` — "row", "reverse-row", "column", "reverse-column"
- `wrap` — "nowrap", "wrap"
- `alignItems` — "start", "center", "end"
- `justifyContent` — "start", "center", "end", "space-between", "space-around", "space-evenly"
- `rowGap`, `columnGap` — spacing between items
- `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`

**Adding Flex Layout**:

```javascript
// On a board/group/layer
const flex = board.addFlexLayout();
flex.dir = "row";
flex.rowGap = 16;
flex.columnGap = 16;
flex.alignItems = "center";
flex.justifyContent = "start";

// Adding flex to a board that already has children:
// Use penpotUtils.addFlexLayout() to wrap existing children
penpotUtils.addFlexLayout(board);
```

**CRITICAL**: Use `board.appendChild()` for adding children to flex layouts, NOT `board.flex.appendChild()`. The latter is broken.

**Child positioning in flex**:
- **Static** (default): Child participates in flex flow normally.
- **Absolute**: `child.layoutChild.absolute = true` — removes child from flow, positions manually.
- **Z-index**: `child.layoutChild.zIndex = number` — controls stacking order.

**Sizing**:
- `layoutChild.horizontalSizing` — "fix" or "fit"
- `layoutChild.verticalSizing` — "fix" or "fit"

**Margins**:
- `layoutChild.marginTop`, `layoutChild.marginRight`, `layoutChild.marginBottom`, `layoutChild.marginLeft`

#### Grid Layout (CSS Grid-based)

Properties:
- `dir` — "row", "column"
- `alignItems` — "start", "center", "end", "stretch"
- `justifyItems` — "start", "center", "end", "stretch"
- `rowGap`, `columnGap`
- `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`

**Grid tracks** — define rows and columns using units:
- `FR` — fractional unit
- `auto` — automatically sized
- Fixed pixels
- `Area names` — named grid areas

```javascript
const grid = board.addGridLayout();
grid.dir = "row";
grid.rowGap = 16;
grid.columnGap = 16;
grid.rows = [{ type: "auto" }, { type: "flex", value: 1 }];
grid.columns = [{ type: "flex", value: 1 }, { type: "flex", value: 2 }];
```

**Grid cell placement**:
- **Auto**: Elements positioned sequentially into cells.
- **Manual**: `child.layoutChild.gridRow`, `gridColumn`, `gridRowSpan`, `gridColumnSpan`.
- **Area**: Map child to a named grid area via the area name.

### Components

Components are reusable design elements. A **main component** is the source of truth; **instances** (copies) inherit from it but can have overrides.

```javascript
// Create a component from selected shapes
const component = penpot.library.local.createComponent(shapes);

// Create an instance of a component
const instance = component.instance();

// Detach an instance (break link to main)
// Right-click → Detach, or use the detach method
instance.detach();

// Swap a component instance for another
// Use "Update main component" to push changes from instance back to main
component.updateMainFromInstance(instance);

// Component overrides are preserved when main component changes
// unless the override conflicts with a change to the main
```

**Grouping components**: Use slashes in names for folder structure: `"Buttons/Primary"`, `"Icons/Navigation/Menu"`.

### Variants

Variants group similar components (like button states or sizes) into a single customizable component.

**Properties and Values**:
- Properties define dimensions: `Color`, `Size`, `State`
- Values are options within properties: `Primary/Secondary`, `Small/Large`
- Each variant = one unique combination of values across all properties

```javascript
// Create a variant from a component
const variant = component.createVariant();

// Create variants by combining existing components
const combinedComponent = penpot.library.local.combineAsVariants([comp1, comp2, comp3]);

// Switch a variant instance to a different value
instance.switchVariant("propertyName", "valueName");

// Transform within a variant
instance.transformInVariant("propertyName", "valueName");

// Toggle for boolean variants — accepts value pairs: true/false, on/off, yes/no
// The UI will show a toggle instead of a dropdown
```

### Design Tokens

Design tokens are the building blocks of UI elements (colors, spacing, typography, shadows). Penpot follows the W3C DTCG format.

**Token types**:
- **Color** — hex, RGB, RGBA, ARGB, HSL, HSLA
- **Dimension** — sizing, spacing, border radius, stroke width, X/Y position
- **Opacity**, **Rotation**, **Sizing**, **Spacing**, **Stroke Width**
- **Number token**
- **Typography** — font family, font size, font weight, letter spacing, text case, text decoration; composite typography tokens
- **Shadow**
- **Border radius**

**Token Sets**: Organize tokens into groups/files.
**Token Themes**: Context-specific configurations (e.g., light/dark mode, brand themes).

```javascript
// Reference tokens using aliases: {token.name}
// Math in numerical tokens: basic operators (+, -, *, /, %, ^) and functions (abs, ceil, floor, round, max, min, sqrt, pow, log, exp, sin, cos, tan)

// Apply a token to shapes
penpotUtils.applyToken(token, shapes);

// Token application is ASYNC — wait ~100ms after applying before reading
```

**Groups**: Token names with dots create automatic groups: `color.primary.500`, `spacing.small`, `typography.heading.h1`.

### Z-Order

Control stack order within a parent:
```javascript
shape.bringToFront();
shape.sendToBack();
shape.setParentIndex(n);  // set to specific position
```

### Boolean Operations

Combine shapes with boolean operations (creates a `Boolean` shape):
- **Union** — combine areas of all shapes
- **Difference** — subtract one shape from another
- **Intersection** — keep only overlapping area
- **Exclusion** — keep non-overlapping areas
- **Flatten** — merge into a single path

```javascript
// Boolean shapes are accessed through the parent
const booleanShape = penpot.createBoolean();
booleanShape.operation = "union"; // "union", "difference", "intersection", "exclusion"
board.appendChild(booleanShape);
booleanShape.appendChild(shape1);
booleanShape.appendChild(shape2);
```

### Constraints

Constraints control how layers resize when their parent container changes size:
- Left, Right, Top, Bottom, Center
- Scale proportionally
- Fix width/height

```javascript
shape.constraintsHorizontal = "left";    // "left", "right", "leftright", "center", "scale"
shape.constraintsVertical = "top";       // "top", "bottom", "topbottom", "center", "scale"
```

### Cloning

```javascript
const clone = shape.clone();
clone.x = original.x + 100;
board.appendChild(clone);
```

### Resize Behavior

```javascript
// width and height are READ-ONLY — always use resize()
shape.resize(200, 150);

// For proportional resizing:
const aspectRatio = shape.width / shape.height;
shape.resize(200, 200 / aspectRatio);
```

---

## Common Code Templates

### Boilerplate — Every Script Should Start With

```javascript
// Save selection immediately (it's volatile)
storage.shapes = penpot.selection;

// If you need the current page:
const page = penpot.root;

// Use storage to persist state across calls
storage.lastOperation = "done";
```

### Finding Elements

```javascript
// Find ALL shapes matching a condition
const buttons = penpotUtils.findShapes(
  shape => shape.name === "Button",
  penpot.root
);

// Find FIRST shape matching a condition
const header = penpotUtils.findShape(
  shape => shape.type === "text" && shape.name === "Header",
  penpot.root
);

// Get shape structure for debugging
const structure = penpotUtils.shapeStructure(penpot.root);
console.log(JSON.stringify(structure, null, 2));

// Get a shape by ID
const shape = penpotUtils.findShape(s => s.id === "some-shape-id", penpot.root);

// Analyze descendants
const analysis = penpotUtils.analyzeDescendants(penpot.root);
```

### Creating Shapes

```javascript
// Rectangle
const rect = penpot.createRectangle();
rect.x = 100;
rect.y = 100;
rect.resize(200, 150);
rect.name = "My Button";
rect.fills = [{ fillColor: "#3B82F6", fillOpacity: 1 }];
rect.borderRadius = 8;
parentBoard.appendChild(rect);

// Ellipse
const ellipse = penpot.createEllipse();
ellipse.x = 50;
ellipse.y = 50;
ellipse.resize(100, 100);
ellipse.fills = [{ fillColor: "#EF4444", fillOpacity: 0.9 }];
parentBoard.appendChild(ellipse);

// Text
const text = penpot.createText();
text.x = 100;
text.y = 200;
text.characters = "Hello, Penpot!";
text.fontSize = 24;
text.fontFamily = "Inter";
text.fontWeight = "bold";
text.growType = "auto-width";  // auto-width, auto-height, or fixed
text.textAlign = "center";
text.fills = [{ fillColor: "#111827", fillOpacity: 1 }];
// resize() is optional for text with growType "auto-width" or "auto-height"
parentBoard.appendChild(text);

// Board
const board = penpot.createBoard();
board.name = "iPhone 14";
board.resize(390, 844);
board.fills = [{ fillColor: "#FFFFFF", fillOpacity: 1 }];
page.appendChild(board);

// Path (Bezier)
const path = penpot.createPath();
path.x = 0;
path.y = 0;
path.svg = "<path d='M10 10 L50 10 L50 50 Z' />";
path.resize(60, 60);
path.strokes = [{ strokeColor: "#000", strokeWidth: 2 }];
board.appendChild(path);

// Group
const group = penpot.createGroup();
group.name = "Card";
group.appendChild(rect);
group.appendChild(text);
board.appendChild(group);
```

### Adding Styling

```javascript
// Fills — must replace entire array
shape.fills = [
  { fillColor: "#3B82F6", fillOpacity: 1 }
];

// Multiple fills
shape.fills = [
  { fillColor: "#3B82F6", fillOpacity: 1 },
  { fillColor: "#1D4ED8", fillOpacity: 0.5 }
];

// Image fill
shape.fills = [{
  fillImage: {
    name: imageName,
    width: 200,
    height: 150,
    id: imageId,
    keepAspectRatio: true,
    mtype: "image/png"
  },
  fillOpacity: 1
}];

// Gradient fill
shape.fills = [{
  fillColorGradient: {
    type: "linear",
    startX: 0, startY: 0,
    endX: 1, endY: 1,
    width: 1,
    stops: [
      { color: "#3B82F6", opacity: 1, offset: 0 },
      { color: "#8B5CF6", opacity: 1, offset: 1 }
    ]
  },
  fillOpacity: 1
}];

// Strokes — must replace entire array
shape.strokes = [
  { strokeColor: "#000000", strokeOpacity: 1, strokeWidth: 2, strokeAlignment: "center", strokeStyle: "solid" }
];

// Shadows
shape.shadows = [
  { type: "drop-shadow", style: "drop-shadow", offsetX: 2, offsetY: 4, blur: 8, spread: 0, color: "#000000", opacity: 0.2 }
];

// Border radius
shape.borderRadius = 8;
// Per-corner radius: { r1: 8, r2: 4, r3: 8, r4: 4 }

// Blur
shape.blur = { type: "layer-blur", value: 4 };

// Opacity and blend mode
shape.opacity = 0.8;
shape.blendMode = "multiply";

// Rotation
shape.rotation = 45;  // degrees

// Flip
shape.flipX = true;
shape.flipY = false;

// Visibility and locking
shape.hidden = false;
shape.blocked = true;  // locked
```

### Layouts

```javascript
// === Flex Layout ===

// Add to an existing board with children already in it
penpotUtils.addFlexLayout(board);

// Or add to a new board
const flex = board.addFlexLayout();
flex.dir = "row";
flex.wrap = "nowrap";
flex.alignItems = "center";
flex.justifyContent = "space-between";
flex.rowGap = 16;
flex.columnGap = 16;
flex.paddingTop = 24;
flex.paddingRight = 24;
flex.paddingBottom = 24;
flex.paddingLeft = 24;

// CRITICAL: Add children using board.appendChild(), NOT board.flex.appendChild()
const child = penpot.createRectangle();
child.resize(100, 100);
board.appendChild(child);  // CORRECT

// Absolute positioning within flex
child.layoutChild.absolute = true;
child.x = 50;
child.y = 20;
child.layoutChild.zIndex = 10;

// Sizing modes
child.layoutChild.horizontalSizing = "fit";  // "fix" or "fit"
child.layoutChild.verticalSizing = "fix";

// Margins
child.layoutChild.marginTop = 8;
child.layoutChild.marginRight = 8;

// === Grid Layout ===

const grid = board.addGridLayout();
grid.dir = "row";
grid.alignItems = "center";
grid.justifyItems = "start";
grid.rowGap = 16;
grid.columnGap = 16;

// Define tracks
grid.rows = [{ type: "auto" }, { type: "pixel", value: 200 }];
grid.columns = [
  { type: "flex", value: 1 },
  { type: "flex", value: 2 }
];

// Position child in grid
child.layoutChild.gridRow = 0;
child.layoutChild.gridColumn = 1;
child.layoutChild.gridRowSpan = 1;
child.layoutChild.gridColumnSpan = 2;
```

### Components & Variants

```javascript
// Create a component from existing shapes
const shapes = penpot.selection;
const component = penpot.library.local.createComponent(shapes);

// Create an instance
const instance = component.instance();
instance.x = 200;
instance.y = 100;
board.appendChild(instance);

// Create a variant
const variant = component.createVariant();
// Set variant properties via the API

// Switch variant on an instance
instance.switchVariant("Size", "Large");
instance.switchVariant("State", "Hover");

// Combine existing components into a variant set
const combined = penpot.library.local.combineAsVariants([compA, compB, compC]);
```

### Design Tokens

```javascript
// Apply a token by name
const token = penpotUtils.findToken("color.primary.500", penpot.root);
if (token) {
  token.applyToShapes(selectedShapes);
  // Token application is async — execution continues immediately
}

// Apply multiple tokens
const colorToken = penpotUtils.findToken("color.surface.default", penpot.root);
const spacingToken = penpotUtils.findToken("spacing.medium", penpot.root);
if (colorToken) colorToken.applyToShapes(shapes);

// CRITICAL: Token application is asynchronous
// If you need to read state after applying, wait:
// Use the storage to chain operations across penpot_execute_code calls
```

### Prototyping

```javascript
// Create an interaction (flow link) between boards
// Interactions are set via shape interaction properties
shape.interactions = [
  {
    eventType: "click",          // "click", "mouse-enter", "mouse-leave", "after-delay"
    actionType: "navigate",      // "navigate", "open-overlay", "toggle-overlay", "close-overlay", "previous-screen", "open-url"
    destination: destinationBoard,
    animation: {
      type: "dissolve",          // "dissolve", "slide", "push"
      direction: "right",        // "right", "left", "up", "down"
      duration: 300,            // ms
      easing: "ease-in-out"
    }
  }
];

// Flow start
flow.start = board;

// Fixed position on scroll (for navigation bars, headers)
shape.fixedScroll = true;
```

### Export

```javascript
// Export a shape using the dedicated tool
// penpot_export_shape(shapeId, format, mode)
// format: "png" or "svg"
// mode: "selection" or "board"

// Note: The MCP tool penpot_export_shape handles file export.
// For the JavaScript API, export presets are set via shape properties.
```

### Z-Order & Reparenting

```javascript
// Bring to front
shape.bringToFront();

// Send to back
shape.sendToBack();

// Move to specific index
shape.setParentIndex(2);

// Reparent to a different container
newParent.appendChild(shape);
// or
newParent.insertChild(2, shape); // at specific position
```

---

## Workflows

### Workflow 1: Create a New Design from Scratch

1. **Understand the requirements** — what screens, components, or assets are needed?
2. **Create a board**: `const board = penpot.createBoard(); board.name = "Screen Name"; board.resize(width, height); page.appendChild(board);`
3. **Set up layout** if needed: `const flex = board.addFlexLayout(); flex.dir = "column"; flex.rowGap = 16;`
4. **Add child shapes**: Create rectangles, text, ellipses as needed. Set their properties and call `board.appendChild(child)`.
5. **Style everything**: Set fills, strokes, shadows, border radius, opacity.
6. **Group related elements**: `const group = penpot.createGroup(); group.name = "Header"; group.appendChild(logo); group.appendChild(title);`
7. **Create components** from reusable groups: `penpot.library.local.createComponent(shapes);`
8. **Add more boards** for additional screens.
9. **Set up prototyping** connections between boards.

### Workflow 2: Inspect and Map an Existing Design

1. **Get the page structure**: `const structure = penpotUtils.shapeStructure(penpot.root); console.log(JSON.stringify(structure, null, 2));`
2. **Find specific elements**: `const items = penpotUtils.findShapes(s => s.type === "text", penpot.root);`
3. **Inspect a specific shape**: Check properties: `shape.name`, `shape.type`, `shape.x`, `shape.y`, `shape.width`, `shape.height`, `shape.fills`, `shape.strokes`
4. **Check layout**: If a board has flex/grid layout, inspect layout properties.
5. **Find components**: `penpotUtils.findShapes(s => s.isComponent, penpot.root);`
6. **Document findings** in storage for later use: `storage.foundShapes = foundItems.map(s => ({ id: s.id, name: s.name, type: s.type }));`

### Workflow 3: Apply Design Tokens to Shapes

1. **Identify target shapes**: Select them or find them by name/type.
2. **Find the token**: `const token = penpotUtils.findToken("color.primary.500", penpot.root);`
3. **Apply the token**: `token.applyToShapes(targetShapes);`
4. **Handle async**: Token application is async. If you need to chain operations, save state and use sequential `penpot_execute_code` calls.
5. **Verify**: Re-read shape properties to confirm token values applied.

### Workflow 4: Create and Use Components

1. **Select or create the shapes** that will form the component.
2. **Create the component**: `const comp = penpot.library.local.createComponent(selectedShapes);`
3. **Name it clearly**: Use naming convention like `"Button/Primary"` for organization.
4. **Create instances**: `const instance = comp.instance();`
5. **Position instances**: Set x, y and append to boards.
6. **Apply overrides**: Modify individual instance properties.
7. **Update main from copy**: `comp.updateMainFromInstance(instance)` when needed.

### Workflow 5: Set Up Variants

1. **Create a base component** first.
2. **Create variants**: Either individually with `comp.createVariant()` or bulk with `combineAsVariants([comp1, comp2, comp3])`.
3. **Define variant properties**: Use the API to set property names and values.
4. **Create instances** from the variant set.
5. **Switch between variants**: `instance.switchVariant("State", "Active");`

### Workflow 6: Export for Development Handoff

1. **Select the shapes/boards** to export.
2. **For programmatic export**: Use `penpot_export_shape(shapeId, format, mode)` — format "png" or "svg", mode "selection" or "board".
3. **For inspect info**: Read `shape.x`, `shape.y`, `shape.width`, `shape.height`, `shape.fills`, `shape.fontSize`, etc. to produce spec docs.
4. **Note**: The MCP can export individual shapes. Bulk export of all layers or boards to PDF requires the UI.

### Workflow 7: Create Interactive Prototypes

1. **Create all necessary boards** (one per screen/state).
2. **Identify trigger elements** on each board (buttons, links, hotspots).
3. **Set interactions on trigger shapes**: Define `eventType`, `actionType`, `destination`, and `animation`.
4. **Set flow start**: Designate which board starts the flow.
5. **Fix scroll elements** (nav bars, floating buttons): `shape.fixedScroll = true;`
6. **Test in View mode**: Prototype testing is done in the UI View mode — the MCP can only set up the interactions, not play them.

---

## Common Patterns & Gotchas

### Critical Gotchas

1. **`board.flex.appendChild()` is BROKEN** — always use `board.appendChild()` when adding children to a flex layout board.

2. **`penpotUtils.addFlexLayout()` vs `board.addFlexLayout()`** — use `addFlexLayout()` on a board when it has no layout yet. Use `penpotUtils.addFlexLayout()` when a board already has children and you want to wrap them in a flex layout.

3. **`resize()` is REQUIRED for width/height** — `width` and `height` properties are read-only. Always use `shape.resize(w, h)` to change size.

4. **Fills and strokes arrays are read-only** — you cannot do `shape.fills.push(newFill)`. You must replace the entire array: `shape.fills = [newFill1, newFill2]`.

5. **Token application is ASYNC** — calling `token.applyToShapes()` does not block. If you need to read properties after token application, wait ~100ms or split into separate `penpot_execute_code` calls.

6. **Selection is VOLATILE** — `penpot.selection` changes whenever the user clicks. Always copy to storage: `storage.shapes = penpot.selection;`

7. **Text `growType` matters** — "auto-width" text grows horizontally as you type, "auto-height" grows vertically, "fixed" stays at the set size. Using `resize()` on auto-growing text may not behave as expected.

8. **Use `board.appendChild()` for ALL layout children** — regardless of whether the board has flex, grid, or no layout, always use `board.appendChild()`.

9. **Absolute positioning in layouts** requires `child.layoutChild.absolute = true`. The shape is then positioned using its `x`, `y` properties.

10. **Group locking** — setting `group.blocked = true` locks the group, but children remain individually selectable unless they are also blocked.

### Pitfalls to Avoid

- **Don't write to `width`/`height`** — silent no-op or error.
- **Don't mutate fills/strokes arrays** — changes are invisible until array reference changes.
- **Don't assume token application is synchronous** — chain operations across tool calls.
- **Don't rely on `selection` across calls** — always copy to storage.
- **Don't call `board.flex.appendChild()`** — broken, use `board.appendChild()`.
- **Don't forget to call `resize()` on new shapes** — rectangles and ellipses have zero size until resized.
- **Don't forget to `appendChild()`** — created shapes don't appear until added to the tree.

---

## Recipes

Quick-reference: "How do I X?" — minimal code snippets.

### Create a colored rectangle
```javascript
const r = penpot.createRectangle();
r.resize(200, 100);
r.fills = [{ fillColor: "#FF0000", fillOpacity: 1 }];
r.borderRadius = 12;
board.appendChild(r);
```

### Create a text label
```javascript
const t = penpot.createText();
t.characters = "Hello World";
t.fontSize = 18;
t.fontFamily = "Inter";
t.fontWeight = "bold";
t.growType = "auto-width";
t.fills = [{ fillColor: "#333333", fillOpacity: 1 }];
board.appendChild(t);
```

### Add a shadow to a shape
```javascript
shape.shadows = [
  { type: "drop-shadow", style: "drop-shadow", offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: "#000000", opacity: 0.15 }
];
```

### Add a stroke (border)
```javascript
shape.strokes = [
  { strokeColor: "#D1D5DB", strokeOpacity: 1, strokeWidth: 1, strokeAlignment: "inside", strokeStyle: "solid" }
];
```

### Make a board with flex column layout
```javascript
const b = penpot.createBoard();
b.resize(360, 640);
const flex = b.addFlexLayout();
flex.dir = "column";
flex.rowGap = 12;
flex.paddingTop = 20;
flex.paddingLeft = 16;
flex.paddingRight = 16;
b.fills = [{ fillColor: "#F9FAFB", fillOpacity: 1 }];
page.appendChild(b);
```

### Add absolute-positioned element in flex
```javascript
const badge = penpot.createEllipse();
badge.resize(24, 24);
badge.fills = [{ fillColor: "#EF4444", fillOpacity: 1 }];
board.appendChild(badge);
badge.layoutChild.absolute = true;
badge.x = 300;
badge.y = 10;
badge.layoutChild.zIndex = 100;
```

### Find all text layers on a page
```javascript
const allText = penpotUtils.findShapes(s => s.type === "text", penpot.root);
```

### Change color of all rectangles named "Card"
```javascript
const cards = penpotUtils.findShapes(s => s.type === "rectangle" && s.name === "Card", penpot.root);
cards.forEach(c => { c.fills = [{ fillColor: "#2563EB", fillOpacity: 1 }]; });
```

### Create a component from selection
```javascript
const comp = penpot.library.local.createComponent(penpot.selection);
```

### Clone a shape
```javascript
const clone = shape.clone();
clone.x += 100;
clone.y += 50;
shape.parent.appendChild(clone);
```

### Group selected shapes
```javascript
const group = penpot.createGroup();
group.name = "My Group";
const shapes = [...penpot.selection];
shapes.forEach(s => group.appendChild(s));
board.appendChild(group);
```

### Rotate a shape
```javascript
shape.rotation = 45;
```

### Hide a shape
```javascript
shape.hidden = true;
```

### Lock a shape
```javascript
shape.blocked = true;
```

---

## MCP Limitations

The Penpot MCP plugin provides powerful API access but cannot do everything the full Penpot UI can. The following require the UI:

| Operation | Status |
|-----------|--------|
| Create/modify shapes, boards, groups | Fully supported |
| Apply layouts (flex, grid) | Fully supported |
| Styling (fills, strokes, shadows, blur, etc.) | Fully supported |
| Components and variants | Fully supported via API |
| Design tokens | Fully supported via API |
| Prototyping interactions | Supported via API |
| Export individual shapes (PNG/SVG) | Supported via `penpot_export_shape` |
| File management (create, rename, delete, move) | UI only |
| Team management (invite, roles, settings) | UI only |
| Account settings (profile, password, notifications) | UI only |
| Comments (read, write, resolve) | UI only |
| History / version control | UI only |
| Custom font upload | UI only |
| Share prototype links | UI only |
| View mode / prototype playback | UI only |
| Inspect mode (code snippets, measurements) | Read via API; UI for code gen |
| Bulk export (all boards to PDF) | UI only |
| File import (.penpot format) | UI only |
| Plugin installation/management | UI only |
| Webhook configuration | UI only |

---

## Reference: Penpot User Guide Topics

The full Penpot user guide covers these topics. The MCP API maps closely to them:

- **Workspace basics**: Viewport, pages, layers panel, rulers, guides, zoom, dynamic alignment, snap to pixel, nudge amount, focus mode
- **Layers**: Boards, rectangles, ellipses, text, curves (freehand), paths (bezier), images, groups, masks, boolean operations, constraints, layer actions (create, duplicate, delete, move, select, hide, lock, flip, align, distribute)
- **Color & Strokes**: Fills (custom, image, gradient), color picker, color palette, strokes (width, position, style, caps), gradients (linear, radial)
- **Text & Typography**: Font family (Google Fonts), font size, line height, letter spacing, text case, alignment, sizing (auto width/height/fixed), RTL support, custom fonts (TTF/OTF/WOFF)
- **Flexible Layouts**: Flex Layout (direction, wrap, align, justify, gap, padding, sizing, absolute positioning, z-index), Grid Layout (direction, align, justify, gap, padding, grid cells, grid units, areas)
- **Design Systems**: Assets, libraries (file and shared), components (main/copy, overrides, detach, swap), variants (properties, values, combine), design tokens (DTCG format, sets, themes, math, references)
- **Prototyping**: Interactions (triggers, actions, animations), flows, fixed scroll elements
- **Dev Tools**: Inspect mode, measurements, CSS/HTML code generation, export presets
- **Export**: Layers (PNG, JPEG, WEBP, SVG, PDF), boards to PDF, Penpot file format (.penpot zip)
- **Account & Teams**: Teams (roles, invitations), projects, files, drafts, trash
