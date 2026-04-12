# Stretchy Studio — Project Overview & Status

**Last Updated:** 2026-04-12 · **Current Phase:** M6 Save/Load Project · **Next Phase:** M7 Spritesheet Export

---

## 1. Project Vision

Stretchy Studio is a 2D animation tool targeting illustrators and animators. Import PSD/PNG → group layers → pose on an After Effects-style timeline → export spritesheet. Simple, intuitive, end-to-end workflow.

**Key Design Principle:** Ship thin vertical slices. Every milestone leaves the app usable end-to-end.

### What's Different from Original Plan

The original design favored Live2D-style parameters and abstract deformers (complex UX). The revised approach is **timeline-first**:
- Dropped parameter system entirely
- Direct keyframing of transforms and mesh vertices
- After Effects workflow (not Live2D)
- Lower learning curve for 2D animators

---

## 2. Architecture

### Directory Layout

```
src/
  app/layout/              # 4-zone layout (canvas, layers, inspector, timeline)
  store/
    projectStore.js        # Scene tree (Nodes, Groups, Parts) + project state
    editorStore.js         # Selection, tool mode, viewport state
    animationStore.js      # [M4] CurrentTime, isPlaying, poseOverrides
    historyStore.js        # Undo/redo (skeleton, not yet integrated)
  renderer/
    transforms.js          # [M3] Matrix math & world matrix composition
    scenePass.js           # Transform pass + draw pass (hierarchical MVP)
    partRenderer.js        # VAO per part, vertex/UV/index management
    program.js, shaders/   # WebGL shader programs
  mesh/
    contour.js, sample.js, delaunay.js, generate.js, worker.js
  components/
    canvas/
      CanvasViewport.jsx   # Viewport + drag-drop, PSD auto-org modal
      GizmoOverlay.jsx     # [M3] Transform gizmo (move + rotate handles)
    layers/
      LayerPanel.jsx       # [M3] Depth & Groups tabs, drag-to-reparent
    inspector/
      Inspector.jsx        # [M3] Transform panel + mesh settings
    timeline/              # [M4] TrackRows, Keyframes, Playhead
  io/
    psd.js                 # ag-psd wrapper for layer extraction
    psdOrganizer.js        # [M3] Character format detection & auto-grouping
    export.js              # [M5] Spritesheet/Zip builder
```

### Data Model

```
Project
├── nodes: [
│   { id, type: 'part' | 'group', name, parent, visible, opacity },
│   { transform: {x, y, rotation, scaleX, scaleY, pivotX, pivotY} },
│   { draw_order (parts only) },
│   { mesh, meshOpts (parts only) }
│ ]
├── textures: { [nodeId]: blobUrl }
├── activeAnimationId: uuid (M4+)
└── animations: [{ id, name, duration, fps, tracks: [...] }] (M4+)
```

### Rendering Pipeline

1. **Transform Pass** (depth-first tree walk):
   - Compute world matrices: `parent.world × node.local`
   - Store transient `node._worldMatrix` for each node
2. **Draw Pass** (sorted by `draw_order`):
   - Per-part MVP = camera × worldMatrix
   - Render mesh, wireframe, vertices, overlays
   - Respects `visibility` and `opacity`

---

## 3. Completed Milestones

### ✅ M1 — Canvas Foundation (Completed)
- WebGL2 renderer skeleton with VAO per part
- PNG single-layer import & automatic triangulation
- Vertex dragging with undo/redo
- Basic viewport zoom/pan

### ✅ M2 — Auto Mesh & PSD Import (Completed)
- **PSD Import** (`ag-psd` wrapper): multi-layer extraction, layer names preserved, correct z-order
- **Mesh Generation Sliders**: Alpha threshold, smooth passes, grid spacing, edge padding, edge points
- **Per-Part Mesh Override**: Each layer can have custom mesh settings
- **Viewport Navigation**: Zoom-toward-cursor, Alt+drag pan, smooth controls
- **Manual Mesh Editing**: Add/remove vertex tools (no auto-retriangulation until remesh)
- **Layer Panel v1**: Names, visibility toggle, draw-order reorder buttons
- **Visibility Overlays**: Global toggles for image, wireframe, vertices, edge outline
- **Inspector Panel**: Overlay toggles, tool mode buttons, mesh settings, per-part opacity

### ✅ M3 — Groups & Hierarchical Transforms (Completed 2026-04-08)
- **Matrix Math Library** (`src/renderer/transforms.js`): 3×3 affine math, world matrix composition
- **Scene Graph**: Group nodes with transform inheritance, `reparentNode` action
- **Transform Gizmo** (`GizmoOverlay.jsx`): Drag move handle (translate) + rotation arc handle on canvas
- **Transform Inspector**: Numeric inputs for X, Y, Rotation (°), Scale (%), Pivot
- **Layer Panel Tabs**:
  - **Depth Tab**: Flat draw_order list with group-name chips, drag-to-reorder (squeeze behavior), right-click context menu
  - **Groups Tab**: Tree view, drag-to-reparent, collapsible groups with auto-expand on selection
- **PSD Auto-Organizer** (`psdOrganizer.js`):
  - **Character Format Detection**: Triggers if ≥4 layer names match a library of 23 recognized character tags (e.g., brow, iris, neckwear, topwear, footwear).
  - **Hierarchical Grouping**: Automatically nests layers into a structured **Head** (with an **Eyes** subgroup), **Body** (with **Upperbody** and **Lowerbody**), and **Extras** hierarchy.
  - **Preserved Draw Order**: Ensures that the original PSD layer depth is maintained within the new group structure, respecting the artist's manual sequencing.
- **Renderer Integration**: Per-part world matrices, hierarchical transforms work end-to-end
- **Mesh Generation Refinements** (`src/mesh/contour.js`, `src/mesh/generate.js`):
  - **Multi-seed contour tracing**: Traces all separated regions (eyes, arms, etc.) independently, not just the first one
  - **Boundary dilation**: Edge vertices placed 2px outside visual boundary → mesh covers full image content → texture alpha provides visual clip
  - **Per-contour vertex distribution**: Allocates `numEdgePoints` proportionally by perimeter across all detected regions
- **Iris Clipping** (`src/renderer/scenePass.js`):
  - **Stencil-based masking**: Irides are automatically clipped to their respective eyewhite layers.
  - **Side Matching**: Correctly matches `irides-l` to `eyewhite-l` (and -r/-r) using name suffixes to handle split-eye characters.
  - **Alpha-Aware Masks**: Uses shader-level `discard` to ensure clipping follows the visual shape of the eyewhite, even for mesh-less quad parts.
- **Bugs Fixed**: PSD opacity (was 0), mesh generation (concurrent workers), layer render order, depth tab drag behavior, mesh clipping (chord-shortcut effect), multi-part edge point coverage

**Exit Criteria Met:** Create group → parent layers → rotate group → children rotate around pivot. Depth tab unchanged. Groups tab drag reparents without affecting draw_order. Mesh now covers outer areas without clipping; multiple separated parts all get appropriate edge point coverage.

**M3 Refinement (Mesh-on-Demand Architecture):**
- **Auto-mesh removed:** Layers no longer generate mesh on import. Layers render as textured quads until user explicitly clicks "Generate Mesh" in Inspector.
- **Alpha-based selection:** Layer selection now uses alpha channel sampling instead of mesh intersection. Works for mesh-less parts; vertex proximity check still works when mesh exists.
- **Cropped bounding box:** Gizmo bounding box for mesh-less parts now crops to actual opaque pixels (computed once on import), not full image bounds.
- **Fallback quad rendering:** Each part gets a simple 2-triangle quad VAO for texture rendering without mesh. Replaced by actual mesh when user generates it.
- **Inspector changes:**
  - "Generate Mesh" button when no mesh; "Remesh" button when mesh exists
  - "Delete Mesh" option to revert to quad fallback
  - Mesh settings remain accessible for pre-configuration before generation
- **Benefits:** Faster import (no mesh gen), cleaner workflow (mesh as opt-in), lower memory footprint, better for M4 animation pipeline (easier keyframing without dense vertex data)

---

## 4. Upcoming Milestones

### ✅ M4 — Timeline & Animation Management (Completed 2026-04-11)
- **Editor Mode Toggle**: `Staging` (M3 setup) | `Animation` (M4 timeline) modes. Toggle located in top-left of canvas.
- **Timeline Interaction Engine**:
  - **Draggable Keyframes**: Left-click and drag diamond markers to adjust timing; snaps to integer frames.
  - **Multi-Selection & Box Select**: Shift-click to toggle, or drag a marquee box in the track background to select groups of keyframes.
  - **Group Move**: Move multiple selected keyframes at once, preserving relative timing.
  - **Clipboard (Ctrl+C/V)**: Copy-paste keyframes across different nodes or different times.
  - **Deletion**: Support for `Backspace`/`Delete` for group removal.
- **Animation Management Panel**:
  - **New Sidebar Section**: Dedicated "Animations" panel in the right sidebar below the Inspector.
  - **CRUD Operations**: Create new clips, switch active clip (auto-resets playhead), rename with edit pencil icon, and delete with confirmation modal.
- **Ruler & Loop Handling**:
  - **Draggable Loop Markers**: Ruler contains Start and End flags to visually define loop ranges.
  - **Transport Controls**: Play/Pause/Stop/Loop toggles with numeric FPS and current frame fields.
- **Playback & Interpolation**: 
  - Smooth transform lerping driven by the rAF loop.
  - Animation properties are separated from base node state via a `poseOverrides` map.
- **Mode-based UI Persistence**: Timeline and Animation panels automatically hide in `Staging` mode to keep the workspace clean for mesh setup.
- **UI UX Polish**: Alt+Scroll zooming for horizontal scale, native overflow for panning.

**Exit Criteria Met:** User can import PSD, setup groups, switch to Animation mode, create multiple clips ("Idle", "Walk"), pose with draggable keyframes, copy-paste poses between nodes, and play back loops smoothly. 

---

### ✅ M5 — Armature Auto-Rig & Skeleton Animation (Completed 2026-04-12)
 
 **Goal:** Enable rigging of see-through PSD characters for vtuber-style animation via both heuristic and AI-powered skeleton detection.

 - **PSD Import Wizard** (Added 2026-04-12):
   - **3-Step Flow**: Choose rigging method → Load/estimate skeleton → Adjust joints on canvas before finalizing
   - **Step 1 (Choose)**: User selects:
     - *Rig manually*: Fast heuristic skeleton from layer bounding boxes (no download)
     - *Rig with DWPose*: High-accuracy AI pose detection (~50MB model)
     - *Skip rigging*: Import flat, no skeleton
   - **Step 2 (Load/Estimate)**: 
     - Manual path: Instantly estimates skeleton via `estimateSkeletonFromBounds()`
     - DWPose path: Shows model status, upload .onnx or download from HuggingFace
   - **Step 3 (Adjust)**: Full-canvas joint adjustment with floating toolbar
     - Draggable yellow joint circles to reposition skeleton
     - Back button: Reverts project snapshot, returns to choose step (at any time before Finish)
     - Finish button: Commits the rig and closes wizard

 - **Heuristic Skeleton Estimation** (`src/io/armatureOrganizer.js`, new `estimateSkeletonFromBounds`):
   - Maps layer bounding boxes to keypoints: head from `face`/`front hair` bounds, shoulders from `topwear`, arms/legs interpolated
   - Falls back to sensible defaults if layers are missing
   - Zero external dependencies; runs instantly on import

 - **DWPose ONNX Integration** (`src/io/armatureOrganizer.js`):
   - Load and cache DWPose session (dw-ll_ucoco_384.onnx) from HuggingFace CDN
   - 133-keypoint pose detection with SimCC output format
   - Keypoint mapping to character skeleton: neck, waist, shoulder midpoint, and limb joints (elbows/knees)

- **Limb Bending & Vertex Skinning** (Added 2026-04-12):
  - **Axis-Aware Weighting**: Vertices in limb layers (arms/legs) are automatically assigned weights by projecting them onto the shoulder-elbow or hip-knee axis. 
  - **JS-Driven Skinning**: Elbow and knee rotations locally deform mesh vertices in real-time via a custom skinning engine in `SkeletonOverlay.jsx`.
  - **Auto-Keyframing**: Keyframing a limb joint automatically captures the deformed vertex positions for the associated part.
   
 - **Armature Node Builder**:
  - Create hierarchical bone structure: `root → torso → head → eyes`, `root → [left/right]Leg → [left/right]Knee`, `torso → [left/right]Arm → [left/right]Elbow`
   - All bones are group nodes with `boneRole` property
   - Joint positions stored as `transform.pivotX/Y` (no new data types needed)
   
 - **Skeleton Overlay & Deformation** (`src/components/canvas/SkeletonOverlay.jsx`):
   - SVG overlay showing bone lines (cyan) and joint circles
   - **Skeleton Edit Mode** (staging only):
     - Draggable joint dots to reposition bone pivots
     - Click joint circle to select bone → GizmoOverlay appears for fine-tuning
     - In animation mode: rotation written to draftPose; press K to keyframe
     - **Limb Rotation Handles**: Amber arcs at elbows and knees trigger JS-driven vertex deformation.
     - **Skinning Commit**: In staging mode, limb rotations commit deformed vertices directly to the base mesh on release.
   - **2D Iris Trackpad** (Added 2026-04-11):
     - Dedicated 80x80px square trackpad for the `eyes` bone
     - Positioned -120px above the head to maintain clear view of expressions
 
 **Exit Criteria Met:** 
 - Import see-through PSD → 3-step import wizard appears
 - **Manual path**: Choose "Rig manually" → skeleton instantly estimated → adjust joints on canvas → Finish
 - **DWPose path**: Choose "Rig with DWPose" → download/upload model → DWPose runs → adjust joints → Finish
 - **Back anytime**: From adjust step, click Back → project reverts to pre-rig state, wizard reopens at choose step
 - **Animation**: Switch to animation mode → drag arcs + press K to keyframe → scrub timeline → character animates with bone rotations and smooth limb bending

**Key Design Decisions:**
- Bones ARE group nodes (no new structure), pivots ARE joint positions (no extra fields)
- Heuristic rigging requires no external dependencies; useful when network is unavailable
- Single ONNX session cached module-level to avoid re-download
- World matrices recomputed in SkeletonOverlay each frame to handle animation state correctly
- Project snapshots enable Back functionality: snapshot saved before finalizePsdImport, restored on Back button
- Floating toolbar (not modal) for adjust step keeps canvas live and interactive during joint fine-tuning

---

### ✅ M6 — Save/Load Project (.stretch Format) (Completed 2026-04-12)

**Goal:** Enable persistent project storage so users can save work and reload it later.

**Implementation:**
- **.stretch file format**: ZIP archive containing project.json + textures/ folder with PNG files
- **UI buttons**: Download (💾) and Upload (📁) icons in top-left canvas toolbar
- **Serialization** (`src/io/projectFile.js`):
  - `saveProject(project)` → fetches textures from blob URLs, exports as ZIP with relative texture paths
  - `loadProject(file)` → reads ZIP, parses project.json, loads PNG textures, restores typed arrays (Float32Array, Set)
- **Store integration** (`src/store/projectStore.js`):
  - `loadProject(projectData)` action replaces entire project state and bumps version counters
- **GPU re-upload** (`CanvasViewport.jsx`):
  - Clear old GPU resources with `destroyAll()`
  - Rebuild `imageDataMapRef` for alpha-based picking
  - Re-upload textures with `uploadTexture()`
  - Restore meshes with `uploadMesh()` or `uploadQuadFallback()`
  - Reset editor selection and animation playback state

**What Gets Saved:**
- ✅ Canvas dimensions, node hierarchy (parts + groups)
- ✅ Layer names, visibility, opacity, transforms (position, rotation, scale, pivot)
- ✅ Mesh geometry (vertices, triangles, UVs, edge indices) + mesh settings
- ✅ Bounding boxes (imageBounds, imageWidth, imageHeight)
- ✅ Skeleton rigging (boneRole, skinWeights)
- ✅ All textures as PNG files
- ✅ All animations (clips, keyframes, easing, including mesh_verts deformation)

**What Does NOT Get Saved:**
- ❌ Editor state (selection, tool mode, viewport zoom/pan)
- ❌ Animation playback state (currentTime, isPlaying)
- ❌ Draft poses (uncommitted edits)
- ❌ Undo/redo history

**Type Conversions:**
- `Float32Array` (mesh.uvs) → JSON Array on save, restored on load
- `Set` (mesh.edgeIndices) → JSON Array on save, stays as Array (renderer handles both)
- Blob URLs (textures) → PNG files in ZIP on save, new blob URLs on load
- `ImageData` (picking) → not stored, recomputed from textures on load

**Exit Criteria Met:**
- ✅ Save project → .stretch file downloads with valid ZIP structure
- ✅ Load project → all layers render with correct hierarchy and transforms
- ✅ Load project → meshes + mesh_verts keyframes interpolate correctly
- ✅ Load project → skeleton animations play back with bone rotations
- ✅ Load project → editor functions (picking, gizmo, mesh editing) work immediately

**File Format Details:**
See `docs/save_load_implementation.md` for complete schema, error handling, and performance characteristics.

**Performance:**
- Save time: 200–500ms (texture fetch + ZIP compression)
- Load time: 500ms–2s (ZIP read + PNG decode + GPU upload)
- File size: 40–60% of base64-JSON approach

---

### M7 — Physics

**Goal:** Spring physics for secondary motion (hair, cloth).

**What to build:**
- **Physics Group**: Ordered chain of groups/parts with gravity, stiffness, damping, wind
- **Verlet Integrator**: Runs on rAF alongside playback, applies offsets on top of animated pose
- **Physics Inspector**: Add/remove chain nodes, tweak parameters
- **Play Modes**:
  - Preview (P key): animation + live physics
  - Bake: writes physics results as keyframes (destructive, undoable)

**Exit Criteria:** Attach physics to hair → Press Play → hair jiggles with gravity.

---

### M8 — Spritesheet Export (Deferred Post-M7)
- **GIF**: `gif.js` worker (MIT, popular)
- **WebM**: MediaRecorder API on canvas stream
- Builds on frame renderer from M6

---

## 5. What's Dropped from Original Plan

| Feature | Status | Reason |
|---------|--------|--------|
| Parameter system | **Dropped** | Replaced by direct keyframing (lower learning curve) |
| Armed recording mode | **Dropped** | Part of parameter system |
| Warp deformer 5×5 grid | **Dropped** | Direct vertex keyframes more flexible & intuitive |
| Path deformer | **Dropped** | Scope reduction |
| `.stretch` format + atlas packer | **Deferred** | Spritesheet export covers immediate need |
| 2D parameter grids | **Dropped** | Out of scope |
| Standalone player library | **Deferred** | No immediate use case |

---

## 6. Key Architecture Notes

### Mesh-on-Demand with Quad Fallback
- **No auto-mesh on import:** Parts initially render with a simple 2-triangle textured quad (`uploadQuadFallback`). No GPU cost for mesh generation.
- **Lazy mesh generation:** User clicks "Generate Mesh" in Inspector → `dispatchMeshWorker` computes mesh → `uploadMesh` replaces quad with actual mesh.
- **Delete reverts fallback:** User clicks "Delete Mesh" → `uploadQuadFallback` restores quad, `node.mesh = null`.
- **Quad has no edges:** Edge indices empty for fallback quad (no green wireframe visualization). Once mesh generated, edges show.

### Alpha-Based Selection (M3 Refinement)
- **ImageData caching:** Each part's `ImageData` stored in `imageDataMapRef` during import for fast alpha sampling.
- **Bounds computation:** `computeImageBounds(imageData)` scans for opaque pixels (alpha > 10), returns `{minX, minY, maxX, maxY}`. Cached on node as `imageBounds`.
- **Click handling:** `sampleAlpha(imageData, lx, ly)` returns alpha at pixel. Hit-test loop checks alpha (no mesh required). Vertex proximity check still works when mesh exists.
- **Gizmo bounding box:** Uses `node.imageBounds` for mesh-less parts, `node.mesh.vertices` for meshed parts.

### Pose Separation
During playback, interpolated values go into `animationStore.poseOverrides` (a Map of `nodeId → {x, y, rotation, ...}`). The renderer reads overrides instead of `projectStore` values. This avoids polluting the project model with playback state.

### Mesh Warp Keyframes
Stored as `Float32Array` snapshots of vertex positions. Lerped per-vertex during playback. The renderer's `PartRenderer.uploadPositions()` hot-path updates GPU buffers on each frame.

### Transform Composition
World matrices computed each frame from node tree + pose overrides. No caching in M3 (simple scenes work fine). Caching can be added in M4+ if perf requires.

### State Management
- `projectStore`: Persistent project model (nodes, transforms, textures). **New fields:** `imageWidth`, `imageHeight`, `imageBounds` for mesh-less parts.
- `editorStore`: UI state (selection, tool mode, viewport, activeLayerTab)
- `animationStore`: Playback state (currentTime, isPlaying, poseOverrides) — separate to keep concerns isolated
- `historyStore`: Undo/redo skeleton (not yet integrated into UI workflows)

---

## 7. Current Project Statistics

| Metric | Value |
|--------|-------|
| **Status** | M6 Complete (Save/Load .stretch format); M7 Spritesheet Export in design phase |
| **Files Modified/Created** | 25+ (added: projectFile.js + save/load handlers; modified: projectStore.js, CanvasViewport.jsx) |
| **Line Count** (core) | ~4900 (renderer + store + UI + animation + armature + io + serialization) |
| **Bundle Size** | 1.08 MB minified, 327 KB gzipped (includes onnxruntime-web WASM; JSZip ~17 KB) |
| **Performance** | 60 fps with rigged character + animation; Save: 200–500ms; Load: 500ms–2s |
| **Main Dependencies** | ag-psd (~120 KB), onnxruntime-web (~25 MB WASM), jszip (^3.10.1), WebGL2 |
| **Import/Export Speed** | Manual rig: instant; DWPose rig: ~2–3s; Project save: ~300ms; Project load: ~1s |

---

## 8. Known Limitations

- **No undo/redo yet:** All changes immediate (M5 feature)
- **No hierarchical visibility culling:** Hidden parent's children still participate in picking (minor)
- **No transform inheritance preview:** Gizmo shows local axes only
- **Groups have no visual appearance:** Containers only (intentional; may revisit M5+)
- **Remesh lag:** Large images (>2048px) can freeze UI for ~500ms (acceptable per spec)
- **PSD edge cases:** CMYK, smart objects, layer effects, complex blend modes not fully validated
- **Mesh dilation:** Edge vertices are placed 2px outside alpha boundary for chord-shortcut coverage. Very thin features (<4px) may slightly extend beyond visual boundary before texture alpha clips (acceptable trade-off for reliable full-image coverage)
- **Bounds computation:** Alpha-based bounding box computed once at import (threshold = 10). Very faint semi-transparent edges may be excluded. Can be refined in future if needed.

---

## 8b. M4 Animation Bugs Fixed

### Issue: Brush Deform & Layer Selection Fail on Animated Nodes
**Root Cause:** In `CanvasViewport.onPointerDown`, world matrices were computed from `proj.nodes` (raw stored transforms) instead of the effective transforms (keyframe interpolation + draft pose overlays). This made `iwm` (inverse world matrix) wrong for any node with animation applied, breaking:
1. **Brush hit-testing:** Brush couldn't select/deform vertices on animated meshes
2. **Layer selection:** Couldn't click on parts that had been moved by keyframes (had to click original position)
3. **Vertex picking:** Single-vertex drag wouldn't register on animated nodes

**Fix:** Build `effectiveNodes` at the start of `onPointerDown` by merging animation overrides (keyframe values + draft pose) into the base node transforms. Compute `worldMatrices` and `sortedParts` from `effectiveNodes` instead of raw `proj.nodes`. This ensures:
- `iwm` converts mouse coords to the correct local space (where the visuals actually are)
- Vertex picking uses effective vertex positions (draft mesh_verts → keyframe mesh_verts → base mesh)
- Layer alpha-based selection hits the animated bounding box

**Code Location:** `src/components/canvas/CanvasViewport.jsx`, lines ~668–693 (effectiveNodes construction) and lines ~820–845 (vertex picking).

### Issue: Mesh Deform Keyframes Baked Base Mesh
**Root Cause:** Brush drag always called `updateProject`, writing deformed vertices directly into `node.mesh.vertices` (the base mesh) regardless of animation mode. Pressing K then captured the already-modified base, not a keyframe delta.

**Fix:** In animation mode + deform sub-mode, brush drag writes to `animRef.current.setDraftPose(partId, { mesh_verts })` instead of calling `updateProject`. Draft pose is overlaid on top of keyframe values during render and picking. When K is pressed, the effective verts (draft → keyframe → base) are read and inserted as a keyframe. `clearDraftPoseForNode` then reverts visual to the keyframe value. Scrubbing or stopping clears all drafts.

**Code Location:** `src/components/canvas/CanvasViewport.jsx`, lines ~876–885 (brush drag reroute).

### Issue: Group Hierarchy Keyframes Applied Globally
**Root Cause:** When a parent group had a keyframe at frame 1, and a child had its own keyframe at frame 12, the child's initial position (frame 0–11) would snap to match the parent keyframe instead of inheriting smoothly. This was because rest pose wasn't being captured.

**Fix:** Add `captureRestPose(nodes)` call when entering animation mode (M4 future work). Store unmodified node transforms in `animationStore.restPose`. When inserting the first keyframe for a track beyond `startFrame`, auto-insert the rest-pose value at `startFrame`. This ensures interpolation from frame 0 works correctly with group hierarchy — children inherit their base position until their own keyframes kick in.

**Code Location:** `src/renderer/animationEngine.js` (rest pose logic), `src/store/animationStore.js` (captureRestPose action), `src/components/canvas/CanvasViewport.jsx` (K handler, lines ~297–303).

---

## 9. Testing Checklist

✅ PNG import → single layer renders without mesh (quad fallback)  
✅ PSD import → all layers with correct names & z-order, no mesh by default  
✅ Character format detection → auto-creates Head (with Eyes), Body (with Upper/Lowerbody), and Extras groups while preserving the original draw order  
✅ Group creation → new group node with default transform  
✅ Transform gizmo → drag move/rotate handles; bounding box crops to opaque pixels  
✅ Inspector numeric inputs → live canvas updates  
✅ Depth tab drag → reorder by draw_order (squeeze behavior)  
✅ Groups tab drag → reparent (only mutates parent)  
✅ Visibility toggle → per-node show/hide  
✅ Layer selection → alpha-based picking (works without mesh)  
✅ Generate Mesh button → creates mesh, button changes to "Remesh"  
✅ Delete Mesh button → removes mesh, reverts to quad fallback  
✅ Add/remove vertex → requires mesh; correct world-space picking on transformed parts  
✅ Vertex drag → moves in local space while tracking world motion  
✅ Gizmo bounding box → matches opaque pixels for mesh-less parts, mesh vertices for meshed parts  

---

## 10. Next Steps

1. **M7 Spritesheet Export** (next sprint):
   - Frame capture loop (offscreen WebGL canvas, gl.readPixels per frame)
   - Spritesheet packing (shelf-pack into power-of-2 atlas)
   - Export settings UI (animation clip dropdown, FPS override, background toggle)
   - Zip output or spritesheet + JSON atlas (Phaser/Unity/Godot compatible)

2. **M8+ Advanced**:
   - Physics simulation (spring chains for hair/cloth)
   - GIF/video export
   - Undo/redo integration
   - Blend modes, clipping masks

---

**Project Lead:** Nguyen Phan  
**Quality:** M6 complete (save/load working end-to-end); architecture solid for M7+ progression
