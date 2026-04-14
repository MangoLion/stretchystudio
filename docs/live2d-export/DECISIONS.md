# Live2D Export — Architecture Decision Log

Each entry records a decision, its rationale, and rejected alternatives.
Trapdoor decisions (hard/impossible to reverse) are tagged `[TRAPDOOR]`.

---

## 001 — Export module location `[TRAPDOOR]`

**Date**: 2026-04-13  
**Decision**: All Live2D export code lives under `src/io/live2d/`.  
**Rationale**: Follows existing convention (`src/io/` holds `projectFile.js`, `psd.js`, `exportAnimation.js`). Keeps Live2D-specific code isolated from upstream changes.  
**Alternatives rejected**:
- `src/export/live2d/` — breaks consistency with existing `src/io/` layout.
- Flat files in `src/io/` — would pollute the directory as export grows.  
**Consequences**: All imports from Live2D export must use `@/io/live2d/...` paths.

---

## 002 — JSON files first, .moc3 binary last

**Date**: 2026-04-13  
**Decision**: Implement JSON format exports first (`.model3.json`, `.motion3.json`, `.physics3.json`, `.cdi3.json`), then tackle `.moc3` binary.  
**Rationale**: JSON formats are fully documented and inspectable. `.moc3` is a complex binary format requiring reverse engineering. Shipping JSON exporters first gives us testable output sooner and validates our data mapping before we invest in binary serialization.  
**Alternatives rejected**:
- Start with `.moc3` — too risky without validated data pipeline.
- All formats in parallel — spreads effort too thin.

---

## 003 — Reference-driven development

**Date**: 2026-04-13  
**Decision**: Every generated file is validated against the Hiyori reference export in `reference/live2d-sample/`.  
**Rationale**: The Live2D format has undocumented quirks. Byte-level comparison with a known-good export is the most reliable correctness check.  
**Alternatives rejected**:
- Spec-only development — specs are incomplete for `.moc3`.
- Trial-and-error in Ren'Py — too slow feedback loop for early development.

---

## 004 — .moc3 version V4.00 (version=3)

**Date**: 2026-04-13 (originally V3.00), **updated 2026-04-14** to V4.00  
**Decision**: Generate .moc3 files with version=3 (V4.00). This is the only version we export.  
**Rationale**: V4.00 matches our Hiyori reference file and is required by the SDK for the quad_transforms section at SOT[101]. V3.00 was rejected because it lacks quad_transforms — the SDK requires SOT[101] to be a valid non-zero offset for V3.03+ files, and our section layout produces 99 base + 1 additional section. V4.00 is compatible with Cubism SDK 4.0+ (Ren'Py 8.5 ships with SDK 5.x).  
**Alternatives rejected**:
- V3.00 (version=1) — no quad_transforms support; would require restructuring SOT layout.
- V3.03 (version=2) — structurally identical to V4.00 but less common. No benefit.
- V4.02+ / V5.00 — adds 35/50 extra SOT entries for color blend and extended keyforms we don't use. Would complicate the writer for no gain.  
**Consequences**: Minimum SDK requirement is Cubism SDK 4.0+. Displayed in export UI as "Cubism V4.00 (SDK 4.0+)".

---

## 005 — Vertex baking for MVP (no deformers)

**Date**: 2026-04-13  
**Decision**: MVP exports meshes with rest-pose vertices only, no Warp/Rotation deformers.  
**Rationale**: Stretchy Studio uses a bone/skeleton system that doesn't map 1:1 to Live2D's parameter+deformer system. For MVP, we store the default pose vertex positions and skip deformer generation entirely. This gets us a static model that loads and displays correctly.  
**Alternatives rejected**:
- Full deformer mapping — too complex for first iteration, high risk of producing invalid .moc3.

---

## 006 — py-moc3 as authoritative format reference

**Date**: 2026-04-13  
**Decision**: Use Ludentes/py-moc3 as the primary reference for .moc3 binary layout, section order, and data types.  
**Rationale**: py-moc3 is a verified read+write implementation that correctly parses our reference file. Its SECTION_LAYOUT array defines the exact order and types of all ~100 sections. Ported from QiE2035/moc3-reader-re (Java RE of Cubism SDK).  
**Alternatives rejected**:
- moc3ingbird — CVE exploit, limited format documentation.
- Writing our own parser from hex dumps — unnecessary given py-moc3 exists.

---

## 007 — Reference-first methodology `[PROCESS]`

**Date**: 2026-04-13  
**Decision**: Every export feature must begin by reverse-engineering the corresponding reference output, then replicate — never invent from scratch.  
**Rationale**: Learned the hard way with atlas packing. First iteration was naive shelf packing (1 part per atlas, 70% wasted space). Second was MaxRects (better layout, still 70% empty). Third added upscaling via binary search. Three iterations to approach what Cubism Editor does by default — because we didn't start by studying the reference atlas. The reference export in `reference/live2d-sample/Hiyori/` is our ground truth. When implementing any feature:  
1. Examine the reference output in detail (hex dump, image inspection, structural comparison).  
2. Document HOW the reference does it (what algorithm, what parameters, what constraints).  
3. Implement to match that output — not to "solve the problem generically."  
**Applies to**: atlas packing, .moc3 section ordering, UV mapping, draw order, motion curve encoding, physics, everything.

---

## 008 — Atlas packing: MaxRects BSSF + auto-upscale

**Date**: 2026-04-13  
**Decision**: Use MaxRects bin packing (Best Short Side Fit) with automatic uniform upscaling to fill the atlas.  
**Rationale**: Cubism Editor produces tightly-packed atlases where parts are scaled up to use maximum atlas area. We replicate this with:  
1. Crop each part to its opaque bounding box (`imageBounds`).  
2. Binary-search for the maximum uniform scale factor (>=1.0) that fits all parts in one atlas.  
3. Pack at that scale using MaxRects BSSF (Jukka Jylänki, 2010).  
**Alternatives rejected**:  
- Shelf packing — too wasteful, no space reuse.  
- No upscaling — leaves 70%+ of atlas empty, wastes texture memory at runtime.  
- Per-part scaling — could distort relative detail levels between parts.
