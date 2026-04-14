# Live2D Export — Progress Tracker

## Current Status: Phase 1 — Model LOADS AND RENDERS (Session 2 breakthrough)

---

## Phase 0: Research & Foundation (done)

- [x] Fork setup, remotes configured (origin + upstream)
- [x] `.gitignore` updated for reference/ and .claude/
- [x] Reference export analyzed (Hiyori model: 24 parts, 134 art meshes, 70 params)
- [x] Existing .moc3 RE projects surveyed and cloned to reference/
- [x] **py-moc3** (Python read+write) verified on reference file — parses correctly
- [x] Documentation structure created
- [x] MOC3 format fully mapped via py-moc3 section layout (all 100+ sections)
- [x] Data mapping Stretchy Studio → Live2D drafted
- [x] IDA Pro not needed for Phase 1 — py-moc3 provides complete section layout

## Phase 1: Minimum Viable Export (in progress)

**Goal**: Export a minimal model (1+ ArtMesh, 1 texture, 1 parameter) that loads in Cubism Viewer or Ren'Py.

### Code written (`src/io/live2d/`):
- [x] `.model3.json` generator (`model3json.js`)
- [x] `.cdi3.json` generator (`cdi3json.js`)
- [x] `.motion3.json` generator (`motion3json.js`)
- [x] Texture atlas packer (`textureAtlas.js`) — MaxRects BSSF + auto-upscale
- [x] `.moc3` binary writer (`moc3writer.js`) — full section layout
- [x] Main exporter orchestrator (`exporter.js`) — ZIP packaging
- [x] UI integration (Live2D option in Export Modal)

### Bugs found and fixed in session 1:
- [x] `mesh.triangles` is `Array<[i,j,k]>` not flat — flatten with `tri[0],tri[1],tri[2]`
- [x] `mesh.vertices` is `Array<{x,y}>` not flat — `.length` = vertex count, not `/2`
- [x] Atlas packer: crop to `imageBounds` before packing (PSD layers are full-canvas)
- [x] Atlas packer: MaxRects + auto-upscale to fill atlas (not shelf packing)
- [x] UV remapping: `(srcPx - cropOrigin) / cropSize * regionSize` formula
- [x] UV clamping to [0,1] (mesh dilation creates slightly OOB vertices)
- [x] Keyform positions: normalized `(pixel - origin) / PPU`, not raw pixels
- [x] `canvas` const hoisting trap — use `canvasW`/`canvasH` declared at top
- [x] Draw orders: all 500.0, group_indices=-1 (Hiyori pattern)
- [x] Drawable flags: 4 (like Hiyori), not 0
- [x] Version: V4.00 (version=3)
- [x] py-moc3 bug: `additional.quad_transforms` count_idx=-1 → fixed to WARP_DEFORMERS
- [x] ~~position_index_counts = triangle count~~ **CORRECTED in Session 2** (see below)
- [x] ~~position_index_begin_indices = cumulative vertex count~~ **CORRECTED in Session 2**

### Bugs found and fixed in Session 2 (2026-04-14):

**CRITICAL DISCOVERY: .moc3 field names are counterintuitive!**

Session 1 got the field mapping WRONG. Hiyori reverse engineering proved:

| Field (misleading name) | Session 1 belief | Correct meaning (Hiyori RE) |
|---|---|---|
| `vertex_counts` | unique vertex count | **flat triangle index count** (tri*3) |
| `position_index_counts` | triangle count | **rendering vertex count** |
| `uv_begin_indices` | cumul(vc * 2) | cumul(**pic** * 2) |
| `position_index_begin` | cumul(vc) | cumul(**vc**) = cumul(flat_idx) |

**Evidence**: In Hiyori, `sum(vertex_counts) == counts[16]` (POSITION_INDICES), and `uv_begin == cumul(position_index_counts * 2)`. The SDK function `csmGetDrawableVertexCounts` returns `position_index_counts` values.

Other fixes applied:
- [x] Full keyform binding chain: 1 binding per mesh, null bands for parts
- [x] SDK validator quirk: `begin < total` checked even when `count=0`
- [x] `mask_begin_indices = 0` (not -1), DRAWABLE_MASKS=1 (dummy entry)
- [x] `drawable_flags = 4` consistently (Hiyori pattern)
- [x] 64 bytes EOF padding (SOT entries for empty sections at end must be < file_size)
- [x] Cubism Core DLL (Ren'Py) ctypes test harness built and validated
- [x] 20-mesh girl model passes consistency + loads + initializes + updates via SDK

### Current state (end of Session 2):
- [x] **Cubism Viewer 5.0: MODEL RENDERS CORRECTLY** (screenshot confirmed 2026-04-14)
- [x] JS moc3writer.js generates valid .moc3 directly from Stretchy Studio UI export
- [x] 20 drawables, correct textures, correct mesh positions
- [x] Also found last bug: SOT[101] must be non-zero for V3.03+ (quad_transforms entry)
- Test harness: `docs/live2d-export/test_swapped.py`

### Next steps for Session 3:
- [ ] Test in Ren'Py (D:/renpy-8.5.0-sdk/live2dtest/)
- [ ] Test motion playback (Animation_1.motion3.json)
- [ ] Test with multiple texture atlases
- [ ] Begin Phase 2: multiple parameters, draw order, part hierarchy

## Phase 2: Full Static Export

- [ ] Multiple ArtMeshes with correct draw order
- [ ] Part hierarchy (group → Part mapping)
- [ ] Multiple texture atlases
- [ ] All standard parameters
- [ ] Full `.cdi3.json` with parameter groups

## Phase 3: Animation Export

- [ ] `.motion3.json` generator
- [ ] Keyframe → segment encoding (linear, bezier, stepped)
- [ ] Motion groups in `.model3.json`
- [ ] Test animations play correctly in Ren'Py

## Phase 4: Advanced Features

- [ ] `.physics3.json` generator
- [ ] `.pose3.json` generator
- [ ] `.exp3.json` generator (expressions)
- [ ] Warp/Rotation deformer export
- [ ] Multi-parameter keyform interpolation

## Phase 5: Polish & Integration

- [ ] UI integration in Stretchy Studio (export dialog)
- [ ] Progress reporting during export
- [ ] Error handling and validation
- [ ] User documentation

---

## Key Risks

1. **`.moc3` binary format** — partially undocumented, requires RE. Mitigation: reference-driven + moc3ingbird + SDK analysis.
2. **Bone → Parameter mapping** — conceptual mismatch between skeletal animation and parameter-based deformers. Mitigation: vertex baking for MVP.
3. **Cubism SDK validation** — the SDK may reject our .moc3 if any field is wrong. Mitigation: byte-level comparison with reference, incremental testing.
