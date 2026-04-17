# Live2D Export Implementation

This document describes the Live2D Cubism export functionality in Stretchy Studio — both runtime (.moc3) and project (.cmo3) formats.

## Overview

Stretchy Studio can export projects to **Live2D Cubism V4.0** format, enabling integration with:
- Game engines (Godot, Unreal, etc.)
- Ren'Py visual novel framework
- Live2D Cubism SDK applications
- Cubism Editor 5.0 (for project editing)

## Export Types

### 1. Live2D Runtime (.moc3)

**What it is:** Standalone model file for game engines and apps using Live2D Cubism SDK 4.0+.

**Output:** ZIP file containing:
- `.moc3` — binary model file
- `.model3.json` — manifest (references all resources)
- `model.{size}/` — texture atlas PNGs (e.g., `model.2048/texture_00.png`)
- `.cdi3.json` — display info (human-readable names)
- `motion/*.motion3.json` — animation curves (if animations exist)

**Workflow:**
1. Export model from Stretchy Studio
2. Unzip the file
3. Load `.model3.json` into your game engine or app
4. Character renders with textures and basic animation support

**Feature Support:**
| Feature | Supported |
|---------|-----------|
| Mesh geometry | ✅ Yes |
| Texture atlas | ✅ Yes (optimized packing) |
| Part hierarchy (groups) | ✅ Yes (visibility only) |
| Opacity animation | ✅ Yes |
| Rotation animation | ⚠️ No (use .cmo3 instead) |
| Mesh deformation animation | ⚠️ No (use .cmo3 instead) |
| Bone weight baking | ⚠️ No (use .cmo3 instead) |

**Note:** While rotation parameter curves are exported to `.motion3.json`, the rotation deformers are not yet implemented in the `.moc3` binary writer. For rotation and deformation animation, use the .cmo3 project export instead.

### 2. Live2D Project (.cmo3)

**What it is:** Editable project file for Cubism Editor 5.0, with animation support.

**Output:**
- **Without animations:** Single `.cmo3` file
- **With animations:** ZIP containing `.cmo3` (model) + `.can3` (animation)

**Workflow:**
1. Export project from Stretchy Studio
2. Open `.cmo3` in Cubism Editor 5.0
3. Edit, adjust, add physics or expressions
4. Publish final model(s) for runtime use

**Feature Support:**
| Feature | Supported |
|---------|-----------|
| Mesh geometry | ✅ Yes |
| Textures (per-mesh) | ✅ Yes |
| Part hierarchy (groups) | ✅ Yes |
| Rotation deformers | ✅ Yes |
| Rotation animation | ✅ Yes |
| Mesh warp deformation | ✅ Yes |
| Mesh warp animation | ✅ Yes |
| Bone weight baking | ✅ Yes (elbow/knee bending) |
| Opacity animation | ✅ Yes |
| Parameter groups | ⚠️ Basic (no LipSync/EyeBlink pre-groups) |
| Physics | ❌ No (add manually in Cubism Editor) |
| Expressions (.exp3.json) | ❌ No (add manually in Cubism Editor) |

**Recommendations:**
- Use this format for animation-heavy characters
- Rotation deformers auto-created for all groups
- All mesh deformation is preserved and animatable
- Bone weights allow natural limb bending without mesh seams

---

## Technical Details

### File Locations

| Component | File |
|-----------|------|
| Main orchestrator | `src/io/live2d/exporter.js` |
| MOC3 binary writer | `src/io/live2d/moc3writer.js` |
| CMO3 XML generator | `src/io/live2d/cmo3writer.js` |
| CAN3 animation generator | `src/io/live2d/can3writer.js` |
| Model3 JSON | `src/io/live2d/model3json.js` |
| Motion3 JSON | `src/io/live2d/motion3json.js` |
| Display info (CDI3) | `src/io/live2d/cdi3json.js` |
| Texture atlas packer | `src/io/live2d/textureAtlas.js` |
| CAFF archive packer | `src/io/live2d/caffPacker.js` |
| XML utilities | `src/io/live2d/xmlbuilder.js` |
| UI component | `src/components/export/ExportModal.jsx` |

### Data Mapping

**Stretchy Studio → Live2D Concepts:**

| SS Concept | MOC3 | CMO3 |
|-----------|------|------|
| Part (no mesh) | — | CPartSource (visibility) |
| Part (with mesh) | ArtMesh | CArtMeshSource |
| Group | Part | CPartSource + CRotationDeformerSource |
| Group rotation track | — | CRotationDeformerSource + animation |
| Mesh opacity track | Part opacity | ArtMesh opacity |
| Mesh vertices track | — | Warp deformer + animation |
| Texture | Atlas region | CLayer + CImageResource |
| Bone weights | — | Keyform array (baked) |
| Animation clip | — | CAnimationSource (.can3) |

### Texture Atlas Packing

Stretchy Studio uses **MaxRects BSSF (Best Short Side Fit)** with binary search for scale factor. This replicates Cubism Editor's atlas optimization behavior.

**Algorithm:**
1. Extract opaque bounds from each part's texture
2. Binary search for maximum uniform upscale that fits in atlas
3. Sort parts by max scaled dimension (descending)
4. Pack using MaxRects BSSF
5. Output as PNG atlases (default 2048×2048)

### Bone Weight Baking

For `.cmo3` export with bone-weighted meshes (e.g., arms with elbow):

1. Each vertex carries a bone weight (0.0–1.0)
2. At rest pose (no rotation), vertices render at their original positions
3. When bone rotates, vertices deform via weighted blend of positions
4. This is encoded as multiple **keyforms** (poses) in the `.cmo3`
5. Live2D renders the correct keyform based on deformer parameter value

**Result:** Smooth limb bending without mesh seams (elbow/knee joints bend naturally).

---

## Known Limitations

### MOC3 Runtime Export
- ❌ **No rotation deformers** — rotation parameters are created but unbound (silently ignored at runtime)
- ❌ **No mesh deformation animation** — mesh_verts tracks are mapped to parameters that don't exist
- ❌ **Limited to opacity animation** — only opacity keyframes actually drive visual changes

**Workaround:** Use .cmo3 project export for animation work.

### CMO3 Project Export
- ❌ **No physics** — hair/clothing physics must be added in Cubism Editor
- ❌ **No expressions** (.exp3.json) — add manually in Cubism Editor
- ❌ **No pose groups** (.pose3.json) — outfit toggles not supported
- ⚠️ **Merged limb meshes** — single `legwear` layer cannot animate left/right knees independently (split into `legwear_l`/`legwear_r`)

---

## Workflow Recommendations

### For Deployment (Game/App)

1. **Create character in Stretchy Studio** with meshes and basic setup
2. **Export as .cmo3 project**
3. **Open in Cubism Editor** for final polish (physics, expressions, parameter groups)
4. **Publish from Editor** to get final `.moc3` + assets
5. **Integrate .moc3 into game engine**

### For Animation-Focused Work

1. **Use .cmo3 project export** (full rotation + deformation support)
2. **Create animations in Cubism Editor** or via `.can3` curves
3. **Test in Cubism Viewer**
4. **Export final models** from Editor for runtime use

### For Quick Runtime Testing

1. **Export as .moc3 runtime** from Stretchy Studio
2. **Load into Cubism SDK app or game engine**
3. **Note:** Rotation/deformation animation won't work; use .cmo3 if needed

---

## UI Warnings

The **Export Modal** displays helpful warnings:

- ✅ `.cmo3 project export` — Full feature set, editable in Cubism Editor
- ⚠️ `.moc3 runtime export` — Limited to opacity animation; recommend `.cmo3` for rotation/deformation

---

## Implementation Notes

### Coordinate Space Handling

Live2D uses different coordinate systems for different file types:

- **Canvas space:** Top-left origin, Y-down (same as Stretchy Studio)
- **Deformer-local space:** Relative to deformer origin (used internally in `.cmo3`)

The exporters handle this automatically — mesh UVs and rendering positions are correctly transformed based on context.

### Parameter Generation

- **MOC3:** Reads from `project.parameters[]` (user-defined list)
- **CMO3:** Auto-generates `ParamRotation_*` and `ParamDeform_*` from group/mesh structure

For custom parameters to work in `.moc3`, add them to the project's parameter list.

### Animation Track Properties

Supported track properties for animation export:

| Property | MOC3 | CMO3 | Notes |
|----------|------|------|-------|
| `opacity` | ✅ | ✅ | Part/mesh opacity |
| `rotation` | ⚠️ (unbound) | ✅ | Group rotation (CMO3 only) |
| `mesh_verts` | ⚠️ (unbound) | ✅ | Mesh warp deformation (CMO3 only) |
| `x`, `y`, `scale*` | ❌ | ❌ | Not exported (use root group offset) |

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| Mesh rendered upside down or backwards | Vertex order issue | Re-generate mesh in Stretchy Studio |
| Wrong texture on mesh | Texture ID mismatch | Ensure part.textureId matches a loaded texture |
| Rotation not working in .moc3 | Rotation deformers not supported | Use .cmo3 project export instead |
| Elbow/knee bends wrong | Bone weights not baked | Ensure mesh has `boneWeights` array (generated in mesh editor) |
| .cmo3 opens as "(Recovered)" | XML schema mismatch | Check Cubism Editor version (5.0+); regenerate export |
| Missing parameters in .can3 | No animation tracks on groups | Add rotation keyframes to groups in animation timeline |

---

## Version History

- **2026-04-15:** Initial implementation
  - MOC3 runtime export (.moc3 + atlas + .motion3.json)
  - CMO3 project export (.cmo3 + .can3)
  - Texture atlas packing (MaxRects BSSF)
  - Bone weight baking for limb deformation
  - UI warnings for limited MOC3 feature support

