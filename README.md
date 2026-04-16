# 🧬 Stretchy Studio

**The fastest way to rig and animate "See-Through" SOTA character models.**

Stretchy Studio is a high-performance 2D animation tool designed to turn static layers into expressive, mesh-deformed animations. We are built specifically to bridge the gap between AI-driven layer decomposition (like the **See-Through** SOTA model) and professional-grade animation.

Unlike traditional bone-based systems, Stretchy Studio combines **AI-powered auto-rigging** with a **timeline-first, direct-deformation workflow**. Letting you go from a flat PSD to a fully rigged character in seconds.

[🚀 Launch the Editor](https://editor.stretchy.studio) | [💬 Join the Discord](https://discord.com/invite/zB6TrHTwAb) | [🌐 Visit the Website](https://stretchy.studio)

---

## ✨ Key Highlights

### 📂 Native "See-Through" Support
Optimized for characters generated via SOTA layer decomposition models like **See-Through**. Import your segmented PSDs and let Stretchy Studio handle the complex occlusions, depth layering, and mesh generation automatically.

---

## 🧩 The See-Through Pipeline

Stretchy Studio is designed to be an animation engine for the [**See-Through**](https://github.com/shitagaki-lab/see-through) model. While traditional 2D animation requires manual layering and inpainting, See-Through automates this process using a single static illustration.

### What is See-Through?
See-Through is a SOTA framework that transforms a single anime illustration into a manipulatable character model by decomposing it into fully inpainted, semantically distinct body-part layers.

- **Official Repository**: [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)
- **Academic Paper**: ["See-through: Single-image Layer Decomposition for Anime Characters"](https://arxiv.org/abs/2602.03749)

### How to get decomposed PSDs
**Quick Start (Recommended)**: Use the [**Free Hugging Face Demo**](https://huggingface.co/spaces/24yearsold/see-through-demo) to quickly run the model on your character.

> See-Through is specifically trained on **anime and VTuber-style** illustrations. Realistic or non-anime styles may not decompose correctly.

### 📐 Magic Auto-Rigging
Rigging doesn't have to be a chore. Use **AI-powered pose detection** (DWPose) to automatically generate a skeleton for your character, or use our instant "heuristic" method to get moving in seconds.

### 🎬 Organic "Stretchy" Motion
Don't just rotate layers—warp them! Animate individual mesh vertices to create organic, fluid motion. Perfect for breathing effects, flowing hair, and those subtle "Live2D-style" micro-expressions.

### 🔦 Some other features you may like
- **Automatic Eye Clipping**: Irises stay perfectly contained within the eyes—no complex masking required.
- **Realistic Limb Bending**: Built-in vertex skinning for arms and legs so they bend exactly how they should.
- **Blender-Style Shape Keys**: Create complex deformations (like smiles or blinks) once and blend them anyway you like via influence sliders.
- **Synced Audio Tracks**: Layer background music and SFX directly in the timeline. Trim, position, and sync audio clips with your animations for a complete multimedia experience.
- **Spine 4.0 Export**: Export your rigs and animations directly to Spine JSON format for use in game engines and professional production pipelines.

---

## 🚀 Quick Start

1. **Open the App**: Head to [editor.stretchy.studio](https://editor.stretchy.studio).
2. **Drop your Art**: Drag a PSD or PNG file into the workspace.
3. **Auto-Rig**: Follow the 3-step wizard to setup your character skeleton.
4. **Animate**: Switch to **Animation mode** and start creating keyframes!

---

## 🎨 Workflow Examples

### Static Character
1. **Import**: Drag a PSD into the editor viewport.
2. **Organize**: Use the Groups tab to parent layers and adjust pivot points.
3. **Mesh**: Click "Generate Mesh" on any part to enable organic warping.
4. **Animate**: Switch to **Animation** mode, create a clip, and start keyframing!

### SOTA Workflow (e.g., See-Through)
1. **Import**: Drag your decomposed "See-Through" PSD into the editor.
2. **Auto-Rig**: Launch the Rigging Wizard. Stretchy Studio uses AI to map your layers to a skeletal structure instantly.
3. **Refine**: Adjust joint positions and mesh density to handle occluded areas (like hair behind the neck).
4. **Animate**: Create fluid, multi-layered animations that take full advantage of the "See-Through" depth data.

---

## 🛠 For Developers

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

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (Recommended)

### Setup
```bash
# Install dependencies
pnpm install

# Run the development server
pnpm dev
```
Open `http://localhost:5173` to view the app locally.

---

## 💬 Community & Support

Join our [Discord](https://discord.com/invite/zB6TrHTwAb) to share your animations, get help, or suggest new features!

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
