---
name: unity-sprite
description: Comprehensive reference for Unity's 2D Sprite system including import, editing, rendering, atlasing, masking, sorting, 9-slicing, collision shapes, and profiling. Based on Unity 6.4 documentation.
---

# Unity Sprites

## Description
Comprehensive reference for Unity's 2D Sprite system including import, editing, rendering, atlasing, masking, sorting, 9-slicing, collision shapes, and profiling. Based on Unity 6.4 official documentation.

## When to Use
Load when working with 2D sprites in Unity: importing textures as sprites, spritesheet slicing, Sprite Editor workflows, Sprite Renderer configuration, sprite sorting, 9-slicing UI elements, atlas packing, masking, or 2D rendering optimization.

## Core Concepts

### Sprite Import & Setup

**Texture Type** must be set to **Sprite (2D and UI)**. In 2D projects, Unity does this automatically.

**Sprite Mode:**
| Mode | Description |
|------|-------------|
| **Single** | Whole texture as one sprite (can crop in Sprite Editor) |
| **Multiple** | Spritesheet — divide into several sprites (animation frames, tilesets) |
| **Polygon** | Clip sprite to a mesh defined in Sprite Editor's Custom Outline tab |

**Mesh Type:**
- **Full Rect**: Quad polygon (always 4 vertices). Required for 9-slicing.
- **Tight**: Generates mesh following opaque pixels (fewer transparent pixels rendered). Sprites smaller than 32×32 auto‑fall‑back to Full Rect.

**Pivot presets:** Center, Top Left, Top, Top Right, Left, Right, Bottom Left, Bottom, Bottom Right. Custom pivot uses Normalized (0–1) or Pixels unit mode.

**Key import settings:** `Pixels Per Unit`, `Extrude Edges`, `Generate Physics Shape`, `Alpha Source` (None / Input Texture Alpha / From Gray Scale), `Alpha is Transparency`, `Read/Write` (doubles memory when enabled), `Filter Mode` (Point / Bilinear / Trilinear), `Wrap Mode` (Repeat / Clamp / Mirror / Mirror Once / Per-axis).

### Placeholder Sprites

Temporary shapes (triangle, square, capsule) for quick prototyping. Created via **GameObject > 2D Object > Sprites**. Cannot be edited in Sprite Editor — replace via the Sprite picker in the Sprite Renderer component. Requires 2D Sprite package.

### Sprite Editor

Accessed from the texture Inspector (**Sprite Editor** button) when Texture Type = Sprite (2D and UI).

**Tabs:**
| Tab | Purpose |
|------|---------|
| **Sprite Editor** | Configure sprites, slice spritesheets, set pivots and borders |
| **Custom Outline** | Edit the render mesh shape (cropping, transparent pixel removal) |
| **Custom Physics Shape** | Edit collision geometry for PolygonCollider2D |
| **Secondary Textures** | Add normal maps, lighting masks per sprite |
| **Skinning Editor** | 2D animation rigging (requires 2D Animation package) |

**Slicing methods** (for Sprite Mode = Multiple):
- **Automatic**: Detect sprites separated by transparent pixels
- **Grid By Cell Size**: Equal-sized sprites defined by pixel dimensions
- **Grid By Cell Count**: Divide into M×N grid
- **Isometric Grid**: Diamond-shaped sprites with optional alternate-row staggering

**Slice overlay properties:** `Slice on Import` (re-slice on external change), `Column & Row`, `Pixel Size`, `Offset`, `Padding`, `Keep Empty Rects`, `Is Alternate`, `Pivot`, `Pivot Unit Mode`, `Custom Pivot`, `Method` (Delete Existing / Smart / Safe).

**Per-sprite overlay properties:** `Name`, `Position` (X, Y, W, H in pixels), `Border` (L, R, T, B for 9‑slicing, shown as green outline), `Pivot`, `Pivot Unit Mode`, `Custom Pivot`.

**Custom Outline tab properties:** `Outline Detail` (higher = more vertices, more GPU cost), `Alpha Tolerance` (minimum alpha to treat as opaque), `Snap` (snap vertices to pixel grid), `Generate` / `Generate All` / `Force Generate All`, `Copy` / `Paste` / `Paste All`, `From Physics Shape` (copy collision shape to outline).

**Editing outlines/physics shapes:** Drag points to move, click edge to add point, select + Delete to remove, Ctrl+drag edge to move entire edge.

### Sprite Renderer

Renders sprites in 2D and 3D scenes.

| Property | Description |
|----------|-------------|
| **Sprite** | Sprite asset to render |
| **Color** | Tint color (white = no tint) |
| **Flip** | Mirror along X/Y axis (doesn't move the GameObject) |
| **Draw Mode** | **Simple** — uniform scale; **Sliced** — 9-slice stretch; **Tiled** — repeat texture |
| **Mask Interaction** | **None** / **Visible Inside Mask** / **Visible Outside Mask** |
| **Sprite Sort Point** | **Center** or **Pivot** — which point determines distance-to-camera sort |
| **Material** | Material for the sprite (default: `Sprite-Lit-Default`) |
| **Sorting Layer** | Layer in the render order hierarchy |
| **Order in Layer** | Sublayer within Sorting Layer (lower = behind) |
| **Rendering Layer Mask** | Rendering layers for URP |

**Sliced/Tiled-only properties:** `Size` (dimensions of the sprite), `Tile Mode` (Continuous / Adaptive), `Stretch Value` (width/height multiplier before repeating starts; 1 = repeat at 2× original size).

### Sprite Sorting

Unity resolves render order using these criteria (in priority):

1. **Sorting Layer** — higher in the list renders earlier (behind)
2. **Order in Layer** — lower value renders earlier (behind)
3. **Render Queue** — material's Render Queue value (default 2D materials: 3000)
4. **Distance** — further from camera = behind. Orthographic uses plane distance; Perspective uses point distance.
5. **Shader/Material** — same shader/material objects render together (order within not guaranteed)

**Adding sorting layers:** Edit > Project Settings > Tags and Layers > Sorting Layers. New layers are added at the bottom (renders in front by default).

**Transparency Sort Mode:** Set in the 2D renderer asset (or Graphics settings for Built‑in RP). Custom Axis examples:
- `(0, 1, 0)` — vertical, higher Y renders behind (top‑down games)
- `(1, 1, 0)` — diagonal, top‑right renders behind (isometric games)

**Sorting Group component** (`Add Component > Rendering > Sorting Group`):
- Keeps child sprites from mixing with sprites outside the group
- Properties: `Sorting Layer`, `Order in Layer`, `Sorting Type` (Default / Sort at Root / Sort 3D as 2D)
- Can be nested; nested groups sort internally first, then as a single item in the parent
- **Typical use:** Character prefab with body-part sprites on different Order in Layer values — without Sorting Group, multiple prefab instances interleave body parts incorrectly. With it, each instance renders as a single cohesive unit.

### 9-Slicing

Divides a sprite into 9 regions (corners A/C/G/I, edges B/D/F/H, center E) so it can be resized without distorting proportions. Borders are defined in pixels (L, R, T, B) via the Sprite Editor.

**Draw Modes:**
- **Sliced**: Corners keep size; top/bottom edges stretch horizontally; left/right edges stretch vertically; center stretches both axes.
- **Tiled**: Same corner/edge logic but edges and center repeat (tile) instead of stretching.

**Tile Mode** (Tiled only):
- **Continuous**: Doesn't stretch; edge tiles may use cropped parts.
- **Adaptive**: Stretches center until `Stretch Value` is reached, then tiles. Each tile uses the full texture.

**Collision with 9‑slice:** Only BoxCollider2D and PolygonCollider2D support 9‑slicing. Enable **Auto Tiling** to auto‑update the collider when sprite dimensions change. While Draw Mode is Sliced/Tiled, the Sprite Renderer controls the Collider 2D — manual collider editing is disabled.

**Critical setup:** Mesh Type must be **Full Rect** before 9‑slicing (Tight mesh can cause issues). The border handles appear as green squares in the Sprite Editor.

### Collision Shapes

**Automatic setup:** Add a **Polygon Collider 2D** component — Unity auto‑generates collision geometry matching opaque pixels.

**Default custom geometry** (applies to all instances): Use Sprite Editor > **Custom Physics Shape** tab → `Generate` → adjust `Outline Detail` and `Alpha Tolerance` → `Apply` → add PolygonCollider2D. Update existing colliders via right‑click > Reset on the collider title.

**Per‑instance editing:** Select the GameObject → click **Edit Collider** in Inspector. Move points by dragging, add points by clicking edges, remove by Ctrl/Cmd‑hovering an edge and selecting the red highlight. Exit by clicking **Edit Collider** again. Per‑instance edits do NOT change the sprite asset's Custom Physics Shape.

### Sprite Atlas

Combines multiple textures into a single GPU texture, reducing draw calls. Created via **Assets > Create > 2D > Sprite Atlas** (`.spriteatlasv2`).

**Important:** The SRP Batcher may not reduce draw call count with atlases, but performance still improves through reduced texture binds and state changes.

**Inspector properties:**
| Property | Description |
|----------|-------------|
| **Type** | Master (full resolution) or Variant (lower resolution) |
| **Master Atlas** | Parent atlas for variants |
| **Include in Build** | Auto‑load at startup; disable for Late Binding |
| **Allow Rotation** | Rotate sprites to pack more efficiently |
| **Tight Packing** | Pack based on custom mesh outline (not full rect) |
| **Alpha Dilation** | Expand edge colors to prevent visible seams |
| **Padding** | Pixels between sprites (default: 4) |
| **Max Texture Size** | Maximum atlas texture dimensions |
| **Filter Mode** | Point / Bilinear / Trilinear |
| **Objects for Packing** | Drag sprites, textures, or folders here |

**Variant atlases:** Set Type to Variant, assign a Master Atlas, set Scale (e.g. 0.5 for half resolution). Useful for platform‑specific quality tiers.

**Prepare sprites for packing:** Disable `Read/Write` on source textures (unless needed in scripts), enable `Tight Packing` on the atlas.

**Late Binding:** Disable `Include in Build` and load atlas at runtime via `SpriteAtlasManager.atlasRequested`.

### Sprite Masking

Hides portions of sprites based on a mask shape. The mask sprite's opaque pixels define what is visible/hidden.

**Setup:**
1. Enable **Depth/Stencil Buffer** in the 2D renderer asset
2. Create or select **GameObject > 2D Object > Sprite Mask**
3. On masked sprites, set `Mask Interaction` to **Visible Inside Mask** or **Visible Outside Mask**
4. Ensure the masked sprite and mask sprite overlap

**Sprite Mask component properties:**
| Property | Description |
|----------|-------------|
| **Mask Source** | Sprite or Supported Renderer |
| **Sprite** | Sprite used as the mask shape |
| **Supported Renderer** | Sprite Renderer / Sprite Shape Renderer / Tilemap Renderer |
| **Sprite Sort Point** | Center or Pivot for distance calculation |
| **Alpha Cutoff** | Minimum alpha treated as a mask pixel |
| **Custom Range** | Limit mask to specific sorting layer range (Front/Back with Layer + Order) |
| **Rendering Layer Mask** | Which rendering layers the mask affects |

**Limitations:** Sprite masks are incompatible with the SRP Batcher (falls back to dynamic batching) and GPU 2D animation deformation (falls back to CPU). Use Sorting Groups to prevent multiple masks from interfering with each other.

### 2D Profiling

Access via **Window > Analysis > Profiler**. The Rendering Profiler module shows:

| Chart | Watches |
|-------|---------|
| **Batches Count** | Draw batches per frame |
| **SetPass Calls Count** | Shader pass switches |
| **Triangles Count** | Triangles processed |
| **Vertices Count** | Vertices processed |

Details pane also reports: Draw Calls, Used Textures, Render Textures, Vertex Buffer Upload, and Dynamic/Static Batching breakdowns (batched draw calls, batches, triangles, vertices, batching time).

**Optimization targets:** Reduce batch count (atlases, shared materials), minimize SetPass calls (use same shader/materials), reduce vertex count (Tight mesh on large sprites, avoid excessive Outline Detail), use sprite masks sparingly (they disable SRP Batcher), disable Read/Write and mipmaps where unnecessary, and use Crunch compression for smallest builds.

## Code Patterns

### Load Sprite from Atlas at Runtime (Late Binding)

```csharp
void OnEnable()
{
    SpriteAtlasManager.atlasRequested += MySpriteAtlasLoader;
}

void OnDisable()
{
    SpriteAtlasManager.atlasRequested -= MySpriteAtlasLoader;
}

// From Resources
void MySpriteAtlasLoader(string spriteAtlasName, System.Action<SpriteAtlas> callback)
{
    var spriteAtlas = Resources.Load<SpriteAtlas>(spriteAtlasName);
    callback(spriteAtlas);
}

// From AssetBundle
void MySpriteAtlasLoader(string spriteAtlasName, System.Action<SpriteAtlas> callback)
{
    var bundle = AssetBundle.LoadFromFile("path/to/assetbundle");
    var spriteAtlas = bundle.LoadAsset<SpriteAtlas>(spriteAtlasName);
    callback(spriteAtlas);
}
```

### Change Sprite Sorting Order at Runtime

```csharp
using UnityEngine;

public class SpriteSortController : MonoBehaviour
{
    [SerializeField] SpriteRenderer spriteRenderer;

    public void SetLayer(string layerName, int orderInLayer)
    {
        spriteRenderer.sortingLayerName = layerName;
        spriteRenderer.sortingOrder = orderInLayer;
    }

    public void BringToFront(int increment = 10)
    {
        spriteRenderer.sortingOrder += increment;
    }
}
```

### Configure 9-Slice Borders

```csharp
// Read or adjust a sprite's 9-slice border at runtime
// (Border values are set in the Sprite Editor; read-only at runtime via the Sprite asset)

using UnityEngine;

public class NineSliceInfo : MonoBehaviour
{
    [SerializeField] Sprite nineSlicedSprite;

    void Start()
    {
        Vector4 border = nineSlicedSprite.border;
        Debug.Log($"Borders — L:{border.x} R:{border.z} B:{border.y} T:{border.w}");

        // Apply 9-slice rendering
        var sr = GetComponent<SpriteRenderer>();
        sr.sprite = nineSlicedSprite;
        sr.drawMode = SpriteDrawMode.Sliced;
        sr.size = new Vector2(5f, 3f); // resizable without distortion
    }
}
```

### Create Polygon Collider from Sprite

```csharp
using UnityEngine;

public class SpriteColliderSetup : MonoBehaviour
{
    void Start()
    {
        var spriteRenderer = GetComponent<SpriteRenderer>();
        if (spriteRenderer == null) return;

        // Option 1: Auto-generate from sprite's opaque pixels
        var collider = gameObject.AddComponent<PolygonCollider2D>();

        // Option 2: Use physics shape defined in Sprite Editor (Custom Physics Shape tab)
        // Enable "Generate Physics Shape" in the sprite's import settings,
        // then add PolygonCollider2D — it picks up the custom shape automatically.

        // To re-generate: right-click the PolygonCollider2D component title > Reset
        collider.isTrigger = false;
    }
}
```

### Sprite Mask Setup

```csharp
// Programmatic setup example

using UnityEngine;

public class SpriteMaskController : MonoBehaviour
{
    [SerializeField] Sprite maskShape;
    [SerializeField] GameObject maskedObject;

    void Start()
    {
        var mask = GetComponent<SpriteMask>();
        mask.sprite = maskShape;
        mask.alphaCutoff = 0.5f;

        // Configure Custom Range to limit mask to specific layers
        mask.frontSortingLayerID = SortingLayer.NameToID("Foreground");
        mask.frontSortingOrder = 10;
        mask.backSortingLayerID = SortingLayer.NameToID("Background");
        mask.backSortingOrder = 0;

        // Set masked sprite to interact with this mask
        maskedObject.GetComponent<SpriteRenderer>().maskInteraction = SpriteMaskInteraction.VisibleInsideMask;
    }
}
```

### Runtime Profiler Stats Display

```csharp
using System.Text;
using Unity.Profiling;
using UnityEngine;

public class RenderStatsScript : MonoBehaviour
{
    string statsText;
    ProfilerRecorder setPassCallsRecorder;
    ProfilerRecorder drawCallsRecorder;
    ProfilerRecorder verticesRecorder;

    void OnEnable()
    {
        setPassCallsRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "SetPass Calls Count");
        drawCallsRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls Count");
        verticesRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Vertices Count");
    }

    void OnDisable()
    {
        setPassCallsRecorder.Dispose();
        drawCallsRecorder.Dispose();
        verticesRecorder.Dispose();
    }

    void Update()
    {
        var sb = new StringBuilder(500);
        if (setPassCallsRecorder.Valid)
            sb.AppendLine($"SetPass Calls: {setPassCallsRecorder.LastValue}");
        if (drawCallsRecorder.Valid)
            sb.AppendLine($"Draw Calls: {drawCallsRecorder.LastValue}");
        if (verticesRecorder.Valid)
            sb.AppendLine($"Vertices: {verticesRecorder.LastValue}");
        statsText = sb.ToString();
    }

    void OnGUI()
    {
        GUI.TextArea(new Rect(10, 30, 250, 50), statsText);
    }
}
```

## Key Classes and Components Reference

| Class/Component | Purpose |
|-----------------|---------|
| `Sprite` | Asset representing a 2D image with pivot, border, and mesh data |
| `SpriteRenderer` | Component that renders a Sprite in the scene |
| `SpriteAtlas` | Packs multiple sprites into one texture for batching efficiency |
| `SpriteAtlasManager` | Static class; manages atlas lifecycle and `atlasRequested` late‑binding callback |
| `SpriteMask` | Component that hides/reveals portions of overlapping sprites |
| `SpriteMaskInteraction` | Enum: `None`, `VisibleInsideMask`, `VisibleOutsideMask` |
| `SortingGroup` | Component that prevents child sprites from mixing with external sprites during sorting |
| `SpriteDrawMode` | Enum: `Simple`, `Sliced`, `Tiled` (on `SpriteRenderer.drawMode`) |
| `SpriteTileMode` | Enum: `Continuous`, `Adaptive` (on `SpriteRenderer.tileMode`) |
| `PolygonCollider2D` | 2D collider that auto‑generates from sprite opaque pixels or custom physics shape |
| `BoxCollider2D` | 2D rectangular collider; supports 9‑slice auto‑tiling (unlike CircleCollider2D) |
| `ProfilerRecorder` | Runtime access to Profiler metrics (SetPass Calls, Draw Calls, Vertices, etc.) |
| `SortingLayer` | Named layers defining render priority; configured in Project Settings > Tags and Layers |
| `TextureImporter` | Editor‑only class; sets Texture Type, Sprite Mode, Mesh Type, and all import settings |

## Best Practices

- **Use Tight mesh for large sprites with transparency** — reduces overdraw and vertex count vs Full Rect. Keep on Full Rect for small sprites (tight is auto‑disabled below 32×32).
- **Set Mesh Type to Full Rect before 9‑slicing** — Tight mesh may cause slice artifacts.
- **Organize scenes with Sorting Layers** (Background, Foreground, UI, etc.) rather than relying on Z‑position distance sorting alone.
- **Use Sorting Group on multi‑sprite prefabs** (characters, compound objects) to prevent sub‑sprite interleaving between instances.
- **Create separate sprite atlases per scene or per usage‑frequency tier** — don't pack everything into one giant atlas.
- **Disable Read/Write on sprite textures** unless scripts modify pixel data at runtime (Read/Write doubles memory).
- **Disable Include in Build on atlases** when using Late Binding to avoid bloating startup time and memory.
- **Use variant atlases** for platform quality tiers (e.g., 0.5× scale for mobile), not for the same platform.
- **Keep `Outline Detail` moderate** — higher values increase vertex count with diminishing visual returns; tune `Alpha Tolerance` instead for cleaner edge cropping.
- **Use `Slice on Import`** for spritesheets that are updated externally to avoid manual re‑slicing.
- **Avoid excessive sprite masks** — they disable SRP Batcher and force dynamic batching. Prefer atlases and material sharing for bulk performance.
- **Enable `Alpha Dilation` on atlases** to prevent edge seam artifacts when sprites are packed tightly.
- **Profile early** — monitor Batches Count, SetPass Calls, and Vertices Count in the Profiler Rendering module during development, not just before release.

## Additional Resources

- [Sprite Renderer Reference](https://docs.unity3d.com/Manual/sprite/renderer/sprite-renderer-reference.html)
- [Sprite Editor Window Reference](https://docs.unity3d.com/Manual/sprite/sprite-editor/sprite-editor-window-reference-landing.html)
- [9-Slicing Sprites](https://docs.unity3d.com/Manual/sprite/9-slice/9-slice-landing.html)
- [2D Physics](https://docs.unity3d.com/Manual/2d-physics/2d-physics.html)
- [Sprite Atlases](https://docs.unity3d.com/Manual/sprite/atlas/atlas-landing.html)
- [Sprite Masking](https://docs.unity3d.com/Manual/sprite/mask/mask-landing.html)
- [Sprite Sort Point](https://docs.unity3d.com/Manual/sprite/renderer/sprite-renderer-reference.html)
- [Sprite Atlas Analyzer Package](https://docs.unity3d.com/Packages/com.unity.2d.tooling@latest/index.html?subfolder=/manual/GetStarted-sprite-atlas-analyzer.html)
- [2D Animation Package](https://docs.unity3d.com/Packages/com.unity.2d.animation@latest/index.html)
- [Unity 2D Overview](https://docs.unity3d.com/Manual/Unity2D.html)
