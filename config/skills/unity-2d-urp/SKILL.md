---
name: unity-2d-urp
description: Comprehensive reference for 2D game development in Unity's Universal Render Pipeline (URP), including 2D Renderer setup, lighting, Pixel Perfect Camera, mixing 3D in 2D scenes, custom rendering, and post-processing. Based on Unity 6.4 documentation.
---

# Unity 2D URP

## Description
Comprehensive reference for 2D game development in Unity's Universal Render Pipeline (URP), including 2D Renderer setup, lighting, Pixel Perfect Camera, mixing 3D in 2D scenes, custom rendering, and post-processing. Covers Unity 6.4 / URP 10+.

## When to Use
Load when working with 2D projects in URP: setting up the 2D Renderer, configuring 2D lights and shadows, using Pixel Perfect Camera, rendering 3D meshes in 2D scenes, creating custom post-processing effects, or writing Scriptable Renderer Features for 2D.

## Core Concepts

### 2D Renderer Setup
- Requires Unity 2021.2.0b1+ and URP package 10+.
- Create via **Hierarchy > Create > Rendering > URP Asset (with 2D Renderer)**.
- Unity generates a URP Asset and a Universal Renderer asset (suffixed `_Renderer`).
- The URP Asset's 3D-related settings have no effect on 2D output.
- Assign the generated URP Asset in **Project Settings > Graphics > Scriptable Render Pipeline Settings**.

### 2D Lighting
The 2D lighting system is **coplanar** (no depth separation needed), **not physically based**, and uses its own components and render pass separate from 3D lighting. 3D and 2D Lights cannot interoperate directly — use multiple cameras and Render Textures to combine them.

**Rendering pipeline phases:**
1. **Pre-phase**: Analyze sorting layers to batch consecutive layers that share the exact same set of lights.
2. **Phase 1 — Draw Light Render Textures**: Render each light's shape/color onto Render Textures (blended with Additive or Alpha Blend).
3. **Phase 2 — Draw Renderers**: Combine sprite input color with Light Render Texture colors using the specified blend operation.

**Light types** (GameObject > Light):
- **Freeform Light 2D**: Editable polygon shape with a spline editor. Properties: `Falloff`, `Falloff Strength`. Avoid self-intersecting shapes (causes black triangular artifacts).
- **Sprite Light 2D**: Uses a selected Sprite as the light shape. Property: `Sprite`.
- **Spot Light 2D** (Point Light): Properties: `Radius Inner`, `Radius Outer`, `Inner / Outer Spot Angle`.
- **Global Light 2D**: Lights all objects on targeted sorting layers. Only one Global Light per Blend Style per sorting layer.

> The Parametric Light type is deprecated from URP 11+. Convert via **Window > Rendering > Render Pipeline Converter > Upgrade 2D (URP) Assets > Parametric To Freeform Light Upgrade**.

### Light 2D Component

| Property | Function | Default |
|----------|----------|---------|
| **Light Type** | Freeform, Sprite, Spot, or Global | — |
| **Color** | Emitted light color | — |
| **Intensity** | Brightness; values >1 allowed for Multiply blend | 1 |
| **Target Sorting Layers** | Which sorting layers this light affects | — |
| **Blend Style** | Blend mode from the 2D Renderer Data asset | — |
| **Light Order** | Render order among lights on same layer (lower = first). Not available on Global. | — |
| **Overlap Operation** | Additive (default) or Alpha Blend | Additive |
| **Shadow Strength** | How much Shadow Caster 2Ds block light (0–1) | 0 |
| **Volumetric Intensity** | Opacity of volumetric lighting (0–1) | 0 |
| **Volumetric Shadow Strength** | How much volumetric light shadows block | 0 |
| **Normal Map Quality** | Disabled (default), Accurate, or Fast | Disabled |
| **Normal Map Distance** | Distance in Unity units between light and lit sprite | — |
| **Volume Opacity** | Visibility of volumetric light (0–1) | — |

**Overlap Operation details:**
- **Additive**: Intersecting lights have pixel values added together.
- **Alpha Blend**: Lights blend based on alpha; one light can completely overwrite another at intersections. Light Order determines which renders on top.

**Normal Maps**: All non-Global lights can use sprite normal maps. When enabled, `Distance` and `Quality` properties appear. Smaller lights and larger distances reduce the difference between Fast and Accurate quality.

### Shadows in 2D URP

Add a **Shadow Caster 2D** component to any GameObject. A 2D light with **Shadows** enabled must exist in the scene.

| Property | Function | Default |
|----------|----------|---------|
| **Casting Source** | Shape source: Sprite Skin, Sprite Renderer, Collider 2D, Shape Editor, or None | — |
| **Casting Option** | Self Shadow, Cast Shadow, Cast and Self Shadow, or None | Cast Shadow |
| **Target Sorting Layers** | Which layers receive shadows | Everything |
| **Trim Edge** | Resize casting source bounds | 0.2 |
| **Alpha Cutoff** | Minimum alpha to cast shadow | 0.1 |
| **Edit Shape** | Enter shape editing mode (Scene view) | — |
| **Position** | Per-point position (Shape Editor mode) | — |

**Shape editing**: Set `Casting Source` to `Shape Editor`, click **Edit Shape**, then click/drag points or click lines to add points in the Scene view.

**Composite Shadow Caster 2D**: Add to a parent GameObject. All child GameObjects with Shadow Caster 2D components have their shadows merged into a single shadow.

### 2D Renderer Data Asset

| Property | Function | Default |
|----------|----------|---------|
| **Layer Mask** | Layers that 2D GameObjects must belong to for rendering | — |
| **Transparency Sort Mode** | Depth calculation method: Default, Perspective, Orthographic, Custom Axis | Default |
| **Transparency Sort Axis** | Axis for depth calculation (e.g., Y=1 puts higher objects behind) | — |
| **Default Material Type** | Lit (Sprite-Lit-Default), Unlit (Sprite-Unlit-Default), or Custom | Lit |
| **Default Custom Material** | Custom material for new sprites (Custom mode only) | — |
| **Depth/Stencil Buffer** | Enable depth/stencil buffer (disable for mobile performance) | — |
| **HDR Emulation Scale** | Multiplier for high-intensity lights on non-HDR platforms | — |
| **Render Scale** | Light texture resolution as % of screen resolution | 0.5 |
| **Max Light Render Textures** | Max concurrent light textures | 4 |
| **Max Shadow Render Textures** | Max concurrent shadow textures | 1 |
| **Foremost Sorting Layer** | Last sorting layer captured to `CameraSortingLayerTexture` | — |
| **Downsampling Method** | None, 2x Bilinear, 4x Box, or 4x Bilinear | — |
| **Post-processing Enabled** | Toggle post-processing (disabling strips shaders/textures from build) | — |

**Blend Styles** (in 2D Renderer Data):
| Property | Function |
|----------|----------|
| **Name** | Blend style identifier |
| **Mask Texture Channel** | Channel from mask map: R, G, B, A, One Minus R/G/B/A |
| **Blend Mode** | Additive, Multiply, or Subtractive |

### Pixel Perfect Camera

Part of the **2D Pixel Perfect** package. Attach to the main Camera. Works in both Play and Edit modes.

| Property | Function |
|----------|----------|
| **Asset Pixels Per Unit** | Pixels in one Unity unit. Must match all sprites' Pixels Per Unit values. |
| **Reference Resolution** | Original resolution assets were designed for. Scaling preserves pixel art cleanly. |
| **Crop Frame** | None, Pillarbox, Letterbox, Windowbox, or Stretch Fill |
| **Grid Snapping** | Upscale Render Texture (on/off), Pixel Snapping (on/off) |
| **Filter Mode** | Retro AA (default) or Point. Only available when Stretch Fill is selected. |
| **Current Pixel Ratio** | Read-only; size ratio of rendered sprites vs original size |

**Crop Frame options:**
| Option | Behavior |
|--------|----------|
| **None** | No cropping |
| **Pillarbox** | Black bars left/right to match reference resolution |
| **Letterbox** | Black bars top/bottom to match reference resolution |
| **Windowbox** | Black bars on all sides |
| **Stretch Fill** | Stretches viewport to fill screen maintaining aspect ratio |

**Grid Snapping:**
- **Upscale Render Texture**: Renders to a texture near Reference Resolution, then upscales to full screen. Produces unaliased, unrotated pixels.
- **Pixel Snapping**: Snaps sprite renderers to a grid in world space at render time (based on Assets Pixels Per Unit). Prevents subpixel movement without modifying Transform positions.

**Sprite preparation checklist:**
1. Set all sprites to the same **Pixels Per Unit** value.
2. Set **Filter Mode** to **Point**.
3. Set **Compression** to **None**.
4. Set sprite pivot: **Sprite Editor > Pivot > Custom > Pivot Unit Mode > Pixels**.

**Grid snap setup:** Set grid size to `1 ÷ Asset Pixels Per Unit`. E.g., 100 PPU → 0.01 grid size. Enable Grid Snapping overlay. Snap existing objects with **Align Selected > All Axes**. Keyboard: `Ctrl+[`/`Ctrl+]` (Cmd on macOS) to decrease/increase grid size.

### 3D in 2D URP Scenes

3D GameObjects can be rendered as if they were 2D sprites, enabling: 2D lighting compatibility, Sprite Mask interaction, and sorting alongside sprites.

**Making a 3D GameObject 2D-compatible:**
1. **Auto-assign on creation**: Creating a 3D GameObject in a 2D URP project automatically assigns `Mesh2D-Lit-Default` material.
2. **Manual material assignment**: In Mesh Renderer / Skinned Mesh Renderer, select **Mesh2D-Lit-Default** material via the material picker.
3. **Custom Shader Graph**: Create via **Assets > Create > Shader Graph > URP > Sprite Lit/Unlit/Custom Lit Shader Graph**. In **Graph Inspector > Graph Settings**, enable **Sort 3D As 2D Compatible**.

**Sprite Mask interaction**: In the Mesh Renderer's **2D > Mask Interaction** section, select:
- **None** — No mask interaction.
- **Visible Inside Mask** — Renders only where overlapping the mask.
- **Visible Outside Mask** — Renders only where NOT overlapping the mask.

**Sorting 3D with 2D sprites**: Add a **Sorting Group** component and enable **Sort as 2D**. Assign Sorting Layer and Order in Layer values. Note: this clears depth information, so depth-based post-processing won't work.

**Camera must be Orthographic** for 3D objects to appear flat like sprites:
```csharp
Camera cam = GetComponent<Camera>();
cam.orthographic = true;
cam.orthographicSize = 5;
```

### Custom Rendering (2D)

To create custom render passes in 2D URP, use 2D-specific base classes and APIs:

| 3D URP | 2D URP |
|--------|--------|
| `ScriptableRenderPass` | `ScriptableRenderPass2D` |
| `ScriptableRendererFeature` | `ScriptableRendererFeature2D` |
| `renderPassEvent` | `renderPassEvent2D` (`RenderPassEvent2D` enum) |
| `UniversalResourceData` | `Universal2DResourceData` |

### Injection Points (`RenderPassEvent2D`)

| Injection Point | Executes | Renders to Sorting Layer |
|-----------------|----------|--------------------------|
| `BeforeRendering` | Before any other passes (camera matrices not yet set up). Good for LUT textures. | No |
| `BeforeRenderingNormals` | Before Normal2D pass | Yes |
| `AfterRenderingNormals` | After Normal2D pass | Yes |
| `BeforeRenderingShadows` | Before Shadow2D pass | Yes |
| `AfterRenderingShadows` | After Shadow2D pass | Yes |
| `BeforeRenderingLights` | Before Light2D pass | Yes |
| `AfterRenderingLights` | After Light2D pass | Yes |
| `BeforeRenderingSprites` | Before Renderer2D pass | Yes |
| `AfterRenderingSprites` | After Renderer2D pass | Yes |
| `BeforeRenderingPostProcessing` | Before RenderPostProcessingEffects pass | No |
| `AfterRenderingPostProcessing` | After post-processing, before final blit and color grading | No |
| `AfterRendering` | After all other passes | No |

> Rendering to `activeColorTexture` at `BeforeRenderingSprites` or `AfterRenderingSprites` affects all sorting layers behind and up to the specified sorting layer.

### Post-Processing

**Full Screen Pass Renderer Feature** properties:

| Property | Function | Default |
|----------|----------|---------|
| **Name** | Feature name | — |
| **Injection Point** | Before Rendering Transparents, Before Rendering Post Processing, or After Rendering Post Processing | After Rendering Post Processing |
| **Requirements** | Additional render passes: None, Everything, Depth, Normal, Color, Motion | — |
| **Fetch Color Buffer** | Access camera color texture (binds to `_BlitTexture`) | — |
| **Bind Depth-Stencil** | Access depth-stencil texture (has performance impact) | — |
| **Pass Material** | SRP Blit Shader or ShaderGraph Fullscreen | — |
| **Pass** | Shader pass index (Advanced Properties) | — |

**Custom post-processing with Volume support**: Use **Assets > Create > Scripting > URP Post-process Volume Scripts** to generate template scripts (Renderer Feature + Volume component). Customize in the `#region PASS_SHARED_RENDERING_CODE` block and modify the volume component access in `AddRenderPasses`.

## Code Patterns

### Create a 2D Light Programmatically

```csharp
using UnityEngine;
using UnityEngine.Rendering.Universal;

public class Create2DLight : MonoBehaviour
{
    void Start()
    {
        var lightObj = new GameObject("My 2D Light");
        var light2D = lightObj.AddComponent<Light2D>();
        light2D.lightType = Light2D.LightType.Sprite;
        light2D.lightSprite = Resources.Load<Sprite>("Sprites/LightSprite");
        light2D.color = Color.white;
        light2D.intensity = 1.5f;
        light2D.falloffIntensity = 0.5f;
        light2D.shadowIntensity = 0.3f;
        light2D.blendStyleIndex = 0;
        light2D.overlapOperation = Light2D.OverlapOperation.Additive;
        // Target specific sorting layers
        light2D.targetSortingLayers = new[] { SortingLayer.NameToID("Foreground") };
        // Enable shadows on this light
        light2D.shadowsEnabled = true;
        // Enable normal maps
        light2D.useNormalMap = true;
        light2D.normalMapQuality = Light2D.NormalMapQuality.Accurate;
        light2D.normalMapDistance = 3f;
    }
}
```

### Configure Shadow Caster 2D

```csharp
using UnityEngine;
using UnityEngine.Rendering.Universal;

public class ConfigureShadowCaster : MonoBehaviour
{
    void Start()
    {
        var caster = gameObject.AddComponent<ShadowCaster2D>();
        caster.castingSource = ShadowCaster2D.CastingSource.ShapeEditor;
        caster.castingOption = ShadowCaster2D.CastingOption.CastShadow;
        caster.alphaCutoff = 0.1f;
        caster.trimEdge = 0.2f;
        // Set target sorting layers for shadow reception
        caster.targetSortingLayers = new[] { SortingLayer.NameToID("Default") };
    }
}
```

### Pixel Perfect Camera Setup

```csharp
using UnityEngine;
using UnityEngine.U2D;

public class PixelPerfectSetup : MonoBehaviour
{
    void Start()
    {
        var camera = GetComponent<Camera>();
        camera.orthographic = true;

        var ppc = camera.gameObject.AddComponent<PixelPerfectCamera>();
        ppc.assetsPPU = 32;                     // Pixels Per Unit
        ppc.refResolutionX = 320;               // Reference width
        ppc.refResolutionY = 180;               // Reference height
        ppc.cropFrame = PixelPerfectCamera.CropFrame.Pillarbox;
        ppc.gridSnapping = true;
        ppc.upscaleRT = true;                   // Upscale Render Texture
        ppc.pixelSnapping = true;
        ppc.filterMode = PixelPerfectCamera.FilterMode.RetroAA;

        // Calculate grid size for snapping
        float gridSize = 1f / ppc.assetsPPU;
        // Set in Grid and Snap settings manually or via editor script
    }
}
```

### Custom Render Pass (2D)

Complete example of a 2D Scriptable Renderer Feature that creates a yellow texture at the `AfterRenderingPostProcessing` injection point:

```csharp
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering;

public class CreateYellowTextureFeature2D : ScriptableRendererFeature2D
{
    CreateYellowTexture customPass;

    public override void Create()
    {
        customPass = new CreateYellowTexture();
        customPass.renderPassEvent2D = RenderPassEvent2D.AfterRenderingPostProcessing;
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        renderer.EnqueuePass(customPass);
    }

    class CreateYellowTexture : ScriptableRenderPass2D
    {
        class PassData
        {
            public TextureHandle cameraColorTexture;
        }

        public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameContext)
        {
            using (var builder = renderGraph.AddRasterRenderPass<PassData>("Create yellow texture", out var passData))
            {
                UniversalResourceData frameData = frameContext.Get<UniversalResourceData>();
                TextureDesc textureDesc = frameData.activeColorTexture.GetDescriptor(renderGraph);
                textureDesc.msaaSamples = MSAASamples.None;

                passData.cameraColorTexture = renderGraph.CreateTexture(textureDesc);
                builder.SetRenderAttachment(passData.cameraColorTexture, 0, AccessFlags.Write);
                builder.AllowPassCulling(false);
                builder.SetRenderFunc(static (PassData data, RasterGraphContext context) => ExecutePass(data, context));
            }
        }

        static void ExecutePass(PassData data, RasterGraphContext context)
        {
            context.cmd.ClearRenderTarget(true, true, Color.yellow);
        }
    }
}
```

### Blit Pass in 2D URP

```csharp
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.RenderGraphModule.Util;

public class MyBlitPass : ScriptableRenderPass
{
    Material blitMaterial;

    public MyBlitPass(Material material)
    {
        blitMaterial = material;
        renderPassEvent = RenderPassEvent.AfterRenderingPostProcessing;
    }

    public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameContext)
    {
        UniversalResourceData frameData = frameContext.Get<UniversalResourceData>();

        TextureDesc sourceDesc = frameData.activeColorTexture.GetDescriptor(renderGraph);
        TextureHandle sourceTexture = frameData.activeColorTexture; // use existing
        TextureHandle destinationTexture = renderGraph.CreateTexture(sourceDesc);

        var blitParams = new RenderGraphUtils.BlitMaterialParameters(
            sourceTexture, destinationTexture, blitMaterial, 0);

        renderGraph.AddBlitPass(blitParams, "My Blit Pass");

        // Avoid blitting back: update frame data to point to destination
        frameData.cameraColor = destinationTexture;
    }
}
```

### Inject a Render Pass via RenderPipelineManager

```csharp
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public class InjectPass : MonoBehaviour
{
    private ExampleRenderPass exampleRenderPass;

    private void OnEnable()
    {
        exampleRenderPass = new ExampleRenderPass(/* settings */);
        RenderPipelineManager.beginCameraRendering += InjectRenderPass;
    }

    private void OnDisable()
    {
        RenderPipelineManager.beginCameraRendering -= InjectRenderPass;
    }

    private void InjectRenderPass(ScriptableRenderContext context, Camera cam)
    {
        cam.GetUniversalAdditionalCameraData()
           .scriptableRenderer
           .EnqueuePass(exampleRenderPass);
    }
}
```

## Key Classes and Components Reference

| Class / Component | Purpose |
|-------------------|---------|
| `Light2D` | 2D light component (Freeform, Sprite, Spot, Global types) |
| `ShadowCaster2D` | Defines shapes that cast shadows from 2D lights |
| `CompositeShadowCaster2D` | Merges child ShadowCaster2D shapes into a single shadow |
| `ScriptableRendererFeature2D` | Base class for injecting custom render passes in 2D URP |
| `ScriptableRenderPass2D` | Base class for writing custom 2D render passes |
| `RenderPassEvent2D` | Enum of injection points for 2D render passes |
| `Universal2DResourceData` | Access to 2D-specific texture resources (lights, shadows) |
| `UniversalResourceData` | Frame data: active color, depth, and other textures |
| `UniversalCameraData` | Camera-specific data including history manager |
| `PixelPerfectCamera` | Maintains pixel-perfect rendering at varying resolutions |
| `SortingGroup` | Controls render order; enables Sort as 2D for 3D objects |
| `Mesh2D-Lit-Default` | Default material for 3D meshes in 2D URP (lighting-compatible) |
| `Sprite-Lit-Default` | Default lit material for sprites (supports normal/mask maps) |
| `Sprite-Unlit-Default` | Default unlit material for sprites |
| `RenderGraphUtils.BlitMaterialParameters` | Configuration for blit passes in the render graph system |
| `Blitter` | Utility class for blitting textures in render pass execution |

## Best Practices

1. **Batch sorting layers aggressively** — Consecutive layers sharing the same light set are batched together, reducing Light Render Texture draw operations significantly.

2. **Lower Render Scale for performance** — Default 0.5 is a good starting point. Reduce further (0.25) for mobile or many-light scenes. Increase only when visual fidelity demands it.

3. **Limit Max Light Render Textures** — Default of 4 concurrent textures is adequate for most scenes. Increase only when many lights overlap different layer batches simultaneously.

4. **Disable Depth/Stencil Buffer on mobile** — Unless you're using features that require it (certain post-processing effects), disabling saves GPU bandwidth.

5. **Use Global Lights sparingly** — Only one Global Light per Blend Style per sorting layer. For ambient fill, prefer a single low-intensity Global Light over multiple overlapping lights.

6. **Avoid self-intersecting Freeform light shapes** — These cause black triangular artifacts or double-lighted areas. Use the spline editor carefully.

7. **Set Pixel Perfect Camera's Assets Pixels Per Unit to match all sprites** — Mismatched PPU values cause inconsistent sprite scaling. Lock this value early in development.

8. **Create custom shaders via Shader Graph URP templates** — Use **Assets > Create > Shader Graph > URP > Sprite Lit Shader Graph** for lighting-compatible sprites. For 3D-in-2D meshes, enable **Sort 3D As 2D Compatible** in Graph Settings.

9. **Prefer ScriptableRendererFeature2D over RenderPipelineManager for project-wide passes** — Renderer Features are easier to manage, support per-scene configuration, and don't require MonoBehaviour subscriptions.

10. **Avoid redundant blit-back in render graph** — After a blit, update `frameData.cameraColor` to point to the destination texture instead of blitting back to the original.

11. **Use Frame Debugger / Render Graph Viewer to verify custom passes** — These tools show exactly where your pass executes and what textures it reads/writes.

12. **Disable normal maps on lights when not needed** — Normal map rendering adds overhead. Set `Normal Map Quality` to `Disabled` on lights that don't benefit from surface detail.

13. **For custom post-processing with Volume support, use the URP template** — **Assets > Create > Scripting > URP Post-process Volume Scripts** generates properly structured Renderer Feature and Volume component scripts.

## Additional Resources

- [URP 2D Renderer Setup](https://docs.unity3d.com/Manual/urp/renderer-setup-2d.html)
- [2D Lighting in URP](https://docs.unity3d.com/Manual/urp/2d-index.html)
- [2D Renderer Data Asset Reference](https://docs.unity3d.com/Manual/urp/2DRendererData-overview.html)
- [Pixel Perfect Camera](https://docs.unity3d.com/Packages/com.unity.2d.pixel-perfect@latest)
- [3D GameObjects in 2D URP](https://docs.unity3d.com/Manual/urp/3d-in-2d.html)
- [Custom Rendering in URP](https://docs.unity3d.com/Manual/urp/custom-rendering.html)
- [Render Graph System](https://docs.unity3d.com/Manual/urp/render-graph.html)
- [Full Screen Pass Renderer Feature](https://docs.unity3d.com/Manual/urp/renderer-features/full-screen-pass.html)
- [Shader Graph Documentation](https://docs.unity3d.com/Packages/com.unity.shadergraph@latest)
- [Universal2DResourceData API](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@latest/index.html?subfolder=/api/UnityEngine.Rendering.Universal.Universal2DResourceData.html)
- [RenderPassEvent2D API](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@latest/index.html?subfolder=/api/UnityEngine.Rendering.Universal.RenderPassEvent2D.html)
- [Frame Debugger](https://docs.unity3d.com/Manual/frame-debugger-window.html)
