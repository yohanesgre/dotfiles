---
name: unity-scripting-testing-debugging
description: Comprehensive reference for the Unity Test Framework (UTF), debugging tools, diagnostics, Profiler, Frame Debugger, and common debugging patterns. Based on Unity 6.4 documentation.
---

# Unity Scripting: Testing, Debugging & Diagnostics

## Description
Comprehensive reference for the Unity Test Framework (UTF), debugging tools, diagnostics, Profiler, Frame Debugger, and common debugging patterns. Based on Unity 6.4 documentation.

## When to Use
Load when writing C# tests for Unity, debugging runtime issues, setting up test assemblies, profiling performance, reading Unity log files, or diagnosing crashes. Also load when configuring CI/CD test pipelines or investigating memory leaks.

---

## Table of Contents

1. [Unity Test Framework (UTF)](#unity-test-framework-utf)
2. [Writing Tests](#writing-tests)
3. [Running Tests](#running-tests)
4. [Debugging](#debugging)
5. [Diagnostics](#diagnostics)
6. [Profiler & Frame Debugger](#profiler--frame-debugger)
7. [Common Debugging Patterns](#common-debugging-patterns)
8. [Code Patterns](#code-patterns)
9. [Best Practices](#best-practices)

---

## Unity Test Framework (UTF)

### Overview

Unity Test Framework (UTF) integrates a custom version of **NUnit**, the open-source unit testing library for .NET, and extends it with Unity-specific capabilities. Unity tests can interact with Unity-specific concepts such as frames, the application loop, and domain reload.

A Unity test runs as a **coroutine in Play mode** and in the `EditorApplication.update` callback loop in **Edit mode**.

Two core attributes:
- `[Test]` — Standard NUnit test attribute. Works in both Edit mode and Play mode (non-coroutine).
- `[UnityTest]` — Coroutine-based test that can yield and interact with Unity timing. Requires `IEnumerator` return type.

### Test Assembly Definitions

Tests must live in their own assembly with a **Test Assembly Definition** (`.asmdef`). Create via **Assets > Create > Testing > Tests Assembly Definition**.

The test assembly must reference the assembly containing the code under test:

```json
{
    "name": "Game.Tests",
    "rootNamespace": "Game.Tests",
    "references": ["Game"],
    "includePlatforms": ["Editor"],
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

**Key requirements:**
- Test assembly folder must be named with `.Tests` suffix (convention — not enforced).
- Assembly must reference the assembly under test via the `references` array.
- For Edit Mode tests: include `"includePlatforms": ["Editor"]` or place inside an `Editor/` folder.
- For Play Mode tests: platform is typically unrestricted.
- Unity automatically adds NUnit and UTF references to test assemblies.

**Naming conventions for test assemblies:**

| Assembly Under Test | Test Assembly Name | Typical Folder |
|---------------------|--------------------|----------------|
| `MyGame` | `MyGame.Tests` | `Assets/Tests/MyGame.Tests/` |
| `MyGame.Editor` | `MyGame.Editor.Tests` | `Assets/Editor/Tests/` |
| `MyGame.Runtime` | `MyGame.Runtime.Tests` | `Assets/Tests/MyGame.Runtime.Tests/` |

### Edit Mode vs Play Mode Tests

| Aspect | Edit Mode Tests | Play Mode Tests |
|--------|----------------|-----------------|
| **Execution context** | Editor process, no Play mode | Inside the Player/standalone context |
| **Speed** | Fast (no scene load, no Play enter) | Slower (requires Play mode entry) |
| **Scene required?** | No | Typically yes |
| **Can test MonoBehaviours?** | Only pure logic (no Start/Awake) | Yes, full lifecycle |
| **Can test Editor code?** | Yes | No |
| **Use case** | Logic, math, utilities, data validation | Runtime behavior, physics, input, coroutines |
| **Primary attribute** | `[Test]` | `[UnityTest]` (coroutine-based) |

**When to use Edit Mode:**
- Pure C# utility methods (math, string processing, data structures)
- ScriptableObject data validation
- Asset import/validation
- Editor tool correctness (custom inspectors, windows)

**When to use Play Mode:**
- MonoBehaviour component behavior at runtime
- Physics interactions (collision, triggers)
- Input handling
- Coroutine execution
- Scene loading and unloading
- AI/pathfinding behavior

### Complete Test Attribute Reference

UTF supports all standard NUnit attributes plus Unity-specific ones:

#### Core Test Attributes

| Attribute | Scope | Description |
|-----------|-------|-------------|
| `[Test]` | Method | Marks a method as a test. Used in both Edit and Play modes. |
| `[UnityTest]` | Method | Coroutine-based test that can yield. Return type must be `IEnumerator`. Works in both modes. |
| `[SetUp]` | Method | Called before **each** test method in the fixture. |
| `[TearDown]` | Method | Called after **each** test method in the fixture. |
| `[OneTimeSetUp]` | Method | Called **once** before all tests in the fixture run. |
| `[OneTimeTearDown]` | Method | Called **once** after all tests in the fixture finish. |
| `[UnitySetUp]` | Method | Unity-specific setup. Runs as a coroutine (returns `IEnumerator`). Called before each test. |
| `[UnityTearDown]` | Method | Unity-specific teardown. Runs as a coroutine (returns `IEnumerator`). Called after each test. |

#### Parameterization Attributes

| Attribute | Usage | Description |
|-----------|-------|-------------|
| `[TestCase(params)]` | `[TestCase(1, 2, 3)]` | Inline parameterized test data. Multiple `[TestCase]` per method. |
| `[TestCaseSource(nameof(X))]` | References a field/property/method | External data source for test cases. Returns `IEnumerable`. |
| `[Values(...)]` | `[Values(1, 2, 3)] int x` | Combinatorial — runs test for every combination of `[Values]` params. |
| `[ValueSource(nameof(X))]` | References a data source | Like `[Values]` but from an external source. |
| `[Range(min, max)]` | `[Range(0, 10)] int x` | Generates sequential values for combinatorial tests. |
| `[Random(min, max, count)]` | Random values from distribution. |

#### Control Attributes

| Attribute | Description |
|-----------|-------------|
| `[Category("name")]` | Assign test to a category for filtering. Can apply at class or method level. |
| `[Timeout(milliseconds)]` | Fail test if it exceeds the time limit. |
| `[Ignore("reason")]` | Skip the test with a reason message. |
| `[Explicit]` | Test runs only when explicitly selected (not with Run All). |
| `[Order(n)]` | Control execution order within a fixture. Lower numbers run first. |
| `[Repeat(n)]` | Repeat the test `n` times. |
| `[Retry(n)]` | Retry up to `n` times on failure before marking as failed. |
| `[PrebuildSetup(type)]` | Run setup code before the build (for Play Mode on-device tests). |
| `[PostBuildCleanup(type)]` | Run cleanup after the build completes. |
| `[RequiresPlayMode]` | Force test to run in Play mode (deprecated — use `[UnityTest]`). |
| `[RequiresEditMode]` | Force test to run in Edit mode (deprecated — use `[Test]`). |
| `[TestMustExpectAllLogs]` | Fail test if any unexpected log messages are emitted. |

**Lifecycle execution order within a test fixture:**

```
OneTimeSetUp()
    ├── SetUp()
    │       ├── Test A
    │   └── TearDown()
    ├── SetUp()
    │       ├── Test B
    │   └── TearDown()
    └── OneTimeTearDown()
```

### Assertions

#### Standard NUnit Assertions

```csharp
// Equality
Assert.AreEqual(expected, actual);
Assert.AreNotEqual(expected, actual);

// Truth assertions
Assert.IsTrue(condition);
Assert.IsFalse(condition);
Assert.IsTrue(condition, "Optional failure message");

// Null checks
Assert.IsNull(obj);
Assert.IsNotNull(obj);

// Comparisons
Assert.Greater(large, small);
Assert.GreaterOrEqual(large, small);
Assert.Less(small, large);
Assert.LessOrEqual(small, large);

// Instance checks
Assert.IsAssignableFrom<T>(obj);
Assert.IsNotAssignableFrom<T>(obj);
Assert.IsInstanceOf<T>(obj);
Assert.IsNotInstanceOf<T>(obj);

// Reference equality
Assert.AreSame(expected, actual);
Assert.AreNotSame(expected, actual);

// Collections
Assert.Contains(expected, collection);
CollectionAssert.AreEqual(expectedCollection, actualCollection);
CollectionAssert.Contains(expectedCollection, item);
CollectionAssert.AllItemsAreNotNull(collection);
CollectionAssert.AllItemsAreUnique(collection);

// Strings
StringAssert.Contains(expectedSubstring, actual);
StringAssert.StartsWith(expectedPrefix, actual);
StringAssert.EndsWith(expectedSuffix, actual);
StringAssert.AreEqualIgnoringCase(expected, actual);
StringAssert.IsMatch(regexPattern, actual);

// Exceptions
Assert.Throws<ExceptionType>(() => { /* code that throws */ });
Assert.DoesNotThrow(() => { /* code that should not throw */ });

// For async/UnityTest
Assert.That(actual, Is.EqualTo(expected));
```

#### Unity-Specific Assertions

UTF adds several Unity-specific assertions in `UnityEngine.TestTools`:

```csharp
using UnityEngine.TestTools;

// Log assertions — verify that code logs expected messages
LogAssert.Expect(LogType.Log, "Expected message");
LogAssert.Expect(LogType.Warning, "Expected warning");
LogAssert.Expect(LogType.Error, "Expected error");

// Check that no unexpected logs occurred
LogAssert.NoUnexpectedReceived();

// GameObject queries
Assert.That(someObject, Is.Not.Null);
```

**`LogAssert.Expect` pattern:**
```csharp
[Test]
public void InvalidInput_LogsWarning()
{
    LogAssert.Expect(LogType.Warning, "Input value must be positive");
    var result = Calculator.Divide(10, 0); // should log warning and return 0
    Assert.AreEqual(0, result);
}
```

### UnityTest Yielding

`[UnityTest]` methods can yield various instructions to control execution timing:

```csharp
[UnityTest]
public IEnumerator TestWithYielding()
{
    // Wait one frame
    yield return null;

    // Wait multiple frames
    for (int i = 0; i < 10; i++)
        yield return null;

    // Wait for end of frame
    yield return new WaitForEndOfFrame();

    // Wait for fixed update (physics)
    yield return new WaitForFixedUpdate();

    // Wait for real seconds (unscaled)
    yield return new WaitForSecondsRealtime(0.5f);

    // Wait until a condition is met
    yield return new WaitUntil(() => someFlag == true);

    // Wait while a condition is true
    yield return new WaitWhile(() => isLoading);

    // Custom yield instructions
    yield return new CustomYieldInstruction();
}
```

---

## Writing Tests

### Test Structure: Arrange-Act-Assert

Every test should follow the **AAA pattern**:

```csharp
[Test]
public void HealthComponent_TakeDamage_ReducesHealth()
{
    // Arrange — set up the test scenario
    var gameObject = new GameObject();
    var health = gameObject.AddComponent<HealthComponent>();
    health.MaxHealth = 100;
    health.CurrentHealth = 100;

    // Act — perform the action under test
    health.TakeDamage(30);

    // Assert — verify the outcome
    Assert.AreEqual(70, health.CurrentHealth);
}
```

**Guidelines for AAA:**
- **Arrange**: Create GameObjects, add components, set initial state, configure dependencies.
- **Act**: A single action or method call. If you need multiple actions, the test may be too broad.
- **Assert**: One logical assertion is ideal; multiple related assertions are acceptable. Use `Assert.Multiple` for multiple independent checks.
- **Single responsibility per test**: Test one behavior — name it descriptively (`MethodName_Scenario_ExpectedResult`).

### Naming Convention

Follow the pattern: **`MethodUnderTest_Scenario_ExpectedBehavior`**

```csharp
// Good names:
CalculateDamage_WithArmor_ReducesByHalf
SpawnEnemy_WhenPoolEmpty_CreatesNewInstance
Player_TakeDamageAtZeroHealth_TriggersGameOver

// Bad names:
Test1
DamageTest
EnemySpawnWorks
```

### Testing MonoBehaviours

MonoBehaviours are tightly coupled to the Unity runtime. Testing strategies:

**Strategy 1: Test via Play Mode (`[UnityTest]`)**

```csharp
[UnityTest]
public IEnumerator HealthComponent_TakeDamage_ClampsToZero()
{
    // Create in Play Mode — Awake and Start will execute
    var go = new GameObject("TestHealth");
    var health = go.AddComponent<HealthComponent>();

    yield return null; // Wait for Start to run

    health.TakeDamage(999);
    Assert.AreEqual(0, health.CurrentHealth);
}
```

**Strategy 2: Extract pure logic — Edit Mode testable**

```csharp
// Separate pure calculation from MonoBehaviour
public static class DamageCalculator
{
    public static int CalculateDamage(int baseDamage, int armor)
    {
        return Mathf.Max(0, baseDamage - armor);
    }
}

// Edit Mode test — no GameObject needed
[Test]
public void CalculateDamage_WithArmor_ReducesCorrectly()
{
    Assert.AreEqual(30, DamageCalculator.CalculateDamage(50, 20));
    Assert.AreEqual(0, DamageCalculator.CalculateDamage(10, 20));
}
```

**Strategy 3: Partial MonoBehaviour testing (Edit Mode)**

For pure methods inside a MonoBehaviour that don't access `transform`, `gameObject`, or Unity API:

```csharp
// Test a static or pure instance method:
[Test]
public void Inventory_AddItem_WithinCapacity_ReturnsTrue()
{
    var inventory = new InventoryComponent();
    bool result = inventory.CanAddItem(new Item("Sword", 1));
    Assert.IsTrue(result);
}
```

### Integration Tests

Integration tests verify multiple components working together:

```csharp
[UnityTest]
public IEnumerator Spawner_WhenEnemyDies_TriggersRespawn()
{
    // Arrange
    var spawnerGo = new GameObject();
    var spawner = spawnerGo.AddComponent<EnemySpawner>();
    spawner.EnemyPrefab = Resources.Load<GameObject>("Enemy");
    spawner.SpawnInterval = 0.1f;

    // Act — let the system run for a period
    yield return new WaitForSeconds(0.3f);

    // Assert — check the system state
    var enemies = GameObject.FindGameObjectsWithTag("Enemy");
    Assert.Greater(enemies.Length, 0);
}
```

### Test Doubles / Mocks

UTF builds on NUnit but does **not** ship a mocking framework. Approaches:

**1. Manual test doubles (recommended for Unity)**

```csharp
// Interface for dependency injection
public interface IHealthDisplay
{
    void UpdateHealthBar(float percentage);
}

// Real implementation
public class UIHealthBar : MonoBehaviour, IHealthDisplay
{
    public Slider healthSlider;
    public void UpdateHealthBar(float percentage) => healthSlider.value = percentage;
}

// Test double
public class StubHealthDisplay : IHealthDisplay
{
    public float LastPercentage { get; private set; }
    public int UpdateCallCount { get; private set; }

    public void UpdateHealthBar(float percentage)
    {
        LastPercentage = percentage;
        UpdateCallCount++;
    }
}

// Test using the stub
[Test]
public void Player_WhenDamaged_NotifiesHealthDisplay()
{
    var display = new StubHealthDisplay();
    var player = new Player(display, maxHealth: 100);

    player.TakeDamage(40);

    Assert.AreEqual(0.6f, display.LastPercentage, 0.01f);
    Assert.AreEqual(1, display.UpdateCallCount);
}
```

**2. Third-party mocking frameworks**

Install via Package Manager (UPM git URL) if needed:
- **NSubstitute** — lightweight mocking
- **Moq** — traditional .NET mocking

```csharp
// NSubstitute example (requires package installation)
[Test]
public void Player_WhenDamaged_CallsDisplay()
{
    var display = Substitute.For<IHealthDisplay>();
    var player = new Player(display, maxHealth: 100);

    player.TakeDamage(40);

    display.Received(1).UpdateHealthBar(0.6f);
}
```

### Testing Asynchronous Code

```csharp
// Play Mode coroutine test
[UnityTest]
public IEnumerator AsyncLoad_Completes_WithinTimeLimit()
{
    bool completed = false;
    var loader = new SceneLoader();
    loader.LoadSceneAsync("Level2", () => completed = true);

    float timeout = 5f;
    float elapsed = 0f;
    while (!completed && elapsed < timeout)
    {
        elapsed += Time.deltaTime;
        yield return null;
    }

    Assert.IsTrue(completed, "Scene load timed out");
}
```

### Testing for Specific Log Messages

```csharp
[Test]
public void InvalidConfig_LogsError()
{
    LogAssert.Expect(LogType.Error, "Configuration file is missing");

    var configLoader = new ConfigLoader();
    configLoader.Load("nonexistent.json");

    // Test passes because the expected error was logged
    // If no error is logged, the test fails
}
```

### Conditional Test Execution

```csharp
// Only run on specific platforms
[UnityTest]
[UnityPlatform(include = new[] { RuntimePlatform.Android, RuntimePlatform.IPhone })]
public IEnumerator TouchInput_RespondsToTap()
{
    // Touch-specific test
}

// Categorize for selective runs
[Test]
[Category("Slow")]
[Category("Integration")]
public void LoadAllScenes_WithoutErrors()
{
    // Long-running test
}
```

---

## Running Tests

### Test Runner Window

Open via **Window > General > Test Runner** (or **Ctrl+T**, **Cmd+T** on macOS).

**Window layout:**
- **Left panel**: Hierarchical test tree (assembly → namespace → fixture → test)
- **Top tabs**: Edit Mode / Play Mode toggle
- **Toolbar buttons**: Run All | Run Selected | Rerun Failed
- **Right panel**: Test output, stack traces, execution time

**Key workflow:**
1. Select **Edit Mode** or **Play Mode** tab.
2. Wait for compilation and test discovery.
3. Click any test in the hierarchy to see details.
4. Click **Run All** to execute, or right-click a node for context menu (Run, Run All in Category, etc.).
5. Results appear with green check (pass), red X (fail), or yellow warning (inconclusive/skipped).

### Command-Line Execution

Tests can be run from the command line for CI/CD pipelines:

```bash
# Edit Mode tests
Unity -projectPath /path/to/project \
      -runTests \
      -testPlatform EditMode \
      -testResults results.xml \
      -logFile test.log \
      -batchmode \
      -quit

# Play Mode tests (standalone)
Unity -projectPath /path/to/project \
      -runTests \
      -testPlatform PlayMode \
      -testResults results-playmode.xml \
      -logFile test-playmode.log \
      -batchmode \
      -quit

# With test filter
Unity -projectPath /path/to/project \
      -runTests \
      -testFilter "MyGame.Tests.CalculatorTests.*" \
      -testCategory "Unit;Integration" \
      -testResults results.xml \
      -batchmode -quit
```

**Command-line parameters:**

| Parameter | Description |
|-----------|-------------|
| `-runTests` | Execute tests and exit. Required for test runs. |
| `-testPlatform` | `EditMode` or `PlayMode` |
| `-testResults <path>` | Output NUnit XML results file path |
| `-testFilter <pattern>` | Filter by full test name (supports wildcards: `*`) |
| `-testCategory <categories>` | Semicolon-delimited category filter |
| `-assemblyNames <names>` | Semicolon-delimited assembly names |
| `-batchmode` | Run without GUI (required for headless/CI) |
| `-quit` | Exit after completion |
| `-logFile <path>` | Write Editor log to file |

### TestRunnerApi (Programmatic Execution)

Run tests from code — useful for custom Editor tools:

```csharp
using UnityEditor.TestTools.TestRunner.Api;
using NUnit.Framework;

public class TestRunnerWindow : EditorWindow
{
    private TestRunnerApi testRunnerApi;

    [MenuItem("Tools/Run All Tests")]
    public static void RunAllTests()
    {
        var runner = ScriptableObject.CreateInstance<TestRunnerApi>();
        var filter = new Filter
        {
            testMode = TestMode.EditMode
        };

        runner.Execute(new ExecutionSettings(filter));
        runner.RegisterCallbacks(new TestCallbacks());
    }
}

// Callback handler
public class TestCallbacks : ICallbacks
{
    public void RunStarted(ITestAdaptor testsToRun) { }
    public void RunFinished(ITestResultAdaptor result)
    {
        Debug.Log($"Tests passed: {result.PassCount}, failed: {result.FailCount}");
    }
    public void TestStarted(ITestAdaptor test) { }
    public void TestFinished(ITestResultAdaptor result)
    {
        if (result.TestStatus == TestStatus.Failed)
            Debug.LogError($"FAILED: {result.FullName}\n{result.Message}");
    }
}
```

**Filter options via `TestRunnerApi`:**
```csharp
var filter = new Filter
{
    testMode = TestMode.PlayMode,
    testNames = new[] { "MyTestNamespace.MyTests" },
    groupNames = new[] { "Integration" },
    categoryNames = new[] { "Slow" },
    assemblyNames = new[] { "Game.Tests" }
};
```

### Test Categories

Categories allow grouping and filtering tests:

```csharp
[TestFixture]
[Category("Player")]
public class PlayerTests
{
    [Test]
    [Category("Unit")]
    [Category("Fast")]
    public void TakeDamage_CalculatesCorrectly() { }

    [UnityTest]
    [Category("Integration")]
    [Category("Slow")]
    public IEnumerator PlayerDeath_TriggersRespawn() { }

    [Test]
    [Category("EditorOnly")]
    [UnityPlatform(include = new[] { RuntimePlatform.WindowsEditor, RuntimePlatform.OSXEditor })]
    public void EditorSpecificTest() { }
}
```

**Run by category from command line:**
```bash
Unity -runTests -testCategory "Unit;Fast" -testResults results.xml
```

---

## Debugging

### The Debug Class

The `UnityEngine.Debug` class is the primary runtime debugging tool:

#### Logging Methods

```csharp
// Basic logging
Debug.Log("Informational message");
Debug.LogWarning("Something might be wrong");
Debug.LogError("Something is definitely wrong");

// Log with context object (clickable in Console to select the object)
Debug.Log("Player hit something", this.gameObject);
Debug.LogWarning("Missing reference", this.transform);

// Log with rich text formatting
Debug.Log("<color=red>Error:</color> <b>Bold message</b>");
Debug.Log("<color=#00ff00>Health: " + health + "</color>");

// Log formatted (like string.Format)
Debug.LogFormat("Player {0} scored {1} points", playerName, score);

// Exception logging
Debug.LogException(new System.Exception("Custom exception"));

// Assert (pauses Editor in Debug mode if condition is false)
Debug.Assert(health >= 0, "Health should never be negative!");
Debug.AssertFormat(enemyCount > 0, "Expected enemies, found {0}", enemyCount);

// Break (pauses the Editor — equivalent to a breakpoint)
Debug.Break();
```

#### Visual Debugging in Scene View

```csharp
// Draw a line (visible in Scene view for a duration)
Debug.DrawLine(startPos, endPos, Color.red, durationSeconds: 5f);
Debug.DrawLine(transform.position, target.position, Color.green);

// Draw a ray (automatically for one frame — call every frame)
void Update()
{
    Debug.DrawRay(transform.position, transform.forward * rayLength, Color.cyan);
    Debug.DrawRay(transform.position, Vector3.down * groundCheckDistance, Color.yellow, 0.1f);
}

// Note: DrawLine and DrawRay only appear in the Scene view, NOT the Game view.
// They require Gizmos to be enabled in the Scene view toolbar.
```

#### Conditional Compilation for Logging

Strip debug code from release builds:

```csharp
// Approach 1: Preprocessor directives
#if UNITY_EDITOR || DEVELOPMENT_BUILD
Debug.Log("Debug info: " + someValue);
#endif

// Approach 2: [Conditional] attribute — cleaner
using System.Diagnostics;

public static class GameLogger
{
    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void Log(string message)
    {
        Debug.Log(message);
    }

    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void LogWarning(string message)
    {
        Debug.LogWarning(message);
    }

    // Always included — errors should never be stripped
    public static void LogError(string message)
    {
        Debug.LogError(message);
    }
}

// Usage
GameLogger.Log("Frame: " + Time.frameCount);  // Stripped in release
GameLogger.LogError("Critical failure");       // Always present
```

#### Custom Debug Wrapper (Recommended Pattern)

```csharp
using UnityEngine;
using System.Diagnostics;

public static class Dbg
{
    public enum LogLevel { None, Error, Warning, Info, Verbose }

    // Set from a config ScriptableObject at startup
    public static LogLevel CurrentLevel = LogLevel.Info;

    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void Log(object message, Object context = null)
    {
        if (CurrentLevel >= LogLevel.Info)
            Debug.Log(message, context);
    }

    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void LogWarn(object message, Object context = null)
    {
        if (CurrentLevel >= LogLevel.Warning)
            Debug.LogWarning(message, context);
    }

    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void LogVerbose(object message, Object context = null)
    {
        if (CurrentLevel >= LogLevel.Verbose)
            Debug.Log(message, context);
    }

    // Always compiled — errors should always surface
    public static void LogError(object message, Object context = null)
    {
        Debug.LogError(message, context);
    }

    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void DrawRay(Vector3 start, Vector3 dir, Color color, float duration = 0f)
    {
        Debug.DrawRay(start, dir, color, duration);
    }

    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void DrawLine(Vector3 start, Vector3 end, Color color, float duration = 0f)
    {
        Debug.DrawLine(start, end, color, duration);
    }
}
```

### IDE Breakpoints

**Setting breakpoints in your IDE:**
1. Ensure **Code Optimization Mode** is set to **Debug** (bottom-right status bar in Unity Editor, click the bug icon).
2. Attach your IDE debugger to the Unity Editor process.
3. Set breakpoints on any C# line in your IDE.

**IDE-specific setup:**

| IDE | How to Attach | Package Required |
|-----|---------------|------------------|
| **VS Code** | Run and Debug → Attach to Unity | C# Dev Kit + Unity for VS Code extension |
| **Rider** | Run → Attach to Unity Process | Unity JetBrains Rider package |
| **Visual Studio** | Debug → Attach Unity Debugger | Visual Studio Tools for Unity |

**Code Optimization Mode toggle:**
- **Debug**: Allows debugger attachment, slower Play mode performance.
- **Release**: No debugger attachment, faster Play mode performance.

**Command-line override:**
```bash
Unity -debugCodeOptimization    # Start in Debug mode
Unity -releaseCodeOptimization  # Start in Release mode
```

### Console Window

Open via **Window > General > Console** (or **Ctrl+Shift+C**).

**Features:**
- Three tabs: **Clear** (Log), **Collapse** (Warning), **Error** (Error)
- Click any message to see stack trace
- Click "Player" indicator to filter by editor/player logs
- **Clear on Play** toggle — automatically clear logs when entering Play mode
- **Error Pause** — auto-pause on error (useful for null reference debugging)
- **Stack Trace Logging** menu — configure stack trace detail level

---

## Diagnostics

### Log File Locations

Unity writes log files for the Editor, Player, Package Manager, and Hub.

#### Editor Logs

| OS | Location |
|----|----------|
| **Windows** | `%LOCALAPPDATA%\Unity\Editor\Editor.log` |
| **macOS** | `~/Library/Logs/Unity/Editor.log` |
| **Linux** | `~/.config/unity3d/Editor.log` |

#### Player Logs (Builds)

| Platform | Location |
|----------|----------|
| **Windows** | `%USERPROFILE%\AppData\LocalLow\<CompanyName>\<ProductName>\Player.log` |
| **macOS** | `~/Library/Logs/<CompanyName>/<ProductName>/Player.log` |
| **Linux** | `~/.config/unity3d/<CompanyName>/<ProductName>/Player.log` |
| **Android** | Use `adb logcat` or pull via Device Log |
| **iOS** | Access via Xcode Organizer or GDB console |

#### Accessing Logs Programmatically

```csharp
using UnityEngine;

// Read the log file path at runtime
string logPath = Application.consoleLogPath;
Debug.Log("Log file: " + logPath);

// Write to the log
Application.logMessageReceived += OnLogMessage;

void OnLogMessage(string logString, string stackTrace, LogType type)
{
    // Can write to a custom log file or send over network
}
```

### Log File Access Code Pattern

```csharp
#if UNITY_EDITOR
using UnityEditor;
using System.IO;

public static class EditorLogAccess
{
    public static string EditorLogPath
    {
        get
        {
            string localLow;
            if (Application.platform == RuntimePlatform.WindowsEditor)
                localLow = System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData);
            else if (Application.platform == RuntimePlatform.OSXEditor)
                localLow = System.IO.Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.Personal), "Library/Logs");
            else // Linux
                localLow = System.IO.Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.Personal), ".config/unity3d");

            return Path.Combine(localLow, "Unity", "Editor.log");
        }
    }

    [MenuItem("Tools/Open Editor Log")]
    public static void OpenEditorLog()
    {
        if (File.Exists(EditorLogPath))
            EditorUtility.RevealInFinder(EditorLogPath);
        else
            Debug.LogError("Editor log not found at: " + EditorLogPath);
    }
}
#endif
```

### Stack Trace Configuration

Control the level of detail in stack traces shown in the Console and written to log files.

**Available levels:**

| Level | Description |
|-------|-------------|
| `None` | No stack trace output for this log type |
| `ScriptOnly` | Stack trace for managed C# code only (default) |
| `Full` | Stack trace for both managed and native (C++) code |

**Configure per log type:**

```csharp
// Set via code
Application.SetStackTraceLogType(LogType.Log, StackTraceLogType.ScriptOnly);
Application.SetStackTraceLogType(LogType.Warning, StackTraceLogType.ScriptOnly);
Application.SetStackTraceLogType(LogType.Error, StackTraceLogType.Full);
Application.SetStackTraceLogType(LogType.Exception, StackTraceLogType.Full);

// Get current setting
StackTraceLogType currentSetting = Application.GetStackTraceLogType(LogType.Error);
```

**Configure via UI:**
- Console toolbar → **Stack Trace Logging** → Select log type → Select level.
- Player Settings → **Other Settings → Stack Trace** (applies to builds).

**Recommended settings:**
- Development: `Full` for Error and Exception, `ScriptOnly` for Warning and Log
- Release build: `ScriptOnly` for Error and Exception, `None` for Warning and Log

### Crash Reporter

The Unity Crash Reporter captures crash dumps when the Editor or Player crashes.

**Crash report locations:**

| Platform | Location |
|----------|----------|
| **Windows** | `%TEMP%\Unity\Editor\Crashes` |
| **macOS** | `~/Library/Logs/Unity/Crashes` |
| **Linux** | `~/.config/unity3d/Crashes` |

**What's included:**
- Crash dump file (`.dmp` on Windows)
- Error log with stack trace
- System information
- Last Player/Editor log

**Disabling the crash reporter (for automated testing):**
```bash
Unity -projectPath /path/to/project -crashReport-false
```

**Custom crash handling (limited):**
```csharp
// Log unhandled exceptions (does not prevent crash)
Application.logMessageReceived += (condition, trace, type) =>
{
    if (type == LogType.Exception)
    {
        // Send crash data to analytics service
        // Write to custom crash log
    }
};
```

---

## Profiler & Frame Debugger

### Profiler Window

Open via **Window > Analysis > Profiler** (or **Ctrl+7**, **Cmd+7** on macOS).

The Profiler records performance data from the application in real time. It measures behavior in multiple categories (profiler modules).

#### Profiler Modules

| Module | What It Measures |
|--------|-----------------|
| **CPU Usage** | Time spent in scripts, physics, rendering, animation, GC |
| **GPU Usage** | GPU render time, draw calls, shader passes |
| **Rendering** | Draw calls, triangles, vertices, set-pass calls, batches |
| **Memory** | Total allocated, managed heap, native memory, textures, meshes |
| **Audio** | Audio source counts, voice counts, CPU usage |
| **Physics** | Rigidbody count, contacts, physics time |
| **Network** | Network operations and message traffic |
| **UI** | Canvas rebuild count, layout rebuild time |
| **Global Illumination** | GI baking and runtime updates |

#### Profiler Workflow

1. **Enter Play mode** with the Profiler window open.
2. Observe frame spikes in the CPU Usage graph.
3. **Click a frame spike** to freeze on that frame.
4. **Drill down** in the CPU Usage hierarchy to find the expensive method.
5. **Switch to Hierarchy view** to see per-method timings.
6. **Enable Deep Profiling** for per-method breakdowns (significant overhead — use sparingly).

#### Deep Profiling

Deep profiling instruments every method call, providing per-method timing at the cost of significant runtime overhead.

**Enable:**
- Profiler toolbar → **Deep Profile** toggle.
- Or in Build Settings → **Development Build** + **Autoconnect Profiler**.

**When to use:**
- Only when you cannot identify the bottleneck from regular profiling.
- On a development build (not in the Editor) for more accurate results.
- **Always disable before performance testing** — deep profiling drastically slows execution.

#### Profiling API

```csharp
using UnityEngine.Profiling;

public class ProfiledCode : MonoBehaviour
{
    void Update()
    {
        // Profile a specific code block
        Profiler.BeginSample("MyExpensiveOperation");
        DoExpensiveWork();
        Profiler.EndSample();

        // Or use a using block for automatic EndSample
        DoWorkWithProfiling();
    }

    void DoWorkWithProfiling()
    {
        using (new ProfilingScope("NestedOperation"))
        {
            // Code here is profiled under "NestedOperation"
        }
    }
}

// Custom profiler counters
public class ProfilerCounters
{
    public struct MyProfilerModule
    {
        public static readonly ProfilerCounter<int> EntityCount =
            new ProfilerCounter<int>(ProfilerCategory.Scripts, "Entity Count", ProfilerMarkerDataUnit.Count);
    }

    void Update()
    {
        MyProfilerModule.EntityCount.Value = currentEntityCount;
    }
}
```

### Frame Debugger

Open via **Window > Analysis > Frame Debugger**.

The Frame Debugger captures a single rendered frame and lets you step through every draw call to understand how the scene is rendered.

#### Key Features

| Feature | Description |
|---------|-------------|
| **Draw call list** | Ordered list of every draw call in the captured frame |
| **Step through draws** | Click through each draw call to see precisely what's rendered |
| **Shader properties** | Inspect all shader properties for each draw call |
| **Render target** | View each render pass's output texture |
| **Batching info** | See why draw calls were batched or not batched |
| **Overdraw visualization** | Highlight areas with excessive overdraw |

#### How to Use Frame Debugger

1. **Open Frame Debugger** window.
2. **Click Enable** — this captures the next rendered frame and pauses rendering.
3. **Step through** each event in the hierarchy.
4. Look for:
   - Split batches (SRP Batcher not working — check shader compatibility)
   - Excessive draw calls for the same material
   - Duplicate render passes
   - Unexpected shader keywords or variants

#### Common Frame Debugger Discoveries

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Many identical draw calls | No static batching | Enable static on objects |
| Draw calls not batched despite same material | Different material instances | Use shared material, not `.material` |
| Shadow map appears re-rendered | Shadow distance too far | Reduce shadow distance |
| Transparent objects overdrawing | Many overlapping semi-transparent objects | Reduce transparency or use stencil |
| Full-screen blit passes | Post-processing effects | Optimize or combine post-process passes |

### Memory Profiler

Access via **Window > Analysis > Memory Profiler** (requires installing `com.unity.memoryprofiler` package).

**Key capabilities:**
- Capture a snapshot of memory at any point.
- Inspect managed heap (C#) and native memory.
- Find leaked Unity objects (references keeping objects alive).
- Track texture memory, mesh memory, audio memory by category.
- Compare two snapshots to find memory growth between frames.

**Workflow:**
1. Install package: `com.unity.memoryprofiler`
2. Open **Window > Analysis > Memory Profiler**
3. Enter Play mode → click **Capture**
4. Inspect the snapshot for large allocations or unexpected object counts

---

## Common Debugging Patterns

### Null Reference Debugging

NullReferenceException is the most common Unity runtime error. Systematic approach:

**1. Enable Error Pause**

In the Console toolbar, click **Error Pause** — Unity will pause Play mode when a null reference (or any error) occurs. This freezes the frame and lets you inspect the hierarchy.

**2. Read the stack trace**

The Console message includes the full managed stack trace. The top line is where the null reference occurred:
```
NullReferenceException: Object reference not set to an instance of an object
MyScript.Update () (at Assets/Scripts/MyScript.cs:45)
```

**3. Find the null variable**

If the column is a complex expression, break it into separate lines:
```csharp
// Hard to debug:
player.GetComponent<WeaponManager>().CurrentWeapon.Fire();

// Debuggable version:
void Update()
{
    var weaponManager = player.GetComponent<WeaponManager>();
    if (weaponManager == null) { Debug.LogError("WeaponManager is null"); return; }

    var weapon = weaponManager.CurrentWeapon;
    if (weapon == null) { Debug.LogError("CurrentWeapon is null"); return; }

    weapon.Fire();
}
```

**4. Guard against destroyed Unity objects**

Remember: `UnityEngine.Object` uses custom `== null`:
```csharp
// This can be true even after Destroy() — the C# wrapper still exists
if (myObject == null) return;  // Catches destroyed objects

// If you need to check actual C# null:
if (ReferenceEquals(myObject, null)) return;
```

### Event Subscription Leaks

Unsubscribing from events is critical. Subscriptions keep objects alive even after scene unload.

```csharp
public class Subscriber : MonoBehaviour
{
    void OnEnable()
    {
        GameEvents.OnGameStart += HandleGameStart;
        GameEvents.OnGameEnd += HandleGameEnd;
    }

    void OnDisable()
    {
        // ALWAYS unsubscribe — prevents leaks and double-subscription
        GameEvents.OnGameStart -= HandleGameStart;
        GameEvents.OnGameEnd -= HandleGameEnd;
    }
}
```

**Detection pattern:**
- Memory Profiler shows objects that should be destroyed still in memory.
- Domain reload disabled → objects persist between Play mode sessions.
- Use `+=` without matching `-=` is a guaranteed leak.

### Finding Objects at Runtime

```csharp
// Finding by name (slow — avoid in Update)
GameObject.Find("Player");

// Finding by tag (better)
GameObject.FindWithTag("Enemy");
GameObject[] enemies = GameObject.FindGameObjectsWithTag("Enemy");

// Finding by type (expensive — cache results)
FindFirstObjectByType<PlayerController>();
FindObjectsByType<EnemySpawner>(FindObjectsSortMode.None);

// Finding components on self or children
GetComponent<Rigidbody>();
GetComponentInChildren<Collider>();
GetComponentInParent<Canvas>();

// Preferred: reference via Inspector
[SerializeField] private PlayerController player; // drag in Editor

// Find all objects in scene (debugging only — expensive)
GameObject[] allObjects = FindObjectsByType<GameObject>(FindObjectsSortMode.None);
```

### Using `[RuntimeInitializeOnLoadMethod]` for Diagnostics

```csharp
using UnityEngine;

public static class DiagnosticBootstrapper
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void InitializeDiagnostics()
    {
        Application.logMessageReceived += OnLogReceived;
    }

    static void OnLogReceived(string condition, string stackTrace, LogType type)
    {
        if (type == LogType.Exception)
        {
            // Capture and report unhandled exceptions
            var entry = new System.Collections.Generic.Dictionary<string, string>
            {
                ["message"] = condition,
                ["stackTrace"] = stackTrace,
                ["time"] = System.DateTime.UtcNow.ToString("O")
            };
            // Send to analytics, write to file, etc.
        }
    }
}
```

### Pausing on Specific Conditions

```csharp
// Programmatic breakpoint
if (enemyCount < 0)
{
    Debug.LogError("Enemy count is negative: " + enemyCount);
    Debug.Break(); // Pauses the Editor as if a breakpoint was hit
}

// Conditional break
if (health > 100 && !invulnerable)
{
    Debug.Assert(false, "Health exceeded max without invulnerability flag");
}

// Frame-specific debugging
void Update()
{
    if (Time.frameCount == 500)
        Debug.Break(); // Pause on frame 500
}
```

### Debugging with Gizmos

```csharp
// Draw in Scene view (must have Gizmos enabled)
void OnDrawGizmos()
{
    // Always visible
    Gizmos.color = Color.red;
    Gizmos.DrawWireSphere(transform.position, detectionRadius);
}

void OnDrawGizmosSelected()
{
    // Only when the object is selected in the hierarchy
    Gizmos.color = Color.yellow;
    Gizmos.DrawRay(transform.position, transform.forward * 5f);
    Gizmos.DrawWireCube(transform.position + Vector3.up, Vector3.one);
}

// Visualize patrol path
void OnDrawGizmos()
{
    if (waypoints == null || waypoints.Length < 2) return;

    Gizmos.color = Color.cyan;
    for (int i = 0; i < waypoints.Length; i++)
    {
        Gizmos.DrawSphere(waypoints[i], 0.3f);
        Gizmos.DrawLine(waypoints[i], waypoints[(i + 1) % waypoints.Length]);
    }
}
```

---

## Code Patterns

### Pattern 1: Complete Edit Mode Test Fixture

```csharp
// Assembly: MyGame.Tests (references MyGame)
// Test file: Assets/Tests/MyGame.Tests/MathUtilityTests.cs

using NUnit.Framework;
using MyGame;

[TestFixture]
public class MathUtilityTests
{
    [OneTimeSetUp]
    public void GlobalSetup()
    {
        // Runs once before any test in this fixture
        // e.g., load shared test data, create ScriptableObject instances
    }

    [OneTimeTearDown]
    public void GlobalTeardown()
    {
        // Runs once after all tests
        // e.g., clean up loaded assets, delete temp files
    }

    [SetUp]
    public void Setup()
    {
        // Runs before EACH test
        // Reset state, create fresh instances
    }

    [TearDown]
    public void Teardown()
    {
        // Runs after EACH test
        // Clean up created objects
    }

    [Test]
    public void Add_TwoPositiveNumbers_ReturnsSum()
    {
        Assert.AreEqual(5, MathUtility.Add(2, 3));
    }

    [Test]
    [TestCase(0, 0, 0)]
    [TestCase(1, -1, 0)]
    [TestCase(100, 200, 300)]
    public void Add_Parameterized(int a, int b, int expected)
    {
        Assert.AreEqual(expected, MathUtility.Add(a, b));
    }

    [Test]
    public void Divide_ByZero_ThrowsException()
    {
        Assert.Throws<System.DivideByZeroException>(() =>
            MathUtility.Divide(10, 0));
    }

    [Test]
    [Category("Slow")]
    [Timeout(1000)]
    public void Fibonacci_LargeInput_CompletesWithinTimeout()
    {
        var result = MathUtility.Fibonacci(40);
        Assert.Greater(result, 0);
    }

    [Test]
    public void Normalize_EmptyArray_ReturnsEmpty()
    {
        var empty = new float[0];
        var result = MathUtility.Normalize(empty);
        Assert.IsNotNull(result);
        Assert.AreEqual(0, result.Length);
    }
}
```

### Pattern 2: Complete Play Mode Test Fixture

```csharp
// Assembly: MyGame.Tests (references MyGame)
// Test file: Assets/Tests/MyGame.Tests/HealthComponentTests.cs

using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using MyGame;

public class HealthComponentTests
{
    private GameObject testGameObject;
    private HealthComponent healthComponent;

    [SetUp]
    public void Setup()
    {
        testGameObject = new GameObject("TestHealth");
        healthComponent = testGameObject.AddComponent<HealthComponent>();
        healthComponent.MaxHealth = 100;
    }

    [TearDown]
    public void Teardown()
    {
        Object.Destroy(testGameObject);
    }

    [UnityTest]
    public IEnumerator TakeDamage_ReducesHealth()
    {
        yield return null; // Wait for Start

        healthComponent.TakeDamage(30);

        Assert.AreEqual(70, healthComponent.CurrentHealth);
    }

    [UnityTest]
    public IEnumerator TakeDamage_ClampsToZero()
    {
        yield return null;
        healthComponent.TakeDamage(200);
        Assert.AreEqual(0, healthComponent.CurrentHealth);
    }

    [UnityTest]
    public IEnumerator Heal_RestoresHealth()
    {
        yield return null;
        healthComponent.TakeDamage(50);
        healthComponent.Heal(20);
        Assert.AreEqual(70, healthComponent.CurrentHealth);
    }

    [UnityTest]
    public IEnumerator DamageOverTime_WorksAcrossFrames()
    {
        yield return null;
        healthComponent.ApplyDamageOverTime(5, 1f);

        yield return new WaitForSeconds(1.1f);
        Assert.AreEqual(95, healthComponent.CurrentHealth);

        yield return new WaitForSeconds(1f);
        Assert.AreEqual(90, healthComponent.CurrentHealth);
    }

    [UnityTest]
    public IEnumerator Death_WhenHealthReachesZero_FiresEvent()
    {
        bool deathCalled = false;
        healthComponent.OnDeath += () => deathCalled = true;

        yield return null;
        healthComponent.TakeDamage(100);

        Assert.IsTrue(deathCalled);
    }
}
```

### Pattern 3: Parameterized Test with TestCaseSource

```csharp
using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

public class DamageCalculatorTests
{
    // Data source as a static field
    private static readonly object[] DamageTestCases =
    {
        new object[] { 100, 0, 100 },    // (baseDamage, armor, expected)
        new object[] { 50, 20, 30 },
        new object[] { 10, 20, 0 },       // armor exceeds damage
        new object[] { 0, 50, 0 },
        new object[] { 999, 1, 998 }
    };

    [Test]
    [TestCaseSource(nameof(DamageTestCases))]
    public void CalculateDamage_VariousInputs(int baseDamage, int armor, int expected)
    {
        int result = DamageCalculator.Calculate(baseDamage, armor);
        Assert.AreEqual(expected, result);
    }

    // Data source as a method (for dynamic generation)
    private static IEnumerable DamageRangeTestCases()
    {
        for (int dmg = 0; dmg <= 100; dmg += 20)
        {
            for (int armor = 0; armor <= 50; armor += 10)
            {
                yield return new object[] { dmg, armor };
            }
        }
    }

    [Test]
    [TestCaseSource(nameof(DamageRangeTestCases))]
    public void Calculate_ResultNeverNegative(int baseDamage, int armor)
    {
        int result = DamageCalculator.Calculate(baseDamage, armor);
        Assert.GreaterOrEqual(result, 0);
    }
}
```

### Pattern 4: Debug Wrapper System

```csharp
// Place in: Assets/Scripts/Logging/Dbg.cs
using UnityEngine;
using System.Diagnostics;
using System.Runtime.CompilerServices;

public enum LogVerbosity
{
    Silent = 0,
    Errors = 1,
    Warnings = 2,
    Info = 3,
    Verbose = 4
}

public static class Dbg
{
    // Configure at startup from a settings ScriptableObject or config file
    public static LogVerbosity Verbosity = LogVerbosity.Info;

    // Standard logging (stripped in release)
    [Conditional("DEVELOPMENT_BUILD"), Conditional("UNITY_EDITOR")]
    public static void Log(object message, Object context = null,
        [CallerMemberName] string member = "",
        [CallerFilePath] string filePath = "",
        [CallerLineNumber] int line = 0)
    {
        if (Verbosity >= LogVerbosity.Info)
        {
            string fileName = System.IO.Path.GetFileName(filePath);
            Debug.Log($"[{fileName}:{line}] {message}", context);
        }
    }

    [Conditional("DEVELOPMENT_BUILD"), Conditional("UNITY_EDITOR")]
    public static void LogWarn(object message, Object context = null)
    {
        if (Verbosity >= LogVerbosity.Warnings)
            Debug.LogWarning(message, context);
    }

    [Conditional("DEVELOPMENT_BUILD"), Conditional("UNITY_EDITOR")]
    public static void LogVerbose(object message, Object context = null)
    {
        if (Verbosity >= LogVerbosity.Verbose)
            Debug.Log(message, context);
    }

    // Always compiled — errors cannot be stripped
    public static void LogError(object message, Object context = null)
    {
        Debug.LogError(message, context);
    }

    // Assert equivalent (stripped in release)
    [Conditional("DEVELOPMENT_BUILD"), Conditional("UNITY_EDITOR")]
    public static void Assert(bool condition, string message = "")
    {
        if (!condition)
        {
            Debug.LogError($"ASSERT FAILED: {message}");
            Debug.Break();
        }
    }

    // Visual debugging (stripped in release)
    [Conditional("DEVELOPMENT_BUILD"), Conditional("UNITY_EDITOR")]
    public static void DrawRay(Vector3 start, Vector3 dir, Color color,
        float duration = 0f)
    {
        Debug.DrawRay(start, dir, color, duration);
    }

    [Conditional("DEVELOPMENT_BUILD"), Conditional("UNITY_EDITOR")]
    public static void DrawLine(Vector3 start, Vector3 end, Color color,
        float duration = 0f)
    {
        Debug.DrawLine(start, end, color, duration);
    }
}
```

### Pattern 5: Log File Access Utility

```csharp
#if UNITY_EDITOR
using UnityEditor;
using System.IO;
using System.Runtime.InteropServices;

public static class EditorLogUtility
{
    public static string EditorLogPath
    {
        get
        {
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                string localAppData = System.Environment.GetFolderPath(
                    System.Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(localAppData, "Unity", "Editor", "Editor.log");
            }
            else if (Application.platform == RuntimePlatform.OSXEditor)
            {
                string home = System.Environment.GetFolderPath(
                    System.Environment.SpecialFolder.Personal);
                return Path.Combine(home, "Library", "Logs", "Unity", "Editor.log");
            }
            else // Linux
            {
                string home = System.Environment.GetFolderPath(
                    System.Environment.SpecialFolder.Personal);
                return Path.Combine(home, ".config", "unity3d", "Editor.log");
            }
        }
    }

    [MenuItem("Tools/Logs/Open Editor Log")]
    public static void OpenEditorLog()
    {
        if (File.Exists(EditorLogPath))
        {
            EditorUtility.RevealInFinder(EditorLogPath);
            Debug.Log("Editor log: " + EditorLogPath);
        }
        else
        {
            Debug.LogError("Editor log not found at: " + EditorLogPath);
        }
    }

    [MenuItem("Tools/Logs/Open Editor Log Folder")]
    public static void OpenEditorLogFolder()
    {
        string folder = Path.GetDirectoryName(EditorLogPath);
        if (Directory.Exists(folder))
            EditorUtility.RevealInFinder(folder);
    }

    [MenuItem("Tools/Logs/Print Editor Log Path")]
    public static void PrintEditorLogPath()
    {
        Debug.Log("Editor log path: " + EditorLogPath);
    }
}
#endif
```

### Pattern 6: Profiler Section Marker

```csharp
using UnityEngine;
using UnityEngine.Profiling;

public class ProfilerInstrumentedSystem : MonoBehaviour
{
    private void Update()
    {
        // Mark a complete operation with begin/end
        Profiler.BeginSample("MySystem.Update");
        ProcessEntities();
        Profiler.EndSample();
    }

    private void ProcessEntities()
    {
        // Using scope — auto-ends when disposed
        using (new ProfilingScope("EntityProcessing"))
        {
            for (int i = 0; i < entities.Length; i++)
            {
                ProcessSingleEntity(entities[i]);
            }
        }
    }

    private void ProcessSingleEntity(Entity entity)
    {
        Profiler.BeginSample("ProcessSingleEntity");
        entity.UpdateLogic();
        entity.RenderUpdate();
        Profiler.EndSample();
    }

    // ProfilingScope helper (Unity 2021+)
    private struct ProfilingScope : System.IDisposable
    {
        public ProfilingScope(string name) => Profiler.BeginSample(name);
        public void Dispose() => Profiler.EndSample();
    }
}
```

---

## Best Practices

1. **Use Edit Mode tests for pure logic, Play Mode tests for runtime behavior.** Edit Mode tests run faster and don't require Play mode entry. Reserve Play Mode tests for MonoBehaviour lifecycle, physics, and coroutine behavior.

2. **Extract pure logic from MonoBehaviours.** Move calculations, validation, and data processing into static methods or plain C# classes. This makes them testable in Edit Mode without GameObjects.

3. **Follow Arrange-Act-Assert strictly.** Keep tests focused on one behavior. If a test needs more than 3-5 lines of Arrange or multiple Act steps, split it.

4. **Name tests with `Method_Scenario_ExpectedResult`.** Example: `TakeDamage_AtZeroHealth_TriggersDeathEvent`. The name alone should tell you what the test verifies.

5. **Always clean up in `[TearDown]`.** Destroy GameObjects created in `[SetUp]` to prevent test pollution. Play Mode tests that leak objects can cause subsequent tests to fail.

6. **Use `[Category]` attributes for test organization.** Categories like `Unit`, `Integration`, `Slow`, `Network` enable selective test execution in CI or when working on specific subsystems.

7. **Wrap `Debug.Log` in `[Conditional]` methods.** Strip development-only logging from release builds using `[Conditional("DEVELOPMENT_BUILD")]`. Never strip error logging.

8. **Never striplog errors.** `Debug.LogError` and `Debug.LogException` calls should always compile into builds. Errors are the canary in the coal mine — you need them in release builds too.

9. **Set `StackTraceLogType.Full` for exceptions in development builds.** Exceptions are rare and critical — the full stack trace (including native frames) helps diagnose root causes.

10. **Use `Error Pause` in the Console.** Enable this to freeze Play mode on any error — invaluable for catching null references at the moment they occur, with the full scene state intact.

11. **Always unsubscribe from events in `OnDisable()`.** Match every `+=` with a `-=`. Event subscription leaks are a top cause of ghost objects and memory growth across scene loads.

12. **Use `[UnityTest]` yield instructions deliberately.** `yield return null` advances one frame. Use `yield return new WaitForSeconds()` for timed waits. Avoid over-yielding — it slows tests unnecessarily.

13. **Profile before optimizing.** Use the Profiler to identify the actual bottleneck. The Frame Debugger reveals rendering inefficiencies. Guessing at performance problems wastes time.

14. **Run tests before every commit.** Integrate `Unity -runTests -batchmode -quit` into your CI pipeline. A passing test suite is the only reliable guard against regressions.

15. **Use `LogAssert.Expect` to verify log output in tests.** Tests should verify that invalid operations produce the expected warnings/errors. This prevents silent failures.

16. **Keep test assemblies small and focused.** One test assembly per logical module. Small assemblies compile faster and make test discovery quicker in the Test Runner window.

17. **Set `[Timeout]` on Play Mode tests.** Play Mode tests can hang (infinite loops, deadlocks). A timeout ensures the test suite doesn't stall indefinitely.

18. **Use `RuntimeInitializeOnLoadMethod` to reset static state.** When domain reload is disabled for faster iteration, static variables persist. Use this attribute to reset them on Play mode entry.

19. **Open Editor log frequently during debugging.** Many engine-level issues (shader compilation errors, asset import failures) only appear in the Editor log, not in the Console window.

20. **Cache `LogAssert.Expect` calls before the action under test.** Call `LogAssert.Expect` before the code that triggers the log — it registers an expectation, not a retroactive check.

---

## Quick Reference: Console Commands

```bash
# Run Edit Mode tests
Unity -batchmode -quit -projectPath . -runTests -testPlatform EditMode -testResults results.xml

# Run Play Mode tests
Unity -batchmode -quit -projectPath . -runTests -testPlatform PlayMode -testResults results-playmode.xml

# Run with log file
Unity -batchmode -quit -projectPath . -runTests -testPlatform EditMode -testResults results.xml -logFile test.log

# Run specific test
Unity -batchmode -quit -projectPath . -runTests -testFilter "MyGame.Tests.PlayerTests.*" -testPlatform EditMode -testResults results.xml

# Run by category
Unity -batchmode -quit -projectPath . -runTests -testCategory "Unit;Integration" -testPlatform EditMode -testResults results.xml

# Start in debug mode
Unity -debugCodeOptimization -projectPath .

# Disable crash reporter
Unity -crashReport-false -projectPath .
```

---

## Key Classes and APIs Reference

| Class / API | Purpose |
|-------------|---------|
| `[Test]` | Standard NUnit test attribute |
| `[UnityTest]` | Coroutine-based Unity test attribute |
| `[SetUp]` / `[TearDown]` | Per-test setup and teardown |
| `[OneTimeSetUp]` / `[OneTimeTearDown]` | Fixture-level setup and teardown |
| `[TestCase]` / `[TestCaseSource]` | Parameterized test data |
| `[Category]` / `[Timeout]` / `[Ignore]` / `[Explicit]` | Test control attributes |
| `[UnitySetUp]` / `[UnityTearDown]` | Coroutine-based per-test setup/teardown |
| `Assert` / `CollectionAssert` / `StringAssert` | NUnit assertion classes |
| `LogAssert.Expect` | Verify that expected log messages are emitted |
| `Debug.Log` / `LogWarning` / `LogError` / `LogException` | Runtime logging methods |
| `Debug.DrawLine` / `Debug.DrawRay` | Scene view debug visualization |
| `Debug.Break()` | Programmatic breakpoint (pauses Editor) |
| `Debug.Assert()` | Conditional pause (pauses when condition is false) |
| `TestRunnerApi` | Programmatic test execution from code |
| `Application.consoleLogPath` | Path to the current log file |
| `Application.SetStackTraceLogType()` | Configure stack trace detail per log type |
| `Application.logMessageReceived` | Event for intercepting log messages |
| `Profiler.BeginSample` / `Profiler.EndSample` | Custom profiler markers |
| `ProfilerCounter<T>` | Custom profiler metrics |
| `UnityEngine.TestTools` | Unity-specific test utilities |
| `FrameDebugger` (Window) | Step through individual draw calls |
| `Memory Profiler` (`com.unity.memoryprofiler`) | Memory snapshot analysis |

---

## Additional Resources

- [Unity Test Framework Package Documentation](https://docs.unity3d.com/Packages/com.unity.test-framework@latest)
- [Unity Test Framework Samples (GitHub)](https://github.com/Unity-Technologies/unity-test-framework)
- [NUnit Documentation](https://docs.nunit.org/)
- [Debug C# Code in Unity](https://docs.unity3d.com/Manual/ManagedCodeDebugging.html)
- [Unity Profiler Manual](https://docs.unity3d.com/Manual/Profiler.html)
- [Frame Debugger Manual](https://docs.unity3d.com/Manual/FrameDebugger.html)
- [Memory Profiler Package](https://docs.unity3d.com/Packages/com.unity.memoryprofiler@latest)
- [Editor Log Files Documentation](https://docs.unity3d.com/Manual/LogFiles.html)
- [Stack Trace Logging Configuration](https://docs.unity3d.com/Manual/Console.html)
