import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useAnimationStore } from '@/store/animationStore';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { HelpIcon } from '@/components/ui/help-icon';
import { Disc } from 'lucide-react';

/* ──────────────────────────────────────────────────────────────────────────
   Constants
────────────────────────────────────────────────────────────────────────── */

const LABEL_W = 140;  // px — fixed node-name column width
const ROW_H = 22;   // px — height of each track row
const RULER_H = 20;   // px — height of the time ruler
const TRACK_PAD = 16;   // px — padding inside track area so edge frames don't clip

/* ──────────────────────────────────────────────────────────────────────────
   Small helpers
────────────────────────────────────────────────────────────────────────── */

function uid() { return Math.random().toString(36).slice(2, 9); }

/** Clamp a number to [min, max] */
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/** Frame number from time (ms) */
function msToFrame(ms, fps) { return Math.round((ms / 1000) * Math.max(1, fps)); }

/** Time (ms) from frame number */
function frameToMs(frame, fps) { return (frame / Math.max(1, fps)) * 1000; }

/* ──────────────────────────────────────────────────────────────────────────
   Transport button (play/pause/stop/loop icons)
────────────────────────────────────────────────────────────────────────── */
function TransportBtn({ onClick, active, title, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex items-center justify-center w-6 h-6 rounded text-xs transition-colors',
        active
          ? (className.includes('bg-') ? '' : 'bg-primary text-primary-foreground')
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Tiny numeric field (for frame/fps/speed inputs)
────────────────────────────────────────────────────────────────────────── */
function NumField({ label, value, onChange, min, max, step = 1, className = '', tip }) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => { setLocal(String(value)); }, [value]);

  const commit = () => {
    const n = parseFloat(local);
    if (!isNaN(n)) onChange(clamp(n, min ?? -Infinity, max ?? Infinity));
    else setLocal(String(value));
  };

  return (
    <label className={`flex items-center gap-1 ${className}`}>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground whitespace-nowrap select-none">{label}</span>
        {tip && <HelpIcon tip={tip} className="opacity-70 hover:opacity-100" />}
      </div>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        className="w-12 h-5 text-[11px] text-center bg-input border border-border rounded px-1 py-0 focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   TimelinePanel — main component
────────────────────────────────────────────────────────────────────────── */
export function TimelinePanel() {
  const anim = useAnimationStore();
  const proj = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateProject);
  const sel = useEditorStore(s => s.selection);
  const autoKeyframe = useEditorStore(s => s.autoKeyframe);
  const setAutoKeyframe = useEditorStore(s => s.setAutoKeyframe);

  const trackAreaRef = useRef(null);
  const rulerRef = useRef(null);

  // State for selection and clipboard
  const [selectedKeyframes, setSelectedKeyframes] = useState(new Set()); // Set of "nodeId:timeMs"
  const [selectionBox, setSelectionBox] = useState(null); // {x, y, w, h}
  const [clipboard, setClipboard] = useState(null); // { properties: { prop: val }, easing: string }

  // Ref to manage drag states without re-rendering continuously
  const dragCtx = useRef({
    type: null, // "playhead", "keyframe", "box", "loopStart", "loopEnd"
    startX: 0,
    startY: 0,
    startScrollX: 0,
    startScrollY: 0,
    startFrame: 0,
    origKeyframes: [], // [{ nodeId, origTimeMs, props: [{propName, origTimeMs}] }]
  });

  /* ── Active animation object ────────────────────────────────────────── */
  const animation = useMemo(
    () => proj.animations.find(a => a.id === anim.activeAnimationId) ?? null,
    [proj.animations, anim.activeAnimationId]
  );

  /* ── Derived values ─────────────────────────────────────────────────── */
  const fps = anim.fps;
  const currentFrame = msToFrame(anim.currentTime, fps);
  const endFrame = Math.max(1, anim.endFrame);
  const startFrame = Math.max(0, anim.startFrame);
  const totalFrames = Math.max(endFrame - startFrame, 1);

  /* ── Auto-select animation when one exists ───────────────────────────── */
  useEffect(() => {
    if (!anim.activeAnimationId && proj.animations.length > 0) {
      anim.setActiveAnimationId(proj.animations[0].id);
      const a = proj.animations[0];
      anim.setFps(a.fps ?? 24);
      anim.setEndFrame(Math.round(((a.duration ?? 2000) / 1000) * (a.fps ?? 24)));
    }
  }, [proj.animations, anim.activeAnimationId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Create a default animation if none ─────────────────────────────── */
  const ensureAnimation = useCallback(() => {
    if (proj.animations.length > 0) return proj.animations[0].id;
    const id = uid();
    update((p) => {
      p.animations.push({
        id,
        name: 'Animation 1',
        duration: 2000,
        fps: 24,
        tracks: [],
      });
    });
    anim.setActiveAnimationId(id);
    anim.setFps(24);
    anim.setEndFrame(48);
    return id;
  }, [proj.animations, update, anim]);

  /* ── Timeline pixel helpers ─────────────────────────────────────────── */
  // clientX to global frame mapping, respecting zoom
  const xToFrame = useCallback((clientX) => {
    if (!rulerRef.current) return startFrame;
    const rect = rulerRef.current.getBoundingClientRect();
    // width is the inner width of ruler track (zoom factored in since ruler scales)
    const localX = clientX - rect.left - TRACK_PAD;
    const trackW = rect.width - 2 * TRACK_PAD;
    const frac = clamp(localX / trackW, 0, 1);
    return Math.round(startFrame + frac * totalFrames);
  }, [startFrame, totalFrames]);

  // Frame to percentage width for positioning
  const frameToPercentage = useCallback((frame) => {
    const frac = (frame - startFrame) / totalFrames;
    return `${frac * 100}%`;
  }, [startFrame, totalFrames]);

  /* ── Drag Handlers ──────────────────────────────────────────────────── */

  // Playhead dragging
  const onRulerPointerDown = useCallback((e) => {
    dragCtx.current = { type: 'playhead' };
    const frame = xToFrame(e.clientX);
    anim.seekFrame(clamp(frame, startFrame, endFrame));

    const handleMove = (ev) => {
      const frame = xToFrame(ev.clientX);
      anim.seekFrame(clamp(frame, startFrame, endFrame));
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      dragCtx.current.type = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [xToFrame, anim, startFrame, endFrame]);

  // Keyframe clicking & dragging
  const onKeyframePointerDown = useCallback((e, nodeId, timeMs) => {
    e.stopPropagation();

    const id = `${nodeId}:${timeMs}`;
    let newSel = new Set(selectedKeyframes);

    // Shift click toggles selection
    if (e.shiftKey) {
      if (newSel.has(id)) newSel.delete(id);
      else newSel.add(id);
      setSelectedKeyframes(newSel);
    }
    // Normal click selects only this, unless it's already selected
    else {
      if (!newSel.has(id)) {
        newSel = new Set([id]);
        setSelectedKeyframes(newSel);
      }
    }

    // Prepare drag context
    const orig = [];
    if (animation) {
      for (const track of animation.tracks) {
        for (const kf of track.keyframes) {
          if (newSel.has(`${track.nodeId}:${kf.time}`)) {
            orig.push({ trackNodeId: track.nodeId, prop: track.property, origTimeMs: kf.time });
          }
        }
      }
    }

    dragCtx.current = {
      type: 'keyframe',
      startX: e.clientX,
      startFrame: msToFrame(timeMs, fps),
      origKeyframes: orig,
    };

    const handleMove = (ev) => {
      const dragFrameDelta = xToFrame(ev.clientX) - dragCtx.current.startFrame;
      if (dragFrameDelta !== 0) {
        let nextSel = new Set();
        update((p) => {
          const a = p.animations.find(x => x.id === anim.activeAnimationId);
          if (!a) return;
          for (const item of dragCtx.current.origKeyframes) {
            const track = a.tracks.find(t => t.nodeId === item.trackNodeId && t.property === item.prop);
            if (track) {
              const kf = track.keyframes.find(k => k.time === item.origTimeMs);
              if (kf) {
                const newFrame = Math.max(0, msToFrame(item.origTimeMs, fps) + dragFrameDelta);
                kf.time = frameToMs(newFrame, fps);
                nextSel.add(`${item.trackNodeId}:${kf.time}`);
              }
            }
          }
          // Sort tracks by time to ensure play engine doesn't trip up
          a.tracks.forEach(t => t.keyframes.sort((k1, k2) => k1.time - k2.time));
        });

        // Update selection to match new times
        if (nextSel.size > 0) {
          setSelectedKeyframes(nextSel);
          dragCtx.current.origKeyframes = dragCtx.current.origKeyframes.map(item => {
            const newFrame = Math.max(0, msToFrame(item.origTimeMs, fps) + dragFrameDelta);
            return { ...item, origTimeMs: frameToMs(newFrame, fps) };
          });
          dragCtx.current.startFrame += dragFrameDelta;
        }
      }
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      dragCtx.current.type = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

  }, [selectedKeyframes, animation, anim.activeAnimationId, fps, xToFrame, update]);

  // Box Selection
  const onTrackAreaPointerDown = useCallback((e) => {
    if (e.target.closest('.keyframe-diamond') || e.target.closest('.ruler-track')) return;
    if (!trackAreaRef.current) return;

    // Deselect if clicking empty space without shift
    if (!e.shiftKey) setSelectedKeyframes(new Set());

    const rect = trackAreaRef.current.getBoundingClientRect();
    dragCtx.current = {
      type: 'box',
      startX: e.clientX,
      startY: e.clientY,
      rectLeft: rect.left + LABEL_W, // Track area only
      rectTop: rect.top,
      startScrollX: trackAreaRef.current.scrollLeft,
      startScrollY: trackAreaRef.current.scrollTop
    };

    setSelectionBox({
      x: e.clientX - rect.left - LABEL_W + dragCtx.current.startScrollX,
      y: e.clientY - rect.top + dragCtx.current.startScrollY,
      w: 0,
      h: 0
    });

    const handleMove = (ev) => {
      const dx = ev.clientX - dragCtx.current.startX;
      const dy = ev.clientY - dragCtx.current.startY;

      const scrollDx = trackAreaRef.current.scrollLeft - dragCtx.current.startScrollX;
      const scrollDy = trackAreaRef.current.scrollTop - dragCtx.current.startScrollY;

      // Calculate Box rect in scrollable content coordinates
      let bx = dragCtx.current.startX - dragCtx.current.rectLeft + dragCtx.current.startScrollX;
      let by = dragCtx.current.startY - dragCtx.current.rectTop + dragCtx.current.startScrollY;
      let bw = dx + scrollDx;
      let bh = dy + scrollDy;

      if (bw < 0) { bx += bw; bw = Math.abs(bw); }
      if (bh < 0) { by += bh; bh = Math.abs(bh); }

      setSelectionBox({ x: bx, y: by, w: bw, h: bh });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      dragCtx.current.type = null;

      // Perform Intersection test
      if (animation) {
        setSelectionBox(prevBox => {
          if (prevBox && prevBox.w > 5 && prevBox.h > 5) {
            let newSel = new Set(e.shiftKey ? selectedKeyframes : []);

            const trackRows = Array.from(new Map(
              animation.tracks.map(t => [t.nodeId, t])
            ).keys());

            for (let rIndex = 0; rIndex < trackRows.length; rIndex++) {
              const nodeId = trackRows[rIndex];
              const rowY = RULER_H + (rIndex * ROW_H);

              // If row intersects box Y
              if (rowY + ROW_H > prevBox.y && rowY < prevBox.y + prevBox.h) {
                const tracksForNode = animation.tracks.filter(t => t.nodeId === nodeId);
                const times = [...new Set(tracksForNode.flatMap(t => t.keyframes.map(k => k.time)))];

                for (const timeMs of times) {
                  const frame = msToFrame(timeMs, fps);
                  const frac = (frame - startFrame) / totalFrames;
                  if (frac >= 0 && frac <= 1) {
                    const trackW = rulerRef.current?.getBoundingClientRect().width - 2 * TRACK_PAD;
                    if (trackW) {
                      const kfX = TRACK_PAD + (frac * trackW);
                      // Intersect X
                      if (kfX > prevBox.x && kfX < prevBox.x + prevBox.w) {
                        newSel.add(`${nodeId}:${timeMs}`);
                      }
                    }
                  }
                }
              }
            }
            setSelectedKeyframes(newSel);
          }
          return null;
        });
      } else {
        setSelectionBox(null);
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [animation, startFrame, totalFrames, fps, selectedKeyframes]);

  /* ── Clipboard Actions ──────────────────────────────────────────────── */
  const copyKeyframe = useCallback((nodeId, timeMs) => {
    if (!animation) return;
    const props = {};
    let easing = 'linear';

    for (const track of animation.tracks) {
      if (track.nodeId !== nodeId) continue;
      const kf = track.keyframes.find(k => k.time === timeMs);
      if (kf) {
        props[track.property] = kf.value;
        easing = kf.easing ?? 'linear';
      }
    }

    if (Object.keys(props).length > 0) {
      setClipboard({ properties: props, easing });
    }
  }, [animation]);

  const pasteKeyframes = useCallback(() => {
    if (!clipboard || !animation || sel.length === 0) return;

    update((p) => {
      const a = p.animations.find(x => x.id === anim.activeAnimationId);
      if (!a) return;

      const timeMs = anim.currentTime;

      for (const nodeId of sel) {
        for (const [prop, value] of Object.entries(clipboard.properties)) {
          let track = a.tracks.find(t => t.nodeId === nodeId && t.property === prop);
          if (!track) {
            track = { nodeId, property: prop, keyframes: [] };
            a.tracks.push(track);
          }

          const existingIdx = track.keyframes.findIndex(kf => kf.time === timeMs);
          if (existingIdx >= 0) {
            track.keyframes[existingIdx].value = value;
            track.keyframes[existingIdx].easing = clipboard.easing;
          } else {
            track.keyframes.push({ time: timeMs, value, easing: clipboard.easing });
            track.keyframes.sort((a, b) => a.time - b.time);
          }
        }
      }
    });
  }, [clipboard, animation, sel, anim.currentTime, anim.activeAnimationId, update]);

  /* ── Delete Selection ────────────────────────────────────────────────── */
  const deleteSelectedKeyframes = useCallback(() => {
    if (selectedKeyframes.size === 0) return;

    update((p) => {
      const a = p.animations.find(x => x.id === anim.activeAnimationId);
      if (!a) return;
      for (const track of a.tracks) {
        track.keyframes = track.keyframes.filter(kf => !selectedKeyframes.has(`${track.nodeId}:${kf.time}`));
      }
      a.tracks = a.tracks.filter(t => t.keyframes.length > 0);
    });
    setSelectedKeyframes(new Set());
  }, [update, anim.activeAnimationId, selectedKeyframes]);

  // Keybindings
  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        deleteSelectedKeyframes();
      } else if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c') {
          if (selectedKeyframes.size > 0) {
            // Copy the "first" one in selection
            const first = selectedKeyframes.values().next().value;
            const [nodeId, timeMsStr] = first.split(':');
            copyKeyframe(nodeId, parseFloat(timeMsStr));
          }
        } else if (e.key === 'v') {
          pasteKeyframes();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedKeyframes, selectedKeyframes, copyKeyframe, pasteKeyframes]);


  /* ── Context Menu state ─────────────────────────────────────────────── */
  const [contextMenu, setContextMenu] = useState(null); // { x, y, nodeId, timeMs }

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (contextMenu) {
      window.addEventListener('click', closeContextMenu);
      return () => window.removeEventListener('click', closeContextMenu);
    }
  }, [contextMenu, closeContextMenu]);

  /* ── Build track rows ────────────────────────────────────────────────── */
  // Group tracks by nodeId, show one row per node that has any keyframe.
  const trackRows = useMemo(() => {
    if (!animation) return [];
    const nodeMap = new Map(proj.nodes.map(n => [n.id, n]));
    const byNode = new Map();

    for (const track of animation.tracks) {
      if (!byNode.has(track.nodeId)) byNode.set(track.nodeId, []);
      byNode.get(track.nodeId).push(track);
    }

    return Array.from(byNode.entries())
      .map(([nodeId, tracks]) => ({
        nodeId,
        name: nodeMap.get(nodeId)?.name ?? nodeId,
        tracks,
        // Collect all unique keyframe times across all tracks for this node
        times: [...new Set(tracks.flatMap(t => t.keyframes.map(kf => kf.time)))].sort((a, b) => a - b),
      }));
  }, [animation, proj.nodes]);

  /* ── Transport ───────────────────────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    ensureAnimation();
    if (anim.isPlaying) anim.pause();
    else anim.play();
  }, [anim, ensureAnimation]);

  const stop = useCallback(() => {
    anim.stop();
  }, [anim]);

  /* ── Ruler tick marks ────────────────────────────────────────────────── */
  const rulerTicks = useMemo(() => {
    const step = totalFrames <= 24 ? 1
      : totalFrames <= 120 ? 5
        : totalFrames <= 480 ? 10
          : 24;
    const ticks = [];
    for (let f = startFrame; f <= endFrame; f += step) {
      ticks.push(f);
    }
    return ticks;
  }, [startFrame, endFrame, totalFrames]);

  /* ── No animation state ──────────────────────────────────────────────── */
  const hasAnimation = proj.animations.length > 0;

  return (
    <div className="flex flex-col h-full select-none text-xs">

      {/* ── Transport bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border shrink-0 bg-card">
        {/* Stop */}
        <TransportBtn onClick={stop} title="Stop (return to start)">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        </TransportBtn>

        {/* Play / Pause */}
        <TransportBtn onClick={togglePlay} active={anim.isPlaying} title={anim.isPlaying ? 'Pause' : 'Play'}>
          {anim.isPlaying ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
              <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <polygon points="2,1 9,5 2,9" />
            </svg>
          )}
        </TransportBtn>

        {/* Repeat */}
        <TransportBtn onClick={() => anim.setLoop(!anim.loop)} active={anim.loop} title="Repeat">
          <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 3h8a2 2 0 0 1 0 4H3" />
            <polyline points="1,1 1,3 3,3" />
          </svg>
        </TransportBtn>

        {/* Loop Keyframes */}
        <label className="flex items-center gap-1 ml-1 cursor-pointer" title="Interpolate from last keyframe to first keyframe when looping">
          <input
            type="checkbox"
            checked={anim.loopKeyframes || false}
            onChange={(e) => anim.setLoopKeyframes && anim.setLoopKeyframes(e.target.checked)}
            className="w-3 h-3 accent-primary"
          />
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Loop Keyframe</span>
            <HelpIcon tip="When active, the animation will interpolate from the last keyframe back to the first keyframe for a seamless loop." />
          </div>
        </label>

        {/* Auto Keyframe */}
        <TransportBtn
          onClick={() => setAutoKeyframe(!autoKeyframe)}
          active={autoKeyframe}
          className={autoKeyframe ? 'animate-recording' : ''}
          title="Auto Keyframe: Automatically commit values to track when properties are changed"
        >
          <Disc size={14} strokeWidth={2} />
        </TransportBtn>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Frame fields */}
        <NumField
          label="Frame"
          value={currentFrame}
          min={startFrame}
          max={endFrame}
          onChange={(v) => anim.seekFrame(v)}
          tip="The current playback frame."
        />
        <NumField
          label="Start"
          value={startFrame}
          min={0}
          max={endFrame - 1}
          onChange={(v) => anim.setStartFrame(v)}
          tip="The first frame of the animation loop."
        />
        <NumField
          label="End"
          value={endFrame}
          min={startFrame + 1}
          onChange={(v) => anim.setEndFrame(v)}
          tip="The last frame of the animation loop."
        />

        <div className="w-px h-4 bg-border mx-1" />

        <NumField
          label="FPS"
          value={fps}
          min={1}
          max={120}
          onChange={(v) => anim.setFps(v)}
          tip="Frames per second — determines playback granularity."
        />

        {/* Speed slider */}
        <label className="flex items-center gap-1 ml-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Speed</span>
            <HelpIcon tip="Playback speed multiplier." />
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={anim.speed}
            onChange={e => anim.setSpeed(parseFloat(e.target.value))}
            className="w-16 h-1 accent-primary"
          />
          <span className="text-[10px] text-muted-foreground w-6">{anim.speed.toFixed(1)}×</span>
        </label>

        <span className="flex-1" />

        {/* Animation name / selector */}
        {animation && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[100px]" title={animation.name}>
            {animation.name}
          </span>
        )}

        {/* New animation */}
        {!hasAnimation && (
          <button
            onClick={ensureAnimation}
            className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + New Animation
          </button>
        )}

        {/* K key hint */}
        <span className="text-[10px] text-muted-foreground border border-border/40 px-1 py-0.5 font-mono" title="Press K to keyframe selected nodes">
          K
        </span>
      </div>

      <div
        className="flex-1 overflow-auto relative select-none"
        ref={trackAreaRef}
        onPointerDown={onTrackAreaPointerDown}
      >
        {trackRows.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[11px] text-muted-foreground/60">
              {hasAnimation
                ? 'Select a node and press K to add keyframes'
                : 'Create an animation to begin'}
            </p>
          </div>
        ) : (
          <div className="relative min-w-full isolate" style={{ minHeight: RULER_H + trackRows.length * ROW_H }}>

            {/* Selection Box */}
            {selectionBox && (
              <div
                className="absolute border border-primary bg-primary/20 pointer-events-none z-50 mix-blend-screen"
                style={{
                  left: selectionBox.x + LABEL_W, top: selectionBox.y,
                  width: selectionBox.w, height: selectionBox.h
                }}
              />
            )}

            {/* Ruler */}
            <div
              className="sticky top-0 z-40 flex bg-card border-b border-border ruler-track"
              style={{ height: RULER_H }}
              onPointerDown={onRulerPointerDown}
            >
              {/* Label column placeholder */}
              <div style={{ width: LABEL_W, minWidth: LABEL_W }} className="border-r border-border shrink-0 sticky left-0 z-50 bg-card" />

              {/* Tick marks — padded inner wrapper so edges don't clip */}
              <div className="relative flex-1 overflow-hidden cursor-col-resize ruler-track" ref={rulerRef}>
                <div className="absolute inset-y-0 pointer-events-none" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                  {rulerTicks.map(f => {
                    return (
                      <div
                        key={f}
                        className="absolute top-0 flex flex-col items-center"
                        style={{ left: frameToPercentage(f), transform: 'translateX(-50%)' }}
                      >
                        <div className="w-px bg-border" style={{ height: f % (fps || 24) === 0 ? 8 : 4, marginTop: f % (fps || 24) === 0 ? 0 : 4 }} />
                        {f % (fps || 24) === 0 && (
                          <span className="text-[9px] text-muted-foreground leading-none mt-0.5">
                            {f}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Track rows */}
            {trackRows.map((row, ri) => (
              <div
                key={row.nodeId}
                className={[
                  'flex border-b border-border/30 relative text-[11px]',
                  sel.includes(row.nodeId) ? 'bg-primary/5' : 'hover:bg-muted/20',
                ].join(' ')}
                style={{ height: ROW_H }}
              >
                {/* Node label */}
                <div
                  className="flex items-center px-2 border-r border-border/30 shrink-0 text-muted-foreground overflow-hidden sticky left-0 z-30 bg-card/80 backdrop-blur-sm shadow-[1px_0_2px_rgba(0,0,0,0.1)]"
                  style={{ width: LABEL_W, minWidth: LABEL_W }}
                  title={row.name}
                >
                  <span className="truncate">{row.name}</span>
                </div>

                {/* Keyframe diamonds — padded inner wrapper */}
                <div className="relative flex-1 overflow-visible">
                  <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                    {row.times.map(timeMs => {
                      const frame = msToFrame(timeMs, fps);
                      const frac = (frame - startFrame) / totalFrames;
                      if (frac < 0 || frac > 1) return null;

                      const isAtPlayhead = frame === currentFrame;
                      const isSelected = selectedKeyframes.has(`${row.nodeId}:${timeMs}`);

                      return (
                        <div
                          key={timeMs}
                          title={`Frame ${frame} — click to select, drag to move`}
                          onPointerDown={(e) => onKeyframePointerDown(e, row.nodeId, timeMs)}
                          onContextMenu={e => {
                            e.preventDefault();
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              nodeId: row.nodeId,
                              timeMs
                            });
                          }}
                          className={[
                            'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 cursor-ew-resize',
                            'rotate-45 border transition-colors z-20 keyframe-diamond',
                            isSelected ? 'bg-primary border-primary shadow-[0_0_4px_rgba(255,255,255,0.5)]'
                              : isAtPlayhead
                                ? 'bg-primary border-primary'
                                : 'bg-background border-primary/60 hover:bg-primary/40',
                          ].join(' ')}
                          style={{ left: frameToPercentage(frame) }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}

            {/* Playhead — vertical line spanning ruler + all rows */}
            {trackRows.length > 0 && (() => {
              const frac = (currentFrame - startFrame) / totalFrames;
              if (frac < 0 || frac > 1) return null;
              return (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary/80 pointer-events-none z-40"
                  style={{ left: `calc(${LABEL_W + TRACK_PAD}px + ${frac * 100}% - ${(LABEL_W + 2 * TRACK_PAD) * frac}px)` }}
                >
                  {/* Playhead triangle head */}
                  <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-0 h-0
                    border-l-[4px] border-l-transparent
                    border-r-[4px] border-r-transparent
                    border-t-[6px] border-t-primary" />
                </div>
              );
            })()}

          </div>
        )}
      </div>

      {/* ── Keyframe Context Menu ───────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-popover border border-border rounded shadow-lg py-1 min-w-[100px] text-[11px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors"
            onClick={() => {
              copyKeyframe(contextMenu.nodeId, contextMenu.timeMs);
              closeContextMenu();
            }}
          >
            Copy
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-50"
            disabled={!clipboard}
            onClick={() => {
              pasteKeyframes();
              closeContextMenu();
            }}
          >
            Paste
          </button>
          <div className="h-px bg-border my-1" />
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors text-destructive"
            onClick={() => {
              // If the menu target was part of selection, delete selection.
              // Otherwise, just delete the target keyframe.
              const targetId = `${contextMenu.nodeId}:${contextMenu.timeMs}`;
              if (selectedKeyframes.has(targetId)) {
                deleteSelectedKeyframes();
              } else {
                update((p) => {
                  const a = p.animations.find(x => x.id === anim.activeAnimationId);
                  if (!a) return;
                  for (const track of a.tracks) {
                    if (track.nodeId !== contextMenu.nodeId) continue;
                    track.keyframes = track.keyframes.filter(kf => kf.time !== contextMenu.timeMs);
                  }
                  a.tracks = a.tracks.filter(t => t.keyframes.length > 0);
                });
              }
              closeContextMenu();
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
