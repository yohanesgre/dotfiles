---
name: unity-scripting-performance
description: Writing performant Unity C# code. Covers pooling, GC avoidance, coroutines, async/await, the Job System, and common pitfalls. Based on Unity 6.4 documentation.
---

# Unity Scripting Performance Skill

Comprehensive skill for writing performant Unity C# code. Covers pooling, GC avoidance, coroutines, async/await, the Job System, and common pitfalls.

**Excludes**: MonoBehaviour lifecycle, [Attributes], ScriptableObjects, testing, debugging — those live in other unity-scripting skills.

---

## 1. Object Pooling

Reuse objects instead of `Instantiate`/`Destroy` to avoid GC allocations and spawning overhead.

### ObjectPool<T> — Full Lifecycle

```csharp
using UnityEngine;
using UnityEngine.Pool;

public class BulletSpawner : MonoBehaviour
{
    [SerializeField] private Bullet bulletPrefab;
    [SerializeField] private Transform muzzlePoint;
    [SerializeField] private int defaultCapacity = 20;
    [SerializeField] private int maxSize = 100;

    private IObjectPool<Bullet> pool;

    private void Awake()
    {
        pool = new ObjectPool<Bullet>(
            createFunc:      () => Instantiate(bulletPrefab),
            actionOnGet:     b => b.gameObject.SetActive(true),
            actionOnRelease: b => b.gameObject.SetActive(false),
            actionOnDestroy: b => Destroy(b.gameObject),
            collectionCheck: true,
            defaultCapacity: defaultCapacity,
            maxSize:         maxSize);
    }

    private void Update()
    {
        if (Input.GetButtonDown("Fire1"))
        {
            Bullet b = pool.Get();
            b.transform.SetPositionAndRotation(muzzlePoint.position, muzzlePoint.rotation);
            b.Launch(pool);  // bullet releases itself later
        }
    }
}
```

### Pooled Bullet (self-releasing)

```csharp
public class Bullet : MonoBehaviour
{
    [SerializeField] private float lifetime = 3f;
    private IObjectPool<Bullet> owningPool;

    public void Launch(IObjectPool<Bullet> pool)
    {
        owningPool = pool;
        Invoke(nameof(Return), lifetime);
    }

    private void Return()
    {
        owningPool.Release(this);
    }
}
```

### ListPool / DictionaryPool — Zero-Alloc Temp Collections

```csharp
using UnityEngine.Pool;

void ProcessEnemies()
{
    // Alloc-free List — disposed automatically
    using (ListPool<Enemy>.Get(out var visible))
    {
        for (int i = 0; i < allEnemies.Count; i++)
            if (allEnemies[i].IsVisible)
                visible.Add(allEnemies[i]);

        visible.Sort((a, b) => a.Depth.CompareTo(b.Depth));
    } // returned to pool
}

// Dictionary variant
using (DictionaryPool<int, string>.Get(out var lookup)) { /* ... */ }
```

**Prefer `ListPool<T>.Get(out var list)` in hot paths over `new List<T>()`.**

---

## 2. Caching Component References

`GetComponent` is a native interop call — expensive in loops and `Update`.

```csharp
public class Player : MonoBehaviour
{
    // BAD — called every frame
    // void Update() { GetComponent<Rigidbody>().velocity = ...; }

    private Rigidbody rb;
    private Collider col;
    private Renderer rend;

    private void Awake()
    {
        rb   = GetComponent<Rigidbody>();
        col  = GetComponent<Collider>();
        rend = GetComponent<Renderer>();
    }

    private void Update()
    {
        rb.linearVelocity = transform.forward * speed;  // zero alloc
    }
}
```

**Also cache:** `Camera.main` (internally calls `FindGameObjectsWithTag`), `transform`, `gameObject` (the property access is cheap, but caching avoids the C++ interop).

```csharp
// Camera.main calls FindGameObjectsWithTag internally — cache it!
private Camera cam;
void Awake() { cam = Camera.main; }
void Update() { Vector3 pos = cam.WorldToScreenPoint(transform.position); }
```

---

## 3. Minimising Overhead of Many Update Loops

Unity's built-in `Update` callbacks incur a small per-component overhead from native/managed interop. When you have hundreds of active MonoBehaviours this adds up.

**Mitigations:**

1. **Central Update Manager** — one component calls update on a list of subscribers.

```csharp
public class UpdateManager : MonoBehaviour
{
    public static event Action<float> OnUpdate;

    private void Update()
    {
        OnUpdate?.Invoke(Time.deltaTime);
    }
}

// Subscriber does NOT have its own Update:
public class Drone : MonoBehaviour
{
    private void OnEnable()  => UpdateManager.OnUpdate += Tick;
    private void OnDisable() => UpdateManager.OnUpdate -= Tick;

    private void Tick(float dt) { /* move */ }
}
```

2. **Entity Component System (ECS)** — for thousands of entities, use DOTS with Burst-compiled jobs.

3. **Disable unused MonoBehaviours** — `enabled = false` skips all event functions.

---

## 4. Memory & Garbage Collection

### Heap Allocations in Hot Paths — Root Cause of GC Spikes

The GC runs non-deterministically and pauses the main thread. Every `new` of a reference type in a per-frame hot path is a potential frame spike.

| Allocating pattern | Zero-alloc alternative |
|---|---|
| `new List<T>()` in Update | `ListPool<T>.Get()` or pre-allocated member |
| `new WaitForSeconds(1f)` | Cache `readonly WaitForSeconds wait1s` |
| `string + string` in Update | `StringBuilder` or delta-check before setting |
| LINQ (`.Where`, `.Select`, `.ToList`) | Manual `for` loop |
| Lambda closures capturing locals | Static method or cached delegate |
| Boxing (`object o = 5`) | Use generics, avoid `object` parameters |

### Struct vs Class Guidance

- **Use `struct`** for small (≤ 16 bytes), immutable, short-lived data that is frequently created — avoids heap allocation entirely.
- **Use `class`** for objects with identity, references shared across multiple owners, or > 16 bytes.
- **Beware**: structs assigned to `interface` or `object` variables get **boxed** onto the heap — defeats the purpose.

```csharp
// GOOD — allocation-free struct (16 bytes: 2 floats + 2 ints)
public struct DamageEvent
{
    public float amount;
    public float armorPen;
    public int   sourceTeam;
    public int   targetTeam;
}

// BAD — each assignment to IDamageReceiver boxes the struct
// IDamageReceiver receiver = new DamageEvent { ... };  // BOX!
```

### Closures and Anonymous Methods — Hidden Allocations

```csharp
int threshold = 5;
// BAD — closure captures `threshold`, allocating a display class
enemies.RemoveAll(e => e.health < threshold);

// GOOD — no capture
enemies.RemoveAll(e => e.health <= 0);
```

### foreach on List<T> vs NativeArray / Array

- `foreach` on a plain C# **array** (`T[]`) — **zero allocation** (compiler uses indexed for-loop internally).
- `foreach` on `List<T>` — **allocates** an enumerator on the heap each time. Use `for (int i = 0; i < list.Count; i++)` in hot paths.
- `foreach` on `NativeArray<T>` — zero allocation.

```csharp
// ZERO alloc
int[] arr = GetArray();
foreach (int v in arr) { Process(v); }

// HEAP ALLOC — enumerator
List<int> list = GetList();
foreach (int v in list) { Process(v); }        // allocates!
for (int i = 0; i < list.Count; i++) Process(list[i]);  // zero alloc
```

### String Pooling / StringBuilder

```csharp
private readonly StringBuilder sb = new(64);

void Update()
{
    if (score != lastScore)
    {
        sb.Clear();
        sb.Append("Score: ");
        sb.Append(score);
        scoreText.text = sb.ToString();
        lastScore = score;
    }
}
```

---

## 5. Coroutines

`IEnumerator` methods paused across frames via `yield return`. Run on the main thread, so they share the frame budget with `Update`.

```csharp
private IEnumerator SpawnWave()
{
    for (int i = 0; i < 5; i++)
    {
        Instantiate(enemyPrefab);
        yield return new WaitForSeconds(2f);  // creates GC alloc every iteration
    }
}
```

### All `yield return` Types

| Yield instruction | Resumes | Allocates | Cacheable |
|---|---|---|---|
| `null` | Next frame | No | Always same (`null`) |
| `new WaitForSeconds(n)` | After `n` scaled seconds | Yes | **Cache it** |
| `new WaitForSecondsRealtime(n)` | After `n` unscaled seconds | Yes | **Cache it** |
| `new WaitForEndOfFrame()` | After rendering | Yes | **Cache it** |
| `new WaitForFixedUpdate()` | After physics step | Yes | **Cache it** |
| `new WaitUntil(() => bool)` | When predicate is true | Yes (closure + delegate) | No |
| `new WaitWhile(() => bool)` | While predicate is true | Yes (closure + delegate) | No |
| `WWW` / `UnityWebRequest.SendWebRequest()` | When download completes | Yes | No |
| `AsyncOperation` (SceneManager.LoadSceneAsync, etc.) | When operation completes | Depends | No |

### Caching Yield Instructions (Critical)

```csharp
public class WaveSpawner : MonoBehaviour
{
    // Pre-allocate once, reuse forever
    private static readonly WaitForSeconds Wait2s    = new WaitForSeconds(2f);
    private static readonly WaitForEndOfFrame EndFrame = new WaitForEndOfFrame();
    private static readonly WaitForFixedUpdate FixedUpd = new WaitForFixedUpdate();

    private IEnumerator SpawnWave()
    {
        for (int i = 0; i < 5; i++)
        {
            Instantiate(enemyPrefab);
            yield return Wait2s;  // ZERO alloc per iteration
        }
    }
}
```

### Starting / Stopping Coroutines

```csharp
Coroutine routine = StartCoroutine(MyRoutine());

// Stop by reference
StopCoroutine(routine);

// Stop by method name (slower, string-based, avoid)
StopCoroutine("MyRoutine");

// Stop ALL coroutines on this MonoBehaviour
StopAllCoroutines();
```

### Coroutine vs Update — Performance

| Aspect | `Update()` | Coroutine |
|---|---|---|
| Memory per active instance | ~zero | ~100 bytes for the IEnumerator state machine |
| Scheduling | Every frame, guaranteed | `yield return null` = every frame; otherwise less frequent |
| When to use | Continuous logic (movement, input) | Sequenced or time-driven logic (cutscenes, spawn waves) |
| Can run off main thread | No | No |

**Rule**: Use coroutines for timed sequences; keep continuous per-frame logic in `Update` (or a manager). Do not use `yield return null` in place of `Update` — it incurs additional state-machine overhead with no benefit.

---

## 6. Async / Await — Awaitable & Task

### Awaitable (Unity 2023.2+ / Unity 6)

Unity's custom awaitable type — **pooled, zero/minimal alloc, thread-aware**.

```csharp
using UnityEngine;

public class AsyncExample : MonoBehaviour
{
    private async Awaitable Start()
    {
        await Awaitable.WaitForSecondsAsync(2f);  // wait 2 scaled seconds
        await Awaitable.NextFrameAsync();          // wait one frame
        await Awaitable.EndOfFrameAsync();         // wait until rendering done
        await Awaitable.FixedUpdateAsync();        // wait for next physics step

        // Offload to background thread
        await Awaitable.BackgroundThreadAsync();
        int result = HeavyComputation();
        await Awaitable.MainThreadAsync();
        ApplyResult(result);
    }

    private int HeavyComputation() { return 42; }
}
```

### Awaitable API Reference

| Method | Resumes on |
|---|---|
| `Awaitable.NextFrameAsync()` | Next frame's `Update` |
| `Awaitable.WaitForSecondsAsync(float)` | After scaled seconds (main thread) |
| `Awaitable.EndOfFrameAsync()` | After rendering, before next frame |
| `Awaitable.FixedUpdateAsync()` | After next `FixedUpdate` |
| `Awaitable.BackgroundThreadAsync()` | Switches to worker thread |
| `Awaitable.MainThreadAsync()` | Switches back to main thread |

### Task vs Awaitable

| Feature | `Task` / `Task<T>` | `Awaitable` / `Awaitable<T>` |
|---|---|---|
| Allocations per await | At least 1 (Task object) | Zero (pooled) |
| Can await multiple times | Yes | No (single-consumer) |
| Unity thread/loop aware | No | Yes |
| Continuation runs synchronously | Configurable | Always synchronous |
| Exception type | `Exception` | `Exception` |
| Cancellation via | `CancellationToken` | `CancellationToken` (Unity 6.1+) |

### When to Use Which

- **Awaitable**: Main-thread sequencing, frame/seconds delays, Unity callbacks. Prefer in hot paths.
- **UniTask** (community package): Zero-alloc, rich API, `CancellationToken` everywhere, `UniTask<T>` with pooling. Established alternative if Awaitable APIs are insufficient.
- **Task**: Interfacing with non-Unity libraries, `Task.WhenAll`, legacy `async void` patterns. Avoid in performance-sensitive Unity code.

### async void vs async Awaitable

```csharp
// BAD — Unhandled exceptions crash the app; no way to await
async void OnButtonClick() { await DoAsync(); }

// GOOD — Exception propagates to caller; can be awaited
async Awaitable OnButtonClick() { await DoAsync(); }
```

**Never use `async void` except for fire-and-forget event handlers where Awaitable is not supported.**

---

## 7. Unity Job System

Multithreaded code that leverages all CPU cores with built-in race-condition safety.

### Core Interfaces

| Interface | Use case |
|---|---|
| `IJob` | Single-threaded operation on shared data |
| `IJobParallelFor` | Same operation on each element of an array, in parallel |
| `IJobParallelForTransform` | Parallel read/write of Transform data |
| `IJobFor` | Sequential or parallel for loop (newer, more flexible) |

### IJob + BurstCompile

```csharp
using Unity.Burst;
using Unity.Collections;
using Unity.Jobs;
using UnityEngine;

[BurstCompile]
public struct MultiplyJob : IJob
{
    public float multiplier;
    public NativeArray<float> values;

    public void Execute()
    {
        for (int i = 0; i < values.Length; i++)
            values[i] *= multiplier;
    }
}

// Scheduling
public class JobRunner : MonoBehaviour
{
    private void Start()
    {
        var results = new NativeArray<float>(1000, Allocator.TempJob);

        var job = new MultiplyJob
        {
            multiplier = 2f,
            values     = results
        };

        JobHandle handle = job.Schedule();
        handle.Complete(); // blocks main thread until done

        Debug.Log(results[0]);
        results.Dispose();
    }
}
```

### IJobParallelFor — Process Array Elements in Parallel

```csharp
[BurstCompile]
public struct DistanceJob : IJobParallelFor
{
    [ReadOnly] public NativeArray<Vector3> positions;
    public Vector3 origin;
    public NativeArray<float> distances;

    public void Execute(int index)
    {
        distances[index] = Vector3.Distance(positions[index], origin);
    }
}

// Schedule: batchCount = 64 (default), iterates over array length
var job = new DistanceJob { positions = posIn, origin = origin, distances = distOut };
JobHandle handle = job.Schedule(posIn.Length, 64);
handle.Complete();
```

### Allocator Types

| Allocator | Lifetime | Speed | Safety |
|---|---|---|---|
| `Allocator.Temp` | 1 frame max | Fastest | No `Dispose` needed in 2022+ (auto-released end of frame). Use for short-lived job data. |
| `Allocator.TempJob` | 4 frames max | Fast | Must `Dispose()` manually. Leak detection. |
| `Allocator.Persistent` | Unlimited | Slowest | Must `Dispose()` manually. Use for data living across many frames. |

```csharp
// Temp: fastest, auto-cleanup, 1 frame only
var scratch = new NativeArray<float>(256, Allocator.Temp);

// TempJob: cross-job sharing, must dispose
var shared = new NativeArray<int>(1000, Allocator.TempJob);
shared.Dispose();  // MANDATORY

// Persistent: long-lived data
var permanent = new NativeArray<float>(1_000_000, Allocator.Persistent);
permanent.Dispose();
```

### JobHandle Dependencies — Chaining Jobs

```csharp
JobHandle a = jobA.Schedule();
JobHandle b = jobB.Schedule(a);     // b waits for a
JobHandle c = jobC.Schedule(b);     // c waits for b

// Combine multiple dependencies
JobHandle combined = JobHandle.CombineDependencies(a, b);
JobHandle d = jobD.Schedule(combined);

// Wait for everything
d.Complete();
```

### Safety System

Jobs operate on **copies** of data from `NativeContainer` types (`NativeArray`, `NativeList`, etc.). The safety system prevents:

- **Race conditions**: Only one job writes to a given container at a time.
- **Leaked memory**: Dispose sentinels (`DisposeSentinel`) detect undisposed containers.
- **Aliasing**: `AtomicSafetyHandle` prevents the same container being used simultaneously by two jobs with overlapping lifetimes.

**Key rules**:
1. Mark read-only data with `[ReadOnly]` to allow multiple jobs to read the same container in parallel.
2. Use `[NativeDisableContainerSafetyRestriction]` only when you understand the consequences.
3. Always `Dispose()` TempJob and Persistent allocations — the leak detection will log errors but won't prevent the leak in builds.

---

## 8. Common Performance Pitfalls

### GetComponent in Loops or Update

```csharp
// BAD — GetComponent is a native interop call; 1000x in a loop = pain
foreach (var go in objects)
    go.GetComponent<Health>().Damage(10);

// GOOD — cache or pre-populate
Health[] healthComponents; // populated once in Awake
```

### String Concatenation in Hot Paths

```csharp
// BAD — allocates intermediate string objects
status.text = "HP: " + hp + " / " + maxHp;

// GOOD — StringBuilder or conditional update (only when value changes)
if (hp != lastHp)
{
    sb.Clear(); sb.Append("HP: "); sb.Append(hp); sb.Append(" / "); sb.Append(maxHp);
    status.text = sb.ToString();
    lastHp = hp;
}
```

### LINQ in Runtime Code

Every LINQ operator allocates enumerators, delegates, and intermediate collections.

```csharp
// BAD — multiple allocations per call
var result = enemies.Where(e => e.IsAlive).OrderBy(e => e.Distance).ToList();

// GOOD — manual loop, zero alloc
List<Enemy> alive = AllEnemiesList;
alive.Sort((a, b) => a.Distance.CompareTo(b.Distance));
```

### Camera.main — Caches via FindGameObjectsWithTag

```csharp
// BAD — every call searches entire scene hierarchy
void Update() { Vector3 pos = Camera.main.WorldToScreenPoint(transform.position); }

// GOOD — cache once
private Camera mainCam;
void Awake() { mainCam = Camera.main; }
void Update() { Vector3 pos = mainCam.WorldToScreenPoint(transform.position); }
```

### FindObjectOfType / FindGameObjectsWithTag — Never in Hot Paths

These scan the entire scene hierarchy. Cache results in `Awake`/`Start`.

```csharp
// BAD
void Update() { var gm = FindObjectOfType<GameManager>(); }

// GOOD
private GameManager gm;
void Awake() { gm = FindObjectOfType<GameManager>(); }
```

### Instantiate / Destroy Without Pooling

```csharp
// BAD — frequent allocations + GC churn (bullets, particles, enemies)
void Update() { if (Input.GetButtonDown("Fire1")) Instantiate(bulletPrefab); }

// GOOD — use ObjectPool<T> (see Section 1)
```

### Boxed Value Types

```csharp
// BAD — boxing allocates heap memory
int score = 100;
object boxed = score;            // heap alloc
Debug.Log(string.Format("{0}", score)); // boxing via params object[]

// GOOD
Debug.Log(score.ToString());     // no boxing (int.ToString is overridden)
```

### Foreach on List<T> (not Array)

```csharp
// ALLOCATES — List<T>.Enumerator is a class
List<int> nums = GetNums();
foreach (int n in nums) { }

// NO ALLOC — T[] enumerator is a struct (compiler optimises to for-loop)
int[] nums = GetNumsArray();
foreach (int n in nums) { }
```

### NOT Disposing Native Collections

```csharp
// BAD — leak
new NativeArray<float>(100, Allocator.TempJob); // never disposed

// GOOD
using (var arr = new NativeArray<float>(100, Allocator.TempJob)) { /* ... */ } // auto dispose
```

### Static Field References Preventing Scene Unload

```csharp
// BAD — static holds reference to GameObjects, keeps entire scene in memory
public static GameObject PlayerPrefab;

// GOOD — use DontDestroyOnLoad pattern or avoid static Unity object refs
```

### Ignoring Burst for Math-Heavy Jobs

```csharp
// WITHOUT Burst — runs as regular C# IL
public struct SlowMath : IJob { public void Execute() { /* ... */ } }

// WITH Burst — compiled to optimised native code via LLVM
[BurstCompile]
public struct FastMath : IJob { public void Execute() { /* ... */ } }
```

---

## 9. Code Patterns (8 Reference Patterns)

### Pattern 1: ObjectPool<T> with Self-Releasing Objects

```csharp
// Spawner side
IObjectPool<Projectile> pool = new ObjectPool<Projectile>(
    () => Instantiate(prefab),
    p => p.gameObject.SetActive(true),
    p => p.gameObject.SetActive(false),
    p => Destroy(p.gameObject),
    collectionCheck: true, defaultCapacity: 20, maxSize: 100);

Projectile p = pool.Get();
p.Fire(origin, direction, pool);  // passes pool so it can return itself

// Projectile side
public void Fire(Vector3 pos, Vector3 dir, IObjectPool<Projectile> pool)
{
    owningPool = pool;
    transform.position = pos;
    Launch(); // after lifetime, calls owningPool.Release(this);
}
```

### Pattern 2: Cached Component References

```csharp
public class MoveAndRotate : MonoBehaviour
{
    [SerializeField] private float speed = 5f;

    private Rigidbody rb;
    private Transform t;

    private void Awake()
    {
        rb = GetComponent<Rigidbody>();
        t  = transform;  // transform property also has native interop; cache if used heavily
    }

    private void FixedUpdate()
    {
        rb.linearVelocity = t.forward * speed;
    }
}
```

### Pattern 3: Coroutine with Cached Yield Instructions

```csharp
public class TimerSequence : MonoBehaviour
{
    private static readonly WaitForSeconds Wait1s    = new WaitForSeconds(1f);
    private static readonly WaitForSeconds WaitPoint5 = new WaitForSeconds(0.5f);

    public IEnumerator Countdown(int from)
    {
        for (int i = from; i > 0; i--)
        {
            Debug.Log(i);
            yield return Wait1s;
        }
        Debug.Log("Go!");
        yield return WaitPoint5;
        OnComplete?.Invoke();
    }

    public event Action OnComplete;
}
```

### Pattern 4: Awaitable Async Method

```csharp
public class AsyncLoader : MonoBehaviour
{
    private async Awaitable Start()
    {
        // Sequential, non-blocking
        await Awaitable.WaitForSecondsAsync(1f);
        await LoadPlayerDataAsync();
        await Awaitable.NextFrameAsync();
        await SpawnEnvironmentAsync();
    }

    private async Awaitable LoadPlayerDataAsync()
    {
        await Awaitable.BackgroundThreadAsync();
        string json = File.ReadAllText(Application.persistentDataPath + "/save.json");
        await Awaitable.MainThreadAsync();
        ApplySaveData(json);
    }

    private void ApplySaveData(string json) { /* parse on main thread */ }
}
```

### Pattern 5: IJob with BurstCompile

```csharp
[BurstCompile]
public struct NormalizeVectorsJob : IJobParallelFor
{
    [ReadOnly] public NativeArray<Vector3> input;
    [WriteOnly] public NativeArray<Vector3> output;

    public void Execute(int index)
    {
        output[index] = math.normalize(input[index]);
    }
}

// Usage
var input  = new NativeArray<Vector3>(count, Allocator.TempJob);
var output = new NativeArray<Vector3>(count, Allocator.TempJob);
var job    = new NormalizeVectorsJob { input = input, output = output };
JobHandle handle = job.Schedule(count, 64);
handle.Complete();
output.Dispose();
input.Dispose();
```

### Pattern 6: Value-Type Struct to Avoid Heap Allocations

```csharp
// Allocation-free event data — never touches the heap
public struct HitInfo
{
    public Vector3 point;
    public Vector3 normal;
    public float   damage;
    public int     attackerId;

    // Operate without allocations
    public bool IsCritical => damage > 50f;

    public void ApplyTo(Health target)
    {
        target.TakeDamage(damage, point);
    }
}

// Enqueue / dequeue — all stack-allocated
HitInfo hit = new HitInfo { point = pos, normal = norm, damage = 25f, attackerId = 1 };
hit.ApplyTo(target);
```

### Pattern 7: Centralised Update Manager (No Individual Update)

```csharp
public class UpdateManager : MonoBehaviour
{
    private readonly List<ITickable> tickables = new(256);

    public void Register(ITickable t)   => tickables.Add(t);
    public void Unregister(ITickable t) => tickables.Remove(t);

    private void Update()
    {
        float dt = Time.deltaTime;
        for (int i = tickables.Count - 1; i >= 0; i--)
            tickables[i].Tick(dt);
    }
}

public interface ITickable { void Tick(float deltaTime); }

// Subscriber — NO MonoBehaviour.Update overhead
public class Enemy : MonoBehaviour, ITickable
{
    private void OnEnable()  => UpdateManager.Instance.Register(this);
    private void OnDisable() => UpdateManager.Instance.Unregister(this);

    public void Tick(float dt) { /* move, check sight, etc. */ }
}
```

### Pattern 8: StringBuilder for Dynamic UI Text

```csharp
public class ScoreDisplay : MonoBehaviour
{
    [SerializeField] private TMP_Text text;
    private readonly StringBuilder sb = new(64);
    private int lastScore = -1;

    public void SetScore(int score)
    {
        if (score == lastScore) return;  // no alloc if unchanged

        sb.Clear();
        sb.Append("SCORE: ");
        sb.Append(score);
        text.SetText(sb);
        lastScore = score;
    }
}
```

---

## 10. Best Practices Checklist (15 Items)

1. **Cache `GetComponent<T>()` results** in `Awake`/`Start` — never call in `Update` or loops.
2. **Cache `Camera.main`** — internally calls `FindGameObjectsWithTag`; cache once in `Awake`.
3. **Use `ObjectPool<T>`** for frequently-instantiated objects (bullets, particles, enemies) — eliminates `Instantiate`/`Destroy` GC churn.
4. **Use `ListPool<T>` / `DictionaryPool<T>`** for temporary collections in hot paths instead of `new List<T>()`.
5. **Cache `WaitForSeconds` / `WaitForEndOfFrame` / `WaitForFixedUpdate`** in `static readonly` fields — one allocation, forever.
6. **Never use LINQ in hot paths** — `.Where`, `.Select`, `.OrderBy`, `.ToList` all allocate enumerators and often intermediate collections. Use manual `for` loops.
7. **Use `for` instead of `foreach` on `List<T>`** — `foreach` on `List<T>` heap-allocates an enumerator each time. `foreach` on `T[]` is fine.
8. **Never call `FindObjectOfType` / `FindGameObjectsWithTag` in `Update`** — these scan the entire scene. Cache in `Awake`.
9. **Put `[BurstCompile]` on every job struct** — 10–100× speedup for math-heavy work. Free performance.
10. **Match allocator lifetime to data lifetime**: `Temp` for single-frame scratch, `TempJob` for cross-job, `Persistent` for long-lived. Always `Dispose` TempJob/Persistent.
11. **Use `Awaitable` over `Task` in Unity code** — zero alloc, thread-aware. Only use `Task` for cross-library interop.
12. **Prefer `async Awaitable` over `async void`** — `async void` crashes on unhandled exceptions and cannot be awaited.
13. **Avoid static references to GameObjects / Components** — prevents scene unloading and causes leaks.
14. **Use `StringBuilder` or delta-check for dynamic text** — avoid string concatenation in `Update`.
15. **Prefer `struct` for short-lived, small (≤16 bytes) immutable data** — avoids heap allocation entirely. Never box structs into interfaces or `object`.

---

## Quick Decision Table

| Situation | Use |
|---|---|
| Spawning bullets every frame | `ObjectPool<T>` |
| Temporary list in a method | `ListPool<T>.Get()` in `using` |
| Delay 2 seconds, then spawn | Coroutine + cached `WaitForSeconds` OR `Awaitable.WaitForSecondsAsync` |
| Parallel array processing | `IJobParallelFor` + `[BurstCompile]` |
| Background file I/O then UI update | `Awaitable.BackgroundThreadAsync()` → `Awaitable.MainThreadAsync()` |
| 1000 enemies with per-frame AI | Central `UpdateManager` pattern or ECS |
| UI score text update | `StringBuilder` with delta check |
| Pass event data between systems | `struct` (value type) not `class` |
