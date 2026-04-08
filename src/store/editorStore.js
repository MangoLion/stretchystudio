import { create } from 'zustand';

// Editor state (UI state, selection, view transform, drag state)
export const useEditorStore = create((set) => ({
  selection: [], // array of node IDs
  toolMode: 'select', // 'select' | 'add_vertex' | 'remove_vertex'

  view: {
    zoom: 1,
    panX: 0,
    panY: 0,
  },

  dragState: {
    isDragging: false,
    partId: null,
    vertexIndex: null,
  },

  armedParameterId: null,

  /** Per-scene overlay toggles (global, not per-part) */
  overlays: {
    showImage:       true,
    showWireframe:   false,
    showVertices:    false,
    showEdgeOutline: false,
  },

  /** Default mesh generation parameters (used when no per-part override) */
  meshDefaults: {
    alphaThreshold: 20,
    smoothPasses:   3,
    gridSpacing:    30,
    edgePadding:    8,
    numEdgePoints:  80,
  },

  /** Active tab in the Layers panel: 'depth' (draw order) or 'groups' (hierarchy) */
  activeLayerTab: 'depth',

  setSelection:         (nodeIds)  => set({ selection: nodeIds }),
  setView:              (view)     => set((state) => ({ view: { ...state.view, ...view } })),
  setToolMode:          (mode)     => set({ toolMode: mode }),
  setDragState:         (ds)       => set((state) => ({ dragState: { ...state.dragState, ...ds } })),
  setArmedParameterId:  (id)       => set({ armedParameterId: id }),
  setOverlays:          (partial)  => set((state) => ({ overlays: { ...state.overlays, ...partial } })),
  setMeshDefaults:      (partial)  => set((state) => ({ meshDefaults: { ...state.meshDefaults, ...partial } })),
  setActiveLayerTab:    (tab)      => set({ activeLayerTab: tab }),
}));
