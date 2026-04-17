import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useAnimationStore } from '@/store/animationStore';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { beginBatch, endBatch } from '@/store/undoHistory';
import { cn } from '@/lib/utils';
import { Disc, RotateCcw, Repeat, SkipBack, SkipForward, Copy, Clipboard, Trash2, Music, X, Settings } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
function TransportBtn({ onClick, active, title, children, className = '', disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center w-6 h-6 rounded text-xs transition-colors',
        active
          ? (className.includes('bg-') ? '' : 'bg-primary text-primary-foreground')
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        disabled && 'opacity-30 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      {children}
    </button>
  );
}

const CurveIcon = ({ type, className = '' }) => {
  let pathD = '';
  if (type === 'linear') pathD = 'M 2 14 L 14 2';
  else if (type === 'ease-in') pathD = 'M 2 14 C 14 14, 14 14, 14 2';
  else if (type === 'ease-out') pathD = 'M 2 14 C 2 2, 2 2, 14 2';
  else if (type === 'stepped') pathD = 'M 2 14 L 14 14 L 14 2';
  else pathD = 'M 2 14 C 8 14, 8 2, 14 2'; // ease-both / ease

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={cn('stroke-current fill-none', className)}>
      <path d={pathD} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

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
    <label className={`flex items-center gap-1 ${className}`} title={tip}>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap select-none">{label}</span>
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
   useAudioSync — Web Audio API playback sync

   Key design: effect only watches isPlaying / activeAnimationId, NOT currentTime.
   currentTime is read via ref so it's fresh at the moment play is pressed
   without causing the effect to re-fire every rAF frame.
────────────────────────────────────────────────────────────────────────── */
function useAudioSync(animation, animStore) {
  const audioCtxRef    = useRef(null);
  const buffersRef     = useRef(new Map()); // trackId → AudioBuffer
  const sourcesRef     = useRef(new Map()); // trackId → active AudioBufferSourceNode
  const animationRef   = useRef(animation); // always-fresh animation, not a reactive dep
  const currentTimeRef = useRef(animStore.currentTime); // always-fresh time, not a reactive dep

  // Update refs every render so effects always read the latest values
  animationRef.current   = animation;
  currentTimeRef.current = animStore.currentTime;

  // ── 1. Decode buffers when new tracks with audio appear ───────────────
  //    Stable dep: track IDs + sourceUrls joined — avoids object identity churn
  const trackSourceKey = (animation?.audioTracks ?? [])
    .map(t => `${t.id}:${t.sourceUrl ?? ''}`)
    .join('|');

  useEffect(() => {
    const tracks = animationRef.current?.audioTracks ?? [];
    if (!tracks.length) return;

    let ctx = audioCtxRef.current;
    if (!ctx) { ctx = new AudioContext(); audioCtxRef.current = ctx; }

    for (const track of tracks) {
      if (!track.sourceUrl || buffersRef.current.has(track.id)) continue;
      fetch(track.sourceUrl)
        .then(r => r.arrayBuffer())
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { buffersRef.current.set(track.id, buf); })
        .catch(e => console.error(`Audio decode error (${track.id}):`, e));
    }
  }, [trackSourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Stop helper ─────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    sourcesRef.current.forEach(src => { try { src.stop(); } catch (_) {} });
    sourcesRef.current.clear();
  }, []);

  // ── 3. Play/stop — ONLY fires on isPlaying toggle or animation switch ──
  //    animation object intentionally NOT in deps (object ref changes every frame
  //    during drags/updates and would cause runaway restarts). Read via ref instead.
  useEffect(() => {
    if (!animStore.isPlaying) {
      stopAll();
      return;
    }

    const tracks = animationRef.current?.audioTracks ?? [];
    if (!tracks.length) return;

    let ctx = audioCtxRef.current;
    if (!ctx) { ctx = new AudioContext(); audioCtxRef.current = ctx; }

    const startAll = async () => {
      if (ctx.state === 'suspended') await ctx.resume();
      stopAll();

      const nowMs = currentTimeRef.current;

      for (const track of tracks) {
        if (!track.sourceUrl) continue;
        const buffer = buffersRef.current.get(track.id);
        if (!buffer) continue;

        const audioStartMs    = track.audioStartMs   ?? 0;
        const audioEndMs      = track.audioEndMs      ?? buffer.duration * 1000;
        const timelineStartMs = track.timelineStartMs ?? 0;
        const timelineEndMs   = timelineStartMs + (audioEndMs - audioStartMs);

        if (nowMs >= timelineEndMs) continue;

        const offsetInAudioMs = Math.max(0, audioStartMs + Math.max(0, nowMs - timelineStartMs));
        if (offsetInAudioMs >= audioEndMs) continue;

        const playDurationSec = (audioEndMs - offsetInAudioMs) / 1000;
        const delaySec        = Math.max(0, (timelineStartMs - nowMs) / 1000);

        try {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(ctx.currentTime + delaySec, offsetInAudioMs / 1000, playDurationSec);
          sourcesRef.current.set(track.id, source);
        } catch (e) {
          console.error(`Audio start error (${track.id}):`, e);
        }
      }
    };

    startAll().catch(e => console.error('Audio startAll error:', e));
    return () => { stopAll(); };
  // loopCount increments in animationStore.tick on each loop — causes audio restart from top
  }, [animStore.isPlaying, animStore.activeAnimationId, animStore.loopCount, stopAll]); // NOT animation, NOT currentTime
}

/* ──────────────────────────────────────────────────────────────────────────
   AudioTrackModal — edit audio track parameters using shadcn Dialog
────────────────────────────────────────────────────────────────────────── */
function AudioTrackModal({ track, animation, update, isOpen, onClose }) {
  // Local state to hold edits before saving (all in ms internally)
  const [name, setName] = useState(track.name);
  const [startOffset, setStartOffset] = useState(track.timelineStartMs);
  const [audioStartMs, setAudioStartMs] = useState(track.audioStartMs ?? 0);
  const [duration, setDuration] = useState((track.audioEndMs ?? track.audioDurationMs) - (track.audioStartMs ?? 0));

  // Sync state when modal opens or track changes
  useEffect(() => {
    if (isOpen) {
      setName(track.name);
      setStartOffset(track.timelineStartMs);
      setAudioStartMs(track.audioStartMs ?? 0);
      setDuration((track.audioEndMs ?? track.audioDurationMs) - (track.audioStartMs ?? 0));
    }
  }, [isOpen, track]);

  const handleSave = () => {
    update(p => {
      const anim = p.animations.find(a => a.id === animation.id);
      if (anim) {
        const t = anim.audioTracks.find(at => at.id === track.id);
        if (t) {
          t.name = name || 'Untitled Audio';
          t.timelineStartMs = Math.round(Math.max(0, startOffset));
          t.audioStartMs = Math.round(Math.max(0, audioStartMs));
          t.audioEndMs = Math.round(Math.max(audioStartMs + 100, audioStartMs + duration));
        }
      }
    });
    onClose();
  };

  const maxAudio = track.audioDurationMs ?? 0;
  const timelineEndMs = animation?.duration ?? 2000;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-card border-border shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Music className="w-5 h-5 text-primary" />
            <span>Audio Settings</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Track Name */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold tracking-tight">Track Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Background Music"
              className="h-9 font-medium"
            />
          </div>

          <div className="border-t border-border/50 my-2" />

          {/* Timeline Start Offset */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-semibold tracking-tight">Timeline Start</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={Number((startOffset / 1000).toFixed(2))}
                  onChange={e => setStartOffset((parseFloat(e.target.value) || 0) * 1000)}
                  className="w-24 h-8 text-right font-mono"
                />
                <span className="text-xs text-muted-foreground uppercase font-medium">s</span>
              </div>
            </div>
            <Slider
              min={0}
              max={timelineEndMs}
              step={1}
              value={[startOffset]}
              onValueChange={([v]) => setStartOffset(v)}
              className="py-1"
            />
            <p className="text-[10px] text-muted-foreground italic">Where on the animation timeline the audio begins.</p>
          </div>

          {/* Audio Start Trim */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-semibold tracking-tight">Audio Clip Start</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={Number((audioStartMs / 1000).toFixed(2))}
                  onChange={e => setAudioStartMs((parseFloat(e.target.value) || 0) * 1000)}
                  className="w-24 h-8 text-right font-mono"
                />
                <span className="text-xs text-muted-foreground uppercase font-medium">s</span>
              </div>
            </div>
            <Slider
              min={0}
              max={Math.max(maxAudio - 100, 0)}
              step={1}
              value={[audioStartMs]}
              onValueChange={([v]) => {
                const newVal = v;
                setAudioStartMs(newVal);
                // Ensure duration + start doesn't exceed total
                if (newVal + duration > maxAudio) {
                  setDuration(maxAudio - newVal);
                }
              }}
              className="py-1"
            />
            <p className="text-[10px] text-muted-foreground italic">Trim from the beginning of the source audio file.</p>
          </div>

          {/* Duration */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-semibold tracking-tight">Play Duration</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={Number((duration / 1000).toFixed(2))}
                  onChange={e => setDuration((parseFloat(e.target.value) || 0.1) * 1000)}
                  className="w-24 h-8 text-right font-mono"
                />
                <span className="text-xs text-muted-foreground uppercase font-medium">s</span>
              </div>
            </div>
            <Slider
              min={100}
              max={Math.max(maxAudio - audioStartMs, 100)}
              step={1}
              value={[duration]}
              onValueChange={([v]) => setDuration(v)}
              className="py-1"
            />
            <p className="text-[10px] text-muted-foreground italic">Total time this audio clip will play for.</p>
          </div>

          {/* Audio Info Card */}
          <div className="p-3 bg-muted/40 rounded-lg border border-border/50 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Source Duration</span>
              <span className="font-mono">{(maxAudio / 1000).toFixed(2)} s</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Audio Segment</span>
              <span className="font-mono text-primary">{(audioStartMs / 1000).toFixed(2)} → {((audioStartMs + duration) / 1000).toFixed(2)} s</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Timeline Span</span>
              <span className="font-mono text-primary">{(startOffset / 1000).toFixed(2)} → {((startOffset + duration) / 1000).toFixed(2)} s</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all border border-transparent hover:border-border"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:shadow-[0_0_15px_rgba(var(--primary),0.4)] transition-all"
          >
            Apply Changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/* ──────────────────────────────────────────────────────────────────────────
   AudioTrackRow — audio track with upload or clip display
────────────────────────────────────────────────────────────────────────── */
function AudioTrackRow({
  track,
  animation,
  update,
  frameToPercentage,
  xToFrame,
  startFrame,
  endFrame,
  totalFrames,
  fps,
}) {
  const fileInputRef = useRef(null);
  const [draggingHandle, setDraggingHandle] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const timelineEndMs = (animation?.duration ?? 2000);

  const handleUpload = async (file) => {
    const url = URL.createObjectURL(file);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);

      const audioDurationMs = buffer.duration * 1000;
      const clipEndMs = Math.min(audioDurationMs, timelineEndMs);

      update(p => {
        const anim = p.animations.find(a => a.id === animation.id);
        if (anim) {
          const t = anim.audioTracks.find(at => at.id === track.id);
          if (t) {
            t.sourceUrl = url;
            t.mimeType = file.type;
            t.audioDurationMs = audioDurationMs;
            t.audioStartMs = 0;
            t.audioEndMs = clipEndMs;
            t.timelineStartMs = 0;
          }
        }
      });
    } catch (err) {
      console.error('Failed to decode audio:', err);
      URL.revokeObjectURL(url);
    }
  };

  const handleLeftDrag = useCallback((e) => {
    if (!track.sourceUrl) return;
    e.stopPropagation(); // Prevent playhead seeking
    setDraggingHandle('left');
    beginBatch(useProjectStore.getState().project);

    const startX = e.clientX;
    const startFrame = xToFrame(startX);
    const origStart = track.audioStartMs ?? 0;
    const origTimelineStart = track.timelineStartMs ?? 0;

    const handleMove = (ev) => {
      const currentFrame = xToFrame(ev.clientX);
      const frameDelta = currentFrame - startFrame;
      const deltaMs = frameToMs(frameDelta, fps);

      update(p => {
        const anim = p.animations.find(a => a.id === animation.id);
        if (anim) {
          const t = anim.audioTracks.find(at => at.id === track.id);
          if (t) {
            const minDelta = Math.max(-origTimelineStart, -origStart); // keep both ≥ 0
            const maxDelta = (t.audioEndMs ?? t.audioDurationMs) - origStart - 100;
            const clampedDelta = Math.max(minDelta, Math.min(deltaMs, maxDelta));
            t.audioStartMs    = origStart + clampedDelta;
            t.timelineStartMs = origTimelineStart + clampedDelta;
          }
        }
      }, { skipHistory: true });
    };

    const handleUp = () => {
      endBatch();
      setDraggingHandle(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [track, animation, update, xToFrame, fps]);

  const handleRightDrag = useCallback((e) => {
    if (!track.sourceUrl) return;
    e.stopPropagation(); // Prevent playhead seeking
    setDraggingHandle('right');
    beginBatch(useProjectStore.getState().project);

    const startX = e.clientX;
    const startFrame = xToFrame(startX);
    const origEnd = track.audioEndMs;

    const handleMove = (ev) => {
      const currentFrame = xToFrame(ev.clientX);
      const frameDelta = currentFrame - startFrame;
      const deltaMs = frameToMs(frameDelta, fps);

      update(p => {
        const anim = p.animations.find(a => a.id === animation.id);
        if (anim) {
          const t = anim.audioTracks.find(at => at.id === track.id);
          if (t) {
            const audioStart = t.audioStartMs ?? 0;
            const maxEnd = t.audioDurationMs ?? 0;
            const minEnd = audioStart + 100;
            const clampedEnd = Math.max(minEnd, Math.min(origEnd + deltaMs, maxEnd));
            t.audioEndMs = clampedEnd;
          }
        }
      }, { skipHistory: true });
    };

    const handleUp = () => {
      endBatch();
      setDraggingHandle(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [track, animation, update, xToFrame, fps]);

  const handleBarDrag = useCallback((e) => {
    if (!track.sourceUrl) return;
    e.stopPropagation(); // Prevent playhead seeking
    setDraggingHandle('body');
    beginBatch(useProjectStore.getState().project);

    const startX = e.clientX;
    const startFrame = xToFrame(startX);
    const origStart = track.timelineStartMs ?? 0;

    const handleMove = (ev) => {
      const currentFrame = xToFrame(ev.clientX);
      const frameDelta = currentFrame - startFrame;
      const deltaMs = frameToMs(frameDelta, fps);

      update(p => {
        const anim = p.animations.find(a => a.id === animation.id);
        if (anim) {
          const t = anim.audioTracks.find(at => at.id === track.id);
          if (t) {
            t.timelineStartMs = Math.max(0, origStart + deltaMs);
          }
        }
      }, { skipHistory: true });
    };

    const handleUp = () => {
      endBatch();
      setDraggingHandle(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [track, animation, update, xToFrame, fps]);

  const audioDuration = track.audioDurationMs ?? 0;
  const audioStart = track.audioStartMs ?? 0;
  const audioEnd = track.audioEndMs ?? audioDuration;
  const playableMs = audioEnd - audioStart;
  const timelineStart = track.timelineStartMs ?? 0;
  const timelineEnd = timelineStart + playableMs;

  const startFramePos = msToFrame(timelineStart, fps);
  const endFramePos = msToFrame(timelineEnd, fps);
  const leftPercent = (startFramePos - startFrame) / totalFrames * 100;
  const rightPercent = (endFramePos - startFrame) / totalFrames * 100;

  const deleteTrack = () => {
    update(p => {
      const anim = p.animations.find(a => a.id === animation.id);
      if (anim) {
        anim.audioTracks = anim.audioTracks.filter(at => at.id !== track.id);
      }
    });
  };

  return (
    <>
      <div className="flex border-b border-border/30 relative text-[11px] bg-muted/5" style={{ height: ROW_H }}>
        {/* Label column */}
        <div className="flex items-center justify-between px-2 border-r border-border/30 shrink-0 text-muted-foreground overflow-hidden sticky left-0 z-30 bg-card/80 backdrop-blur-sm shadow-[1px_0_2px_rgba(0,0,0,0.1)]" style={{ width: LABEL_W, minWidth: LABEL_W }}>
          <span className="truncate text-xs font-medium">{track.name}</span>
          <div className="flex gap-0.5 ml-1">
            <button onClick={() => setShowModal(true)} className="p-0.5 hover:text-primary transition-colors" title="Audio settings">
              <Settings size={12} />
            </button>
            <button onClick={deleteTrack} className="p-0.5 hover:text-destructive transition-colors" title="Delete audio track">
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Track area */}
        <div className="relative flex-1 overflow-visible">
        <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
          {!track.sourceUrl ? (
            <div className="flex items-center justify-center h-full">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] px-2 py-1 rounded bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary transition-colors"
              >
                Upload audio
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
                className="hidden"
              />
            </div>
          ) : (
            <div
              onPointerDown={handleBarDrag}
              className="absolute top-1/2 -translate-y-1/2 h-3 bg-primary/30 border border-primary/50 rounded transition-all"
              style={{
                left: `${leftPercent}%`,
                right: `${100 - rightPercent}%`,
                cursor: draggingHandle === 'body' ? 'grabbing' : 'grab',
              }}
              title={`${track.name} — drag to move, drag edges to trim`}
            >
              {/* Left handle */}
              <div
                onPointerDown={handleLeftDrag}
                className="absolute top-0 bottom-0 -left-1 w-2 bg-primary/60 hover:bg-primary cursor-ew-resize rounded-l"
                style={{ cursor: draggingHandle === 'left' ? 'grabbing' : 'ew-resize' }}
              />
              {/* Right handle */}
              <div
                onPointerDown={handleRightDrag}
                className="absolute top-0 bottom-0 -right-1 w-2 bg-primary/60 hover:bg-primary cursor-ew-resize rounded-r"
                style={{ cursor: draggingHandle === 'right' ? 'grabbing' : 'ew-resize' }}
              />
            </div>
          )}
        </div>
        </div>
      </div>

      <AudioTrackModal
        track={track}
        animation={animation}
        update={update}
        fps={fps}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
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
  const labelStep = totalFrames <= 48 ? 2 : totalFrames <= 120 ? 5 : totalFrames <= 240 ? 10 : totalFrames <= 480 ? 20 : 50;

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
        audioTracks: [],
      });
    });
    anim.setActiveAnimationId(id);
    anim.setFps(24);
    anim.setEndFrame(48);
    return id;
  }, [proj.animations, update, anim]);

  // Audio sync hook
  useAudioSync(animation, anim);

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

    beginBatch(useProjectStore.getState().project);

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
        }, { skipHistory: true });

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
      endBatch();
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

    // Seek current frame to clicked position (if in track area, not labels)
    const rulerRect = rulerRef.current?.getBoundingClientRect();
    if (rulerRect && e.clientX >= rulerRect.left) {
      const frame = xToFrame(e.clientX);
      anim.seekFrame(clamp(frame, startFrame, endFrame));
    }

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
  }, [animation, startFrame, endFrame, totalFrames, fps, selectedKeyframes, xToFrame, anim]);

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


  /* ── Context Menu Actions ────────────────────────────────────────── */
  const setEasingAt = useCallback((nodeId, timeMs, easingType) => {
    const targetId = `${nodeId}:${timeMs}`;
    const applyTo = selectedKeyframes.has(targetId) ? selectedKeyframes : new Set([targetId]);
    update((p) => {
      const a = p.animations.find(x => x.id === anim.activeAnimationId);
      if (!a) return;
      for (const track of a.tracks) {
        for (const kf of track.keyframes) {
          if (applyTo.has(`${track.nodeId}:${kf.time}`)) {
             kf.easing = easingType;
          }
        }
      }
    });
  }, [selectedKeyframes, anim.activeAnimationId, update]);

  const removeKeyframeAt = useCallback((nodeId, timeMs) => {
    const targetId = `${nodeId}:${timeMs}`;
    if (selectedKeyframes.has(targetId)) {
      deleteSelectedKeyframes();
    } else {
      update((p) => {
        const a = p.animations.find(x => x.id === anim.activeAnimationId);
        if (!a) return;
        for (const track of a.tracks) {
          if (track.nodeId !== nodeId) continue;
          track.keyframes = track.keyframes.filter(kf => kf.time !== timeMs);
        }
        a.tracks = a.tracks.filter(t => t.keyframes.length > 0);
      });
    }
  }, [selectedKeyframes, deleteSelectedKeyframes, anim.activeAnimationId, update]);

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
      .map(([nodeId, tracks]) => {
        const times = [...new Set(tracks.flatMap(t => t.keyframes.map(kf => kf.time)))].sort((a, b) => a - b);
        
        const easingByTime = {};
        for (const time of times) {
          for (const t of tracks) {
             const kf = t.keyframes.find(k => k.time === time);
             if (kf) { 
               easingByTime[time] = kf.easing || 'ease-both'; 
               break; 
             }
          }
        }

        return {
          nodeId,
          name: nodeMap.get(nodeId)?.name ?? nodeId,
          tracks,
          times,
          easingByTime
        };
      });
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

  const lastFrame = useCallback(() => {
    anim.seekFrame(endFrame);
  }, [anim, endFrame]);

  /* ── Ruler tick marks ────────────────────────────────────────────────── */
  const rulerTicks = useMemo(() => {
    const ticks = [];
    for (let f = Math.floor(startFrame); f <= Math.ceil(endFrame); f++) {
      ticks.push(f);
    }
    return ticks;
  }, [startFrame, endFrame]);

  /* ── No animation state ──────────────────────────────────────────────── */
  const hasAnimation = proj.animations.length > 0;

  return (
    <div className="flex flex-col h-full select-none text-xs">

      {/* ── Transport bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border shrink-0 bg-card">
        {/* First Frame */}
        <TransportBtn disabled={!hasAnimation} onClick={stop} title="First Frame">
          <SkipBack size={14} />
        </TransportBtn>

        {/* Play / Pause */}
        <TransportBtn disabled={!hasAnimation} onClick={togglePlay} active={anim.isPlaying} title={anim.isPlaying ? 'Pause' : 'Play'}>
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

        {/* Last Frame */}
        <TransportBtn disabled={!hasAnimation} onClick={lastFrame} title="Last Frame">
          <SkipForward size={14} />
        </TransportBtn>

        {/* Repeat */}
        <TransportBtn disabled={!hasAnimation} onClick={() => anim.setLoop(!anim.loop)} active={anim.loop} title="Repeat">
          <Repeat size={14} />
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
          onChange={(v) => {
            anim.setEndFrame(v);
            if (animation) {
              update((p) => {
                const a = p.animations.find(x => x.id === animation.id);
                if (a) a.duration = (v / (a.fps ?? 24)) * 1000;
              });
            }
          }}
          tip="The last frame of the animation loop."
        />

        <div className="w-px h-4 bg-border mx-1" />

        <NumField
          label="FPS"
          value={fps}
          min={1}
          max={120}
          onChange={(v) => {
            anim.setFps(v);
            if (animation) {
              update((p) => {
                const a = p.animations.find(x => x.id === animation.id);
                if (a) {
                  const oldFps = a.fps ?? 24;
                  a.fps = v;
                  // Update duration so total frames (duration/1000 * fps) stays somewhat consistent?
                  // Or should duration in ms be the source of truth?
                  // In this app, typically the user thinks in frames, so if they change FPS 
                  // but keep the same number of frames, the duration in ms must change.
                  a.duration = (endFrame / v) * 1000;
                }
              });
            }
          }}
          tip="Frames per second — determines playback granularity."
        />

        {/* Speed slider */}
        <label className="flex items-center gap-1 ml-1" title="Playback speed multiplier.">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">Speed</span>
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

        <div className="w-px h-4 bg-border mx-1" />

        {/* Loop Keyframes */}
        <TransportBtn
          disabled={!hasAnimation}
          onClick={() => anim.setLoopKeyframes && anim.setLoopKeyframes(!anim.loopKeyframes)}
          active={anim.loopKeyframes}
          title="Loop Keyframes: When active, the animation will interpolate from the last keyframe back to the first keyframe for a seamless loop."
        >
          <RotateCcw size={14} />
        </TransportBtn>

        {/* Auto Keyframe */}
        <TransportBtn
          disabled={!hasAnimation}
          onClick={() => setAutoKeyframe(!autoKeyframe)}
          active={autoKeyframe}
          className={autoKeyframe ? 'animate-recording' : ''}
          title="Auto Keyframe: Automatically commit values to track when properties are changed"
        >
          <Disc size={14} strokeWidth={2} />
        </TransportBtn>

        {/* Add Audio Track */}
        <TransportBtn
          disabled={!hasAnimation}
          onClick={() => {
            const name = window.prompt('Audio track name:', `Audio ${(animation?.audioTracks?.length ?? 0) + 1}`);
            if (name) {
              update((p) => {
                const a = p.animations.find(x => x.id === anim.activeAnimationId);
                if (a) {
                  a.audioTracks.push({
                    id: uid(),
                    name,
                    sourceUrl: null,
                    mimeType: '',
                    audioDurationMs: 0,
                    audioStartMs: 0,
                    audioEndMs: null,
                    timelineStartMs: 0,
                  });
                }
              });
            }
          }}
          title={!hasAnimation ? "Create an animation first to add audio" : "Add audio track"}
        >
          <Music size={14} />
        </TransportBtn>

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
        {trackRows.length === 0 && (animation?.audioTracks?.length ?? 0) === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[11px] text-muted-foreground/60">
              {hasAnimation
                ? 'Select a node and press K to add keyframes or click 🎵 to add audio'
                : 'Create an animation to begin'}
            </p>
          </div>
        ) : (
          <div className="relative min-w-full isolate" style={{ minHeight: RULER_H + (trackRows.length + (animation?.audioTracks?.length ?? 0)) * ROW_H }}>

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
                    const isLabel = f % labelStep === 0;
                    return (
                      <div
                        key={f}
                        className="absolute top-0 flex flex-col items-center"
                        style={{ left: frameToPercentage(f), transform: 'translateX(-50%)' }}
                      >
                        <div className="w-px bg-border/40" style={{ height: isLabel ? 8 : 4, marginTop: isLabel ? 0 : 4 }} />
                        {isLabel && (
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

            {/* Frame Dividers (Subtle Vertical Grid) */}
            <div className="absolute inset-0 pointer-events-none" style={{ top: RULER_H, left: LABEL_W }}>
              <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                {rulerTicks.map(f => (
                  <div
                    key={f}
                    className="absolute top-0 bottom-0 w-px bg-border/10"
                    style={{ left: frameToPercentage(f) }}
                  />
                ))}
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
                    {/* Curve interpolation lines */}
                    <svg className="absolute inset-y-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
                      {row.times.map((tA, i) => {
                         if (i >= row.times.length - 1) return null;
                         const tB = row.times[i+1];
                         const fA = msToFrame(tA, fps);
                         const fB = msToFrame(tB, fps);
                         const perA = (fA - startFrame) / totalFrames * 100;
                         const perB = (fB - startFrame) / totalFrames * 100;
                         if (perA > 100 || perB < 0) return null; // out of view
                         
                         const easing = row.easingByTime[tA];
                         let pathD = `M ${Math.max(-10, perA)} 5 L ${Math.min(110, perB)} 5`; // simple fallback
                         
                         if (easing === 'stepped') {
                           pathD = `M ${perA} 8 L ${perB} 8 L ${perB} 2`;
                         } else if (easing === 'linear') {
                           pathD = `M ${perA} 8 L ${perB} 2`;
                         } else if (easing === 'ease-in') {
                           pathD = `M ${perA} 8 C ${perB} 8, ${perB} 8, ${perB} 2`;
                         } else if (easing === 'ease-out') {
                           pathD = `M ${perA} 8 C ${perA} 2, ${perA} 2, ${perB} 2`;
                         } else {
                           // ease, ease-both, Array, or undefined defaults to smooth (ease-both)
                           pathD = `M ${perA} 8 C ${perA + (perB-perA)*0.5} 8, ${perA + (perB-perA)*0.5} 2, ${perB} 2`;
                         }
                         
                         return <path key={`curve-${tA}`} d={pathD} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                      })}
                      
                      {/* Loop segment curve */}
                      {anim.loopKeyframes && row.times.length > 0 && (() => {
                        const tLast = row.times[row.times.length - 1];
                        const tEnd = frameToMs(endFrame, fps);
                        if (tLast >= tEnd) return null;

                        const fA = msToFrame(tLast, fps);
                        const fB = endFrame;
                        const perA = (fA - startFrame) / totalFrames * 100;
                        const perB = (fB - startFrame) / totalFrames * 100;
                        
                        // We wrap back to the value of the first keyframe (represented as height 2)
                        const easing = row.easingByTime[tLast] || 'ease-both';
                        let pathD;
                        if (easing === 'stepped') {
                          pathD = `M ${perA} 8 L ${perB} 8 L ${perB} 2`;
                        } else if (easing === 'linear') {
                          pathD = `M ${perA} 8 L ${perB} 2`;
                        } else if (easing === 'ease-in') {
                          pathD = `M ${perA} 8 C ${perB} 8, ${perB} 8, ${perB} 2`;
                        } else if (easing === 'ease-out') {
                          pathD = `M ${perA} 8 C ${perA} 2, ${perA} 2, ${perB} 2`;
                        } else {
                          // ease, ease-both, Array, or undefined defaults to smooth (ease-both)
                          pathD = `M ${perA} 8 C ${perA + (perB-perA)*0.5} 8, ${perA + (perB-perA)*0.5} 2, ${perB} 2`;
                        }
                        
                        return <path key="curve-loop" d={pathD} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" strokeDasharray="4 2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                      })()}
                    </svg>

                    {row.times.map(timeMs => {
                      const frame = msToFrame(timeMs, fps);
                      const frac = (frame - startFrame) / totalFrames;
                      if (frac < 0 || frac > 1) return null;

                      const isAtPlayhead = frame === currentFrame;
                      const isSelected = selectedKeyframes.has(`${row.nodeId}:${timeMs}`);

                      return (
                        <ContextMenu key={timeMs}>
                          <ContextMenuTrigger>
                            <div
                              title={`Frame ${frame} — click to select, drag to move`}
                              onPointerDown={(e) => onKeyframePointerDown(e, row.nodeId, timeMs)}
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
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onSelect={() => copyKeyframe(row.nodeId, timeMs)}>
                              <Copy className="w-3 h-3 mr-2 opacity-70" />
                              Copy
                            </ContextMenuItem>
                            <ContextMenuItem disabled={!clipboard} onSelect={pasteKeyframes}>
                              <Clipboard className="w-3 h-3 mr-2 opacity-70" />
                              Paste
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => setEasingAt(row.nodeId, timeMs, 'linear')}>
                              <CurveIcon type="linear" className="mr-2 opacity-70" />
                              Linear
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.nodeId, timeMs, 'ease-both')}>
                              <CurveIcon type="ease-both" className="mr-2 opacity-70" />
                              Ease Both
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.nodeId, timeMs, 'ease-in')}>
                              <CurveIcon type="ease-in" className="mr-2 opacity-70" />
                              Ease In
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.nodeId, timeMs, 'ease-out')}>
                              <CurveIcon type="ease-out" className="mr-2 opacity-70" />
                              Ease Out
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.nodeId, timeMs, 'stepped')}>
                              <CurveIcon type="stepped" className="mr-2 opacity-70" />
                              Stepped
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-destructive" onSelect={() => removeKeyframeAt(row.nodeId, timeMs)}>
                              <Trash2 className="w-3 h-3 mr-2 opacity-70" />
                              Remove
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}

                    {/* Phantom Loop Keyframe */}
                    {anim.loopKeyframes && row.times.length > 0 && !row.times.includes(frameToMs(endFrame, fps)) && (
                      <div
                        title={`Loop wrap-around: references first keyframe at frame ${msToFrame(row.times[0], fps)}`}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border border-primary/40 border-dashed bg-transparent z-10 pointer-events-none"
                        style={{ left: frameToPercentage(endFrame) }}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Audio track rows */}
            {(animation?.audioTracks ?? []).map((audioTrack) => (
              <AudioTrackRow
                key={audioTrack.id}
                track={audioTrack}
                animation={animation}
                update={update}
                frameToPercentage={frameToPercentage}
                xToFrame={xToFrame}
                startFrame={startFrame}
                endFrame={endFrame}
                totalFrames={totalFrames}
                fps={fps}
              />
            ))}

            {/* Playhead — vertical line spanning ruler + all rows */}
            {(trackRows.length > 0 || (animation?.audioTracks?.length ?? 0) > 0) && (() => {
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
      {/* Context menu replaced by Radix UI ContextMenu above */}
    </div>
  );
}
