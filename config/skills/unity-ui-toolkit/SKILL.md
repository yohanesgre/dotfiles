---
name: unity-ui-toolkit
description: Unity's UI Toolkit system for creating Editor tools, runtime UI, custom inspectors, or any user interface. Covers UXML, USS, events, data binding, custom controls, and the UI Builder. Based on Unity 6.4 documentation.
---

# Unity UI Toolkit Skill

Use this skill when working with Unity's UI Toolkit system for creating Editor tools, runtime UI, custom inspectors, or any user interface in Unity. Covers UXML, USS, events, data binding, custom controls, and the UI Builder visual authoring tool.

---

## Overview

UI Toolkit is Unity's modern retained-mode UI system, inspired by web technologies (HTML/CSS/JS). It separates structure (UXML), style (USS), and behavior (C#).

| UI Toolkit | Web Equivalent | Purpose |
|---|---|---|
| **UXML** | HTML/XML | Declarative UI structure and reusable templates |
| **USS** | CSS | Visual styles, layout rules, and responsive design |
| **C# Scripts** | JavaScript | Interactivity, event handling, and data binding |

**Retained Mode Architecture**: UI builds a hierarchical visual tree in memory. You declare the structure once; UI Toolkit handles rendering and updates automatically.

**Layout Engine**: Based on CSS Flexbox. Use flex properties for space distribution, alignment, wrapping, and absolute positioning.

---

## Core Concepts

### Visual Tree

The visual tree is an object graph of lightweight `VisualElement` nodes that holds all elements in a window or panel.

```csharp
// Root access
VisualElement root = editorWindow.rootVisualElement; // Editor
VisualElement root = uiDocument.rootVisualElement;   // Runtime
```

**Key base class properties:**
- `name` — Unique identifier
- `classList` — USS class list
- `style` — Inline styles
- `styleSheets` — Attached USS stylesheets
- `pickingMode` — `Position` (default) or `Ignore` for pointer events
- `tabindex` / `focusable` — Focus management

---

## Structuring UI (UXML)

### UXML Format

```xml
<?xml version="1.0" encoding="utf-8"?>
<ui:UXML
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:ui="UnityEngine.UIElements"
    xmlns:uie="UnityEditor.UIElements"
    xsi:noNamespaceSchemaLocation="../../UIElementsSchema/UIElements.xsd"
    editor-extension-mode="False">
    <ui:Box>
        <ui:Toggle name="boots" label="Boots" value="false" />
        <ui:Button name="ok" text="OK" />
    </ui:Box>
</ui:UXML>
```

### Creating UI in C#

```csharp
using UnityEngine.UIElements;

var button = new Button { text = "Click me!", name = "myButton" };
root.Add(button);

// Query elements
var toggle = root.Q<Toggle>("myToggle");
var allButtons = root.Query<Button>().ToList();
```

### UXML Template Reuse

```xml
<ui:UXML xmlns:ui="UnityEngine.UIElements">
    <ui:Template src="Portrait.uxml" name="Portrait"/>
    <ui:VisualElement name="players">
        <ui:Instance template="Portrait" name="player1"/>
        <ui:Instance template="Portrait" name="player2"/>
    </ui:VisualElement>
</ui:UXML>
```

**Attribute overrides:**
```xml
<ui:Instance name="player1" template="PlayerTemplate">
    <ui:AttributeOverrides element-name="player-name-label" text="Alice" />
</ui:Instance>
```

### Attaching Stylesheets in UXML

```xml
<ui:UXML ...>
    <Style src="path/to/styles.uss" />
    <ui:VisualElement name="root" />
</ui:UXML>
```

Paths: absolute (`/Assets/...`), relative (`../styles.uss`), or package (`/Packages/com.unity...`).

---

## Styling UI (USS)

### Syntax

```css
selector {
    property: value;
}
```

### Selectors

| Type | Syntax | Matches |
|---|---|---|
| Type | `Button { }` | Elements of specific C# type |
| Class | `.highlight { }` | Elements with assigned USS class |
| Name | `#submit-btn { }` | Elements with specific name attribute |
| Universal | `* { }` | Any element |
| Descendant | `.panel Button { }` | Descendants in visual tree |
| Child | `.panel > Button { }` | Direct children |
| Multiple | `Button.active { }` | Elements matching all selectors |

### Pseudo-Classes

| Pseudo-class | Matches when |
|---|---|
| `:hover` | Cursor over element |
| `:active` | User interacting (Button, Toggle, RadioButton) |
| `:inactive` | User stops interacting |
| `:focus` | Element has focus |
| `:disabled` / `:enabled` | Element state |
| `:checked` | Toggle or RadioButton selected |
| `:root` | Highest-level element with stylesheet applied |

```css
Toggle:checked:hover {
    background-color: yellow;
}
```

### Custom Properties (Variables)

```css
:root {
    --primary-color: #ff0000;
}

Button {
    background-color: var(--primary-color);
}
```

### Applying Styles in C#

```csharp
// Inline styles
myElement.style.width = 200;
myElement.style.backgroundColor = Color.red;

// Add stylesheet
myElement.styleSheets.Add(myUSS);
```

---

## USS Transform

Transform properties apply a 2D transformation to a visual element without affecting layout of other elements. Preferred for animations because they avoid layout recalculations.

### Properties

| Property | USS Syntax | Description |
|---|---|---|
| **Transform Origin** | `transform-origin` | Point of origin for rotation, scaling, and translation. Default: `center`. Supports keywords (`left`, `top`, `bottom`, `right`, `center`), lengths, and percentages. |
| **Translate** | `translate` | Repositions the element along X and Y axes. Units must match when used with transitions. |
| **Scale** | `scale` | Changes apparent size (including padding, border, margins). Negative values flip. |
| **Rotate** | `rotate` | Rotates the element. Units: `deg`, `grad`, `rad`, `turn`. Positive = clockwise. |

### USS Examples

```css
translate: 80%;          /* X=80% of own size, Y=80% */
translate: 35px;         /* X=35px, Y=35px */
translate: 5% 10px;      /* X=5%, Y=10px */
translate: 24px 0%;      /* X=24px, Y=0% */

scale: 2.5;              /* 2.5x on both axes */
scale: -1 1;             /* Flip horizontally */
scale: none;             /* No scale */

rotate: 45deg;
rotate: 0.25turn;
rotate: none;

transform-origin: center;
transform-origin: 0% 100%;         /* bottom-left */
transform-origin: 20px 10px;
```

### C# Examples

```csharp
// Translate
element.style.translate = new Translate(Length.Percent(10), 50);
element.style.translate = new Translate(20, Length.Percent(30)); // X in px, Y in %

// Scale
element.style.scale = new Scale(new Vector2(0.5f, -1f));

// Rotate
element.style.rotate = new Rotate(180);                        // 180 degrees
element.style.rotate = new Rotate(Angle.Turns(0.5f));          // half turn

// Transform origin
element.style.transformOrigin = new TransformOrigin(100, Length.Percent(50));
```

### Performance Note

Transform properties don't trigger layout recalculation on other elements, making them ideal for animations. Use `translate` instead of `left`/`top` for position changes during animations.

---

## USS Transition

Transitions animate property changes over a given duration. Triggered when a property value changes (via pseudo-classes, C# code, or class list changes).

### Properties

| Property | USS Syntax | C# Method | Description |
|---|---|---|---|
| `transition-property` | `opacity, translate` | `IStyle.transitionProperty` | Which properties the transition applies to. Default: `all`. |
| `transition-duration` | `250ms, 500ms` | `IStyle.transitionDuration` | How long the transition takes. Default: `0s`. |
| `transition-timing-function` | `ease-out` | `IStyle.transitionTimingFunction` | Easing curve. Default: `ease`. |
| `transition-delay` | `0s, 100ms` | `IStyle.transitionDelay` | Delay before transition starts. Default: `0s`. |
| `transition` | *(shorthand)* | — | See shorthand section below. |

### USS Shorthand

Order: `property duration timing-function delay`

```css
transition: width 2s ease-out;
transition: margin-right 4s, color 1s;
```

### Easing Functions (transition-timing-function)

`ease` | `ease-in` | `ease-out` | `ease-in-out` | `linear` | `ease-in-sine` | `ease-out-sine` | `ease-in-out-sine` | `ease-in-cubic` | `ease-out-cubic` | `ease-in-out-cubic` | `ease-in-circ` | `ease-out-circ` | `ease-in-out-circ` | `ease-in-elastic` | `ease-out-elastic` | `ease-in-out-elastic` | `ease-in-back` | `ease-out-back` | `ease-in-out-back` | `ease-in-bounce` | `ease-out-bounce` | `ease-in-out-bounce`

### C# Examples

```csharp
// Transition property list
element.style.transitionProperty = new List<StylePropertyName> { "opacity", "translate" };

// Transition duration
element.style.transitionDuration = new List<TimeValue> { 250, new(500, TimeUnit.Millisecond) };

// Timing function
element.style.transitionTimingFunction = new List<EasingFunction> { EasingMode.Linear };
```

### Critical Rules (common mistakes)

**1. Match value units between start and end states**
```css
/* ✅ CORRECT — both use px */
.toast { translate: 0 20px; }
.toast-visible { translate: 0px 0px; }

/* ❌ WRONG — unitless 0 vs px — transition won't fire */
.toast { translate: 0 20px; }
.toast-visible { translate: 0 0; }
```

**2. Transitions don't fire on the first frame**
The transition system needs a "previous state" to compare against. The first frame has no previous state. Always delay the start of a transition by at least one frame:

```csharp
// ✅ CORRECT — schedule transition trigger after 16ms (1 frame)
element.schedule.Execute(() => {
    element.AddToClassList("visible-state");
}).StartingIn(16);

// ❌ WRONG — adding the class immediately won't trigger transition on first frame
element.AddToClassList("visible-state");
```

**3. Set transition properties on the base state, not the trigger state**
```css
/* ✅ CORRECT — transition defined on the base class */
.element {
    transition-property: opacity;
    transition-duration: 250ms;
    opacity: 0;
}
.element.visible { opacity: 1; }

/* ❌ WRONG — transition defined on hover/final state won't reverse properly */
.element.visible {
    transition-property: opacity;
    transition-duration: 250ms;
}
```

**4. Use C# inline styles, not USS class toggling, to trigger transitions**
Setting `transition-property` and changing values via inline C# style is more reliable than toggling USS classes that have different property values. Class-based transitions in USS don't always trigger:

```csharp
// ✅ RECOMMENDED — set transition properties + values in C#
element.style.transitionProperty = new List<StylePropertyName> { "translate", "opacity" };
element.style.transitionDuration = new List<TimeValue> { new(250, TimeUnit.Millisecond), new(250, TimeUnit.Millisecond) };
element.style.translate = new Translate(Length.Pixels(0), Length.Pixels(20));
element.style.opacity = 0;

element.schedule.Execute(() => {
    element.style.translate = new Translate(0, 0);   // triggers transition
    element.style.opacity = 1;                        // triggers transition
}).StartingIn(16);
```

```css
/* ❌ LESS RELIABLE — USS class-based transitions may not fire */
.toast { translate: 0 20px; transition-property: translate; }
.visible { translate: 0 0; }
```

**5. Use individual properties instead of the `transition` shorthand**
The shorthand parser differs between USS and CSS. Individual properties (`transition-property`, `transition-duration`) are more reliable.

```css
/* ✅ RECOMMENDED */
transition-property: opacity, translate;
transition-duration: 250ms, 250ms;

/* ⚠️ Shorthand — works but varies by Unity version */
transition: opacity 250ms, translate 250ms;
```

### Common Animatability Categories

| Category | Behavior | Example Properties |
|---|---|---|
| **Fully animatable** | Smooth interpolation between values | `opacity`, `translate`, `scale`, `rotate`, `background-color`, `color` |
| **Discrete** | Single-step jump at transition midpoint | `visibility`, `border-style`, `font-style` |
| **Non-animatable** | Instant change, no transition | `display`, `position`, `flex-direction`, `overflow` |

---

## Events

### Registration

```csharp
// Basic callback
myElement.RegisterCallback<PointerDownEvent>(OnPointerDown);

// Trickle-down phase (before bubble-up)
myElement.RegisterCallback<PointerDownEvent>(OnPointerDown, TrickleDown.TrickleDown);

// Unregister
myElement.UnregisterCallback<PointerDownEvent>(OnPointerDown);
```

### Event Propagation

1. **Trickle-down**: From root to target element
2. **Bubble-up**: From target element back to root

```csharp
void OnPointerDown(PointerDownEvent evt)
{
    evt.StopPropagation();      // Stop further propagation
    evt.PreventDefault();       // Prevent default behavior
}
```

### Common Event Types

| Category | Events |
|---|---|
| Pointer | `PointerDownEvent`, `PointerUpEvent`, `PointerMoveEvent`, `PointerEnterEvent`, `PointerLeaveEvent`, `PointerCaptureEvent` |
| Click | `ClickEvent` |
| Keyboard | `KeyDownEvent`, `KeyUpEvent` |
| Focus | `FocusEvent`, `BlurEvent` |
| Change | `ChangeEvent<T>` |
| Drag & Drop | `DragStartEvent`, `DragEnterEvent`, `DragLeaveEvent`, `DragUpdatedEvent`, `DragPerformEvent` |
| Panel | `AttachToPanelEvent`, `DetachFromPanelEvent` |

### Value Change Handling

```csharp
myToggle.RegisterValueChangedCallback(evt => {
    Debug.Log($"Changed from {evt.previousValue} to {evt.newValue}");
});

// Set without triggering event
myToggle.SetValueWithoutNotify(true);
```

### Pointer Capture

```csharp
void OnPointerDown(PointerDownEvent evt)
{
    myElement.CapturePointer(evt.pointerId);
    evt.StopPropagation();
}

void OnPointerUp(PointerUpEvent evt)
{
    myElement.ReleasePointer(evt.pointerId);
}
```

---

## Data Binding

### SerializedObject Binding (Editor Only)

Binds `SerializedProperty` to UI controls. Only binds the `value` property of `INotifyValueChanged<T>` elements.

```csharp
// Bind entire object
rootVisualElement.Bind(serializedObject);

// Bind specific property
element.BindProperty(serializedProperty);

// Or set path in UXML/C#
element.bindingPath = "propertyName";
```

**UXML binding:**
```xml
<TextField binding-path="playerName" label="Name:" />
<Toggle binding-path="isEnabled" label="Enabled" />
<Slider binding-path="health" />
```

### Runtime Data Binding

Binds any plain C# object to UI controls. Works in both runtime and Editor.

```csharp
// Supports path syntax: Path.To.List[2]
nameField.bindingPath = "playerName";
```

**Binding modes:** `TwoWay`, `ToTarget`, `ToSource`.

---

## Editor UI

### Creating a Custom Editor Window

```csharp
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

public class MyEditorWindow : EditorWindow
{
    [SerializeField] private VisualTreeAsset m_VisualTreeAsset;

    [MenuItem("Window/UI Toolkit/MyEditorWindow")]
    public static void ShowWindow()
    {
        GetWindow<MyEditorWindow>("My Window");
    }

    private void CreateGUI()
    {
        rootVisualElement.Add(m_VisualTreeAsset.Instantiate());
    }
}
```

**Creation via menu:** `Assets > Create > UI Toolkit > Editor Window`

### Custom Inspector

```csharp
[CustomEditor(typeof(MyScript))]
public class MyScriptEditor : Editor
{
    public override VisualElement CreateInspectorGUI()
    {
        var root = new VisualElement();
        root.Add(new Label("Custom Inspector"));
        InspectorElement.FillDefaultInspector(root, serializedObject, this);
        return root;
    }
}
```

### Hot Reload Support

`VisualElement` objects are not serializable. Store state in `EditorWindow` serialized fields; restore in `CreateGUI()` after reload.

```csharp
[SerializeField] private int m_SelectedIndex = -1;
```

---

## Runtime UI

### Setting Up Runtime UI

1. Create a UI Document (`.uxml`) with controls
2. Add **GameObject > UI Toolkit > UI Document** to the scene
3. Assign the UXML file to the **Source Asset** field
4. Create MonoBehaviours to define behavior

```csharp
using UnityEngine;
using UnityEngine.UIElements;

public class RuntimeUI : MonoBehaviour
{
    private Button _button;
    private UIDocument _uiDocument;

    private void OnEnable()
    {
        _uiDocument = GetComponent<UIDocument>();
        _button = _uiDocument.rootVisualElement.Q<Button>("button");
        _button.RegisterCallback<ClickEvent>(OnButtonClick);
    }

    private void OnDisable()
    {
        _button.UnregisterCallback<ClickEvent>(OnButtonClick);
    }

    private void OnButtonClick(ClickEvent evt)
    {
        Debug.Log("Clicked!");
    }
}
```

### Panel Settings

A `PanelSettings` asset is created automatically with the UI Document GameObject. It defines rendering settings such as scale mode, sorting order, and target texture.

---

## Custom Controls

### Unity 6 Attribute-Based System (Recommended)

```csharp
using UnityEngine.UIElements;

[UxmlElement]
public partial class ProgressBar : VisualElement
{
    [UxmlAttribute] public string title { get; set; }
    [UxmlAttribute] public float lowValue { get; set; }
    [UxmlAttribute] public float highValue { get; set; } = 100;
    [UxmlAttribute] public float value { get; set; }
}
```

**Requirements:**
- `[UxmlElement]` on the class
- `partial` keyword required
- `[UxmlAttribute]` on properties
- Attribute names auto-derived from property names

### Legacy System (Pre-Unity 6)

```csharp
public class ProgressBar : VisualElement
{
    public new class UxmlFactory : UxmlFactory<ProgressBar, UxmlTraits> { }
    public new class UxmlTraits : BindableElement.UxmlTraits
    {
        UxmlFloatAttributeDescription m_Value = new() { name = "value", defaultValue = 0 };
        public override void Init(VisualElement ve, IUxmlAttributes bag, CreationContext cc)
        {
            base.Init(ve, bag, cc);
            (ve as ProgressBar).value = m_Value.GetValueFromBag(bag, cc);
        }
    }
    public float value { get; set; }
}
```

---

## Rendering Custom Visual Content

### Painter2D API (Vector Graphics)

```csharp
public class CustomElement : VisualElement
{
    public CustomElement()
    {
        generateVisualContent += OnGenerateVisualContent;
    }

    void OnGenerateVisualContent(MeshGenerationContext mgc)
    {
        var painter = mgc.painter2D;
        painter.fillColor = Color.red;
        painter.BeginPath();
        painter.MoveTo(Vector2.zero);
        painter.LineTo(new Vector2(layout.width, 0));
        painter.LineTo(new Vector2(layout.width, layout.height));
        painter.LineTo(new Vector2(0, layout.height));
        painter.ClosePath();
        painter.Fill();
    }
}
```

### Mesh API

```csharp
void OnGenerateVisualContent(MeshGenerationContext mgc)
{
    var mesh = mgc.Allocate(4, 6);
    mesh.SetNextVertex(new Vertex { position = new Vector3(0, 0, Vertex.nearZ), tint = Color.red });
    // ... set remaining vertices and indices
}
```

---

## Working with Text

UI Toolkit uses **TextCore** (based on TextMesh Pro) with SDF font rendering.

**Font assets:**
- **Static**: Atlas generated at build time for known character sets
- **Dynamic**: Atlas generated at runtime; source font must be in build

**Styling text:**
```css
/* USS */
-unity-font: resource("MyFont");
-unity-font-style: bold;
-unity-text-align: middle-center;
```

**Rich text tags:**
```xml
<ui:Label text="<color=#FF0000>Red</color> text" />
```

---

## Testing and Debugging

| Tool | Access | Purpose |
|---|---|---|
| **UI Toolkit Debugger** | `Window > UI Toolkit > Debugger` | Inspect hierarchy, styles, and events in real time |
| **UI Builder Preview** | UI Builder ⋮ menu | Test UI visually within the Builder |
| **Live Reload** | Enabled by default in Editor | See UXML/USS changes immediately |
| **Event Debugger** | `Window > UI Toolkit > Event Debugger` | Inspect event dispatching |
| **Profiler Markers** | Unity Profiler | Profile UI element performance |

**Picking elements:** Use the Debugger's "Pick Element" tool to select elements directly in Canvas or Game view.

---

## Migration Reference

### uGUI to UI Toolkit

| uGUI | UI Toolkit |
|---|---|
| `Canvas` | `UIDocument` |
| `transform.FindChild()` | `rootVisualElement.Query()` / `.Q()` |
| `m_Toggle.isOn` | `m_Toggle.value` |
| `m_Button.onClick.AddListener()` | `m_Button.clicked +=` or `RegisterCallback<ClickEvent>()` |
| `transform.SetAsFirstSibling()` | `myVisualElement.SendToBack()` |
| `transform.SetAsLastSibling()` | `myVisualElement.BringToFront()` |
| Anchors/Pivots | Flexbox layout (`IStyle.position = Position.Absolute` to disable) |

### IMGUI to UI Toolkit

| IMGUI | UI Toolkit |
|---|---|
| `OnGUI()` | `CreateGUI()` |
| `Editor.OnInspectorGUI()` | `Editor.CreateInspectorGUI()` |
| `PropertyDrawer.OnGUI()` | `PropertyDrawer.CreatePropertyGUI()` |
| `GUILayout.BeginHorizontal()` | Automatic flexbox layout |
| `GUILayout.BeginScrollView()` | `ScrollView` element |
| `BeginDisabledGroup()` | `VisualElement.SetEnabled(false)` |
| `Button()` | `Button` |
| `Label()` | `Label` |
| `TextField()` | `TextField` |
| `Toggle()` | `Toggle` |
| `Slider()` | `Slider` |
| `EnumPopup()` | `EnumField` |
| `ObjectField()` | `ObjectField` |
| `FocusControl()` | `VisualElement.Focus()` |

**Embedding IMGUI:** Use `IMGUIContainer` inside UI Toolkit layouts.

---

## Best Practices

1. **Separate concerns**: Use UXML for structure, USS for style, C# for behavior.
2. **Prefer UXML/USS over C#**: Declarative definitions are easier to maintain and enable visual editing in UI Builder.
3. **Use `Q()` and `Query()`** for element lookup instead of maintaining references when possible.
4. **Unregister callbacks** in `OnDisable()` / cleanup methods to prevent memory leaks.
5. **Use `SetValueWithoutNotify()`** when setting values programmatically to avoid triggering change events.
6. **Leverage flexbox** for layout instead of absolute positioning when possible.
7. **Store Editor window state** in serialized fields for hot reload support.
8. **Use the UI Debugger** to inspect live UI hierarchy and applied styles during development.
9. **For Unity 6+**: Migrate custom controls to `[UxmlElement]` / `[UxmlAttribute]` attributes.
10. **Use USS variables** (`--my-var`) for theming and consistent design tokens.
11. **Prefer `translate` over `left`/`top` for animations** — transforms skip layout recalculation and animate more smoothly.
12. **Use `transition-property` + `transition-duration` (individual) over the `transition` shorthand** — USS shorthand parsing varies by Unity version.
13. **Units must match between start and end states** for transitions — `0 20px` to `0px 0px` (both px), never mixed with unitless `0`.
14. **Delay transition triggers by 16ms** — transitions don't fire on the first frame because there's no previous state to compare against.

---

## Key Classes Quick Reference

| Class | Purpose |
|---|---|
| `VisualElement` | Base class for all UI elements |
| `VisualTreeAsset` | Represents a UXML document |
| `EditorWindow` | Base class for custom Editor windows |
| `UIDocument` | Runtime UI document component |
| `PanelSettings` | Rendering settings for runtime panels |
| `Button`, `Toggle`, `Label`, `TextField`, `Slider`, `ListView`, `ScrollView` | Built-in controls |
| `ClickEvent`, `PointerDownEvent`, `ChangeEvent<T>`, `KeyDownEvent` | Common events |
| `MeshGenerationContext`, `Painter2D`, `Vertex` | Custom rendering |

---

## Additional Resources

- **UI Builder**: Visual authoring tool for UXML/USS (`Window > UI Toolkit > UI Builder`)
- **UI Samples**: Built-in examples (`Window > UI Toolkit > Samples`)
- **Scripting API**: `UnityEngine.UIElements` namespace
- **Package**: `com.unity.ui` (core), `com.unity.ui.builder` (UI Builder)
