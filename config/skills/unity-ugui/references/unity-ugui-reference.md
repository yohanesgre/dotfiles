# Unity uGUI Documentation Reference

This document consolidates key information from the official Unity uGUI documentation (com.unity.ugui@2.0) covering the Canvas system, basic layout, and visual components.

---

## 1. Canvas (UICanvas.html)

### Overview

The **Canvas** is the fundamental container area where all UI elements must reside. It is a GameObject with a Canvas component attached, and all UI elements must be created as children of a Canvas. When creating a new UI element via **GameObject > UI > Image**, Unity automatically creates a Canvas if one does not already exist in the scene.

### Draw Order of Elements

UI elements within a Canvas are drawn in the same order they appear in the Hierarchy. The first child is drawn first, the second child next, and so on. When two UI elements overlap, the later one appears on top of the earlier one.

**Controlling draw order:**
- Reorder elements in the Hierarchy by dragging them up or down
- Use scripting methods on the Transform component: `SetAsFirstSibling()`, `SetAsLastSibling()`, and `SetSiblingIndex()`

### Render Modes

The Canvas component has a **Render Mode** property that determines how UI is positioned relative to the scene:

#### Screen Space - Overlay

This mode places UI elements on the screen rendered on top of the scene. The Canvas automatically resizes to match the screen when the resolution changes or the screen is resized. This is the default mode for most HUD-style interfaces.

**Characteristics:**
- UI always appears on top of all scene content
- No interaction with scene lighting or 3D effects
- Canvas scales with screen resolution

#### Screen Space - Camera

Similar to Overlay, but the Canvas is placed at a specified distance in front of a designated Camera. The UI is rendered by this camera, meaning Camera settings affect the UI appearance.

**Characteristics:**
- If Camera is set to **Perspective**, UI elements render with perspective distortion
- Perspective amount controlled by Camera **Field of View**
- Canvas automatically resizes when screen resolution changes or camera frustum changes
- Allows for post-processing effects on UI

#### World Space

The Canvas behaves as any other object in the scene. The Canvas size is set manually using its Rect Transform, and UI elements render in front of or behind other objects based on their 3D placement.

**Characteristics:**
- Used for "diegetic interfaces" — UI that is part of the game world
- Requires manual Canvas size configuration
- UI can be occluded by 3D objects
- Useful for in-world displays, signs, and interactive objects

### Additional Shader Channels

When the Canvas generates mesh geometry, it always includes **Position**, **Color**, and **UV0** vertex attributes by default. For **Screen Space - Camera** and **World Space** render modes, **Normal** and **Tangent** are also included by default to support lighting.

The **Additional Shader Channels** property enables extra vertex attributes beyond the defaults:

| Channel | Description |
|---------|-------------|
| **None** | No additional attributes; only defaults included |
| **TexCoord1** | Adds second UV set (UV1) to each vertex |
| **TexCoord2** | Adds third UV set (UV2) to each vertex |
| **TexCoord3** | Adds fourth UV set (UV3) to each vertex |
| **Normal** | Adds per-vertex normal (Vector3); required for lighting effects on UI geometry |
| **Tangent** | Adds per-vertex tangent (Vector4); required for normal-mapped shaders |

**Note:** Screen Space - Overlay canvases are not affected by standard scene lighting, so Normal and Tangent have no visible effect in typical cases. However, specialized shaders (such as TextMeshPro) can still use this data.

**Reflection Probes:** When **Use Reflection Probes** is enabled on the Canvas, the Normal channel is automatically included in the mesh regardless of the Additional Shader Channels setting.

### Vertex Color Always in Gamma Color Space

In a linear color space project, Unity normally converts UI vertex colors from gamma to linear space during mesh generation, before colors reach the shader. This conversion loses detail, particularly for darker colors where gamma encoding provides the most precision.

**Vertex Color Always in Gamma Color Space** defers the conversion to the shader instead. When enabled, vertex colors are written to the mesh in gamma space, and the UI shader performs the gamma-to-linear conversion in floating-point, preserving more precision throughout.

**Best Practice:** Enable this setting when working in linear color space to improve accuracy of dark-color tones and subtle gradients.

**Custom UI Shaders:** Built-in UI shaders already include the gamma-to-linear conversion. If using a custom UI shader, you must handle this conversion manually when the setting is enabled, otherwise vertex colors can appear too bright.

---

## 2. Basic Layout (UIBasicLayout.html)

### The Rect Tool

Every UI element is represented as a rectangle for layout purposes. The **Rect Tool** in the toolbar is used to manipulate these rectangles in the Scene View. The Rect Tool works for both 2D features and UI, and can even be used for 3D objects.

**Rect Tool operations:**
- **Move:** Click anywhere inside the rectangle and drag
- **Resize:** Click on the edges or corners and drag
- **Rotate:** Hover the cursor slightly away from the corners until the cursor shows a rotation symbol, then click and drag

**Toolbar settings:** The Rect Tool uses the current pivot mode and space set in the toolbar. When working with UI, keep these set to **Pivot** and **Local**.

### Rect Transform

The **Rect Transform** is a specialized transform component used for all UI elements instead of the regular Transform component.

**Properties:**
- Position, rotation, and scale (like regular Transform)
- Width and height (unique to Rect Transform)

**Key distinction:** When using the Rect Tool to change the size of an object with a Rect Transform, it changes the width and height rather than the local scale. This resizing will not affect font sizes, borders on sliced images, or other scale-dependent properties.

### Pivot

Rotations, size, and scale modifications occur around the pivot point. The position of the pivot affects the outcome of any transformation operation.

**Usage:** When the toolbar Pivot button is set to Pivot mode, the pivot of a Rect Transform can be moved directly in the Scene View by dragging it.

### Anchors

Rect Transforms include a layout concept called **anchors**. Anchors are shown as four small triangular handles in the Scene View, and anchor information is displayed in the Inspector.

**Anchor behavior:** If the parent of a Rect Transform is also a Rect Transform, the child can be anchored to the parent in various ways:

- **Center anchoring:** Element maintains a fixed offset to the center of the parent
- **Corner anchoring:** Element maintains a fixed offset to a specific corner of the parent
- **Stretch anchoring:** Element stretches with the parent width or height; each corner has a fixed offset to its corresponding anchor

**Anchor positions:** Defined as fractions (or percentages) of the parent rectangle width and height:
- 0.0 (0%) = left or bottom side
- 0.5 (50%) = middle
- 1.0 (100%) = right or top side

Anchors can be positioned at any point within the parent rectangle, not just at sides or middle.

**Interaction:**
- Drag each anchor handle individually
- Drag all anchors together by clicking in the middle between them
- Hold **Shift** while dragging an anchor to move the corresponding corner of the rectangle together with the anchor
- Anchor handles automatically snap to the anchors of sibling rectangles for precise positioning

### Anchor Presets

In the Inspector, the **Anchor Preset** button is located in the upper left corner of the Rect Transform component. Clicking it opens a dropdown with common anchoring options:

- Anchor to sides or middle of the parent
- Stretch together with parent size
- Horizontal and vertical anchoring are independent

If anchors are set to positions not matching any preset, the Inspector displays "Custom" to indicate non-standard anchoring.

### Anchor and Position Fields in the Inspector

**Anchor fields:**
- Click the Anchors expansion arrow to reveal anchor number fields
- **Anchor Min** corresponds to the lower left anchor handle in the Scene View
- **Anchor Max** corresponds to the upper right handle

**Position fields** display differently based on anchor configuration:

**When anchors are together (fixed width and height):**
- Fields displayed: Pos X, Pos Y, Width, Height
- Pos X and Pos Y indicate the position of the pivot relative to the anchors

**When anchors are separated (rectangle stretches with parent):**
- Fields can change to: Left, Right, Top, Bottom
- These fields define padding inside the rectangle defined by the anchors
- Left and Right fields used when anchors are separated horizontally
- Top and Bottom fields used when anchors are separated vertically

**Raw Edit Mode:** Click the **R** button in the Inspector to enable Raw edit mode. This allows anchor and pivot values to be changed without automatically counter-adjusting positioning values. Note that this may cause the rectangle to visually move or resize since its position and size depends on anchor and pivot values.

---

## 3. Visual Components (UIVisualComponents.html)

### Text Component

The **Text** component (also known as a Label) displays text within the UI system.

**Properties:**
- **Text area:** Enter the text to display
- **Font:** Select the font to use
- **Font Style:** Set style (Regular, Bold, Italic, Bold + Italic)
- **Font Size:** Set the size of the text
- **Rich Text:** Enable or disable rich text capability
- **Alignment:** Set horizontal and vertical alignment
- **Horizontal Overflow:** Control behavior when text exceeds width (Wrap or Overflow)
- **Vertical Overflow:** Control behavior when text exceeds height (Truncate or Overflow)
- **Best Fit:** Enable text to resize to fit available space

### Image Component

The **Image** component displays sprites in the UI. It has a Rect Transform component and an Image component.

**Properties:**
- **Target Graphic:** The sprite to display
- **Color:** The color tint applied to the sprite
- **Material:** Optional material to apply to the Image component

**Image Type options:**

| Type | Description |
|------|-------------|
| **Simple** | Scales the whole sprite equally in all directions |
| **Sliced** | Uses 3x3 sprite division so resizing does not distort corners; only the center part stretches. Requires 9-sliced sprites |
| **Tiled** | Similar to Sliced but tiles (repeats) the center part rather than stretching it. For sprites with no borders, the entire sprite is tiled |
| **Filled** | Shows the sprite like Simple but fills it from an origin in a defined direction, method, and amount. Useful for health bars and progress indicators |

**Set Native Size:** Available when Simple or Filled is selected. Resets the image to the original sprite size.

**Sprite Import:** Images can be imported as **UI sprites** by selecting **Sprite (2D / UI)** from the Texture Type settings in the Import Inspector. The Sprite Editor provides **9-slicing** functionality, which splits the image into 9 areas so corners are not stretched or distorted when resized.

### Raw Image Component

The **Raw Image** component takes a texture (unlike Image which takes a sprite). Use Raw Image only when necessary; Image is suitable for most cases.

**Use cases:**
- Displaying dynamically generated textures
- Displaying camera feed or video textures
- When sprite borders are not needed

### Mask Component

A **Mask** is not a visible UI control but a way to modify the appearance of a control's child elements. The mask restricts child elements to the shape of the parent — if a child is larger than the parent, only the portion within the parent is visible.

**Usage:** Add a Mask component to a parent element, then place child elements inside. The children will be clipped to the parent's bounds.

### Effects

Visual components can have various simple effects applied, such as:
- **Drop Shadow:** Adds a shadow offset behind the element
- **Outline:** Adds an outline around the element

These effects are documented in the UI Effects reference page.

---

## Key Classes and Components Summary

| Class/Component | File | Description |
|----------------|------|-------------|
| Canvas | Canvas component | Container for all UI elements; controls render mode |
| RectTransform | RectTransform component | Layout component for all UI elements |
| Text | Text component | Displays text labels |
| Image | Image component | Displays sprites with various scaling modes |
| RawImage | RawImage component | Displays textures |
| Mask | Mask component | Clips child elements to parent bounds |

---

## Best Practices Summary

1. **Canvas Organization:** Keep UI elements as children of Canvas objects; use multiple Canvases to organize different UI layers or screens

2. **Draw Order:** Use Hierarchy order to control layering; use `SetAsFirstSibling()` / `SetAsLastSibling()` for programmatic control

3. **Render Mode Selection:** Use Screen Space - Overlay for HUDs, Screen Space - Camera for UI with depth effects, World Space for in-world UI

4. **Anchoring:** Use anchors for responsive layouts that adapt to different screen sizes; prefer anchor presets for common configurations

5. **Image Types:** Use Sliced for UI elements that resize (buttons, panels), Tiled for backgrounds that repeat, Filled for progress bars

6. **Color Space:** Enable Vertex Color Always in Gamma Color Space when using linear color space for better dark-color accuracy

7. **Custom Shaders:** When using custom UI shaders with Vertex Color Always in Gamma, manually handle gamma-to-linear conversion

---

*Source: Unity uGUI Documentation (com.unity.ugui@2.0)*