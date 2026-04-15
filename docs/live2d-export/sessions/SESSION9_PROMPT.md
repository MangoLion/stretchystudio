# Session 9 Prompt

Продолжаем работу над Live2D экспортом для Stretchy Studio.

## Контекст

Прочитай документацию в `docs/live2d-export/`:
- `README.md` — индекс, quick-start, troubleshooting, gotchas
- `PROGRESS.md` — статус проекта
- `ARCHITECTURE.md` — решения, маппинг данных, **coordinate space traps**, dual-position system
- `CMO3_FORMAT.md` — формат .cmo3

## Что сделано (Phase 1-2 COMPLETE + деформеры + parameter bindings)

### Phase 1 (.moc3 runtime) — COMPLETE
- JS moc3writer, рендерится в Cubism Viewer 5.0 и Ren'Py

### Phase 2 (.cmo3 project) — COMPLETE
- Полный pipeline: ExportModal → exportLive2DProject → generateCmo3 → packCaff
- Текстуры, draw order, single-PSD pattern
- Part hierarchy: группы SS → CPartSource с nesting
- Parameters: все project.parameters + ParamOpacity

### Session 5-6: Деформеры
- **Rotation deformers**: каждая группа → CRotationDeformerSource
  - Origin: SS pivot (если задан) → центр descendant мешей (fallback)
  - Деформер chain следует иерархии групп

### Session 7: Auto-parenting + dual-position (CRITICAL)
- **Мешы auto-parented** к деформерам (targetDeformerGuid → группа, не ROOT)
- **Dual-position system**: meshSrc positions в canvas space, keyform positions в deformer-local
- **World-space pivots**: через makeLocalMatrix/mat3Mul из transforms.js
- **Deformer origins в parent-relative** local coords (как в Hiyori)

### Session 8: Parameter bindings + animation wiring
- **Каждый rotation deformer привязан к параметру** ParamRotation_GroupName
- Range [-30, +30], 3 keyforms: angle=-30°, 0° (rest), +30°
- KeyformBindingSource + KeyformGridSource + KeyOnParameter (Hiyori pattern)
- **motion3json**: rotation tracks маппятся на ParamRotation_* IDs
- **exporter.js**: строит parameterMap, передаёт в generateMotion3Json
- **Подтверждено**: parameter sliders контролируют rotation в Cubism Editor 5.0

## JS файлы
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator (parts, params, deformers, parameter bindings)
- `src/io/live2d/exporter.js` — exportLive2D + exportLive2DProject
- `src/io/live2d/moc3writer.js` — .moc3 binary writer
- `src/io/live2d/model3json.js` — .model3.json
- `src/io/live2d/motion3json.js` — .motion3.json (теперь с rotation track mapping)
- `src/io/live2d/cdi3json.js` — .cdi3.json
- `src/io/live2d/textureAtlas.js` — atlas packer
- `src/components/export/ExportModal.jsx` — UI

## Текущее состояние экспорта

Экспорт сейчас — **animatable puppet** (не просто posable):
- ✅ Мешы, текстуры, hierarchy, draw order
- ✅ Rotation deformers с auto-parenting
- ✅ Parameter bindings: slider → deformer rotation (-30° to +30°)
- ✅ Animation tracks (rotation) маппятся на правильные parameter IDs
- ❌ Ren'Py не тестирован с новыми rotation parameters
- ❌ Нет warp deformers (mesh vertex animations)
- ❌ Анимации не embedded в .cmo3 (только standalone .motion3.json)
- ❌ Нет physics/pose/expressions

## Задачи Session 9

### 1. Ren'Py validation (быстрая проверка)
- Экспортировать runtime .moc3 + .motion3.json с rotation animation tracks
- Загрузить в Ren'Py test project: `D:/renpy-8.5.0-sdk/live2dtest/`
- Проверить что .motion3.json с ParamRotation_* curves проигрывается

### 2. Warp deformers (ГЛАВНАЯ ЗАДАЧА)

SS хранит vertex-level анимации как mesh_verts tracks:
```
track: {
  nodeId: "part_id",
  property: "mesh_verts",
  keyframes: [
    { time: 0, value: [{x, y}, {x, y}, ...] },   // full vertex array
    { time: 500, value: [{x, y}, {x, y}, ...] },
  ]
}
```

Live2D использует CWarpDeformerSource с control point grid:
```
CWarpDeformerSource:
  col: 5, row: 5  →  (col+1) × (row+1) = 36 control points
  keyforms:
    CWarpDeformerForm:
      positions: float-array count="72"  (36 points × 2 coords)
```

**Проблема конвертации:**
- SS: N произвольных вершин с точными позициями
- Live2D: (col+1)×(row+1) control points на regular grid
- Нужен алгоритм: fit SS vertex deltas → warp grid control point deltas
- Варианты: least-squares fit, barycentric interpolation, или RBF

**Подход (предложение):**
1. Определить bounding box меша
2. Создать regular grid (col+1)×(row+1) над bbox
3. Для каждого keyframe с vertex deltas:
   - Для каждого control point найти ближайшие вершины
   - Вычислить weighted average delta (inverse distance weighting)
   - Записать displaced control point positions
4. Grid size: начать с 3×3 (16 points), потом можно 5×5 (36 points)

### 3. Animation embedding в .cmo3 (если время останется)
- Сейчас анимации только в standalone .motion3.json
- Cubism Editor хранит анимации внутри .cmo3 (в CModelSource?)
- Нужно RE Hiyori main.xml для формата animation data внутри .cmo3

## Координатные системы (КРИТИЧЕСКИ ВАЖНО!)

### Dual-position system
```
meshSrc > positions         → CANVAS pixel space  (для текстур)
keyform > positions         → DEFORMER-LOCAL space (для рендеринга)
GEditableMesh2 > point      → CANVAS pixel space  (для editing)
UVs                         → normalized 0..1 от CANVAS positions
```

### Deformer coordinate chain
```
Canvas origin (0, 0)
  └─ Deformer A: origin = (500, 300) в canvas space
      └─ Deformer B: origin = (100, -50) в A's local space
          └─ Mesh: keyform vertices в B's local space
              vertex_local = vertex_canvas - B_world_origin
              B_world_origin = A_origin + B_local_origin = (600, 250)
```

### Warp deformer coordinates (из Hiyori RE)
```
CWarpDeformerSource:
  col: 5, row: 5
  CWarpDeformerForm > positions: normalized coordinates (0..1 range)
  NOT pixel coordinates — positions represent fractions of the deformer's bounding area
```

**TRAP:** Warp deformer positions в Hiyori выглядят как normalized (0.24..0.76 range).
Нужно выяснить: это нормализованные относительно deformer bbox или canvas?

## Hiyori Warp Deformer Reference

```xml
<CWarpDeformerSource xs.id="#3529">
  <ACDeformerSource xs.n="super">
    <ACParameterControllableSource xs.n="super">
      <s xs.n="localName">Skirt Warp</s>
      <KeyformGridSource xs.n="keyformGridSource" xs.ref="#3527" />
      <carray_list xs.n="_extensions" count="2">
        <CWarpDeformerBezierExtension>
          <i xs.n="editLevel">2</i>
          <i xs.n="bezierCol">2</i>
          <i xs.n="bezierRow">2</i>
        </CWarpDeformerBezierExtension>
      </carray_list>
    </ACParameterControllableSource>
  </ACDeformerSource>
  <i xs.n="col">5</i>
  <i xs.n="row">5</i>
  <b xs.n="isQuadTransform">false</b>
  <carray_list xs.n="keyforms" count="3">
    <CWarpDeformerForm>
      <float-array xs.n="positions" count="72">
        0.24374695 0.7550882 ... (36 control points × 2)
      </float-array>
    </CWarpDeformerForm>
  </carray_list>
</CWarpDeformerSource>
```

**Заметки:**
- `CWarpDeformerBezierExtension` — для bezier editing в Editor, можно пропустить для MVP
- `isQuadTransform`: false — linear interpolation between grid points
- KeyformGridSource работает так же как для rotation deformers (KeyformBindingSource + keys)

## Инструменты
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Ren'Py test: `D:/renpy-8.5.0-sdk/live2dtest/`
- Live2D docs: https://docs.live2d.com/en/cubism-editor-manual/
- Reference: `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`
