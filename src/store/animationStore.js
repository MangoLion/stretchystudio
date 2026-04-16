import { create } from 'zustand';

/**
 * AnimationStore — playback state, separate from projectStore.
 * The animation DATA (tracks, keyframes) lives in project.animations.
 * This store holds the runtime playback state and pose overrides.
 */
export const useAnimationStore = create((set, get) => ({
  /** ID of the currently active animation clip */
  activeAnimationId: null,

  /** Playhead position in milliseconds */
  currentTime: 0,

  /** Whether playback is running */
  isPlaying: false,

  /** Loop playback between startFrame and endFrame */
  loop: true,

  /** Loop keyframes: interpolate from last keyframe to first keyframe up to endFrame */
  loopKeyframes: true,

  /** FPS for this clip (also stored on animation object, but mirrored here for transport controls) */
  fps: 24,

  /** Loop window, in frames */
  startFrame: 0,
  endFrame: 48,

  /** Playback speed multiplier (0 = paused, 1 = normal, 2 = double, etc.) */
  speed: 1.0,

  /** Internal: last rAF timestamp for delta computation */
  _lastTimestamp: null,

  /** Increments each time the animation loops — lets audio hook detect loop events */
  loopCount: 0,

  /**
   * Rest pose — snapshot of every node's transform + opacity captured when
   * entering animation mode.  Used to auto-insert a "base" keyframe at
   * startFrame when a node is first keyframed at a later time, so that
   * interpolation from frame 0 stays correct.
   *
   * Map<nodeId, { x, y, rotation, scaleX, scaleY, pivotX, pivotY, opacity }>
   */
  restPose: new Map(),

  /**
   * Draft pose — uncommitted user edits made while in animation mode.
   * These sit on TOP of keyframe values so the user can freely stage a new
   * pose before pressing K to commit it.  Cleared when seeking or stopping.
   *
   * Map<nodeId, { x?, y?, rotation?, scaleX?, scaleY?, opacity? }>
   */
  draftPose: new Map(),

  // ── Setters ──────────────────────────────────────────────────────────────

  setActiveAnimationId: (id) => set({ activeAnimationId: id }),

  /**
   * Snapshot every node's transform + opacity.  Call this when entering
   * animation mode so we have a "base pose" to auto-insert at frame 0.
   */
  captureRestPose: (nodes) => {
    const rp = new Map();
    for (const n of nodes) {
      const t = n.transform ?? {};
      rp.set(n.id, {
        x:        t.x        ?? 0,
        y:        t.y        ?? 0,
        rotation: t.rotation ?? 0,
        scaleX:   t.scaleX   ?? 1,
        scaleY:   t.scaleY   ?? 1,
        opacity:  n.opacity  ?? 1,
      });
    }
    set({ restPose: rp });
  },
  setFps:        (fps)   => set({ fps: Math.max(1, Math.round(fps)) }),
  setSpeed:      (speed) => set({ speed: Math.max(0, Math.min(4, speed)) }),
  setLoop:       (loop)  => set({ loop }),
  setLoopKeyframes: (loop) => set({ loopKeyframes: loop }),

  setStartFrame: (f) => set((s) => ({
    startFrame: Math.max(0, Math.round(f)),
    // Clamp current time if needed
    currentTime: Math.max((Math.max(0, Math.round(f)) / s.fps) * 1000, s.currentTime),
  })),

  setEndFrame: (f) => set((s) => ({
    endFrame: Math.max(s.startFrame + 1, Math.round(f)),
  })),

  // ── Draft pose actions ────────────────────────────────────────────────────

  /** Merge props into the draft override for one node. */
  setDraftPose: (nodeId, props) => set((s) => {
    const next = new Map(s.draftPose);
    next.set(nodeId, { ...(next.get(nodeId) ?? {}), ...props });
    return { draftPose: next };
  }),

  /** Remove one node's draft (called after K commits it). */
  clearDraftPoseForNode: (nodeId) => set((s) => {
    const next = new Map(s.draftPose);
    next.delete(nodeId);
    return { draftPose: next };
  }),

  /** Clear all drafts (called on seek / stop). */
  clearDraftPose: () => set({ draftPose: new Map() }),

  // ── Transport ─────────────────────────────────────────────────────────────

  play: () => set({ isPlaying: true, _lastTimestamp: null }),
  pause: () => set({ isPlaying: false, _lastTimestamp: null }),

  stop: () => set((s) => ({
    isPlaying: false,
    currentTime: (s.startFrame / s.fps) * 1000,
    _lastTimestamp: null,
    draftPose: new Map(),
    loopCount: 0,
  })),

  seekFrame: (frame) => set((s) => ({
    currentTime: (frame / s.fps) * 1000,
    _lastTimestamp: null,
    draftPose: new Map(),
    loopCount: 0,
  })),

  seekTime: (ms) => set({ currentTime: ms, _lastTimestamp: null, draftPose: new Map(), loopCount: 0 }),

  // ── rAF tick ──────────────────────────────────────────────────────────────
  /**
   * Called from CanvasViewport's rAF loop with the current timestamp (ms).
   * Advances currentTime if playing. Returns true if time advanced (scene needs redraw).
   */
  tick: (timestamp) => {
    const s = get();
    if (!s.isPlaying) return false;

    if (s._lastTimestamp === null) {
      set({ _lastTimestamp: timestamp });
      return false;
    }

    const deltaMs   = (timestamp - s._lastTimestamp) * s.speed;
    const startMs   = (s.startFrame / s.fps) * 1000;
    const endMs     = (s.endFrame   / s.fps) * 1000;
    const rangeMs   = endMs - startMs;

    if (rangeMs <= 0 || deltaMs <= 0) {
      set({ _lastTimestamp: timestamp });
      return false;
    }

    let newTime = s.currentTime + deltaMs;
    let loopCount = s.loopCount;

    if (newTime >= endMs) {
      if (s.loop) {
        newTime = startMs + ((newTime - startMs) % rangeMs);
        loopCount += 1;
      } else {
        set({ isPlaying: false, currentTime: endMs, _lastTimestamp: null });
        return true;
      }
    }

    set({ currentTime: newTime, _lastTimestamp: timestamp, loopCount });
    return true;
  },

  /**
   * Switch to a new animation clip and reset playback state.
   */
  switchAnimation: (anim) => {
    if (!anim) return;
    set({
      activeAnimationId: anim.id,
      fps:               anim.fps ?? 24,
      currentTime:       0,
      isPlaying:         false,
      _lastTimestamp:    null,
      draftPose:         new Map(),
      loopCount:         0,
      // start/end frames derived from duration if not present
      startFrame:        0,
      endFrame:          Math.round(((anim.duration ?? 2000) / 1000) * (anim.fps ?? 24)),
    });
  },

  /** Reset playback state to default */
  resetPlayback: () => set({
    activeAnimationId: null,
    currentTime:       0,
    isPlaying:         false,
    _lastTimestamp:    null,
    restPose:          new Map(),
    draftPose:         new Map(),
    startFrame:        0,
    endFrame:          48,
    fps:               24,
    loopKeyframes:     true,
    loopCount:         0,
  }),
}));
