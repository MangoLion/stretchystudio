# Export Feature Implementation

## Overview

The Export feature enables users to render animation frames as image sequences or single frames in PNG, WEBP, or JPG format, outputting to ZIP files or system folders via the File System Access API.

**Status**: Complete (M6 feature)  
**Implementation Date**: 2026-04-12  
**Files Modified**: 5 | **Files Created**: 2

---

## Architecture

### Export Pipeline

```
EditorLayout
  ├── captureRef (imperative ref)
  └── ExportModal (controlled modal)
        └── captureRef.current({ animId, timeMs, ... })
              └── CanvasViewport.captureExportFrame()
                    ├── Set canvas.width/height to export dims
                    ├── Render with scenePass.draw(exportMode=true)
                    ├── Composite background if needed
                    └── Return canvas.toDataURL()
        └── exportFrames({ frames, format, exportDest })
              ├── exportToZip() → JSZip → download
              └── exportToFolder() → File System Access API
```

### Key Design Decisions

#### 1. WebGL Context Flags (CanvasViewport.jsx:167)

```javascript
getContext('webgl2', {
  alpha: true,                      // Enable transparent pixels
  premultipliedAlpha: false,        // Correct alpha compositing
  stencil: true,                    // Existing iris clipping
  preserveDrawingBuffer: true,      // Allow toDataURL() outside rAF
})
```

**Rationale**: 
- `alpha: true` allows exported frames to be truly transparent (critical for PNG/WEBP)
- `preserveDrawingBuffer: true` ensures `canvas.toDataURL()` captures the rendered frame
- The background shader continues to draw opaque background (no visual change in normal rendering)

#### 2. Canvas Resizing During Export

**Problem**: Changing `canvas.width/height` clears the drawing buffer. We need to render at export resolution without breaking the live viewport.

**Solution**: 
1. Set `canvas.width = exportWidth`, `canvas.height = exportHeight` directly
2. Pass `skipResize: true` to `scenePass.draw()` to bypass CSS-based resize logic
3. Render with export parameters
4. Capture with `canvas.toDataURL()` (synchronous, works with `preserveDrawingBuffer`)
5. Mark `isDirtyRef = true` — the next rAF tick's scenePass will see `canvas.width !== canvas.clientWidth` and restore to viewport size

**Why this works**: The rAF callback resizes via the CSS guard on the next tick, so no manual restoration needed.

#### 3. Transparent Background Handling

**For transparent export**:
- Pass `bgEnabled: false` to export project
- Set `exportMode: true` in scenePass.draw()
- scenePass clears to transparent (rgba 0,0,0,0) and skips bgRenderer
- Result: transparent pixels in canvas

**For solid background export**:
- Render with `exportMode: true` (transparent canvas)
- Composite onto 2D offscreen canvas:
  ```javascript
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(glCanvas, 0, 0);
  dataUrl = off.toDataURL();
  ```
- **Advantage**: No changes to BackgroundRenderer, JPG format works (no transparency holes)

---

## Files Modified

### 1. `src/renderer/scenePass.js`

**Changes**: Added optional `exportMode` and `skipResize` parameters to `draw()` method

```javascript
draw(project, editor, isDark = true, poseOverrides = null, { skipResize = false, exportMode = false } = {})
```

**Key modifications**:
- Skip canvas resize if `skipResize: true` (preserves export dimensions)
- Clear to transparent if `exportMode: true`
- Skip bgRenderer call if `exportMode: true`

**Line 88**: Method signature  
**Line 92-96**: Resize guard wrapped with `!skipResize` check  
**Line 109-111**: Transparent clear + conditional bgRenderer

---

### 2. `src/components/canvas/CanvasViewport.jsx`

**Changes**: WebGL context, captureRef prop, frame capture logic

**Line 116**: Add `captureRef` to component props

**Line 167**: Update WebGL context options:
```javascript
// Before: { alpha: false, stencil: true }
// After:  { alpha: true, premultipliedAlpha: false, stencil: true, preserveDrawingBuffer: true }
```

**Lines 1691-1770**: `captureExportFrame` function
- Resizes canvas to export dimensions
- Builds mock editor with zoom=1, no overlays
- Computes pose at specific animation time via `computePoseOverrides()`
- **New**: Manually computes blend shape and puppet warp mesh deformations for the export frame
- **New**: Uploads deformed mesh vertices to GPU via `uploadPositions()` before rendering
- Calls `scenePass.draw(exportProject, exportEditor, isDarkRef.current, poseOverrides, { skipResize: true, exportMode: true })`
- Composites background color if needed
- **New**: Restores original mesh positions to GPU to maintain scene integrity
- Returns data URL (PNG, WEBP, or JPG)
- Marks dirty for rAF restore

**Lines 1359-1360**: useEffect to assign `captureExportFrame` to `captureRef.current`

---

### 3. `src/app/layout/EditorLayout.jsx`

**Changes**: Download button, export modal state, captureRef wiring

**Line 14**: Add `Download` to lucide-react import

**Line 15**: Import `ExportModal` component

**Lines 63-64**: Add `captureRef` and `exportModalOpen` state

**Lines 180-191**: Download button in toolbar (after Load button)

**Line 418**: Pass `captureRef` to CanvasViewport

**Lines 476-481**: Render ExportModal with state wiring

---

## Files Created

### 4. `src/io/exportAnimation.js`

Core export logic: frame specs, bounds computation, ZIP/Folder writing.

**Exported functions**:

#### `computeExportFrameSpecs({ type, animsToExport, exportFps, frameIndex })`
Returns `[{ animId, animName, frameIndex, timeMs }, ...]`
- **Sequence**: Generates `Math.round(duration/1000 * fps)` frames per animation
- **Single frame**: One entry per animation at `frameIndex/fps` milliseconds

#### `computeAnalyticalBounds(project)`
Computes world-space bounding box of all visible parts.
- Uses `computeWorldMatrices()` and `computeEffectiveProps()` from transforms.js
- Transforms 4 corners of each part's image bounds
- Returns `{ x, y, width, height }` or `null`
- Used for 'min_image_area' export option

#### `resolveAnimations(animations, animTarget, activeAnimationId)`
Resolves which animations to export:
- `'current'` → active animation or first animation
- `'all'` → all animations
- Specific ID → that animation

#### `exportFrames({ frames, format, exportDest, onProgress })`
Main export orchestrator.
- Delegates to `exportToZip()` or `exportToFolder()`
- Calls `onProgress(message)` for UI updates

#### `exportToZip(frames, ext, onProgress)`
Uses dynamic import `jszip`:
```javascript
const { default: JSZip } = await import('jszip');
const zip = new JSZip();
zip.folder('animName').file(`frame_0001.${ext}`, blob);
zip.generateAsync({ type: 'blob' });
// Download via <a> element
```

#### `exportToFolder(frames, ext, onProgress)`
Uses File System Access API:
```javascript
const dirHandle = await window.showDirectoryPicker();
const subDir = await dirHandle.getDirectoryHandle('animName', { create: true });
const fileHandle = await subDir.getFileHandle('frame_0001.ext', { create: true });
const writable = await fileHandle.createWritable();
await writable.write(blob);
```

**Helper**: `sanitizeName(name)` — replaces non-alphanumeric chars with `_`

---

### 5. `src/components/export/ExportModal.jsx`

Full modal UI with form controls and export orchestration.

**State**:
- Type: sequence | single_frame
- Format: png | webp | jpg
- Animation target: current | specific | all
- Export FPS (sequence only) or frame index (single frame)
- Image contains: canvas_area | min_image_area | custom
- Output scale: 1-400%
- Background: transparent | custom color
- Export destination: zip | folder

**Key features**:
- Syncs defaults from stores on open
- Disables folder option if `'showDirectoryPicker'` not in window
- Shows JPG + transparent warning
- Progress bar during export (current/total frames)
- Cancel button (disabled while exporting)

**Export flow**:
1. Resolve animations to export
2. Compute frame specs via `computeExportFrameSpecs()`
3. Compute export dimensions (canvas area, min area, or custom)
4. Loop through frame specs:
   - Call `captureRef.current({ animId, timeMs, ... })`
   - Update progress
   - Yield to browser (setTimeout)
5. Pass all frame data to `exportFrames()`
6. Close modal

---

## Usage

### End User Flow

1. **Open Export Modal**: Click Download icon in toolbar
2. **Configure Export**:
   - Select Type (Sequence / Single Frame)
   - Choose Format (PNG / WEBP / JPG)
   - Pick Animation (Current / specific / All)
   - Set FPS (sequence) or Frame index (single)
   - Choose Image Contains (Canvas area / Min / Custom)
   - Adjust Output Scale (%)
   - Select Background (Transparent / Custom color)
   - Pick Export Destination (ZIP / Folder)
3. **Export**: Click Export button
4. **Wait**: Progress bar shows current frame / total
5. **Download**: ZIP downloads or folder is written to system

### Programmer Integration

If adding new export options (e.g., metadata, naming conventions):

1. **Add to ExportModal state**: New form field
2. **Pass to captureRef**: Include in `captureRef.current({ ... })` call
3. **Use in export file functions**: `exportFrames()` receives all frame data + metadata

Example: Adding custom prefix to filenames:
```javascript
// In ExportModal:
const [filePrefix, setFilePrefix] = useState('anim');

// In handleExport:
frameDataItems.push({ ..., filePrefix });

// In exportAnimation.js:
const filename = `${filePrefix}_frame_${frameIndex}.${ext}`;
```

---

## Known Limitations & Future Work

### Current Limitations

1. **GIF Format**: Not supported (no browser-native GIF encoding). Can be added later via `gifenc` or `gif.js` library.

2. **Custom Crop**: The "Custom" image contains option doesn't have a visual UI for dragging crop bounds. Users must select "Custom" but dimensions default to canvas area.

3. **JPG + Transparent**: Automatically renders with black background (since JPG has no alpha). User sees warning.

4. **Min Image Area**: Computed analytically from part bounds. Does not account for alpha-only pixels (e.g., soft shadows outside the image bounds).

### Future Enhancements

- [ ] Custom crop UI (drag bounds in canvas preview)
- [ ] GIF export via library
- [ ] Batch export presets (save/load common configurations)
- [ ] Spritesheet grid layout (instead of separate files)
- [ ] Metadata JSON per frame (transform, visibility, etc.)
- [ ] Export specific frame ranges (start/end frame)
- [ ] Interlaced PNG / progressive JPEG options

---

## Technical Notes

### Why `preserveDrawingBuffer: true`?

`preserveDrawingBuffer: false` (default) allows the browser to optimize by immediately swapping the front and back buffers. With false, `canvas.toDataURL()` may return the previous frame or garbage. 

`preserveDrawingBuffer: true` tells WebGL to keep the rendering buffer available for CPU readback (e.g., `toDataURL()`, `getImageData()`). Small performance cost but essential for frame capture outside the rAF tick.

### Why `alpha: true` and `premultipliedAlpha: false`?

The WebGL context default `alpha: false` means the canvas is fully opaque. The rendering buffer's alpha channel is ignored.

With `alpha: true, premultipliedAlpha: false`:
- The canvas can have transparent areas
- `toDataURL('image/png')` correctly encodes alpha channel
- Compositing on `<canvas>` background follows standard (non-premultiplied) alpha rules

### Why Composite BG via 2D Canvas?

**Alternative 1**: Modify BackgroundRenderer to draw on demand  
**Problem**: Complex, breaks separation of concerns

**Alternative 2**: Change WebGL clear color when `bgEnabled: true`  
**Problem**: Doesn't handle non-solid backgrounds (gradients, patterns)

**Our approach**: Render transparent, then composite in 2D  
**Advantage**: Simple, works for all BG types, doesn't touch ScenePass

### Canvas Size Restoration

After export capture, we don't manually restore `canvas.width` and `canvas.height`. Instead:

1. Set `isDirtyRef.current = true`
2. Next rAF tick calls `scenePass.draw()` without `skipResize`
3. Resize guard sees `canvas.width (exportWidth) !== canvas.clientWidth (viewportWidth)`
4. Sets `canvas.width = canvas.clientWidth` → viewport size restored
5. Renders at correct viewport size

**Why not manual restore?** Because `canvas.width = x` itself clears the buffer. If we did it in `captureExportFrame`, it would clear the freshly-captured frame. Letting rAF handle it is safer.

---

## Testing Checklist

- [ ] Single frame PNG export (transparent background)
- [ ] Sequence PNG export at 24 FPS
- [ ] Sequence WEBP export with custom color background
- [ ] JPG export (verify warning appears for transparent BG)
- [ ] Multiple animations — All + ZIP
- [ ] Multiple animations — Specific + Folder (if FSAPI available)
- [ ] Output scale 50% — verify dimensions are half
- [ ] Min image area — verify bounding box is tighter than canvas
- [ ] Progress bar updates during export
- [ ] Live viewport renders correctly after export completes
- [ ] ZIP file structure: `{animName}/frame_0001.png`, etc.
- [ ] Folder structure mirrors ZIP
- [ ] JPG quality looks acceptable at 0.92

---

## Debugging

### Common Issues

**Export button does nothing**:
- Check `captureRef.current` is assigned (useEffect should run)
- Verify sceneRef exists (ScenePass initialized)
- Open dev console for errors

**Exported frames are blank / white**:
- Check WebGL context has `alpha: true` (should see transparent in PNG)
- Verify pose computation isn't clipping all nodes
- Check canvas dimensions in export were set correctly

**ZIP download doesn't start**:
- Verify JSZip import works (check network tab)
- Confirm at least one frame was captured
- Check blob URL creation and `<a>` click fired

**Folder export fails silently**:
- File System Access API requires HTTPS in production
- Firefox doesn't support showDirectoryPicker
- User cancelled folder picker (caught and logged)

### Debug Output

Enable console logging in `captureExportFrame`:
```javascript
console.log('[Export] Rendering frame', spec.frameIndex, 'at', timeMs, 'ms');
console.log('[Export] Canvas size:', canvas.width, 'x', canvas.height);
```

Enable in `exportAnimation.js`:
```javascript
console.log('[Export] Frame specs:', frameSpecs);
console.log('[Export] Bounds:', computeAnalyticalBounds(project));
```

---

## Bug Fixes

### Mesh-Deformed Joint Export (2026-04-16)

**Problem**: Exported PNG frames don't match what's displayed on the app. Specifically, mesh-deformed joints (blend shapes and puppet warp) don't show up correctly in exports.

**Root Cause**: When playing animations on the webpage, the code calls `sceneRef.current.parts.uploadPositions()` to upload deformed mesh vertices to the GPU before rendering. However, this step was completely missing in the export frame capture function, and the deformation logic itself was only being run in the main `tick()` loop.

**Solution**: Added complete mesh vertex upload and restore logic to `captureExportFrame()`:
1.  Manually compute blend shapes and puppet warp deformations for the specific frame time.
2.  Upload deformed mesh vertices to GPU before calling `scene.draw()`.
3.  Restore original mesh positions after the frame capture is complete.

---

## Files Summary

| File | Type | Changes | Lines |
|------|------|---------|-------|
| scenePass.js | Modified | Add exportMode + skipResize | 88, 92-96, 109-111 |
| CanvasViewport.jsx | Modified | WebGL context, captureRef, captureExportFrame | 116, 167, 1289-1360 |
| EditorLayout.jsx | Modified | Download button, captureRef, ExportModal | 14, 15, 63-64, 180-191, 418, 476-481 |
| exportAnimation.js | New | Export pipeline (specs, bounds, ZIP, Folder) | 150 lines |
| ExportModal.jsx | New | Modal UI + orchestration | 320 lines |

**Total additions**: ~550 lines  
**Total modifications**: ~30 lines

---

## References

- [MDN: HTMLCanvasElement.toDataURL()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL)
- [MDN: WebGL2RenderingContext](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext)
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [JSZip Documentation](https://stuk.github.io/jszip/)
- [Stretchy Studio Project Structure](../README.md)
