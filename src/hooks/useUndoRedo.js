/**
 * useUndoRedo — global keyboard handler for Ctrl+Z / Ctrl+Y.
 *
 * Snapshot-based undo using full project clones.
 * History management delegated to undoHistory.js.
 */
import { useEffect, useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { undo, redo } from '@/store/undoHistory';

export function useUndoRedo() {
  const updateProject = useProjectStore(s => s.updateProject);
  const projectRef    = useRef(null);

  useEffect(() => {
    return useProjectStore.subscribe((state) => {
      projectRef.current = state.project;
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      const ctrl = e.ctrlKey || e.metaKey;

      if (!ctrl) return;

      if (isZ && !e.shiftKey) {
        // Undo
        e.preventDefault();
        undo(projectRef.current, (snapshot) => {
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
      } else if (isY || (isZ && e.shiftKey)) {
        // Redo
        e.preventDefault();
        redo(projectRef.current, (snapshot) => {
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateProject]);
}
