import { computeWorldMatrices, computeEffectiveProps } from '@/renderer/transforms';

/**
 * Compute frame specifications for export based on type, animations, and timing.
 * Returns array of { animId, animName, frameIndex, timeMs } for each frame to render.
 */
export function computeExportFrameSpecs({ type, animsToExport, exportFps, frameIndex }) {
  const specs = [];

  for (const anim of animsToExport) {
    const durationMs = anim.duration ?? 2000;
    const sanitized = sanitizeName(anim.name);

    if (type === 'single_frame') {
      // Single frame per animation at given frameIndex/fps
      const timeMs = (frameIndex / exportFps) * 1000;
      specs.push({
        animId: anim.id,
        animName: sanitized,
        frameIndex: frameIndex,
        timeMs: Math.min(timeMs, durationMs),
      });
    } else {
      // Sequence: generate all frames from 0 to duration
      const totalFrames = Math.max(1, Math.round((durationMs / 1000) * exportFps));
      for (let f = 0; f < totalFrames; f++) {
        const timeMs = (f / exportFps) * 1000;
        specs.push({
          animId: anim.id,
          animName: sanitized,
          frameIndex: f,
          timeMs,
        });
      }
    }
  }

  return specs;
}

/**
 * Compute the analytical bounding box of all visible parts in world space.
 * Used for 'min_image_area' export option.
 */
export function computeAnalyticalBounds(project) {
  if (!project?.nodes) return null;

  const partNodes = project.nodes.filter(n => n.type === 'part');
  if (!partNodes.length) return null;

  // Compute world matrices and visibility
  const worldMatrices = computeWorldMatrices(project.nodes);
  const { visMap } = computeEffectiveProps(project.nodes);

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const part of partNodes) {
    if (!visMap.get(part.id)) continue; // Skip invisible parts

    const w = part.imageWidth ?? 0;
    const h = part.imageHeight ?? 0;
    if (w === 0 || h === 0) continue;

    const mat = worldMatrices.get(part.id);
    if (!mat) continue;

    // Transform 4 corners: (0,0), (w,0), (0,h), (w,h)
    const corners = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ];

    for (const [cx, cy] of corners) {
      // Apply world matrix: p' = M * p
      const x = mat[0] * cx + mat[3] * cy + mat[6];
      const y = mat[1] * cx + mat[4] * cy + mat[7];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Resolve which animations to export based on animTarget.
 */
export function resolveAnimations(animations, animTarget, activeAnimationId) {
  if (animTarget === 'staging') {
    return [{ id: 'staging', name: 'staging', duration: 0 }];
  }
  if (animTarget === 'current') {
    const active = animations.find(a => a.id === activeAnimationId) ?? animations[0];
    return active ? [active] : [];
  }
  if (animTarget === 'all') return animations;
  // Specific animation ID
  const specific = animations.find(a => a.id === animTarget);
  return specific ? [specific] : [];
}

/**
 * Export frames to ZIP or Folder.
 * frames: [{ animName, frameIndex, dataUrl }, ...]
 * format: 'png' | 'webp' | 'jpg'
 * exportDest: 'zip' | 'folder'
 */
export async function exportFrames({ frames, format, exportDest, onProgress }) {
  const ext = format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';

  // If only one frame, download directly instead of using ZIP/Folder
  if (frames.length === 1) {
    const frame = frames[0];
    const filename = `${frame.animName}_frame_${String(frame.frameIndex + 1).padStart(4, '0')}.${ext}`;
    const a = document.createElement('a');
    a.href = frame.dataUrl;
    a.download = filename;
    a.click();
    return;
  }

  if (exportDest === 'folder') {
    await exportToFolder(frames, ext, onProgress);
  } else {
    await exportToZip(frames, ext, onProgress);
  }
}

/**
 * Export frames to a ZIP file.
 */
async function exportToZip(frames, ext, onProgress) {
  // Dynamic import JSZip
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  // Group frames by animation
  const byAnim = new Map();
  for (const frame of frames) {
    if (!byAnim.has(frame.animName)) byAnim.set(frame.animName, []);
    byAnim.get(frame.animName).push(frame);
  }

  // Write each animation folder
  for (const [animName, animFrames] of byAnim) {
    const folder = zip.folder(animName);
    for (const { frameIndex, dataUrl } of animFrames) {
      const filename = `frame_${String(frameIndex + 1).padStart(4, '0')}.${ext}`;
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      folder.file(filename, blob);
      onProgress?.(`Packing ${animName}/${filename}`);
    }
  }

  onProgress?.('Generating ZIP...');
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.zip';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export frames to a system folder via File System Access API.
 */
async function exportToFolder(frames, ext, onProgress) {
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    console.warn('[Export] Folder picker cancelled:', err);
    return;
  }

  // Group frames by animation
  const byAnim = new Map();
  for (const frame of frames) {
    if (!byAnim.has(frame.animName)) byAnim.set(frame.animName, []);
    byAnim.get(frame.animName).push(frame);
  }

  // Write each animation folder
  for (const [animName, animFrames] of byAnim) {
    const subDir = await dirHandle.getDirectoryHandle(animName, { create: true });
    for (const { frameIndex, dataUrl } of animFrames) {
      const filename = `frame_${String(frameIndex + 1).padStart(4, '0')}.${ext}`;
      const fileHandle = await subDir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      await writable.write(blob);
      await writable.close();
      onProgress?.(`Writing ${animName}/${filename}`);
    }
  }
}

/**
 * Sanitize animation name for filesystem use.
 * Replace non-alphanumeric characters with underscore.
 */
function sanitizeName(name) {
  return (name ?? 'animation')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
