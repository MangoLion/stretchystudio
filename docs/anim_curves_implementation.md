# Animation Curves Implementation

This document details the implementation of robust animation curve support (keyframe interpolation) in Stretchy Studio, covering the mathematical core, UI visualization, and the Spine 4.0 export pipeline.

## 1. Core Interpolation Engine (`animationEngine.js`)

The engine core was refactored from a simple linear lerp to a parametric Cubic Bezier evaluation system.

### 1.1. Cubic Bezier Math
Since standard Cubic Bezier curves (CSS-style) are defined as parametric curves $P(t) = (x(t), y(t))$, we must solve for $y$ given a specific $x$ (normalized time).
- **Solver**: A 1D Cubic Bezier root-finder (`evaluateCubicBezier`) using binary search (12 iterations) to find the parametric $t$ that yields the target $x$, then returning the corresponding $y$.
- **Control Points**:
  - **Ease Both (Default)**: `[0.42, 0, 0.58, 1]` (Symmetric S-curve)
  - **Ease In**: `[0.42, 0, 1, 1]` (Slow start, fast finish)
  - **Ease Out**: `[0, 0, 0.58, 1]` (Fast start, slow finish)
  - **Custom**: Supports arbitrary `[cx1, cy1, cx2, cy2]` arrays.

### 1.2. Discrete Interpolation
- **Stepped**: The value is held constant at the starting keyframe's value until the playhead reaches the next keyframe.
- **Linear**: Simple $v = a + (b-a)t$ interpolation.

---

## 2. Timeline UI & Visualization (`TimelinePanel.jsx`)

The timeline provides both control over and visual feedback for the selected interpolation mode.

### 2.1. Radix Context Menu
The keyframe context menu is implemented using **Radix UI ContextMenu**, which provides automatic viewport clamping (preventing the menu from clipping off-screen) and collision detection.
- **Icons**: Action icons for Copy, Paste, and Remove.
- **Curve Previews**: Each interpolation type (`Linear`, `Ease Both`, `Ease In`, `Ease Out`, `Stepped`) includes a small SVG `CurveIcon` demonstrating the motion profile.

### 2.2. Background Transition Curves
Track rows render a non-interactive SVG layer behind the keyframes:
- **Interpolation Paths**: Curves are drawn from the bounding box of keyframe $A$ to keyframe $B$ using the easing type assigned to keyframe $A$.
- **Loop Visualization**: If "Loop Keyframes" is enabled, a dashed semi-transparent curve is drawn from the final keyframe of a track back to the "phantom" loop keyframe at the animation's end duration.

---

## 3. Data Pipeline & Export (`exportSpine.js`)

Animation curves are first-class citizens in the storage and export model.

### 3.1. Internal Data Model
Keyframes now include an optional `easing` property:
```json
{
  "time": 1000,
  "value": 45,
  "easing": "ease-in" // or [0.1, 0.2, 0.3, 0.4] for custom
}
```

### 3.2. Spine 4.0 JSON Mapping
Stretchy Studio's curve definitions map directly to the Spine 4.0 runtime spec:
- **Stepped**: Exported as `curve: "stepped"`.
- **Linear**: Omitted or exported as null (Spine's default).
- **Bezier**: Exported as a 4-element array `curve: [cx1, cy1, cx2, cy2]`.
- **Properties Supported**: Translate (X, Y), Rotate, Scale (X, Y), and Opacity (RGBA).

---

## 4. Usage Summary
1. Right-click any keyframe diamond in the timeline.
2. Select an interpolation type from the menu.
3. Observe the SVG transition line update in the timeline background.
4. Export as Spine (4.0+) to utilize these curves in game engines (Unity, Unreal, etc.) or the Spine editor.
