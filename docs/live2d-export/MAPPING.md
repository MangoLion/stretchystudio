# Data Mapping: Stretchy Studio → Live2D Cubism

How each Stretchy Studio entity converts to its Live2D counterpart.

---

## Node types

### Part node (`type: 'part'`, with mesh) → ArtMesh

> In Stretchy Studio, "Part" is a visible layer with mesh data. In Live2D, this becomes an **ArtMesh** (drawable). Don't confuse with Live2D "Part" which is a visibility group (= SS Group).

| Stretchy Studio field | Live2D .moc3 field | Notes |
|-----------------------|-------------------|-------|
| `node.id` | `art_mesh.ids` (ArtMesh0, ArtMesh1...) | We generate sequential IDs |
| `node.name` | Display name in `.cdi3.json` | Human-readable name |
| `mesh.vertices.length` | `art_mesh.position_index_counts` | **Rendering vertex count** (field name is misleading!) |
| `mesh.triangles.length * 3` | `art_mesh.vertex_counts` | **Flat index count** (field name is misleading!) |
| `mesh.vertices` (positions) | `keyform_position.xys` | Normalized: (px - origin) / PPU |
| `mesh.uvs` | `uv.xys` | Remapped from PSD-space to atlas-space |
| `mesh.triangles` (flattened) | `position_index.indices` | I16 triangle vertex indices |
| `node.opacity` | `art_mesh_keyform.opacities` | 0–1 float |
| `node.visible` | `art_mesh.visibles` | Bool (0 or 1) |
| `node.parent` (group ref) | `art_mesh.parent_part_indices` | Index into parts array |
| Texture atlas | `art_mesh.texture_indices` | Atlas sheet index |
| — | `art_mesh.drawable_flags` | Always 4 (Hiyori pattern) |

### Group node (`type: 'group'`) → Part

| Stretchy Studio field | Live2D field | Notes |
|-----------------------|-------------|-------|
| `node.id` | Part ID (64-byte MOC3Id) | |
| `node.name` | Display name in `.cdi3.json` | |
| `node.parent` | Parent Part index | Nested group hierarchy |
| `node.opacity` | Part default opacity | |
| `node.visible` | Part visibility flag | |

## Transforms

Stretchy Studio uses a **bone/skeleton** system. Live2D uses **parameter-driven deformers**.

This is the hardest mapping problem. Options:
1. **Direct vertex baking** — for each animation frame, compute final vertex positions and store as parameter keyforms. Simple but loses interactive control.
2. **Parameter mapping** — map bone angles/positions to Live2D parameters, create deformer keyforms. Preserves interactivity but requires heuristics.

**Current plan**: Start with approach #1 (vertex baking) for MVP. Revisit #2 later.

## Animations → .motion3.json

| Stretchy Studio | Live2D motion3 | Notes |
|-----------------|---------------|-------|
| `animation.duration` | `Meta.Duration` (seconds) | Convert ms → s |
| `animation.fps` | `Meta.Fps` | Direct map |
| `animation.tracks` | `Curves[]` | One curve per parameter per track |
| Track keyframes | `Segments[]` | Segment encoding: 0=linear, 1=bezier, 2=stepped, 3=inverse-stepped |

### Segment encoding in .motion3.json

From reference file analysis:
- Flat array of numbers
- First value: initial time
- Second value: initial value  
- Then repeating: `[segmentType, ...controlPoints]`
  - Type 0 (linear): `0, time, value` (2 points)
  - Type 1 (bezier): `1, cx1, cy1, cx2, cy2, time, value` (6 points)
  - Type 2 (stepped): `2, time, value` (2 points)
  - Type 3 (inverse stepped): `3, time, value` (2 points)

## Parameters

| Stretchy Studio | Live2D | Notes |
|-----------------|--------|-------|
| `project.parameters` | Parameter entries in .moc3 + .cdi3.json | ID, min, max, default |

## Textures → Texture Atlas

Stretchy Studio stores individual texture images. Live2D expects packed texture atlases (power-of-2 dimensions, typically 2048x2048 or 4096x4096).

**Pipeline**: Individual textures → atlas packing → single/multiple PNG files + UV remapping.

## Physics → .physics3.json

| Stretchy Studio | Live2D | Notes |
|-----------------|--------|-------|
| `project.physics_groups` | PhysicsSettings[] | TBD — need to study physics group structure |

## Files generated per export

| File | Required | Content |
|------|----------|---------|
| `*.model3.json` | Yes | Manifest: references all other files |
| `*.moc3` | Yes | Binary model data |
| `*.png` (texture atlas) | Yes | Packed textures |
| `*.motion3.json` | Optional | Animation data |
| `*.physics3.json` | Optional | Physics simulation |
| `*.pose3.json` | Optional | Pose groups (arm switching etc.) |
| `*.cdi3.json` | Optional | Display info (human-readable names) |
| `*.exp3.json` | Optional | Expressions |
