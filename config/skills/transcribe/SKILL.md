---
name: transcribe
description: Transcribe audio files to text using local whisper-cpp with GPU acceleration
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [audio, transcription, whisper, utility]
    category: productivity
---

# Audio Transcription

Use local whisper-cpp with GPU (Vulkan, NVIDIA RTX 3050) to transcribe audio files. Supports Indonesian and many other languages.

## When to Use
- User sends an audio file and asks you to transcribe or summarize it
- User wants a text version of a voice note, meeting recording, or podcast
- Use specifically with the yola profile for voice-to-text tasks

## Procedure

1. Save the audio file to a temporary location:
```bash
cp <audio-file> /tmp/transcribe_input.<ext>
```

2. Transcribe with whisper-cpp:
```bash
transcribe /tmp/transcribe_input.<ext>
```
For non-English audio (e.g., Indonesian), use the large-v3 model (default):
```bash
transcribe /tmp/transcribe_input.mp3 large-v3
```

3. Read the resulting text file, then clean up:
```bash
cat /tmp/transcribe_input_transcribe/transcribe_input.txt
rm -rf /tmp/transcribe_input.* /tmp/transcribe_input_transcribe/
```

## Summarization

After transcribing, summarize the content:
- Extract key points and action items
- Keep the summary concise (3-5 bullet points for short audio, paragraph for longer)
- Note timestamps if available (VTT/SRT files generated alongside text)
- For Indonesian audio: transcribe and summarize *in Indonesian*, then offer an English translation if requested

## Supported Formats
mp3, wav, flac, ogg, m4a, opus

## Models
- `large-v3` — 3GB, best accuracy for all languages (default, fits 6GB VRAM)
- `medium` — 1.5GB, good balance
- `small` — 500MB, fast, decent accuracy

## Pitfalls
- Audio longer than 30 minutes may need segmentation; use the built-in VAD
- Very noisy audio may produce poor results — warn the user if quality is low
- GPU must be available; if Vulkan fails, whisper falls back to CPU (slower)
