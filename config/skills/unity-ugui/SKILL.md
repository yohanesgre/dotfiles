---
name: unity-ugui
description: Unity's uGUI (Unity UI) system for creating runtime user interfaces in games and applications. Covers Canvas, layout, visual components, interaction components, auto layout, events, animation, and performance profiling. Based on Unity 6.4 documentation.
---

# Unity uGUI Skill

Use this skill when working with Unity's uGUI (Unity UI) system for creating runtime user interfaces in games and applications. Covers Canvas, layout, visual components, interaction components, auto layout, events, animation, and performance profiling.

---

## Overview

uGUI is Unity's GameObject-based UI system for runtime interfaces. It uses Components and the Game view to arrange, position, and style UI. All UI elements live in a Canvas hierarchy.

**Note:** uGUI cannot be used to create or change Unity Editor interfaces (use UI Toolkit for Editor UI).

---

## Canvas

The Canvas is the root container for all UI elements. Every UI element must be a child of a Canvas.

### Render Modes

| Mode | Description | Use Case |
|---|---|---|
| **Screen Space - Overlay** | Renders on top of everything, no Camera needed | HUDs, menus, fullscreen UI |
| **Screen Space - Camera** | Renders at a specific distance from a Camera | UI that needs to be affected by camera effects (e.g., post-processing) |
| **World Space** | Renders in the 3D world as a flat plane | In-world displays, holographic UI, wall panels |

### Canvas Scaler

Added by default to new Canvases. Controls how UI scales across different screen resolutions.

| UI Scale Mode | Behavior |
|---|---|
| **Constant Pixel Size** | UI stays same pixel size regardless of screen |
| **Scale With Screen Size** | Scales UI based on reference resolution (recommended) |
| **Constant Physical Size** | Maintains physical size in inches/cm |

**Scale With Screen Size setup:**
```
Reference Resolution: 1920 x 1080
Screen Match Mode: Match Width Or Height
Match: 0.5 (balance between width and height)
```

- Match = 0: scales based on width
- Match = 1: scales based on height
- Match = 0.5: balanced, good for landscape/portrait transitions

### Draw Order

UI elements are drawn in hierarchy order (top to bottom in the Hierarchy window). Later siblings draw on top of earlier ones.

```csharp
// Scripting draw order
transform.SetAsFirstSibling();  // Send to back
transform.SetAsLastSibling();   // Bring to front
transform.SetSiblingIndex(index);
```

### World Space Canvas Setup

1. Create UI element (creates Canvas automatically)
2. Set Canvas Render Mode to **World Space**
3. Set Rect Transform Width/Height (e.g., 800 x 600)
4. Calculate uniform scale: `scale = desired_meter_size / canvas_width`
   - Example: 2 meters wide with 800 width → scale = 2/800 = 0.0025
5. Set Scale X, Y, Z to this value
6. Position and rotate freely in the scene

---

## Rect Transform

Every UI element has a Rect Transform instead of a regular Transform. It controls position, size, anchoring, and pivot.

### Key Properties

| Property | Description |
|---|---|
| `anchoredPosition` | Position of pivot relative to anchors |
| `sizeDelta` | Size when not stretching (same as width/height) |
| `anchorMin` / `anchorMax` | Anchor points (0-1 normalized) |
| `offsetMin` / `offsetMax` | Offsets from anchor corners (stretching mode) |
| `pivot` | Center of rotation and scaling (0-1) |

### Anchor System

Anchors define how an element maintains its position relative to the parent when the parent resizes.

- **Same anchor (min == max)**: Element has fixed size, positioned relative to anchor point. Use `anchoredPosition` and `sizeDelta`.
- **Different anchors (min != max)**: Element stretches with parent. Use `offsetMin` and `offsetMax`.

**Anchor Presets:** Use the Anchor Presets dropdown in the Inspector for quick setup (e.g., top-left, stretch-stretch, center).

### Pivot

The pivot point stays in place when the element resizes.
- Center pivot: expands equally in all directions
- Upper-left pivot: expands right and down

---

## Visual Components

### Text

Displays text on the UI.

**Key properties:**
- `text` — The string to display
- `font` — Font asset
- `fontSize` — Size in pixels
- `alignment` — Text alignment
- `horizontalOverflow` / `verticalOverflow` — Wrap or Overflow
- `bestFit` — Auto-size to fit Rect Transform

**Overflow modes:**
- `HorizontalOverflow.Wrap` / `VerticalOverflow.Truncate`
- `HorizontalOverflow.Overflow` / `VerticalOverflow.Overflow`

### Image

Displays a Sprite on the UI.

**Image Types:**

| Type | Description |
|---|---|
| **Simple** | Displays sprite normally; can be tiled if size exceeds sprite bounds |
| **Sliced** | 9-slice scaling; corners stay fixed, edges stretch |
| **Tiled** | Repeats sprite to fill area |
| **Filled** | Reveals sprite based on fill amount (good for progress bars) |

**Filled type options:**
- `fillMethod`: Horizontal, Vertical, Radial90, Radial180, Radial360
- `fillOrigin`: Start corner/edge
- `fillAmount`: 0 to 1
- `clockwise`: Direction for radial fills

### Raw Image

Displays any Texture (not just Sprite). Use when you need to show a render texture or non-sprite texture.

### Mask

Clips child elements to the shape of the parent. Uses the parent's Image alpha or a separate sprite mask.

### Effects

- **Shadow**: Adds a drop shadow
- **Outline**: Adds an outline around the text or image

---

## Interaction Components

All interaction components inherit from `Selectable` and support visual state transitions (Normal, Highlighted, Pressed, Disabled).

### Button

```csharp
Button button = GetComponent<Button>();
button.onClick.AddListener(OnButtonClicked);

void OnButtonClicked() {
    Debug.Log("Clicked!");
}
```

### Toggle

```csharp
Toggle toggle = GetComponent<Toggle>();
toggle.isOn = true;
toggle.onValueChanged.AddListener(OnToggleChanged);

void OnToggleChanged(bool isOn) {
    Debug.Log($"Toggle: {isOn}");
}
```

**Toggle Group:** Add to a parent to make Toggles mutually exclusive (radio-button behavior).

### Slider

```csharp
Slider slider = GetComponent<Slider>();
slider.value = 0.5f;
slider.onValueChanged.AddListener(OnSliderChanged);

void OnSliderChanged(float value) {
    Debug.Log($"Slider: {value}");
}
```

- `minValue` / `maxValue` — Range
- `wholeNumbers` — Snap to integers
- `direction` — Left to Right, Right to Left, Bottom to Top, Top to Bottom

### Scrollbar

- `value`: 0 to 1
- `size`: Handle length as fraction (often controlled by Scroll Rect)
- `onValueChanged`: Fires when dragged

### Dropdown

```csharp
Dropdown dropdown = GetComponent<Dropdown>();
dropdown.options = new List<Dropdown.OptionData> {
    new Dropdown.OptionData("Option 1"),
    new Dropdown.OptionData("Option 2")
};
dropdown.onValueChanged.AddListener(OnDropdownChanged);
```

### Input Field

```csharp
InputField inputField = GetComponent<InputField>();
inputField.text = "Hello";
inputField.onValueChanged.AddListener(OnTextChanged);
inputField.onEndEdit.AddListener(OnSubmit);
```

**Properties:**
- `contentType`: Standard, Integer, Decimal, Alphanumeric, Email, Password, etc.
- `characterLimit`: Max characters
- `readOnly`: Non-editable

### Scroll Rect (Scroll View)

Creates scrollable content within a constrained viewport.

**Setup:**
1. Create Scroll Rect on container
2. Assign `Content` (the large child to scroll)
3. Add `Mask` to viewport for clipping
4. Optionally assign `Horizontal Scrollbar` / `Vertical Scrollbar`

---

## Auto Layout

Provides automatic positioning and sizing for UI elements.

### Layout Elements

Every Rect Transform is a layout element with:
- **Minimum width/height**: Smallest allowed size
- **Preferred width/height**: Ideal size based on content
- **Flexible width/height**: How much extra space to take

**Sizing priority:** minimum → preferred → flexible

### Layout Element Component

Manually override layout properties. Enable checkboxes for values you want to set.

### Layout Controllers

#### Content Size Fitter

Resizes its own Rect Transform to fit content.

| Fit Mode | Behavior |
|---|---|
| **Unconstrained** | No auto-sizing |
| **Min Size** | Size to minimum |
| **Preferred Size** | Size to preferred (most common) |

**Common use:** Add to GameObject with Text, set both fits to Preferred.

#### Aspect Ratio Fitter

Maintains aspect ratio.

| Fit Mode | Behavior |
|---|---|
| **Width Controls Height** | Height = Width / ratio |
| **Height Controls Width** | Width = Height * ratio |
| **Fit In Parent** | Fit inside parent, maintain ratio |
| **Envelope Parent** | Cover parent, maintain ratio |

#### Layout Groups

Control sizes and positions of children.

**Horizontal Layout Group:**
- Places children side by side
- `spacing`: Gap between children
- `padding`: Inner margin
- `childAlignment`: Alignment within group
- `childControlWidth` / `childControlHeight`: Let children determine size
- `childForceExpandWidth` / `childForceExpandHeight`: Force children to fill space

**Vertical Layout Group:**
- Stacks children vertically
- Same properties as Horizontal

**Grid Layout Group:**
- Arranges children in a grid
- `cellSize`: Fixed size for each cell
- `spacing`: Horizontal and vertical gap
- `constraint`: Fixed column count, fixed row count, or flexible

### Driven Properties

When a layout controller controls a property, it becomes read-only in the Inspector (shows info box). Changes are not saved to the Scene.

### Custom Layout Components

Implement these interfaces for custom layout behavior:

```csharp
public class MyLayout : MonoBehaviour, ILayoutElement, ILayoutGroup
{
    public void CalculateLayoutInputHorizontal() { }
    public void CalculateLayoutInputVertical() { }
    public void SetLayoutHorizontal() { }
    public void SetLayoutVertical() { }

    public float minWidth => 100;
    public float preferredWidth => 200;
    public float flexibleWidth => 1;
    public float minHeight => 50;
    public float preferredHeight => 100;
    public float flexibleHeight => 0;
    public int layoutPriority => 1;
}
```

**Trigger rebuild when layout changes:**
```csharp
LayoutRebuilder.MarkLayoutForRebuild(transform as RectTransform);
```

---

## Events

### Event System Architecture

The Event System manages input, raycasting, and event dispatching.

**Required in scene:** `EventSystem` GameObject (created automatically with first UI element).

**Input Modules:** Handle input and send events. Only one is active at a time.
- `Standalone Input Module`: Mouse, keyboard, controller (default)
- `Touch Input Module`: Touch input

**Raycasters:** Determine what UI/GameObject is under the pointer.
- `Graphic Raycaster`: On Canvas, for UI elements
- `Physics 2D Raycaster`: For 2D physics colliders
- `Physics 3D Raycaster`: For 3D physics colliders

### Event Interfaces

Implement these interfaces on MonoBehaviours to receive events:

| Interface | Event |
|---|---|
| `IPointerEnterHandler` | Pointer enters object |
| `IPointerExitHandler` | Pointer exits object |
| `IPointerDownHandler` | Pointer pressed down |
| `IPointerUpHandler` | Pointer released |
| `IPointerClickHandler` | Pointer clicked |
| `IBeginDragHandler` | Drag started |
| `IDragHandler` | Dragging |
| `IEndDragHandler` | Drag ended |
| `IDropHandler` | Object dropped on this |
| `IScrollHandler` | Scroll wheel |
| `ISelectHandler` | Object selected |
| `IDeselectHandler` | Object deselected |
| `IMoveHandler` | Move navigation (arrow keys/controller) |
| `ISubmitHandler` | Submit button pressed |
| `ICancelHandler` | Cancel button pressed |

```csharp
public class MyButton : MonoBehaviour, IPointerClickHandler
{
    public void OnPointerClick(PointerEventData eventData)
    {
        Debug.Log("Clicked!");
    }
}
```

### UnityEvents on Components

Most interaction components expose UnityEvents in the Inspector:
- `Button.onClick`
- `Toggle.onValueChanged`
- `Slider.onValueChanged`
- `Dropdown.onValueChanged`
- `InputField.onValueChanged` / `onEndEdit`
- `ScrollRect.onValueChanged`

---

## Animation Integration

Animate UI state transitions using the Animator system.

**Setup:**
1. Add `Animator` component to UI element
2. In the Selectable component, set Transition to **Animation**
3. Click **Auto Generate Animation** to create states:
   - Normal
   - Highlighted
   - Pressed
   - Disabled
4. Save the generated Animator Controller

**Creating animations:**
1. Open Animation window (`Window > Animation`)
2. Select the UI element
3. Choose animation clip (e.g., Highlighted)
4. Enter record mode, modify properties in Inspector
5. Exit record mode

**Note:** Does not work with Legacy Animation system. Only Animator Component is supported.

---

## Rich Text

Use HTML-like tags in Text components.

```xml
<b>Bold</b>
<i>Italic</i>
<size=24>Large text</size>
<color=#FF0000>Red text</color>
<color=red>Named color</color>
<material=2>Material reference</material>
<quad material=1 size=20 x=0 y=0 width=1 height=1 />
```

**Named colors:** aqua, black, blue, brown, cyan, darkblue, fuchsia, green, grey, lightblue, lime, maroon, navy, olive, orange, purple, red, silver, teal, white, yellow.

**Editor GUI:** Must enable `richText = true` on GUIStyle.

---

## Creating UI from Scripting

### Instantiate from Prefab

```csharp
// Instantiate as child of parent canvas
GameObject instance = Instantiate(prefab, parentTransform);
instance.transform.SetParent(parentTransform, worldPositionStays: false);

// Position (non-stretching)
RectTransform rt = instance.GetComponent<RectTransform>();
rt.anchoredPosition = new Vector2(100, 100);
rt.sizeDelta = new Vector2(200, 50);

// Position (stretching)
rt.offsetMin = new Vector2(10, 10);    // lower-left offset
rt.offsetMax = new Vector2(-10, -10);  // upper-right offset
```

### Modify Components

```csharp
Text text = instance.GetComponentInChildren<Text>();
text.text = "Dynamic Label";

Image image = instance.GetComponent<Image>();
image.sprite = mySprite;

Button button = instance.GetComponent<Button>();
button.onClick.AddListener(() => Debug.Log("Dynamic button clicked!"));
```

---

## Screen Transitions

Use Animator state machines for animated screen transitions.

**Animator setup:**
- Boolean parameter: `Open`
- States: Open, Closed
- Transitions: Open → Closed (Open = false), Closed → Open (Open = true)

**ScreenManager pattern:**
```csharp
public class ScreenManager : MonoBehaviour
{
    public Animator initiallyOpen;
    private Animator m_Open;
    private int m_OpenParameterId;

    void OnEnable()
    {
        m_OpenParameterId = Animator.StringToHash("Open");
        if (initiallyOpen != null) OpenPanel(initiallyOpen);
    }

    public void OpenPanel(Animator anim)
    {
        if (m_Open == anim) return;
        anim.gameObject.SetActive(true);
        anim.transform.SetAsLastSibling();
        CloseCurrent();
        m_Open = anim;
        m_Open.SetBool(m_OpenParameterId, true);
    }

    public void CloseCurrent()
    {
        if (m_Open == null) return;
        m_Open.SetBool(m_OpenParameterId, false);
        m_Open = null;
    }
}
```

**Button setup:** Add OnClick to ScreenManager.OpenPanel, pass target panel's Animator.

---

## Performance and Profiling

### UI (Canvas) Profiler Module

| Chart | Description |
|---|---|
| **Layout** | Time in layout groups calculations |
| **Render** | Time rendering UI to graphics device |

### UI Details (Canvas) Profiler Module

| Column | Description |
|---|---|
| **Batches** | Total batched draw calls |
| **Vertices** | Total vertices rendered |
| **Batch Breaking Reason** | Why batching was split |
| **GameObject Count** | Objects in batch |

**Common batch breaking reasons:**
- **Not Coplanar With Canvas**: Element is rotated (must be unrotated for batching)
- **CanvasInjectionIndex**: CanvasGroup present forces new batch
- **Different Material Instance**: Different materials require separate batches
- **Rect clipping / Texture / A8TextureUsage**: Mismatched masking or textures

### Optimization Tips

1. **Keep UI coplanar**: Don't rotate UI elements if you want them batched together
2. **Minimize CanvasGroups**: Each CanvasGroup forces a batch break
3. **Share materials and textures**: Identical settings = fewer batches
4. **Use identical masking**: Different masks split batches
5. **Nest Canvases carefully**: Nested canvases contribute to cumulative vertex count
6. **Avoid excessive layout rebuilds**: Call `LayoutRebuilder.MarkLayoutForRebuild()` strategically
7. **Deactivate off-screen hierarchies**: Prevents hidden elements from being processed

---

## Designing for Multiple Resolutions

1. Set anchor presets to corners (e.g., upper-left for top-left elements)
2. Add Canvas Scaler to root Canvas
3. Set UI Scale Mode to **Scale With Screen Size**
4. Set Reference Resolution (e.g., 1920 x 1080)
5. Adjust Match property (0.5 for balanced)
6. Test in Game view with different aspect ratios

---

## Best Practices

1. **Use prefabs for reusable UI elements**: Easy to customize and update globally.
2. **Set anchors before positioning**: Anchors determine how elements behave on resize.
3. **Use Canvas Scaler**: Essential for multi-resolution support.
4. **Separate UI into multiple Canvases**: Reduces rebuild scope when one part changes.
5. **Deactivate hidden screens**: Improves performance and prevents accidental interaction.
6. **Use Layout Groups wisely**: Powerful but can cause performance issues if overused.
7. **Avoid nesting Layout Groups too deeply**: Increases layout calculation cost.
8. **Unregister UnityEvent listeners**: Prevent memory leaks when destroying dynamic UI.
9. **Use the Profiler**: Monitor batch count and vertex count in the UI Details module.
10. **Set EventSystem first selected element**: Important for controller/keyboard navigation.

---

## Key Classes Quick Reference

| Class | Purpose |
|---|---|
| `Canvas` | Root container for UI elements |
| `CanvasScaler` | Resolution scaling |
| `RectTransform` | Position, size, anchor, pivot |
| `Graphic` | Base for visual components (Image, Text, RawImage) |
| `Selectable` | Base for interaction components |
| `Button`, `Toggle`, `Slider`, `Scrollbar`, `Dropdown`, `InputField`, `ScrollRect` | Built-in controls |
| `LayoutElement` | Override layout properties |
| `ContentSizeFitter` | Auto-size to content |
| `AspectRatioFitter` | Maintain aspect ratio |
| `HorizontalLayoutGroup`, `VerticalLayoutGroup`, `GridLayoutGroup` | Arrange children |
| `EventSystem` | Input and event management |
| `GraphicRaycaster` | Raycast for UI elements |
| `PointerEventData` | Event data for pointer events |

---

## Additional Resources

- **Scripting API**: `UnityEngine.UI` namespace
- **Package**: `com.unity.ugui` (built-in)
- **Comparison**: See UI Toolkit skill for differences between uGUI and UI Toolkit
