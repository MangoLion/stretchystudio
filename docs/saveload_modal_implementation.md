# Save/Load Project Modal & Library Implementation

This document details the implementation of the professional Project Library system, which evolved the workflow from basic file downloads to a persistent, visual, and manageble browser-based repository.

## Overview
The "Project Library" provides a centralized workspace for managing `.stretch` projects within the browser using **IndexedDB**. It features visual thumbnails, smart overwriting, and a full suite of management tools (Rename, Copy, Delete, Download).

## 1. Persistence Layer (`[projectDb.js](file:///w:/shared/ReactProjects/stretchystudio/src/io/projectDb.js)`)
A utility wrapper for IndexedDB that manages project records.
- **Auto-Capture**: Captures a WebP thumbnail of the WebGL canvas using an offscreen buffer during every library save.
- **CRUD Operations**:
  - `saveToDb`: Upserts a project record (blob + thumbnail + metadata).
  - `deleteProject`: Removes a record.
  - `updateProjectName`: Renames a project without re-saving the entire blob.
  - `duplicateProject`: Clones a project record with a new ID and \" (Copy)\" suffix.

## 2. Shared Component: `[ProjectGallery](file:///w:/shared/ReactProjects/stretchystudio/src/components/load/ProjectGallery.jsx)`
A high-performance reusable gallery component used by both Load and Save modals.
- **Features**:
  - **Action Overlay**: Hovering over a project card reveals icons for **Rename**, **Duplicate**, **Download**, and **Delete**.
  - **Inline Renaming**: Uses a local toggle state to replace the title with an input field for instant renaming.
  - **Grid Layout**: Responsive CSS grid that adapts to modal width.
  - **Independent Scrolling**: Designed to live inside a `ScrollArea`, allowing the library to scale to hundreds of projects while keeping modal headers fixed.

## 3. UI Refinements

### Load Project Modal
- **Unified Interface**: Removes the standalone "Import" panel.
- **Import as a Card**: The first item in the gallery is a specialized **Import Project** card. This keeps all "entry" actions in one consistent visual grid.
- **Fixed Header**: The "Project Library" title is pinned, while the gallery scrolls below it.

### Save Project Modal
- **Smart Overwrite Detection**: When a user types a name in the "Save" input, the modal checks the library projects. If a name collision is detected, the workflow automatically pivots to an **Overwrite Confirmation** dialog.
- **Explicit Gallery Overwrite**: Clicking any project card in the gallery triggers a confirmation dialog to overwrite that specific record with the current workspace.
- **Minimalist Cleanup**: Removed the redundant "Cancel" button and footer, relying on the standard backdrop and Escape key for closure.

## 4. Session & Workspace Logic (`[EditorLayout.jsx](file:///w:/shared/ReactProjects/stretchystudio/src/app/layout/EditorLayout.jsx)`)

### Anchoring
The editor tracks `currentDbProjectId`. 
- Loading from the library "anchors" the session to that ID.
- Saving while anchored defaults the save target to that specific library record.
- Resetting the project "un-anchors" the session.

### New Project Workflow
A dedicated **New Project** button next to Save allows for a clean slate.
- **Safety**: If the scene contains nodes, an `AlertDialog` prevents accidental loss by requiring confirmation.
- **Clean Reset**: Not only clears the store but explicitly calls `parts.destroyAll()` on the GPU to leak-proof the WebGL context between project sessions.

---

## Technical Specs
- **Database**: IndexedDB (Native)
- **Thumbnails**: 4:3 WebP (Data URL)
- **Compression**: JSZip (for the `.stretch` blob)
- **Icons**: Lucide-react
- **Dialogs**: Radix UI / shadcn
