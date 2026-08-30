---
name: unity-tilemaps
description: Comprehensive reference for Unity's Tilemap system including rectangular, hexagonal, and isometric tilemaps, tile palettes, brushes, custom tiles, collision, and scripting. Based on Unity 6.4 documentation.
---

# Unity Tilemaps

## Description
Comprehensive reference for Unity's Tilemap system including rectangular, hexagonal, and isometric tilemaps, tile palettes, brushes, custom tiles, collision, and scripting. Covers Unity 6.x (6000) — the Tilemap Editor and Tilemap Extras packages.

## When to Use
Load when working with 2D tile-based levels in Unity: creating tilemaps, painting tiles, setting up tile palettes, configuring hexagonal/isometric grids, adding tilemap collision, creating custom tiles/brushes, or scripting tilemap behavior.

## Core Concepts

### Tilemap Overview
Tilemaps let you build 2D game worlds by painting tiles onto a grid in the Scene view. The system is part of the **2D Tilemap Editor** package (auto-installed with the 2D template). It supports all render pipelines that support 2D.

**Three tilemap layouts:**
- **Rectangular** – Standard square grid; default for platformers and top-down games.
- **Hexagonal** – Hex-shaped cells; two orientations: **Point Top** (vertex up) and **Flat Top** (flat side up). Common in strategy games.
- **Isometric** – Diamond-shaped grid simulating 3D depth; two variants: standard **Isometric** (ground level) and **Isometric Z as Y** (per-tile height via z-axis).

The basic workflow: Create a tile palette (collection of tile assets) → Create a tilemap in the scene (the grid + renderable layer) → Paint tiles using the Tile Palette window.

### Tile Palettes
A tile palette is a collection of tile assets you paint with.

**Create an empty palette:** `Assets → Create → 2D → Tile Palette` then select the tilemap type (Rectangular, Hexagonal Point/Flat Top, Isometric). This creates a palette asset plus a child asset with settings.

**Create a tileset (recommended for spritesheets):** `Assets → Create → 2D → Tile Palette → New Tile Set`. Produces a Tile Set Importer, palette settings, and an auto-generated sprite atlas. Tilesets update automatically when the source texture changes.

**Adding tiles to a palette:** Open `Window → 2D → Tile Palette`, set the Active Palette, then drag sprites/textures from the Project window into the palette. For textures with **Sprite Mode: Multiple**, each child sprite becomes a tile. **Note:** Tiles created by drag-and-drop are not linked to the source sprite — changing the sprite does not update the tile palette (tilesets solve this).

**Tileset workflow:** Select the Tile Set Importer → open **Texture Sources** in the Inspector → click **Add (+)** → drag a texture into the **Texture** field → click **Apply**. Unity converts the texture into tile assets and adds them as children.

**Palette Edit Mode:** Enable the pen icon to use Select/Move/Erase tools directly on the palette. Not available for tilesets.

### Painting Tiles
The Tile Palette window (`Window → 2D → Tile Palette`) provides these tools:

| Tool | Shortcut | Description |
|------|----------|-------------|
| **Select** | S | Select tiles on the tilemap |
| **Move** | M | Move tile selections (requires Select first) |
| **Paint** | B | Paint selected tiles onto the tilemap |
| **Box Fill** | U | Fill a rectangular area with tiles |
| **Pick** | I | Pick tiles from tilemap or palette |
| **Erase** | D | Erase tiles from the tilemap |
| **Flood Fill** | G | Fill contiguous area with selected tile |

**Additional controls:**
- **Rotate CCW:** `[` — **Rotate CW:** `]`
- **Flip X:** `Shift+[` — **Flip Y:** `Shift+]`

**Workflow:**
1. Set **Active Target** dropdown to the tilemap you want to paint on.
2. Select a tool (e.g., Paint with `B`).
3. Select tiles from the palette (click and drag to multi-select).
4. Paint in the Scene view. Hold **Ctrl/Cmd** and click a tile in the Scene to pick it.

**Deleting tiles:** Select + Delete, or hold **Shift** while painting, or use the Erase tool (`D`).

**Active Target dropdown** can also: create new tilemaps directly (matching palette dimensions or choosing a type), toggle visibility, and ping tilemaps in the Hierarchy. Creating a new tilemap on a Grid with a mismatched Cell Layout shows a warning — selecting Continue changes the Grid's Cell Layout.

**Brush Inspector** (bottom of palette window) properties:
| Property | Description |
|----------|-------------|
| **Script** | Assigned brush script (Default: GridBrush) |
| **Flood Fill Contiguous Only** | Limit Flood Fill to contiguous tiles |
| **Lock Z Position** | Fix z-position while painting |
| **Z Position** | Z-axis value for tile height (affects isometric) |
| **Reset** | Reset z-position to zero |

**Prebuilt brush types** (from 2D Tilemap Extras):
- **Default Brush** – Standard painting.
- **GameObject Brush** – Instances GameObjects onto the scene.
- **Group Brush** – Picks grouped tiles by position.
- **Random Brush** – Places random tiles from defined Tile Sets.
- **Line Brush** – Draws lines of tiles.

### Brush Picks
Brush Picks save a tile (or group of tiles) with their brush settings for reuse.

**Create:** Enable the Brush Pick overlay button → Pick tool (`I`) → select tiles → adjust brush settings → click **Save** in the overlay.

**Overlay features:** text filter, filter by brush type toggle, **Hide on Pick** (auto-close on selection), thumbnail size slider, List/Grid view toggles.

**Editing:** double-click to rename; select + Delete to remove.

**Source control:** Brush Picks are saved in the `Library` folder by default (usually excluded from VC). Change via Tile Palette preferences. Custom thumbnails via `RenderStaticPreview` in the Brush Pick's Editor or the brush's `icon` property.

### Tilemap Types

#### Rectangular Tilemaps
Standard square grid. Create via `Right-click Hierarchy → 2D Object → Tilemap → Rectangular Tilemap`. Cell Size and Cell Gap configurable on the Grid component. Default orientation is XY.

#### Hexagonal Tilemaps
**Creating a hexagonal tilemap:**
1. Import sprites (use **Sprite Mode: Polygon** for individual hex sprites; use the Sprite Polygon Mode Editor to cut hex shapes).
2. Create a hexagonal tile palette: `Assets → Create → 2D → Tile Palette` → type **Hexagonal Point Top** or **Hexagonal Flat Top**.
3. Create hexagonal tilemap in scene: set Grid **Cell Layout** to **Hexagon**.

**Cell sizing:** The Grid's **Cell Size** property controls hex cell dimensions. Exact values depend on orientation and sprite dimensions. For point-top, the Y-axis affects vertical distance more; for flat-top, X and Y swap roles — Cell Size X affects vertical distance, Y affects horizontal.

**Point Top:** Hexagons have a vertex at the top. Every other row offsets right by half a cell.
**Flat Top:** Hexagons have a flat edge at the top. Every other column offsets down by half a cell. X/Y axes are effectively swapped.

#### Isometric Tilemaps
Create the illusion of 3D using a 2D grid. Two variants:

1. **Isometric** – All tiles at ground level. Create separate tilemaps with different **Order in Layer** values and **Tile Anchor** offsets for height layers.
2. **Isometric Z as Y** – Single tilemap; per-tile height via z-axis value.

**Importing isometric sprites:**
- **Mesh Type:** Tight (avoids transparent corner pixels).
- **Pixels Per Unit (PPU):** Set to the tile width in pixels so the tile fits one cell.
- **Sprite Pivot:** Custom pivot at the center of the 3D floor (so 3D sides extend below the grid space).

**Cell Size for isometric palettes:** Set `y = floor_height_pixels / width_pixels`. Example: tile with floor height 32px and width 64px → y = 16 / 32 = 0.5. Common default: x=1, y=0.5 (2:1 ratio).

**Setting up an isometric tilemap:**
1. Create tilemap with **Isometric** or **Isometric Z as Y**.
2. Match Grid **Cell Size** to the palette.
3. In the 2D renderer asset, set **Transparency Sort Mode** to **Custom Axis**, then **Transparency Sort Axis** to `(0, 1, 0)` — ensures higher tiles render behind lower tiles.

**Method 1 — Multiple tilemaps for height:**
- Set Grid **Cell Layout** to **Isometric**.
- Add child tilemaps via right-click on Grid → `2D Object → Tilemap`.
- Increase **Order in Layer** and **Tile Anchor** (e.g., +0.5 on x and y) for higher layers.

**Method 2 — Isometric Z as Y for height:**
- Set Grid **Cell Layout** to **Isometric Z as Y**.
- Calculate z-axis sort: `z = (Cell Size y) × -0.5 - 0.01`. Example: y=0.5 → z = -0.26.
- In Tile Palette, disable **Lock Z Position**; set **Z Position** to the desired height or use `-` / `+` keys while painting.
- Scene view shows white outline at ground level, blue outline at the painted Z height.

**Render Mode:** **Chunk** (default, batched — better performance but objects can't interleave between depth layers) vs **Individual** (per-tile sorting, allows characters between tiles at different depths — worse performance).

**Tile Anchor:** Offsets tile anchor positions on x/y/z axes (in cells). Used to position tiles at different heights in isometric tilemaps.

### Collision
**Tilemap Collider 2D** generates collider shapes per tile. Add via `Add Component → Tilemap Collider 2D`. Scene view shows colliders as green outlines.

**Disabling per-tile collision:** Select the tile asset → set **Collider Type** to **None**.

**Custom collision shapes:** Set **Collider Type** to **Sprite** → open **Sprite Editor** → select **Custom Physics Shape** from the dropdown.

**Performance:** Add a **Composite Collider 2D** to merge neighboring tile colliders into fewer shapes. When a Composite Collider 2D is attached, the **Extrusion Factor** property becomes available to minimize gaps between tile colliders (in world units).

**Tilemap Collider 2D properties:**
| Property | Description |
|----------|-------------|
| **Max Tile Change Count** | Max tile changes before full rebuild (high values slow incremental rebuilds) |
| **Extrusion Factor** | Extrudes collider shapes to minimize gaps (requires Composite Collider 2D) |
| **Use Delaunay Mesh** | Delaunay triangulation for complex tiles — improves shape but reduces performance |
| **Material** | Physics Material 2D for friction/bounce |
| **Is Trigger** | Make collider a trigger |
| **Used by Effector** | Allow use by Effector 2D |
| **Composite Operations** | Operation for attached Composite Collider 2D: None, Merge, Intersect, Difference, Flip |
| **Offset** | Local offset of collider geometry |

**Manual updates via API:** By default, Tilemap Collider 2D updates during `LateUpdate` and batches changes. Force immediate processing with `HasTilemapChanges()` / `ProcessTilemapChanges()` (see Code Patterns).

### Custom Tiles
Custom tiles inherit from `TileBase` and dynamically control their appearance via `GetTileData`. The `Tile` class is a simpler subclass of `TileBase` with built-in sprite/collider support.

**Prebuilt scriptable tiles** (from 2D Tilemap Extras):
- **RuleTile** – Changes sprite based on neighboring tile configuration.
- **AnimatedTile** – Cycles through a sprite array for animation.
- **PipelineTile** – Connects in lines based on direction (pipes, wires).

To use prebuilt tiles: install the 2D Tilemap Extras package → `Assets → Create → 2D → Tiles` → select type → drag to palette.

### Custom Brushes
Custom brushes inherit from `GridBrushBase` and override painting methods.

**Prebuilt scriptable brushes** (from 2D Tilemap Extras): **Random Brush**, **Line Brush**, **GameObject Brush**, **Group Brush**. Select them from the Brush dropdown in the Tile Palette window.

**GridBrushBase methods to override:**
| Method | Purpose |
|--------|---------|
| `Paint` | Add items to the grid |
| `Erase` | Remove items from the grid |
| `FloodFill` | Fill areas on the grid |
| `Rotate` | Rotate items |
| `Flip` | Flip items |
| `ChangeZPosition` | Control 3D height (Isometric Z as Y) |
| `ResetZPosition` | Reset 3D height |

**Custom editor overrides** (in a brush's Editor class):
- `OnPaintInspectorGUI` – Inspector UI when brush is selected.
- `OnPaintSceneGUI` – Additional Scene view behaviors.
- `validTargets` – Custom target list the brush can interact with.

**Attributes:** `[CustomGridBrush]` (name, default brush), `[BrushTools]` (compatible TilemapEditorTools types).

### Component Reference

**Grid** — Parent GameObject defining cell structure. Created automatically with the first tilemap. Properties:
| Property | Description |
|----------|-------------|
| **Cell Size** | Size of each grid cell (units) |
| **Cell Gap** | Space between cells |
| **Cell Layout** | Rectangle, Hexagon, Isometric, Isometric Z as Y |
| **Cell Swizzle** | Reorder XYZ coordinates: XYZ, XZY, YXZ, YZX, ZXY, ZYX |

**Tilemap** — Stores and manages tile assets; transfers info to TilemapRenderer and TilemapCollider2D. Properties:
| Property | Description |
|----------|-------------|
| **Animation Frame Rate** | Speed multiplier for tile animations |
| **Color** | Tint color (white = no tint) |
| **Tile Anchor** | Anchor offset in cells (x/y/z) |
| **Orientation** | XY, XZ, YX, YZ, ZX, ZY, or Custom |
| **Offset / Rotation / Scale** | Custom orientation transform (when Orientation = Custom) |

**Tilemap Renderer** — Controls rendering. Properties:
| Property | Description |
|----------|-------------|
| **Mode** | Chunk (batched) or Individual (per-tile sorting) |
| **Sort Order** | Bottom Left, Bottom Right, Top Left, Top Right, X Right, X Left, Y Down, Y Up |
| **Detect Chunk Culling Bounds** | Auto culling bounds detection |
| **Chunk Culling Bounds** | Manual culling bounds |
| **Max Chunk Size** | Max chunk size for batching |
| **Sort Layer / Order in Layer** | Rendering order |

## Code Patterns

### Get/Set Tile at Position
```csharp
using UnityEngine;
using UnityEngine.Tilemaps;

public class TilemapHelper : MonoBehaviour
{
    public Tilemap tilemap;
    public TileBase tile;

    void Start()
    {
        // Set a tile at cell position (3, 2, 0)
        tilemap.SetTile(new Vector3Int(3, 2, 0), tile);

        // Get the tile at a position
        TileBase existingTile = tilemap.GetTile(new Vector3Int(3, 2, 0));

        // Get tile at a world position
        Vector3Int cellPos = tilemap.WorldToCell(transform.position);
        TileBase worldTile = tilemap.GetTile(cellPos);

        // Clear a tile
        tilemap.SetTile(new Vector3Int(3, 2, 0), null);
    }
}
```

### Create and Paint Tiles Programmatically
```csharp
using UnityEngine;
using UnityEngine.Tilemaps;

public class FillArea : MonoBehaviour
{
    public Tilemap tilemap;
    public TileBase floorTile;

    void Start()
    {
        BoundsInt bounds = new BoundsInt(-5, -5, 0, 10, 10, 1);
        TileBase[] tiles = new TileBase[bounds.size.x * bounds.size.y];
        for (int i = 0; i < tiles.Length; i++)
            tiles[i] = floorTile;
        tilemap.SetTilesBlock(bounds, tiles);
    }
}
```

### Tilemap Collision Setup
```csharp
using UnityEngine;
using UnityEngine.Tilemaps;

public class CollisionManager : MonoBehaviour
{
    public TilemapCollider2D tilemapCollider;

    void ForceColliderUpdate()
    {
        if (tilemapCollider.HasTilemapChanges())
        {
            tilemapCollider.ProcessTilemapChanges();
        }
    }
}
```

### Custom Scriptable Tile
```csharp
using UnityEngine;
using UnityEngine.Tilemaps;

[CreateAssetMenu]
public class MyScriptableTile : TileBase
{
    public Sprite sprite;

    public override void GetTileData(Vector3Int position, ITilemap tilemap, ref TileData tileData)
    {
        tileData.sprite = sprite;
        tileData.color = Color.white;
        tileData.colliderType = Tile.ColliderType.Sprite;
    }

    public override void RefreshTile(Vector3Int position, ITilemap tilemap)
    {
        // Called when neighbors change — refresh adjacent tiles
        tilemap.RefreshTile(position);
    }
}
```

### Custom Brush
```csharp
using UnityEngine;
using UnityEngine.Tilemaps;

[CreateAssetMenu]
public class MyCustomBrush : GridBrushBase
{
    public override void Paint(GridLayout grid, GameObject brushTarget, Vector3Int position)
    {
        base.Paint(grid, brushTarget, position);
        // Custom paint logic here
    }

    public override void Erase(GridLayout grid, GameObject brushTarget, Vector3Int position)
    {
        base.Erase(grid, brushTarget, position);
    }

    public override void FloodFill(GridLayout grid, GameObject brushTarget, Vector3Int position)
    {
        base.FloodFill(grid, brushTarget, position);
    }

    public override void Rotate(GridLayout grid, GameObject brushTarget, Vector3Int position, float angle)
    {
        base.Rotate(grid, brushTarget, position, angle);
    }

    public override void Flip(GridLayout grid, GameObject brushTarget, Vector3Int position, Axis axis)
    {
        base.Flip(grid, brushTarget, position, axis);
    }
}
```

## Key Classes and Components Reference
| Class/Component | Purpose |
|----------------|---------|
| `Grid` | Defines cell layout, size, gap, and swizzle for all child tilemaps |
| `Tilemap` | Stores and manages tile assets; provides `SetTile`/`GetTile`/`SetTilesBlock` |
| `TilemapRenderer` | Renders the tilemap; Mode (Chunk/Individual), Sort Order |
| `TilemapCollider2D` | Generates colliders per tile; `HasTilemapChanges`/`ProcessTilemapChanges` |
| `CompositeCollider2D` | Merges tile colliders for performance |
| `TileBase` | Base class for all tiles; override `GetTileData` and `RefreshTile` |
| `Tile` | Simpler subclass of `TileBase` with built-in sprite and collider type properties |
| `TileData` | Struct passed by ref in `GetTileData`; holds sprite, color, colliderType, transform |
| `GridBrushBase` | Base class for custom brushes; override `Paint`, `Erase`, `FloodFill`, etc. |
| `GridLayout` | Abstract base for Grid; provides cell-to-world conversion methods |
| `Vector3Int` | Integer cell coordinates used throughout tilemap APIs |
| `BoundsInt` | Integer bounds for block operations like `SetTilesBlock` |

## Best Practices
- Use a **composite collider** whenever Tilemap Collider 2D is added — it merges neighboring colliders and significantly improves physics performance.
- Create **tilesets** (not plain palettes) for spritesheets — they auto-update when source textures change.
- For isometric Z as Y tilemaps, always set **Transparency Sort Mode → Custom Axis** with axis `(0, 1, 0)` on the 2D renderer asset to get correct depth sorting.
- Match the **Cell Size y** value between the Grid and the tile palette for isometric tilemaps; mismatched values cause visual misalignment.
- Use **Tight** mesh type and set **PPU** to tile width in pixels when importing isometric sprites to avoid transparent corner artifacts.
- Prefer **Chunk** render mode unless you specifically need per-tile depth sorting (characters moving between tile heights); Individual mode is notably slower.
- Keep custom tile scripts minimal — `GetTileData` is called frequently during painting and rendering.
- Save Brush Picks to a version-controlled folder (not the default `Library/`) via Tile Palette preferences if you collaborate on a project.
- When adding multiple isometric height layers without Z as Y, increment **Order in Layer** and offset **Tile Anchor** by 0.5 on x and y for each height level.
- For hexagonal tilemaps, import sprites with **Sprite Mode: Polygon** and use the Sprite Polygon Mode Editor to cut accurate hex shapes.
- Use `WorldToCell` to convert world positions to grid cell coordinates before calling `GetTile` or `SetTile`.

## Additional Resources
- [Unity Tilemap Manual](https://docs.unity3d.com/Manual/Tilemap.html)
- [Tilemap Scripting API](https://docs.unity3d.com/ScriptReference/Tilemaps.Tilemap.html)
- [2D Tilemap Extras Package](https://docs.unity3d.com/Packages/com.unity.2d.tilemap.extras@latest)
- [TilemapCollider2D API](https://docs.unity3d.com/ScriptReference/Tilemaps.TilemapCollider2D.html)
- [TileBase API](https://docs.unity3d.com/ScriptReference/Tilemaps.TileBase.html)
- [GridBrushBase API](https://docs.unity3d.com/ScriptReference/GridBrushBase.html)
- [Unity Learn: Tilemap Collision Setup](https://learn.unity.com/course/2D-adventure-robot-repair/unit/game-environment-and-physics/tutorial/set-up-tilemap-collision)
