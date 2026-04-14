# Live2D Keyform Binding System

Understanding gained from Hiyori reference analysis + crash debugging.

## Why Bindings Are Required

Without keyform bindings (band_count=0 for all drawables), Cubism SDK loads the model but **does not apply keyform_position.xys** to vertices. The model renders with default/zero positions — geometry appears as collapsed triangles or is invisible.

**Rule: every visible ArtMesh MUST have a keyform binding** (or a parent deformer that has one).

## Binding Chain

```
ArtMesh
  → keyform_binding_band_indices[mesh_idx] → band_idx
    → keyform_binding_band.begin_indices[band_idx] → bind_start
    → keyform_binding_band.counts[band_idx] → bind_count
      → keyform_binding_index.indices[bind_start..bind_start+bind_count-1] → binding_idx
        → keyform_binding.keys_begin_indices[binding_idx] → key_start
        → keyform_binding.keys_counts[binding_idx] → key_count
          → keys.values[key_start..key_start+key_count-1] → parameter values

Parameter
  → keyform_binding_begin_indices[param_idx] → binding_start
  → keyform_binding_counts[param_idx] → num_bindings
  → owns bindings[binding_start..binding_start+num_bindings-1]
```

## Critical Rules (from Hiyori analysis + crash debugging)

### 1. keys_count MUST equal keyform_count

For a mesh with `keyform_count=N` and a binding with `keys_count=K`:
- `K` MUST equal `N`
- Each key value corresponds to one keyform
- For single-keyform static meshes: keyform_count=1, keys_count=1

### 2. Parts MUST use null bands (count=0)

In Hiyori, ALL 24 parts have band_count=0. Parts never have direct parameter bindings.
**Crash cause: sharing a non-null band between Part and ArtMesh crashes Cubism SDK.**

### 3. Band separation

- ArtMesh bands: indices 0..N-1, each with count=1 (or 0 for unbound static meshes)
- Part bands: indices N..N+P-1, ALL with count=0

### 4. For static models (1 keyform, no animation)

Minimal binding per ArtMesh:
- 1 band (count=1) → 1 binding_index → 1 binding (keys_count=1) → 1 key at parameter default value
- Parameter: owns that binding (binding_begin=binding_idx, binding_count=1)

## Minimum Viable Binding Structure

For a model with M art meshes, P parts, and M parameters (1 per mesh):

```
counts:
  KEYFORM_BINDING_INDICES = M
  KEYFORM_BINDING_BANDS = M + P  (M for meshes + P null for parts)
  KEYFORM_BINDINGS = M
  KEYS = M

sections:
  art_mesh.keyform_binding_band_indices = [0, 1, 2, ..., M-1]
  part.keyform_binding_band_indices = [M, M+1, ..., M+P-1]

  keyform_binding_band.begin_indices = [0, 1, ..., M-1, M, M, ..., M]  (parts point past end)
  keyform_binding_band.counts = [1, 1, ..., 1, 0, 0, ..., 0]  (M ones, P zeros)

  keyform_binding_index.indices = [0, 1, ..., M-1]
  keyform_binding.keys_begin_indices = [0, 1, ..., M-1]
  keyform_binding.keys_counts = [1, 1, ..., 1]  (all 1 for static model)
  keys.values = [default, default, ..., default]  (M values at parameter defaults)

  parameter.ids = ['Param0', 'Param1', ..., 'ParamM-1']
  parameter.keyform_binding_begin_indices = [0, 1, ..., M-1]
  parameter.keyform_binding_counts = [1, 1, ..., 1]
```

## Coordinate System

- **keyform_position.xys**: Normalized to PPU. `position = (pixel - origin) / ppu`
- **Ren'Py shader**: `gl_Position = a_position.xy * u_live2d_ppu`
- **Result**: positions in pixel space on screen

## SDK Validator Quirk (Session 2 Discovery)

The `sub_1800079F0` validator checks `begin < total` **even when count=0**:
```c
for (i = 0; i < n; i++) {
    if (begins[i] < min_val || begins[i] >= total) return 0;  // runs even if counts[i]=0!
}
```

**Implications for null bands:**
- Part null bands with `begin = N` and `total_bind_idx = N` → FAIL (N >= N)
- Fix: set part null band `begin = 0` (any value < total works since count=0)

**Implications for masks:**
- `mask_begin = -1` with `total_masks = 0` → FAIL 
- `mask_begin = 0` with `total_masks = 0` → FAIL (0 >= 0)
- Fix: always have `DRAWABLE_MASKS >= 1` (dummy entry with value -1)

## Crash History

1. **30 bindings on 1 parameter** → crash (SDK expects each parameter to own its own bindings)
2. **Part sharing ArtMesh's non-null band** → crash (Parts must always use null bands)
3. **Separate null band for Part** → WORKS (Session 2: confirmed with 20-mesh model)
4. **Null band only (no real bindings)** → validation FAIL (begin >= total with total=0)
