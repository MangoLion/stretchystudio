# Testing Live2D Export in Ren'Py

> **Status**: Model validates and renders in Cubism Viewer 5.0 (2026-04-14). Ren'Py testing pending.

## Test Environment

- **Ren'Py SDK**: `D:/renpy-8.5.0-sdk/`
- **Test project**: `D:/renpy-8.5.0-sdk/live2dtest/`
- **Cubism SDK**: v5-r.1 through v5-r.4 (NOT r.5 — removed `csmGetDrawableRenderOrders` used by Ren'Py 8.5.x)
- **Cubism Core DLL** (for ctypes testing): `D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll`

### SDK installation

1. Download **CubismSdkForNative-5-r.1.zip** (see `LIVE2D_NOTES.md` in test project)
2. Place ZIP in Ren'Py SDK root
3. Launcher → Preferences → Install libraries → Install Live2D Cubism SDK for Native

## Test Project Structure

```
live2dtest/game/
  images/
    girl/                              ← our exported model
      girl.model3.json
      girl.moc3
      girl.cdi3.json
      girl.2048/texture_00.png
      motion/Animation_1.motion3.json
    Hiyori/runtime/                    ← reference model
      hiyori_pro_t11.model3.json
      hiyori_pro_t11.moc3
      ...
```

## Ren'Py Script

```renpy
# game/script.rpy

image girl = Live2D("images/girl", base=.6)
image hiyori = Live2D("images/Hiyori/runtime", base=.6)

label start:
    show girl at center
    "Our exported model."

    show hiyori at center
    "Hiyori reference for comparison."

    return
```

Ren'Py auto-discovers `.model3.json` in the directory. Motion files are mapped by filename:
- `motion/Animation_1.motion3.json` → attribute `animation_1`
- Usage: `show girl animation_1`

Enable debug logging: `define config.log_live2d_loading = True` → check `log.txt`.

## ctypes Test Harness (faster iteration)

`docs/live2d-export/scripts/test_swapped.py` validates .moc3 without running Ren'Py:

```python
# Quick validation (no GUI needed)
import ctypes
dll = ctypes.CDLL('D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll')
# ... see test_swapped.py for full pipeline
```

Covers: `csmHasMocConsistency` → `csmReviveMocInPlace` → `csmInitializeModelInPlace` → `csmUpdateModel` → `csmGetDrawableVertexPositions/Uvs/Counts`.

## What to verify

| Check | Status | Notes |
|-------|--------|-------|
| Model loads in Cubism Viewer | PASS (2026-04-14) | 20 drawables render correctly |
| Model loads in Ren'Py | PENDING | |
| Textures render correctly | Visual check in Cubism Viewer: OK | |
| Draw order correct | PENDING | All drawables at 500.0, order via draw_order_group_object |
| Motion plays | PENDING | Animation_1.motion3.json exported |
| Model shows/hides without crash | PENDING | |

## Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `File read error` in Cubism Viewer | `csmHasMocConsistency` fails | Check field mapping (see MOC3_FORMAT.md) |
| Model blank/invisible | Missing keyform bindings | Need full binding chain, not null bands |
| Model loads but no vertices | Wrong vertex_counts/position_index_counts | These fields are SWAPPED vs intuition (see MOC3_FORMAT.md) |
| `csmGetDrawableRenderOrders` missing | Cubism SDK 5-r.5 | Downgrade to 5-r.1 through 5-r.4 |
