---
name: unity-audio
description: Comprehensive reference for Unity's audio system including clips, sources, listeners, mixers, random containers, spatial sound, import settings, profiler, and the Scriptable Audio Pipeline. Based on Unity 6.4 documentation.
---

# Unity Audio

## Description
Comprehensive reference for Unity's audio system including AudioSource, AudioListener, AudioClip import/compression, Audio Mixer (groups, effects, snapshots, ducking), Audio Random Containers, ambisonic audio, tracker modules, Reverb Zones, Native Audio Plugin SDK, Scriptable Audio Pipeline (generators, root outputs, Burst-compatible HPC#), Profiler, and runtime scripting APIs. Based on Unity 6.4 (6000.4) documentation.

## When to Use
Load when working with audio in Unity: importing and configuring audio files, setting up AudioSources for 2D/3D playback, routing through Audio Mixers, applying DSP effects, creating snapshot transitions (moods/themes), implementing side-chain ducking, building randomized sound effect systems, working with ambisonic/spatial audio, custom audio DSP plugin development, procedural audio generation with the Scriptable Audio Pipeline, profiling audio performance, or debugging voice limit / memory issues.

## Core Concepts

### Audio System Overview

Unity's audio signal flow:

```
Audio File (.wav/.ogg/.mp3/etc.)
    → Import
AudioClip (asset)
    → Assigned to
AudioSource (GameObject component)
    → Routed through (optional)
Audio Mixer (groups with effects)
    → Received by
AudioListener (one per scene, on main camera)
    → Output to speakers
```

**Key architectural points:**
- **AudioSource** emits sound; **AudioListener** receives it (mic/speaker analogy)
- **3D spatial processing** (distance attenuation, Doppler, spread) happens at the AudioSource level, before the signal enters the Audio Mixer
- **2D sounds** (spatialBlend=0) bypass spatial processing entirely
- DSP buffer size controls latency vs performance tradeoff (Project Settings)
- Virtual voice system culls sounds exceeding Max Real Voices; loudest/nearest prioritized

### AudioSource Component

| Property | Type | Description |
|----------|------|-------------|
| **Audio Generator** | AudioClip/AudioRandomContainer | Sound asset to play |
| **Output** | AudioMixerGroup | Route to mixer group (None = direct to Listener) |
| **Mute** | bool | Track plays but no audible output |
| **Spatialize** | bool | Enable custom spatialization (requires SDK plugin) |
| **Spatialize Post Effect** | bool | Apply spatializer before/after other effects |
| **Bypass Effects** | bool | Skip all filter effects on this source |
| **Bypass Listener Effects** | bool | Skip all Listener effects |
| **Bypass Reverb Zones** | bool | Skip all Reverb Zone processing |
| **Play On Awake** | bool | Auto-play when scene starts |
| **Loop** | bool | Loop clip on completion |
| **Priority** | int (0–256) | 0=most important, 256=least. Default 128 |
| **Volume** | float (0–1) | Loudness at 1 world unit from listener |
| **Pitch** | float | Playback speed (1=normal) |
| **Stereo Pan** | float | Stereo field position for 2D sounds (-1=left, 1=right) |
| **Spatial Blend** | float (0–1) | 0=2D, 1=3D (mixed allowed) |
| **Reverb Zone Mix** | float (0–1.1) | Signal routed to reverb zones |

**3D Sound Settings:**

| Property | Description |
|----------|-------------|
| **Doppler Level** | Amount of Doppler pitch shift (0=none) |
| **Spread** | Spread angle in degrees for 3D stereo/multichannel (0–360) |
| **Min Distance** | Distance within which volume stays at maximum |
| **Max Distance** | Distance where volume reaches zero (linear) or stops attenuating (custom) |
| **Volume Rolloff** | Logarithmic (physically accurate), Linear, or Custom curve |

**Distance Function Curves** (editable in Inspector when Rolloff=Custom):
- Volume vs distance
- Spatial Blend vs distance
- Spread vs distance
- Low-Pass cutoff vs distance (requires AudioLowPassFilter)
- Reverb Zone mix vs distance

**AudioSource Scripting API — Key Properties:**
`bypassEffects`, `bypassListenerEffects`, `bypassReverbZones`, `clip`, `dopplerLevel`, `generator`, `ignoreListenerPause`, `ignoreListenerVolume`, `isPlaying` (read-only), `isVirtual` (read-only, true when culled), `loop`, `maxDistance`, `minDistance`, `mute`, `outputAudioMixerGroup`, `panStereo`, `pitch`, `playOnAwake`, `priority`, `reverbZoneMix`, `rolloffMode`, `spatialBlend`, `spatialize`, `spread`, `time` (seconds), `timeSamples` (PCM samples), `velocityUpdateMode`, `volume`

**AudioSource Scripting API — Key Methods:**
`Play()`, `Pause()`, `UnPause()`, `Stop()`, `PlayOneShot(AudioClip, float volumeScale)`, `PlayDelayed(float delay)`, `PlayScheduled(double dspTime)`, `SetScheduledStartTime(double)`, `SetScheduledEndTime(double)`, `GetOutputData(float[], int channel)`, `GetSpectrumData(float[], int channel, FFTWindow)`, `SetCustomCurve(AudioSourceCurveType, AnimationCurve)`, `GetCustomCurve(AudioSourceCurveType)`, `GetSpatializerFloat(int, out float)`, `SetSpatializerFloat(int, float)`

**Static Methods:** `PlayClipAtPoint(AudioClip, Vector3, float)` — creates temp GameObject at world position.

### AudioListener

- **One per scene** — only one should be active
- No Inspector properties on the component
- Attached to Main Camera by default; can be on player GameObject
- Receives all sounds and outputs through speakers
- Reverb Zones apply based on Listener position
- Listener-level effects apply to all audible sounds
- Static properties: `AudioListener.volume` (0–1 master), `AudioListener.pause` (pause all sounds)

**3D vs 2D behavior:** 3D sources emulate position/velocity/orientation relative to the Listener; 2D sources (spatialBlend=0) ignore spatial processing entirely.

### AudioClip Import Settings

**Supported formats:** `.mp3`, `.wav`, `.aiff`/`.aif`, `.ogg` (Vorbis), `.flac`, tracker modules (`.mod`, `.xm`, `.it`, `.s3m`). Unity supports mono, stereo, and multichannel up to 8 channels.

**General Import Properties:**

| Property | Description |
|----------|-------------|
| **Force To Mono** | Down-mix to mono; peak-normalized after mixing |
| **Normalize** | Normalize during Force To Mono |
| **Load In Background** | Async load on worker thread (no main thread stall) |
| **Ambisonic** | Enable for B-format ambisonic WAV files |

**Platform-Specific Override Settings:**

| Property | Options | Description |
|----------|---------|-------------|
| **Load Type** | `Decompress On Load`, `Compressed In Memory`, `Streaming` | Runtime memory/CPU tradeoff |
| **Compression Format** | `PCM`, `ADPCM`, `Vorbis`/`MP3` | Codec used at runtime |
| **Sample Rate Setting** | `Preserve Sample Rate`, `Optimize Sample Rate`, `Override Sample Rate` | Controls output sample rate |
| **Quality** | 0–100 slider | Vorbis/MP3 compression quality |
| **Preload Audio Data** | On/Off | Preload after scene load (default on) |

**Load Type Details:**

| Load Type | Memory Usage | CPU at Play | Best For |
|-----------|-------------|-------------|----------|
| **Decompress On Load** | ~10× compressed size (Vorbis), ~3.5× (ADPCM) | None | Small compressed SFX |
| **Compressed In Memory** | Same as compressed file | Slight (mixer thread) | Files too large for Decompress |
| **Streaming** | ~200KB buffer overhead | Separate streaming thread | Music, long audio |

**Compression Format Selection:**

| Format | CPU | Memory | Best For |
|--------|-----|--------|----------|
| **PCM** | Very low (uncompressed) | Largest | Short SFX, highest quality |
| **ADPCM** | Low | ~3.5:1 over PCM | Noisy sounds in bulk (footsteps, impacts, weapons); artefacts on smooth signals |
| **Vorbis/MP3** | Higher (decompression) | ~10:1 over PCM | Music, medium-length SFX |

**Module files (.mod, .xm, .it, .s3m):** Set Load Type to **Compressed In Memory** to avoid full decompression.

**Preload Audio Data:** Disabled → data loads on first `Play()` / `PlayOneShot()` / `LoadAudioData()`. Unload with `UnloadAudioData()`.

### AudioClip Scripting API

**Properties (read-only from code):** `ambisonic` (bool), `channels` (int), `frequency` (int, Hz), `length` (float, seconds), `samples` (int, PCM), `loadInBackground`, `loadState` (AudioDataLoadState), `loadType` (AudioClipLoadType), `preloadAudioData`

**Methods:** `GetData(float[], int offsetSamples)`, `SetData(float[], int offsetSamples)`, `LoadAudioData()`, `UnloadAudioData()`

**Static:** `AudioClip.Create(string name, int lengthSamples, int channels, int frequency, bool stream)` — procedural clip creation.

**Delegates:** `PCMReaderCallback` (called when clip reads data), `PCMSetPositionCallback` (called when read position changes).

### Audio Manager (Project Settings)

**Path:** Edit > Project Settings > Audio

| Property | Description |
|----------|-------------|
| **Global Volume** | Master volume for all sounds (0–1) |
| **Volume Rolloff Scale** | Global attenuation factor for Logarithmic rolloff (1="real world") |
| **Doppler Factor** | Doppler effect audibility (0=disabled) |
| **Default Speaker Mode** | Stereo (2), Mono (1), Quad (4), 5.1 (6), 7.1 (8) — `AudioSpeakerMode` |
| **System Sample Rate** | Output sample rate (0=use system default) |
| **DSP Buffer Size** | Default / Best Latency / Good Latency / Best Performance |
| **Max Virtual Voices** | Max virtual (culled-but-tracked) voices; should exceed typical voice count |
| **Max Real Voices** | Max simultaneous audible voices; loudest prioritized |
| **Spatializer Plugin** | Native audio plugin for 3D spatialization |
| **Ambisonic Decoder Plugin** | Plugin for ambisonic-to-speaker decoding |
| **Disable Unity Audio** | Deactivate audio in standalone builds (Editor still previews) |
| **Enable Output Suspension** | Auto-suspend after long silence (Editor only) |
| **Virtualize Effect** | Dynamically disable effects on culled AudioSources to save CPU |

### Audio Mixer

The Audio Mixer is an **Asset** (created via Assets > Create > Audio Mixer) that mixes audio sources, applies effects, and performs mastering. Audio Sources route output to mixer groups via their **Output** property.

**Window layout:** Asset selector, Hierarchy View (tree of AudioGroups), Mixer Views (visibility presets), Snapshots panel, AudioGroup Strip View (VU meter, volume slider, Solo/Mute/Bypass, effects list), Edit In Play Mode toggle, Exposed Parameters panel.

**Audio Groups (Buses):**
- Tree-structured; always contains a **Master Group**
- Each group has one output; can route to any other group in any mixer
- Each group has exactly one **Attenuation Unit** (–80 to +20 dB)
- **S** (Solo), **M** (Mute), **B** (Bypass effects) per group
- VU meter shows RMS + peak hold at the attenuation point
- Groups can be colored via right-click → color tag for visual organization

**Available Mixer Effects:**

| Effect | Key Parameters |
|--------|---------------|
| **Attenuation** | Volume –80 to +20 dB (exactly one per group) |
| **LowPass** | Cutoff freq 10–22000 Hz (default 5000), Resonance 1–10 |
| **LowPass Simple** | Cutoff freq 10–22000 Hz (default 5000), no resonance |
| **HighPass** | Cutoff freq 10–22000 Hz (default 5000), Resonance 1–10 |
| **HighPass Simple** | Cutoff freq 10–22000 Hz (default 5000) |
| **Echo** | Delay 10–5000 ms, Decay 0–100%, Drymix/Wetmix 0–100%, Max channels 0–16 |
| **Flange** | Flanger modulation effect |
| **Chorus** | Dry mix 0–1, 3 wet taps, Delay 0.1–100 ms, Rate 0–20 Hz, Depth 0–1, Feedback 0–1 |
| **Distortion** | Distortion 0–1 (simulates low-quality radio) |
| **Normalize** | Fade in time 0–20000 ms, Lowest volume 0–1, Max amp 0–100000 |
| **Param EQ** | Center freq 20–22000 Hz, Octave Range 0.2–5, Frequency Gain 0.05–3 |
| **Pitch Shifter** | Pitch 0.5–2×, FFT Size 256–4096, Overlap 1–32, Max channels 0–16 |
| **Compressor** | ∞:1 limiter; Threshold 0 to –60 dB, Attack 10–200 ms, Release 20–1000 ms, Make up gain 0–30 dB |
| **SFX Reverb** | Wet/Dry, Room, Room HF/LF, Decay Time 0.1–20 s, Decay HF Ratio 0.1–2, Reflections/Reverb levels and delays, Diffusion/Density 0–100%, HF/LF Reference |
| **Send** | Diverges signal for side-chaining; Send Level (initially –80 dB, must increase), Destination dropdown |
| **Receive** | Takes signal from Send; no parameters |
| **Duck Volume** | Side-chain compression: Threshold, Attack, Release |

**Send & Receive Units (Side-Chaining):**
- **Send** diverges a copy of the signal and routes it to another effect's side-chain input
- **Receive** mixes the sent signal back into its group
- **Duck Volume** is a special effect that compresses based on side-chain signal — typical use: duck background music when dialogue plays

**Effect ordering:** Effects apply in list order top-to-bottom. Attenuation unit can be moved anywhere in the chain. Each effect has Bypass toggle, Copy settings to all snapshots, Add Before/After, Remove options.

**Snapshots:**
- Capture state of ALL parameters (volume, pitch, send levels, wet mix, effect params)
- **Start Snapshot** (star icon) — initializes on scene load
- Transitions use linear interpolation by default
- **Transition overrides:** Right-click parameter → choose transition type per-target-snapshot (e.g., brick-wall at start/end)
- **Wet mixing:** Right-click effect → Allow Wet Mixing to control dry/wet proportion (shown as colored bar)

**Exposed Parameters:**
- Right-click any parameter → "Expose to script" to bypass snapshot control
- Once `SetFloat()` is called on an exposed parameter, snapshots no longer control it
- `ClearFloat()` returns parameter to snapshot control
- Managed in the Exposed Parameters panel (rename, delete)

**Auto Mixer Suspend:** Mixer auto-suspends ~1 second after last source finishes; uses loudness measurement to wait for reverb/echo tails. Configure: select mixer asset → Inspector → enable Auto Mixer Suspend → set Threshold Volume (default –80 dB).

**Views Panel:** Create sub-sets of visible AudioGroups for workflow (no runtime impact). Each group has an eye icon to toggle visibility per view. Right-click eye → color tag.

### Audio Mixer Scripting API

**Namespace:** `UnityEngine.Audio`

```csharp
using UnityEngine;
using UnityEngine.Audio;
```

**Key Methods:**

| Method | Description |
|--------|-------------|
| `SetFloat(string name, float value)` | Set exposed parameter; locks it from snapshot control. Call in `Start()` or later, NOT in `Awake()`/`OnEnable()` |
| `GetFloat(string name, out float value)` | Get exposed parameter value; returns false if not found |
| `ClearFloat(string name)` | Reset exposed parameter to snapshot control |
| `TransitionToSnapshots(AudioMixerSnapshot[] snapshots, float[] weights, float timeToReach)` | Blend to weighted mixture of snapshots |
| `FindMatchingGroups(string subPath)` | Find groups by path substring (e.g., `"Master/AMBIENCE"`) |
| `FindSnapshot(string name)` | Find snapshot by exact name |

**Properties:** `outputAudioMixerGroup` (routing target), `updateMode` (Normal=scaled time, Unscaled=unscaled time for menus/pause)

### Audio Filters (Effect Components)

Effects applied as components on the same GameObject as AudioSource or AudioListener. Order in Inspector = order of application.

| Component | Description |
|-----------|-------------|
| **Audio Low Pass Filter** | Passes frequencies below cutoff |
| **Audio High Pass Filter** | Passes frequencies above cutoff |
| **Audio Echo Filter** | Adds echo/delay |
| **Audio Chorus Filter** | Chorus modulation |
| **Audio Distortion Filter** | Adds distortion |
| **Audio Reverb Filter** | Standalone reverb (not zone-based) |
| **Audio Flange Filter** | Flanging effect |
| **Audio High Pass Simple Filter** | Simplified high-pass |

These are CPU intensive — monitor in Profiler > Audio tab. Bypass via `AudioSource.bypassEffects`.

### Reverb Zones

**Component:** `AudioReverbZone` — area-based reverb based on AudioListener position.

| Property | Description |
|----------|-------------|
| **Min Distance** | Inner circle — full reverb applied |
| **Max Distance** | Outer circle — no reverb; transition begins inward |
| **Reverb Preset** | Preset effect (Cave, Hall, Room, etc.) |

Multiple zones can mix for combined effects. Sources can bypass via `bypassReverbZones`. Ambisonic audio disables reverb zones.

### Audio Random Containers

**Asset** (`Create > Audio > Audio Random Container`) for randomized playlists with rules. Works only with AudioSource; the AudioSource determines 2D/3D positioning. Volume is additive: `AudioSource.volume × container.volume`.

**Properties:**

| Property | Description |
|----------|-------------|
| **Volume** | 0–1; additive with AudioSource volume |
| **Volume Randomization** | Min/max range for randomized volume |
| **Pitch** | Cent scale, logarithmic; additive with AudioSource pitch |
| **Pitch Randomization** | Min/max range for randomized pitch |
| **Audio Clips** | Reorderable list; each toggleable with individual volume override |

**Playback Modes:**

| Mode | Behavior |
|------|----------|
| **Sequential** | List order top-to-bottom; trigger/offset don't apply |
| **Shuffle** | Removes clips from pool after play; no repeats until full cycle |
| **Random** | Pool stays intact; any clip can repeat anytime |

**Trigger Modes:**

| Mode | Behavior |
|------|----------|
| **Manual** | Script must call `AudioSource.Play()` to advance; one clip per call |
| **Automatic — Pulse** | Clips fire at steady intervals (Time + randomize); counted from container start |
| **Automatic — Offset** | Clip triggers when previous finishes; Offset = silence between clips |

**Looping:** Infinite, Clips (count of individual plays), Cycles (count of full list passes). Count Randomization available.

**Avoid Repeating Last:** Minimum number of plays before a clip can repeat (Shuffle/Random modes only).

### Tracker Modules

Pattern-based music formats embedding PCM samples as instruments. Benefits: very small file sizes, consistent playback across hardware.

**Supported:** `.mod` (Protracker/Amiga), `.xm` (FastTracker 2), `.it` (Impulse Tracker), `.s3m` (Scream Tracker)

**Limitations:** Imported as AudioClips and played as pre-rendered audio — no runtime pattern/instrument access. Not suitable for streaming. Editor tools: MilkyTracker (macOS), OpenMPT (Windows).

**Recommendation:** Set Load Type to Compressed In Memory to avoid full decompression.

### Ambisonic Audio

Full-sphere surround sound stored in multi-channel format (channels represent soundfield, not speakers). Used for 360° video, VR, ambient "audio skyboxes."

- Format: **B-format WAV**, **ACN component ordering**, **SN3D normalization**
- **First order (FOA):** 4 channels (supported). Second/third order not supported.
- Import: enable **Ambisonic** checkbox in Inspector
- Playback: assign to AudioSource → **disable Spatialize** (decoder handles it)
- Reverb zones disabled for ambisonic clips
- No built-in decoders; use external VR audio SDKs or build custom via Native Audio Plugin SDK
- Custom decoder: set `UnityAudioEffectDefinitionFlags_IsAmbisonicDecoder` flag; handle `ambisonicOutChannels` in process callback

### Native Audio Plugin SDK

Create custom DSP effects, spatializers, and ambisonic decoders in C/C++ with optional C# GUI.

**Architecture:** Two-part system — native DSP plugin (C/C++ dynamic library) + managed GUI (C# class library).

**Key callbacks:**

| Callback | Purpose |
|----------|---------|
| `CreateCallback` | Allocate effect data on instantiation |
| `ReleaseCallback` | Cleanup before unload |
| `ProcessCallback` | Process audio: `(state, inbuffer, outbuffer, length, inchannels, outchannels)` |
| `GetFloatParameterCallback` | Read parameter for GUI display |
| `GetFloatBufferCallback` | Send spectrum data to GUI for metering |

**Parameter definition:** `RegisterParameter(definition, name, unit, min, max, default, displayScale, displayExponent, enumValue)`

**DLL naming:** Must include `audioplugin` prefix (case-insensitive) — e.g., `audioplugin-myplugin.dll` — to be auto-loaded.

**GUI:** C# class inheriting `IAudioEffectPluginGUI`; `Name` must match plugin name (not DLL name). Parameters read/written via `plugin.GetFloatParameter` / `plugin.SetFloatParameter`.

**DSP clock synchronization:** Use `state->dsptick` (global sample counter) for tempo-synced effects.

**SDK examples:** NoiseBox (noise modulation), Ring Modulator, StereoWidener, Lofinator (downsampling), Equalizer (custom GUI), Multiband (compressor with spectrum), CorrelationMeter, Loudness Monitor.

**Resources:** https://github.com/Unity-Technologies/NativeAudioPlugins

### Scriptable Audio Pipeline

Extends Unity's audio engine at specific integration points using **Burst-compatible HPC#** (high-performance C#). Not supported on Web Platform.

**Two processor types:**

| Type | Integration Point | Use Cases |
|------|-------------------|-----------|
| **Generator** | Audio Sources | Custom sound generators emitting via AudioSource |
| **Root Output** | Audio engine main output | Middleware integration (FMOD, Wwise), custom audio systems, direct-to-output generators |

**Architecture — Control/Real-Time Split:**

| Part | Interface | Thread | Responsibilities |
|------|-----------|--------|-----------------|
| **Control** | `GeneratorInstance.IControl<T>` / `RootOutputInstance.IControl<T>` | Main thread | Create, configure, manage lifecycle; send pipe data; handle messages |
| **Real-Time** | `GeneratorInstance.IRealtime` / `RootOutputInstance.IRealtime` | Audio thread / Job System | Generate/process samples; must be allocation-free, exception-free |

**Communication:**
- **Pipes:** Bidirectional, real-time safe (no locks, no allocations). Control→RT data in same mix cycle; RT→Control visible in same frame. Data available for one mix cycle only.
- **Messages:** One-way (instance→control), blocking, passed by reference. Use for parameter updates, events, data conversion.

**Update hooks** (throttleable via `CreationParameters`):
- **Control Update:** Once per rendered frame
- **Real-Time Update:** Once per mix cycle
- Flags: `Default`, `NeverUpdate`, `UpdateIfDataIsAvailable`, `UpdateAlways`

**Generator workflows:**
1. **Asset-based:** `ScriptableObject` implementing `IAudioGenerator` — drag to AudioSource Generator field
2. **Component-based:** `MonoBehaviour` implementing `IAudioGenerator` — add to GameObject, assign to AudioSource Generator field

**`IAudioGenerator` capabilities:** `isFinite` (will terminate), `isRealtime` (must render at system buffer rate), `length` (known duration). Must match `IRealtime` capabilities or warnings appear.

**Nested generators:** Can form hierarchical trees — root invokes Configure/Update/Process on children for mixers, blend containers, randomized sequencers.

**Root Output stages** (sequential, same thread):

| Stage | Purpose |
|-------|---------|
| **EarlyProcessing** | Work that must complete before later stages (e.g., hardware input sampling). Returns optional JobHandle |
| **Process** | Main work; runs in parallel with other root outputs. Receives combined dependency |
| **EndProcessing** | Mix results into main audio output |

**Real-time constraints** (all stages): No allocations, no system calls, no locks/blocking.

**Key APIs:** `ControlContext.builtIn` (Unity's audio system), `ControlContext.Manual` (offline rendering), `Pipe`, `Message`, `ChannelBuffer` (channels×frames 2D view), `AudioFormat` (sample rate, speaker mode, buffer size).

### Audio Profiler

**Access:** Window > Analysis > Profiler → Audio module.

**Charts:**

| Chart | What It Shows |
|-------|---------------|
| **Playing Audio Sources** | Active source count per frame |
| **Audio Voices** | FMOD channel count |
| **Total Audio CPU** | Overall audio processing cost |
| **Total Audio Memory** | RAM used by audio engine |

**Simple View Fields:**

| Metric | Description |
|--------|-------------|
| Total/Playing/Paused Audio Sources | Source counts |
| Audio Clip Count | Total clips in scene |
| Audio Voices | FMOD channels |
| DSP CPU | Mixing + effects + decompression of Compressed In Memory sounds |
| Streaming CPU | Streaming pipeline load |
| Total Audio Memory | Overall memory |
| Streaming File Memory | Compressed data buffered from disk |
| Streaming Decode Memory | Buffered decoded stream |
| Sample Sound Memory | Decompressed audio (grows until saturation; internally reused) |
| Other Memory | Subsystem overhead |

**Detailed View:** Per-frame logging with Channels, Groups, or Channels+Groups sub-views. Columns: Object, Asset, Volume, Audibility, Plays, 3D, Paused, Muted, Virtual (exceeded Max Real Voices), OneShot, Looped, Distance, MinDist, MaxDist, Time, Duration.

**ProfilerRecorder API** (`Unity.Profiling` namespace):

```csharp
ProfilerRecorder recorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Audio Used Memory");
// Read: recorder.LastValue, recorder.CurrentValue, recorder.Valid
recorder.Dispose(); // MANDATORY — unmanaged resources
```

**Audio-specific ProfilerRecorder counters:**

| Counter | Category | Release Available |
|---------|----------|-------------------|
| Audio Reserved Memory | Memory | Yes |
| Audio Used Memory | Memory | Yes |
| AudioClip Count | Memory | No (dev build only) |
| AudioClip Memory | Memory | No (dev build only) |
| Audio Reads | Asset Loading | No (dev build only) |

## Code Patterns

### Play Audio at World Position (2D/3D)

```csharp
AudioSource.PlayClipAtPoint(explosionClip, transform.position, 1.0f);
// Creates temp GameObject; auto-cleans after playback
```

### Play One-Shot Sound on Existing Source

```csharp
AudioSource source = GetComponent<AudioSource>();
source.PlayOneShot(footstepClip, 0.8f); // volume scale
// One-shots don't interrupt current clip; multiple can overlap
```

### Scheduled Precise Playback

```csharp
AudioSource source = GetComponent<AudioSource>();
double startTime = AudioSettings.dspTime + 1.0; // 1 second from now
source.PlayScheduled(startTime);
```

### 3D Spatial Setup via Script

```csharp
AudioSource source = GetComponent<AudioSource>();
source.spatialBlend = 1.0f;
source.minDistance = 2.0f;
source.maxDistance = 50.0f;
source.rolloffMode = AudioRolloffMode.Logarithmic;
source.dopplerLevel = 0.5f;
```

### Audio Mixer Volume Control (Exposed Parameter)

```csharp
using UnityEngine.Audio;

public class VolumeControl : MonoBehaviour
{
    [SerializeField] AudioMixer mixer;
    const string paramName = "MasterVolume";
    const float minDb = -80f;
    const float maxDb = 20f;

    public void SetVolume(float linearValue) // 0–1
    {
        float db = Mathf.Lerp(minDb, maxDb, linearValue);
        mixer.SetFloat(paramName, db);
    }

    public float GetVolume()
    {
        mixer.GetFloat(paramName, out float db);
        return Mathf.InverseLerp(minDb, maxDb, db);
    }
}
```

### Snapshot Transitions

```csharp
using UnityEngine.Audio;

public class AudioMoodController : MonoBehaviour
{
    [SerializeField] AudioMixer mixer;
    [SerializeField] AudioMixerSnapshot normalSnapshot;
    [SerializeField] AudioMixerSnapshot combatSnapshot;
    [SerializeField] AudioMixerSnapshot pauseSnapshot;

    public void EnterCombat() =>
        mixer.TransitionToSnapshots(
            new[] { combatSnapshot, normalSnapshot },
            new[] { 1.0f, 0.0f },
            0.5f);

    public void ReturnToNormal() =>
        mixer.TransitionToSnapshots(
            new[] { normalSnapshot, combatSnapshot },
            new[] { 1.0f, 0.0f },
            1.0f);

    public void PauseGame()
    {
        mixer.updateMode = AudioMixerUpdateMode.Unscaled;
        mixer.TransitionToSnapshots(
            new[] { pauseSnapshot },
            new[] { 1.0f },
            0.3f);
    }
}
```

### Audio Random Container — Manual Trigger

```csharp
[RequireComponent(typeof(AudioSource))]
public class FootstepController : MonoBehaviour
{
    AudioSource source;

    void Start() => source = GetComponent<AudioSource>();
    // source.audioResource = AudioRandomContainer asset (set in Inspector)

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.W))
            source.Play(); // Plays one clip per call (Manual trigger mode)
    }
}
```

### Procedural AudioClip Generation

```csharp
int sampleRate = 44100;
float duration = 1.0f;
int sampleCount = (int)(sampleRate * duration);
AudioClip clip = AudioClip.Create("MySine", sampleCount, 1, sampleRate, false);

float[] samples = new float[sampleCount];
for (int i = 0; i < sampleCount; i++)
    samples[i] = Mathf.Sin(2f * Mathf.PI * 440f * i / sampleRate);
clip.SetData(samples, 0);
```

### Pause AudioSystem / Ignore Pause for Specific Source

```csharp
// Pause all audio
AudioListener.pause = true;

// Allow background music to keep playing
musicSource.ignoreListenerPause = true;
```

### Scriptable Audio Pipeline — Sine Wave Generator (Complete)

```csharp
using Unity.Burst;
using Unity.IntegerTime;
using UnityEngine;
using UnityEngine.Audio;
using static UnityEngine.Audio.ProcessorInstance;

[BurstCompile(CompileSynchronously = true)]
struct Realtime : GeneratorInstance.IRealtime
{
    const float k_TwoPi = 2f * Mathf.PI;
    float phase;
    internal float frequency;
    internal float sampleRate;

    public bool isFinite => false;
    public bool isRealtime => false;
    public DiscreteTime? length => null;

    public void Update(UpdatedDataContext context, Pipe pipe)
    {
        foreach (var element in pipe.GetAvailableData(context))
            if (element.TryGetData(out FrequencyEvent evt))
                frequency = evt.value;
    }

    public GeneratorInstance.Result Process(
        in RealtimeContext context, Pipe pipe,
        ChannelBuffer buffer, GeneratorInstance.Arguments args)
    {
        float inc = frequency / sampleRate;
        for (int f = 0; f < buffer.frameCount; f++)
        {
            float s = Mathf.Sin(phase * k_TwoPi);
            for (int ch = 0; ch < buffer.channelCount; ch++)
                buffer[ch, f] = s;
            phase += inc;
            if (phase >= 1f) phase -= 1f;
        }
        return buffer.frameCount;
    }
}

readonly struct FrequencyEvent { public readonly float value; public FrequencyEvent(float v) => value = v; }

struct Control : GeneratorInstance.IControl<Realtime>
{
    public void Dispose(ControlContext context, ref Realtime rt) { }
    public void Update(ControlContext context, Pipe pipe) { }
    public Response OnMessage(ControlContext context, Pipe pipe, Message msg)
    {
        if (msg.Is<FrequencyEvent>())
        {
            pipe.SendData(context, msg.Get<FrequencyEvent>());
            return Response.Handled;
        }
        return Response.Unhandled;
    }
    public void Configure(ControlContext context, ref Realtime rt,
        in AudioFormat format, out GeneratorInstance.Setup setup,
        ref GeneratorInstance.Properties properties)
    {
        rt.sampleRate = format.sampleRate;
        setup = new GeneratorInstance.Setup(AudioSpeakerMode.Mono, format.sampleRate);
    }
}

public class SineGenerator : MonoBehaviour, IAudioGenerator
{
    AudioSource source;
    [Range(100f, 10000f)] public float frequency = 440f;
    float prevFrequency;

    public bool isFinite => false;
    public bool isRealtime => false;
    public DiscreteTime? length => null;

    public GeneratorInstance CreateInstance(ControlContext context,
        AudioFormat? nestedConfig, CreationParameters creationParams)
        => context.AllocateGenerator(new Realtime(), new Control(), nestedConfig, creationParams);

    void Awake() => source = GetComponent<AudioSource>();
    void Update()
    {
        if (Mathf.Approximately(frequency, prevFrequency)) return;
        var instance = source.generatorInstance;
        if (!ControlContext.builtIn.Exists(instance)) return;
        var msg = new FrequencyEvent(frequency);
        ControlContext.builtIn.SendMessage(instance, ref msg);
        prevFrequency = frequency;
    }
}
```

### Audio Profiler Memory Tracking

```csharp
using Unity.Profiling;
using UnityEngine;

public class AudioMemoryHUD : MonoBehaviour
{
    ProfilerRecorder usedMem;
    ProfilerRecorder reservedMem;

    void OnEnable()
    {
        usedMem = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Audio Used Memory");
        reservedMem = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Audio Reserved Memory");
    }

    void OnDisable()
    {
        usedMem.Dispose();
        reservedMem.Dispose();
    }

    void OnGUI()
    {
        if (usedMem.Valid)
            GUILayout.Label($"Audio Used: {usedMem.LastValue / 1024f / 1024f:F1} MB");
        if (reservedMem.Valid)
            GUILayout.Label($"Audio Reserved: {reservedMem.LastValue / 1024f / 1024f:F1} MB");
    }
}
```

## Key Classes and Components Reference

| Class/Component | Namespace | Purpose |
|-----------------|-----------|---------|
| `AudioSource` | `UnityEngine` | Emits sound from a GameObject; controls 2D/3D, volume, pitch, routing |
| `AudioClip` | `UnityEngine` | Container for audio data; inherits `Audio.AudioResource`, implements `IAudioGenerator` |
| `AudioListener` | `UnityEngine` | One per scene; receives all sounds and outputs to speakers |
| `AudioMixer` | `UnityEngine.Audio` | Mixes, routes, and applies DSP effects to audio groups |
| `AudioMixerGroup` | `UnityEngine.Audio` | A bus/group within an Audio Mixer asset |
| `AudioMixerSnapshot` | `UnityEngine.Audio` | Captures all parameter states; used for mood transitions |
| `AudioReverbZone` | `UnityEngine` | Area-based reverb; transition zones via Min/Max Distance |
| `AudioLowPassFilter` | `UnityEngine` | Component; passes low frequencies, cuts high |
| `AudioHighPassFilter` | `UnityEngine` | Component; passes high frequencies, cuts low |
| `AudioEchoFilter` | `UnityEngine` | Component; echo/delay effect |
| `AudioChorusFilter` | `UnityEngine` | Component; chorus modulation |
| `AudioDistortionFilter` | `UnityEngine` | Component; distortion effect |
| `AudioReverbFilter` | `UnityEngine` | Component; standalone reverb (not zone-based) |
| `AudioSettings` | `UnityEngine` | Static class; `dspTime`, `outputSampleRate`, `speakerMode` |
| `Microphone` | `UnityEngine` | Record from device microphone |
| `AudioDataLoadState` | `UnityEngine` | Enum: `Unloaded`, `Loading`, `Loaded`, `Failed` |
| `AudioClipLoadType` | `UnityEngine` | Enum: `DecompressOnLoad`, `CompressedInMemory`, `Streaming` |
| `AudioRolloffMode` | `UnityEngine` | Enum: `Logarithmic`, `Linear`, `Custom` |
| `AudioSpeakerMode` | `UnityEngine` | Enum: `Mono`(1), `Stereo`(2), `Quad`(4), `Surround`(5), `Mode5point1`(6), `Mode7point1`(8) |
| `AudioMixerUpdateMode` | `UnityEngine.Audio` | Enum: `Normal`, `Unscaled` |
| `AudioSourceCurveType` | `UnityEngine` | Enum for distance curves: `Volume`, `SpatialBlend`, `Spread`, `LowPass`, `ReverbZoneMix` |
| `FFTWindow` | `UnityEngine` | Windowing for `GetSpectrumData`: `Rectangular`, `Triangle`, `Hamming`, `Hanning`, `Blackman`, `BlackmanHarris` |
| `ProfilerRecorder` | `Unity.Profiling` | Runtime Profiler metric recording |
| `ProfilerCategory` | `Unity.Profiling` | Category constants: `Memory`, `Render`, `Audio`, etc. |
| `IAudioGenerator` | `UnityEngine` | Factory interface for Scriptable Audio Pipeline generators |
| `GeneratorInstance` | `UnityEngine.Audio` | Nested types: `IRealtime`, `IControl<T>`, `Setup`, `Properties`, `Result` |
| `RootOutputInstance` | `UnityEngine.Audio` | Nested types: `IRealtime` (3-stage), `IControl<T>` |
| `ControlContext` | `UnityEngine.Audio` | `builtIn` and `Manual` control contexts |
| `ChannelBuffer` | `UnityEngine.Audio` | 2D sample buffer (channels × frames) |
| `AudioFormat` | `UnityEngine.Audio` | Sample rate, speaker mode, buffer size descriptor |
| `Pipe` | `UnityEngine.Audio` | Real-time safe bidirectional communication channel |

## Best Practices

- **Attach AudioListener to Main Camera** or player controller — only one active per scene.
- **Use Streaming load type for background music** and any clips longer than ~30 seconds to minimize memory.
- **Use Decompress On Load for small, frequently-played SFX** (footsteps, UI clicks) — zero CPU at play time.
- **Use ADPCM compression for noisy, bulk-played sounds** (impacts, weapons, footsteps) — low CPU, 3.5:1 compression.
- **Use Compressed In Memory for tracker modules** (.mod, .xm, .it, .s3m) to avoid full decompression.
- **Set Max Real Voices appropriately** in Audio Manager — too high wastes CPU; too low causes audible culling. Monitor in Profiler Audio module.
- **Route audio through Audio Mixer groups** for organized volume control (Master → Music/SFX/Dialogue/Ambience) rather than per-source volume manipulation.
- **Expose mixer parameters** (MasterVolume, SFXVolume, MusicVolume) for player settings — NOT per-source volume.
- **Call `SetFloat()` in `Start()` or later** — never in `Awake()`, `OnEnable()`, or `AfterSceneLoad` due to timing issues.
- **Use snapshot transitions** for game state audio changes (combat, pause, menu) — smoother and more maintainable than manual per-parameter changes.
- **Reduce background music via Duck Volume** (side-chain) during dialogue instead of hard muting — set appropriate Attack/Release for natural feel.
- **Disable Read/Write on audio clips** unless you call `GetData()`/`SetData()` at runtime — saves memory.
- **Use Audio Random Containers** for varied SFX (footsteps, impacts) instead of manual clip arrays — built-in shuffle, avoid-repeat, and volume/pitch randomization.
- **Profile early and often** — monitor Audio Voices, DSP CPU, and Audio Memory in the Profiler. Virtual voices indicate Max Real Voice pressure.
- **Enable Load In Background** for large clips to avoid main thread stalls during scene loading.
- **Keep native audio plugin ProcessCallback allocation-free and lock-free** — use pre-allocated buffers, avoid system calls, keep loops tight.
- **Use Burst-compiled structs** in Scriptable Audio Pipeline processors — annotate with `[BurstCompile(CompileSynchronously = true)]`, use `Unity.Mathematics`, avoid managed types on the audio thread.

## Additional Resources

- [Unity Audio Overview](https://docs.unity3d.com/Manual/AudioOverview.html)
- [AudioSource Manual](https://docs.unity3d.com/Manual/class-AudioSource.html)
- [AudioClip Manual](https://docs.unity3d.com/Manual/class-AudioClip.html)
- [Audio Mixer Manual](https://docs.unity3d.com/Manual/AudioMixer.html)
- [Audio Mixer Scripting API](https://docs.unity3d.com/ScriptReference/Audio.AudioMixer.html)
- [Audio Random Container Reference](https://docs.unity3d.com/Manual/AudioRandomContainer.html)
- [Ambisonic Audio](https://docs.unity3d.com/Manual/AmbisonicAudio.html)
- [Native Audio Plugin SDK](https://docs.unity3d.com/Manual/AudioMixerNativeAudioPlugin.html)
- [Native Audio Plugins GitHub](https://github.com/Unity-Technologies/NativeAudioPlugins)
- [Audio Spatializer SDK](https://docs.unity3d.com/Manual/AudioSpatializerSDK.html)
- [Scriptable Audio Pipeline](https://docs.unity3d.com/Manual/audio-scriptable-processors.html)
- [Audio Profiler Module](https://docs.unity3d.com/Manual/ProfilerAudio.html)
- [Profiler Counters Reference](https://docs.unity3d.com/Manual/profiler-counters-reference.html)
- [Audio Demos](https://github.com/Unity-Technologies/AudioDemos)
