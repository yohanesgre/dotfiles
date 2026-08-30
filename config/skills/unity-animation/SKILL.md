---
name: unity-animation
description: Comprehensive reference for Unity's animation systems covering 3D Mecanim (Animator, State Machines, Blend Trees), 2D animation (frame-by-frame and skeletal), performance optimization, and runtime scripting. Based on Unity 6.4 documentation.
---

# Unity Animation

## Description
Comprehensive reference for Unity's animation systems covering 3D Mecanim (Animator, State Machines, Blend Trees), 2D animation (frame-by-frame and skeletal), performance optimization, and runtime scripting. Based on Unity 6.4 documentation.

## When to Use
Load when working with animation in Unity: setting up Animator Controllers, creating animation states and transitions, using Blend Trees, animating 2D sprites (frame-by-frame or skeletal), optimizing animation performance, or scripting animation behavior at runtime.

## Core Concepts

### Animation System Overview
Unity offers two primary animation systems. **Mecanim** (Animator component + Animator Controller) is the recommended system for most situations — it provides state machines, blending, layering, and retargeting. **Legacy Animation** (Animation component) is simpler but limited; use only for backward compatibility or extremely simple single-clip playback where performance is critical (Legacy is faster than Mecanim for single clips without blending). For 2D, Unity adds the **2D Skeletal Animation Package** (bone-based deformation, 2D IK, Sprite Library) on top of Mecanim's foundation.

### Animator Component
The Animator component assigns animation to a GameObject. It requires a reference to an Animator Controller.

| Property | Description |
|----------|-------------|
| **Controller** | The Animator Controller asset attached to this character |
| **Avatar** | The Avatar for this character (required for Humanoid rigs) |
| **Apply Root Motion** | Whether to control position/rotation from animation or script |
| **Update Mode** | When the Animator updates and which timescale to use |
| **Culling Mode** | Animation culling behavior when renderers are not visible |

**Update Mode values:**
- `Normal` — Updated in-sync with `Update()`, speed matches current timescale
- `Animate Physics` — Updated in-sync with `FixedUpdate()` (for physics interactions)
- `Unscaled Time` — Updated in-sync with `Update()` but ignores timescale (for UI)

**Culling Mode values:**
- `Always Animate` — Always animate, don't cull even when offscreen
- `Cull Update Transforms` — Retarget, IK and Transform writes disabled when not visible
- `Cull Completely` — Animation completely disabled when not visible (recommended default for performance)

**Animation Curve Information** (displayed in Inspector):
- `Clip Count` — Total number of animation clips
- `Curves (Pos, Rot & Scale)` — Curves for non-humanoid bone animation
- `Muscles` — Muscle curves for humanoid animation
- `Generic` — Float curves for material color, etc.
- `PPtr` — Sprite animation curves (2D system)
- `Curves Count` — Total combined animation curves
- `Constant / Dense / Stream` — Storage format breakdown

**Key optimization**: The Animator does minimal work when no Controller is assigned. If animation is not needed, set `controller = null`.

### Animator Controller
The Animator Controller arranges and maintains a set of Animation Clips and associated Transitions using a State Machine (flowchart of clips and transitions). Even with a single clip, you must place it in an Animator Controller. Unity auto-creates one when you begin animating via the Animation Window.

**Creation**: Right-click Project → Create → Animator Controller. Double-click to open in Animator Window.

**Navigation shortcuts**: Scroll wheel for zoom, `F` to focus on selected states, `A` to fit all states. During Play Mode, the view auto-pans to the current state.

### Animation State Machine
A state machine arranges animation actions as a graph of nodes (states) and connecting lines (transitions). A state machine is only in **one state at a time** and remains there until transition conditions are met.

**States** — Represent animations that play. Each references an Animation Clip or Blend Tree with motion settings (speed, mirroring) and transitions to other states.

**Transitions** — Define how to switch between states:
- **Conditions**: Parameters that trigger the transition
- **Exit Time**: When in the animation the transition can occur
- **Interruption**: Whether transitions can be interrupted (see Interruption Sources below)

**State Machine Transitions (Entry/Exit)**:
- **Entry Node** — Controls which state the state machine begins in based on parameter conditions
- **Exit Node** — Indicates the state machine should exit to parent

**Sub-State Machines**: State machines can be nested for organization. Use **Any State** transitions sparingly as they are evaluated every frame.

### Animation Parameters
Variables defined within an Animator Controller, accessible and assignable from scripts.

| Type | Description |
|------|-------------|
| **Float** | Number with fractional part |
| **Int** | Whole number |
| **Bool** | True/false value (persists until changed) |
| **Trigger** | Boolean automatically reset by controller after consumed by a transition |

### Animation Layers
Layers manage complex state machines for different body parts (e.g., lower-body for walking, upper-body for throwing/shooting).

**Layer Properties:**
- **Weight** — 0 to 1 blend weight. When weight is 0, Unity skips the layer update entirely (key performance optimization).
- **Mask** — Avatar Mask specifying which body parts the layer affects. `M` symbol indicates mask applied.
- **Blending Type**:
  - **Override** — Replaces animation from previous layers
  - **Additive** — Adds animation on top of previous layers (requires same properties in the additive layer)

**Layer Syncing** — Reuse the same state machine structure in different layers with different animation clips. The synced layer shares the state machine definition with the source layer but uses different clips. `S` symbol indicates synced layer. Useful for wounded/alternate behavior variants (same logic, different animations).

**Creating Layers**: Click `+` in Layers tab, configure mask and blending type.

### Blend Trees
Blend Trees smoothly blend multiple animations by incorporating parts of each at varying degrees, controlled by animation parameters.

| Feature | Transitions | Blend Trees |
|---------|-------------|-------------|
| Purpose | Switch between states | Blend multiple animations |
| Control | Time-based | Parameter-based |
| Use Case | Different motions | Similar motions at different intensities |

**Blend Types:**
1. **1D Blending** — Single parameter controls blend (e.g., speed 0→1 maps idle→walk→run)
2. **2D Simple Directional** — Two parameters, best for directional movement (e.g., 8-direction walk). Works when all motions have similar magnitude.
3. **2D Freeform Directional** — Two parameters, allows arbitrary blend positions. More flexible than Simple Directional.
4. **2D Freeform Cartesian** — Two parameters, treats X and Y independently (best when parameters have separate meaning).
5. **Direct** — Each child motion gets direct weight control via a parameter. No interpolation between clips.

**Requirements for smooth blending:**
- Animations must be of similar nature and timing
- Clip key moments should occur at the same normalized time
- Use normalized time so clips of different lengths blend properly

### Animator Override Controller
Overrides animation clips in an existing Animator Controller while retaining the structure, parameters, and logic of its state machine. Essential for creating animation variants for different characters (e.g., Goblin, Ogre, Elf sharing the same controller logic with different animations).

**Setup**: Assets → Create → Animation → Animator Override Controller. Assign the Base Controller, then replace original clips in the Override column.

**Critical**: When using Override Controllers, use **normalized time** for transition exit times. If using seconds, exit time may be ignored when the override clip is shorter than the transition exit time.

### Transition Interruption Sources
Control whether a transition can be interrupted by other transitions mid-execution.

| Value | Behavior |
|-------|----------|
| **None** | Transition cannot be interrupted (was called "Atomic") |
| **Source** | Can be interrupted by transitions in the source AnimatorState |
| **Destination** | Can be interrupted by transitions in the destination AnimatorState |
| **SourceThenDestination** | Can be interrupted by source OR destination (source has priority) |
| **DestinationThenSource** | Can be interrupted by source OR destination (destination has priority) |

**Ordered Interruption:**
- **Checked** — Ends when a valid transition OR the current transition is found
- **Unchecked** — Ends when a valid transition is found

**Transition Queue Behavior**: AnyState transitions are always added first. Other transitions are queued based on Interruption Source value.

### 2D Frame-by-Frame Animation
Traditional sprite animation: switch between sprite images at intervals using the Animation Window.

**Workflow:**
1. Import spritesheet or individual sprite frames
2. Open Animation Window (Window → Animation)
3. Select the GameObject with Sprite Renderer
4. Create new Animation Clip
5. Drag sprite frames into the timeline
6. Adjust Samples per second to control animation speed

**Animation Window shortcuts**: `,` (previous frame), `.` (next frame), `Alt+,` (previous keyframe), `Alt+.` (next keyframe), `F` (zoom to selected), `A` (fit all).

### 2D Skeletal Animation
The **2D Animation Package** (install via Package Manager) provides bone-based sprite deformation, similar to 3D skeletal animation for 2D sprites.

**Key Features:**
- **Bone Hierarchy** — Create and manage bone chains for sprite deformation
- **Sprite Skinning** — Assign bones to sprite mesh vertices with weight painting
- **Skinning Editor** — Dedicated editor in Sprite Editor for bone and weight management
- **PSDImporter** — Import Photoshop PSD files with layer information for rigging
- **2D IK** — Inverse Kinematics for procedural animation

**Rigging Workflow:**
1. Prepare sprites (PSD with layer groups for body parts)
2. Import with PSDImporter
3. Open Sprite Editor → Skinning Editor tab
4. Create bones with Bone tool (click to create, drag for chains)
5. Paint vertex weights with Weight Tools
6. Preview deformation in real-time
7. Animate bone transforms in the Animation Window

### Sprite Library & Swapping
Organize sprites into categories and swap them dynamically at runtime.

**Sprite Library Asset** — Container holding sprite references organized by label. Enables categorizing sprites (Idle, Walk, Run), runtime swapping, and character variation management.

**Sprite Resolver** — Component that references a Sprite Library and selects sprites by label at runtime.

**Setup**: Create Sprite Library Asset (Project → Create → Sprite Library), add categories and labels, assign to Sprite Library Component or Sprite Resolver on GameObject.

### 2D IK
Inverse Kinematics for 2D skeletal rigs. Available through the 2D Animation Package. Allows bones to automatically rotate to reach a target position. Implements FABRIK-style solving in 2D space (limited to X/Y plane).

### 2D vs 3D Mecanim Differences

| Aspect | 2D Skeletal Animation | 3D Mecanim |
|--------|----------------------|------------|
| **Avatar System** | Not required; uses Sprite Renderer | Required for humanoid retargeting |
| **Bone Representation** | 2D transforms (X, Y position, rotation) | 3D transforms with full hierarchy |
| **Mesh Deformation** | Sprite mesh vertices deform | 3D mesh vertices deform |
| **Import Pipeline** | PSDImporter with layer support | FBX/GLTF with rig definitions |
| **Retargeting** | Limited; typically per-character | Full body retargeting between rigs |
| **Performance** | Lighter weight | More resource intensive |
| **IK Solutions** | 2D IK (limited to X/Y plane) | Full 3D IK support |

**Similarities**: Both use Animator Controllers with state machines, Animation Parameters, Animation Clips, Blend Trees, Animation Layers, and Animation Events.

### Performance & Optimization

**Rig Type Performance:**
- **Humanoid** — Uses Avatar for retargeting between skeletons. More math-heavy (muscle-based system). On Android without NEON: 2-2.5x slower than Generic. Supports IK Goals and target matching.
- **Generic** — Direct bone transform mapping. Root motion adds cost; if not using root motion, ensure no root bone is selected.

**Animation Compression:**
| Type | Description |
|------|-------------|
| **Off** | No compression. Highest precision, largest file. Not advisable. |
| **Keyframe Reduction** | Reduces redundant keyframes on import. Affects file size and runtime memory. |
| **Keyframe Reduction and Compression** | Reduce keyframes + compress for storage. Legacy only. |
| **Optimal** | Let Unity decide (keyframe reduction or dense format). Generic and Humanoid only. |

**Compression Error Tolerances:**
- **Rotation Error** — Degrees. Key removed if: `Angle(value, reduced) < RotationError`
- **Position Error** — Percentage. Key removed if: `distance(original, reduced) < original * PositionError%`
- **Scale Error** — Percentage. Same formula as position.

**Curve Storage Formats:**
- **Constant** — Optimized for unchanging values (least cost)
- **Dense** — Discrete values with linear interpolation. Significantly less memory.
- **Stream** — Values with time/tangent data for curved interpolation. More memory, smoother.

**Optimize GameObjects** (model import setting): Removes all GameObjects without components, moves Skinned Mesh directly by animation, flattens hierarchy. **Significant performance increase** — use whenever possible. Trade-off: cannot parent objects to bones; use `extraExposedTransformPaths` to preserve specific bones for attachments.

**Bone Count Impact**: 15 additional bones on a 30-bone rig → 50% longer solve time in Generic mode. Use as few bones as possible. Use maximum 4 influences per vertex. Use single Skinned Mesh Renderer per character (splitting into two roughly doubles rendering time). Use 1-3 materials per character.

**Scale Curves**: Animating scale curves is more expensive than translation/rotation. Avoid scale animation. Exception: constant curves are optimized and inexpensive.

**Parameter Hashing**: Use `Animator.StringToHash()` and integer parameter IDs instead of strings for all runtime parameter access. String lookups have CPU overhead.

**Avatar Masks**: Prevent animation data from writing to specific body parts. Humanoid: masks based on humanoid body parts. Generic: masks based on bone paths. Use for upper-body layers, facial animations, weapon animations.

**Culling Best Practice**: Set Animator Culling Mode to `Cull Completely` and disable Skinned Mesh Renderer's `Update When Offscreen` property. This prevents animation updates when characters are not visible.

**Layer Weight**: When a layer's weight is zero, Unity skips the layer update entirely. Set unused layer weights to 0 for free performance.

**Animation Jobs**: Leverage the C# Job System and Burst Compiler for multithreaded animation processing. Key APIs: `AddJobDependency`, `BindCustomStreamProperty`, `BindSceneTransform`, `OpenAnimationStream`, `ResolveAllStreamHandles`.

## Code Patterns

### Basic Animator Parameter Control
```csharp
using UnityEngine;

public class SimplePlayer : MonoBehaviour
{
    Animator animator;

    // Use hashes instead of strings for performance
    private readonly int ForwardHash = Animator.StringToHash("Forward");
    private readonly int StrafeHash = Animator.StringToHash("Strafe");
    private readonly int FireHash = Animator.StringToHash("Fire");
    private readonly int DieHash = Animator.StringToHash("Die");

    void Start()
    {
        animator = GetComponent<Animator>();
    }

    void Update()
    {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        bool fire = Input.GetButtonDown("Fire1");

        animator.SetFloat(ForwardHash, v);
        animator.SetFloat(StrafeHash, h);
        animator.SetBool(FireHash, fire);
    }

    void OnCollisionEnter(Collision col)
    {
        if (col.gameObject.CompareTag("Enemy"))
            animator.SetTrigger(DieHash);
    }
}
```

### SetFloat with Damping
```csharp
// Smooth transition with damping (absorbs sudden changes)
animator.SetFloat("Speed", targetSpeed, dampTime, Time.deltaTime);

// Overloads:
// SetFloat(string name, float value)
// SetFloat(string name, float value, float dampTime, float deltaTime)
// SetFloat(int id, float value)
// SetFloat(int id, float value, float dampTime, float deltaTime)
```

### CrossFade Between States
```csharp
// Basic - fade to "Run" over 0.5 normalized seconds
animator.CrossFade("Run", 0.5f);

// With layer and time offset
animator.CrossFade("Run", 0.5f, layerIndex, normalizedTimeOffset);

// Using hash for performance
int runStateHash = Animator.StringToHash("Base Layer.Run");
animator.CrossFade(runStateHash, 0.5f);

// Full signature:
// CrossFade(string stateName, float normalizedTransitionDuration, int layer = -1,
//          float normalizedTimeOffset = float.NegativeInfinity,
//          float normalizedTransitionTime = 0.0f)
// CrossFade(int stateHashName, float normalizedTransitionDuration, int layer = -1,
//          float normalizedTimeOffset = 0.0f, float normalizedTransitionTime = 0.0f)
```

### Play State Immediately (No Blending)
```csharp
// Immediately jump to a state
int bounceStateHash = Animator.StringToHash("Base Layer.Bounce");
animator.Play(bounceStateHash, 0, 0.25f); // Start at 25% of the animation

// Play(string stateName, int layer = -1, float normalizedTime = float.NegativeInfinity)
// Play(int stateNameHash, int layer = -1, float normalizedTime = float.NegativeInfinity)
```

### Check Current Animation State
```csharp
AnimatorStateInfo stateInfo = animator.GetCurrentAnimatorStateInfo(0);

if (stateInfo.IsName("Jump"))
{
    Debug.Log("Jumping");
}

// Print full path hash for debugging
Debug.Log($"State: {stateInfo.fullPathHash}");

// Access state properties:
float normalizedTime = stateInfo.normalizedTime; // 0-1 progress
float speed = stateInfo.speed;
float length = stateInfo.length;  // duration in seconds
int tagHash = stateInfo.tagHash;  // tag associated with state
bool isLooping = stateInfo.loop;
```

### Trigger with Reset Pattern
```csharp
// Reset trigger before setting another (prevents conflicts)
if (Input.GetKey(KeyCode.UpArrow))
{
    animator.ResetTrigger("Crouch");
    animator.SetTrigger("Jump");
}
if (Input.GetKey(KeyCode.DownArrow))
{
    animator.ResetTrigger("Jump");
    animator.SetTrigger("Crouch");
}
// Also supports hashed versions:
// animator.SetTrigger(triggerHash);
// animator.ResetTrigger(triggerHash);
```

### Layer Weight Control (Performance-Conscious)
```csharp
public class LayerWeightControl : MonoBehaviour
{
    public Animator animator;
    public int layerIndex = 1;

    void Update()
    {
        // When weight is 0, Unity skips the layer update entirely
        float targetWeight = IsAiming() ? 1f : 0f;
        float current = animator.GetLayerWeight(layerIndex);
        animator.SetLayerWeight(layerIndex, Mathf.Lerp(current, targetWeight, Time.deltaTime * 10f));
    }
}
```

### Override Animator Controller at Runtime
```csharp
// Create an override controller at runtime
AnimatorOverrideController overrideController = new AnimatorOverrideController();
overrideController.runtimeAnimatorController = animator.runtimeAnimatorController;

// Swap specific animation clips
overrideController["OriginalClipName"] = replacementClip;

// Assign to the animator
animator.runtimeAnimatorController = overrideController;

// Get list of overrides
var overrides = new List<KeyValuePair<AnimationClip, AnimationClip>>();
overrideController.GetOverrides(overrides);
```

### 2D Sprite Swapping at Runtime
```csharp
using UnityEngine;
using UnityEngine.U2D;

public class SpriteSwapper : MonoBehaviour
{
    [SerializeField] private SpriteLibrary spriteLibrary;
    [SerializeField] private string categoryName = "Animation";

    public void SwapSprite(string spriteLabel)
    {
        if (spriteLibrary != null)
            spriteLibrary.SetCategoryLabel(categoryName, spriteLabel);
    }

    public void NextSprite(string[] labels, ref int index)
    {
        index = (index + 1) % labels.Length;
        SwapSprite(labels[index]);
    }
}
```

### Animation Event Callback
```csharp
public class AnimationEventHandler : MonoBehaviour
{
    // Called by Animation Events placed on keyframes in the Animation window
    public void OnFootstep()
    {
        // Play footstep sound, spawn particles, etc.
    }

    public void OnAttackHit()
    {
        // Enable hitbox, deal damage
    }

    public void OnAnimationComplete()
    {
        // Trigger next action, return to Idle, etc.
    }
}
```

### Dynamic Culling Based on Distance
```csharp
public class DynamicCulling : MonoBehaviour
{
    public float cullDistance = 50f;
    private Animator animator;
    private SkinnedMeshRenderer skinnedMesh;

    void Start()
    {
        animator = GetComponent<Animator>();
        skinnedMesh = GetComponent<SkinnedMeshRenderer>();
        if (skinnedMesh != null)
            skinnedMesh.updateWhenOffscreen = false; // Always disable for performance
    }

    void Update()
    {
        if (Camera.main == null) return;
        float distance = Vector3.Distance(transform.position, Camera.main.transform.position);
        animator.cullingMode = distance > cullDistance
            ? AnimatorCullingMode.CullCompletely
            : AnimatorCullingMode.AlwaysAnimate;
    }
}
```

### Avatar Mask Setup at Runtime
```csharp
AvatarMask mask = new AvatarMask();

// Enable upper body, disable lower body
mask.SetHumanoidBodyPartActive(AvatarBodyPart.Head, true);
mask.SetHumanoidBodyPartActive(AvatarBodyPart.LeftArm, true);
mask.SetHumanoidBodyPartActive(AvatarBodyPart.RightArm, true);
mask.SetHumanoidBodyPartActive(AvatarBodyPart.Root, false);
mask.SetHumanoidBodyPartActive(AvatarBodyPart.Body, false);
mask.SetHumanoidBodyPartActive(AvatarBodyPart.LeftLeg, false);
mask.SetHumanoidBodyPartActive(AvatarBodyPart.RightLeg, false);

animator.SetLayerMask(upperBodyLayerIndex, mask);
```

### Optimize GameObjects with Exposed Transforms (Editor)
```csharp
// In an AssetPostprocessor or Editor script:
void ConfigureModelImport(ModelImporter importer)
{
    importer.optimizeGameObjects = true;
    // Preserve specific bones for runtime attachment (weapons, hats, etc.)
    importer.extraExposedTransformPaths = new[] {
        "Root/Hips/Spine/RightHand",
        "Root/Hips/Spine/LeftHand",
        "Root/Hips/Spine/Head"
    };
}
```

## Key Classes and Components Reference

| Class/Component | Purpose |
|----------------|---------|
| **Animator** | Controls animation playback on a GameObject. Main scripting entry point. |
| **AnimatorController** | Asset defining the state machine, layers, parameters, and transitions. |
| **AnimatorOverrideController** | Overrides clips in a base controller while preserving logic. |
| **AnimationClip** | Individual animation data (keyframes, curves, events). |
| **AnimatorStateInfo** | Read-only snapshot of the current state (name, time, speed, tag). |
| `GetCurrentAnimatorStateInfo(layer)` | Returns AnimatorStateInfo for a given layer. |
| `GetNextAnimatorStateInfo(layer)` | Returns state info for the state being transitioned to. |
| **AnimatorControllerParameter** | Describes a parameter (name, type, default value). |
| **Avatar** | Humanoid bone mapping for retargeting. |
| **AvatarMask** | Defines which body parts to include/exclude per layer. |
| **BlendTree** | Blends multiple animations by parameter values. |
| **SpriteRenderer** | Renders 2D sprites in the scene. Target of 2D animation. |
| **SpriteLibrary / SpriteLibraryAsset** | Organizes sprites by category/label for runtime swapping. |
| **SkinnedMeshRenderer** | Renders deformed meshes for characters. Set `updateWhenOffscreen = false` for performance. |
| **ModelImporter** | Controls model import settings including animation compression and optimizeGameObjects. |
| **AnimationStream** | Low-level stream API for Animation Jobs. |
| **IJob / IJobParallelFor** | C# Job System interfaces for custom animation processing. |
| `SetFloat / SetBool / SetInteger / SetTrigger` | Primary parameter-setting methods on Animator. |
| `Play / CrossFade / CrossFadeInFixedTime` | State transition methods. |
| `StringToHash` | Converts parameter/state names to integer hashes for performance. |
| `AnimatorJobExtensions` | Static class with `AddJobDependency`, `BindCustomStreamProperty`, etc. |

## Best Practices

1. **Always use parameter hashes** (`Animator.StringToHash`) instead of strings for all runtime Animator calls to avoid string lookup overhead.
2. **Set Culling Mode to `Cull Completely`** on all Animators and disable `updateWhenOffscreen` on SkinnedMeshRenderers unless the character must animate while invisible.
3. **Set layer weights to 0** when a layer is not in use — Unity skips the layer update entirely, making it essentially free.
4. **Use `Optimize GameObjects`** on imported models whenever possible. Use `extraExposedTransformPaths` only for bones that need runtime attachment (weapons, hats).
5. **Use Generic rig instead of Humanoid** unless you specifically need retargeting, IK Goals, or target matching — Humanoid is 2-2.5x slower (especially on mobile).
6. **Avoid animating scale curves** — they are more expensive than translation and rotation. Constant scale curves are fine.
7. **Use a single Skinned Mesh Renderer** per character with 1-3 materials. Splitting into multiple SMRs can double rendering time.
8. **Keep bone counts minimal** — 15 extra bones on a 30-bone rig costs ~50% more solve time in Generic mode.
9. **Use normalized time for transition exit times** when employing Animator Override Controllers, since override clips may have different lengths.
10. **Keep `Any State` transitions to a minimum** — they are evaluated every frame and can become expensive with many conditions.
11. **Prefer Blend Trees over many individual states** for similar motions (e.g., idle→walk→run at different speeds). Blend Trees are parameter-driven and avoid transition overhead.
12. **Use `CrossFade` instead of `Play`** when smooth transitions matter. `Play` jumps immediately without blending.
13. **Use Trigger parameters** for one-shot events (jump, attack, hit) — they auto-reset after consumption, avoiding stale state.
14. **For 2D skeletal animation**, import character art as layered PSD via PSDImporter rather than as separate sprites to preserve rigging structure.
15. **Consider Animation Jobs + Burst** for heavy procedural animation — it offloads work to worker threads and can significantly reduce main-thread CPU usage.

## Additional Resources

- [Animator Component](https://docs.unity3d.com/Manual/class-Animator.html)
- [Animator Controller](https://docs.unity3d.com/Manual/class-AnimatorController.html)
- [Animation State Machines](https://docs.unity3d.com/Manual/AnimationStateMachines.html)
- [Animation Parameters](https://docs.unity3d.com/Manual/AnimationParameters.html)
- [Animation Layers](https://docs.unity3d.com/Manual/AnimationLayers.html)
- [Animation Blend Trees](https://docs.unity3d.com/Manual/class-BlendTree.html)
- [Animator Override Controller](https://docs.unity3d.com/Manual/AnimatorOverrideController.html)
- [Animation Clip Compression](https://docs.unity3d.com/Manual/class-AnimationClip.html)
- [Mecanim Performance and Optimization](https://docs.unity3d.com/Manual/MecanimPeformanceandOptimization.html)
- [Modeling Characters for Optimal Performance](https://docs.unity3d.com/Manual/ModelingOptimizedCharacters.html)
- [State Machine Transition Interruptions](https://unity.com/blog/engine-platform/state-machine-transition-interruptions)
- [Unity Job System Overview](https://docs.unity3d.com/Manual/JobSystemOverview.html)
- [Animator Scripting API](https://docs.unity3d.com/ScriptReference/Animator.html)
- [AnimatorStateInfo](https://docs.unity3d.com/ScriptReference/AnimatorStateInfo.html)
- [2D Game Art, Animation, and Lighting (E-book)](https://unity.com/resources/2d-game-art-animation-lighting-for-artists-ebook)
- [How to Animate 2D Characters in Unity](https://unity.com/how-to/2d-characters-and-animation-unity-2022-lts)
