---
name: unity-scripting-fundamentals
description: MonoBehaviour architecture, lifecycle, serialization, inspector attributes, script organization, and IDE setup. Based on Unity 6.4 documentation.
---

# Unity Scripting Fundamentals

## Description

Deep-dive reference for Unity's C# scripting fundamentals covering MonoBehaviour architecture, the complete lifecycle with execution ordering, serialization and inspector customization, all Unity C# attributes, script creation and naming conventions, folder structure, assembly definitions, and IDE setup. Based on Unity 6.4 (6000.4) documentation.

## When to Use

Load when writing or reviewing MonoBehaviour scripts, setting up a new Unity project's codebase, configuring the Inspector with attributes, organizing scripts into folders and assemblies, or setting up IDE tooling. Also load when making decisions about component initialization order, serialization patterns, or namespace strategy.

## What This Skill Does NOT Cover

- **ScriptableObjects** — see `unity-scripting` skill
- **Events & delegates** (UnityEvent, C# events, interface events) — see `unity-scripting` skill
- **Optimization** (object pooling, GC best practices, caching) — see `unity-scripting` skill
- **Testing** (Unity Test Framework, Edit/Play mode tests) — see `unity-scripting` skill
- **Debugging** (Debug.Log, Profiler, Frame Debugger) — see `unity-scripting` skill
- **Coroutines & async/await** — see `unity-scripting` skill
- **Job System & Burst** — see `unity-scripting` skill
- **Conditional compilation & platform directives** — see `unity-scripting` skill
- **Domain Reload & Enter Play Mode** — see `unity-scripting` skill

---

## 1. MonoBehaviour Architecture

### Component-Based Design

Unity uses a **component-based architecture**. GameObjects are entity containers that have no behavior on their own. All functionality comes from Components attached to them. MonoBehaviour is the base class from which every custom component derives.

```
GameObject
├── Transform (always present)
├── YourScript : MonoBehaviour  ← component you write
├── Rigidbody
├── Collider
├── Renderer
└── ...other components
```

Each component encapsulates both **logic** (methods) and **data** (fields) together. A single GameObject can have multiple components, and components of the same type are permitted unless `[DisallowMultipleComponent]` is used.

### Inheritance Chain

```
UnityEngine.Object
├── GameObject
├── Component
│   ├── MonoBehaviour        ← base for all your scripts
│   ├── Transform
│   ├── Rigidbody
│   ├── Collider
│   ├── Renderer
│   ├── Camera
│   └── ...all built-in components
├── ScriptableObject         ← data assets (not in this skill)
└── Other built-in types
```

**Key insight:** MonoBehaviour inherits from `Behaviour`, which inherits from `Component`, which inherits from `UnityEngine.Object`. This means all Monobehaviour scripts can be dragged onto GameObjects, referenced in Inspector fields, and benefit from Unity's native-managed bridge.

### Required Using Directives

```csharp
using UnityEngine;          // MonoBehaviour, Debug, Vector3, Transform, etc.
using System.Collections;   // IEnumerator for coroutines
using System.Collections.Generic; // List<T>, Dictionary<K,V> etc.
```

The minimal script template:

```csharp
using UnityEngine;
using System.Collections;

public class MyScript : MonoBehaviour
{
    // Use Awake for self-initialization
    void Awake()
    {
    }

    // Use Start for initialization that depends on other objects
    void Start()
    {
    }

    // Update is called once per frame
    void Update()
    {
    }
}
```

### Editor Scripts vs Runtime Scripts

Unity scripts run in two distinct contexts:

| Context | When | Purpose |
|---------|------|---------|
| **Runtime** | In Player builds | Gameplay logic |
| **Editor** | In Unity Editor only | Custom tools, inspectors, windows |

Exclude Editor scripts from builds in three ways:
1. Place them in a folder named `Editor` (anywhere under `Assets/`)
2. Use assembly definition files to create Editor-only assemblies
3. Use `#if UNITY_EDITOR` preprocessor directive

```csharp
#if UNITY_EDITOR
using UnityEditor;

[CustomEditor(typeof(MyScript))]
public class MyScriptEditor : Editor
{
    // Editor-only inspector customization
}
#endif
```

### Key Rules

1. **Class name must match file name.** Unity uses this to identify which class is the component.
2. **Never define constructors** on MonoBehaviour subclasses. Unity handles object construction — using constructors interferes with serialization and the native bridge. Use `Awake()` or `Start()` for initialization.
3. **Do not use `??` or `?.` operators** on UnityEngine.Object types — they bypass Unity's custom null-checking (see "UnityEngine.Object Custom Equality" below).

### UnityEngine.Object Custom Equality

Unity overrides `==` and `!=` for all UnityEngine.Object types. A destroyed GameObject returns `true` for `== null` even though the C# reference technically still exists (it's a "fake null" — the C++ native counterpart was destroyed while the managed wrapper survives).

- `myObj == null` — Checks if native object is alive (preferred for Unity objects)
- `ReferenceEquals(myObj, null)` — Checks actual C# null (bypasses Unity override)
- `(myObj as System.Object) == null` — Same as ReferenceEquals
- The custom equality operator is slower than standard C# equality — avoid in hot paths

---

## 2. Complete MonoBehaviour Lifecycle

### Execution Order Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      SCENE LOAD / PLAY MODE ENTER                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. OnEnable()                   Called for each object as it     │
│     └── (before Awake)           becomes enabled & active         │
│                                                                  │
│  2. Awake()                      ALL Awake calls complete before  │
│     └── (once per object)        ANY Start is called              │
│                                                                  │
│  3. SceneManager.sceneLoaded     Event fires after all Awake done │
│                                                                  │
│  4. Start()                      Called once before first frame   │
│     └── (after all Awake)        Only if script is enabled        │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                      PER-FRAME LOOP                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  5. FixedUpdate()                0, 1, or N times per frame       │
│     └── Fixed timestep           (Time.fixedDeltaTime interval)   │
│                                                                  │
│     Physics callbacks:                                           │
│     ├── OnCollisionEnter/Stay/Exit                               │
│     ├── OnTriggerEnter/Stay/Exit                                 │
│     └── Internal physics update                                  │
│                                                                  │
│     Coroutines resume:                                           │
│     └── WaitForFixedUpdate yield point                           │
│                                                                  │
│  6. Update()                     Once per frame                   │
│     └── Main game logic                                          │
│                                                                  │
│     Coroutines resume:                                           │
│     ├── yield return null                                        │
│     ├── WaitUntil / WaitWhile                                    │
│     └── WaitForSeconds (time-scaled)                             │
│                                                                  │
│  7. LateUpdate()                 Once per frame, after all Update │
│     └── Camera follow, post-frame adjustments                    │
│                                                                  │
│     Coroutines resume:                                           │
│     └── All remaining yield instructions complete                │
│                                                                  │
│  8. Rendering callbacks                                          │
│     ├── OnPreCull()              Before camera culling            │
│     ├── OnWillRenderObject()     Per-camera, per-object           │
│     ├── OnPreRender()            Before camera renders scene      │
│     ├── OnRenderObject()         During scene rendering           │
│     ├── OnPostRender()           After camera finishes rendering  │
│     └── OnRenderImage()          After scene, for post-processing │
│                                                                  │
│     Coroutines resume:                                           │
│     └── WaitForEndOfFrame yield point                            │
│                                                                  │
│  9. OnGUI()                      Multiple times per frame         │
│     └── Legacy IMGUI (deprecated)                                │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                 DISABLE / DESTROY / SCENE UNLOAD                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  10. OnDisable()                 When object disabled or inactive │
│                                                                  │
│  11. OnDestroy()                 When object destroyed or scene   │
│      └──                         unloaded                         │
│                                                                  │
│  12. SceneManager.sceneUnloaded  Event fires on scene unload     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Detailed Event Functions

#### Initialization Events

| Method | When Called | Use Case |
|--------|-------------|----------|
| `Awake()` | Once per script instance, when the object is loaded. ALL Awake calls finish before ANY Start. | Self-initialization: caching GetComponent references, setting up internal state. Do NOT depend on other objects being initialized here. |
| `OnEnable()` | Each time the object becomes enabled and active. Called before Awake on first creation; called again after each disable/re-enable cycle. | Subscribing to events, input system, enabling systems. Always paired with OnDisable. |
| `Start()` | Once before the first frame/physics update, only if the script is enabled. All Awake calls across all objects have completed. | Initialization that depends on other objects' Awake having finished. Finding references to other GameObjects. |
| `OnDisable()` | When the object becomes disabled or inactive (GameObject.SetActive(false), component.enabled=false, scene unload, or exiting Play mode). | Unsubscribing from events, disabling input, pausing coroutines. |
| `OnDestroy()` | When the object is destroyed (Destroy(), scene unload, or exiting Play mode). | Final cleanup. Release unmanaged resources. |

**Critical detail:** `OnEnable` is called **before** `Awake` when a prefab is first instantiated. The order is: `OnEnable` → `Awake` → `OnEnable` (if re-enabled later, no Awake).

#### Per-Frame Update Events

| Method | Frequency | Delta Time | Use Case |
|--------|-----------|------------|----------|
| `FixedUpdate()` | Fixed timestep (`Time.fixedDeltaTime`, default 0.02s = 50 Hz). May run 0, 1, or N times per frame. | `Time.fixedDeltaTime` | Physics manipulation (Rigidbody forces, velocity). Anything deterministic. |
| `Update()` | Once per frame. Frequency varies with framerate. | `Time.deltaTime` | Input handling, game logic, non-physics movement. |
| `LateUpdate()` | Once per frame, after all Update() calls complete. | `Time.deltaTime` | Camera following, external object tracking, procedural animation that depends on other objects' Update results. |

**Why LateUpdate for cameras:** If both the player and camera run in `Update`, the camera may execute before the player has finished moving, causing jitter. Using `LateUpdate` guarantees the camera reads the player's final position for the frame.

#### Rendering Events

| Method | When | Requirements |
|--------|------|-------------|
| `OnPreCull()` | Before camera performs culling | Must be attached to the Camera GameObject |
| `OnWillRenderObject()` | Per-camera if the object is visible | Called per camera for each visible object |
| `OnPreRender()` | Before camera renders the scene | Must be on Camera GameObject |
| `OnRenderObject()` | After regular scene rendering | Called for all active cameras |
| `OnPostRender()` | After camera finishes rendering | Must be on Camera GameObject |
| `OnRenderImage()` | After scene rendering, for post-processing | Script must be on Camera with the `OnRenderImage` method |

#### Physics/Collision Events

Physics callbacks occur **during the physics step**, after `FixedUpdate()`. Both participants must have the appropriate components (Collider + Rigidbody for collisions; at least one Rigidbody for triggers).

**Collision callbacks** (require non-trigger colliders):

| Method | Signature | When |
|--------|-----------|------|
| `OnCollisionEnter(Collision collision)` | Receives collision data (contacts, impulse, relative velocity) | First frame of contact |
| `OnCollisionStay(Collision collision)` | Same | Every physics step while in contact |
| `OnCollisionExit(Collision collision)` | Same | Frame contact ends |

**Trigger callbacks** (require at least one collider marked as trigger):

| Method | Signature | When |
|--------|-----------|------|
| `OnTriggerEnter(Collider other)` | Receives the other collider | Object enters trigger |
| `OnTriggerStay(Collider other)` | Same | Every physics step while in trigger |
| `OnTriggerExit(Collider other)` | Same | Object exits trigger |

**2D variants** append `2D`: `OnCollisionEnter2D(Collision2D)`, `OnTriggerEnter2D(Collider2D)`, etc.

**Requirements for physics callbacks:**
- Both participants must have Collider components
- At least one must have a Rigidbody (or Rigidbody2D for 2D)
- For trigger callbacks, at least one collider must have `IsTrigger = true`
- Kinematic rigidbodies also fire collision events (but not trigger events unless they have a non-kinematic counterpart)

#### GUI Events (Legacy)

| Method | When |
|--------|------|
| `OnGUI()` | Called multiple times per frame for IMGUI rendering and events. Legacy system — use UI Toolkit or UGUI for new projects. |
| `OnDrawGizmos()` | Called in Scene view for debug visualization (not a lifecycle event per se, but Editor-only) |
| `OnDrawGizmosSelected()` | Called in Scene view when the object is selected |

#### Reset

| Method | When |
|--------|------|
| `Reset()` | Called in the Editor when the component is first added or when the user clicks "Reset" in the Inspector context menu. Used to set default field values. |

```csharp
public class Enemy : MonoBehaviour
{
    public float health = 100f;
    public float speed = 5f;

    void Reset()
    {
        health = 100f;
        speed = 5f;
    }
}
```

### Coroutine Timing Points

Coroutines resume at specific points in the frame depending on the yield instruction:

| Yield Instruction | Resumes At |
|-------------------|------------|
| `yield return null` | Next frame, after `Update()`, before rendering |
| `yield return new WaitForSeconds(n)` | After `n` seconds of **scaled** time (affected by `Time.timeScale`) |
| `yield return new WaitForSecondsRealtime(n)` | After `n` seconds of **real** time (unaffected by `Time.timeScale`) |
| `yield return new WaitForFixedUpdate()` | After the next `FixedUpdate()` |
| `yield return new WaitForEndOfFrame()` | End of frame, after rendering, before `OnGUI()` |
| `yield return new WaitUntil(predicate)` | Every frame until predicate returns true — equivalent to yielding null in a loop with a condition check |
| `yield return new WaitWhile(predicate)` | Every frame while predicate returns true |
| `yield return StartCoroutine(Other())` | Waits for the nested coroutine to complete |
| `yield return anotherYieldInstruction` | Custom yield instruction |

### Script Execution Order

By default, Unity calls event functions in **arbitrary order** across different MonoBehaviour instances, meaning you cannot rely on the order of `Awake`, `Start`, or `Update` between different scripts.

**To configure ordering:**

1. **Edit > Project Settings > Script Execution Order**
2. Click the **+** button to add scripts
3. Set a numeric value — lower numbers execute first
4. You can view/edit individual script assets: select the script, click **Execution Order** in the Inspector

**Default order numbers:**
- Default: 0
- Standard Assets/Pro Standard Assets/Plugins: 1000
- Editor-only scripts: typically default-late (higher numbers)

### OnEnable/OnDisable Patterns

```csharp
public class HealthComponent : MonoBehaviour
{
    [SerializeField] private int maxHealth = 100;
    private int currentHealth;

    void OnEnable()
    {
        currentHealth = maxHealth;        // Reset on enable
        EventBus.OnDamage += TakeDamage;  // Subscribe
    }

    void OnDisable()
    {
        EventBus.OnDamage -= TakeDamage;  // ALWAYS unsubscribe
    }

    void TakeDamage(int amount)
    {
        currentHealth -= amount;
        if (currentHealth <= 0)
            Destroy(gameObject);
    }
}
```

**Why subscribe in OnEnable and unsubscribe in OnDisable:** This is the canonical pattern for event-driven code. If a component subscribes in `Awake`/`Start` but only unsubscribes in `OnDestroy`, it will leak subscriptions when disabled and re-enabled (receiving duplicate calls). Similarly, if a component subscribes in `Awake`/`Start` and the object gets destroyed without cleanup, the event bus holds a reference to a destroyed object (fake null, but still in the delegate list).

---

## 3. Serialization & Inspector

### Inspector Exposure Rules

Unity serializes fields (not properties) and displays them in the Inspector based on these rules:

| Declaration | Inspector Visible? | Serialized? |
|-------------|-------------------|-------------|
| `public int x;` | Yes | Yes |
| `private int x;` | No | No |
| `protected int x;` | No | No |
| `internal int x;` | No | No |
| `[SerializeField] private int x;` | Yes (forced) | Yes |
| `[SerializeField] protected int x;` | Yes (forced) | Yes |
| `[HideInInspector] public int x;` | No (forced) | Yes |
| `[System.NonSerialized] public int x;` | Yes | No |
| `public int x { get; set; }` | No | No (properties never serialized) |
| `public static int x;` | No | No (statics never serialized) |

### Serializable Types

Unity can serialize the following types:

**Primitive/value types:** `bool`, `int`, `float`, `double`, `long`, `short`, `byte`, `char`, `string`, `Enum`

**Unity structs:** `Vector2`, `Vector3`, `Vector4`, `Vector2Int`, `Vector3Int`, `Quaternion`, `Color`, `Color32`, `Rect`, `RectInt`, `Bounds`, `BoundsInt`, `LayerMask`, `AnimationCurve`, `Gradient`, `GUID`, `Hash128`

**Unity object references:** Any type inheriting from `UnityEngine.Object` — `GameObject`, `Transform`, `Material`, `Mesh`, `Texture`, `Sprite`, `AudioClip`, `ScriptableObject`, `MonoBehaviour` components, `Scene`, etc.

**Collections:** Arrays and `List<T>` of serializable types. Note: `Dictionary<K,V>` is NOT natively serialized.

**Custom classes/structs:** Must be marked with `[System.Serializable]`:
```csharp
[System.Serializable]
public class WeaponStats
{
    public string name;
    public int damage;
    public float fireRate;
    public GameObject projectilePrefab;
}
```

### Object Reference Fields

Any field whose type derives from `UnityEngine.Object` can be assigned by drag-and-drop in the Inspector:

```csharp
public class FollowTarget : MonoBehaviour
{
    public Transform target;           // Drag any GameObject here
    public GameObject playerPrefab;    // Drag prefab asset
    public Material playerMaterial;    // Drag material asset
    public AudioClip footstepSound;    // Drag audio clip
    public AudioClip[] damageSounds;   // Array — drag multiple clips
    public List<GameObject> enemies;   // List — drag multiple GameObjects
}
```

### Default Object References

You can set default values on Unity Object fields by assigning them **on the script asset itself** (not individual instances). Select the script asset in the Project window, set field values in the Inspector, and those defaults will be applied whenever the component is added to a GameObject or reset.

### Field Name to Label Conversion

Unity auto-converts field names to Inspector labels using these rules:

| C# Field Name | Inspector Label | Rule Applied |
|---------------|-----------------|--------------|
| `playerSpeed` | `Player Speed` | Capitalize first letter + space before each uppercase |
| `_health` | `Health` | Remove leading `_` |
| `m_speed` | ` Speed` | Remove `m` prefix (keeps `_`) — then remove `_` → `Speed` |
| `IsAlive` | `Is Alive` | Space before uppercase (except first character) |

Note: `m_` prefix and `_` prefix are stripped independently, so `m_health` becomes `Health`.

### Custom Inspectors (Basics)

Custom inspectors let you override how a component's fields are drawn. Create an Editor script in an `Editor/` folder:

```csharp
using UnityEditor;
using UnityEngine;

[CustomEditor(typeof(Enemy))]
public class EnemyEditor : Editor
{
    public override void OnInspectorGUI()
    {
        // Draw default inspector first
        DrawDefaultInspector();

        // Get reference to the target
        Enemy enemy = (Enemy)target;

        // Add custom GUI
        EditorGUILayout.Space();
        EditorGUILayout.LabelField("Status", EditorStyles.boldLabel);
        EditorGUILayout.LabelField("Current Health", enemy.CurrentHealth.ToString());

        // Add a button
        if (GUILayout.Button("Reset to Defaults"))
        {
            enemy.ResetToDefaults();
            EditorUtility.SetDirty(enemy);
        }
    }
}
```

Key APIs for custom inspectors:
- `EditorGUILayout` — Layout-based controls (auto-arranged)
- `EditorGUI` — Fixed-rect controls (manual positioning)
- `CustomEditor(typeof(T))` — Tells Unity which component this Editor customizes
- `target` — The object being inspected (cast to your type)
- `serializedObject` — For working with serialized properties (supports undo, multi-edit)
- `DrawDefaultInspector()` — Draws the standard field list

**SerializedProperty approach** (supports undo, prefab overrides, multi-object editing):
```csharp
[CustomEditor(typeof(Enemy))]
public class EnemyEditor : Editor
{
    SerializedProperty healthProp;
    SerializedProperty speedProp;

    void OnEnable()
    {
        healthProp = serializedObject.FindProperty("health");
        speedProp = serializedObject.FindProperty("speed");
    }

    public override void OnInspectorGUI()
    {
        serializedObject.Update();

        EditorGUILayout.PropertyField(healthProp);
        EditorGUILayout.PropertyField(speedProp);

        serializedObject.ApplyModifiedProperties();
    }
}
```

---

## 4. Unity Attributes

### Inspector Display Attributes

| Attribute | Applies To | Effect |
|-----------|-----------|--------|
| `[SerializeField]` | Fields | Force a private/protected field to display and serialize in the Inspector |
| `[HideInInspector]` | Fields | Hide a public field from the Inspector (still serialized) |
| `[Range(min, max)]` | float, int fields | Display a slider constrained between min and max |
| `[Min(value)]` | float, int fields | Display a number field with a minimum value constraint |
| `[Header("text")]` | Fields | Add a bold header label above subsequent fields in the Inspector |
| `[Space(pixels)]` | Fields | Add vertical space (in pixels) between fields |
| `[Tooltip("text")]` | Fields | Show a tooltip when hovering over the field name |
| `[Multiline(lines)]` | string fields | Multi-line text input area with a fixed number of visible lines |
| `[TextArea(minLines, maxLines)]` | string fields | Resizable text area that expands between min and max visible lines |
| `[ColorUsage(showAlpha, hdr)]` | Color fields | Controls whether the color picker shows alpha and HDR options |
| `[Delayed]` | string, float, int fields | Delay applying the value until the user presses Enter or clicks away |
| `[GradientUsage(hdr)]` | Gradient fields | Controls whether the gradient supports HDR colors |
| `[InspectorName("Custom Name")]` | Fields | Override the displayed name for an enum value in the Inspector |
| `[NonReorderable]` | Array/List fields | Prevent the user from reordering array elements in the Inspector |

### Component Attributes

| Attribute | Applies To | Effect |
|-----------|-----------|--------|
| `[RequireComponent(typeof(Component))]` | Class | When the script is added to a GameObject, automatically add the specified component(s) if not already present. Prevent removal of required components. |
| `[RequireComponent(typeof(A), typeof(B))]` | Class | Require multiple components simultaneously |
| `[DisallowMultipleComponent]` | Class | Prevent more than one instance of this script on the same GameObject |
| `[ExecuteInEditMode]` | Class | Run the script (Awake, Start, Update, OnGUI) in Edit mode, not only Play mode. **Deprecated** — use `[ExecuteAlways]` instead. |
| `[ExecuteAlways]` | Class | Run the script in both Edit mode and Play mode. Replaces `ExecuteInEditMode`. |
| `[AddComponentMenu("Path/Name")]` | Class | Add the script to the Component menu at a custom path (e.g., `"Gameplay/Enemy Controller"`) |
| `[SelectionBase]` | Class | When clicking a child object in the Scene view, Unity selects this GameObject instead (useful for prefab roots) |
| `[HelpURL("https://url")]` | Class | Set a custom documentation URL for the component's help button (the `?` book icon in the Inspector header) |
| `[Icon("icon-name")]` | Class | Set a custom icon for the GameObject in the Hierarchy. Built-in icons: `"d_GameObject Icon"`, `"d_light Icon"`, `"d_Camera Icon"`, etc. Can also reference custom icons by name. |
| `[DefaultExecutionOrder(order)]` | Class | Set the default script execution order value for this script |

### Method Attributes

| Attribute | Applies To | Effect |
|-----------|-----------|--------|
| `[ContextMenu("Label")]` | Non-static, void methods | Add a right-click menu item to the component's context menu (gear icon or right-click header) that invokes the method |
| `[ContextMenuItem("Label", "MethodName")]` | Fields | Add a right-click menu item on a specific field in the Inspector. The method must be non-static, void, and accept no parameters. |

```csharp
public class Player : MonoBehaviour
{
    [ContextMenuItem("Randomize", "RandomizeHealth")]
    public int health;

    void RandomizeHealth()
    {
        health = Random.Range(1, 100);
    }

    [ContextMenu("Reset All")]
    void ResetAll()
    {
        health = 100;
    }
}
```

### System/Serialization Attributes

| Attribute | Applies To | Effect |
|-----------|-----------|--------|
| `[System.Serializable]` | Non-UnityObject classes/structs | Make a custom class or struct serializable and visible in the Inspector when used as a field |
| `[System.NonSerialized]` | Fields | Prevent a public field from being serialized (still visible but always default value in Play mode) |
| `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType)]` | Static methods | Call a static method automatically at a specific point during runtime startup |
| `[BeforeRenderOrder]` | Methods | Define callback order when multiple scripts use `OnPreRender`/`OnPostRender` |

**RuntimeInitializeLoadType enum values:**
- `SubsystemRegistration` — First callback, before domain reload systems
- `AfterAssembliesLoaded` — After all assemblies finish loading
- `BeforeSplashScreen` — Before the splash screen displays
- `BeforeSceneLoad` — Before the first scene loads
- `AfterSceneLoad` — After the first scene loads (default if not specified)

```csharp
public class AppBootstrapper
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void OnAppStart()
    {
        Debug.Log("All scenes loaded, initialize services here");
    }
}
```

### Complete Attribute Usage Example

```csharp
using UnityEngine;

[SelectionBase]
[RequireComponent(typeof(Rigidbody), typeof(Collider))]
[DisallowMultipleComponent]
[ExecuteAlways]
[HelpURL("https://docs.mycompany.com/enemy")]
[AddComponentMenu("Gameplay/Enemy Controller")]
[DefaultExecutionOrder(-50)]
public class Enemy : MonoBehaviour
{
    [Header("Identity")]
    [Tooltip("Display name shown in UI")]
    public string enemyName;

    [Header("Stats")]
    [SerializeField, Range(0, 1000)]
    [Tooltip("Maximum health points")]
    private int maxHealth = 100;

    [Min(0)]
    [Tooltip("Current health — 0 = dead")]
    public int currentHealth = 100;

    [Range(0.1f, 20f)]
    [Tooltip("Movement speed in units per second")]
    public float moveSpeed = 3f;

    [Header("Damage")]
    [ColorUsage(false, true)]
    public Color damageFlashColor = Color.red;

    [Header("Description")]
    [Space(10)]
    [Multiline(4)]
    [Tooltip("Design notes — not used at runtime")]
    public string designerNotes;

    [Header("Attack")]
    [ContextMenuItem("Deal Half Damage", "DealHalfDamage")]
    public int attackDamage = 10;

    void DealHalfDamage()
    {
        attackDamage /= 2;
    }

    [ContextMenu("Reset to Defaults")]
    void ResetToDefaults()
    {
        maxHealth = 100;
        currentHealth = 100;
        moveSpeed = 3f;
        attackDamage = 10;
    }

    void Reset()
    {
        ResetToDefaults();
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    static void PreloadAssets()
    {
        // Preload enemy resources before the scene loads
    }
}
```

---

## 5. Script Creation & Organization

### Creating Scripts

**Method 1 — Main menu:**
`Assets > Create > Scripting > MonoBehaviour Script` (or ScriptableObject Script)

**Method 2 — Project window:**
Click the **+** button (Create menu) > **Scripting** > select script type

The `.cs` file is created in the currently selected folder and immediately opens for renaming. **Name the file before pressing Enter** — the class name inside must match the file name.

**Script types available:**
- **MonoBehaviour Script** — For components attached to GameObjects
- **ScriptableObject Script** — For standalone data assets (not in this skill)

### Naming Conventions

1. **File name must exactly match the class name** for MonoBehaviour scripts. If `PlayerController.cs` contains `public class PlayerController : MonoBehaviour`, Unity can add it to GameObjects. If the names don't match, Unity cannot use it as a component.

2. **Multiple classes in one file:** If a `.cs` file contains multiple classes, only the class whose name matches the file name can be used as a component. Other classes are valid helper classes but cannot be added to GameObjects.

3. **Partial classes:** If using the `partial` keyword, only the file with the matching name can provide component functionality. Other partial files are for organization only.

4. **Naming style (convention):**
   - PascalCase for class names: `PlayerController`, `EnemySpawner`
   - PascalCase for methods: `TakeDamage()`, `OnTriggerEnter()`
   - camelCase for private fields: `moveSpeed`, `currentHealth`
   - Private serialized fields often use `_` prefix or `m_` prefix (Unity strips these from Inspector labels)

### Namespaces

Use namespaces to prevent naming conflicts when multiple classes share the same name:

```csharp
// Enemy/EnemyController.cs
namespace Enemy
{
    public class EnemyController : MonoBehaviour
    {
        public void Attack() { Debug.Log("Enemy attacks"); }
    }
}

// Player/EnemyController.cs
namespace Player
{
    public class EnemyController : MonoBehaviour
    {
        public void Track() { Debug.Log("Player tracks enemy"); }
    }
}
```

**Using namespaced classes:**

```csharp
using Enemy; // Now "EnemyController" resolves to Enemy.EnemyController

public class GameManager : MonoBehaviour
{
    EnemyController enemyController; // Enemy namespace
    Player.EnemyController tracker;  // Fully qualified to disambiguate
}
```

**Critical limitation:** A `.cs` file containing a MonoBehaviour or ScriptableObject class **cannot contain multiple namespaces**. You cannot define another class in a different namespace within the same file. This is a deliberate Unity constraint to keep the component-to-file mapping clean.

```csharp
// INVALID — will generate a warning/error:
namespace MyGame
{
    public class Player : MonoBehaviour { }
}

namespace MyGame.Editor   // NOT ALLOWED in the same file as above
{
    public class PlayerEditor { }
}
```

**Solution:** Use separate files, or place Editor classes in an `Editor/` folder.

### Folder Structure

Unity reserves meaning for certain folder names:

| Folder | Purpose |
|--------|---------|
| `Assets/` | Root of all assets. Everything here is part of the project. |
| `Assets/Editor/` | Scripts here compile into an Editor-only assembly, **automatically excluded from Player builds**. Place custom inspectors, Editor windows, and utilities here. Can appear at any depth (e.g., `Assets/Scripts/Editor/`). |
| `Assets/Plugins/` | Precompiled managed assemblies (`.dll` files) go here. Scripts inside `Plugins/` are compiled before other scripts. |
| `Assets/Plugins/Editor/` | Editor-only plugin code. |
| `Assets/Plugins/[Platform]/` | Platform-specific native plugins (`.dll` for Windows, `.bundle` for macOS, `.so` for Linux, `.a` for iOS, etc.). Subfolders: `iOS/`, `Android/`, `WSA/`, `x86/`, `x86_64/`, etc. |
| `Assets/Resources/` | Assets here can be loaded with `Resources.Load()` at runtime. Use sparingly — most assets should be referenced directly. |
| `Assets/StreamingAssets/` | Files placed here are copied to the build as-is (unprocessed). Access via `Application.streamingAssetsPath`. |
| `Assets/Standard Assets/` | Legacy — compiled early in the compilation order. |
| `Assets/Pro Standard Assets/` | Legacy — compiled after Standard Assets. |
| `Assets/Gizmos/` | Icons and textures used by `Gizmos.DrawIcon()` and `OnDrawGizmos()`. |

**Conventional project structure (recommended, not enforced):**
```
Assets/
├── Animations/
├── Audio/
├── Materials/
├── Models/
├── Prefabs/
├── Scenes/
├── Scripts/
│   ├── Core/            ← essential systems, bootstrappers
│   ├── Gameplay/        ← game mechanics
│   │   ├── Player/
│   │   ├── Enemy/
│   │   └── Pickups/
│   ├── UI/
│   ├── Editor/          ← custom inspectors, Editor tools
│   └── Utilities/       ← extension methods, helpers
├── ScriptableObjects/   ← data assets
├── Sprites/
├── Textures/
└── ThirdParty/          ← external libraries, assets
```

### Assembly Definitions (asmdef)

Assembly Definition files (`.asmdef`) let you partition your code into separate assemblies instead of having everything in one giant `Assembly-CSharp`. This provides:

- **Faster iteration:** Changing one script only recompiles its assembly, not the entire project
- **Dependency management:** Explicit control over which assemblies reference which others
- **Enforced layering:** Gameplay code can't accidentally reference Editor code

**Creating an asmdef:**
1. Right-click in Project window > **Create > Assembly Definition**
2. Name the file (becomes the assembly name)
3. All `.cs` files in the same folder and its subfolders belong to this assembly
4. Subfolders with their own `.asmdef` create separate, independent assemblies

**Creating an Assembly Definition Reference (asmref):**
Use an `.asmref` file to include a folder in an assembly defined by an `.asmdef` elsewhere, without creating a new assembly. This is for when you have a one-off script that belongs to an existing assembly but sits in a different folder structure.

**asmdef JSON configuration:**

```json
{
    "name": "MyGame.Core",
    "rootNamespace": "MyGame.Core",
    "references": [
        "GUID:a1b2c3d4e5f6...",  // Reference another asmdef by GUID
        "UnityEngine.UI"            // Reference Unity module by name
    ],
    "includePlatforms": [],
    "excludePlatforms": [],
    "allowUnsafeCode": false,
    "overrideReferences": false,
    "precompiledReferences": [],
    "autoReferenced": true,
    "defineConstraints": [],
    "versionDefines": [],
    "noEngineReferences": false
}
```

**Key properties:**

| Property | Description |
|----------|-------------|
| `name` | Assembly name (also the filename without `.asmdef`) |
| `rootNamespace` | Base namespace automatically applied to all scripts in this assembly |
| `references` | GUIDs of other asmdef assets or Unity module names this assembly depends on |
| `includePlatforms` | Restrict compilation to specific platforms (empty = all) |
| `excludePlatforms` | Exclude from specific platforms |
| `allowUnsafeCode` | Allow `unsafe` C# code blocks |
| `overrideReferences` | Override automatic engine module references for precise control |
| `autoReferenced` | Whether other assemblies automatically reference this one (set to `false` for internal assemblies) |
| `defineConstraints` | Scripting define symbols that must be present for this assembly to compile |
| `noEngineReferences` | If `true`, no UnityEngine modules are auto-referenced — you must add them manually |

**Default compilation order (no asmdef files):**
1. `Assembly-CSharp-firstpass` — Runtime scripts in `Assets/Standard Assets/`, `Assets/Pro Standard Assets/`, `Assets/Plugins/`
2. `Assembly-CSharp` — Runtime scripts in `Assets/` (not in above folders)
3. `Assembly-CSharp-Editor-firstpass` — Editor scripts in `Assets/Plugins/Editor/`
4. `Assembly-CSharp-Editor` — Editor scripts in `Assets/Editor/`

With asmdef files, each defines its own compilation unit and dependencies determine compilation order.

---

## 6. IDE Setup

### Overview

Unity supports three main IDEs. The setup process is:

1. Install the IDE + required extensions/plugins
2. Install the corresponding Unity package via Package Manager
3. Set the IDE as the External Script Editor in Unity Preferences

### Visual Studio (Windows — default, macOS — supported)

**Requirements:**
- Visual Studio 2022 (Community, Professional, or Enterprise)
- **Visual Studio Tools for Unity** (VSTU) — included with the Game Development with Unity workload during VS installation
- Unity Package: **Visual Studio Editor** (`com.unity.ide.visualstudio`) — pre-installed by default in most Unity versions

**Features:** Full debugging (breakpoints, watch, locals), IntelliSense/code completion, code analysis, Unity-specific project types.

**Debugger setup:**
1. Set **Code Optimization Mode** to **Debug** (status bar bug icon, bottom-right)
2. In Visual Studio: **Attach to Unity** or press **Attach to Unity and Play**

### Visual Studio Code (Windows, macOS, Linux — default for macOS)

**Requirements:**
- VS Code
- Extensions:
  - **C#** (Microsoft)
  - **C# Dev Kit** (Microsoft) — or the older C# extension
- Unity Package: **Visual Studio Editor** (`com.unity.ide.visualstudio`) version 2.0.20+

**Important:** The old `com.unity.ide.vscode` package is deprecated. Unity moved VS Code support into the `com.unity.ide.visualstudio` package starting from version 2.0.20.

**Features:** IntelliSense via OmniSharp, debugging via C# Dev Kit, Unity-specific project file generation.

**Setup steps:**
1. Install the C# Dev Kit extension in VS Code
2. In Unity: **Window > Package Manager** → ensure `Visual Studio Editor` package is installed (2.0.20+)
3. **Edit > Preferences > External Tools > External Script Editor** → select Visual Studio Code
4. Check **"Generate .csproj files for"** option is enabled
5. Click **Regenerate project files**

### JetBrains Rider (Windows, macOS, Linux)

**Requirements:**
- JetBrains Rider
- Unity Package: **JetBrains Rider Editor** (`com.unity.ide.rider`)

**Features:** Full debugging, deep Unity integration, code inspections, performance analysis, refactoring tools, Unity Explorer view.

**Setup steps:**
1. Install Rider
2. In Unity: **Window > Package Manager** → install `JetBrains Rider Editor` (or use **Assets > Install Rider Plugin** from Rider's Unity menu)
3. **Edit > Preferences > External Tools > External Script Editor** → select Rider
4. Click **Regenerate project files**

### Global IDE Configuration

Set via: **Edit > Preferences > External Tools** (Windows/Linux) or **Unity > Settings > External Tools** (macOS)

| Setting | Description |
|---------|-------------|
| **External Script Editor** | Select your IDE from the dropdown or browse to an executable |
| **External Script Editor Args** | Additional command-line arguments to pass to the IDE |
| **Generate .csproj files for** | Which project types get `.csproj` files: Embedded packages, Local packages, Registry packages, Built-in packages (controls what IntelliSense sees) |
| **Editor Attaching** | Enable/disable Editor attaching for debugging |
| **Player projects** | Options for generating player-specific project files |

**Troubleshooting basic steps:**
1. In the IDE, ensure the project opens as a **solution** (not individual files)
2. In Unity, click **Assets > Open C# Project** to regenerate project files
3. If IntelliSense is missing Unity APIs: open Player Settings, ensure **API Compatibility Level** is correct, then **Regenerate project files**
4. If debugging won't attach: verify **Code Optimization Mode** is set to **Debug**

---

## Code Patterns

### Pattern 1: Complete MonoBehaviour Component

This template shows proper lifecycle usage, attribute decoration, and responsible cleanup:

```csharp
using UnityEngine;

public class Player : MonoBehaviour
{
    [Header("References")]
    [SerializeField] private Rigidbody rb;
    [SerializeField] private Animator anim;
    [SerializeField] private Transform groundCheck;

    [Header("Movement")]
    [SerializeField, Range(1f, 20f)]
    private float moveSpeed = 5f;
    [SerializeField, Range(1f, 30f)]
    private float jumpForce = 10f;

    [Header("Ground")]
    [SerializeField] private LayerMask groundMask;
    [SerializeField, Range(0.1f, 1f)]
    private float groundCheckRadius = 0.3f;

    private Vector3 inputDirection;
    private bool isGrounded;

    void OnEnable()
    {
        inputDirection = Vector3.zero;
    }

    void OnDisable()
    {
        rb.linearVelocity = Vector3.zero;
    }

    void Update()
    {
        inputDirection = new Vector3(
            Input.GetAxis("Horizontal"), 0f, Input.GetAxis("Vertical"));
        inputDirection = Vector3.ClampMagnitude(inputDirection, 1f);

        if (isGrounded && Input.GetButtonDown("Jump"))
            rb.AddForce(Vector3.up * jumpForce, ForceMode.VelocityChange);
    }

    void FixedUpdate()
    {
        Vector3 velocity = inputDirection * moveSpeed;
        velocity.y = rb.linearVelocity.y;
        rb.linearVelocity = velocity;

        isGrounded = Physics.CheckSphere(
            groundCheck.position, groundCheckRadius, groundMask);
    }

    void OnDrawGizmosSelected()
    {
        if (groundCheck != null)
        {
            Gizmos.color = isGrounded ? Color.green : Color.red;
            Gizmos.DrawWireSphere(groundCheck.position, groundCheckRadius);
        }
    }
}
```

### Pattern 2: Attribute-Rich Configuration Component

A data-holding component that leverages Inspector attributes for designer-friendly editing:

```csharp
using UnityEngine;

[DisallowMultipleComponent]
[HelpURL("https://docs.mycompany.com/character-config")]
public class CharacterConfig : MonoBehaviour
{
    [Header("Basic Info")]
    [Tooltip("Display name in UI and dialogs")]
    public string characterName;

    [TextArea(2, 5)]
    [Tooltip("Backstory shown in character select screen")]
    public string backstory;

    [Header("Stats")]
    [SerializeField, Range(1, 999)]
    [Tooltip("Base health before equipment bonuses")]
    private int baseHealth = 100;

    [Min(0)]
    public int baseAttack;

    [Range(0f, 100f)]
    [Tooltip("Percentage damage reduction (0-100)")]
    public float defensePercentage;

    [Header("Visual")]
    [ColorUsage(false, false)]
    public Color teamColor = Color.white;

    [Space(10)]

    [ContextMenuItem("Random", "RandomizeId")]
    public string characterId;

    void RandomizeId()
    {
        characterId = System.Guid.NewGuid().ToString()[..8];
    }

    [ContextMenu("Reset All")]
    void ResetAll()
    {
        baseHealth = 100;
        baseAttack = 0;
        defensePercentage = 0f;
        teamColor = Color.white;
    }
}
```

### Pattern 3: Event Subscription via OnEnable/OnDisable

Canonical pattern for decoupled event-driven communication:

```csharp
using UnityEngine;

public class ScoreDisplay : MonoBehaviour
{
    [SerializeField] private UnityEngine.UI.Text scoreText;

    int currentScore;

    void OnEnable()
    {
        // These could be static events, ScriptableObject event channels, etc.
        GameEvents.OnScoreChanged += HandleScoreChanged;
        GameEvents.OnGameReset    += HandleGameReset;
    }

    void OnDisable()
    {
        // ALWAYS unsubscribe to prevent:
        // - Accumulating handlers on disable/re-enable cycles
        // - Event bus holding references to destroyed object wrappers
        GameEvents.OnScoreChanged -= HandleScoreChanged;
        GameEvents.OnGameReset    -= HandleGameReset;
    }

    void HandleScoreChanged(int newScore)
    {
        currentScore = newScore;
        scoreText.text = $"Score: {currentScore}";
    }

    void HandleGameReset()
    {
        currentScore = 0;
        scoreText.text = "Score: 0";
    }
}
```

### Pattern 4: Collision and Trigger Handling

Complete pattern for physics interaction with proper signature matching:

```csharp
using UnityEngine;

[RequireComponent(typeof(Collider))]
public class DamageZone : MonoBehaviour
{
    [SerializeField] private int damagePerTick = 10;
    [SerializeField] private float tickInterval = 0.5f;

    private float nextTickTime;

    // Trigger version (Collider set to IsTrigger = true)
    void OnTriggerEnter(Collider other)
    {
        // Only process on first contact
        if (other.TryGetComponent<HealthComponent>(out var health))
        {
            nextTickTime = Time.time;
            Debug.Log($"{other.name} entered damage zone");
        }
    }

    void OnTriggerStay(Collider other)
    {
        if (Time.time < nextTickTime) return;

        if (other.TryGetComponent<HealthComponent>(out var health))
        {
            health.TakeDamage(damagePerTick);
            nextTickTime = Time.time + tickInterval;
        }
    }

    void OnTriggerExit(Collider other)
    {
        Debug.Log($"{other.name} left damage zone");
    }

    // Collision version (non-trigger)
    void OnCollisionEnter(Collision collision)
    {
        // Access collision data: contacts, impulse, relative velocity
        Vector3 impactPoint = collision.GetContact(0).point;
        float impactForce = collision.impulse.magnitude;

        if (impactForce > 50f)
        {
            if (collision.gameObject.TryGetComponent<HealthComponent>(out var health))
            {
                health.TakeDamage(Mathf.RoundToInt(impactForce * 0.1f));
            }
        }
    }
}
```

### Pattern 5: Coroutine Timer with Cleanup

Safe coroutine usage with caching and proper cleanup:

```csharp
using System.Collections;
using UnityEngine;

public class TimedBuff : MonoBehaviour
{
    [SerializeField] private float duration = 5f;
    [SerializeField] private float speedMultiplier = 1.5f;

    private Coroutine buffCoroutine;
    private WaitForSeconds tickInterval;
    private float originalSpeed;

    void Awake()
    {
        tickInterval = new WaitForSeconds(0.1f); // Cache to avoid allocation
    }

    void OnEnable()
    {
        buffCoroutine = StartCoroutine(ApplyBuff());
    }

    void OnDisable()
    {
        // Stop coroutine on disable to prevent running on inactive objects
        if (buffCoroutine != null)
        {
            StopCoroutine(buffCoroutine);
            buffCoroutine = null;
        }
    }

    IEnumerator ApplyBuff()
    {
        originalSpeed = Player.Instance.moveSpeed;
        Player.Instance.moveSpeed = originalSpeed * speedMultiplier;

        float elapsed = 0f;
        while (elapsed < duration)
        {
            elapsed += 0.1f;
            yield return tickInterval; // cached — no allocation
        }

        Player.Instance.moveSpeed = originalSpeed;
        Destroy(this); // Remove just this component, not the GameObject
    }
}
```

### Pattern 6: RequireComponent with GetComponent Caching

Ensures mandatory dependencies exist and caches them efficiently:

```csharp
using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
[RequireComponent(typeof(Collider))]
[RequireComponent(typeof(AudioSource))]
public class Projectile : MonoBehaviour
{
    [Header("Projectile Settings")]
    [SerializeField, Range(1f, 100f)]
    private float speed = 20f;

    [SerializeField, Min(0.1f)]
    private float lifetime = 5f;

    // Cached references
    private Rigidbody rb;
    private AudioSource audioSource;

    void Awake()
    {
        // Safe to call GetComponent because [RequireComponent] guarantees they exist
        rb = GetComponent<Rigidbody>();
        audioSource = GetComponent<AudioSource>();
    }

    void OnEnable()
    {
        rb.linearVelocity = transform.forward * speed;
        Invoke(nameof(Deactivate), lifetime);
    }

    void OnDisable()
    {
        CancelInvoke(nameof(Deactivate));
        rb.linearVelocity = Vector3.zero;
    }

    void OnCollisionEnter(Collision collision)
    {
        audioSource.Play();
        Deactivate();
    }

    void Deactivate()
    {
        gameObject.SetActive(false); // For object pooled projectiles
    }
}
```

---

## Best Practices

1. **Match class name to file name exactly.** Unity requires this for the script to function as a component. If the names don't match, the script cannot be added to a GameObject.

2. **Never use constructors on MonoBehaviour.** Unity manages MonoBehaviour lifecycle and instantiation through its native C++ bridge. Constructors interfere with serialization and can be called at unpredictable times. Use `Awake()` or `Start()` for all initialization.

3. **Use `Awake()` for self-initialization, `Start()` for cross-object initialization.** Awake is guaranteed to run on all objects before any Start. If your initialization needs another component's Awake to have run, put it in Start.

4. **Always cache GetComponent results.** Call `GetComponent<T>()`, `GetComponentInChildren<T>()`, `GetComponentInParent<T>()` once in `Awake()` or `Start()` and store in a private field. Never call these methods in `Update()`, `FixedUpdate()`, or `LateUpdate()` — they are expensive per-frame operations.

5. **Prefer `[SerializeField] private` over `public` fields.** This preserves encapsulation (other classes can't directly modify your state) while keeping the field editable in the Inspector. Only expose fields as `public` when they genuinely need to be accessed by other classes.

6. **Use `[RequireComponent]` for mandatory dependencies.** If your script cannot function without a Rigidbody, annotate it with `[RequireComponent(typeof(Rigidbody))]`. Unity will auto-add required components when your script is added and prevent accidental removal.

7. **Use `[DisallowMultipleComponent]` when only one instance makes sense.** Prevent configuration errors where multiple instances of the same component cause broken behavior. Applies to managers, controllers, and singleton-like components.

8. **Subscribe in OnEnable, unsubscribe in OnDisable.** This is the canonical pattern for all event subscriptions. It prevents: (a) accumulating duplicate handlers when a component is disabled and re-enabled, (b) calls on inactive objects, and (c) event bus references to destroyed objects.

9. **Organize Inspector fields with `[Header]` and `[Space]`.** Large Monobehaviours with many fields benefit from visual grouping. Use headers to create categories and spaces to separate logical groups. This makes a big difference for designers and other team members who configure components through the Inspector.

10. **Add `[Tooltip]` to non-obvious fields.** A tooltip explains the purpose of a field when a designer hovers over it in the Inspector. This self-documents the component and reduces the need for external documentation. Be concise — 1-2 sentences at most.

11. **Use namespaces to prevent naming conflicts.** Even in small projects, common names like `Controller`, `Manager`, or `Player` can collide. A `namespace MyGame.Player` wrapping `PlayerController` prevents ambiguity and clearly scopes the code.

12. **Keep MonoBehaviour scripts focused — one responsibility per component.** Resist the urge to put all gameplay logic in one component. Split functionality across multiple components (e.g., separate `HealthComponent`, `MovementComponent`, `CombatComponent`). This makes each component testable, reusable, and easier to debug.

13. **Stop coroutines in OnDisable when components are disabled.** A running coroutine continues even on a disabled component if it was started from `Awake`/`Start`. Always `StopCoroutine()` or `StopAllCoroutines()` in `OnDisable` to prevent logic running on inactive objects.

14. **Use `#if UNITY_EDITOR` to guard Editor-only code in runtime scripts.** If a runtime script needs editor-specific logic (like `OnDrawGizmos` or `Reset`), no `#if` is needed since those are never compiled into builds. But if you're using Editor APIs like `EditorUtility` in your runtime scripts, wrap them with `#if UNITY_EDITOR` to avoid build errors.

15. **Use Assembly Definitions for non-trivial projects.** Once your script count exceeds ~50, add `.asmdef` files to partition code into logical assemblies. This dramatically reduces recompile wait times during development and enforces architectural boundaries at the compiler level.

---

## Common Pitfalls

1. **Calling GetComponent in Update.** This is the most common Unity performance mistake. Cache it in Awake.

2. **Forgetting to unsubscribe from events.** Causes "missing" calls (when disabled) or errors (event bus holds reference to destroyed object). Always pair OnEnable subscription with OnDisable unsubscription.

3. **Relying on execution order between different instances of the same event.** Multiple `Start()` calls have arbitrary ordering. Use explicit initialization or Script Execution Order settings.

4. **Using `??` or `?.` on UnityEngine.Object types.** These bypass Unity's custom null operator. A "destroyed" object still has a valid C# reference — `?.` will not catch it. Use explicit `== null` checks.

5. **Defining a constructor on MonoBehaviour.** This will cause bugs and is explicitly warned against. Unity manages construction.

6. **Placing Editor scripts outside Editor folders without `#if UNITY_EDITOR` guards.** This causes build failures because Editor APIs don't exist at runtime.

7. **Using multiple namespaces in a file containing MonoBehaviour.** Unity prohibits this. Use separate files or Editor folders.

8. **Assuming `OnEnable` is called after `Awake`.** OnEnable can (and does) fire before Awake on initial instantiation. Design with this in mind.

9. **Forgetting that fixedDeltaTime can cause 0 or multiple FixedUpdate calls per frame.** Don't assume FixedUpdate runs once per visual frame.

10. **Using `DestroyImmediate` at runtime.** This is an Editor-only API. Use `Destroy()` in runtime code.

---

## Additional Resources

- [Unity Scripting API Reference](https://docs.unity3d.com/ScriptReference/index.html)
- [MonoBehaviour Script Reference](https://docs.unity3d.com/ScriptReference/MonoBehaviour.html)
- [Script Serialization](https://docs.unity3d.com/Manual/script-Serialization.html)
- [Unity Attributes List](https://docs.unity3d.com/ScriptReference/AddComponentMenu.html)
- [Script Execution Order](https://docs.unity3d.com/Manual/class-MonoManager.html)
- [Assembly Definition Files](https://docs.unity3d.com/Manual/ScriptCompilationAssemblyDefinitionFiles.html)
- [Execution Order of Event Functions](https://docs.unity3d.com/Manual/ExecutionOrder.html)
- [Unity .NET Features](https://docs.unity3d.com/Manual/overview-of-dot-net-in-unity.html)
- [Managed Plug-ins](https://docs.unity3d.com/Manual/UsingDLL.html)
