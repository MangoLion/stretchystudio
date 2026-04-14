# .moc3 Binary Format Documentation

> **Status**: Validated — our JS moc3writer generates .moc3 files that pass `csmHasMocConsistency` and render correctly in Cubism Viewer 5.0 (confirmed 2026-04-14).

Each field includes a source tag:
- `[ref]` — observed in Hiyori reference file
- `[re]` — from IDA Pro reverse engineering of Live2DCubismCoreJNI.dll
- `[py-moc3]` — from Ludentes/py-moc3 (verified read+write)
- `[empirical]` — determined experimentally in Session 1–2

---

## Overview

- **Byte order**: Little-endian `[ref][py-moc3]`
- **Alignment**: Sections aligned to 64-byte boundaries `[py-moc3]`
- **Storage model**: Struct-of-arrays — one property for all items of a type stored contiguously `[py-moc3]`
- **Reference file**: `hiyori_pro_t11.moc3` — 444,480 bytes, V4.00 `[ref]`

## Header (64 bytes, offset 0x00)

| Offset | Size | Type    | Value | Description | Source |
|--------|------|---------|-------|-------------|--------|
| 0x00   | 4    | char[4] | "MOC3" | Magic bytes | [ref] |
| 0x04   | 1    | uint8   | 1–5   | Version (see below) | [ref][py-moc3] |
| 0x05   | 1    | uint8   | 0x00  | Big-endian flag (0=LE) | [py-moc3] |
| 0x06   | 58   | —       | 0x00  | Padding | [ref] |

### Version mapping

| Value | Cubism version | Extra sections | Source |
|-------|---------------|----------------|--------|
| 1     | V3.00 | — | [py-moc3] |
| 2     | V3.03 | + quad_transforms (SOT[101]) | [py-moc3] |
| 3     | V4.00 | + quad_transforms | [py-moc3] |
| 4     | V4.02 | + color blend, extended keyforms | [py-moc3] |
| 5     | V5.00 | + additional blend modes | [py-moc3] |

We export **version 3 (V4.00)** — matches Hiyori, works with Ren'Py 8.5 Cubism SDK.

## Binary Layout

```
[0x0000 .. 0x0040)  Header (64 bytes)
[0x0040 .. 0x02C0)  Section Offset Table (SOT): 160 × uint32 (640 bytes)
[0x02C0 .. 0x07C0)  Reserved (runtime pointer array used by SDK after csmReviveMocInPlace)
[0x07C0 .. EOF)     Body: count info, canvas info, then 99 typed-array sections
```

Constants: `HEADER_SIZE=64, SOT_COUNT=160, SOT_SIZE=640, COUNT_INFO_SIZE=128, DEFAULT_OFFSET=1984 (0x7C0)` `[py-moc3]`

## Section Offset Table (SOT)

160 × uint32 at offset 0x40. Each entry is an absolute byte offset from file start.

| SOT Index | Points to | Source |
|-----------|----------|--------|
| 0 | Count Info (at 0x7C0) | [py-moc3] |
| 1 | Canvas Info | [py-moc3] |
| 2–100 | 99 body sections (SECTION_LAYOUT order) | [py-moc3] |
| 101 | V3.03+ quad_transforms section | [py-moc3][empirical] |
| 102+ | V4.02+/V5.00+ additional sections | [re] |

**Critical**: All SOT entries used by the current version must be **non-zero** valid offsets. The SDK rejects files with `SOT[i] == 0` for version-required entries. For V4.00, SOT[0..101] must all be valid. Fill unused entries with the last valid body offset. `[empirical]`

## Count Info Table (23 entries)

| Index | Name | True meaning | Source |
|-------|------|-------------|--------|
| 0 | PARTS | Number of visibility groups | [py-moc3] |
| 1 | DEFORMERS | Total deformers (warp + rotation) | [py-moc3] |
| 2 | WARP_DEFORMERS | Grid-based deformers | [py-moc3] |
| 3 | ROTATION_DEFORMERS | Pivot-based deformers | [py-moc3] |
| 4 | ART_MESHES | Textured mesh drawables | [py-moc3] |
| 5 | PARAMETERS | Animatable parameters | [py-moc3] |
| 6 | PART_KEYFORMS | Part keyform entries | [py-moc3] |
| 7 | WARP_DEFORMER_KEYFORMS | | [py-moc3] |
| 8 | ROTATION_DEFORMER_KEYFORMS | | [py-moc3] |
| 9 | ART_MESH_KEYFORMS | | [py-moc3] |
| 10 | KEYFORM_POSITIONS | Vertex XY pairs for keyforms | [py-moc3] |
| 11 | KEYFORM_BINDING_INDICES | | [py-moc3] |
| 12 | KEYFORM_BINDING_BANDS | | [py-moc3] |
| 13 | KEYFORM_BINDINGS | | [py-moc3] |
| 14 | KEYS | Parameter values at keyform stops | [py-moc3] |
| 15 | UVS | = sum(position_index_counts × 2) | [empirical] |
| 16 | POSITION_INDICES | = sum(vertex_counts) = total flat indices | [empirical] |
| 17 | DRAWABLE_MASKS | Must be ≥ 1 (see validator rules) | [empirical] |
| 18 | DRAW_ORDER_GROUPS | | [py-moc3] |
| 19 | DRAW_ORDER_GROUP_OBJECTS | | [py-moc3] |
| 20 | GLUES | | [py-moc3] |
| 21 | GLUE_INFOS | | [py-moc3] |
| 22 | GLUE_KEYFORMS | | [py-moc3] |

## Canvas Info (64 bytes)

| Field | Type | Description |
|-------|------|-------------|
| pixels_per_unit | float32 | Scale factor (typically = max(width, height)) |
| origin_x | float32 | Canvas origin X (typically width/2) |
| origin_y | float32 | Canvas origin Y (typically height/2) |
| canvas_width | float32 | Width in model units |
| canvas_height | float32 | Height in model units |
| canvas_flag | uint8 | Flags (usually 0) |
| (padding) | — | Zero-fill to 64 bytes |

## ArtMesh Field Semantics

> **The .moc3 field names are counterintuitive.** This was the primary blocker for Session 1–2. Confirmed via Hiyori analysis. `[empirical]`

| .moc3 field name (misleading) | True meaning | Stretchy Studio source | Evidence |
|-------------------------------|-------------|----------------------|----------|
| `art_mesh.vertex_counts` | **Flat triangle index count** (triangles × 3) | `mesh.triangles.length * 3` | `sum(vc) == counts[16]` in Hiyori |
| `art_mesh.position_index_counts` | **Rendering vertex count** | `mesh.vertices.length` | `uv_begin == cumul(pic×2)` in Hiyori; `csmGetDrawableVertexCounts` returns these |
| `art_mesh.uv_begin_indices` | cumulative(**position_index_counts** × 2) | — | Verified in Hiyori: uv_begin[1] = pic[0]×2 |
| `art_mesh.position_index_begin_indices` | cumulative(**vertex_counts**) | — | Verified in Hiyori: pib[1] = vc[0] |

**Cross-reference formulas:**
```
counts[15] (UVS)             = sum(position_index_counts × 2)  // total UV floats
counts[16] (POSITION_INDICES) = sum(vertex_counts)              // total flat indices
counts[10] (KEYFORM_POSITIONS) = sum(position_index_counts × 2)  // for no-deformer models
```

## Section Layout (99 base + 1 V3.03+ additional)

99 body sections at SOT[2..100], plus `additional.quad_transforms` at SOT[101] for V3.03+.

**Parts** (count=PARTS, 8 sections): runtime_space, ids, keyform_binding_band_indices, keyform_begin_indices, keyform_counts, visibles, enables, parent_part_indices

**Deformers** (count=DEFORMERS, 9 sections): runtime_space, ids, keyform_binding_band_indices, visibles, enables, parent_part_indices, parent_deformer_indices, types, specific_indices

**Warp Deformers** (count=WARP_DEFORMERS, 6 sections): keyform_binding_band_indices, keyform_begin_indices, keyform_counts, vertex_counts, rows, cols

**Rotation Deformers** (count=ROTATION_DEFORMERS, 4 sections): keyform_binding_band_indices, keyform_begin_indices, keyform_counts, base_angles

**ArtMeshes** (count=ART_MESHES, 20 sections): runtime_space ×4, ids, keyform_binding_band_indices, keyform_begin_indices, keyform_counts, visibles, enables, parent_part_indices, parent_deformer_indices, texture_indices, drawable_flags, **position_index_counts**, uv_begin_indices, position_index_begin_indices, **vertex_counts**, mask_begin_indices, mask_counts

**Parameters** (count=PARAMETERS, 9 sections): runtime_space, ids, max_values, min_values, default_values, repeats, decimal_places, keyform_binding_begin_indices, keyform_binding_counts

**Part Keyforms** (1 section): draw_orders

**Warp Deformer Keyforms** (2 sections): opacities, keyform_position_begin_indices

**Rotation Deformer Keyforms** (7 sections): opacities, angles, origin_xs, origin_ys, scales, reflect_xs, reflect_ys

**ArtMesh Keyforms** (3 sections): opacities, draw_orders, keyform_position_begin_indices

**Keyform Positions** (1 section): xys (flat float32 pairs)

**Keyform Binding** (6 sections): binding_index.indices, binding_band.begin_indices, binding_band.counts, binding.keys_begin_indices, binding.keys_counts, keys.values

**UVs** (1 section): xys (flat float32 pairs)

**Position Indices** (1 section): indices (int16, triangle vertex indices)

**Drawable Masks** (1 section): art_mesh_indices

**Draw Order Groups** (5 sections): object_begin_indices, object_counts, object_total_counts, min_draw_orders, max_draw_orders

**Draw Order Group Objects** (3 sections): types, indices, group_indices

**Glue** (9+2+1 = 12 sections): runtime_space, ids, keyform_binding_band_indices, keyform_begin_indices, keyform_counts, art_mesh_index_as, art_mesh_index_bs, info_begin_indices, info_counts, glue_info.weights, glue_info.position_indices, glue_keyform.intensities

**V3.03+ Additional** (SOT[101]): quad_transforms (Bool32 per warp deformer)

## SDK Validation Rules

From IDA RE of `Live2DCubismCoreJNI.dll`. See `IDA_SESSIONS.md` for full details.

### `csmHasMocConsistency` — two-phase check
1. **Header validation** (`sub_1800050D0`): all SOT offsets within file bounds
2. **Data validation** (`sub_180004050`): all cross-references consistent (~3000 lines)

### Begin/Count validator quirk `[empirical]`

The SDK's `sub_1800079F0` checks `begin < total` **even when count=0**:
```c
for (i = 0; i < n; i++) {
    if (begins[i] >= total) return 0;  // FAILS even if counts[i] == 0!
}
```

**Consequences:**
- `mask_begin_indices` cannot be -1 if `DRAWABLE_MASKS=0` → set `DRAWABLE_MASKS=1` with dummy entry `[-1]`
- Null binding bands for parts: `begin` must be `0` (not `N`), because `N >= N` fails
- Any begin/count pair where total=0 will ALWAYS fail → ensure total ≥ 1

### Validated rules

| Check | Rule | Source |
|-------|------|--------|
| ID strings | strnlen < 64 (null-terminated) | [re] |
| Bool fields | visibles, enables, repeats: must be 0 or 1 | [re] |
| Parent indices | parent_part in [-1, parts-1], parent_deformer in [-1, deformers-1] | [re] |
| Begin/Count | `begin >= 0 && begin < total && begin + count <= total` | [re][empirical] |
| Warp grid | `vertex_count == (rows+1) * (cols+1)` | [re] |
| Draw order | type 0 → index < art_meshes; type 1 → index < parts | [re] |
| group_indices | must be in [-1, draw_order_groups-1] | [re] |
| V3.03+ quad | must be 0 or 1 | [re] |
| SOT entries | all version-required entries must be non-zero and < file_size | [empirical] |

## py-moc3 Tool Reference

**Install**: `pip install py-moc3` (Python, zero dependencies)

```python
from moc3 import Moc3

moc = Moc3.from_file("model.moc3")
print(moc.summary())
moc["art_mesh.ids"]              # list[str]
moc["art_mesh.vertex_counts"]    # list[int] — FLAT INDEX COUNTS, not vertices!
moc.counts                       # list[int] — mutable count info table
moc.canvas.pixels_per_unit       # float
moc.to_file("modified.moc3")
```

**py-moc3 quirks:**
- `counts` must be updated manually when changing array sizes (not auto-synced)
- Round-trip of existing files is byte-identical (after our quad_transforms fix)
- Can create valid from-scratch models by modifying a known-good base file

## Hiyori Reference Data

```
MOC3 v3 (LE) — V4.0
Canvas: 2976×4175, PPU=2976, origin=(1488, 2087.5)
Parts: 24, Deformers: 104 (Warp: 50, Rot: 54), ArtMeshes: 134
Parameters: 70, Glues: 26
KF Positions: 80400, UVs: 5644, Position Indices: 10278
```

## Test Harness

`docs/live2d-export/scripts/test_swapped.py` — Python script that:
1. Loads Hiyori as base via py-moc3
2. Injects girl mesh data with correct field mapping
3. Validates via Cubism Core DLL (`D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll`)
4. Reports drawable count, vertex positions, UVs
