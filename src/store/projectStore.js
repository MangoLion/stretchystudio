import { create } from 'zustand';
import { produce } from 'immer';

function uid() { return Math.random().toString(36).slice(2, 9); }

export const DEFAULT_TRANSFORM = () => ({
  x: 0, y: 0,
  rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

// Project store (The .stretch model, undoable)
export const useProjectStore = create((set) => ({
  project: {
    version: "0.1",
    canvas: { width: 800, height: 600 },
    textures: [],     // { id, source (data URI or Blob URL) }
    nodes: [],        // flat array — see node schemas below
    /*
      Node schema (type === 'part'):
      {
        id:         string,
        type:       'part',
        name:       string,
        parent:     string | null,      // id of parent group, or null
        draw_order: number,
        opacity:    number (0–1),
        visible:    boolean,
        clip_mask:  string | null,
        transform:  { x, y, rotation, scaleX, scaleY, pivotX, pivotY },
        meshOpts:   { alphaThreshold, smoothPasses, gridSpacing, edgePadding, numEdgePoints } | null,
        mesh:       { vertices, uvs, triangles, edgeIndices } | null,
      }

      Node schema (type === 'group'):
      {
        id:         string,
        type:       'group',
        name:       string,
        parent:     string | null,
        opacity:    number (0–1),
        visible:    boolean,
        transform:  { x, y, rotation, scaleX, scaleY, pivotX, pivotY },
        // NO draw_order — groups are never drawn directly.
        // Render order is determined solely by part.draw_order values.
      }
    */
    parameters: [],
    physics_groups: [],
    animations: [],
  },

  // Versions used to trigger rendering passes independently of React
  versionControl: {
    geometryVersion: 0,
    transformVersion: 0,
    textureVersion: 0,
  },

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Generic immer recipe — use for all undoable project edits */
  updateProject: (recipe) => set(produce((state) => {
    recipe(state.project, state.versionControl);
  })),

  /** Create a new empty group node */
  createGroup: (name) => set(produce((state) => {
    state.project.nodes.push({
      id:        uid(),
      type:      'group',
      name:      name ?? 'Group',
      parent:    null,
      transform: DEFAULT_TRANSFORM(),
      visible:   true,
      opacity:   1,
    });
    state.versionControl.transformVersion++;
  })),

  /**
   * Reparent a node to a new parent (or to root if newParentId is null).
   * Never touches draw_order.
   */
  reparentNode: (nodeId, newParentId) => set(produce((state) => {
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (node) node.parent = newParentId ?? null;
    state.versionControl.transformVersion++;
  })),
  /**
   * Animation CRUD
   */
  createAnimation: (name) => set(produce((state) => {
    const id = uid();
    state.project.animations.push({
      id,
      name:     name ?? `Animation ${state.project.animations.length + 1}`,
      duration: 2000,
      fps:      24,
      tracks:   [],
    });
  })),

  renameAnimation: (id, newName) => set(produce((state) => {
    const anim = state.project.animations.find(a => a.id === id);
    if (anim) anim.name = newName;
  })),

  deleteAnimation: (id) => set(produce((state) => {
    state.project.animations = state.project.animations.filter(a => a.id !== id);
  })),

  /** Reset project to empty state */
  resetProject: () => set(produce((state) => {
    state.project.canvas   = { width: 800, height: 600 };
    state.project.textures = [];
    state.project.nodes    = [];
    state.project.parameters = [];
    state.project.physics_groups = [];
    state.project.animations = [];
    state.versionControl.geometryVersion++;
    state.versionControl.transformVersion++;
    state.versionControl.textureVersion++;
  })),

  /** Load a deserialized project from file */
  loadProject: (projectData) => set(produce((state) => {
    state.project.version = projectData.version;
    state.project.canvas = projectData.canvas;
    state.project.textures = projectData.textures;
    state.project.nodes = projectData.nodes;
    state.project.animations = projectData.animations ?? [];
    state.project.parameters = projectData.parameters ?? [];
    state.project.physics_groups = projectData.physics_groups ?? [];
    state.versionControl.geometryVersion++;
    state.versionControl.transformVersion++;
    state.versionControl.textureVersion++;
  })),
}));
