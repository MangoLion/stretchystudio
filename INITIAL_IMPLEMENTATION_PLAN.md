# Stretchy Studio — Initial Implementation Plan

**Status:** Planning · **Date:** 2026-04-07 · **Target:** v0.1 (M1–M2 foundations)

This document translates the [design brief](docs/design_brief.md) into a concrete, incremental engineering plan tailored to the current Vite + React + shadcn repo. It assumes the existing prototype code documented in [MESH_DEFORM_DOCUMENTATION.md](docs/MESH_DEFORM_DOCUMENTATION.md) and [INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md) is the starting point for the mesh subsystem.

---

## 1. Guiding Principles

1. **Ship a thin vertical slice first.** Import → mesh → render → drag → save. Every milestone should leave the app usable end-to-end, not half-built horizontally.
2. **Renderer-first thinking.** The scene graph and renderer are the spine; UI panels are leaves. Build the data model before the panels that edit it.
3. **Prototype code is reference, not foundation.** The Canvas2D prototype proves the algorithms work. The real renderer is WebGL2 (per design brief §5.1) and the data model must be multi-layer and parameter-driven from day one — not retrofitted later.
4. **State lives in Zustand, not in component refs.** The prototype's class-based `MeshDeformer` becomes a pure data layer + selectors. React components only render and dispatch.
5. **No premature abstraction.** Don't build a plugin system, don't generalize deformers behind interfaces until we have at least two working types.

---

## 2. Gap Analysis: Prototype → v0.1

| Concern | Prototype | v0.1 Target | Gap |
|---|---|---|---|
| Renderer | Canvas2D, per-triangle clip + affine | WebGL2, VAO per part, mesh shader | Full rewrite of draw path |
| Scene model | Single image, flat vertex array | Tree of nodes (parts, groups, deformers) | New data layer |
| Mesh gen | Moore-neighbor + jittered grid + Bowyer-Watson | Same algorithms acceptable for v0.1; OpenCV WASM deferred | Wrap into worker; keep pure-JS |
| Input format | Single PNG | PSD + multi-PNG | psd.js integration |
| State | Class instance | Zustand store + immer | Port logic |
| Interaction | Drag vertex | Drag vertex, deformer control points, parameter recording | Layered on top |
| Persistence | `toJSON`/`fromJSON` of one mesh | `.stretch` zip | JSZip + atlas packer |

The prototype's algorithms (`traceContour`, `resampleContour`, `smoothContour`, `sampleInterior`, `delaunay`) are reusable as **pure functions in a `mesh/` module**. The class wrapper, Canvas2D drawing, and DOM event handlers are not.

---

## 3. Target Architecture

### 3.1 Directory Layout

```
src/
  app/                    # App shell, routing, providers
    App.jsx
    layout/               # 4-zone layout (canvas, layers, inspector, timeline)
  store/                  # Zustand stores
    projectStore.js       # Scene tree, parameters, animations (the .stretch model)
    editorStore.js        # Selection, tool mode, viewport, ephemeral UI state
    historyStore.js       # Undo/redo (immer patches)
  scene/                  # Pure data model — no React, no DOM
    nodes.js              # Node factories, type guards
    tree.js               # Tree ops: walk, reparent, ancestors, descendants
    transform.js          # Matrix stack, world-transform computation
    parameters.js         # Param resolution, keyed-state interpolation
  mesh/                   # Pure algorithms (port from prototype)
    contour.js            # traceContour, resampleContour, smoothContour
    sample.js             # sampleInterior, filterByEdgePadding
    delaunay.js           # Bowyer-Watson
    generate.js           # Orchestrator: image -> {vertices, uvs, triangles}
    worker.js             # Web Worker entry (mesh gen off main thread)
  renderer/               # WebGL2
    gl.js                 # Context, capability checks
    shaders/
      mesh.vert
      mesh.frag
    program.js            # Compile/link helpers
    partRenderer.js       # VAO per part, vertex buffer upload
    scenePass.js          # Transform pass + draw pass
    stencilMask.js        # Clipping mask via stencil
  io/
    psd.js                # psd.js wrapper -> normalized layer list
    png.js                # Multi-PNG import
    stretchFormat.js      # .stretch read/write (JSZip)
    atlasPacker.js        # Shelf bin-packing
  components/             # React UI (shadcn-based)
    canvas/
      CanvasViewport.jsx  # <canvas> + pointer events -> editorStore
      ToolOverlay.jsx
    layers/
      LayerPanel.jsx
      LayerRow.jsx        # Two columns: hierarchy + draw_order
    inspector/
      Inspector.jsx
      panels/             # PartPanel, WarpPanel, RotationPanel, ParamPanel
    timeline/
      Timeline.jsx
  lib/                    # Generic helpers (existing shadcn utils)
docs/
INITIAL_IMPLEMENTATION_PLAN.md
```

### 3.2 Data Flow

```
User input ──> editorStore (tool, selection, drag state)
                   │
                   ▼
            projectStore (scene tree mutation via immer)
                   │
                   ▼
            sceneVersion bumps
                   │
                   ▼
React components re-render          Renderer subscribes & redraws
(panels, inspectors)                (transform pass + draw pass)
```

The renderer is **not** a React component tree. `CanvasViewport.jsx` owns one `<canvas>`, instantiates the renderer once, and subscribes to `projectStore` + `editorStore` outside React's render cycle (via `store.subscribe`) to redraw on rAF. This avoids React reconciliation in the hot path.

### 3.3 The Scene Model (single source of truth)

Mirrors `.stretch` model.json from §4 of the brief, so persistence is essentially `JSON.stringify(projectStore.getState().project)`:

```js
project = {
  version: "0.1",
  canvas: { width, height },
  textures: [{ id, source }],     // working format: per-layer PNGs, not atlas
  nodes: [                         // flat array, parent refs
    { id, type, parent, draw_order, draw_order_overrides, opacity,
      clip_mask, transform, ...typeSpecificFields }
  ],
  parameters: [{ id, label, min, max, default, value, keys: [...] }],
  physics_groups: [],
  animations: []
}
```

Working format ≠ export format. At export we pack textures into atlas pages and rewrite `texture_region` UVs (addresses §7.3 atlas-repacking risk).

---

## 4. Milestones (mapped to brief §5.4)

Each milestone is sized to be independently demoable. The first 2 milestones get the most detail because that's where we need to commit to architecture; later ones are sketched.

### M0 — Project Skeleton (prep, before M1)

**Goal:** Repo ready, dependencies in, layout shell rendered, empty stores wired.

Tasks:
- Add deps: `zustand`, `immer`, `jszip`, `psd.js` (or `ag-psd` — evaluate; ag-psd has better TS + active maintenance), `delaunator` (replaces hand-rolled Bowyer-Watson — faster, MIT, ~3KB).
- Create `src/store/projectStore.js`, `editorStore.js` with initial empty state.
- Build the 4-zone layout shell ([app/layout/EditorLayout.jsx](src/app/layout/EditorLayout.jsx)) using shadcn `Resizable` panels: left (layers), center (canvas), right (inspector), bottom (timeline, hidden until parameters exist).
- Stub `CanvasViewport.jsx` rendering a clear-colored WebGL2 canvas. Test in Chrome to ensure context creation and basic rendering work.

Exit criteria: `pnpm dev` shows the editor chrome, empty WebGL canvas in center, no errors in Chrome.

### M1 — Canvas Foundation (vertical slice with one PNG)

**Goal:** Drop a PNG → see it textured, triangulated, and draggable in WebGL.

Tasks:
1. **Image import (PNG only):** drag-drop handler on `CanvasViewport`. Creates a `part` node, registers a texture, sets canvas dimensions from image.
2. **Port mesh algorithms:** copy prototype functions into [src/mesh/](src/mesh/) as pure functions taking explicit pixel buffers. No DOM, no globals. Add unit tests for `delaunay` and `traceContour` against fixture pixel data.
3. **Mesh worker:** wrap `generate.js` in a Web Worker. Main thread posts ImageData + params, worker returns `{vertices, uvs, triangles}`. Avoids freezing UI on big images.
4. **WebGL2 part renderer:**
   - Single shader: `a_position` (vec2), `a_uv` (vec2), `u_mvp`, `u_texture`, `u_opacity`. Outputs textured fragment with alpha.
   - One VAO per part. Index buffer from `triangles`, vertex buffer from `[x, y, u, v]` interleaved.
   - `partRenderer.uploadMesh(part)` and `partRenderer.uploadPositions(part)` (positions-only re-upload for hot deform path).
5. **Scene pass v0:** for now, single part — draw it. Stub the transform pass (identity matrix).
6. **Vertex drag:** pointer events in screen space → `editorStore.dragVertex(partId, vertexIndex, x, y)`. Mutation goes through `projectStore`, which bumps a `geometryVersion` for that part. Renderer re-uploads only that part's positions.
7. **Layer panel v0:** lists the one part. Shows draw_order column even though there's only one row (sets the dual-column visual pattern from brief §3.3 early).
8. **Undo/redo:** `historyStore` records immer patches on every `projectStore` mutation tagged as user-driven. `Ctrl+Z`/`Ctrl+Y` global handler.

Architectural decisions to lock in here:
- **Coordinate spaces:** image space = mesh vertex space = canvas space (in pixels, top-left origin). Viewport zoom/pan handled by an MVP matrix in the shader, not by mutating vertex coords.
- **Vertex storage:** `{x, y, ox, oy}` per the prototype is fine for v0.1 but rename `ox/oy` → `restX/restY` for clarity. Store as `Float32Array` once we hit perf concerns; object array is OK for M1.
- **Worker boundary:** anything in `src/mesh/` must be transferable (no class instances, no functions). Forces clean separation.

Exit criteria: drag any PNG into the app → see it triangulated and rendered via WebGL → drag vertices → see texture warp → undo/redo works → save/load roundtrip via JSON download.

### M2 — Auto Mesh + PSD Import

**Goal:** Multi-layer files become multi-part scenes automatically.

Tasks:
- **PSD import** ([src/io/psd.js](src/io/psd.js)): use `ag-psd` to extract layers → array of `{ name, x, y, width, height, imageData, blendMode }`. Filter group/folder layers to flat list for v0.1 (group hierarchy comes in M3).
- **Per-layer mesh generation:** loop layers, dispatch to mesh worker, create one `part` node per layer with the layer's name as `id`.
- **Detail slider** (Low/Med/High) per layer in inspector → re-runs mesh worker with different `gridSpacing` / `numEdgePoints` presets from [INTEGRATION_GUIDE.md §Parameter Tuning Guide](docs/INTEGRATION_GUIDE.md).
- **Multi-part draw pass:** sort parts by `draw_order` ascending each frame, issue one draw call per part. Add per-part opacity uniform.
- **Layer panel v1:** real list with reorder via draw_order column. Click to select. Selected part highlighted on canvas (draw mesh wireframe overlay).
- **Manual mesh editing overlay:** toggle in inspector. Click empty space to add vertex (re-triangulates), click vertex + Delete to remove.

Open question to resolve in M2: do we keep the prototype's hand-rolled Bowyer-Watson or switch to `delaunator`? Recommendation: switch — it's the de facto standard, MIT, and frees us from maintaining numerical edge cases.

Exit criteria: drop a multi-layer PSD → all layers appear as parts with auto-meshes → reorder draw order → adjust per-layer detail → manually tweak vertices.

### M3 — Deformer Tree (Rotation + Groups)

**Goal:** Hierarchical transforms work; head can rotate as a unit.

Tasks:
- Add `group` and `rotation_deformer` node types to scene model.
- **Transform pass:** depth-first walk, compose `parent.world * node.local` into `node.world` (3x3 affine matrices). Cache, invalidate on transform mutation.
- Apply `node.world` as `u_mvp` per part draw call.
- Layer panel: indented tree (left column) reflecting `parent`. Drag-to-reparent. **Critical UX:** keep draw_order column visually distinct so users see the two are independent (brief §3.3, §7.2 open question). Worth a one-time tooltip on first reparent.
- Inspector panel for rotation deformer: pivot point (draggable on canvas), rotation/scale sliders.
- Selection on canvas: clicking selects the deepest hit; alt-click cycles up the parent chain.

### M4 — Warp Deformer + Path Deformer

- Warp deformer: 5×5 grid of control points stored as `control_offsets[16]` (delta from rest). Bilinear interpolation in JS computes per-vertex displacement during transform pass; result fed into vertex buffer re-upload for affected parts.
- Path deformer: skip in v0.1 if M5/M6 are at risk; it's the lowest-impact deformer for typical rigs.
- Decision: bilinear interpolation in JS vs vertex shader? **JS for now** — keeps the data flow uniform (everything ends up as positions in the vertex buffer). Move to GPU only if profiling demands it.

### M5 — Parameters

- Parameter CRUD in inspector.
- **Armed recording mode:** the brief calls this out as the hardest interaction (§3.5 UX Note). Implementation:
  - `editorStore.armedParameterId`. When non-null, all deformer mutations are intercepted and written as a keyed state at the parameter's current value.
  - Visual: red 2px border on canvas via CSS, red highlight on the armed parameter row, "REC" badge in canvas top-left. Cannot be missed.
- Parameter interpolation in transform pass: for each parameter, find bracketing keys, lerp control offsets, apply. Per brief §5.3.
- Opacity & draw_order_overrides driven by parameters.

### M6 — Physics

- Spring chain integrator on rAF tick (XPBD or Verlet — Verlet is simpler, ship that first).
- Physics group editor in inspector: pick parts in order, set gravity/stiffness/damping/wind.
- Play button on canvas to enable physics preview (per brief §3.6 — editor pose is static otherwise).

### M7 — Timeline

- Bottom panel with parameter tracks.
- Keyframe diamonds, drag to move, right-click for interpolation mode.
- Multiple clips stored in `project.animations`.

### M8 — Export & Player

- `.stretch` writer: JSZip with model.json + atlas pages + thumbnail.
- **Atlas packer** ([src/io/atlasPacker.js](src/io/atlasPacker.js)): shelf packing into power-of-2 pages. At export, rewrite each part's `texture_region` to atlas UVs. Working format keeps per-layer PNGs (so re-export is stable — addresses §7.3).
- Standalone player library: separate entry point in Vite (`vite.config.js` `build.rollupOptions.input`), outputs ES module. Reuses `renderer/`, `scene/transform.js`, `parameters.js`. Excludes everything in `components/`, `mesh/`, `io/psd.js`. Target <5KB gzipped — measure each PR.
- GIF/APNG export via canvas capture loop.

### M9 — 2D Parameter Grids (v1.1, deferred)

Bilinear blend across 4 corner poses. Format bump.

---

## 5. Cross-Cutting Concerns

### 5.1 Performance Budgets

- Mesh generation: <500ms for a 2048² layer at "Medium" detail (worker, so non-blocking — but still the perceived limit before users think it broke).
- Vertex drag: 60fps with up to 5000 total triangles in scene. Hot path is "upload one part's positions + redraw all parts". Profile in M1.
- Idle frame (no input): <2ms CPU. Scene pass should early-out when no `geometryVersion` / `transformVersion` has changed.

### 5.2 Browser Support

- **Target (v0.1):** Chrome/Edge 120+. Focus on Chromium for rapid iteration.
- **Future (post-v0.1):** Firefox, Safari. Defer compatibility work until feature-complete on Chromium.

### 5.3 Testing Strategy

- **Unit tests** (vitest) for everything in `src/mesh/` and `src/scene/`. These are pure functions; they should be the most-tested code in the repo.
- **Renderer tests:** snapshot the WebGL output for fixture scenes via `gl.readPixels` → PNG diff. Skip in CI if too flaky; run locally.
- **No tests for React components** beyond smoke renders. UI churn will outpace test maintenance.

### 5.4 What We're Explicitly NOT Doing in v0.1

(Reaffirming brief §2.2, plus implementation-specific deferrals)
- No OpenCV WASM in v0.1 — pure-JS Canny via the prototype's contour tracer is sufficient. Revisit if quality complaints arrive.
- No collaborative editing, no cloud save, no accounts. Static site only.
- No plugin API. Deformer types are hardcoded.
- No SVG import. PSD + PNG only.

---

## 6. Plan Flexibility & Iteration

**This plan is a directional map, not a contract.** The actual implementation will reveal surprises that invalidate assumptions. Use this document as a north star, not a prison.

### How the Plan Will Change

1. **Milestone scope may collapse or expand.** If M1's WebGL scaffolding is deceptively easy, we might land M2 in the same sprint. If a PSD library has unexpected quirks, PSD import might split into M2a (PNG-only) and M2b (PSD).
2. **Architecture will bend under real workloads.** Once we run performance tests with 50-layer PSDs, we may discover that the scene model needs per-layer texture atlasing, or that we can't batch draw calls the way the plan suggests. Adjust without ceremony.
3. **Deformer types may reorder or merge.** Warp and Rotation might turn out to share enough logic that a unified "deformer with parameters" type makes sense. Or a new deformer idea (bone chains, FFD cages) might emerge mid-implementation and prove simpler than expected.
4. **Renderer implementation details will shift.** The plan assumes a VAO per part and per-triangle affine transforms in the transform pass. Once we measure, we might move transforms to the vertex shader, or batch parts into a single VAO with instancing. The API (what React components ask the renderer to do) should stay stable; the underneath can change.

### Principle: Keep the Vertical Slice, Not the Fine Print

Every milestone should output a usable, releasable (to internal testers) build. If a detail in the plan conflicts with shipping that vertical slice on time, drop the detail. Examples:
- Undo/redo (M1) is nice-to-have. If it slows M1 to ship, defer to M1.5. The core loop is import → mesh → drag → see changes.
- Per-layer detail slider (M2) is a tuning knob. If PSD import lands without it, that's OK. Add it in M2.5.
- Clipping masks can wait until parts overlap in real rigs — no reason to build stencil logic for an unused feature.

### Feedback Loops

1. **Profiling loops:** M1 and M2 each include a "performance check" task. If metrics are in the budget, proceed. If not, pause and optimize before moving on.
2. **QA / user testing during implementation:** Once M2 lands, grab 2–3 artists familiar with Live2D or Inochi and have them try to rig a simple character. Their confusion points inform M3 (hierarchy) and M5 (parameters) design.
3. **Format stability checks:** At the end of M2 and M4, do a round-trip test: export a `.stretch` file, reload it in a fresh session, verify it's byte-identical (not just semantically equivalent). Catch serialization bugs early.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| psd.js / ag-psd choking on real-world PSDs (CMYK, smart objects, layer effects) | High | Med | In M2, build a corpus of 5–10 real PSDs from VTuber/illustrator communities. Document unsupported features and surface clear errors. |
| Performance cliff with 50+ parts × 1000 verts each | Med | High | Profile in M2 with a synthetic 50-layer scene. Pre-budget vertex re-upload to dirty parts only. Consider Float32Array migration if needed. |
| Armed recording mode is still confusing despite red border (brief §7.2) | Med | Med | First-run interactive tutorial overlay just for parameter recording. Punt to M5 user testing. |
| `.stretch` format churn breaks early users | Low (no users yet) | Med | Land version field + migration scaffolding in M8 even though there's nothing to migrate. |
| Player library bloats past 5KB | Med | Low | Measure on every PR via `vite build` size report. Hard-fail CI at 8KB. |

---

## 8. Immediate Next Steps (post-approval of this plan)

1. M0 task list → tickets/todos.
2. Decide: `delaunator` vs hand-rolled (recommendation: delaunator).
3. Decide: `ag-psd` vs `psd.js` (recommendation: ag-psd — needs ~30min eval).
4. Prototype the WebGL2 stencil mask in isolation on Safari before M2.
5. Build the M0 layout shell + empty stores.
6. Begin M1.

---

**End of Initial Implementation Plan**
