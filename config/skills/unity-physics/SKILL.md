---
name: unity-physics
description: Comprehensive reference for Unity's physics systems including built-in 3D (PhysX), 2D (Box2D), DOTS physics, character control, collisions, joints, articulations, ragdolls, cloth, optimization, and debugging. Based on Unity 6.4 documentation.
---

# Unity Physics

## Description
Comprehensive reference for Unity's physics systems including built-in 3D (PhysX), 2D (Box2D), DOTS physics, character control, collisions, joints, articulations, ragdolls, cloth, optimization, and debugging.

## When to Use
Load when working with any physics-related task in Unity: Rigidbodies, colliders, joints, character controllers, 2D physics, physics queries, collision detection, ragdoll setup, cloth simulation, physics optimization, or multi-scene physics.

## Core Concepts

### Physics Systems Overview

Unity provides four physics engines:

| Engine | Description | When to Use |
|--------|-------------|-------------|
| **Built-in 3D (PhysX)** | Default 3D engine backed by Nvidia PhysX | Standard object-oriented 3D projects |
| **Built-in 2D (Box2D)** | Default 2D engine backed by Box2D | All 2D projects |
| **Unity Physics (DOTS)** | Data-Oriented Technology Stack engine | Projects using Unity's DOTS framework; install `com.unity.physics` |
| **Havok Physics** | High-performance physics engine | Demanding physics simulations; install `com.havok.physics` |

3D and 2D physics run on separate simulation systems; 3D colliders/Joints do NOT interact with 2D counterparts.

---

### 3D Physics

#### Rigidbody Physics

The Rigidbody component enables physics-based movement. Always use Rigidbody properties/methods (not Transform) to move a non-kinematic Rigidbody. Using Transform directly on a non-kinematic Rigidbody causes incorrect physics simulation (especially with Joints).

**Body types** (via `isKinematic`):
- **Dynamic** (`isKinematic = false`) — Responds to forces, collisions, gravity. Use `AddForce()`, `AddTorque()`.
- **Kinematic** (`isKinematic = true`) — Detected by physics but not controlled by it. Can push dynamic bodies; cannot be pushed. Move via Transform or `MovePosition()`/`MoveRotation()`. ArticulationBody cannot be kinematic.

**Key properties**:

| Property | Default | Description |
|----------|---------|-------------|
| Mass | 1 | Kilograms. Does NOT affect fall speed under gravity (use Drag instead) |
| Drag | 0 | Linear velocity decay |
| Angular Drag | 0.05 | Rotational velocity decay |
| Use Gravity | true | Toggle gravity effect |
| Is Kinematic | false | Toggle kinematic mode |
| Interpolate | None | None / Interpolate (one-frame lag, more accurate) / Extrapolate (predicts ahead, best for constant velocity) |
| Collision Detection | Discrete | Discrete / Continuous / Continuous Dynamic / Continuous Speculative |
| Constraints | — | Freeze Position/Rotation per-axis (X, Y, Z) |
| Solver Iterations | — | Per-body override for solver iteration count |
| Solver Velocity Iterations | — | Per-body override for velocity iteration count |
| maxLinearVelocity | — | Max linear velocity cap (default from project settings) |
| maxAngularVelocity | — | Max angular velocity cap (default: 50 rad/s) |
| maxDepenetrationVelocity | Infinity | Max velocity when solver pulls bodies out of overlap |

**Collision detection modes**:

| Mode | Cost | Use for |
|------|------|---------|
| Discrete | Low | Normal-speed objects |
| Continuous | Medium | Fast objects vs static colliders (sweep-based CCD) |
| Continuous Dynamic | High | Fast objects vs any colliders (sweep-based CCD) |
| Continuous Speculative | Lower | Fast objects, less accurate but cheaper than Continuous |

**Sleeping**: Rigidbodies with energy below `sleepThreshold` (project default: 0.005) stop being simulated. Wake on collision or force. Script control: `Rigidbody.Sleep()` / `Rigidbody.WakeUp()`. A static collider moved via Transform may not wake sleeping bodies — call `WakeUp()` explicitly.

**Interpolation**: Only enable when needed (visible jitter). Interpolate is more accurate but has 1-frame lag; Extrapolate predicts but can overshoot. When interpolation is enabled, use `Physics.SyncTransforms()` after direct Transform changes.

**Constant Force component**: Applies constant linear or rotational acceleration (not constant speed — velocity increases indefinitely unless Drag limits it). Properties: `Force` (global), `Relative Force` (local), `Torque`, `Relative Torque`.

---

#### Character Control

The **CharacterController** component provides non-physics-based character movement with capsule-shaped collision. It is always upright and responds instantly without momentum.

**When to use CharacterController vs Rigidbody**:

| Scenario | Component |
|----------|-----------|
| First/third person with instant response | CharacterController |
| Platformer with precise jump control | CharacterController |
| Physics-based character (realistic momentum) | Rigidbody |
| Vehicle with realistic physics | Rigidbody |
| Pushable objects | Rigidbody |
| Moving platforms, sliding doors | Rigidbody (Kinematic) |

**CharacterController properties**:

| Property | Description |
|----------|-------------|
| Slope Limit | Max slope angle (degrees) the character can climb |
| Step Offset | Max stair height the character steps up. Should be ≤ height. Recommended: 0.1–0.4 for 2m human |
| Skin Width | Penetration tolerance. Larger = less jitter. Good setting: 10% of Radius. Minimum >0.01 |
| Min Move Distance | Movement below this value is ignored (reduces jitter). Usually 0 |
| Center | Capsule center offset |
| Radius | Capsule radius (width) |
| Height | Capsule height (scales along Y) |

**Fine-tuning guidelines**: Fit Height/Radius to character mesh (~2m human). Slope Limit 90° works best (capsule shape prevents wall climbing). Skin Width > 10% of Radius.

**Important notes**: The Controller does NOT react to forces or automatically push Rigidbodies. To push Rigidbodies, use `OnControllerColliderHit()`. If the character should be affected by physics, use a Rigidbody instead.

---

#### Collision & Colliders

Colliders define physical boundaries. For collision: both GameObjects need Colliders; at least one needs a Rigidbody.

**Collider types by GameObject configuration**:
- **Static Collider**: Collider without Rigidbody/ArticulationBody. Does not move, does not respond to forces. Do NOT move via Transform at runtime.
- **Dynamic Collider**: Collider on a non-kinematic Rigidbody. Responds to forces/collisions.
- **Kinematic Collider**: Collider on a kinematic Rigidbody. Can push dynamic bodies, can't be pushed, wakes sleeping bodies.

**Collider shape types**:
- **Primitive** (Box, Sphere, Capsule) — cheap, convex. Combine for compound colliders.
- **Mesh Collider** — accurate but expensive. Concave by default; must enable **Convex** on non-kinematic Rigidbodies (otherwise runtime error). Convex hull is approximate.
- **Wheel Collider** — for vehicles, raycasting-based with suspension and tire friction.
- **Terrain Collider** — matches Terrain shape.

**Trigger vs Collision**: Enable `Is Trigger` to make a collider detect overlap without physical collision. At least one GameObject must have a Rigidbody for triggers to fire. Use static colliders as triggers and add Rigidbody to objects passing through.

**Collision event callbacks**:

```csharp
void OnCollisionEnter(Collision collision) { }
void OnCollisionStay(Collision collision) { }
void OnCollisionExit(Collision collision) { }
```

Requirements: Both objects need Colliders, both need Rigidbody, at least one must be non-kinematic.

**Trigger event callbacks**:

```csharp
void OnTriggerEnter(Collider other) { }
void OnTriggerStay(Collider other) { }
void OnTriggerExit(Collider other) { }
```

Requirements: At least one object must have Rigidbody.

**Physics Material**: Controls surface friction and bounciness. Create via Create → Physics Material. Properties: Dynamic Friction, Static Friction, Bounciness (0–1), Friction Combine, Bounce Combine (Average/Minimum/Maximum/Multiply).

**Layer Collision Matrix**: Configure in Project Settings → Physics. Use `Physics.IgnoreLayerCollision()` / `Physics.GetIgnoreLayerCollision()` for script control. Reduces unnecessary collision checks.

**Convex vs Concave**: Non-kinematic Rigidbodies require convex colliders. Mesh Colliders are concave by default (enable Convex; better: use compound primitives or V-HACD).

---

#### Joints

Joints connect Rigidbodies, applying forces and enforcing limits. Each joint provides degrees of freedom on linear (X, Y, Z) and angular (X, Y, Z) axes.

| Joint | Function |
|-------|----------|
| **Fixed Joint** | Locks movement to follow another body (like Parenting via physics). Has break force/torque |
| **Hinge Joint** | Rotation around one axis (doors, pendulums). Has motor, spring, limits |
| **Spring Joint** | Elastic connection between two bodies (or body and space). Properties: Spring, Damper, Min/Max Distance |
| **Character Joint** | Ball-and-socket emulation (hips, shoulders). Axes: Twist, Swing1 (largest), Swing2 |
| **Configurable Joint** | Most powerful — emulates any skeletal joint. Full motion control (Free/Locked/Limited per axis), drives, projection, linear/angular limits |

**Hinge Joint key properties**: Anchor (pivot), Axis (rotation axis), Use Spring (Spring/Damper/TargetPosition), Use Motor (TargetVelocity/Force/FreeSpin), Use Limits (Min/Max angles, bounciness), Extended Limits (360°).

**Configurable Joint drive formula**: `positionSpring * (targetPosition - current) + positionDamper * (targetVelocity - currentVelocity)`, clamped by `maximumForce`.

**Joint stability tips**:
- Avoid small joint angles (5–15° minimum for Angular Y/Z Limits; 0 locks the axis)
- Disable Enable Preprocessing for ragdolls spawning partially inside walls
- Enable projection for extreme circumstances
- Increase Default Solver Iterations (10–20) and Velocity Iterations (10–20) for jittering joints
- Avoid non-uniform Transform scaling on objects with Rigidbody/Joint
- Avoid large mass ratios (10x or more causes jitter)

---

#### Articulations

**ArticulationBody** is for industrial/robotics applications (kinematic chains, robotic arms). Organized in a logical parent-child tree (max depth 64). Cannot form kinematic loops.

| Articulation vs Regular Joints | Articulation | Regular Joints |
|--------------------------------|-------------|----------------|
| Hierarchy | Must be parent-child tree | Independent |
| Constraint solving | Reduced coordinate space (more stable) | Maximal coordinate space |
| Kinematic loops | Not allowed | Allowed |
| Performance for chains | Better | Degrades with complexity |

**Joint types**: Fixed (rigid link), Prismatic (sliding), Revolute (hinge rotation), Spherical (two swings + one twist).

**Drive effect formula**: `stiffness * (targetPosition - drivePosition) + damping * (targetVelocity - driveVelocity)`. Linear drives produce forces; rotational drives produce torques.

**Key properties**: Mass, Immovable (root only), Use Gravity, joint drives (stiffness/damping/force limit/target/target velocity), anchors (position/rotation per body), motion locks (Free/Limited/Locked per axis).

Spherical joint degrees: Swing Y, Swing Z, Twist. Each can be Free/Limited/Locked. Cannot lock all three simultaneously.

---

#### Ragdoll Physics

Ragdolls use colliders, rigidbodies, and joints on a humanoid character skeleton. Set up via **GameObject > 3D Object > Ragdoll** wizard (drag limbs from hierarchy to wizard fields). Joints use CharacterJoint with axes: Twist, Swing1, Swing2.

**Animate-to-ragdoll transition**:

```csharp
void EnableRagdoll()
{
    GetComponent<Animator>().enabled = false;
    foreach (Rigidbody rb in GetComponentsInChildren<Rigidbody>())
    {
        rb.isKinematic = false;
    }
}
```

**Stability tips**: Disable Enable Preprocessing when spawning inside geometry. Enable projection on ConfigurableJoint/CharacterJoint. Increase solver iterations to 10–20. Lower `maxDepenetrationVelocity` if bodies overlap on spawn.

---

#### Cloth

The Cloth component works with Skinned Mesh Renderer for fabric simulation (character clothing only). Adding Cloth to a non-skinned mesh automatically adds SkinnedMeshRenderer.

**Key properties**: Stretching Stiffness, Bending Stiffness, Use Tethers, Use Gravity, Damping, External Acceleration, Random Acceleration, World Velocity/Acceleration Scale, Friction, Collision Mass Scale, Use Continuous Collision, Use Virtual Particles, Solver Frequency, Sleep Threshold.

**Colliders**: Cloth only interacts with Sphere and Capsule colliders added to its `capsuleColliders` / `sphereColliders` arrays. One-way simulation (cloth reacts to bodies, not vice versa).

**Constraints tool**: Max Distance (how far from original position) and Surface Penetration (depth into colliders). Edit via Select/Paint/Gradient modes.

**Self-collision/Inter-collision**: Configure in cloth inspector — set Inter-Collision Distance (< smallest particle distance) and Inter-Collision Stiffness.

---

#### Multi-Scene Physics

Independent physics scenes allow isolated simulations. Created via `SceneManager.CreateScene()` with `LocalPhysicsMode`:

```csharp
var parameters = new CreateSceneParameters(LocalPhysicsMode.Physics3D);
Scene physicsScene = SceneManager.CreateScene("PhysicsScene", parameters);
PhysicsScene ps = physicsScene.GetPhysicsScene();
```

**Use cases**: Trajectory prediction, character isolation (filter collisions), deterministic reloadable scenes. Objects move between scenes via `SceneManager.MoveGameObjectToScene()`.

---

#### Optimization

| Technique | How |
|-----------|-----|
| Fixed timestep | Adjust `Time.fixedDeltaTime` (default 0.02 = 50 Hz). Lower = more accurate, higher CPU cost |
| Solver iterations | Project Settings: Default Solver Iterations (6–20), Velocity Iterations (1–20). Per-body overrides available |
| Sleep | Increase `sleepThreshold` to put more bodies to sleep. `autoSimulation = false` + manual `Physics.Simulate()` for query-only games |
| Layer matrix | Disable collisions between layers that never interact |
| Collider types | Prefer primitive over mesh; use Convex mesh or compound primitives. Mesh Colliders are expensive |
| Collision detection | Use Discrete unless CCD is necessary. Speculative CCD is cheaper than Sweep |
| Broad-phase | Sweep and Prune, Multibox Pruning, or Automatic Box Pruning. Match to scene size |
| Friction type | Patch (stable, low iterations) or One Directional (simplified). Two Directional is most expensive |
| Solver type | Projected Gauss Seidel (default) or Temporal Gauss Seidel (better convergence for high-mass ratios) |
| Synchronization | Enable Auto Sync Transforms cautiously. Manually call `Physics.SyncTransforms()` when needed |

---

#### Debugging & Profiling

**Physics Debug window** (Window > Analysis > Physics Debugger): Visualize colliders, contacts, queries, and body info in Scene view. Tabs: Info, Filtering (layers/types), Rendering (colors/transparency), Contacts (impulses/separation), Queries (shapes/types).

**Physics Profiler** (Window > Analysis > Profiler): Charts for memory, active bodies, overlaps, queries. Key metrics:
- High Active Dynamic Bodies → increase sleep usage
- High Overlaps → use layer collision matrix
- High Physics Queries → optimize/cache raycasts
- High Broadphase Adds/Removes → object pooling

---

### 2D Physics

2D physics runs on Box2D, entirely separate from 3D. GameObjects move on XY plane and rotate around Z axis.

#### Rigidbody2D

| Body Type | Behavior |
|-----------|----------|
| Dynamic | Moves under simulation, affected by forces/gravity |
| Kinematic | Moves under simulation, not affected by forces. Can push dynamics, can't be pushed |
| Static | No simulation movement. Configured via Rigidbody2D (unlike 3D static colliders) |

Key properties: `velocity`, `mass`, `gravityScale`, `AddForce()`, `AddTorque()`, `constraints` (FreezePosition/Rotation). Collider2Ds on the same or child GameObject are implicitly attached.

#### Collider2D

**7 types**:
1. **Box Collider 2D** — Rectangle with offset and size. Edge Radius for rounded corners.
2. **Circle Collider 2D** — Radius and offset.
3. **Polygon Collider 2D** — Freeform closed edge via vertices. Auto Tiling support.
4. **Edge Collider 2D** — Open edge of line segments. Edge Radius and adjacent start/end for endpoint response.
5. **Capsule Collider 2D** — Rectangle + semicircles.
6. **Composite Collider 2D** — Boolean operations merging multiple primitives.
7. **Tilemap Collider 2D** — For tilemap systems.

Shared properties: Material (PhysicsMaterial2D), Is Trigger, Used by Effector, Layer Overrides (Include/Exclude/Force Send/Force Receive/Contact Capture/Callback layers).

#### Joints2D

All 9 types attach to Rigidbody2D or world space:

| Joint | Purpose |
|-------|---------|
| Distance Joint 2D | Maintains distance between two points |
| Fixed Joint 2D | Locks two bodies together (spring implementation) |
| Friction Joint 2D | Reduces relative motion |
| Hinge Joint 2D | Rotation around a point (doors) |
| Relative Joint 2D | Maintains relative position/angle |
| Slider Joint 2D | Movement along a line |
| Spring Joint 2D | Elastic connection |
| Target Joint 2D | Moves toward a target position |
| Wheel Joint 2D | Wheel suspension simulation |

#### Physics Material 2D

Create: Assets → Create → 2D → Physics Material 2D. Properties: Friction (0–1), Bounciness (0–1), Friction Combine, Bounce Combine (Average/Mean/Multiply/Minimum/Maximum). Assign to Collider2D.sharedMaterial.

#### Effectors2D

| Effector | Purpose |
|----------|---------|
| Area Effector 2D | Forces within a collider-defined area (Force Angle/Magnitude/Variation, Drag) |
| Buoyancy Effector 2D | Fluid simulation (Surface Level, Density, Flow Angle/Magnitude, Damping) |
| Platform Effector 2D | One-way platforms (Surface Arc, Side Friction/Bounce) |
| Point Effector 2D | Attract/repel from a point (Force Mode: Constant/Inverse Linear/Inverse Squared) |
| Surface Effector 2D | Tangential forces along surfaces like conveyor belts (Speed, Force Scale) |

#### 2D Collision Callbacks

```csharp
void OnCollisionEnter2D(Collision2D collision) { }
void OnCollisionStay2D(Collision2D collision) { }
void OnCollisionExit2D(Collision2D collision) { }

void OnTriggerEnter2D(Collider2D other) { }
void OnTriggerStay2D(Collider2D other) { }
void OnTriggerExit2D(Collider2D other) { }
```

Collision2D properties: `gameObject`, `rigidbody`, `collider`, `contacts[]`, `relativeVelocity`, `enabled`.

#### 2D Physics Queries

**Raycast**: `Physics2D.Raycast(origin, direction, distance, layerMask)` → `RaycastHit2D` (`.collider`, `.point`, `.normal`). `Physics2D.RaycastAll()` for all hits.

**CircleCast**: `Physics2D.CircleCast(origin, radius, direction, distance)` → `RaycastHit2D`. `CircleCastAll()` for all hits.

**BoxCast**: `Physics2D.BoxCast(center, size, angle, direction, distance)`.

**Overlap**: `Physics2D.OverlapPoint()`, `OverlapCircle()`/`OverlapCircleAll()`, `OverlapBoxAll()`, `OverlapCapsuleAll()`. Closest overlap: `OverlapCircle()` (single).

**Layer mask**: `LayerMask.GetMask("Enemy", "Ground")`. Invert: `~layerMask`. Global settings: `Physics2D.queriesHitTriggers`, `Physics2D.queriesStartInColliders`.

---

### Project Settings

Access via **Edit > Project Settings > Physics** (3D) and **Physics 2D** (2D).

#### 3D Physics Settings (key defaults)

| Setting | Default | Purpose |
|---------|---------|---------|
| Gravity | (0, -9.81, 0) | World gravity vector |
| Default Material | None | Physics Material for colliders without one |
| Bounce Threshold | 2 | Velocity below which objects don't bounce (reduces jitter) |
| Sleep Threshold | 0.005 | Energy below which bodies sleep |
| Default Contact Offset | 0.01 | Contact generation distance (must be positive) |
| Default Solver Iterations | 6 | Constraint solving iterations |
| Default Solver Velocity Iterations | 1 | Velocity solving iterations |
| Simulation Mode | Fixed Update | When physics runs: Fixed Update / Update / Script |
| Broadphase Type | Automatic | Sweep and Prune / Multibox Pruning / Automatic Box Pruning |
| Friction Type | Patch | Patch / One Directional / Two Directional |
| Solver Type | Projected Gauss Seidel | PGS / Temporal Gauss Seidel |
| Default Max Angular Speed | 50 rad/s | Cross-body max angular velocity |
| Queries Hit Triggers | On | Whether raycasts etc. hit triggers |
| Queries Hit Backfaces | Off | Whether queries hit MeshCollider backfaces |
| Reuse Collision Callbacks | On | Single Collision instance for GC reduction |
| Contact Pairs Mode | Default | Which pairs generate events (Kinematic-Kinematic/Static options) |
| Enable Adaptive Force | Off | Better force transmission through stacks |
| Auto Sync Transforms | Off | Auto-sync Transform changes with physics |

#### 2D Physics Settings (key defaults)

| Setting | Purpose |
|---------|---------|
| Gravity | Default gravity for Rigidbody2D |
| Velocity Iterations | Solver iterations for velocity |
| Position Iterations | Solver iterations for position |
| Bounce Threshold | Min relative velocity for elastic collision |
| Time to Sleep | Inactivity time before sleep |
| Linear Sleep Tolerance | Velocity below which body sleeps |
| Angular Sleep Tolerance | Rotation speed below which body sleeps |
| Default Contact Offset | Proximity for contact consideration |
| Simulation Mode | FixedUpdate / Update / Script |
| Use Multithreading | C# Job System simulation |
| Queries Hit Triggers | Include triggers in queries |
| Queries Start In Colliders | Detect colliders query starts inside |

---

## Code Patterns

### Basic Rigidbody Movement (3D)

```csharp
public class BasicMovement : MonoBehaviour
{
    public float speed = 5f;
    private Rigidbody rb;

    void Start() { rb = GetComponent<Rigidbody>(); }

    void FixedUpdate()
    {
        float x = Input.GetAxis("Horizontal");
        float z = Input.GetAxis("Vertical");
        Vector3 move = transform.right * x + transform.forward * z;
        rb.AddForce(move * speed);
    }
}
```

### Collision Callbacks

```csharp
void OnCollisionEnter(Collision collision)
{
    if (collision.gameObject.CompareTag("Projectile"))
        TakeDamage(collision.relativeVelocity.magnitude);
}

void OnTriggerEnter(Collider other)
{
    if (other.CompareTag("Pickup"))
        Destroy(other.gameObject);
}
```

### Physics Queries (3D)

```csharp
// Raycast
if (Physics.Raycast(origin, Vector3.down, out RaycastHit hit, 100f, layerMask))
    Debug.Log($"Hit {hit.collider.name} at {hit.point}");

// SphereCast
if (Physics.SphereCast(origin, 0.5f, direction, out RaycastHit hit2, 10f))
    Debug.Log($"SphereCast hit {hit2.collider.name}");

// OverlapSphere
Collider[] hits = Physics.OverlapSphere(center, 5f, layerMask);

// BoxCastNonAlloc (zero-allocation)
RaycastHit[] results = new RaycastHit[16];
int count = Physics.BoxCastNonAlloc(center, halfExtents, direction, results);
```

### 2D Movement and Queries

```csharp
// 2D Movement
Rigidbody2D rb = GetComponent<Rigidbody2D>();
rb.velocity = new Vector2(Input.GetAxis("Horizontal") * speed, rb.velocity.y);

// 2D Raycast
RaycastHit2D hit = Physics2D.Raycast(transform.position, Vector2.down, 2f, groundLayer);
if (hit.collider != null) isGrounded = true;

// Ground check with OverlapCircle
bool isGrounded = Physics2D.OverlapCircle(feet.position, 0.2f, groundLayer);

// LayerMask
int enemyLayer = LayerMask.GetMask("Enemy");
int everythingButPlayer = ~LayerMask.GetMask("Player");
```

### Character Controller Movement

```csharp
[RequireComponent(typeof(CharacterController))]
public class CharacterMovement : MonoBehaviour
{
    public float speed = 5f;
    public float gravity = -9.81f;
    public float jumpHeight = 2f;

    private CharacterController controller;
    private Vector3 velocity;
    private bool isGrounded;

    void Start() { controller = GetComponent<CharacterController>(); }

    void Update()
    {
        isGrounded = controller.isGrounded;
        if (isGrounded && velocity.y < 0) velocity.y = -2f;

        float x = Input.GetAxis("Horizontal");
        float z = Input.GetAxis("Vertical");
        Vector3 move = transform.right * x + transform.forward * z;
        controller.Move(move * speed * Time.deltaTime);

        if (Input.GetButtonDown("Jump") && isGrounded)
            velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);

        velocity.y += gravity * Time.deltaTime;
        controller.Move(velocity * Time.deltaTime);
    }

    void OnControllerColliderHit(ControllerColliderHit hit)
    {
        Rigidbody body = hit.collider.attachedRigidbody;
        if (body == null || body.isKinematic || hit.moveDirection.y < -0.3) return;
        Vector3 pushDir = new Vector3(hit.moveDirection.x, 0, hit.moveDirection.z);
        body.velocity = pushDir * 3f;
    }
}
```

### Auto-Simulation / Manual Control

```csharp
// Disable automatic physics step (query-only games)
Physics.autoSimulation = false;

// Manually step physics
void Update()
{
    Physics.Simulate(Time.fixedDeltaTime);
}
```

### ArticulationBody Drive Setup

```csharp
ArticulationBody body = GetComponent<ArticulationBody>();
body.jointType = ArticulationJointType.RevoluteJoint;

ArticulationDrive drive = body.xDrive;
drive.stiffness = 1000f;
drive.damping = 100f;
drive.forceLimit = 500f;
drive.target = 45f;
body.xDrive = drive;
```

### Cloth Configuration

```csharp
Cloth cloth = GetComponent<Cloth>();
cloth.externalAcceleration = new Vector3(0, -9.81f, 0);
cloth.randomAcceleration = new Vector3(0.5f, 0.5f, 0.5f);
cloth.useGravity = true;
cloth.stretchingStiffness = 0.5f;
cloth.bendingStiffness = 0.2f;
cloth.capsuleColliders = new CapsuleCollider[] { bodyCollider };
```

### Multi-Scene Physics

```csharp
var params = new CreateSceneParameters(LocalPhysicsMode.Physics3D);
Scene physicsScene = SceneManager.CreateScene("Simulation", params);
PhysicsScene ps = physicsScene.GetPhysicsScene();

// Move object to isolated scene
SceneManager.MoveGameObjectToScene(previewObject, physicsScene);
```

---

## Key Classes and Components Reference

| Class/Component | Purpose |
|----------------|---------|
| `Rigidbody` | 3D physics body — AddForce, velocity, mass, drag, constraints |
| `Rigidbody2D` | 2D physics body — velocity, gravityScale,AddForce |
| `CharacterController` | Non-physics 3D character movement — Move(), isGrounded |
| `ConstantForce` | Applies constant linear/angular force to a Rigidbody |
| `Collider` | Base class for 3D colliders |
| `BoxCollider` / `SphereCollider` / `CapsuleCollider` | Primitive 3D colliders |
| `MeshCollider` | Mesh-based 3D collider (Convex toggle) |
| `TerrainCollider` | Terrain-based 3D collider |
| `WheelCollider` | Vehicle wheel with suspension and friction |
| `Collider2D` | Base class for 2D colliders |
| `BoxCollider2D` / `CircleCollider2D` / `CapsuleCollider2D` | Primitive 2D colliders |
| `PolygonCollider2D` / `EdgeCollider2D` | Custom-shape 2D colliders |
| `CompositeCollider2D` | Boolean-merged 2D compound collider |
| `TilemapCollider2D` | Tilemap-based 2D collider |
| `PhysicsMaterial` / `PhysicsMaterial2D` | Surface friction/bounciness configuration |
| `FixedJoint` / `HingeJoint` / `SpringJoint` / `CharacterJoint` / `ConfigurableJoint` | 3D joint components |
| `DistanceJoint2D` / `HingeJoint2D` / `SpringJoint2D` / `SliderJoint2D` / etc. | 2D joint components |
| `ArticulationBody` | Industrial/robotics articulated physics body (Fixed/Prismatic/Revolute/Spherical joints) |
| `Cloth` | Fabric simulation with SkinnedMeshRenderer |
| `AreaEffector2D` / `BuoyancyEffector2D` / `PointEffector2D` / `PlatformEffector2D` / `SurfaceEffector2D` | 2D force effectors |
| `Physics` | Static 3D physics queries, settings (Raycast, SphereCast, OverlapSphere, gravity, autoSimulation, SyncTransforms) |
| `Physics2D` | Static 2D physics queries, settings (Raycast, CircleCast, OverlapCircle, queriesHitTriggers) |
| `PhysicsScene` | Per-scene physics handle from `Scene.GetPhysicsScene()` |
| `RaycastHit` | 3D raycast result (point, normal, distance, collider) |
| `RaycastHit2D` | 2D raycast result (point, normal, collider) |
| `Collision` / `Collision2D` | Collision event data (contacts, relativeVelocity, impulse) |
| `ControllerColliderHit` | CharacterController collision data |
| `LayerMask` | Bitmask for layer filtering in queries (`GetMask()`, `NameToLayer()`) |

---

## Best Practices

1. **Use Rigidbody methods, not Transform** — On non-kinematic Rigidbodies, use `AddForce()`, `velocity`, `MovePosition()`, `MoveRotation()` instead of modifying `transform.position`. If you must modify Transform, call `Physics.SyncTransforms()` after.

2. **Choose the right movement system** — Use CharacterController for instant-response characters; use Rigidbody for physics-driven movement; use Rigidbody (Kinematic) for moving platforms/doors.

3. **Move kinematic bodies correctly** — Use `Rigidbody.MovePosition()`/`MoveRotation()` not `transform.position`, especially with Joints.

4. **Match collision detection to needs** — Use Discrete for normal objects, Continuous for fast projectiles vs static geometry, Continuous Dynamic only when fast objects collide with other fast objects.

5. **Avoid moving static colliders** — Moving a static collider via Transform breaks physics assumptions. Convert to kinematic Rigidbody and move via `MovePosition()`.

6. **Use the Layer Collision Matrix** — Disable collisions between layers that never interact. This is the single biggest optimization for reducing overlap and contact processing.

7. **Enable interpolation only when needed** — Interpolation solves visual jitter from mismatched physics/frame rates. Use Interpolate for varying velocity; Extrapolate for constant velocity. It introduces overhead.

8. **Keep skin width appropriate** — CharacterController: ~10% of Radius, minimum >0.01. Too small causes sticking; too large causes floating.

9. **Profile before optimizing** — Use the Physics Profiler to identify bottlenecks (Active Dynamic Bodies, Overlaps, Queries) before changing solver iterations, timestep, or sleep thresholds.

10. **Use NonAlloc queries in hot paths** — `RaycastNonAlloc`, `OverlapSphereNonAlloc`, `BoxCastNonAlloc` avoid GC allocations. Pre-allocate result arrays.

11. **Prefer primitive/compound colliders over MeshColliders** — Mesh colliders are expensive. Use compound primitives or convex hulls (V-HACD) when possible. Only use Mesh Colliders on static geometry.

12. **Control physics lifecycle for non-simulating games** — Set `Physics.autoSimulation = false` and call `Physics.Simulate()` manually when you only need queries, not full simulation.

---

## Additional Resources

- [Unity 3D Physics Manual](https://docs.unity3d.com/Manual/PhysicsOverview.html)
- [Unity 2D Physics Manual](https://docs.unity3d.com/Manual/2d-physics/2d-physics.html)
- [Physics Project Settings Reference](https://docs.unity3d.com/Manual/class-PhysicsManager.html)
- [Nvidia PhysX Joints Guide](https://docs.nvidia.com/gameworks/content/gameworkslibrary/physx/guide/Manual/Joints.html)
- [Unity Physics Package (DOTS)](http://docs.unity3d.com/Packages/com.unity.physics@latest/index.html)
- [Havok Physics for Unity](https://docs.unity3d.com/Packages/com.havok.physics@latest/index.html)
- [Unity Articulation Robot Demo](https://github.com/Unity-Technologies/articulations-robot-demo)
- [Rigidbody API](https://docs.unity3d.com/ScriptReference/Rigidbody.html)
- [Rigidbody2D API](https://docs.unity3d.com/ScriptReference/Rigidbody2D.html)
- [Physics2D API](https://docs.unity3d.com/ScriptReference/Physics2D.html)
- [Collision event reference](https://docs.unity3d.com/Manual/CollidersOverview.html)
