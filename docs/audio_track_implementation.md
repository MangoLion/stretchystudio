# Audio Track Implementation

## Overview

Audio tracks allow users to add background music or sound effects to animations in Stretchy Studio. Audio can be trimmed, positioned on the timeline, and synced precisely with animation playback.

## Features

- ✅ Add multiple audio tracks per animation
- ✅ Upload audio files (MP3, WAV, etc.)
- ✅ Trim audio from start/end via drag handles
- ✅ Move audio clips along the timeline
- ✅ Precise playback sync with animation
- ✅ Audio modal for detailed parameter editing
- ✅ Automatic clipping to timeline duration
- ✅ Loop support (audio restarts on animation loop)
- ✅ Persist audio in `.stretch` project files

## Architecture

### Data Model

Audio tracks are stored in the animation object (`projectStore`):

```javascript
animation {
  id: string,
  name: string,
  tracks: [...keyframe tracks],
  audioTracks: [              // NEW
    {
      id: string,
      name: string,
      sourceUrl: string | null,       // blob URL to audio file
      mimeType: string,               // e.g. 'audio/mp3'
      audioDurationMs: number,        // total length of source file
      audioStartMs: number,           // trim: skip from start (ms)
      audioEndMs: number,             // trim: end point in audio file (ms)
      timelineStartMs: number,        // where on timeline this clip begins (ms)
    }
  ]
}
```

### Key Components

#### `useAudioSync(animation, animStore)` — Web Audio API Playback Hook

Located in `TimelinePanel.jsx` lines ~114–210.

**Design Principles:**
- Effect does NOT watch `currentTime` (fires every rAF frame) → avoids OOM from repeated fetch/decode
- Instead, uses refs (`animationRef`, `currentTimeRef`) to always read fresh values without re-triggering
- Only watches `isPlaying`, `activeAnimationId`, and `loopCount` (stable, discrete changes)

**Workflow:**
1. **Decode effect** — watches `trackSourceKey` (string of `id:sourceUrl` pairs)
   - Fetches audio file once per track
   - Decodes to AudioBuffer via Web Audio API
   - Caches in `buffersRef` Map

2. **Play/stop effect** — watches `isPlaying` + `activeAnimationId` + `loopCount`
   - When `isPlaying` turns true: starts AudioBufferSourceNodes from current playhead position
   - When `isPlaying` turns false: stops all sources
   - Reads `currentTime` via ref at the moment play starts (not reactive)
   - Uses Web Audio API's `source.start(when, offset, duration)` scheduling for precise timing
   - Handles clips that start in the future with `delaySec` parameter

**Offset Calculation:**
```javascript
const offsetInAudioMs = Math.max(0, audioStartMs + Math.max(0, nowMs - timelineStartMs));
```
- `audioStartMs`: trim point in audio file
- `nowMs - timelineStartMs`: how far into the clip the playhead is
- Result: exact position in audio file to start playback

**Loop Handling:**
- `animationStore.loopCount` increments on every loop (in `tick()` function)
- Increment detected by effect → triggers `startAll()` again
- Audio sources naturally end after their `duration`, so no cleanup needed

#### `AudioTrackRow` — Timeline UI for One Track

Located in `TimelinePanel.jsx` lines ~264–560.

**Elements:**
- **Label column**: track name + ⚙️ settings button + ✕ delete button
- **Track area** (right of label):
  - If no audio: "Upload audio" button with hidden file input
  - If audio: colored bar showing clip boundaries with drag handles

**Drag Handlers:**
- **Left handle**: trim from start of audio
  - Both `audioStartMs` and `timelineStartMs` move together (right edge stays fixed)
  - Clamped: `audioStartMs ≥ 0`, `timelineStartMs ≥ 0`
- **Right handle**: trim from end of audio
  - Only `audioEndMs` changes
  - Clamped: `audioStartMs + 100 ≤ audioEndMs ≤ audioDurationMs`
- **Body**: move entire clip along timeline
  - Only `timelineStartMs` changes
  - Uses `xToFrame()` + `frameToMs()` for correct pixel→ms conversion

**Audio Upload:**
- User clicks button → file input opens
- On select: decode audio via AudioContext to get duration
- Auto-clips `audioEndMs` to timeline duration if longer
- Sets `sourceUrl` (blob URL) and `audioDurationMs`

#### `AudioTrackModal` — Parameter Editor

Located in `TimelinePanel.jsx` lines ~224–263.

Uses shadcn's `Dialog` component for polished UI.

**Parameters:**
- **Timeline Start** (ms): Where on the animation timeline the audio begins
- **Audio Start Trim** (ms): Skip this many ms from the start of the audio file
- **Play Duration** (ms): How long to play after trimming

Includes sliders + number inputs for precision, and live info display.

### Serialization

#### Save (`projectFile.js`)

1. Create `audios/` folder in ZIP (parallel to `textures/`)
2. For each audio track with `sourceUrl`:
   - Fetch blob from URL
   - Extract extension from `mimeType` (e.g. `'audio/mp3'` → `'mp3'`)
   - Store as `audios/{trackId}.{ext}`
   - Replace `sourceUrl` with path in serialized JSON

#### Load (`projectFile.js`)

1. After loading project JSON
2. For each animation's audio tracks with a `source` path:
   - Extract blob from ZIP
   - Create blob URL via `URL.createObjectURL()`
   - Restore as `sourceUrl`
   - Delete the `source` field

## Implementation Details

### Animation Store Changes

**New field:**
```javascript
loopCount: 0,  // increments in tick() on each loop
```

**Modified `tick()` function:**
```javascript
if (newTime >= endMs) {
  if (s.loop) {
    newTime = startMs + ((newTime - startMs) % rangeMs);
    loopCount += 1;  // signal audio hook to restart
  }
}
set({ ..., loopCount });
```

**Reset on seek/stop:**
```javascript
seekFrame: () => set({ ..., loopCount: 0 }),
stop: () => set({ ..., loopCount: 0 }),
```

### Drag Delta Calculation

Uses `xToFrame()` (existing timeline function) to convert pixel positions to frames:
```javascript
const startFrame = xToFrame(e.clientX);        // Frame at drag start
const currentFrame = xToFrame(ev.clientX);     // Frame at current mouse
const frameDelta = currentFrame - startFrame;  // Frames moved
const deltaMs = frameToMs(frameDelta, fps);    // Convert to milliseconds
```

This ensures micro-drags produce micro-adjustments (not exaggerated movement).

### Preventing Playhead Interference

All audio track drag handlers call `e.stopPropagation()` to prevent the track area's `onPointerDown` handler from seeking the playhead.

## Known Limitations

1. **No waveform display** — colored bar only; no visual representation of audio content
2. **Seek-while-playing not perfect** — audio doesn't automatically restart if timeline is dragged while playing
3. **No audio level/volume controls** — always plays at full volume via `AudioContext.destination`
4. **Single output destination** — all audio mixed to mono output (no panning/effects)
5. **No audio preview** — can't preview audio before entering play mode

## Future Improvements

- [ ] Waveform visualization in the audio bar
- [ ] Volume slider per track
- [ ] Pan controls (left/right stereo)
- [ ] Audio effects (fade in/out)
- [ ] Seek-while-playing sync
- [ ] Multiple output buses (post-processing)
- [ ] Audio scrubbing (hear audio while dragging playhead)
- [ ] Compressor/normalizer for consistent loudness

## Testing Checklist

- [ ] Upload audio file, verify it appears in track
- [ ] Drag left/right handles, verify clip trims correctly
- [ ] Drag audio bar body, verify it moves without drifting
- [ ] Open settings modal, adjust parameters with sliders and number inputs
- [ ] Play animation, verify audio plays in sync
- [ ] Pause during playback, audio stops immediately
- [ ] Seek to different frame, audio syncs correctly
- [ ] Animation loops, audio restarts from beginning
- [ ] Save project, reload, audio persists
- [ ] Audio longer than timeline, verify auto-clipped on upload
- [ ] Multiple audio tracks play simultaneously
- [ ] Delete audio track, verify removed from timeline

## File References

- **Core implementation**: `src/components/timeline/TimelinePanel.jsx` (lines 1–1800)
- **Playback hook**: `src/components/timeline/TimelinePanel.jsx:useAudioSync` (lines ~114–210)
- **Audio track row**: `src/components/timeline/TimelinePanel.jsx:AudioTrackRow` (lines ~264–560)
- **Audio settings modal**: `src/components/timeline/TimelinePanel.jsx:AudioTrackModal` (lines ~224–263)
- **Store changes**: `src/store/animationStore.js` and `src/store/projectStore.js`
- **Serialization**: `src/io/projectFile.js` (saveProject, loadProject)
