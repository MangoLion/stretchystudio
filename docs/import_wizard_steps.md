# PSD Import Wizard Implementation

This document details the architecture and workflow of the 3-step PSD import wizard in Stretchy Studio.

## Overview
The PSD import process has been evolved from a direct mapping-to-rig flow into a multi-stage wizard. This provides users with the opportunity to correct layer ordering *before* the bone hierarchy and parenting logic are computed.

## The 3-Step Workflow

### 🟢 Step 1: Review Mapping (`review`)
- **Purpose**: Verify layer tags (head, body, arm, etc.) and handle arm-splitting.
- **Workflow**: 
    - User toggles "Split Arms" as needed.
    - Clicking **Continue** transitions to Step 2.
- **Trigger**: `handleWizardReorder` in `CanvasViewport.jsx`.

### 🟡 Step 2: Reorder Layers (`reorder`)
- **Purpose**: Fix layer stacking issues on the canvas.
- **HUD Changes**:
    - **Canvas**: The character is loaded into the project without a rig. Sidebars appear because `nodes.length > 0`.
    - **Layer Panel**: The "Groups" tab is hidden; only "Draw Order" is available.
    - **Inspector**: The right sidebar is hidden to maximize workspace.
    - **Mode Toggle**: The Staging/Animation toggle is removed.
- **Workflow**:
    - User rearranges layers in the Layer Panel.
    - Clicking **Next: Adjust Joints** transitions to Step 3.
- **Trigger**: `handleRigManually` in `PsdImportWizard.jsx` (which calls `onApplyRig`).

### 🟠 Step 3: Adjust Joints (`adjust`)
- **Purpose**: Reposition bone pivots.
- **Workflow**:
    - The rigging heuristic computes the skeleton and group assignments based on the *current* layer order.
    - Existing nodes in the project are updated with their new parents and draw orders.
    - User drags joints; clicking **Finish Setup** completes the import.
- **Trigger**: `handleWizardApplyRig` in `CanvasViewport.jsx`.

---

## Technical Details

### State Management
- **`wizardStep`**: Centralized in `src/store/editorStore.js`. This allows the application layout (`EditorLayout.jsx`) and the `LayerPanel.jsx` to react to the setup phase by hiding/showing elements.
- **`wizardPsd`**: Local state in `CanvasViewport.jsx` containing the raw PSD metadata (layers, dimensions) until the rig is finalized.

### Rig-Less vs. Post-Import Rigging
- **Step 2 (Rig-Less)**: Uses a specialized version of `finalizePsdImport` that skips group creation and parenting. This "populates" the engine with the raw part nodes.
- **Step 3 (Apply Rig)**: Calculates the armature based on current tags and order, then iterates through the *already active* project nodes to assign `parent` and update `draw_order`.

### UI & UX Polish
- **Auto-Centering**: `CanvasViewport.jsx` uses a `useEffect` on `wizardStep` to center the view when entering Step 2 or 3, with a 100ms delay to wait for layout shifts.
- **Shimmer Bar**: A looping `animate-shimmer` effect is applied to a thin bar at the top of the floating toolbars to ensure periodic visibility and focus.
- **Button Animations**: Primary actions ("Next", "Finish") use a delayed zoom entrance to draw the eye.

## Component Map
- **`PsdImportWizard.jsx`**: Manages step state, UI toolbars, and triggering rigging logic.
- **`CanvasViewport.jsx`**: Handles the underlying project mutations and viewport transformations.
- **`EditorLayout.jsx`**: Handles application-wide HUD isolation during active wizard steps.
- **`LayerPanel.jsx`**: Filters available tabs based on the current wizard stage.
- **`editorStore.js`**: Stores the active step for global coordination.
