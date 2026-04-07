# Stretchy Studio — Design Brief

**stretchy.studio**

A beginner-friendly web-based 2D mesh animation tool

**Version 0.1 · April 2026 · Confidential**

---

## 1. Project Overview

Stretchy Studio is a web-first, beginner-friendly 2D mesh rigging and animation tool. It sits in the gap between general animation tools (Synfig, OpenToonz) and the professional — but expensive and complex — Live2D Cubism ecosystem. There is no FOSS tool that runs in a browser, supports full mesh deformation, a hierarchical parameter system, and physics. Stretchy Studio is that tool.

### Core Philosophy

**Ease of use over raw power.** Every feature decision must ask: can a first-time rigger understand this without reading a manual? Complexity is hidden; capability is not sacrificed.

### 1.1 Problem Statement

Live2D Cubism is the industry standard for 2D character rigging. It is proprietary, has a steep learning curve, and costs $67–$153/month for the full version. Open-source alternatives like Inochi Creator (the closest FOSS equivalent) are desktop-only, require complex build toolchains, and are still largely inaccessible to beginners. No browser-based tool in this space exists.

Artists — especially VTubers, indie game developers, and visual novel creators — need a tool that:

- Runs in the browser with no install
- Accepts artwork directly from Photoshop or Clip Studio Paint (PSD)
- Generates meshes automatically from layer alpha channels
- Supports smooth, parameter-driven deformation with physics
- Does not require knowledge of 3D concepts, bones, or weight painting

### 1.2 Competitive Landscape

| Feature | Live2D | Inochi Creator | Stretchy Studio |
|---------|--------|--------|---------|
| FOSS | ✗ | ✓ | ✓ |
| Web / browser | ✗ | ✗ | ✓ |
| Auto mesh gen | ✓ | ✓ | ✓ |
| Warp deformers | ✓ | ✓ | ✓ |
| Parameter system | ✓ | ✓ | ✓ |
| Physics | ✓ | ✓ | ✓ |
| Beginner-friendly | ✗ | ✗ | ✓ |
| PSD import | ✓ | ✓ | ✓ |
| No install required | ✗ | ✗ | ✓ |

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Ship a fully functional rigging and animation editor that runs in any modern browser (Chrome, Firefox, Safari, Edge).
- Support the complete workflow: import → auto mesh → deformers → parameters → physics → animate → export.
- Be learnable in under 30 minutes by a user with no prior rigging experience.
- Produce a compact, human-readable project format (.stretch) exportable as a self-contained zip.
- Enable runtime playback of exported models in a lightweight standalone JS player library.

### 2.2 Non-Goals (v1)

- **3D rigging, bones, or inverse kinematics** — this is a pure mesh deformation tool.
- **Real-time face tracking / VTubing runtime** — out of scope for the editor (player library can integrate later).
- **Video export or compositing** — the output is an animated model format, not a rendered video.
- **Mobile editing** — the canvas interaction model requires a pointer device.
- **Live2D or Inochi2D format compatibility** — Stretchy uses its own open spec.

---

## 3. User Workflow

The intended workflow is linear and progressive. Each stage unlocks naturally from the previous one. No stage should require the user to understand what comes after it.

### 3.1 Stage 1 — Import

The user drags a PSD file or a folder of PNG images onto the canvas. The app parses the file and populates the layer panel with one node per layer, preserving layer names as node IDs. The canvas shows a flat composite of all layers at their original positions.

- **PSD import:** uses psd.js (MIT-licensed) to extract layer bitmaps, names, blend modes, and positions.
- **PNG import:** each file becomes a named part node; the user arranges draw order manually.
- **Layer names** from the PSD become node IDs throughout the project — keeping the link to the artist's working file obvious.

### 3.2 Stage 2 — Auto Mesh Generation

After import, each part layer receives a mesh automatically. The user does not need to touch this to proceed. The mesh is generated per-layer from the alpha channel using the following pipeline:

- **Edge detection:** Canny edge detection (via a WASM-compiled OpenCV or pure-JS fallback) traces the silhouette of the non-transparent region.
- **Boundary vertices:** vertices are placed along the silhouette at a density controlled by a per-layer Detail slider (Low / Medium / High).
- **Interior fill:** Poisson disk sampling populates the interior with evenly-distributed density vertices, denser in areas of high edge complexity.
- **Triangulation:** Delaunay triangulation connects all vertices into a clean triangle mesh with correct winding order.
- **UV mapping:** each vertex UV maps 1:1 to its pixel position in the layer texture.

Manual mesh editing is available as an overlay mode: the user can click to add/remove/move individual vertices, or draw a custom boundary polygon. Auto-generated mesh is always the starting point; manual edits are additive refinements.

### 3.3 Stage 3 — Grouping & Hierarchy (Optional)

The user can group parts into logical units (head, left arm, body, etc.) by drag-and-dropping in the layer panel. Grouping affects transform inheritance only — it does not affect draw order.

**Key design decision: transform hierarchy ≠ draw order**

A part's parent determines what it moves with. A part's draw_order integer determines when it is drawn. Back hair can be a child of the head group (so it moves with the head) while having a draw_order lower than the body (so it renders behind it). These two properties are edited independently.

- **Layer panel left column:** indented tree showing transform parent/child relationships. Drag to reparent.
- **Draw order column:** a numeric drag handle on each row, independent of indentation. Reordering this does not change the hierarchy.
- **Deformer nodes** (warp, rotation) can also be parents. A rotation deformer wrapping a group of head parts makes the entire head pivot around a point.

### 3.4 Stage 4 — Deformers

Deformers are transformation nodes that sit in the scene tree and bend, stretch, or rotate the parts beneath them. There are three deformer types:

#### Warp Deformer

A grid of control points (default 5×5, configurable) overlaid on a rectangular region. Moving a control point displaces the underlying mesh vertices via bilinear interpolation. Used for facial expressions, body squash/stretch, cheek puffs, etc.

#### Rotation Deformer

A pivot point plus a local 2D affine transform (translate, rotate, scale). Children inherit the transform via a matrix stack. Used for head rotation, arm swing, hair joints.

#### Path / Glue Deformer

Vertices are attracted to a Bezier curve. Each vertex stores a t-parameter (position along the curve) and a perpendicular offset. Used for tails, ribbons, tendrils, flowing cloth edges.

### 3.5 Stage 5 — Parameters

Parameters are named float sliders that drive deformer states. The user creates a parameter (e.g. 'Face Angle X', range -30 to +30), sets it to a value, poses the deformers, and records that pose as a keyframe. The app then interpolates between keyframes as the slider moves.

- Each parameter has: id, label, min, max, default value, and a list of keyed states.
- Each keyed state stores: the parameter value at that key, and a snapshot of all affected deformer control point offsets.
- Runtime playback: linear or cubic-Hermite interpolation between nearest key states.
- **2D parameter grids (v1.1):** two parameters form a grid; bilinear interpolation across four corner poses enables natural diagonal head rotation.

#### UX Note: Parameter Recording Mode

The hardest interaction in the editor is 'how do I record a pose into a parameter key?' The solution is an Arm button per parameter: when armed, any deformer edit is automatically recorded as a key at the current slider value. Visual indicators (red outline on the canvas, highlighted slider) make the armed state unmissable.

### 3.6 Stage 6 — Physics

Physics groups simulate secondary motion on chains of parts (hair strands, ears, cloth, tails). Each chain is a list of parts in parent-to-tip order. On each animation frame, a spring integrator runs:

- Each node inherits the parent's world transform as its base position.
- Gravity, wind direction, and stiffness are applied as forces.
- Velocity is integrated with configurable damping.
- A distance constraint (XPBD or Verlet) keeps each segment at its rest length.

Exposed tuning controls per physics group: Gravity Scale, Stiffness, Damping, Wind Direction, Wind Strength, Max Angle. Previewing physics requires pressing a Play button on the canvas — the editor pose is not physics-simulated.

### 3.7 Stage 7 — Animation

A horizontal timeline at the bottom of the editor. Parameters appear as tracks. The user scrubs the timeline, moves sliders to desired values, and sets keyframes. The timeline supports:

- Keyframes displayed as diamonds on parameter tracks.
- Per-keyframe interpolation: Linear, Ease In/Out (cubic Hermite), Step.
- Multiple animation clips (idle, talk, blink, etc.) stored in the same project file.
- Physics simulation plays on top of timeline playback automatically.

### 3.8 Stage 8 — Export

- **Export as .stretch:** a zip containing model.json + textures/ atlas PNGs + thumbnail.png.
- **Export as animated GIF or APNG** (via canvas capture): for quick sharing.
- **Player library:** a standalone <5KB JS file that loads a .stretch file and renders it on a canvas element — suitable for embedding in web pages or games.

---

## 4. File Format — .stretch

The .stretch format is a zip archive. It is human-readable, inspectable without tooling, and designed to be simple to parse in any language. Binary data (textures) is stored as PNG files; everything else is JSON.

### 4.1 Archive Structure

| File | Purpose |
|------|---------|
| model.json | Scene tree, parameters, physics groups, animation clips |
| textures/tex_0.png | Texture atlas containing packed layer bitmaps |
| textures/tex_1.png | Additional atlas if needed (atlas packing at export time) |
| thumbnail.png | 128×128 preview image shown in file browser |

### 4.2 model.json Top-Level Structure

The JSON is structured into five top-level keys:

- **version** — format version string (e.g. "0.1"). Used for forward-compatibility checks.
- **canvas** — `{ width, height }` in pixels. Defines the coordinate space.
- **textures** — array of texture atlas filenames referenced by part nodes.
- **nodes** — the full scene tree as a flat array of node objects with parent references.
- **parameters** — array of named parameter definitions with their keyed states.
- **physics_groups** — array of spring chain definitions.
- **animations** — array of named animation clips with per-parameter keyframe tracks.

### 4.3 Node Types

| Type | Role | Key Fields |
|------|------|-----------|
| part | Drawable mesh layer | mesh (vertices, uvs, triangles), texture_id, texture_region |
| group | Organizational container | No geometry. Children inherit transform. |
| warp_deformer | Grid-based distortion | grid_cols, grid_rows, control_offsets[ ] |
| rotation_deformer | Pivot transform | pivot_x, pivot_y, local transform matrix |

**All node types share these common fields:**

| Field | Description |
|-------|-------------|
| id | Unique string identifier. Derived from PSD layer name where possible. |
| type | "part" \| "group" \| "warp_deformer" \| "rotation_deformer" \| "path_deformer" |
| parent | id of parent node, or null for root-level nodes. |
| draw_order | Integer render priority. Lower = drawn first (further back). Independent of parent. |
| draw_order_overrides | Array of `{ param, threshold, draw_order }` — snaps draw order when a parameter crosses a threshold. Enables arm-behind/in-front-of-body switching. |
| opacity | Float 0–1. Can be driven by a parameter. |
| clip_mask | id of another part whose alpha masks this part. Null if unused. |
| transform | Local `{ x, y, rotation, scale_x, scale_y }` relative to parent. |

---

## 5. Technical Architecture

### 5.1 Technology Stack

| Layer | Technology |
|-------|-----------|
| Editor UI | React + Zustand (state) + TailwindCSS |
| Canvas / renderer | WebGL2 — custom mesh shader, VAO per part |
| Mesh generation | Canny edge detection via OpenCV WASM; Poisson disk sampling; Delaunay triangulation (delaunator, MIT) |
| PSD parsing | psd.js (MIT) |
| Physics | Custom JS spring integrator (XPBD constraints), runs on each rAF tick |
| File I/O | JSZip for .stretch pack/unpack; atlas packing via custom bin-packing |
| Player library | Standalone ES module, no framework dependencies, <5KB gzipped |
| Hosting | Static site on stretchy.studio — no server-side state |

### 5.2 Renderer Architecture

The renderer performs two independent passes per frame:

- **Transform pass:** walk the scene tree top-down, computing each node's world transform matrix by composing local transforms with the parent's world matrix. Deformer control point offsets (interpolated from current parameter values) are applied here.
- **Draw pass:** collect all part nodes, sort by current draw_order (applying any active draw_order_overrides), then issue one WebGL draw call per part in that order. Each part is a single VAO; only modified vertex buffers are re-uploaded.

Clipping masks are handled via WebGL stencil buffer: the mask part is rendered into the stencil, then the clipped part is drawn with stencil test enabled.

### 5.3 Parameter Interpolation

At runtime, for each parameter at value v, the engine finds the two nearest keyed states (v_lo, v_hi) and computes a blend factor t = (v - v_lo) / (v_hi - v_lo). It then linearly interpolates (or cubically for smooth mode) between the control point offset arrays of the two states. The result is applied directly to the deformer's current offset buffer before the transform pass.

For 2D parameter grids (v1.1), two parameters are sampled simultaneously. The engine finds the four enclosing grid corners and performs bilinear interpolation across them, yielding smooth diagonal poses that pure 1D blending cannot achieve.

### 5.4 Build Order / Milestones

| Milestone | Name | Deliverables |
|-----------|------|--------------|
| M1 | Canvas foundation | Image import, manual vertex placement, Delaunay triangulation, WebGL render, draw order panel |
| M2 | Auto mesh | Canny edge detection, Poisson disk sampling, per-layer density slider, PSD import |
| M3 | Deformer tree | Rotation deformer, scene tree with matrix-stack transforms, group nodes |
| M4 | Warp deformer | Grid control points, bilinear interpolation of vertex offsets, path deformer |
| M5 | Parameters | Parameter panel, armed recording mode, 1D keyframe blending, opacity + draw order overrides |
| M6 | Physics | Spring chain integrator, physics group UI, play-mode preview |
| M7 | Timeline | Keyframe tracks per parameter, interpolation modes, multi-clip support |
| M8 | Export | .stretch file format, atlas packing, player library, GIF/APNG export |
| M9 | 2D grids | Bilinear parameter grid blending, grid pose editor, v1.1 format bump |

---

## 6. UX Principles

### 6.1 Core Interaction Model

The editor is a single-page application with four primary zones:

- **Canvas (center):** WebGL viewport. All mesh, deformer, and physics interaction happens here.
- **Layer panel (left):** transform hierarchy tree + draw order column. One panel, two orthogonal concerns.
- **Inspector (right):** context-sensitive panel showing properties of the selected node or deformer.
- **Timeline (bottom):** parameter tracks and keyframe editor. Hidden until parameters exist.

### 6.2 Beginner Safeguards

- Auto mesh is always generated on import — the user can immediately press Play and see something move.
- Parameters are optional — a user can rig with only deformers and a single idle pose.
- Destructive actions (delete node, clear mesh) require a confirmation. Undo/redo (Ctrl+Z/Y) is always available.
- Tooltips on every tool explain what it does in plain language, not technical terms.
- 'What is this?' help links open a brief inline explainer — no external docs required for core features.

### 6.3 Naming Conventions

Terminology is chosen to be familiar to 2D artists, not 3D riggers or software engineers:

| Technical Term | UI Label | Rationale |
|---|---|---|
| warp_deformer | Stretch box | Describes what it does visually |
| rotation_deformer | Pivot | Familiar from drawing apps |
| path_deformer | Curve deformer | Intuitive for illustrators |
| parameter | Parameter | Kept — 'blend shape' is a 3D term |
| draw_order | Layer order | Maps to Photoshop mental model |
| clip_mask | Clipping mask | Exact same term as Photoshop/CSP |
| physics_group | Jiggle group | Friendly and descriptive |

---

## 7. Open Questions & Risks

### 7.1 Technical Risks

- **OpenCV WASM bundle size:** the full OpenCV WASM is ~8MB. A custom minimal build for Canny-only may be needed, or a pure-JS fallback for the silhouette tracing step.
- **WebGL2 Safari support:** WebGL2 is available on Safari 15+ but has known quirks with stencil buffer behavior. Clipping mask implementation needs cross-browser testing early.
- **Atlas packing at export:** fitting all layer textures into power-of-2 atlas pages without excess waste requires a shelf or guillotine bin-packing algorithm. Should be prototyped in M1 even if not exposed to users.

### 7.2 UX Open Questions

- How does a user discover that draw order and hierarchy are independent? The dual-column panel needs a clear first-run affordance.
- Parameter recording mode (arm button): how is it communicated that the editor is in a 'recording' state? A red canvas border is the current proposal — needs user testing.
- Should physics tuning be per-part or per-group? Per-group is simpler but may be too coarse for complex rigs.

### 7.3 Format Risks

- The .stretch format is v0.1 and will evolve. A migration strategy (version field + migration functions) must be established before any public release to avoid breaking saved projects.
- Texture atlas repacking: if a user edits a rig after export and re-imports it, atlas UVs may shift. The project working format should store per-layer source PNGs separately from the export atlas.

---

**End of Design Brief · Stretchy Studio v0.1**

**Confidential v0.1 · April 2026**