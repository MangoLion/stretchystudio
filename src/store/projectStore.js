import { create } from 'zustand';
import { produce } from 'immer';
import { pushSnapshot, isBatching, clearHistory } from '@/store/undoHistory';

function uid() { return Math.random().toString(36).slice(2, 9); }

/**
 * Deep clone an object, preserving TypedArrays.
 * Safe for use with Immer draft proxies.
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Float32Array) return new Float32Array(obj);
  if (obj instanceof Uint16Array) return new Uint16Array(obj);
  if (obj instanceof Uint32Array) return new Uint32Array(obj);
  if (Array.isArray(obj)) return obj.map(deepClone);
  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

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
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' },
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
        blendShapes: [{ id, name, deltas: [{dx, dy}] }] | null,
        blendShapeValues: { [shapeId]: number (0–1) },             // staging-mode influences
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

  hasUnsavedChanges: false,

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Generic immer recipe — use for all undoable project edits.
   *  Auto-snapshots before mutation unless { skipHistory: true } is passed. */
  updateProject: (recipe, { skipHistory = false } = {}) => set((state) => {
    let hasUnsavedChanges = state.hasUnsavedChanges;
    if (!skipHistory && !isBatching()) {
      pushSnapshot(state.project);
      hasUnsavedChanges = true;
    }
    return produce((state) => {
      state.hasUnsavedChanges = hasUnsavedChanges;
      recipe(state.project, state.versionControl);
    })(state);
  }),

  setHasUnsavedChanges: (val) => set({ hasUnsavedChanges: val }),

  /** Create a new empty group node */
  createGroup: (name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
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
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (node) node.parent = newParentId ?? null;
    state.versionControl.transformVersion++;
  })),
  /**
   * Animation CRUD
   */
  createAnimation: (name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const id = uid();
    state.project.animations.push({
      id,
      name:        name ?? `Animation ${state.project.animations.length + 1}`,
      duration:    2000,
      fps:         24,
      tracks:      [],
      audioTracks: [],
    });
  })),

  renameAnimation: (id, newName) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const anim = state.project.animations.find(a => a.id === id);
    if (anim) anim.name = newName;
  })),

  deleteAnimation: (id) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    state.project.animations = state.project.animations.filter(a => a.id !== id);
  })),

  /** Create a new blend shape on a part node */
  createBlendShape: (nodeId, name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node || !node.mesh) return;
    const id = uid();
    const deltas = node.mesh.vertices.map(() => ({ dx: 0, dy: 0 }));
    if (!node.blendShapes) node.blendShapes = [];
    if (!node.blendShapeValues) node.blendShapeValues = {};
    node.blendShapes.push({ id, name: name ?? 'Key', deltas });
    node.blendShapeValues[id] = 0;
    state.versionControl.geometryVersion++;
  })),

  /** Delete a blend shape from a part node */
  deleteBlendShape: (nodeId, shapeId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node) return;
    if (node.blendShapes) {
      node.blendShapes = node.blendShapes.filter(s => s.id !== shapeId);
    }
    if (node.blendShapeValues) {
      delete node.blendShapeValues[shapeId];
    }
    state.versionControl.geometryVersion++;
  })),

  /** Set the influence value of a blend shape in staging mode */
  setBlendShapeValue: (nodeId, shapeId, value) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (node && node.blendShapeValues) {
      node.blendShapeValues[shapeId] = Math.max(0, Math.min(1, value));
      state.versionControl.geometryVersion++;
    }
  })),

  /** Update the deltas of a blend shape (used by edit mode brush) */
  updateBlendShapeDeltas: (nodeId, shapeId, deltas) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const shape = node.blendShapes?.find(s => s.id === shapeId);
    if (shape) {
      shape.deltas = deltas;
      state.versionControl.geometryVersion++;
    }
  })),

  /** Reset project to empty state */
  resetProject: () => {
    clearHistory();
    return set(produce((state) => {
      state.project.canvas   = { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' };
      state.project.textures = [];
      state.project.nodes    = [];
      state.project.parameters = [];
      state.project.physics_groups = [];
      state.project.animations = [];
      state.versionControl.geometryVersion++;
      state.versionControl.transformVersion++;
      state.versionControl.textureVersion++;
      state.hasUnsavedChanges = false;
    }));
  },

  /** Load a deserialized project from file */
  loadProject: (projectData) => {
    clearHistory();
    return set(produce((state) => {
      state.project.version = projectData.version;
      state.project.canvas = {
        width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff',
        ...projectData.canvas,
      };
      state.project.textures = projectData.textures;
      // Ensure blend shapes fields exist on all nodes (forward-compat with old files)
      const nodes = projectData.nodes ?? [];
      for (const node of nodes) {
        if (node.blendShapes === undefined) node.blendShapes = [];
        if (node.blendShapeValues === undefined) node.blendShapeValues = {};
      }
      state.project.nodes = nodes;
      state.project.animations = projectData.animations ?? [];
      state.project.parameters = projectData.parameters ?? [];
      state.project.physics_groups = projectData.physics_groups ?? [];
      state.versionControl.geometryVersion++;
      state.versionControl.transformVersion++;
      state.versionControl.textureVersion++;
      state.hasUnsavedChanges = false;
    }));
  },

  /** Update canvas properties */
  updateCanvas: (partial) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    Object.assign(state.project.canvas, partial);
  })),

  /**
   * Recursively duplicate a node and its children.
   * Also duplicates animation tracks.
   */
  duplicateNode: (nodeId) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);

    return produce(state, (draft) => {
      draft.hasUnsavedChanges = true;
      const proj = draft.project;
      const idsToMap = new Map(); // oldId -> newId

      function doDuplicate(id, parentId) {
        const original = proj.nodes.find(n => n.id === id);
        if (!original) return null;

        const newId = uid();
        idsToMap.set(id, newId);

        const newNode = deepClone(original);
        newNode.id = newId;
        newNode.parent = parentId;
        newNode.name = original.name + ' Copy';

        // For parts, handle draw_order and texture duplication
        if (original.type === 'part') {
          // Texture entry
          const originalTex = proj.textures.find(t => t.id === id);
          if (originalTex) {
            proj.textures.push({
              ...originalTex,
              id: newId
            });
          }

          // Increment draw_order of all parts that are currently at or above the original's draw order
          proj.nodes.forEach(n => {
            if (n.type === 'part' && n.draw_order > original.draw_order) {
              n.draw_order++;
            }
          });
          newNode.draw_order = original.draw_order + 1;
        }

        // Insert into flat nodes array
        proj.nodes.push(newNode);

        // Recursively duplicate children
        const children = proj.nodes.filter(n => n.parent === id && !idsToMap.has(n.id));
        for (const child of children) {
          doDuplicate(child.id, newId);
        }
        return newId;
      }

      const rootNode = proj.nodes.find(n => n.id === nodeId);
      if (!rootNode) return;

      doDuplicate(nodeId, rootNode.parent);

      // Duplicate animation tracks for all duplicated nodes
      for (const [oldId, newId] of idsToMap) {
        for (const anim of proj.animations) {
          const tracks = anim.tracks.filter(t => t.nodeId === oldId);
          for (const track of tracks) {
            anim.tracks.push({
              ...deepClone(track),
              nodeId: newId,
            });
          }
        }
      }

      draft.versionControl.transformVersion++;
      draft.versionControl.geometryVersion++;
    });
  }),

  /**
   * Recursively delete a node and all its children.
   * Also cleans up animation tracks.
   */
  deleteNode: (nodeId) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);

    return produce(state, (draft) => {
      draft.hasUnsavedChanges = true;
      const proj = draft.project;
      const idsToDelete = new Set();

      function collectRecursive(id) {
        idsToDelete.add(id);
        const children = proj.nodes.filter(n => n.parent === id);
        for (const child of children) {
          collectRecursive(child.id);
        }
      }

      collectRecursive(nodeId);

      // Remove nodes
      proj.nodes = proj.nodes.filter(n => !idsToDelete.has(n.id));

      // Remove textures
      proj.textures = proj.textures.filter(t => !idsToDelete.has(t.id));

      // Remove animation tracks
      for (const anim of proj.animations) {
        anim.tracks = anim.tracks.filter(t => !idsToDelete.has(t.nodeId));
      }

      // Re-normalize draw_order for remaining parts to ensure no gaps (optional but clean)
      const remainingParts = proj.nodes
        .filter(n => n.type === 'part')
        .sort((a, b) => a.draw_order - b.draw_order);
      
      remainingParts.forEach((p, i) => {
        p.draw_order = i;
      });

      draft.versionControl.transformVersion++;
      draft.versionControl.geometryVersion++;
    });
  }),
}));
