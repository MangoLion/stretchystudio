# 🧬 Stretchy Studio

**Stretchy Studio** is a high-performance 2D animation tool designed for illustrators and animators. It streamlines the workflow from static 2D artwork (PSD/PNG) to fully realized, mesh-deformable animations and spritesheets.

Unlike traditional bone-based systems, Stretchy Studio focuses on a **timeline-first, direct-deformation workflow** reminiscent of After Effects, providing a lower learning curve while maintaining professional-grade flexibility.

![Project Status](https://img.shields.io/badge/Status-M5_Complete-success?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-React_|_WebGL2_|_Zustand-blue?style=for-the-badge)

---

## ✨ Key Features

### 📂 Intelligent Import
- **PSD Layer Extraction**: Full support for multi-layer PSD files with layer names, order, and opacity preserved.
- **Character Format Detection**: Intelligent recognition of 23+ character part tags (e.g., *eyebrow_L*, *topwear*, *footwear*). Automatically organizes layers into a structured **Head** (with **Eyes** subgroup), **Body** (with **Upper/Lowerbody**), and **Extras** hierarchy while preserving the original PSD draw order.
- **Mesh-on-Demand**: Start with lightweight textures; opt-in to low-poly mesh generation for advanced deformation when needed (Defaults: Alpha Threshold 5, Smooth Passes 0).

### 📐 Precision Rigging
- **Hierarchical Transforms**: Nested group structures with parent-child transform inheritance.
- **Intuitive Gizmos**: World-space move and rotate handles for direct canvas manipulation; rotatable skeletal arcs on animation timeline.
- **3-Step Import Wizard**: Choose between manual (heuristic) or AI-powered (DWPose) rigging, then adjust joints on canvas before committing.
- **Armature Auto-Rig**: Two skeleton detection methods:
  - **Manual (Heuristic)**: Instant skeleton estimation from layer bounding boxes — no model download needed.
  - **DWPose ONNX**: High-accuracy whole-body pose detection for see-through PSD characters.
- **Joint Adjustment**: Full-canvas skeleton overlay with draggable joint circles. Back button reverts to previous wizard step anytime before completion.
- **Bone Hierarchy**: Joint-based bones as group nodes with pivotX/Y positioning (root → torso → head → eyes; legs; arms with elbow/knee joints).
- **2D Iris Trackpad**: Dedicated 2D square trackpad UI for intuitive iris/eye movement; anchored optimally above the head to avoid face obstruction.
- **Limb Bending (Elbows/Knees)**: Realistic 2D vertex skinning for arms and legs. Automatically computes bone weights by projecting vertices onto bone axes. Works seamlessly with direct rotation handles.
- **Automatic Iris Clipping**: Advanced stencil-based masking keeps irides contained within eyewhites. Intelligent L/R matching handles split-eye characters out-of-the-box via name-suffix detection.
- **Pivot Calibration**: Accurate pivot placement for natural rotations and scaling.
- **Selection Isolation**: Selection and Gizmos automatically lock/hide when skeleton is active AND a rig exists to focus on bone joint setup. Standard selection remains enabled for un-rigged projects.
- **Alpha-Based Selection**: Pixel-perfect selection that works instantly on both textured quads and complex meshes.
- **Inline Help System**: Reusable `HelpIcon` components provide instant tooltips for complex parameters across the UI (Inspector, Timeline, Rigging Wizard, and Mode Toggles).

### 🎬 Professional Timeline
- **AE-Style Workflow**: Familiar keyframing system for transforms (X, Y, Rotation, Scale) and Mesh Vertices.
- **Dynamic Defaults**: Includes **Auto Keyframe** (automatically create keyframes on property change) and **Loop Keyframes** (seamless looping between first and last keyframes) enabled by default.
- **Multi-Clip Management**: Create multiple animation sequences (e.g., *Idle*, *Walk*, *Attack*) within a single project.
- **Direct Vertex Keyframing**: "Warp" your illustrations by animating individual mesh vertices for organic motion.
- **Smooth Interpolation**: High-performance rendering loop with real-time pose blending.

### ⚡ Optimized Engine
- **WebGL2 Renderer**: Custom rendering pipeline using VAOs, batching, and hierarchical matrix math for 60 FPS performance.
- **Pose Separation**: Playback state is decoupled from the project model, ensuring a non-destructive animation workflow.
- **Low Memory Footprint**: Efficient texture and vertex buffer management.

---

## 🛠 Tech Stack

- **Core**: [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) + [Immer](https://immerjs.github.io/immer/)
- **Rendering**: [WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext), [gl-matrix](http://glmatrix.net/)
- **Mesh Engine**: [Delaunator](https://github.com/mapbox/delaunator) (Triangulation), Custom Contour Tracing
- **IO**: [ag-psd](https://github.com/misonou/ag-psd) (PSD Parsing), [JSZip](https://stuk.github.io/jszip/) (Export)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [Lucide React](https://lucide.dev/)

---

## 🏗 Project Structure

```bash
src/
├── app/layout/          # 4-zone UI layout (Canvas, Layers, Inspector, Timeline)
├── components/
│   ├── canvas/          # WebGL Viewport, Gizmos, and Picking logic
│   ├── layers/          # Hierarchical draw order and grouping management
│   ├── inspector/       # Node properties and mesh generation controls
│   └── timeline/        # Playhead, Keyframe tracks, and Animation CRUD
├── renderer/
│   ├── transforms.js    # Matrix math & world matrix composition
│   ├── scenePass.js     # Hierarchical draw-order rendering
│   └── partRenderer.js  # GPU buffer management (VAO/EBO)
├── store/
│   ├── projectStore.js  # Scene tree and persistent node state
│   ├── animationStore.js # Playback state, interpolation, and pose overrides
│   └── editorStore.js   # UI state, selection, and viewport settings
├── mesh/                # Auto-triangulation and mesh editing algorithms
└── io/                  # PSD parsing and export utilities
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (Recommended) or `npm`

### Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Run the development server**:
   ```bash
   pnpm dev
   ```

3. **Open the browser**:
   Navigate to `http://localhost:5173`.

---

## 🎨 Workflow Example

### Static Character
1. **Import**: Drag a PSD into the viewport.
2. **Organize**: Use the Groups tab to parent layers and adjust pivot points.
3. **Mesh**: Select a part, click "Generate Mesh", and adjust mesh settings as needed.
4. **Animate**: Switch to "Animation" mode, create a new clip, and keyframe transforms + vertices.
5. **Export**: (Coming Soon) Export as a packed spritesheet or PNG sequence.

### Rigged Character (See-Through PSD)
1. **Import & Rig**: Drag a see-through PSD character → 3-step wizard opens:
   - Choose rigging method: *Rig manually* (instant heuristic) or *Rig with DWPose* (AI-powered)
   - Adjust joint positions on canvas if needed
   - Click Finish to commit
2. **Animate**: Switch to "Animation" mode, create clips, and keyframe bone rotations + vertex deforms.
3. **Playback**: Bones drive limb bending via vertex skinning; smooth interpolation between keyframes.
4. **Export**: (Coming Soon) Export as spritesheet with bone-driven animation baked in.

---

## 📜 Metadata

- **Author**: Nguyen Phan
- **License**: Private / Proprietary
- **Version**: 0.5.0 (M5 Release)
