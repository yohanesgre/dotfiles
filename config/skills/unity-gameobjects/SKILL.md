---
name: unity-gameobjects
description: Creating, managing, organizing, and manipulating GameObjects in Unity scenes. Covers GameObject fundamentals, transforms, components, layers, tags, prefabs, and the Hierarchy window. Based on Unity 6.4 documentation.
---

# Unity GameObjects Skill

Use this skill when working with Unity GameObjects — creating, managing, organizing, and manipulating the fundamental building blocks of Unity scenes. Covers GameObject fundamentals, transforms, components, layers, tags, prefabs, and the Hierarchy window.

---

## Overview

A **GameObject** is the fundamental object in Unity scenes. Everything you interact with — characters, props, lights, cameras, UI, effects — is a GameObject. By itself, a GameObject is just a container. You add **Components** to give it functionality.

**Key principle:** GameObject = Container + Components

---

## GameObject Fundamentals

### The GameObject Class

Every object in a scene is a GameObject. It has:
- A **name**
- A **Transform** component (mandatory, cannot be removed)
- Zero or more additional components

```csharp
// Create a new empty GameObject
GameObject go = new GameObject("MyObject");

// Create with a component
GameObject light = new GameObject("MyLight", typeof(Light));

// Access the Transform
Transform t = go.transform;
```

### Transform Component

Every GameObject has a Transform. It stores:

| Property | Description |
|---|---|
| `position` | World-space position (Vector3) |
| `localPosition` | Position relative to parent |
| `rotation` | World-space rotation (Quaternion) |
| `localRotation` | Rotation relative to parent |
| `localEulerAngles` | Rotation as Euler angles (X, Y, Z) |
| `scale` / `localScale` | Scale (relative to parent) |
| `parent` | Parent Transform |
| `childCount` | Number of children |

```csharp
// Move
transform.position = new Vector3(0, 5, 0);
transform.Translate(Vector3.forward * Time.deltaTime);

// Rotate
transform.rotation = Quaternion.Euler(0, 45, 0);
transform.Rotate(Vector3.up * 100 * Time.deltaTime);

// Scale
transform.localScale = new Vector3(2, 2, 2);

// Parenting
transform.SetParent(parentTransform, worldPositionStays: true);
transform.parent = null; // Unparent

// Iterate children
foreach (Transform child in transform)
{
    Debug.Log(child.name);
}
```

**Coordinate system:** Unity uses a left-hand coordinate system.
- X: right
- Y: up
- Z: forward

### Rotation and Orientation

Unity represents rotation internally as **Quaternions** (avoid gimbal lock). Use Euler angles for editing.

```csharp
// Quaternion methods
Quaternion lookRotation = Quaternion.LookRotation(target - transform.position);
transform.rotation = Quaternion.Slerp(transform.rotation, lookRotation, Time.deltaTime);

// Euler angles (Inspector-friendly)
transform.localEulerAngles = new Vector3(0, 45, 0);
```

### Active State

```csharp
// Activate / deactivate
gameObject.SetActive(true);
gameObject.SetActive(false);

// Check states
bool selfActive = gameObject.activeSelf;      // Own state only
bool inHierarchy = gameObject.activeInHierarchy; // Effective state (considers parent)
```

**Important:**
- Deactivating a parent deactivates all children
- When parent reactivates, children return to their original states
- Coroutines on deactivated objects are stopped
- All attached components are disabled

### Static GameObjects

Mark GameObjects as static to enable build-time optimizations:

| Static Flag | Purpose |
|---|---|
| `Lightmap Static` | Baked lighting / lightmaps |
| `Occlude Static` | Occlusion culling |
| `Batching Static` | GPU batching |
| `Contribute GI` | Global illumination |

```csharp
// Editor only
#if UNITY_EDITOR
using UnityEditor;

GameObjectUtility.SetStaticEditorFlags(gameObject,
    StaticEditorFlags.LightmapStatic | StaticEditorFlags.OccludeStatic);

StaticEditorFlags flags = GameObjectUtility.GetStaticEditorFlags(myGameObject);
#endif
```

### Primitive Objects

Built-in shapes for prototyping:

```csharp
GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
GameObject capsule = GameObject.CreatePrimitive(PrimitiveType.Capsule);
GameObject cylinder = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
GameObject plane = GameObject.CreatePrimitive(PrimitiveType.Plane);
GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
```

Primitives come with Mesh Filter, Mesh Renderer, and appropriate Collider.

---

## Components

Components define GameObject behavior. Unity has built-in components; you can create custom ones with scripts.

### Adding Components

**Editor:**
1. Select GameObject
2. Inspector → **Add Component**
3. Browse or search for the component

**Script:**
```csharp
// Add a component
Light light = gameObject.AddComponent<Light>();

// Get a component
Light existingLight = GetComponent<Light>();

// Get in children
Light childLight = GetComponentInChildren<Light>();

// Get in parent
Light parentLight = GetComponentInParent<Light>();

// Get all components
Light[] allLights = GetComponents<Light>();
Light[] allLightsInChildren = GetComponentsInChildren<Light>();

// Remove a component
Destroy(light);
```

### Creating Custom Components

```csharp
using UnityEngine;

public class PlayerHealth : MonoBehaviour
{
    [SerializeField] private int maxHealth = 100;
    private int currentHealth;

    void Start()
    {
        currentHealth = maxHealth;
    }

    public void TakeDamage(int damage)
    {
        currentHealth -= damage;
        if (currentHealth <= 0) Die();
    }
}
```

**Rules:**
- Class name must match file name
- Must inherit from `MonoBehaviour`
- `[SerializeField]` exposes private fields to the Inspector

---

## Layers

Layers separate GameObjects for rendering, physics, and lighting.

### Built-in Layers (0-5)

| Layer | Index | Purpose |
|---|---|---|
| Default | 0 | General use |
| TransparentFX | 1 | Visual effects |
| Ignore Raycast | 2 | Excluded from raycasts |
| Water | 4 | Water surfaces |
| UI | 5 | UI elements |

User-defined layers use slots 6-31.

### Creating Layers

**Editor:** `Edit > Project Settings > Tags and Layers`

**Script (read-only at runtime):**
```csharp
int layer = LayerMask.NameToLayer("Enemy");
gameObject.layer = layer;
```

### LayerMasks

LayerMasks are bitmasks for filtering.

```csharp
// Create a LayerMask for a single layer
int enemyLayer = LayerMask.GetMask("Enemy");

// Raycast on specific layer
if (Physics.Raycast(origin, direction, out RaycastHit hit, maxDistance, enemyLayer))
{
    Debug.Log("Hit enemy!");
}

// Combine multiple layers
int enemyAndObstacle = LayerMask.GetMask("Enemy", "Obstacle");

// Check if GameObject is on a layer
if (((1 << gameObject.layer) & enemyLayer) != 0)
{
    // On enemy layer
}

// Alternative: use CompareTag for tags, LayerMask for filtering
```

### Common Layer Uses

| System | How Layers Are Used |
|---|---|
| Camera | `Camera.cullingMask` — which layers to render |
| Light | `Light.cullingMask` — which layers to illuminate |
| Physics | `Physics` / `Physics2D` — layer collision matrix |
| Raycast | `layerMask` parameter — which layers to hit |

---

## Tags

Tags identify GameObjects for scripting. Unlike layers, tags are primarily for identification, not filtering systems.

### Built-in Tags

| Tag | Purpose |
|---|---|
| `Untagged` | Default |
| `Respawn` | Respawn points |
| `Finish` | Level completion markers |
| `EditorOnly` | Destroyed in builds |
| `MainCamera` | Cached; accessible via `Camera.main` |
| `Player` | Player-controlled GameObjects |
| `GameController` | Game controller objects |

**Important:** `Camera.main` returns the first active GameObject tagged "MainCamera". GameObjects tagged "EditorOnly" and their children are destroyed during the build.

### Creating and Assigning Tags

**Editor:** Inspector → Tag dropdown → Add Tag…

**Script:**
```csharp
gameObject.tag = "Enemy";
```

### Finding GameObjects by Tag

```csharp
// Find one
GameObject player = GameObject.FindWithTag("Player");

// Find all
GameObject[] enemies = GameObject.FindGameObjectsWithTag("Enemy");

// Efficient tag check
if (gameObject.CompareTag("Enemy"))
{
    // Handle enemy
}
// Avoid: gameObject.tag == "Enemy" (slower, allocates string)
```

### Tag vs Layer

| | Tag | Layer |
|---|---|---|
| Quantity per GO | One | One |
| Multiple GOs | Yes | Yes |
| Identification | Yes | Yes |
| System filtering | No | Yes (rendering, physics, lighting) |
| Search performance | Slower | Faster with LayerMasks |
| Renamable | No | Yes |

---

## Prefabs

Prefabs are reusable GameObject templates stored as assets.

### Creating Prefabs

1. Create and configure a GameObject in the scene
2. Drag it from Hierarchy into the Project window
3. The original becomes an **instance** of the prefab

### Prefab Instances

- Display a blue bar in the Hierarchy
- Linked to the prefab asset
- Changes to the asset propagate to all instances

### Editing Prefabs

**Prefab Mode:**
- **In Isolation**: Only the prefab is visible
- **In Context**: Prefab is visible within the scene (scene is locked)

**Open methods:**
- Double-click prefab asset in Project window
- Select instance → Inspector → **Open** button
- Select instance → press **P**

**Context view options:**
- Normal, Gray (scene dimmed), Hidden

```csharp
// Check if object is a prefab instance
bool isPrefab = PrefabUtility.IsPartOfPrefabInstance(gameObject);

// Get the source prefab asset
GameObject source = PrefabUtility.GetCorrespondingObjectFromSource(gameObject);
```

### Overrides

Changes made to a prefab instance that differ from the asset:

| Override Type | Visual Indicator |
|---|---|
| Modified property | Blue line in Inspector margin |
| Added component | Plus badge |
| Removed component | Minus badge |
| Added child GameObject | Plus badge on icon |

**Apply / Revert:**
- Select instance → Inspector → **Overrides** dropdown
- Apply All / Revert All
- Apply Selected / Revert Selected (Ctrl/Cmd or Shift to multi-select)
- Right-click individual property → Apply / Revert

**Transform notes:**
- Position and Rotation are not explicit overrides on root (they always differ)
- Rect Transform: Width, Height, Margins, Anchors, Pivot are not considered overrides

### Nested Prefabs

Prefab instances inside other prefabs. They maintain their own prefab link while being part of the parent.

**How to create:**
1. Open parent prefab in Prefab Mode
2. Drag a prefab asset into the hierarchy

The nested prefab appears with a green plus (override) until applied to the parent.

### Prefab Variants

Inherit from a base prefab. Overrides in the variant take precedence.

**Visual:** Blue cube with one hashed side.

**Create:**
- Project window → Right-click prefab → Create → Prefab Variant
- Or drag a prefab instance into Project window → select "Prefab Variant"

**Editing:**
- Open variant in Prefab Mode
- Root appears as a prefab instance of the base
- Changes override the base
- Use **Revert All** to reset, **Apply all to Prefab Variant parent** to commit

### Instantiating Prefabs at Runtime

```csharp
public GameObject enemyPrefab;

void SpawnEnemy(Vector3 position)
{
    // Basic
    GameObject enemy = Instantiate(enemyPrefab);

    // With position and rotation
    GameObject enemy = Instantiate(enemyPrefab, position, Quaternion.identity);

    // With parent
    GameObject enemy = Instantiate(enemyPrefab, parentTransform);

    // With position, rotation, and parent
    GameObject enemy = Instantiate(enemyPrefab, position, Quaternion.identity, parentTransform);
}
```

### Replacing Prefabs

**Replace prefab asset:**
1. Select GameObject or prefab instance in Hierarchy
2. Drag onto existing prefab asset in Project window
3. Unity matches by name to preserve references

**Replace instance's parent prefab:**
- Inspector: Drag new prefab into "Prefab" field → choose "Replace" or "Replace and Keep Overrides"
- Hierarchy: Right-click → Prefab → Replace
- Ctrl/Cmd+drag prefab onto instance

---

## Hierarchy Window

The Hierarchy window lists all GameObjects in the current scene(s).

### Creating GameObjects

```
Right-click in Hierarchy → Select GameObject type
Shortcut: Ctrl+Shift+N (Cmd+Shift+N)
```

### Duplicating

```
Right-click → Duplicate
Shortcut: Ctrl+D (Cmd+D)
```

### Parenting and Grouping

```csharp
// Set parent
transform.SetParent(parentTransform);

// Unparent
transform.SetParent(null);

// Keep world position when parenting
transform.SetParent(parentTransform, worldPositionStays: true);
```

**Editor shortcuts:**
- Drag child onto parent in Hierarchy
- **Create Empty Parent**: Ctrl+Shift+G (Cmd+Shift+G)
- **Paste as Child**: Ctrl+Shift+V (Cmd+Shift+V)

### Default Parent

Set a GameObject as the default parent — new objects automatically become its children.

```
Right-click GameObject → Set as Default Parent
Right-click GameObject → Clear Default Parent
```

### Scene Visibility and Pickability

| Control | Icon | Shortcut | Purpose |
|---|---|---|---|
| Visibility | Eye | H | Hide/show in Scene view |
| Pickability | Hand | L | Toggle selectable in Scene view |

- Alt+click foldout arrow to toggle all descendants
- These are editor-only; do not affect runtime or the GameObject's active state

### Override Indicators in Hierarchy

- **Blue line** next to prefab instance: has overrides
- **Plus badge** on icon: added GameObject or component
- Click the blue line to open Overrides dropdown

### New Hierarchy View (Preview)

Enable: `Edit > Preferences > General > New Hierarchy`

Shows additional columns:
- Visibility, Picking, Active, Static, Layer, Tag
- Alternate row highlighting

---

## Best Practices

1. **Name GameObjects clearly**: Use descriptive names for easy identification in Hierarchy.
2. **Use empty GameObjects as organizers**: Group related objects under empty parents.
3. **Leverage prefabs for reusability**: Any object used more than once should be a prefab.
4. **Apply overrides intentionally**: Don't leave unapplied overrides lingering — apply or revert them.
5. **Use nested prefabs for complex objects**: Break down large prefabs into smaller reusable ones.
6. **Use prefab variants for similar objects**: Create a base prefab, then variants for specific types.
7. **Prefer `CompareTag()` over `tag ==`**: Avoids string allocation and is faster.
8. **Use LayerMasks for physics queries**: More performant than filtering by tag after the fact.
9. **Deactivate unused objects**: `SetActive(false)` is cheaper than destroying and re-instantiating.
10. **Use static flags for non-moving objects**: Enables lighting baking, occlusion culling, and batching.
11. **Keep Transform operations in `LateUpdate` for camera follow**: Ensures target has finished moving.
12. **Avoid deep hierarchies when possible**: Deep nesting can impact performance and complexity.

---

## Key Classes Quick Reference

| Class | Purpose |
|---|---|
| `GameObject` | The fundamental scene object |
| `Transform` | Position, rotation, scale, and hierarchy |
| `MonoBehaviour` | Base class for custom components |
| `Component` | Base class for all components |
| `Object` | Base class for Unity-engine objects |
| `PrefabUtility` | Editor API for prefab operations |
| `LayerMask` | Bitmask for layer filtering |

---

## Common Operations Cheat Sheet

| Operation | Code |
|---|---|
| Create empty GO | `new GameObject("Name")` |
| Create GO with component | `new GameObject("Name", typeof(Light))` |
| Create primitive | `GameObject.CreatePrimitive(PrimitiveType.Cube)` |
| Destroy GO | `Destroy(gameObject)` |
| Activate/deactivate | `gameObject.SetActive(true/false)` |
| Add component | `gameObject.AddComponent<T>()` |
| Get component | `GetComponent<T>()` |
| Find by tag | `GameObject.FindWithTag("Tag")` |
| Find by name | `GameObject.Find("Name")` |
| Find all by tag | `GameObject.FindGameObjectsWithTag("Tag")` |
| Set parent | `transform.SetParent(parent, true)` |
| Instantiate prefab | `Instantiate(prefab, position, rotation, parent)` |
| Check prefab instance | `PrefabUtility.IsPartOfPrefabInstance(go)` |
| Set layer | `gameObject.layer = LayerMask.NameToLayer("Name")` |
| Get layer mask | `LayerMask.GetMask("Name1", "Name2")` |

---

## Additional Resources

- **Scripting API**: `UnityEngine.GameObject`, `UnityEngine.Transform`, `UnityEngine.MonoBehaviour`
- **Prefabs**: See PrefabUtility for editor scripting
- **Scenes**: See `working-with-scenes.html` for scene management
- **Physics**: Use layers with `Physics` and `Physics2D` APIs
