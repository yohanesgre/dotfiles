---
name: unity-scripting-architecture
description: Unity C# scripting architecture patterns — OOP design, ScriptableObjects, events, assembly definitions, compilation pipeline, conditional compilation, domain reload, and plug-ins. Based on Unity 6.4 documentation.
---

# Unity Scripting Architecture

Comprehensive reference for Unity C# scripting architecture patterns — OOP design, ScriptableObjects, events, assembly definitions, compilation pipeline, conditional compilation, domain reload, and plug-ins.

---

## 1. Object-Oriented Development in Unity

### Component-Based Architecture

Unity uses a **composition-over-inheritance** model. GameObjects are containers for components; behavior is composed by attaching multiple MonoBehaviour scripts rather than building deep inheritance chains.

```
GameObject
├── Transform          (built-in)
├── MeshRenderer       (built-in)
├── Rigidbody          (built-in)
├── PlayerController   (your script)
├── HealthComponent    (your script)
└── InventoryComponent (your script)
```

Each component encapsulates its own logic and data. Components communicate via `GetComponent<T>()`, `SendMessage`, or event systems — not by hard inheritance coupling.

### Fundamental Type Hierarchy

```
UnityEngine.Object
├── GameObject
├── MonoBehaviour       ← attach to GameObjects as components
├── ScriptableObject    ← standalone assets, not on GameObjects
├── Transform, Camera, etc. (built-in types)
```

**Key rule**: Never use constructors on MonoBehaviour or ScriptableObject. Unity owns object creation/destruction. Use `Awake()`, `Start()`, `OnEnable()` for initialization.

### Inheritance Patterns

**When inheritance makes sense:**
- Shared behavior across multiple component types (base enemy, base weapon)
- Abstract base `ScriptableObject` for data variants

```csharp
public abstract class BaseEnemy : MonoBehaviour
{
    [SerializeField] protected float health;
    [SerializeField] protected float moveSpeed;

    protected virtual void Start()
    {
        // Shared initialization
    }

    public virtual void TakeDamage(float amount)
    {
        health -= amount;
        if (health <= 0) Die();
    }

    protected abstract void Die();
}

public class MeleeEnemy : BaseEnemy
{
    [SerializeField] private float attackRange;

    protected override void Die()
    {
        // Melee-specific death
        Destroy(gameObject);
    }
}
```

**When composition is better:**
- Reusable behaviors (health, movement, attacking) — make them separate components
- Cross-cutting concerns (logging, pooling) — use interfaces or ScriptableObject events

**Namespaces** prevent naming collisions:

```csharp
namespace Gameplay.Enemies
{
    public class Controller : MonoBehaviour { }
}

namespace Gameplay.Player
{
    public class Controller : MonoBehaviour { }
}
```

**Unity limitation**: A single file containing a MonoBehaviour or ScriptableObject cannot declare multiple namespaces.

### UnityEngine.Object Equality

`UnityEngine.Object` overrides `==` and `!=`. Objects can be in a "destroyed" C++ state while the C# wrapper still exists:

- `myGameObject == null` → `true` when C++ counterpart destroyed (even if C# reference exists)
- Use `ReferenceEquals(obj, null)` for actual C# null checks
- The custom equality operator is slower — avoid in hot paths
- `??` and `?.` operators are **not compatible** with `UnityEngine.Object`

---

## 2. ScriptableObjects

ScriptableObject is a serializable data container that exists as an **asset** — not attached to GameObjects. Ideal for shared configuration, data-driven design, event channels, and editor tools.

### Creation via CreateAssetMenu

```csharp
[CreateAssetMenu(fileName = "PlayerConfig", menuName = "Game/Player Config", order = 1)]
public class PlayerConfig : ScriptableObject
{
    public float moveSpeed = 5f;
    public float jumpForce = 10f;
    public int maxHealth = 100;
}
```

Menu path: **Assets > Create > Game > Player Config**

### Programmatic Creation

```csharp
#if UNITY_EDITOR
var config = ScriptableObject.CreateInstance<PlayerConfig>();
config.moveSpeed = 8f;

AssetDatabase.CreateAsset(config, "Assets/Configs/PlayerConfig.asset");
AssetDatabase.SaveAssets();
#endif
```

### Asset References

Reference ScriptableObject assets in MonoBehaviours via Inspector fields — no `GetComponent` needed, no scene coupling:

```csharp
public class Player : MonoBehaviour
{
    [SerializeField] private PlayerConfig config;

    private void Start()
    {
        GetComponent<Rigidbody>().linearVelocity = Vector3.forward * config.moveSpeed;
    }
}
```

Multiple prefabs/objects can reference the **same** ScriptableObject — saves memory (no duplicate data).

### Data Container Pattern

Base config classes with inheritance for variants:

```csharp
public abstract class GameData : ScriptableObject
{
    public string id;
    public string displayName;
}

[CreateAssetMenu(fileName = "WeaponData", menuName = "Game/Weapon Data")]
public class WeaponData : GameData
{
    public int damage;
    public float fireRate;
    public GameObject prefab;
    public AudioClip fireSound;
}
```

### Editor Persistence

Changes made to ScriptableObjects via script **in Edit mode** are not automatically persisted. Must call `EditorUtility.SetDirty`:

```csharp
#if UNITY_EDITOR
using UnityEditor;

public static void SaveAsset(ScriptableObject asset)
{
    EditorUtility.SetDirty(asset);
    AssetDatabase.SaveAssets();
}
#endif
```

### ScriptableObject Singleton / Service Locator Pattern

A single asset loaded at runtime acts as a global service:

```csharp
public class GameService : ScriptableObject
{
    private static GameService instance;

    public static GameService Instance
    {
        get
        {
            if (instance == null)
                instance = Resources.Load<GameService>("GameService");
            return instance;
        }
    }

    public PlayerConfig playerConfig;
    public DifficultySettings difficulty;
}
```

Place the `.asset` file in a `Resources/` folder. Reference with `GameService.Instance.playerConfig`.

### Event Channel Pattern

ScriptableObject-based event channels decouple event producers from consumers — no direct references needed:

```csharp
[CreateAssetMenu(fileName = "VoidEvent", menuName = "Events/Void Event")]
public class VoidEventChannel : ScriptableObject
{
    private readonly List<Action> listeners = new();

    public void Raise()
    {
        for (int i = listeners.Count - 1; i >= 0; i--)
            listeners[i]?.Invoke();
    }

    public void Register(Action listener) => listeners.Add(listener);
    public void Unregister(Action listener) => listeners.Remove(listener);
}
```

Usage — producer doesn't know about consumers:

```csharp
public class PlayerDeathBroadcaster : MonoBehaviour
{
    [SerializeField] private VoidEventChannel onPlayerDied;

    public void Die() => onPlayerDied.Raise();
}
```

Consumer:

```csharp
public class UIGameOver : MonoBehaviour
{
    [SerializeField] private VoidEventChannel onPlayerDied;

    private void OnEnable() => onPlayerDied.Register(ShowGameOver);
    private void OnDisable() => onPlayerDied.Unregister(ShowGameOver);

    private void ShowGameOver() => gameObject.SetActive(true);
}
```

Typed variant with parameters:

```csharp
[CreateAssetMenu(fileName = "IntEvent", menuName = "Events/Int Event")]
public class IntEventChannel : ScriptableObject
{
    private readonly List<Action<int>> listeners = new();

    public void Raise(int value)
    {
        for (int i = listeners.Count - 1; i >= 0; i--)
            listeners[i]?.Invoke(value);
    }

    public void Register(Action<int> listener) => listeners.Add(listener);
    public void Unregister(Action<int> listener) => listeners.Remove(listener);
}
```

---

## 3. Events & Delegates

### UnityEvent (Serializable, Inspector-Configurable)

Unity provides `UnityEvent` and its generic variants for designer-wireable events in the Inspector:

| Type | Parameters |
|------|-----------|
| `UnityEvent` | 0 parameters |
| `UnityEvent<T0>` | 1 parameter |
| `UnityEvent<T0, T1>` | 2 parameters |
| `UnityEvent<T0, T1, T2>` | 3 parameters |
| `UnityEvent<T0, T1, T2, T3>` | 4 parameters |

```csharp
using UnityEngine.Events;

public class TriggerZone : MonoBehaviour
{
    [SerializeField] private UnityEvent onPlayerEnter;
    [SerializeField] private UnityEvent<GameObject> onObjectEnter;
    [SerializeField] private UnityEvent<int, float> onScoredPowerup; // score, multiplier

    private void OnTriggerEnter(Collider other)
    {
        onPlayerEnter?.Invoke();
        onObjectEnter?.Invoke(other.gameObject);
    }
}
```

In the Inspector, designers can:
- Add persistent listeners targeting any component on any GameObject
- Bind to public methods with matching signatures
- Assign static/dynamic parameters

### UnityAction

`UnityAction` is a zero-parameter delegate that's compatible with `UnityEvent`:

```csharp
using UnityEngine.Events;

public class Example : MonoBehaviour
{
    private UnityAction myAction;

    void Start()
    {
        myAction += () => Debug.Log("Invoked!");

        var evt = new UnityEvent();
        evt.AddListener(myAction);
        evt.Invoke();
    }
}
```

Generic variants: `UnityAction<T0>`, `UnityAction<T0, T1>`, etc.

### C# Events / Actions / Funcs

Use C# delegates for runtime-only events (not designer-configurable):

```csharp
public class Health : MonoBehaviour
{
    public event Action<float> OnHealthChanged;    // currentHealth
    public event Action OnDeath;

    [SerializeField] private float maxHealth = 100f;
    private float currentHealth;

    public void TakeDamage(float amount)
    {
        currentHealth -= amount;
        OnHealthChanged?.Invoke(currentHealth / maxHealth);

        if (currentHealth <= 0)
        {
            OnDeath?.Invoke();
        }
    }
}
```

### EventSystem Interfaces (15+ Interfaces)

Unity's EventSystem provides interfaces for handling input events. Implement them on a MonoBehaviour attached to a GameObject with a `GraphicRaycaster` (UI) or `PhysicsRaycaster` (3D/2D):

#### Pointer Interfaces

| Interface | Method |
|-----------|--------|
| `IPointerEnterHandler` | `OnPointerEnter(PointerEventData)` |
| `IPointerExitHandler` | `OnPointerExit(PointerEventData)` |
| `IPointerDownHandler` | `OnPointerDown(PointerEventData)` |
| `IPointerUpHandler` | `OnPointerUp(PointerEventData)` |
| `IPointerClickHandler` | `OnPointerClick(PointerEventData)` |
| `IPointerMoveHandler` | `OnPointerMove(PointerEventData)` |

#### Drag Interfaces

| Interface | Method |
|-----------|--------|
| `IBeginDragHandler` | `OnBeginDrag(PointerEventData)` |
| `IDragHandler` | `OnDrag(PointerEventData)` |
| `IEndDragHandler` | `OnEndDrag(PointerEventData)` |
| `IDropHandler` | `OnDrop(PointerEventData)` |
| `IInitializePotentialDragHandler` | `OnInitializePotentialDrag(PointerEventData)` |

#### Additional Interfaces

| Interface | Method |
|-----------|--------|
| `IScrollHandler` | `OnScroll(PointerEventData)` |
| `ISelectHandler` | `OnSelect(BaseEventData)` |
| `IDeselectHandler` | `OnDeselect(BaseEventData)` |
| `IUpdateSelectedHandler` | `OnUpdateSelected(BaseEventData)` |
| `IMoveHandler` | `OnMove(AxisEventData)` |
| `ISubmitHandler` | `OnSubmit(BaseEventData)` |
| `ICancelHandler` | `OnCancel(BaseEventData)` |

**Drag example:**

```csharp
using UnityEngine;
using UnityEngine.EventSystems;

public class DraggableItem : MonoBehaviour, IBeginDragHandler, IDragHandler, IEndDragHandler
{
    private Canvas canvas;
    private RectTransform rectTransform;
    private CanvasGroup canvasGroup;

    private void Awake()
    {
        rectTransform = GetComponent<RectTransform>();
        canvasGroup = GetComponent<CanvasGroup>();
        canvas = GetComponentInParent<Canvas>();
    }

    public void OnBeginDrag(PointerEventData eventData)
    {
        canvasGroup.alpha = 0.6f;
        canvasGroup.blocksRaycasts = false;
    }

    public void OnDrag(PointerEventData eventData)
    {
        rectTransform.anchoredPosition += eventData.delta / canvas.scaleFactor;
    }

    public void OnEndDrag(PointerEventData eventData)
    {
        canvasGroup.alpha = 1f;
        canvasGroup.blocksRaycasts = true;
    }
}
```

---

## 4. Assembly Definitions (.asmdef)

Assembly Definition files organize scripts into named assemblies. Benefits: explicit dependency control, reduced recompilation (changing one assembly doesn't recompile others), and platform targeting.

### Creating an asmdef

1. Right-click in Project window → **Create → Assembly Definition**
2. Name it (becomes the assembly name)

Scripts in the same folder (and subfolders) as the `.asmdef` file belong to that assembly. Scripts in parent folders without their own `.asmdef` belong to the **default assembly** (`Assembly-CSharp`).

### JSON Structure

```json
{
    "name": "Game.Core",
    "rootNamespace": "Game.Core",
    "references": [
        "UnityEngine",
        "UnityEngine.CoreModule",
        "UnityEngine.UI"
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

### Key Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Assembly name (also filename without `.asmdef`) |
| `rootNamespace` | string | Auto-applied namespace for all scripts in assembly |
| `references` | string[] | Other assemblies this one can access |
| `includePlatforms` | string[] | Platforms to include (empty = all). e.g. `["iOS", "Android"]` |
| `excludePlatforms` | string[] | Platforms to exclude |
| `allowUnsafeCode` | bool | Enable `unsafe` keyword |
| `overrideReferences` | bool | Override default engine references |
| `precompiledReferences` | string[] | Precompiled DLL references |
| `autoReferenced` | bool | Whether precompiled assemblies auto-reference this (default `true`) |
| `defineConstraints` | string[] | Scripting symbols that must be defined for this assembly to compile |
| `versionDefines` | object[] | Conditional compilation based on package versions |
| `noEngineReferences` | bool | Exclude all Unity engine references (for pure C#) |

### Typical Assembly Layout

```
Assets/
├── Game.Core/
│   └── Game.Core.asmdef          ← references: Unity, nothing from Game
├── Game.Gameplay/
│   └── Game.Gameplay.asmdef      ← references: Game.Core
├── Game.UI/
│   └── Game.UI.asmdef            ← references: Game.Core, UnityEngine.UI
├── Game.Gameplay/Editor/
│   └── Game.Gameplay.Editor.asmdef  ← references: Game.Gameplay
└── Plugins/
    └── Plugins.asmdef            ← references: precompiled DLLs
```

### Special Folders

- `Editor/` folders: Scripts here are **automatically excluded** from Player builds (Editor-only)
- An `.asmdef` inside an `Editor/` folder creates an Editor-only assembly
- `Plugins/` folder: Scripts compile before other assemblies by default

### asmdef Best Practices

- Create a `Core` assembly for foundation types (pure C#, no Unity engine references)
- Create domain-specific assemblies (`Gameplay`, `UI`, `Networking`)
- Set `autoReferenced: false` for assemblies that should NOT be referenced by precompiled plug-ins
- Use `defineConstraints` for platform variation without `#if` in code
- Keep assemblies small — faster iterative compilation

---

## 5. Compilation Pipeline

### Default Compilation Order

Unity compiles scripts in a fixed order:

1. **Runtime scripts** in `Assets/` → `Assembly-CSharp.dll`
2. **Runtime scripts** in `Assets/Plugins/` → `Assembly-CSharp-firstpass.dll`
3. **Editor scripts** in `Assets/Plugins/Editor/`
4. **Editor scripts** in all `Assets/Editor/` folders
5. **Any other scripts** (if not covered by `.asmdef`)

Scripts in later steps can reference scripts in earlier steps. Scripts in the same step **cannot** reference each other unless in the same `.asmdef` assembly.

### Scripting Backends

| Backend | Description | When to Use |
|---------|-------------|-------------|
| **.NET** | Modern .NET runtime | Default for most platforms now |
| **Mono** | Legacy Mono runtime | Being phased out |
| **IL2CPP** | Translates C# IL to C++, then compiles | Required for iOS, consoles; better performance on most platforms |

Set in: **Player Settings → Configuration → Scripting Backend**

### Managed Code Stripping

Removes unused managed code to reduce build size. Configurable stripping levels in **Player Settings → Managed Stripping Level**:

- **Disabled**: No stripping
- **Minimal**: Removes unreachable code
- **Medium**: Aggressive removal (can break reflection-heavy code)
- **High**: Most aggressive (typically requires link.xml preservation)

### C# Language Versions

| Unity Version | C# Version |
|---------------|------------|
| Unity 2022+ | C# 9.0 |
| Unity 2021 | C# 8.0 |
| Unity 2020 | C# 7.3 |

Unity uses the **Roslyn** compiler.

---

## 6. Conditional Compilation

### Platform Directives (18+ Symbols)

#### Editor and General

| Symbol | Target |
|--------|--------|
| `UNITY_EDITOR` | Unity Editor (any platform) |
| `UNITY_EDITOR_WIN` | Editor on Windows |
| `UNITY_EDITOR_OSX` | Editor on macOS |
| `UNITY_EDITOR_LINUX` | Editor on Linux |

#### Standalone (Desktop)

| Symbol | Target |
|--------|--------|
| `UNITY_STANDALONE` | Any standalone platform |
| `UNITY_STANDALONE_WIN` | Windows standalone |
| `UNITY_STANDALONE_OSX` | macOS standalone |
| `UNITY_STANDALONE_LINUX` | Linux standalone |

#### Mobile

| Symbol | Target |
|--------|--------|
| `UNITY_IOS` | iOS |
| `UNITY_ANDROID` | Android |

#### Web

| Symbol | Target |
|--------|--------|
| `UNITY_WEBGL` | WebGL |

#### Consoles

| Symbol | Target |
|--------|--------|
| `UNITY_SWITCH` | Nintendo Switch |
| `UNITY_PS4` | PlayStation 4 |
| `UNITY_PS5` | PlayStation 5 |
| `UNITY_XBOXONE` | Xbox One |
| `UNITY_GAMECORE_XBOXONE` | Xbox One via GameCore |
| `UNITY_GAMECORE_SCARLETT` | Xbox Series X\|S |

#### Architecture / Other

| Symbol | Target |
|--------|--------|
| `UNITY_64` | 64-bit target |
| `UNITY_32` | 32-bit target |
| `UNITY_SERVER` | Server build |

### Usage Patterns

**Editor-only code:**

```csharp
#if UNITY_EDITOR
using UnityEditor;

[CustomEditor(typeof(PlayerConfig))]
public class PlayerConfigEditor : Editor
{
    public override void OnInspectorGUI() { /* ... */ }
}
#endif
```

**Platform-specific code:**

```csharp
public void SaveGame(string json)
{
#if UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX
    File.WriteAllText(Application.persistentDataPath + "/save.json", json);
#elif UNITY_WEBGL
    PlayerPrefs.SetString("save", json);
#elif UNITY_ANDROID || UNITY_IOS
    MobileSaveSystem.Save(json);
#endif
}
```

**Editor-only methods without cluttering calling code:**

Use `[Conditional]` attribute — the method call itself is stripped:

```csharp
using System.Diagnostics;

public static class EditorDebug
{
    [Conditional("UNITY_EDITOR")]
    public static void LogEditor(string message)
    {
        Debug.Log($"[EDITOR] {message}");
    }
}

// In any file — call compiles to nothing in builds:
EditorDebug.LogEditor("This only logs in Editor.");
```

No `#if/#endif` needed at the call site.

### Custom Scripting Symbols

Define in **Player Settings → Other Settings → Scripting Define Symbols** (semicolon-separated):

```
USE_ANALYTICS;ENABLE_CHEATS;DEBUG_MODE
```

Use in code:

```csharp
#if USE_ANALYTICS
    Analytics.SendEvent("level_complete");
#endif
```

Custom symbols can also be defined per-assembly via `defineConstraints` in the `.asmdef` file (must match to compile the assembly).

---

## 7. Domain Reload & Enter Play Mode

### Behavior

By default, when entering Play Mode, Unity:
1. **Reloads the scripting domain** — unloads all assemblies, re-runs static constructors, resets `static` variables
2. **Reloads the active scene** — destroys all scene objects and recreates them

This ensures a clean start each time but slows iteration.

### Enter Play Mode Settings

**Project Settings → Editor → Enter Play Mode Settings:**

| Option | Default | Effect |
|--------|---------|--------|
| Reload Domain | On | Resets static state, unloads assemblies |
| Reload Scene | On | Rebuilds scene from scratch |

**Disabling Domain Reload:**
- Static variables **persist** between Play sessions
- Non-serialized fields keep their values
- Static events keep their subscribers (risk of duplicate registration!)
- `OnEnable`/`OnDisable` are NOT called for scripts when entering/exiting (only on first Play)

### Preserving State

When domain reload is disabled, reset static state explicitly:

**Pattern 1: Reset on Play Mode exit:**

```csharp
#if UNITY_EDITOR
public class GameManager : MonoBehaviour
{
    private static int score;

    [RuntimeInitializeOnLoadMethod]
    private static void SubscribeToPlayMode()
    {
        EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
    }

    private static void OnPlayModeStateChanged(PlayModeStateChange state)
    {
        if (state == PlayModeStateChange.ExitingPlayMode)
        {
            score = 0;
            // Reset other static state
            EditorApplication.playModeStateChanged -= OnPlayModeStateChanged;
        }
    }
}
#endif
```

**Pattern 2: Reset on Play Mode enter (recommended):**

```csharp
public class GameManager : MonoBehaviour
{
    private static int score;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    private static void ResetStaticState()
    {
        score = 0;
        // Runs when entering Play Mode, regardless of domain reload setting
    }
}
```

`RuntimeInitializeLoadType.SubsystemRegistration` ensures the method runs before any scene loads and before `Awake()`.

### RuntimeInitializeOnLoadMethod

Used for initialization that must happen before any scene code runs:

```csharp
public class Bootstrap : MonoBehaviour
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void InitializeServices()
    {
        // Runs before the first scene's Awake()
        Debug.Log("Services initialized");
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void PostSceneSetup()
    {
        // Runs after the first scene loads
    }
}
```

| Load Type | Timing |
|-----------|--------|
| `AfterAssembliesLoaded` | Immediately after assemblies load |
| `BeforeSplashScreen` | Before splash screen |
| `BeforeSceneLoad` | Before first scene's Awake |
| `AfterSceneLoad` | After first scene fully loads |
| `SubsystemRegistration` | For subsystem registration (earliest, before domain reload considerations) |

### playModeStateChanged Events

`EditorApplication.playModeStateChanged` fires with `PlayModeStateChange` enum:

| State | Meaning |
|-------|---------|
| `EnteredEditMode` | Just entered Edit Mode |
| `ExitingEditMode` | About to enter Play Mode |
| `EnteredPlayMode` | Just entered Play Mode |
| `ExitingPlayMode` | About to exit Play Mode (back to Edit) |

---

## 8. Plug-ins (Precompiled Assemblies)

### Managed Plug-ins

Precompiled .NET assemblies (`.dll` files) created with Visual Studio, Rider, or `dotnet build`. Contain only managed (C#) code.

**Usage:**
1. Place `.dll` in `Assets/` or any subfolder
2. Unity automatically includes it in compilation
3. Scripts can reference types from the DLL if the assembly is referenced

**Restrictions:**
- Cannot access platform-native features (use native plug-ins for that)
- Must target compatible .NET framework version

### Native Plug-ins

Platform-specific native code libraries:

| Platform | Extension |
|----------|-----------|
| Windows | `.dll` |
| macOS | `.bundle` |
| Linux | `.so` |
| iOS | `.a` (static library) |
| Android | `.so` |

**Platform-specific folders:**

| Folder | Targets |
|--------|---------|
| `Assets/Plugins/` | All platforms |
| `Assets/Plugins/iOS/` | iOS only |
| `Assets/Plugins/Android/` | Android only |
| `Assets/Plugins/x86/` | Windows 32-bit |
| `Assets/Plugins/x86_64/` | Windows 64-bit |
| `Assets/Plugins/WSA/` | Universal Windows Platform |

**Calling native code:**

```csharp
using System.Runtime.InteropServices;

public class NativeBridge : MonoBehaviour
{
#if UNITY_STANDALONE_WIN
    [DllImport("MyNativeLibrary")]
    private static extern int DoNativeMath(int a, int b);
#elif UNITY_ANDROID
    [DllImport("my-native-lib")]
    private static extern int DoNativeMath(int a, int b);
#endif

    public int AddViaNative(int x, int y)
    {
        return DoNativeMath(x, y);
    }
}
```

### Precompiled Reference in asmdef

Reference a managed DLL from an assembly definition:

```json
{
    "name": "MyAssembly",
    "precompiledReferences": [
        "Newtonsoft.Json.dll",
        "MyThirdPartyLib.dll"
    ]
}
```

---

## Code Patterns

### Pattern 1: ScriptableObject Data Container

```csharp
[CreateAssetMenu(fileName = "EnemyData", menuName = "Game/Enemy Data")]
public class EnemyData : ScriptableObject
{
    [Header("Identity")]
    public string enemyName;
    public Sprite icon;

    [Header("Stats")]
    public int maxHealth;
    public float moveSpeed;
    public float attackDamage;
    public float attackRange;

    [Header("Visuals")]
    public GameObject prefab;
    public RuntimeAnimatorController animatorController;
}

// Usage in component
public class Enemy : MonoBehaviour
{
    [SerializeField] private EnemyData data;

    private void Start()
    {
        GetComponent<Health>().Initialize(data.maxHealth);
        GetComponent<NavMeshAgent>().speed = data.moveSpeed;
    }
}
```

### Pattern 2: Event Bus via ScriptableObject

```csharp
// Event channel asset
[CreateAssetMenu(fileName = "GameEvent", menuName = "Events/Game Event")]
public class GameEvent : ScriptableObject
{
    private readonly List<IGameEventListener> listeners = new();

    public void Raise()
    {
        for (int i = listeners.Count - 1; i >= 0; i--)
            listeners[i].OnEventRaised();
    }

    public void Register(IGameEventListener listener) => listeners.Add(listener);
    public void Unregister(IGameEventListener listener) => listeners.Remove(listener);
}

// Listener interface
public interface IGameEventListener
{
    void OnEventRaised();
}

// Concrete listener
public class GameEventListener : MonoBehaviour, IGameEventListener
{
    [SerializeField] private GameEvent gameEvent;
    [SerializeField] private UnityEvent response;

    public void OnEventRaised() => response.Invoke();

    private void OnEnable() => gameEvent.Register(this);
    private void OnDisable() => gameEvent.Unregister(this);
}
```

In Inspector: drag `GameEvent.asset` into the listener, wire up `response` to any method on any GameObject.

### Pattern 3: Conditional Compilation for Platform + Editor

```csharp
using UnityEngine;

public static class PlatformUtils
{
    public static string SavePath
    {
        get
        {
#if UNITY_EDITOR
            return System.IO.Path.Combine(Application.dataPath, "..", "Saves");
#elif UNITY_STANDALONE
            return System.IO.Path.Combine(Application.persistentDataPath, "Saves");
#elif UNITY_ANDROID || UNITY_IOS
            return Application.persistentDataPath;
#else
            return Application.temporaryCachePath;
#endif
        }
    }

    public static bool IsMobile
    {
        get
        {
#if UNITY_ANDROID || UNITY_IOS
            return true;
#else
            return false;
#endif
        }
    }
}
```

### Pattern 4: Assembly Definition Structure

```
Assets/Scripts/
├── Core/
│   └── Core.asmdef
│       name: "Game.Core"
│       rootNamespace: "Game.Core"
│       references: []
│       noEngineReferences: true
│
├── Runtime/
│   └── Runtime.asmdef
│       name: "Game.Runtime"
│       rootNamespace: "Game.Runtime"
│       references: ["Game.Core", "Game.Events"]
│
├── Events/
│   └── Events.asmdef
│       name: "Game.Events"
│       rootNamespace: "Game.Events"
│       references: ["Game.Core"]
│
├── UI/
│   └── UI.asmdef
│       name: "Game.UI"
│       rootNamespace: "Game.UI"
│       references: ["Game.Runtime", "Game.Events", "UnityEngine.UI"]
│
├── Runtime/Editor/
│   └── Runtime.Editor.asmdef
│       name: "Game.Runtime.Editor"
│       references: ["Game.Runtime"]
│       includePlatforms: ["Editor"]
```

### Pattern 5: Domain Reload State Reset

```csharp
// Place in a file that compiles in both Editor and Runtime
// Uses conditional compilation for Editor-only APIs
public static class StaticStateManager
{
    public static int GlobalScore;
    public static float GlobalTimer;
    public static List<string> ActivePlayers = new();

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    private static void ResetState()
    {
        GlobalScore = 0;
        GlobalTimer = 0f;
        ActivePlayers?.Clear();
    }
}
```

### Pattern 6: UnityEvent with Inspector Wiring

```csharp
public class HealthComponent : MonoBehaviour
{
    [Header("Events")]
    [SerializeField] private UnityEvent<float> onHealthChanged;   // percentage 0-1
    [SerializeField] private UnityEvent onDeath;
    [SerializeField] private UnityEvent<int> onDamageTaken;       // damage amount

    [Header("Settings")]
    [SerializeField] private float maxHealth = 100f;

    private float currentHealth;

    private void Awake()
    {
        currentHealth = maxHealth;
    }

    public void TakeDamage(int amount)
    {
        currentHealth -= amount;
        onHealthChanged?.Invoke(currentHealth / maxHealth);
        onDamageTaken?.Invoke(amount);

        if (currentHealth <= 0)
        {
            currentHealth = 0;
            onDeath?.Invoke();
        }
    }
}
```

### Pattern 7: Stateful Drag with EventSystem Interfaces

```csharp
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

[RequireComponent(typeof(Image))]
public class InventorySlot : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler,
    IPointerClickHandler, IBeginDragHandler, IDragHandler, IEndDragHandler, IDropHandler
{
    [SerializeField] private Image icon;
    [SerializeField] private Color hoverColor = Color.yellow;
    [SerializeField] private UnityEvent<InventorySlot> onItemDropped;

    private Color defaultColor;

    private void Awake() => defaultColor = icon.color;

    public void OnPointerEnter(PointerEventData e) => icon.color = hoverColor;
    public void OnPointerExit(PointerEventData e) => icon.color = defaultColor;

    public void OnPointerClick(PointerEventData e)
    {
        if (e.button == PointerEventData.InputButton.Right)
            Debug.Log("Right-clicked slot");
    }

    public void OnBeginDrag(PointerEventData e) => icon.raycastTarget = false;
    public void OnDrag(PointerEventData e) => icon.rectTransform.position = e.position;
    public void OnEndDrag(PointerEventData e) => icon.raycastTarget = true;

    public void OnDrop(PointerEventData e) => onItemDropped?.Invoke(this);
}
```

---

## Best Practices

1. **Composition over inheritance**: Attach multiple small MonoBehaviour components to GameObjects rather than building deep inheritance chains. A `Player` GameObject should have `HealthComponent`, `MovementComponent`, `InventoryComponent` — not a `Player : Character : Entity : MonoBehaviour` hierarchy.

2. **ScriptableObjects for shared configuration**: When multiple prefabs need the same data (enemy stats, weapon config, level settings), store it in a ScriptableObject. All references point to one asset — no duplication, no runtime instantiation overhead.

3. **Always call `EditorUtility.SetDirty`** when modifying ScriptableObject data via editor scripts. Without it, changes are lost when the editor loses focus or restarts.

4. **Use ScriptableObject event channels instead of singletons**: For cross-scene or cross-system communication (player died → UI update, game won → particle effects), create ScriptableObject event channel assets. This avoids direct references, singleton managers, and `FindObjectOfType`.

5. **Organize code with assembly definitions early**: Create `Core`, `Runtime`, `UI`, and `Editor` assemblies from the start. This prevents the sprawling `Assembly-CSharp` monolith and makes iterative compilation dramatically faster.

6. **Set `autoReferenced: false`** in assembly definitions for assemblies that should not be visible to precompiled plug-ins. This enforces intentional dependency boundaries.

7. **Use `#if UNITY_EDITOR` for editor-only code**, but prefer `[Conditional("UNITY_EDITOR")]` on methods when the calling code should remain clean. The entire method call is stripped from non-editor builds.

8. **Always reset static state** using `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]` when working with Enter Play Mode (disabled domain reload). This prevents stale data, duplicate event subscriptions, and phantom objects between sessions.

9. **Place native plug-ins in platform-specific folders** (`Assets/Plugins/iOS/`, `Assets/Plugins/x86_64/`) rather than the root `Plugins/` folder. This ensures the correct binary is selected per target platform and prevents build errors.

10. **UnityEvent for designer-configurable, C# events for runtime**: Expose `UnityEvent` fields with `[SerializeField]` when designers need to wire responses in the Inspector. Use C# `event`/`Action`/`Func` for runtime-only connectivity where serialization is irrelevant.

11. **Implement multiple EventSystem interfaces on a single component** rather than splitting across many components. A `DraggableItem` that implements `IBeginDragHandler`, `IDragHandler`, `IEndDragHandler`, and `IPointerClickHandler` is cleaner than four separate scripts.

12. **Iterate listeners backwards** when raising events from a list in a ScriptableObject event channel (`for (int i = listeners.Count - 1; i >= 0; i--)`). This prevents index corruption if a listener unregisters itself during the invocation.

---

## Related Skills

- `unity-monobehaviour-lifecycle` — MonoBehaviour lifecycle, attributes, inspector serialization
- `unity-optimization` — Performance, pooling, garbage collection, Burst compiler
- `unity-testing-debugging` — Test Framework, Debug class, profiling
