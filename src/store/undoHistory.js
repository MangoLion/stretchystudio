/**
 * undoHistory — pure JS module for snapshot-based undo/redo.
 *
 * No React or Zustand imports — stays free of circular dependencies.
 * projectStore imports pushSnapshot/isBatching/clearHistory from here.
 * useUndoRedo imports undo/redo from here.
 */

const MAX_HISTORY = 50;

let _snapshots = [];  // past project snapshots (pre-mutation state)
let _redoStack  = [];  // redo stack
let _batchDepth = 0;  // >0 means we're inside a continuous gesture

/** Push a snapshot of the project before a discrete mutation.
 *  Uses structuredClone to correctly preserve typed arrays (Float32Array for
 *  mesh.uvs, etc.) that JSON.parse/stringify would corrupt to plain objects. */
export function pushSnapshot(project) {
  _snapshots.push(structuredClone(project));
  if (_snapshots.length > MAX_HISTORY) _snapshots.shift();
  _redoStack = [];
}

/**
 * Call at the start of a continuous gesture (drag, slider scrub).
 * Captures one pre-gesture snapshot and suppresses per-frame snapshots.
 */
export function beginBatch(project) {
  if (_batchDepth === 0) pushSnapshot(project);
  _batchDepth++;
}

/** Call at the end of a continuous gesture. */
export function endBatch() {
  _batchDepth = Math.max(0, _batchDepth - 1);
}

/** Returns true while inside a batch — updateProject should skip auto-snapshot. */
export function isBatching() {
  return _batchDepth > 0;
}

/** Clear history — call on project load/reset so stale history doesn't leak. */
export function clearHistory() {
  _snapshots  = [];
  _redoStack  = [];
  _batchDepth = 0;
}

/**
 * Apply undo.
 * @param {object} currentProject - current project state (for redo stack)
 * @param {function} applyFn - receives the snapshot; should restore project state
 */
export function undo(currentProject, applyFn) {
  if (_snapshots.length === 0) return;
  const prev = _snapshots.pop();
  _redoStack.push(structuredClone(currentProject));
  applyFn(prev);
}

/**
 * Apply redo.
 * @param {object} currentProject - current project state (for undo stack)
 * @param {function} applyFn - receives the snapshot; should restore project state
 */
export function redo(currentProject, applyFn) {
  if (_redoStack.length === 0) return;
  const next = _redoStack.pop();
  _snapshots.push(structuredClone(currentProject));
  applyFn(next);
}

/** How many undo steps are available. */
export function undoCount() {
  return _snapshots.length;
}

/** How many redo steps are available. */
export function redoCount() {
  return _redoStack.length;
}
