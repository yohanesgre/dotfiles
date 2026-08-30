---
name: unity-input
description: Reading player input from keyboards, mice, gamepads, touchscreens, VR/AR controllers, and sensors. Covers the modern Input System Package (recommended) and the legacy Input Manager. Based on Unity 6.4 documentation.
---

# Unity Input Skill

Use this skill when working with input in Unity — reading player input from keyboards, mice, gamepads, touchscreens, VR/AR controllers, and sensors. Covers the modern Input System Package (recommended) and the legacy Input Manager.

---

## Overview

Unity supports input from many device types: keyboard, mouse, gamepad, touchscreen, joystick, accelerometer, gyroscope, VR/AR controllers, and more.

**Two input systems exist:**

| System | Status | Use Case |
|---|---|---|
| **Input System Package** | Recommended for all new projects | Modern, flexible, action-based, cross-platform |
| **Legacy Input Manager** | Legacy; not recommended for new projects | Maintaining older projects; quick prototyping |

**Input System Package** is installed via Package Manager (`com.unity.inputsystem`). It can optionally disable the legacy Input Manager during installation.

---

## Input System Package (Recommended)

### Core Concepts

```
User → Input Device → Control → Binding → Action → Your Code
```

| Concept | Description |
|---|---|
| **Device** | Physical hardware (keyboard, gamepad, mouse, touchscreen) |
| **Control** | Individual part of a device (button, stick, trigger, key) |
| **Action** | High-level intent ("Jump", "Move", "Fire") |
| **Action Map** | Group of Actions by context ("Player", "UI", "Vehicle") |
| **Binding** | Link between an Action and specific device controls |
| **Processor** | Modifies input values (deadzone, normalization) |
| **Interaction** | Defines how input triggers an action (tap, hold, press) |
| **Composite** | Combines multiple controls into one input (e.g., WASD) |

### Creating Actions

#### Method 1: Input Actions Editor (Recommended)

`Edit > Project Settings > Input System` or create a `.inputactions` asset.

Define Actions, Action Maps, and Bindings in a visual editor.

#### Method 2: Declare in MonoBehaviour

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

public class Player : MonoBehaviour
{
    public InputAction move;
    public InputAction jump;

    void OnEnable()
    {
        move.Enable();
        jump.Enable();
    }

    void OnDisable()
    {
        move.Disable();
        jump.Disable();
    }
}
```

#### Method 3: Create in Code

```csharp
// Free-standing action
var lookAction = new InputAction("look", binding: "<Gamepad>/leftStick");
lookAction.AddBinding("<Mouse>/delta");
lookAction.Enable();

// Composite binding (WASD)
var moveAction = new InputAction("move");
moveAction.AddCompositeBinding("Dpad")
    .With("Up", "<Keyboard>/w")
    .With("Down", "<Keyboard>/s")
    .With("Left", "<Keyboard>/a")
    .With("Right", "<Keyboard>/d");
moveAction.Enable();

// Action Map
var map = new InputActionMap("Gameplay");
var fire = map.AddAction("fire", binding: "<Mouse>/leftButton");
map.Enable();
```

#### Method 4: Load from JSON

```csharp
var asset = InputActionAsset.FromJson(jsonString);
asset.Enable();
```

### Reading Input Values

#### Polling (Update Loop)

```csharp
void Update()
{
    // Read Vector2 from action
    Vector2 move = moveAction.ReadValue<Vector2>();
    transform.Translate(new Vector3(move.x, 0, move.y) * speed * Time.deltaTime);

    // Read float (e.g., trigger)
    float throttle = throttleAction.ReadValue<float>();

    // Check if button is pressed
    bool isFiring = fireAction.IsPressed();
    bool fireStarted = fireAction.WasPressedThisFrame();
    bool fireEnded = fireAction.WasReleasedThisFrame();
}
```

#### Callbacks (Event-Driven)

```csharp
void OnEnable()
{
    fireAction.performed += OnFire;
    moveAction.performed += OnMove;
}

void OnDisable()
{
    fireAction.performed -= OnFire;
    moveAction.performed -= OnMove;
}

void OnFire(InputAction.CallbackContext context)
{
    // Action was performed
    Debug.Log("Fire!");
}

void OnMove(InputAction.CallbackContext context)
{
    Vector2 value = context.ReadValue<Vector2>();
    // Handle movement
}
```

**Callback phases:**
- `started` — Input crossed the threshold to start the action
- `performed` — Action was triggered (may fire multiple times for hold)
- `canceled` — Input fell back below threshold or was released

### PlayerInput Component

The easiest way to wire input to gameplay. Add to your player GameObject.

**Setup:**
1. Add `PlayerInput` component
2. Assign an Action Asset (`.inputactions`)
3. Choose a **Behavior** type
4. Implement callback methods matching action names

**Notification Behaviors:**

| Behavior | How It Works |
|---|---|
| **Send Messages** | Calls `OnActionName()` on the same GameObject via `SendMessage` |
| **Broadcast Messages** | Calls `OnActionName()` via `BroadcastMessage` (includes children) |
| **Invoke Unity Events** | Fires configurable `UnityEvent`s per action in the Inspector |
| **Invoke C# Events** | Plain C# events on the `PlayerInput` API |

**Send Messages example:**

```csharp
public class PlayerController : MonoBehaviour
{
    // Action "jump" → method "OnJump"
    public void OnJump()
    {
        // Jump!
    }

    // Action "move" → method "OnMove" with InputValue parameter
    public void OnMove(InputValue value)
    {
        Vector2 move = value.Get<Vector2>();
        // Move character
    }
}
```

**C# Events example:**

```csharp
void Start()
{
    var playerInput = GetComponent<PlayerInput>();
    playerInput.onActionTriggered += OnAction;
    playerInput.onDeviceLost += OnDeviceLost;
    playerInput.onDeviceRegained += OnDeviceRegained;
}

void OnAction(InputAction.CallbackContext context)
{
    Debug.Log($"Action: {context.action.name}");
}
```

**Switching Action Maps:**

```csharp
var playerInput = GetComponent<PlayerInput>();
playerInput.SwitchCurrentActionMap("UI");    // Switch to UI map
playerInput.SwitchCurrentActionMap("Player"); // Switch back to gameplay
playerInput.DeactivateInput();                // Disable all input
playerInput.ActivateInput();                  // Re-enable default map
```

### UI Input Integration

1. Add `InputSystemUIInputModule` to the EventSystem GameObject
2. Assign the same `InputActionAsset` used by PlayerInput
3. The UI and player share the same Action configuration
4. Use `MultiplayerEventSystem` for multiple UI instances in local multiplayer

### Project-Wide Actions

Designate one `.inputactions` asset as project-wide:
```csharp
// Access from anywhere
InputSystem.actions["Move"].ReadValue<Vector2>();
```

---

## Working with Devices

### Querying Devices

```csharp
// Get specific device
var gamepad = Gamepad.current;
var keyboard = Keyboard.current;
var mouse = Mouse.current;
var touchscreen = Touchscreen.current;

// Check if device is connected
if (Gamepad.current != null)
{
    // Gamepad is connected
}

// List all connected devices
foreach (var device in InputSystem.devices)
{
    Debug.Log($"Device: {device.name}");
}

// Listen for device changes
InputSystem.onDeviceChange += (device, change) =>
{
    if (change == InputDeviceChange.Added)
        Debug.Log($"Connected: {device.name}");
    if (change == InputDeviceChange.Removed)
        Debug.Log($"Disconnected: {device.name}");
};
```

### Gamepad

```csharp
var gamepad = Gamepad.current;
if (gamepad == null) return;

// Read sticks
Vector2 leftStick = gamepad.leftStick.ReadValue();
Vector2 rightStick = gamepad.rightStick.ReadValue();

// Read buttons
bool jump = gamepad.buttonSouth.isPressed;  // A / Cross
bool fire = gamepad.buttonWest.isPressed;     // X / Square
bool special = gamepad.buttonNorth.isPressed; // Y / Triangle
bool cancel = gamepad.buttonEast.isPressed;   // B / Circle

// Read triggers
float leftTrigger = gamepad.leftTrigger.ReadValue();
float rightTrigger = gamepad.rightTrigger.ReadValue();

// Read shoulders
bool leftShoulder = gamepad.leftShoulder.isPressed;

// Rumble / haptics
gamepad.SetMotorSpeeds(0.25f, 0.75f); // low freq, high freq
((IHaptics)gamepad).PauseHaptics();
((IHaptics)gamepad).ResumeHaptics();
```

**Button aliases (Xbox / PlayStation):**
```csharp
// These all access the same "north" face button:
gamepad.buttonNorth
gamepad[GamepadButton.Y]
gamepad["Y"]
gamepad[GamepadButton.Triangle]
gamepad["Triangle"]
```

**PlayStation-specific:**
```csharp
// Set light bar color
Gamepad.current.SetLightBarColor(Color.blue);

// Set rumble + light bar simultaneously
((DualShock4GamepadHID)Gamepad.current)
    .SetMotorSpeedsAndLightBarColor(0.5f, 0.8f, Color.red);
```

### Keyboard

```csharp
var keyboard = Keyboard.current;

// Check key state
bool isWPressed = keyboard.wKey.isPressed;
bool spaceDown = keyboard.spaceKey.wasPressedThisFrame;

// Read as button
keyboard.aKey.ReadValue(); // 0 or 1

// Modifier keys
bool shift = keyboard.leftShiftKey.isPressed || keyboard.rightShiftKey.isPressed;
bool ctrl = keyboard.leftCtrlKey.isPressed;
```

### Mouse

```csharp
var mouse = Mouse.current;

// Position
Vector2 pos = mouse.position.ReadValue();
Vector2 delta = mouse.delta.ReadValue();

// Buttons
bool leftClick = mouse.leftButton.isPressed;
bool rightClick = mouse.rightButton.isPressed;
bool middleClick = mouse.middleButton.isPressed;

// Scroll
Vector2 scroll = mouse.scroll.ReadValue();
```

### Touchscreen

**Use EnhancedTouch (recommended):**

```csharp
using UnityEngine.InputSystem.EnhancedTouch;

void Awake()
{
    EnhancedTouchSupport.Enable();
}

void Update()
{
    // Active touches (no GC allocation)
    foreach (var touch in Touch.activeTouches)
    {
        Debug.Log($"Touch {touch.touchId}: {touch.screenPosition}, phase: {touch.phase}");
    }

    // Active fingers
    foreach (var finger in Touch.activeFingers)
    {
        Debug.Log($"Finger: {finger.screenPosition}");
    }
}
```

**Touch phases:** `Began`, `Moved`, `Stationary`, `Ended`, `Cancelled`

**Touch simulation (Editor testing):**
```csharp
TouchSimulation.Enable();
```
Or add the `TouchSimulation` MonoBehaviour to a GameObject.

### Direct Device Polling (Quick Prototyping)

```csharp
// Bypass Actions — read device directly
var gamepad = Gamepad.current;
Vector2 move = gamepad.leftStick.ReadValue();

var keyboard = Keyboard.current;
if (keyboard.wKey.isPressed) move.y += 1;
```

**Note:** Less flexible — bypasses rebinding, cross-platform support, and Action features.

---

## Legacy Input Manager

**Status:** Not recommended for new projects. Use the Input System Package instead.

### Input Manager Settings

`Edit > Project Settings > Input Manager`

Configure virtual axes with properties:

| Property | Description |
|---|---|
| **Name** | Axis name for script access |
| **Negative/Positive Button** | Controls for each direction |
| **Alt Negative/Positive Button** | Alternative controls |
| **Gravity** | Speed axis falls to neutral (units/sec) |
| **Dead** | Deadzone for analog sticks |
| **Sensitivity** | Speed axis moves to target (units/sec) |
| **Snap** | Reset to zero when pressing opposite direction |
| **Type** | Key/Mouse Button, Mouse Movement, Joystick Axis |
| **Axis** | Which device axis to use |
| **JoyNum** | Which joystick (0 = all) |

### Scripting

```csharp
// Axis (returns -1 to 1)
float horizontal = Input.GetAxis("Horizontal");
float vertical = Input.GetAxis("Vertical");

// Button events
if (Input.GetButtonDown("Fire1")) { /* Pressed this frame */ }
if (Input.GetButton("Fire1"))     { /* Currently held */ }
if (Input.GetButtonUp("Fire1"))   { /* Released this frame */ }

// Key events
if (Input.GetKey("a"))          { /* Held */ }
if (Input.GetKeyDown(KeyCode.Space)) { /* Pressed this frame */ }
if (Input.GetKeyUp("return"))   { /* Released this frame */ }

// Mouse
if (Input.GetMouseButtonDown(0)) { /* Left click */ }
Vector3 mousePos = Input.mousePosition;
```

### Legacy Mobile Input

```csharp
// Multi-touch
foreach (Touch touch in Input.touches)
{
    if (touch.phase == TouchPhase.Began)
    {
        Ray ray = Camera.main.ScreenPointToRay(touch.position);
        if (Physics.Raycast(ray)) { /* Handle touch */ }
    }
}

// Accelerometer
Vector3 accel = Input.acceleration;
// X+ = right, Y+ = up, Z+ = toward user (device upright)

// Low-pass filter for accelerometer
Vector3 smoothAccel = Vector3.Lerp(prevAccel, Input.acceleration, 0.1f);
```

---

## Mobile Keyboard

`TouchScreenKeyboard` opens the on-screen keyboard on mobile platforms.

**Supported platforms:** iOS, Android, Windows Store Apps.

```csharp
if (TouchScreenKeyboard.isSupported)
{
    TouchScreenKeyboard keyboard = TouchScreenKeyboard.Open(
        text: "",
        keyboardType: TouchScreenKeyboardType.EmailAddress,
        autocorrection: false,
        multiline: false,
        secure: false,
        alert: false,
        textPlaceholder: "Enter email..."
    );

    // Check status
    if (keyboard.status == TouchScreenKeyboard.Status.Done)
    {
        string result = keyboard.text;
    }
}
```

**Keyboard types:** `Default`, `ASCIICapable`, `NumbersAndPunctuation`, `URL`, `NumberPad`, `PhonePad`, `NamePhonePad`, `EmailAddress`

**Properties:**
- `active` — Keyboard is activated
- `visible` — Keyboard is fully visible
- `area` — Screen rectangle occupied by keyboard
- `status` — `Visible`, `Done`, `Canceled`, `LostFocus`

**Hide text preview:** `TouchScreenKeyboard.hideInput = true;`

---

## Input Events (Advanced)

The Input System is event-driven internally. Events can be monitored or injected.

```csharp
// Listen to all events
InputSystem.onEvent += (eventPtr, device) =>
{
    Debug.Log($"Event on {device}");
};

// Queue state events (simulate input)
InputSystem.QueueStateEvent(Mouse.current,
    new MouseState { position = new Vector2(123, 234) });

// Record and replay
var trace = new InputEventTrace();
trace.Enable();
// ... capture input ...
trace.WriteTo("input.trace");
```

---

## Best Practices

1. **Use the Input System Package for all new projects.** It is more flexible, cross-platform, and actively supported.
2. **Use Actions, not direct device polling.** Actions abstract input intent from device specifics, enabling easy rebinding and cross-platform support.
3. **Enable/Disable Actions properly.** Enable in `OnEnable()`, disable in `OnDisable()` to prevent memory leaks and unexpected behavior.
4. **Use PlayerInput for quick setup.** It handles device assignment, action map switching, and multiplayer scenarios with minimal code.
5. **Switch Action Maps for context.** Use a "Player" map for gameplay, "UI" map for menus, "Vehicle" map for driving, etc.
6. **Cache action references.** Don't look up actions every frame — store references in `Start()` or `Awake()`.
7. **Use EnhancedTouch for touch input.** Avoid polling `Touchscreen.current` directly in `Update()` — it misses state changes.
8. **Handle device loss.** Listen to `onDeviceLost` / `onDeviceRegained` on `PlayerInput` for robust controller support.
9. **Test touch in Editor.** Use `TouchSimulation.Enable()` or the Input Debugger to simulate touch from mouse/pen.
10. **Use deadzones on sticks.** The Input System applies stick deadzones by default; customize via processors if needed.
11. **For legacy projects:** Cache `Input.GetAxis` results and avoid mixing legacy Input with Input System on the same project unless necessary.

---

## Key Classes Quick Reference

| Class | Purpose |
|---|---|
| `InputSystem` | Global Input System access |
| `InputAction` | Individual input action |
| `InputActionMap` | Collection of actions |
| `InputActionAsset` | Saved `.inputactions` asset |
| `PlayerInput` | Component for wiring actions to gameplay |
| `InputAction.CallbackContext` | Context passed to action callbacks |
| `Gamepad` | Gamepad device API |
| `Keyboard` | Keyboard device API |
| `Mouse` | Mouse device API |
| `Touchscreen` | Touchscreen device API |
| `EnhancedTouch.Touch` | High-level touch polling (no GC) |
| `TouchSimulation` | Simulate touch from mouse/pen |
| `InputEventTrace` | Record and replay input events |
| `TouchScreenKeyboard` | Mobile on-screen keyboard |

---

## Legacy Input Quick Reference

| Operation | Legacy Code |
|---|---|
| Axis | `Input.GetAxis("Horizontal")` |
| Button press | `Input.GetButtonDown("Fire1")` |
| Key press | `Input.GetKeyDown(KeyCode.Space)` |
| Mouse position | `Input.mousePosition` |
| Mouse button | `Input.GetMouseButtonDown(0)` |
| Touch | `Input.touches` |
| Accelerometer | `Input.acceleration` |

---

## Additional Resources

- **Package**: `com.unity.inputsystem` (via Package Manager)
- **Input System Docs**: `https://docs.unity3d.com/Packages/com.unity.inputsystem@latest`
- **Demo Project**: Warriors demo on GitHub
- **Video Series**: Unity Input System in Unity 6 (7-part series)
- **Legacy Input Docs**: `InputLegacy.html`
