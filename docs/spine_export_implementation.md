# Spine 4.0 Export Implementation Details

This document outlines the technical implementation of the Spine 4.0 JSON export pipeline in Stretchy Studio.

## Overview
The export pipeline converts the internal Stretchy Studio project structure (nodes, textures, animations) into a Spine-compatible ZIP package containing a `skeleton.json` and associated image assets.

## Core Mapping
- **Hierarchy**: Stretchy Studio "Groups" map to Spine "Bones". "Parts" map to Spine "Slots" and "Region Attachments".
- **Coordinates**: 
  - Stretchy Studio (SS) uses a Y-down coordinate system with top-left origin.
  - Spine uses a Y-up coordinate system.
  - Setup pose bone positions are calculated as local-space deltas from the parent bone's pivot to the child node's pivot.
- **Animations**: Translation, Rotation (Angle), and Opacity tracks are mapped to Spine's `translate`, `rotate`, and `rgba` timelines.

## Challenges & Solutions

### 1. Name Collisions
**Problem**: Spine strictly requires every project to have a bone named exactly `root` as the absolute parent. If a user named a group layer `root` in Stretchy Studio, the export would fail due to duplicate names.
**Solution**: The `sanitizeName` utility renames any user-defined node named `root` to `rig_root` automatically during export.

### 2. Coordinate "Drift"
**Problem**: Initially, we calculated bone offsets using world-space subtractions. However, exporting while parent joints were rotated caused the child attachments to drift because Spine expects local-space offsets for the setup pose *before* rotations are applied.
**Solution**: Switched to a pure local-space delta calculation:
```javascript
dx = (child.x + child.pivotX) - parent.pivotX
dy = (child.y + child.pivotY) - parent.pivotY
```
This ensures the rig structure matches the "Edit Mode" layout regardless of the current pose.

### 3. Animation Property Schema (Spine 3.8 vs 4.0)
**Problem**: Animations imported but rotation keyframes were ignored (showing as 0).
**Solution**: Discovered that Spine 4.0 changed the JSON key for rotation from `"angle"` to `"value"`. Updated the animation mapper to use the 4.0 schema.

### 4. Pivot Alignment
**Problem**: Rotations were occurring around the center of groups rather than the custom joint handles placed by the user.
**Solution**: Integrated `pivotX` and `pivotY` into the world position calculations, ensuring the "bone" origin in Spine alignment exactly with the joint handle in Stretchy Studio.

## Usage
1. Open **Export Modal**.
2. Select **Type: Spine (4.0+)**.
3. Click **Export**.
4. In Spine, use `Spine menu > Import Data...` and point the `Images` path to the extracted `images/` folder.
