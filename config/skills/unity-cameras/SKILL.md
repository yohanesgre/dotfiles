---
name: unity-cameras
description: Camera configuration, control, and optimization for Unity games and applications. Covers camera fundamentals, projection modes, multiple cameras, render pipelines (URP/Built-In), occlusion culling, physical cameras, and output textures. Based on Unity 6.4 documentation.
---

# Unity Cameras Skill

Use this skill when working with Unity cameras — configuring, controlling, and optimizing camera rendering for games and applications. Covers camera fundamentals, projection modes, multiple cameras, render pipelines (URP/Built-In), occlusion culling, physical cameras, and output textures.

---

## Overview

A **Camera** is a Unity component that creates an image of a particular viewpoint in your scene. The output is either drawn to the screen or captured as a texture. Cameras are essential for rendering the game world to the player.

**Key capabilities:**
- Unlimited cameras per scene
- Customizable, scriptable, and parentable
- Can render in any order, at any screen position, or only parts of the screen
- Support for picture-in-picture, split-screen, multi-display, and render-to-texture

---

## Camera Fundamentals

### Creating a Camera

Add a Camera component to any GameObject:
```
GameObject > Camera
```

Every new scene contains a default Main Camera (tagged "MainCamera", accessible via `Camera.main`).

### Projection Modes

| Mode | Description | Use Case |
|---|---|---|
| **Perspective** | Objects appear smaller with distance (real-world view) | 3D games, realistic scenes |
| **Orthographic** | No perspective; uniform size regardless of distance | 2D games, isometric games, UI, maps |

**Important:**
- Orthographic removes all perspective; fog may not appear as expected
- Deferred rendering is **not supported** in Orthographic mode (Forward rendering always used)

### Camera Component Properties

| Property | Description |
|---|---|
| `clearFlags` | What to clear before rendering (Skybox, Solid Color, Depth Only, Don't Clear) |
| `backgroundColor` | Color for empty screen areas (when no skybox) |
| `cullingMask` | LayerMask — which layers to render |
| `projection` | Perspective or Orthographic |
| `fieldOfView` | View angle in degrees (Perspective only) |
| `orthographicSize` | Viewport half-height in world units (Orthographic only) |
| `nearClipPlane` | Closest rendering distance |
| `farClipPlane` | Furthest rendering distance |
| `depth` | Draw order (higher = rendered on top; Built-In only) |
| `rect` | Viewport rectangle (normalized 0-1) for picture-in-picture |
| `targetTexture` | Render Texture to render to instead of screen |
| `allowHDR` | Enable High Dynamic Range |
| `allowMSAA` | Enable multi-sample antialiasing |
| `allowDynamicResolution` | Enable dynamic resolution scaling |
| `occlusionCulling` | Enable/disable occlusion culling |
| `usePhysicalProperties` | Enable Physical Camera mode |

### Clear Flags

| Flag | Behavior |
|---|---|
| **Skybox** (default) | Empty areas show skybox (camera → Lighting Window → Background Color fallback) |
| **Solid Color** | Empty areas show Background Color |
| **Depth Only** | Keeps color buffer, clears depth. Useful for drawing weapons/HUD on top without clipping |
| **Don't Clear** | Does not clear color or depth. Can produce smear effects. **Warning**: Screen contents may be undefined on some GPUs |

### Scripting Basics

```csharp
// Get the main camera
Camera mainCam = Camera.main;

// Get any camera by tag
Camera playerCam = GameObject.FindWithTag("PlayerCamera").GetComponent<Camera>();

// Set properties
mainCam.fieldOfView = 60f;
mainCam.orthographic = true;
mainCam.orthographicSize = 5f;
mainCam.nearClipPlane = 0.1f;
mainCam.farClipPlane = 1000f;
mainCam.cullingMask = LayerMask.GetMask("Default", "Enemies");

// World-to-screen conversion
Vector3 screenPos = mainCam.WorldToScreenPoint(worldPos);

// Screen-to-world ray
Ray ray = mainCam.ScreenPointToRay(Input.mousePosition);
if (Physics.Raycast(ray, out RaycastHit hit))
{
    Debug.Log($"Hit: {hit.point}");
}

// Viewport point (0-1 normalized)
Vector3 viewportPos = mainCam.WorldToViewportPoint(worldPos);
```

---

## View Frustum

The frustum defines the 3D space region a perspective camera can view. It's a truncated pyramid from the near clip plane to the far clip plane.

```csharp
// Calculate frustum size at a specific distance
float frustumHeight = 2.0f * distance * Mathf.Tan(camera.fieldOfView * 0.5f * Mathf.Deg2Rad);
float frustumWidth = frustumHeight * camera.aspect;
```

### Oblique Frustum

Create an asymmetrical frustum (e.g., for speed effects in racing games):

```csharp
void SetObliqueness(float horizObl, float vertObl)
{
    Matrix4x4 mat = Camera.main.projectionMatrix;
    mat[0, 2] = horizObl;
    mat[1, 2] = vertObl;
    Camera.main.projectionMatrix = mat;
}
```

---

## Using Multiple Cameras

### Camera Depth / Priority

- **Built-In Render Pipeline**: Use `Camera.depth` — higher values render on top
- **URP**: Use `Camera.priority` — higher values render on top

Cameras are drawn from low to high depth/priority.

### Swapping Camera Views

```csharp
public Camera firstPersonCamera;
public Camera overheadCamera;

public void ShowOverheadView()
{
    firstPersonCamera.enabled = false;
    overheadCamera.enabled = true;
}

public void ShowFirstPersonView()
{
    firstPersonCamera.enabled = true;
    overheadCamera.enabled = false;
}
```

### Picture-in-Picture (Viewport Rect)

```csharp
// Mini-map camera in top-right corner
Camera miniMapCam = GetComponent<Camera>();
miniMapCam.rect = new Rect(0.75f, 0.75f, 0.2f, 0.2f); // x, y, w, h (normalized 0-1)
miniMapCam.depth = 1; // Render on top of main camera
```

### Render to Texture

```csharp
public RenderTexture renderTexture;
public Camera securityCamera;

void Start()
{
    securityCamera.targetTexture = renderTexture;
    // The render texture can be assigned to a RawImage material for in-game monitors
}
```

### Multi-Display Support

Unity supports up to 8 displays simultaneously.

```csharp
void Start()
{
    // Display 0 is always active (primary)
    for (int i = 1; i < Display.displays.Length; i++)
    {
        Display.displays[i].Activate();
    }
}
```

**Setup:**
1. Set Camera's **Target Display** (1-8)
2. In Game view, select display from the Display menu
3. Activate additional displays at startup

---

## URP Cameras

### Camera Types

| Type | Description |
|---|---|
| **Base** | Default camera; renders to screen or Render Texture. At least one required per scene. |
| **Overlay** | Renders on top of another camera's output. Must be part of a Camera Stack. |

### Camera Stacking

Layer outputs of multiple cameras into a single combined output:
- Base camera renders first
- Overlay cameras render on top in stack order
- Post-processing on an Overlay Camera affects all outputs below it in the stack

**Setup:**
1. Create a Base Camera
2. Create an Overlay Camera
3. In Base Camera's Inspector → Stack → add the Overlay Camera

### Overlay Camera Active Properties

Only these properties affect rendering in an Overlay Camera:
- Projection, FOV Axis, Field of View
- Physical Camera properties
- Clipping planes, Renderer, Clear Depth
- Render Shadows, Culling Mask, Occlusion Culling

### Universal Additional Camera Data

URP extends the Camera component with `UniversalAdditionalCameraData`:
```csharp
var cameraData = camera.GetUniversalAdditionalCameraData();
cameraData.renderType = CameraRenderType.Base;
```

---

## Built-In Render Pipeline Cameras

### Rendering Path

Choose in Player Settings (overridable per Camera):
- **Forward**: Default; renders each object once per light
- **Deferred**: Renders lighting in a separate pass; better for many lights
- **Vertex Lit**: Legacy; lowest quality, fastest

### Additional Properties

| Property | Description |
|---|---|
| `renderingPath` | Forward, Deferred, Vertex Lit, or Use Player Settings |
| `HDR` | High Dynamic Range rendering |
| `MSAA` | Multi-sample antialiasing |
| `targetDisplay` | Which display device (1-8) |

---

## Physical Cameras

Simulate real-world camera formats. Enable via `usePhysicalProperties` or the Inspector toggle.

### Key Properties

| Property | Description |
|---|---|
| **Focal Length** | Distance (mm) between sensor and lens. Lower = wider FOV |
| **Sensor Type** | Real-world format preset (Full Frame, APS-C, etc.) |
| **Sensor Size** | Width/height in millimeters; determines aspect ratio |
| **Lens Shift** | Horizontal/vertical offset to correct distortion |
| **Gate Fit** | How to fit resolution gate to film gate (Vertical, Horizontal, Fill, Overscan, None) |

```csharp
Camera cam = GetComponent<Camera>();
cam.usePhysicalProperties = true;
cam.focalLength = 35f; // 35mm lens
cam.sensorSize = new Vector2(36, 24); // Full frame
```

---

## Occlusion Culling

Prevents rendering of objects completely hidden by other objects.

### How It Works

1. **Bake** occlusion data in the Editor (`Window > Rendering > Occlusion Culling`)
2. Unity divides the scene into cells and generates visibility data
3. At runtime, Unity loads baked data and culls occluded objects per Camera

### Setup Steps

1. Mark occluders: Select objects → Inspector → Static → **Occluder Static**
   - Must have Mesh Renderer or Terrain, be opaque, not move
2. Mark occludees: Select objects → Static → **Occludee Static**
   - Any Renderer component, not moving
3. Ensure Camera's **Occlusion Culling** is enabled
4. Open Occlusion Culling window → **Bake**

### Dynamic Occlusion

Dynamic (non-static) GameObjects can be occluded but cannot occlude others.

```csharp
// Control per-renderer
Renderer rend = GetComponent<Renderer>();
rend.allowOcclusionWhenDynamic = true; // Enable dynamic occlusion
```

### Occlusion Area

Define View Volumes (areas where the camera is likely to be) for higher precision:
- Add Occlusion Area component
- Set Size and Center
- Enable **Is View Volume**

### Occlusion Portal

For objects that open/close (e.g., doors):

```csharp
OcclusionPortal portal = GetComponent<OcclusionPortal>();
portal.open = true;  // Does not occlude
portal.open = false; // Occludes
```

### When to Use

- Best for scenes with small, well-defined areas separated by solid objects (rooms connected by corridors)
- Most beneficial when GPU-bound due to overdraw
- Requires sufficient memory for baked data
- Not suitable for runtime-generated geometry

---

## Resolution Scaling

### Dynamic Resolution

Dynamically scale render targets to reduce GPU workload.

**Supported platforms:**
- iOS, macOS, tvOS (Metal)
- Android (Vulkan)
- Windows Standalone, UWP (DirectX 12)

**Setup:**
1. Check **Allow Dynamic Resolution** on Camera
2. Check **Enable Frame Timing Stats** in Player Settings
3. Control via `ScalableBufferManager`:

```csharp
// Reduce resolution
ScalableBufferManager.ResizeBuffers(0.75f, 0.75f);

// Restore resolution
ScalableBufferManager.ResizeBuffers(1.0f, 1.0f);

// Monitor performance
FrameTimingManager.CaptureFrameTimings();
FrameTiming[] timings = new FrameTiming[3];
FrameTimingManager.GetLatestTimings(3, timings);
double gpuTime = timings[0].gpuFrameTime;
```

### Upscaling Techniques

| Technique | Description | Pipeline |
|---|---|---|
| Bilinear | GPU bilinear filtering | All |
| Nearest-neighbor | Point sampling | All |
| FSR 1 | AMD FidelityFX Super Resolution 1 | URP, HDRP |
| FSR 2 | AMD FidelityFX Super Resolution 2 | HDRP |
| DLSS 4 | NVIDIA Deep Learning Super Sampling | HDRP |
| STP | Spatial-Temporal Post-processing | URP, HDRP |
| TAAU | Temporal Anti-Aliasing Upsampling | HDRP |

---

## Render Queues and Sorting

### Named Render Queues

| Queue | Index | Use |
|---|---|---|
| Background | 1000 | Sky, backgrounds |
| Geometry | 2000 | Opaque objects (default) |
| AlphaTest | 2450 | Alpha-tested geometry |
| Transparent | 3000 | Alpha-blended (glass, particles) |
| Overlay | 4000 | Effects on top (lens flares) |

**Skybox** renders after all opaque geometry (after 2500) but before transparent (before 2501).

### Sorting Behavior

- **Queues ≤ 2500**: Sorted **Front-to-Back** (opaque) — reduces overdraw
- **Queues ≥ 2501**: Sorted by transparency sort mode (usually back-to-front)

```csharp
// Change opaque sorting
camera.opaqueSortMode = OpaqueSortMode.FrontToBack;

// Change transparent sorting (global)
GraphicsSettings.transparencySortMode = TransparencySortMode.Default;

// Change transparent sorting (per camera)
camera.transparencySortMode = TransparencySortMode.Default;
```

### Custom Render Queue in Shader

```hlsl
Tags { "Queue" = "Geometry+1" } // 2001
```

---

## Camera Output Textures

Cameras can generate depth, depth-normals, and motion vector textures for post-processing.

```csharp
// Enable depth texture
camera.depthTextureMode = DepthTextureMode.Depth;

// Enable depth + normals
camera.depthTextureMode = DepthTextureMode.DepthNormals;

// Enable motion vectors
camera.depthTextureMode = DepthTextureMode.MotionVectors;

// Combine flags
camera.depthTextureMode = DepthTextureMode.Depth | DepthTextureMode.MotionVectors;
```

| Mode | Description |
|---|---|
| **Depth** | Screen-sized depth texture (0-1, non-linear) |
| **DepthNormals** | 32-bit texture with view-space normals (RG) and depth (BA) |
| **MotionVectors** | Per-pixel screen-space motion (RG16) |

**Notes:**
- Depth textures come "for free" in Deferred rendering
- Motion vectors always require an extra render pass
- Only opaque objects (queue ≤ 2500) render into depth texture
- Shaders need a ShadowCaster pass to appear in depth texture

---

## Camera Control in Editor

### First-Person Camera Navigation

1. Press `` ` `` (backtick) → open Overlays menu
2. Enable **Cameras overlay**
3. Select a camera from dropdown
4. Click **Control selected camera in first person**
5. Use Scene view navigation to move
6. Click **Return to Scene Camera** to exit

**Overscan:** Adjust to see more (>1) or less (<1) than the final camera output.

---

## Troubleshooting

### Flickering (Lights, Shadows, Objects)

**Cause:** Distances too large for floating-point precision.

**Fixes:**
1. Reduce Far Clipping Plane
2. Make scene objects smaller
3. Enable Camera-Relative Culling (`Graphics Settings > Culling`)

### Screen Tearing

**Cause:** Frame updates not synchronized with display refresh.

**Fix:** `Edit > Project Settings > Quality > VSync Count`
- **Every V Blank:** Synchronize with display refresh
- **Every Second V Blank:** For slower frame rates

---

## Best Practices

1. **Adjust clipping planes carefully**: Too large a range reduces depth buffer precision (z-fighting).
2. **Use Orthographic for 2D**: Avoids perspective distortion.
3. **Leverage multiple cameras**: Split-screen, mini-maps, and picture-in-picture.
4. **Use Camera Stacking in URP**: Cleaner than manual Viewport Rect setups.
5. **Enable occlusion culling** for indoor/complex scenes with many occluders.
6. **Use dynamic resolution** on GPU-bound projects to maintain frame rate.
7. **Set clear flags appropriately**: `Depth Only` for weapon cameras, `Skybox` for main views.
8. **Deactivate unused cameras**: An active camera runs the full rendering loop even if it renders nothing.
9. **Use `Camera.main` sparingly**: It does a tag search; cache the reference instead.
10. **Use Physical Cameras** when matching real-world camera specs (e.g., for cinematics or VFX).

---

## Key Classes Quick Reference

| Class/Property | Purpose |
|---|---|
| `Camera` | Core camera component |
| `Camera.main` | Cached camera tagged "MainCamera" |
| `Camera.ScreenPointToRay()` | Convert screen position to world ray |
| `Camera.WorldToScreenPoint()` | Convert world position to screen pixels |
| `Camera.WorldToViewportPoint()` | Convert world position to viewport (0-1) |
| `Camera.projectionMatrix` | Custom projection matrix |
| `DepthTextureMode` | Depth/DepthNormals/MotionVectors flags |
| `ScalableBufferManager` | Dynamic resolution control |
| `FrameTimingManager` | CPU/GPU timing statistics |
| `OcclusionPortal` | Runtime occlusion control |
| `OcclusionArea` | Define occlusion View Volumes |
| `Display` | Multi-display management |
| `UniversalAdditionalCameraData` | URP camera extensions |

---

## Additional Resources

- **Scripting API**: `UnityEngine.Camera`
- **URP Cameras**: `urp/urp-cameras-landing.html`
- **Built-In Cameras**: `cameras-birp.html`
- **Cinemachine**: Advanced camera system for complex behaviors
- **Timeline**: Camera animation and cutscenes
