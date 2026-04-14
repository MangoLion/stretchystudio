# IDA Pro Analysis Sessions Log

## Session 1: CubismViewer5 — Consistency Validation (2026-04-13)

**Binary**: `C:\Program Files\Live2D Cubism 5.0\app\dll64\Live2DCubismCoreJNI.dll`  
**Purpose**: Understand why our generated .moc3 files fail to load in Cubism Viewer 5.0

### Key Functions Found

#### `csmReviveMocInPlace` (0x180003580)
Entry point for loading .moc3 into memory.
- Checks `address` is 64-byte aligned
- Checks `size` is 64-byte aligned  
- Calls `sub_180008B00` (main parser)

#### Main Parser (0x180008B00)
```
1. strncmp(data, "MOC3", 4) — magic check
2. data[4] <= 5 — version check (max V5.00)
3. sub_180003700(data, data+704) — SOT offset resolver
4. sub_1800076C0(data) — post-processing (runtime space init, UV flip)
```

#### `csmHasMocConsistency` (0x1800033F0 → 0x180007530)
Called by Cubism Viewer before loading. Two-phase validation:
1. `sub_1800050D0` — **Header section validation** (SOT offset range checks)
2. `sub_180004050` — **Data section validation** (cross-reference consistency)

If either fails → "File read error" in Cubism Viewer.

### SOT Resolver (0x180003700) — Version-Dependent Offsets

The SOT is read as a flat array starting at offset 64. The resolver maps SOT entries into an internal 152-element pointer array (`a2[0..151]`).

**Base layout (V3.00, version=1)**: SOT[0..80] → 81 offsets  
**V3.03+ (version>=2)**: +1 offset: `a2[26] = SOT[81]` (warp_deformer.is_quad_source)  
**V4.02+ (version>=4)**: +35 offsets (color blend, extended keyforms, etc.)  
**V5.00+ (version>=5)**: +15 offsets (additional blend modes)

### Validation Helpers

#### `sub_1800074C0(count, ids_ptr)` — ID String Validator
Checks that each 64-byte ID string field has `strnlen < 64` (is null-terminated).
```c
for (i = 0; i < count; i++)
    if (strnlen(ids_ptr + i * 64, 64) >= 64) return 0; // FAIL
return 1; // OK
```

#### `sub_1800079F0(count, begins, counts, min_val, total)` — Begin/Count Range Validator
For each element: validates that `begin >= 0`, `count >= 0`, `begin + count <= total`, and `begin >= min_val`.
```c
for (i = 0; i < count; i++) {
    cnt = counts[i];
    beg = begins[i];
    if (cnt < 0 || cnt > total) return 0;
    if (beg < min_val || beg >= total) return 0;
    if (beg + cnt > total) return 0;
}
return 1;
```

#### `sub_180007A70(count, indices, begins, counts, min_val, total)` — Indexed Begin/Count Validator
Same as above but dereferences through an index array first:
```c
for (i = 0; i < count; i++) {
    idx = indices[i];
    cnt = counts[idx];
    beg = begins[idx];
    // same range checks as sub_1800079F0
}
return 1;
```

### Data Section Validator (0x180004050) — What It Checks

This is a massive function (~3000 lines decompiled) that validates ALL cross-references in the .moc3 data. The checks follow this pattern:

`v4 = counts array (23 int values)`  
`a3 = section pointers array (from SOT resolver)`

**Validation order** (each step returns 0 on failure):

1. **Parts**: 
   - `sub_1800074C0(parts_count, part_ids)` — ID string validity
   - `part.parent_part_indices[i]` must be in range `[-1, parts_count-1]`
   - `part.visibles[i]` must be 0 or 1
   - `part.enables[i]` must be 0 or 1
   - `sub_1800079F0(parts, keyform_begin, keyform_count, 0, part_keyforms_total)` — keyform range check

2. **Deformers**:
   - ID validity, parent_part range, parent_deformer range
   - `deformer.types[i]`: if 0 → `specific_idx < warp_count`, if 1 → `specific_idx < rotation_count`
   - Visibles/enables: 0 or 1

3. **Warp Deformers**:
   - `sub_1800079F0(warp_count, kf_begin, kf_count, 0, warp_kf_total)`
   - `rows[i] > 0 && cols[i] > 0`
   - `vertex_counts[i] == (rows[i]+1) * (cols[i]+1)` — **CRITICAL**: vertex count must match grid dimensions

4. **Rotation Deformers**:
   - `sub_1800079F0(rot_count, kf_begin, kf_count, 0, rot_kf_total)`

5. **ArtMeshes**:
   - `sub_1800074C0(mesh_count, mesh_ids)` — ID validity
   - `sub_1800079F0(mesh_count, kf_begin, kf_count, 0, mesh_kf_total)` — keyform range
   - `visibles[i]` and `enables[i]` must be 0 or 1
   - `parent_part_indices[i]` in `[-1, parts_count-1]`
   - `parent_deformer_indices[i]` in `[-1, deformers_count-1]`
   - `texture_indices[i]` in valid range (checked against some limit)
   - `vertex_counts[i] + 2 * position_index_counts[i]` range check vs keyform_positions
   - `uv_begin + vertex_count*2 <= total_uvs`
   - `position_index_begin + count <= total_indices`

6. **Parameters**:
   - ID validity
   - `repeats[i]` must be 0 or 1
   - `decimal_places[i] >= 0`
   - `sub_1800079F0(param_count, binding_begin, binding_count, 0, total_bindings)`

7. **Keyform Binding Chain**:
   - `binding_index.indices[i]` in range `[0, total_bindings-1]`
   - `sub_1800079F0(bands_count, band_begin, band_count, 0, binding_indices_count)` 
   - `sub_1800079F0(bindings_count, keys_begin, keys_count, 0, total_keys)`

8. **Draw Order Groups**:
   - `group_object.types[i]` must be 0 or 1
   - If type==0: `index < art_mesh_count`. If type==1: `index < parts_count`
   - `group_indices[i]` in `[-1, draw_order_groups_count-1]`

9. **Drawable Masks**:
   - `art_mesh_indices[i]` in `[-1, art_mesh_count-1]`

10. **Glues** (if present):
    - ID validity, art_mesh index ranges, info begin/count ranges

11. **V3.03+**: `quad_transforms[i]` must be 0 or 1 (Bool32)

12. **V4.02+**: Additional color blend and extended keyform checks

13. **V5.00+**: Additional blend mode checks

### Key Insight: What Fails For Our Model

Our model likely fails at step **7 (Keyform Binding Chain)** or step **5 (ArtMeshes)**. The `sub_1800079F0` helper checks that `begin + count <= total` for every element. If we have:
- `art_mesh.keyform_binding_band_indices[i] = 0`  
- `band.counts[0] = 0` (null band)
- But `binding_indices_count = 0`

Then `sub_1800079F0(bands_count=1, band_begin=[0], band_count=[0], 0, binding_indices_count=0)`:
- `cnt = 0, beg = 0, total = 0`
- Check: `beg + cnt <= total` → `0 + 0 <= 0` → `0 <= 0` → **PASS**

So null band should be fine. The failure might be in `sub_1800050D0` (header section validation) which checks that SOT offsets are within file bounds and properly aligned.

### Debugger Session: Finding Exact Validation Failure

**Setup**: Attached IDA debugger to running CubismViewer5.exe (java.exe process). DLL loaded at ASLR base `0x7FFF2B240000` (delta from IDB base `0x180000000`).

**Method**: Set breakpoints on `loc_7FFF2B2450A9` (FAIL target) and `loc_7FFF2B2450A2` (SUCCESS) in `validate_data_section`.

**Result**: FAIL at `validate_data_section+4F3` → the check:
```asm
lea  r9d, [rax+rcx*2]   ; r9 = position_index_begin + position_index_count * 2
cmp  r9d, [rbx+3Ch]     ; compare with counts[15] (total UVs)
jg   FAIL                ; if r9 > total_UVs -> FAIL
```

**Root cause**: `art_mesh.position_index_counts` stored flat index count (6 for 2 triangles) instead of **triangle count** (2). SDK formula: `uv_begin + tri_count * 2 <= total_UVs`. With tri_count=2: `0 + 2*2 = 4 <= 8` → PASS. With flat_count=6: `0 + 6*2 = 12 > 8` → FAIL.

**Also discovered**: `art_mesh.position_index_begin_indices` stores **cumulative vertex count** across meshes, not cumulative flat index count. Confirmed by Hiyori: mesh0 begin=0, mesh1 begin=96 (= mesh0 vertex_count).

**After fix**: Minimal model passes `validate_data_section` (breakpoint hit SUCCESS path). But crashes during render (null pointer dereference at offset 0x8) — likely because py-moc3 from-scratch files have incorrect runtime space or missing initialization data.

### TODO for Next Session

- [x] ~~Debug render crash~~ — Root cause was wrong field mapping, not runtime issue
- [x] Ren'Py `Live2DCubismCore.dll` via ctypes — WORKS, used as primary test tool
- [x] Modify working Hiyori .moc3 — approach that produced first passing model
- [ ] IDB saved at: `C:\Program Files\Live2D Cubism 5.0\app\dll64\Live2DCubismCoreJNI.dll.i64`

---

## Session 2: Cubism Core ctypes + Field Mapping Discovery (2026-04-14)

**Binary**: `D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll`  
**Purpose**: Validate .moc3 files without CubismViewer, find root cause of consistency failure

### ctypes Test Harness

Loaded Ren'Py's `Live2DCubismCore.dll` via Python ctypes. Full pipeline:
```
csmGetVersion → csmHasMocConsistency → csmReviveMocInPlace → 
csmGetSizeofModel → csmInitializeModelInPlace → csmUpdateModel →
csmGetDrawableVertexPositions/Uvs/Counts
```

All buffers must be 64-byte aligned. File size must be padded to 64-byte multiple.

### Root Cause: Field Name Swap

The Session 1 fix ("position_index_counts = triangle count") was **WRONG**.

Hiyori RE analysis proved the correct mapping:

```
art_mesh.vertex_counts       = FLAT TRIANGLE INDEX COUNT (not unique vertices!)
art_mesh.position_index_counts = RENDERING VERTEX COUNT (not triangle count!)
```

Evidence:
- `sum(vertex_counts) == counts[16]` (POSITION_INDICES) in Hiyori
- `uv_begin == cumulative(position_index_counts * 2)` in Hiyori  
- `csmGetDrawableVertexCounts` returns position_index_counts values
- Keyform position span per mesh ≠ vertex_counts * 2 (but related to pic for no-deformer meshes)

### SDK Validator Quirks Discovered

1. **begin < total check even when count=0**: `sub_1800079F0` always checks `begin >= total`, even if the element's count is 0. This means:
   - `mask_begin_indices = -1` with `total_masks = 0` → FAIL (-1 < 0 fails min_val check)
   - `mask_begin_indices = 0` with `total_masks = 0` → FAIL (0 >= 0 fails)
   - Fix: set `DRAWABLE_MASKS = 1` (dummy entry) and `mask_begin = 0`
   - Same issue for binding band begins: parts with `begin = N` where `total_bind_idx = N` → FAIL
   - Fix: null band begin must be `0` (not `N`), ensuring `0 < N`

2. **SOT entries must be < file_size**: Even for zero-count sections at end of file, the SOT offset must point within the file. Add 64 bytes of padding at EOF.

### Bisecting Methodology

Used progressive field replacement (working synthetic model → girl's data) to isolate the exact failing field. Key test results:
- 20-mesh synthetic quads: PASS
- Girl vertex_counts only (inconsistent cross-refs): FAIL  
- Girl big data only (UVs, positions, indices): PASS
- Girl with SWAPPED vertex_counts/position_index_counts + correct cross-refs: **PASS**

### Final Validated Model

`girl_v4.moc3`: 20 drawables, created from Hiyori base with girl's mesh data injected using correct field mapping. Passes `csmHasMocConsistency`, loads, initializes, and renders via Cubism Core DLL.

Test script: `docs/live2d-export/test_swapped.py`
