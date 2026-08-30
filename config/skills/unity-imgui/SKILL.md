---
name: unity-imgui
description: Comprehensive reference for Unity's IMGUI (Immediate Mode GUI) system covering runtime OnGUI, controls, layout, styling, GUISkin, Editor Windows, Property Drawers, and TreeView. Based on Unity 6.4 documentation.
---

# Unity IMGUI

## Description
Comprehensive reference for Unity's IMGUI (Immediate Mode GUI) system — the code-driven, scripting-only GUI entirely separate from Unity's GameObject-based UI System (uGUI/UI Toolkit). Covers the complete lifecycle, all 16 control types, fixed and automatic layout, GUIStyle, GUISkin, runtime color overrides, Editor extension classes (EditorWindow, Editor, PropertyDrawer), TreeView API, SerializedObject/SerializedProperty, Undo/Redo, and Scene View Handles. Based on Unity 6.4 (6000.4) documentation.

## When to Use
Load when working with Unity's IMGUI system: creating `OnGUI()` controls for runtime debugging overlays, building custom Editor Windows, creating Custom Inspectors (Editor class), implementing Property Drawers, customizing Inspector appearance with GUISkin/GUIStyle, working with TreeViews, or using SerializedObject/SerializedProperty for property editing.

## Core Concepts

### IMGUI Overview
IMGUI (Immediate Mode GUI) is a **code-driven GUI system** entirely separate from Unity's GameObject-based UI System. It is driven by calls to the `OnGUI` function on any script that implements it.

**Common uses:**
- In-game debugging displays and tools
- Custom inspectors for script components
- Editor windows and tools to extend Unity itself

**Not intended for:** Normal in-game player UIs. Use Unity's GameObject-based UI system for that.

**Immediate Mode** means the code to display the interface is executed **every frame**. There are no persistent GameObjects — controls are created and destroyed implicitly each frame with a single function call.

```csharp
void OnGUI() {
    if (GUILayout.Button("Press Me")) { 
        Debug.Log("Hello!");
    }
}
```

### OnGUI Lifecycle
- `OnGUI()` is called **every frame** as long as the containing script is enabled — just like `Update()`
- If the script is **disabled**, `OnGUI()` is not called and the GUI disappears
- The line that declares the control is the same one that creates it — no explicit create/destroy needed
- Any scripting logic can be used to conditionally display controls:

```csharp
void OnGUI () {
    if (Time.time % 2 < 1) {
        if (GUI.Button(new Rect(10, 10, 200, 20), "Meet the flashing button")) {
            print("You clicked me!");
        }
    }
}
```

### Anatomy of a Control
Every GUI Control follows: `Type(Position, Content)`

#### Type
The **Control Type** is a function from either:
- `GUI` class — fixed/absolute positioning (e.g., `GUI.Label()`, `GUI.Button()`)
- `GUILayout` class — automatic layout (e.g., `GUILayout.Label()`, `GUILayout.Button()`)

#### Position (Rect)
Provided via `Rect(left, top, width, height)`. All values are **integers** in **pixels**. Coordinate system is **top-left based**. The second pair are **total width and height**, not end coordinates. Use `Screen.width` and `Screen.height` for full screen dimensions.

```csharp
GUI.Box(new Rect(0, 0, 100, 50), "Top-left");
GUI.Box(new Rect(Screen.width - 100, 0, 100, 50), "Top-right");
GUI.Box(new Rect(0, Screen.height - 50, 100, 50), "Bottom-left");
GUI.Box(new Rect(Screen.width - 100, Screen.height - 50, 100, 50), "Bottom-right");
```

#### Content Types
Three options for the second argument:

**1. Text (string):**
```csharp
GUI.Label(new Rect(0, 0, 100, 50), "This is a label");
```

**2. Image (Texture2D):**
```csharp
public Texture2D controlTexture;
void OnGUI() { GUI.Label(new Rect(0, 0, 100, 50), controlTexture); }
```

**3. GUIContent (text + image + tooltip combined):**
```csharp
// Text + tooltip
GUI.Button(new Rect(10, 10, 100, 20), new GUIContent("Click me", "This is the tooltip"));
GUI.Label(new Rect(10, 40, 100, 20), GUI.tooltip);

// Text + image + tooltip
GUI.Button(new Rect(10, 10, 100, 20), new GUIContent("Click me", icon, "This is the tooltip"));
GUI.Label(new Rect(10, 40, 100, 20), GUI.tooltip);
```

`GUI.tooltip` is set automatically when the mouse hovers a control with a tooltip in its `GUIContent`. It is valid only during that `OnGUI()` call.

### Complete Control Reference
All controls can be used with either `GUI` (fixed layout) or `GUILayout` (auto layout). Examples below use `GUI`.

#### Label — Non-interactive, display only
```csharp
GUI.Label(new Rect(25, 25, 100, 30), "Label");
```
**Signature:** `GUI.Label(Rect position, string|Texture|GUIContent content)`

#### Box — Non-interactive container with background
```csharp
GUI.Box(new Rect(10, 10, 100, 90), "Loader Menu");
```
**Signature:** `GUI.Box(Rect position, string|Texture|GUIContent content)`

#### Button — Returns true once when clicked (on mouse release)
```csharp
if (GUI.Button(new Rect(25, 25, 100, 30), "Button")) {
    // Executed when clicked
}
```
**Signature:** `GUI.Button(Rect position, string|Texture|GUIContent content) -> bool`

#### RepeatButton — Returns true every frame while mouse is held
```csharp
if (GUI.RepeatButton(new Rect(25, 25, 100, 30), "RepeatButton")) {
    // Executed every frame while held
}
```
**Signature:** `GUI.RepeatButton(Rect position, string|Texture|GUIContent content) -> bool`

#### TextField — Single-line editable text. Must store the return value
```csharp
private string textFieldString = "text field";
void OnGUI() { textFieldString = GUI.TextField(new Rect(25, 25, 100, 30), textFieldString); }
```
**Signature:** `GUI.TextField(Rect position, string text) -> string`
**Overloads:** `(Rect, string, int maxLength)`, `(Rect, string, GUIStyle style)`

#### TextArea — Multi-line editable text
```csharp
private string textAreaString = "text area";
void OnGUI() { textAreaString = GUI.TextArea(new Rect(25, 25, 100, 30), textAreaString); }
```
**Signature:** `GUI.TextArea(Rect position, string text) -> string`

#### PasswordField — Single-line text field that masks characters
```csharp
private string password = "";
void OnGUI() { password = GUI.PasswordField(new Rect(25, 25, 100, 30), password, '*'); }
```
**Signature:** `GUI.PasswordField(Rect position, string password, char maskChar) -> string`

#### Toggle — Checkbox with persistent on/off boolean
```csharp
private bool toggleBool = true;
void OnGUI() { toggleBool = GUI.Toggle(new Rect(25, 25, 100, 30), toggleBool, "Toggle"); }
```
**Signature:** `GUI.Toggle(Rect position, bool value, string|Texture|GUIContent content) -> bool`

#### Toolbar — Row of buttons; only one active. Tracked by integer index
```csharp
private int toolbarInt = 0;
private string[] toolbarStrings = {"Toolbar1", "Toolbar2", "Toolbar3"};
void OnGUI() { toolbarInt = GUI.Toolbar(new Rect(25, 25, 250, 30), toolbarInt, toolbarStrings); }
```
**Signature:** `GUI.Toolbar(Rect position, int selectedIndex, string[]|Texture[]|GUIContent[] content) -> int`

#### SelectionGrid — Multi-row Toolbar. Specify column count
```csharp
private int selectionGridInt = 0;
private string[] selectionStrings = {"Grid 1", "Grid 2", "Grid 3", "Grid 4"};
void OnGUI() { selectionGridInt = GUI.SelectionGrid(new Rect(25, 25, 300, 60), selectionGridInt, selectionStrings, 2); }
```
**Signature:** `GUI.SelectionGrid(Rect position, int selectedIndex, string[] content, int xCount) -> int`

#### HorizontalSlider — Draggable knob for float value between min/max
```csharp
private float hSliderValue = 0.0f;
void OnGUI() { hSliderValue = GUI.HorizontalSlider(new Rect(25, 25, 100, 30), hSliderValue, 0.0f, 10.0f); }
```
**Signature:** `GUI.HorizontalSlider(Rect position, float value, float leftValue, float rightValue) -> float`

#### VerticalSlider
```csharp
private float vSliderValue = 0.0f;
void OnGUI() { vSliderValue = GUI.VerticalSlider(new Rect(25, 25, 100, 30), vSliderValue, 10.0f, 0.0f); }
```
**Signature:** `GUI.VerticalSlider(Rect position, float value, float topValue, float bottomValue) -> float`

#### HorizontalScrollbar — Like HorizontalSlider but with knob size parameter
```csharp
private float hScrollbarValue;
void OnGUI() { hScrollbarValue = GUI.HorizontalScrollbar(new Rect(25, 25, 100, 30), hScrollbarValue, 1.0f, 0.0f, 10.0f); }
```
**Signature:** `GUI.HorizontalScrollbar(Rect position, float value, float size, float leftValue, float rightValue) -> float`
- `size`: width of the scrollbar knob

#### VerticalScrollbar
```csharp
private float vScrollbarValue;
void OnGUI() { vScrollbarValue = GUI.VerticalScrollbar(new Rect(25, 25, 100, 30), vScrollbarValue, 1.0f, 10.0f, 0.0f); }
```
**Signature:** `GUI.VerticalScrollbar(Rect position, float value, float size, float topValue, float bottomValue) -> float`

#### ScrollView — Viewable area of larger content. Requires two Rects
```csharp
private Vector2 scrollViewVector = Vector2.zero;
private string innerText = "I am inside the ScrollView";
void OnGUI() {
    scrollViewVector = GUI.BeginScrollView(new Rect(25, 25, 100, 100), scrollViewVector, new Rect(0, 0, 400, 400));
    innerText = GUI.TextArea(new Rect(0, 0, 400, 400), innerText);
    GUI.EndScrollView();
}
```
**Signature:** `GUI.BeginScrollView(Rect position, Vector2 scrollPosition, Rect viewRect) -> Vector2` + `GUI.EndScrollView()`

#### Window — Draggable container with ID and separate function
```csharp
private Rect windowRect = new Rect(20, 20, 120, 50);
void OnGUI() { windowRect = GUI.Window(0, windowRect, WindowFunction, "My Window"); }
void WindowFunction(int windowID) {
    // Draw any controls inside the window here
}
```
**Signature:** `GUI.Window(int id, Rect clientRect, GUI.WindowFunction func, string|Texture|GUIContent title) -> Rect`
The returned `Rect` must be stored because Unity updates it when the user drags the window.

### State Management

**GUI.changed** — Static boolean that is `true` if any GUI control was manipulated by the user in the current frame. Resets to `false` at the start of each `OnGUI()` call:
```csharp
selectedToolbar = GUI.Toolbar(new Rect(50, 10, Screen.width - 100, 30), selectedToolbar, toolbarStrings);
if (GUI.changed) { Debug.Log("Toolbar was clicked"); }
```

**GUI.enabled** — Enable/disable groups of controls. When `false`, controls are drawn grayed out and don't respond:
```csharp
GUI.enabled = false;
GUI.Button(new Rect(10, 10, 100, 20), "Can't click me");
GUI.enabled = true;
```

**Focus control:**
- `GUI.SetNextControlName(string name)` — set name of next control for reference
- `GUI.FocusControl(string name)` — move keyboard focus to named control
- `GUI.FocusWindow(int id)` — set focus to a window
- `GUI.UnfocusWindow()` — remove focus from current window
- `GUI.UnfocusCurrentControl()` — remove focus from current control

```csharp
GUI.SetNextControlName("MyTextField");
textFieldString = GUI.TextField(new Rect(10, 10, 100, 20), textFieldString);
if (GUILayout.Button("Focus the text field")) { GUI.FocusControl("MyTextField"); }
```

### Layout Modes

IMGUI has two layout modes that can be mixed in the same `OnGUI()`:

#### Fixed Layout (GUI class)
Uses `GUI` class with explicit `Rect()` positioning. Best for pre-designed interfaces. Controls positioned in **groups** using `GUI.BeginGroup()` / `GUI.EndGroup()`.

```csharp
GUI.Button(new Rect(25, 25, 100, 30), "I am a Fixed Layout Button");
```

#### Automatic Layout (GUILayout class)
Uses `GUILayout` class. No `Rect()` needed — controls auto-position top-to-bottom. Uses `GUILayoutOption` objects for constraints.

```csharp
GUILayout.Button("I am an Automatic Layout Button");
```

#### GUILayoutOption Reference
Pass these as the last parameter(s) to any `GUILayout` control:

| Option | Description |
|--------|-------------|
| `GUILayout.Width(float w)` | Fixed width in pixels (overrides auto-width) |
| `GUILayout.Height(float h)` | Fixed height in pixels |
| `GUILayout.MinWidth(float w)` | Minimum width |
| `GUILayout.MaxWidth(float w)` | Maximum width |
| `GUILayout.MinHeight(float h)` | Minimum height |
| `GUILayout.MaxHeight(float h)` | Maximum height |
| `GUILayout.ExpandWidth(bool v)` | Allow horizontal expansion (default: true) |
| `GUILayout.ExpandHeight(bool v)` | Allow vertical expansion (default: false) |

#### GUILayout Methods
| Method | Description |
|--------|-------------|
| `GUILayout.BeginHorizontal()` / `EndHorizontal()` | Horizontal group (left-to-right) |
| `GUILayout.BeginVertical()` / `EndVertical()` | Vertical group (top-to-bottom) |
| `GUILayout.BeginArea(Rect)` / `EndArea()` | Fixed-position container for auto-layout |
| `GUILayout.FlexibleSpace()` | Fill remaining space in group |
| `GUILayout.Space(float px)` | Fixed pixel spacer |
| `GUILayout.Label/Button/RepeatButton/TextField/TextArea/Toggle/Toolbar/SelectionGrid` | Auto-layout controls |
| `GUILayout.HorizontalSlider/VerticalSlider` | Auto-layout sliders |
| `GUILayout.HorizontalScrollbar/VerticalScrollbar` | Auto-layout scrollbars |
| `GUILayout.Box(...)` | Auto-layout box |

#### GUI Group (Fixed Layout)
Groups define areas with relative positioning. All children are relative to the group's top-left corner:

```csharp
void OnGUI() {
    GUI.BeginGroup(new Rect(Screen.width / 2 - 50, Screen.height / 2 - 50, 100, 100));
    GUI.Box(new Rect(0, 0, 100, 100), "Group is here");
    GUI.Button(new Rect(10, 40, 80, 30), "Click me");
    GUI.EndGroup();
}
```

**Nested groups for clipping** (e.g., energy bar):
```csharp
GUI.BeginGroup(new Rect(0, 0, 256, 32));
GUI.Box(new Rect(0, 0, 256, 32), bgImage);
GUI.BeginGroup(new Rect(0, 0, playerEnergy * 256, 32));  // Inner clips foreground
GUI.Box(new Rect(0, 0, 256, 32), fgImage);
GUI.EndGroup();
GUI.EndGroup();
```

#### GUILayout Area
Auto-layout equivalent of Groups. Defines a fixed screen region:
```csharp
GUILayout.BeginArea(new Rect(Screen.width / 2, Screen.height / 2, 300, 300));
GUILayout.Button("I am completely inside an Area");
GUILayout.EndArea();
```
Inside an area, visible elements stretch their width to fill the area by default.

#### Horizontal & Vertical Group Nesting
```csharp
GUILayout.BeginArea(new Rect(0, 0, 200, 60));
GUILayout.BeginHorizontal();
    if (GUILayout.RepeatButton("Increase max\nSlider Value")) { maxSliderValue += 3.0f * Time.deltaTime; }
    GUILayout.BeginVertical();
        GUILayout.Box("Slider Value: " + Mathf.Round(sliderValue));
        sliderValue = GUILayout.HorizontalSlider(sliderValue, 0.0f, maxSliderValue);
    GUILayout.EndVertical();
GUILayout.EndHorizontal();
GUILayout.EndArea();
```

### GUIStyle

A `GUIStyle` defines the **appearance** of a single IMGUI Control. **Namespace:** `UnityEngine`.

#### 8 Visual States
Each control style has 8 states, each of type `GUIStyleState`:
1. **Normal** — default state
2. **Hover** — mouse over
3. **Active** — mouse clicking
4. **Focused** — keyboard focus
5. **On Normal** — enabled state (for controls that toggle on/off)
6. **On Hover** — enabled + mouse over
7. **On Active** — enabled + clicking
8. **On Focused** — enabled + focused

**Important:** A state must have a **Background** assigned before **Text Color** will be applied.

#### GUIStyleState Properties
| Property | Type | Description |
|----------|------|-------------|
| `background` | `Texture2D` | Background image for this state |
| `scaledBackgrounds` | `Texture2D[]` | 2x resolution backgrounds (Editor-only) |
| `textColor` | `Color` | Text color for this state |

#### GUIStyle Properties
| Property | Type | Description |
|----------|------|-------------|
| `Name` | `string` | String identifier; used with `GUI.skin.GetStyle("name")` |
| `Normal`, `Hover`, `Active`, `Focused` | `GUIStyleState` | State backgrounds and text colors |
| `OnNormal`, `OnHover`, `OnActive`, `OnFocused` | `GUIStyleState` | Enabled-state variants |
| `Border` | `RectOffset` | Pixels on each side of background image unaffected by scaling |
| `Padding` | `RectOffset` | Space from edge of Control to start of content |
| `Margin` | `RectOffset` | Margins between elements rendered in this style and other controls |
| `Overflow` | `RectOffset` | Extra space added to background image |
| `Font` | `Font` | Font for text; null uses skin default |
| `FontSize` | `int` | Font size (dynamic fonts only) |
| `FontStyle` | `FontStyle` | `Normal`, `Bold`, `Italic`, `BoldAndItalic` (dynamic fonts only) |
| `ImagePosition` | `ImagePosition` | How background image and text combine: `ImageLeft`, `ImageAbove`, `ImageOnly`, `TextOnly` |
| `Alignment` | `TextAnchor` | `UpperLeft`, `UpperCenter`, `UpperRight`, `MiddleLeft`, `MiddleCenter`, `MiddleRight`, `LowerLeft`, `LowerCenter`, `LowerRight` |
| `WordWrap` | `bool` | Wrap text at boundaries |
| `Clipping` | `TextClipping` | `Overflow` (extends past bounds) or `Clip` (hidden); only applies when WordWrap enabled |
| `ContentOffset` | `Vector2` | X/Y pixel displacement of content |
| `FixedWidth` | `float` | If non-0, overrides `Rect()` width |
| `FixedHeight` | `float` | If non-0, overrides `Rect()` height |
| `StretchWidth` | `bool` | Allow horizontal stretching for layout |
| `StretchHeight` | `bool` | Allow vertical stretching for layout |
| `RichText` | `bool` | Enable HTML-style tags (`<b>`, `<i>`, `<size>`, `<color>`) |
| `LineHeight` | `float` | (Read Only) Height of one line of text in pixels |

#### GUIStyle Methods
| Method | Description |
|--------|-------------|
| `CalcSize(GUIContent content)` | Calculate rendered size of content |
| `CalcHeight(GUIContent content, float width)` | Calculate height for given width |
| `CalcMinMaxWidth(GUIContent, out float minWidth, out float maxWidth)` | Min/max width for content |
| `CalcScreenSize(Vector2 contentSize)` | Screen size from content size |
| `Draw(Rect, GUIContent, bool isHover, bool isActive, bool on, bool hasKeyboard)` | Low-level draw |
| `DrawCursor(Rect, GUIContent, int pos, int cursorPos)` | Draw with cursor |
| `DrawWithTextSelection(Rect, GUIContent, int controlID, int firstSelected, int lastSelected)` | Draw with selection |
| `GetCursorPixelPosition(Rect, GUIContent, int cursorStringIndex)` | Pixel position of string index |
| `GetCursorStringIndex(Rect, GUIContent, Vector2 cursorPixelPosition)` | String index from pixel position |

#### Using GUIStyle
```csharp
// Inspector-editable
public GUIStyle customGuiStyle;
void OnGUI() { GUILayout.Button("I am a custom-styled Button", customGuiStyle); }

// Programmatic construction
GUIStyle myStyle = new GUIStyle();
myStyle.normal.background = myTexture;
myStyle.normal.textColor = Color.white;
myStyle.fontSize = 20;
myStyle.fontStyle = FontStyle.Bold;
myStyle.alignment = TextAnchor.MiddleCenter;

// Copy from existing style
GUIStyle myStyle = new GUIStyle(GUI.skin.button);
myStyle.normal.textColor = Color.red;

// Empty style
GUIStyle.none  // renders with no styling at all
```

#### Named Styles via String
GUIStyle has an implicit operator that converts a string to a GUIStyle by looking up a named style from `GUI.skin`:
```csharp
// These are equivalent:
GUILayout.Button("Text", "MyCustomStyle");
GUILayout.Button("Text", GUI.skin.GetStyle("MyCustomStyle"));
```

Built-in style names: `"box"`, `"button"`, `"toggle"`, `"label"`, `"textfield"`, `"textarea"`, `"window"`, `"horizontalslider"`, `"horizontalsliderthumb"`, `"verticalslider"`, `"verticalsliderthumb"`, `"horizontalscrollbar"`, `"horizontalscrollbarthumb"`, `"verticalscrollbar"`, `"verticalscrollbarthumb"`.

### GUISkin

A `GUISkin` is a **collection of GUIStyles** — a `ScriptableObject` asset that applies an entire look to all controls at once. **Namespace:** `UnityEngine`.

**Create:** `Assets > Create > GUI Skin` (produces `.guiskin` file).

#### GUISkin Properties
| Property | Type | Description |
|----------|------|-------------|
| `Font` | `Font` | Global font for all controls |
| `Box` | `GUIStyle` | Style for `GUI.Box` / `GUILayout.Box` |
| `Button` | `GUIStyle` | Style for all button controls |
| `Toggle` | `GUIStyle` | Style for all toggle controls |
| `Label` | `GUIStyle` | Style for all label controls |
| `Text Field` | `GUIStyle` | Style for `GUI.TextField` |
| `Text Area` | `GUIStyle` | Style for `GUI.TextArea` |
| `Window` | `GUIStyle` | Style for `GUI.Window` |
| `Horizontal Slider` | `GUIStyle` | Background of `GUI.HorizontalSlider` |
| `Horizontal Slider Thumb` | `GUIStyle` | Draggable thumb of horizontal slider |
| `Vertical Slider` | `GUIStyle` | Background of `GUI.VerticalSlider` |
| `Vertical Slider Thumb` | `GUIStyle` | Draggable thumb of vertical slider |
| `Horizontal Scrollbar` | `GUIStyle` | Background of `GUI.HorizontalScrollbar` |
| `Horizontal Scrollbar Thumb` | `GUIStyle` | Thumb of horizontal scrollbar |
| `Horizontal Scrollbar Left Button` | `GUIStyle` | Left arrow button |
| `Horizontal Scrollbar Right Button` | `GUIStyle` | Right arrow button |
| `Vertical Scrollbar` | `GUIStyle` | Background of `GUI.VerticalScrollbar` |
| `Vertical Scrollbar Thumb` | `GUIStyle` | Thumb of vertical scrollbar |
| `Vertical Scrollbar Up Button` | `GUIStyle` | Up arrow button |
| `Vertical Scrollbar Down Button` | `GUIStyle` | Down arrow button |
| `Scroll View` | `GUIStyle` | Background of `GUI.BeginScrollView` |
| `Custom Styles` | `GUIStyle[]` | Array of additional named styles (1-20) |
| `Settings` | `GUISettings` | Global behavior settings (see below) |

#### Settings Sub-Properties
| Property | Description |
|----------|-------------|
| `Double Click Selects Word` | Double-click selects the entire word |
| `Triple Click Selects Line` | Triple-click selects the entire line |
| `Cursor Color` | Color of keyboard cursor |
| `Cursor Flash Speed` | Speed of cursor flashing |
| `Selection Color` | Color of selected text background |

#### Applying a GUISkin
```csharp
public GUISkin mySkin;
void OnGUI() {
    GUI.skin = mySkin;          // Apply custom skin
    GUILayout.Button("I am a re-Skinned Button");
    GUI.skin = null;             // Revert to default Unity skin
    GUILayout.Button("This Button uses the default UnityGUI Skin");
}
```
You can switch skins multiple times within one `OnGUI()` call.

#### Custom Named Styles within a Skin
```csharp
public GUISkin customSkin;
void OnGUI() {
    GUI.skin = customSkin;
    GUILayout.Button("I am a custom styled Button", "MyCustomControl");
    GUILayout.Button("I am the Skin's Button Style");
}
```
In the skin Inspector, expand **Custom Styles**, set array size, give each a **Name**, then reference by that name.

#### FindStyle vs GetStyle
```csharp
public GUIStyle FindStyle(string styleName);  // Returns style or null (no error)
public GUIStyle GetStyle(string styleName);   // Returns style or logs error
```

### Runtime Color Overrides

| Property | Affects | Multiplied by |
|----------|---------|---------------|
| `GUI.color` | **Everything** (background + text) | Element's own color |
| `GUI.backgroundColor` | **Backgrounds only** | `GUI.color` |
| `GUI.contentColor` | **Text only** | `GUI.color` |

**Color multiplication order:**
```
finalBackgroundColor = GUI.backgroundColor × GUI.color × style.normal.background
finalTextColor       = GUI.contentColor    × GUI.color × style.normal.textColor
```

**Important gotcha:** In the light Unity theme, default label text is black (0,0,0), so `GUI.color` multiplication yields black — no visible effect. In the dark theme, default label text is white (1,1,1) and `GUI.color` works as expected.

```csharp
void OnGUI() {
    GUI.backgroundColor = Color.yellow;      // Yellow background tint
    GUI.Button(new Rect(10, 10, 70, 30), "Yellow bg");
    
    GUI.contentColor = Color.yellow;          // Yellow text tint
    GUI.Button(new Rect(10, 50, 70, 30), "Yellow text");
    
    GUI.color = new Color(0.5f, 1.0f, 0.5f); // Global green tint
    GUI.Label(new Rect(10, 90, 100, 20), "Green tinted label");
    
    // Reset
    GUI.color = Color.white;
    GUI.backgroundColor = Color.white;
    GUI.contentColor = Color.white;
}
```

### Style Resolution Priority (highest to lowest)
1. Explicit `GUIStyle` parameter in control function
2. Named style string (resolved from current `GUI.skin`)
3. Control-specific style from active skin (e.g., `GUI.skin.button`)
4. Default built-in Unity skin (when `GUI.skin = null`)

### Extending the Editor

> **Note:** Unity strongly recommends using **UI Toolkit** for new Editor extensions. IMGUI editor APIs covered here are still supported and widely used.

#### Namespace Layout
| Namespace | Key Classes |
|-----------|-------------|
| `UnityEditor` | `EditorWindow`, `Editor`, `EditorGUI`, `EditorGUILayout`, `PropertyDrawer`, `SerializedObject`, `SerializedProperty`, `Undo` |
| `UnityEditor.IMGUI.Controls` | `TreeView`, `TreeViewItem`, `TreeViewState`, `MultiColumnHeader` |
| `UnityEngine` | `GUI`, `GUILayout`, `GUIStyle`, `GUIContent`, `PropertyAttribute` |

#### Required Folder Structure
```
Assets/
  Scripts/
    MyComponent.cs           ← runtime scripts
  Editor/
    MyComponentEditor.cs     ← editor scripts
    MyPropertyDrawer.cs      ← PropertyDrawer scripts
```

### EditorWindow

**Namespace:** `UnityEditor` | **Inherits from:** `ScriptableObject`

#### Window Lifecycle Order
1. `OnEnable` — script loaded / enabled
2. `EditorApplication.isUpdating` — if true, AssetDatabase refresh in progress
3. `CreateGUI` — for UI Toolkit (not needed for IMGUI windows)
4. `Update()` — multiple times per second on all visible windows
5. `OnGUI()` — multiple times per frame for rendering and handling events
6. `OnDisable` — disabled or destroyed

#### Key Static Properties
| Property | Description |
|----------|-------------|
| `focusedWindow` | Window with keyboard focus (Read Only) |
| `mouseOverWindow` | Window under mouse cursor (Read Only) |

#### Key Instance Properties
| Property | Description |
|----------|-------------|
| `autoRepaintOnSceneChange` | Repaint when SceneView modified |
| `docked` | True if docked |
| `hasFocus` | True if focused |
| `hasUnsavedChanges` | Prompts user to save/discard before closing |
| `maximized` | Whether window is maximized |
| `maxSize` / `minSize` | Size constraints when floating or modal |
| `position` | Desired position in screen space |
| `titleContent` | GUIContent for title bar |

#### Key Static Methods
| Method | Description |
|--------|-------------|
| `CreateWindow<T>()` | Create EditorWindow of type T |
| `FocusWindowIfItsOpen<T>()` | Focus first found window of type if open |
| `GetWindow<T>()` | Return or create first window of type (standard, dockable) |
| `GetWindowWithRect<T>(Rect)` | Window with specific initial position/size |
| `HasOpenInstances<T>()` | Check if any windows of type are open |

#### Key Instance Methods
| Method | Description |
|--------|-------------|
| `Close()` | Close the editor window |
| `Focus()` | Move keyboard focus to this window |
| `Repaint()` | Queue repaint next frame |
| `Show()` | Show the window |
| `ShowAsDropDown()` | Show with dropdown behavior and styling |
| `ShowModal()` / `ShowModalUtility()` | Show as modal window |
| `ShowPopup()` | Show with popup-style framing |
| `ShowUtility()` | Show as floating utility window |
| `ShowTab()` | Show docked |
| `BeginWindows()` / `EndWindows()` | Mark area of popup windows |

#### Message Events
`Awake()`, `OnBecameInvisible()`, `OnBecameVisible()`, `OnDestroy()`, `OnFocus()`, `OnGUI()`, `OnHierarchyChange()`, `OnInspectorUpdate()` (10fps), `OnLostFocus()`, `OnProjectChange()`, `OnSelectionChange()`, `Update()`.

### EditorGUI & EditorGUILayout

**Namespace:** `UnityEditor`

`EditorGUI` requires explicit `Rect` positioning (like `GUI`). `EditorGUILayout` auto-positions (like `GUILayout`).

**Key difference from GUILayout:** `EditorGUILayout` `Begin*` methods return a `Rect` (GUILayout returns void).

#### EditorGUI Static Properties
| Property | Description |
|----------|-------------|
| `actionKey` | Platform-dependent "action" modifier held? |
| `indentLevel` | Indent level of field labels |
| `showMixedValue` | Appearance of editing multiple different values |

#### Key EditorGUI Methods
| Method | Description |
|--------|-------------|
| `BeginChangeCheck()` / `EndChangeCheck()` | Check for GUI changes in block |
| `BeginDisabledGroup(bool)` / `EndDisabledGroup()` | Group of disabled controls |
| `BeginProperty(Rect, GUIContent, SerializedProperty)` / `EndProperty()` | Prefab override support wrapper |
| `BeginFoldoutHeaderGroup()` / `EndFoldoutHeaderGroup()` | Label with foldout arrow |
| `PropertyField(Rect, SerializedProperty, GUIContent, bool)` | Auto field for SerializedProperty |
| `ObjectField(...)` | Object reference with drag-and-drop |
| `Slider(Rect, SerializedProperty, float, float, GUIContent)` | Slider for SerializedProperty |
| `IntSlider(Rect, SerializedProperty, int, int, GUIContent)` | Integer slider |
| `EnumPopup(Rect, Enum, ...)` | Enum dropdown |
| `EnumFlagsField(...)` | Flags enum selection |
| `LayerField(Rect, ...)` | Layer selection |
| `TagField(Rect, ...)` | Tag selection |
| `MaskField(Rect, ..., int, string[])` | Mask field |
| `HelpBox(Rect, string, MessageType)` | Info/warning/error box |
| `Foldout(Rect, bool, string)` | Foldout label |
| `PrefixLabel(Rect, int, GUIContent)` | Label before a control |
| `GetPropertyHeight(SerializedProperty, GUIContent, bool)` | Height for PropertyField |
| `InspectorTitlebar(Rect, bool, Object[], bool)` | Inspector-window-like titlebar |
| `DropdownButton(Rect, GUIContent, FocusType, GUIStyle)` | Button for dropdown content |
| `DrawRect(Rect, Color)` | Filled rectangle |
| `LabelField(...)` | Read-only label |
| `SelectableLabel(...)` | Copy-pasteable label |
| `LinkButton(...)` | Clickable link label |
| `TextField`, `TextArea`, `PasswordField`, `FloatField`, `IntField`, `DoubleField`, `LongField` | Input fields |
| `DelayedFloatField`, `DelayedIntField`, `DelayedTextField` | Commit-on-enter fields |
| `Vector2Field`, `Vector3Field`, `Vector4Field`, `RectField`, `BoundsField` | Structured value fields |
| `MultiFloatField`, `MultiIntField`, `MultiPropertyField` | Multi-control inline fields |
| `ColorField`, `CurveField`, `GradientField` | Specialized editors |
| `MinMaxSlider(...)` | Range slider |
| `ProgressBar(Rect, float, string)` | Progress bar |

#### Key EditorGUILayout Methods
All `EditorGUI` field types have `EditorGUILayout` equivalents (auto-laid-out). Additional layout methods:
| Method | Description |
|--------|-------------|
| `BeginHorizontal()` / `EndHorizontal()` | Horizontal group (returns Rect) |
| `BeginVertical()` / `EndVertical()` | Vertical group (returns Rect) |
| `BeginScrollView(Vector2)` / `EndScrollView()` | Scrollable area |
| `BeginToggleGroup(string, bool)` / `EndToggleGroup()` | Toggle group for enabling/disabling |
| `BeginFadeGroup(float)` / `EndFadeGroup()` | Animated hide/show |
| `BeginFoldoutHeaderGroup(...)` / `EndFoldoutHeaderGroup()` | Foldout with header |
| `HelpBox(string, MessageType)` | Help box |
| `Space()` | Small space between controls |
| `GetControlRect()` | Get a rect for Editor control |
| `EditorToolbar(...)` | Toolbar with editor tools |
| `ToolContextToolbar(...)` | Toolbar with tool contexts |

### Custom Editors (Editor Class)

**Namespace:** `UnityEditor`

A **custom editor** replaces the default Inspector layout for a component.

**Requirements:**
- Class inherits from `Editor`
- `[CustomEditor(typeof(MyComponent))]` attribute
- `[CanEditMultipleObjects]` enables multi-object editing
- Script must be in an `Editor` folder

```csharp
using UnityEngine;
using UnityEditor;

[CustomEditor(typeof(LookAtPoint))]
[CanEditMultipleObjects]
public class LookAtPointEditor : Editor 
{
    SerializedProperty lookAtPoint;
    
    void OnEnable()
    {
        lookAtPoint = serializedObject.FindProperty("lookAtPoint");
    }

    public override void OnInspectorGUI()
    {
        serializedObject.Update();
        EditorGUILayout.PropertyField(lookAtPoint);
        serializedObject.ApplyModifiedProperties();
        if (lookAtPoint.vector3Value.y > (target as LookAtPoint).transform.position.y)
            EditorGUILayout.LabelField("(Above this object)");
    }
}
```

**Key points:**
- `target` gives access to the inspected object (first one); `targets` gives all
- Always call `serializedObject.Update()` before reading properties
- Always call `serializedObject.ApplyModifiedProperties()` after making changes
- The "Script" field is not automatically shown — add it manually if desired

### Property Drawers

**Namespace:** `UnityEditor` | **Inherits from:** `PropertyDrawer`

Two uses:
1. **Customize GUI of every instance of a Serializable class** — `[CustomPropertyDrawer(typeof(MyClass))]`
2. **Customize GUI of members with custom PropertyAttributes** — `[CustomPropertyDrawer(typeof(MyAttribute))]`

**Critical:** `EditorGUILayout` functions are NOT usable in Property Drawers — use `EditorGUI` with explicit Rects.

#### Serializable Class Drawer
```csharp
[Serializable]
public class Ingredient { public string name; public int amount = 1; public IngredientUnit unit; }

[CustomPropertyDrawer(typeof(Ingredient))]
public class IngredientDrawer : PropertyDrawer
{
    public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
    {
        EditorGUI.BeginProperty(position, label, property);
        position = EditorGUI.PrefixLabel(position, GUIUtility.GetControlID(FocusType.Passive), label);
        var indent = EditorGUI.indentLevel;
        EditorGUI.indentLevel = 0;
        var amountRect = new Rect(position.x, position.y, 30, position.height);
        var unitRect = new Rect(position.x + 35, position.y, 50, position.height);
        var nameRect = new Rect(position.x + 90, position.y, position.width - 90, position.height);
        EditorGUI.PropertyField(amountRect, property.FindPropertyRelative("amount"), GUIContent.none);
        EditorGUI.PropertyField(unitRect, property.FindPropertyRelative("unit"), GUIContent.none);
        EditorGUI.PropertyField(nameRect, property.FindPropertyRelative("name"), GUIContent.none);
        EditorGUI.indentLevel = indent;
        EditorGUI.EndProperty();
    }
}
```

#### Custom Attribute Drawer
```csharp
// The attribute (runtime, no Editor folder needed)
public class MyRangeAttribute : PropertyAttribute 
{
    readonly float min;
    readonly float max;
    public MyRangeAttribute(float min, float max) { this.min = min; this.max = max; }
}

// The drawer (must be in Editor folder)
[CustomPropertyDrawer(typeof(MyRangeAttribute))]
public class RangeDrawer : PropertyDrawer
{
    public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
    {
        MyRangeAttribute range = (MyRangeAttribute)attribute;
        if (property.propertyType == SerializedPropertyType.Float)
            EditorGUI.Slider(position, property, range.min, range.max, label);
        else if (property.propertyType == SerializedPropertyType.Integer)
            EditorGUI.IntSlider(position, property, (int)range.min, (int)range.max, label);
        else
            EditorGUI.LabelField(position, label.text, "Use MyRange with float or int.");
    }
}
```

**Key points:**
- Override `OnGUI(Rect position, SerializedProperty property, GUIContent label)`
- Optionally override `GetPropertyHeight(SerializedProperty, GUIContent)` for custom height
- Use `EditorGUI.BeginProperty` / `EditorGUI.EndProperty` for prefab override support
- Access attribute via the `attribute` property (cast from `PropertyAttribute`)
- Use `property.FindPropertyRelative("fieldName")` for child fields
- Recommended: keep each PropertyDrawer in its own file with a matching name

#### Decision: Property Drawer vs Custom Editor
| Use Case | Tool |
|----------|------|
| Change how a specific **type** (class) looks everywhere | PropertyDrawer with `[CustomPropertyDrawer(typeof(MyClass))]` |
| Change how a property with a custom **attribute** looks | PropertyDrawer with `[CustomPropertyDrawer(typeof(MyAttribute))]` |
| Replace the entire Inspector for a component | Custom Editor inheriting from `Editor` |
| Add controls to a floating/dockable window | `EditorWindow` with `OnGUI` |

### TreeView API

**Namespace:** `UnityEditor.IMGUI.Controls`

IMGUI control for displaying **hierarchical data** with expand/collapse. Supports multi-column tables with search, filter, sorting, reordering, and drag-and-drop.

**Note:** TreeView is NOT a tree data model — construct it using any tree data structure you prefer.

#### Key Classes
| Class | Description |
|-------|-------------|
| `TreeView` | Main control class |
| `TreeViewItem` | Individual item (must have unique integer ID) |
| `TreeViewState` | Serializable state (selection, expanded, navigation, scroll) |
| `MultiColumnHeader` | Multi-column header support |

#### Important TreeView Methods
| Method | Description |
|--------|-------------|
| `BuildRoot()` | **Abstract** — create the root item; called every `Reload()` |
| `BuildRows()` | **Virtual** — build rows list from tree; called on expand/collapse too |
| `Reload()` | (Re)builds the tree |
| `RowGUI(RowGUIArgs)` | Override to customize row rendering |
| `SetupDepthsFromParentsAndChildren(root)` | Auto-set depths from parent/child relationships |
| `SetupParentsAndChildrenFromDepths(root, items)` | Auto-set parent/child from depth info |
| `GetRows()` | Get the list of built rows |
| `GetFirstAndLastVisibleRows()` | Get visible row range |
| `FindItem(id)` / `FindRows(ids)` | Find items by ID |
| `SelectionClick(TreeViewItem, bool)` | Handle selection click |
| `BeforeRowsGUI()` / `AfterRowsGUI()` | Hooks before/after all RowGUI calls |

#### TreeViewItem
- Must have **unique integer ID** (unique among all items in TreeView)
- Root must have `depth = -1`
- For Unity objects, use `GetInstanceID()` as the ID
- IDs persist in `TreeViewState` for state persistence

#### Build Lifecycle
```
Reload() called
  └─ BuildRoot()         ← builds full tree
  └─ BuildRows()         ← builds visible row list
        │
  User expands/collapses
        └─ BuildRows()   ← called again (BuildRoot NOT called)
```

#### Simple TreeView Example
```csharp
class SimpleTreeView : TreeView
{
    public SimpleTreeView(TreeViewState treeViewState) : base(treeViewState) { Reload(); }
        
    protected override TreeViewItem BuildRoot()
    {
        var root = new TreeViewItem { id = 0, depth = -1, displayName = "Root" };
        var allItems = new List<TreeViewItem> 
        {
            new TreeViewItem { id = 1, depth = 0, displayName = "Animals" },
            new TreeViewItem { id = 2, depth = 1, displayName = "Mammals" },
            new TreeViewItem { id = 3, depth = 2, displayName = "Tiger" },
        };
        SetupParentsAndChildrenFromDepths(root, allItems);
        return root;
    }
}
```

#### EditorWindow Hosting a TreeView
```csharp
class SimpleTreeViewWindow : EditorWindow
{
    [SerializeField] TreeViewState m_TreeViewState;
    SimpleTreeView m_SimpleTreeView;

    void OnEnable()
    {
        if (m_TreeViewState == null) m_TreeViewState = new TreeViewState();
        m_SimpleTreeView = new SimpleTreeView(m_TreeViewState);
    }

    void OnGUI() { m_SimpleTreeView.OnGUI(new Rect(0, 0, position.width, position.height)); }

    [MenuItem("TreeView Examples/Simple Tree Window")]
    static void ShowWindow() { var window = GetWindow<SimpleTreeViewWindow>(); window.titleContent = new GUIContent("My Window"); window.Show(); }
}
```

#### RowGUIArgs Structure
```csharp
protected struct RowGUIArgs {
    public TreeViewItem item;
    public string label;
    public Rect rowRect;
    public int row;
    public bool selected;
    public bool focused;
    public bool isRenaming;
    public int GetNumVisibleColumns();
    public int GetColumn(int visibleColumnIndex);
    public Rect GetCellRect(int visibleColumnIndex);
}
```

### SerializedObject & SerializedProperty

**Namespace:** `UnityEditor`

Classes for editing serialized fields generically. Automatically handle dirtying, Undo integration, and Prefab override styling.

#### SerializedObject

**Construction:**
```csharp
var so = new SerializedObject(myComponent);                  // Single target
var so = new SerializedObject(transformsArray);              // Multiple targets
```

**Key Methods:**
| Method | Description |
|--------|-------------|
| `Update()` | Sync from actual object values |
| `ApplyModifiedProperties()` | Flush changes back to objects (registers undo) |
| `ApplyModifiedPropertiesWithoutUndo()` | Flush without undo registration |
| `FindProperty(string path)` | Find serialized property by name |
| `GetIterator()` | Get the first serialized property |
| `CopyFromSerializedProperty(SerializedProperty)` | Copy value from property |
| `UpdateIfRequiredOrScript()` | Update only if modified since last call |

**Key Properties:**
| Property | Description |
|----------|-------------|
| `targetObject` / `targetObjects` | Inspected object(s) (Read Only) |
| `isEditingMultipleObjects` | True when editing multiple |
| `hasModifiedProperties` | True when modified but not applied |

**Standard Editor workflow:**
```
1. Create SerializedObject(target)
2. Call Update() to sync with actual values
3. FindProperty() / GetIterator() to access properties
4. Read/modify SerializedProperty values
5. Call ApplyModifiedProperties() to flush changes
```

#### SerializedProperty

**Finding properties:**
```csharp
SerializedProperty prop = serializedObject.FindProperty("m_LocalPosition");
SerializedProperty childProp = parentProp.FindPropertyRelative("childField");
```

**Common SerializedPropertyType values:** `Float`, `Integer`, `Boolean`, `String`, `Vector3`, `Color`, `ObjectReference`, `Enum`, `AnimationCurve`, `Gradient`, `LayerMask`, `Bounds`, `Rect`, `Vector2Int`, `Vector3Int`, `RectInt`, `BoundsInt`.

**Key Properties:**
| Property | Description |
|----------|-------------|
| `propertyType` | Type of this property |
| `floatValue` / `intValue` / `boolValue` / `stringValue` | Primitive values |
| `vector3Value` / `vector2Value` / `vector4Value` | Vector values |
| `colorValue` / `animationCurveValue` / `gradientValue` | Specialized values |
| `objectReferenceValue` | Object reference |
| `enumValueIndex` / `enumNames` | Enum data |
| `hasMultipleDifferentValues` | True when multi-editing different values |
| `isArray` / `arraySize` / `arrayElementType` | Array metadata |
| `depth` | Indentation depth |
| `displayName` | Display-friendly name |
| `name` | Actual property name |

> **Multi-select caveat:** Value getters (e.g., `floatValue`, `vector3Value`) only return the value from the **first target**. Assigning to them affects **all targets**.

### Undo / Redo

**Namespace:** `UnityEditor`

The Undo system stores delta changes in the undo stack. Undo operations automatically combine based on events (e.g., mouse down splits undo groups).

**Key operations:**
```csharp
Undo.RecordObject(myGameObject.transform, "Zero Transform Position");
myGameObject.transform.position = Vector3.zero;

Undo.AddComponent<Rigidbody>(myGameObject);
Undo.RegisterCreatedObjectUndo(go, "Created go");
Undo.DestroyObjectImmediate(myGameObject);
Undo.SetTransformParent(myGameObject.transform, newParent, "Set new parent");
```

**Key static methods:**
| Method | Description |
|--------|-------------|
| `RecordObject(Object, string)` | Record changes done after this call |
| `RecordObjects(Object[], string)` | Record changes on multiple objects |
| `RegisterCompleteObjectUndo(Object, string)` | Full copy of object state |
| `RegisterCreatedObjectUndo(Object, string)` | Undo creation |
| `DestroyObjectImmediate(Object)` | Destroy and make undoable |
| `AddComponent<T>(GameObject)` | Add component with undo |
| `SetTransformParent(Transform, Transform, string)` | Set parent with undo |
| `SetSiblingIndex(Transform, int)` | Set sibling index with undo |
| `MoveGameObjectToScene(GameObject, Scene)` | Move to different scene with undo |
| `RegisterFullObjectHierarchyUndo(Object, string)` | Copy entire hierarchy states |
| `IncrementCurrentGroup()` | Start new undo group |
| `SetCurrentGroupName(string)` | Name current undo group |
| `GetCurrentGroup()` / `GetCurrentGroupName()` | Query current group |
| `CollapseUndoOperations(int)` | Collapse operations to group index |
| `ClearUndo(Object)` | Remove undo operations for object |
| `ClearAll()` | Remove all undo/redo |
| `PerformUndo()` / `PerformRedo()` | Programmatic undo/redo |
| `RevertAllInCurrentGroup()` | Revert without recording redo |
| `FlushUndoRecordObjects()` | Ensure RecordObject'd objects are registered |

**Events:** `undoRedoPerformed`, `undoRedoEvent`, `willFlushUndoRecord`, `postprocessModifications`.

**Undo grouping:**
```csharp
Undo.IncrementCurrentGroup();
Undo.SetCurrentGroupName("My Complex Operation");
Undo.RecordObject(obj1, "change 1");
Undo.RecordObject(obj2, "change 2");
// Both changes undone as one operation
```

### Handles & Scene View

Implement `OnSceneGUI` in a custom Editor for Scene View widgets:
```csharp
public void OnSceneGUI()
{
    var t = (target as LookAtPoint);
    EditorGUI.BeginChangeCheck();
    Vector3 pos = Handles.PositionHandle(t.lookAtPoint, Quaternion.identity);
    if (EditorGUI.EndChangeCheck())
    {
        Undo.RecordObject(target, "Move point");
        t.lookAtPoint = pos;
        t.Update();
    }
}
```

**Key points:**
- Use `Handles` class for 3D Scene view controls (`Handles.PositionHandle`, `Handles.RadiusHandle`, etc.)
- Wrap 2D GUI in `Handles.BeginGUI()` / `Handles.EndGUI()`
- Use `EditorGUI.BeginChangeCheck()`/`EndChangeCheck()` for change detection
- Always wrap changes with `Undo.RecordObject` for undo support

## Code Patterns

### Basic OnGUI Layout
```csharp
void OnGUI() {
    GUILayout.Label("Settings", EditorStyles.boldLabel);
    myString = EditorGUILayout.TextField("Text Field", myString);
    groupEnabled = EditorGUILayout.BeginToggleGroup("Optional Settings", groupEnabled);
    myBool = EditorGUILayout.Toggle("Toggle", myBool);
    myFloat = EditorGUILayout.Slider("Slider", myFloat, -3, 3);
    EditorGUILayout.EndToggleGroup();
}
```

### Custom Editor Window
```csharp
using UnityEditor;
using UnityEngine;

public class MyWindow : EditorWindow
{
    string myString = "Hello World";
    bool groupEnabled;
    bool myBool = true;
    float myFloat = 1.23f;
    
    [MenuItem("Window/My Window")]
    public static void ShowWindow() { EditorWindow.GetWindow(typeof(MyWindow)); }
    
    void OnGUI() {
        GUILayout.Label("Base Settings", EditorStyles.boldLabel);
        myString = EditorGUILayout.TextField("Text Field", myString);
        groupEnabled = EditorGUILayout.BeginToggleGroup("Optional Settings", groupEnabled);
        myBool = EditorGUILayout.Toggle("Toggle", myBool);
        myFloat = EditorGUILayout.Slider("Slider", myFloat, -3, 3);
        EditorGUILayout.EndToggleGroup();
    }
}
```

### Custom Inspector (Editor)
```csharp
[CustomEditor(typeof(MyComponent)), CanEditMultipleObjects]
public class MyComponentEditor : Editor
{
    SerializedProperty myField;
    void OnEnable() { myField = serializedObject.FindProperty("myField"); }
    public override void OnInspectorGUI()
    {
        serializedObject.Update();
        EditorGUILayout.PropertyField(myField);
        serializedObject.ApplyModifiedProperties();
        if (GUILayout.Button("Do Something", EditorStyles.miniButton))
        {
            serializedObject.FindProperty("someProp").floatValue = Random.Range(0f, 10f);
            serializedObject.ApplyModifiedProperties();
        }
    }
}
```

### Property Drawer
```csharp
[CustomPropertyDrawer(typeof(MyAttribute))]
public class MyAttributeDrawer : PropertyDrawer
{
    public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
    {
        EditorGUI.BeginProperty(position, label, property);
        position = EditorGUI.PrefixLabel(position, GUIUtility.GetControlID(FocusType.Passive), label);
        EditorGUI.PropertyField(position, property, GUIContent.none);
        EditorGUI.EndProperty();
    }
}
```

### GUIStyle Customization
```csharp
public GUIStyle customGuiStyle;
void OnGUI() { GUILayout.Button("Styled Button", customGuiStyle); }

// Programmatic
GUIStyle redButton = new GUIStyle();
redButton.normal.textColor = Color.red;
redButton.fontSize = 14;
redButton.fontStyle = FontStyle.Bold;
redButton.alignment = TextAnchor.MiddleCenter;

// Copy from existing
GUIStyle bigLabel = new GUIStyle(GUI.skin.label);
bigLabel.fontSize = 24;
```

### TreeView Setup
```csharp
class SimpleTreeViewWindow : EditorWindow
{
    [SerializeField] TreeViewState m_TreeViewState;
    SimpleTreeView m_SimpleTreeView;

    void OnEnable()
    {
        if (m_TreeViewState == null) m_TreeViewState = new TreeViewState();
        m_SimpleTreeView = new SimpleTreeView(m_TreeViewState);
    }

    void OnGUI() { m_SimpleTreeView.OnGUI(new Rect(0, 0, position.width, position.height)); }

    [MenuItem("Window/Simple Tree")]
    static void ShowWindow() { var w = GetWindow<SimpleTreeViewWindow>(); w.titleContent = new GUIContent("Tree"); w.Show(); }
}
```

### Undo/Redo in Editor
```csharp
Undo.RecordObject(obj, "Description of change");
// ... make changes to obj ...
// Changes are now undoable

// Or group multiple:
Undo.IncrementCurrentGroup();
Undo.SetCurrentGroupName("Complex Op");
Undo.RecordObject(a, "change a");
Undo.RecordObject(b, "change b");
```

### Skin Switching at Runtime
```csharp
public GUISkin[] skins;
private int cont = 0;
void Update() { if (Input.GetKeyDown(KeyCode.Space)) cont++; }
void OnGUI() {
    GUI.skin = skins[cont % skins.Length];
    GUI.Label(new Rect(10, 10, 100, 20), "Hello World!");
    GUI.Box(new Rect(10, 50, 50, 50), "A BOX");
    if (GUI.Button(new Rect(10, 110, 70, 30), "A button")) Debug.Log("Button pressed");
    GUI.skin = null;  // Back to default
}
```

## Key Classes and Components Reference

| Class/Component | Namespace | Purpose |
|-----------------|-----------|---------|
| `GUI` | `UnityEngine` | Fixed-layout controls (`Label`, `Button`, `TextField`, `Window`, `ScrollView`, etc.) |
| `GUILayout` | `UnityEngine` | Automatic-layout controls; `BeginHorizontal`, `BeginVertical`, `BeginArea`, `FlexibleSpace`, `Space` |
| `GUIContent` | `UnityEngine` | Combined text, image, and tooltip for controls |
| `Rect` | `UnityEngine` | Pixel-coordinate rectangle for fixed-layout positioning |
| `RectOffset` | `UnityEngine` | Per-edge pixel offsets (used for border, padding, margin, overflow) |
| `GUIStyle` | `UnityEngine` | Per-control appearance; 8 visual states, font, alignment, word wrap, rich text |
| `GUIStyleState` | `UnityEngine` | Per-state settings (background, textColor, scaledBackgrounds) |
| `GUISkin` | `UnityEngine` | ScriptableObject collection of GUIStyles for all control types; applied via `GUI.skin` |
| `GUISettings` | `UnityEngine` | Global behavior: double/triple click, cursor color/flash, selection color |
| `TextAnchor` | `UnityEngine` | Enum: `UpperLeft`, `UpperCenter`, `UpperRight`, `MiddleLeft`, `MiddleCenter`, `MiddleRight`, `LowerLeft`, `LowerCenter`, `LowerRight` |
| `ImagePosition` | `UnityEngine` | Enum: `ImageLeft`, `ImageAbove`, `ImageOnly`, `TextOnly` |
| `TextClipping` | `UnityEngine` | Enum: `Overflow`, `Clip` |
| `FontStyle` | `UnityEngine` | Enum: `Normal`, `Bold`, `Italic`, `BoldAndItalic` |
| `EditorWindow` | `UnityEditor` | Custom dockable/floating editor windows; `GetWindow<T>()`, `OnGUI()`, lifecycle events |
| `Editor` | `UnityEditor` | Custom Inspector for components; `[CustomEditor]`, `OnInspectorGUI()`, `serializedObject` |
| `EditorGUI` | `UnityEditor` | Fixed-layout editor controls (`PropertyField`, `ObjectField`, `Slider`, `EnumPopup`, `HelpBox`, `Foldout`, etc.) |
| `EditorGUILayout` | `UnityEditor` | Auto-layout editor controls; `BeginHorizontal`, `BeginScrollView`, `BeginToggleGroup`, `BeginFadeGroup` |
| `PropertyDrawer` | `UnityEditor` | Custom GUI for serializable classes or custom attributes; `OnGUI(Rect, SerializedProperty, GUIContent)` |
| `PropertyAttribute` | `UnityEngine` | Base class for custom attributes used with PropertyDrawers |
| `SerializedObject` | `UnityEditor` | Generic editing of serialized fields; `Update()`, `ApplyModifiedProperties()`, `FindProperty()` |
| `SerializedProperty` | `UnityEditor` | Individual serialized field; `floatValue`, `vector3Value`, `FindPropertyRelative()`, `propertyType` |
| `SerializedPropertyType` | `UnityEditor` | Enum: `Float`, `Integer`, `Boolean`, `String`, `Vector3`, `Color`, `ObjectReference`, `Enum`, etc. |
| `Undo` | `UnityEditor` | Undo/redo system; `RecordObject`, `RegisterCreatedObjectUndo`, `AddComponent`, grouping |
| `TreeView` | `UnityEditor.IMGUI.Controls` | Hierarchical list control; `BuildRoot()`, `BuildRows()`, `RowGUI()` |
| `TreeViewItem` | `UnityEditor.IMGUI.Controls` | Individual tree node (unique int ID); `depth`, `displayName`, `AddChild()` |
| `TreeViewState` | `UnityEditor.IMGUI.Controls` | Serializable state (selection, expanded, scroll); `[SerializeField]` in EditorWindow |
| `MultiColumnHeader` | `UnityEditor.IMGUI.Controls` | Multi-column header for TreeView tables |
| `Handles` | `UnityEditor` | 3D Scene View controls (`PositionHandle`, `RadiusHandle`); `BeginGUI`/`EndGUI` for 2D overlay |
| `EditorStyles` | `UnityEditor` | Built-in editor style presets (`boldLabel`, `miniButton`, etc.) |

## Best Practices

- **Use GameObject-based UI for player-facing interfaces** — IMGUI is for debugging tools, custom inspectors, and editor extensions; never use it for player UIs.
- **Store control state in member variables** — text fields, toggles, sliders, scroll positions must be stored as class fields since OnGUI is called every frame with no persistent controls.
- **Always call `serializedObject.Update()` before reading and `ApplyModifiedProperties()` after changing** in custom Editors.
- **Use `EditorGUI.BeginProperty`/`EndProperty` in Property Drawers** for proper prefab override support and label handling.
- **Never use `EditorGUILayout` in Property Drawers** — only `EditorGUI` with explicit Rects is supported in `PropertyDrawer.OnGUI()`.
- **Use `EditorGUI.BeginChangeCheck()`/`EndChangeCheck()` to detect user interaction** in both Inspector and Scene View code.
- **Wrap Scene View modifications with `Undo.RecordObject`** to make them undoable.
- **Reset color tints after use** — always restore `GUI.color`, `GUI.backgroundColor`, and `GUI.contentColor` to `Color.white` at the end of your `OnGUI()` block to avoid leaking tints to other GUI elements.
- **Assign `GUI.skin = null` to revert to default Unity skin** after using a custom skin.
- **Place editor scripts in an `Editor` folder** — classes using `UnityEditor` namespace must be in an Editor folder or they will cause build errors.
- **Use `[CanEditMultipleObjects]` for custom Editors** to support multi-object editing in the Inspector.
- **TreeView root must have `depth = -1` and unique int ID** — all items need unique IDs that persist in `TreeViewState`.
- **Choose the right tool**: PropertyDrawer for type-wide appearance changes or attributes; Editor for entire Inspector replacement; EditorWindow for standalone tools.
- **Prefer UI Toolkit for new Editor tools** — Unity recommends UI Toolkit over IMGUI for new Editor extensions, though IMGUI is still fully supported.
- **GUIStyle states require a Background image before Text Color works** — a state with no background assigned will not apply its text color.

## Additional Resources
- [Unity Manual: IMGUI Overview](https://docs.unity3d.com/Manual/GUIScriptingGuide.html)
- [Unity Manual: IMGUI Basics](https://docs.unity3d.com/Manual/gui-Basics.html)
- [Unity Manual: IMGUI Controls](https://docs.unity3d.com/Manual/gui-Controls.html)
- [Unity Manual: IMGUI Layout Modes](https://docs.unity3d.com/Manual/gui-Layout.html)
- [Unity Manual: IMGUI Customization](https://docs.unity3d.com/Manual/gui-Customization.html)
- [Unity Manual: GUIStyle](https://docs.unity3d.com/Manual/class-GUIStyle.html)
- [Unity Manual: GUISkin](https://docs.unity3d.com/Manual/class-GUISkin.html)
- [Unity Manual: Extending the Editor](https://docs.unity3d.com/Manual/ExtendingTheEditor.html)
- [Unity Manual: Editor Windows](https://docs.unity3d.com/Manual/editor-EditorWindows.html)
- [Unity Manual: Custom Editors](https://docs.unity3d.com/Manual/editor-CustomEditors.html)
- [Unity Manual: Property Drawers](https://docs.unity3d.com/Manual/editor-PropertyDrawers.html)
- [Unity Manual: TreeView API](https://docs.unity3d.com/Manual/TreeViewAPI.html)
- [Scripting API: GUI](https://docs.unity3d.com/ScriptReference/GUI.html)
- [Scripting API: GUILayout](https://docs.unity3d.com/ScriptReference/GUILayout.html)
- [Scripting API: EditorWindow](https://docs.unity3d.com/ScriptReference/EditorWindow.html)
- [Scripting API: Editor](https://docs.unity3d.com/ScriptReference/Editor.html)
- [Scripting API: EditorGUI](https://docs.unity3d.com/ScriptReference/EditorGUI.html)
- [Scripting API: EditorGUILayout](https://docs.unity3d.com/ScriptReference/EditorGUILayout.html)
- [Scripting API: SerializedObject](https://docs.unity3d.com/ScriptReference/SerializedObject.html)
- [Scripting API: Undo](https://docs.unity3d.com/ScriptReference/Undo.html)
