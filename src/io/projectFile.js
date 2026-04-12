import JSZip from 'jszip';

/**
 * Serialize the current project to a .stretch ZIP file.
 * @param {object} project — projectStore.project snapshot
 * @returns {Promise<Blob>} ZIP blob ready for download
 */
export async function saveProject(project) {
  const zip = new JSZip();
  const texturesFolder = zip.folder('textures');

  // Serialize textures: fetch blob URL → store as PNG files
  const serializedTextures = [];
  for (const tex of project.textures) {
    try {
      const response = await fetch(tex.source);
      const blob = await response.blob();
      texturesFolder.file(`${tex.id}.png`, blob);
      serializedTextures.push({ id: tex.id, source: `textures/${tex.id}.png` });
    } catch (err) {
      console.error(`Failed to fetch texture ${tex.id}:`, err);
      serializedTextures.push({ id: tex.id, source: '' });
    }
  }

  // Serialize nodes: convert non-JSON types
  const serializedNodes = project.nodes.map(node => {
    const n = { ...node };
    if (n.mesh) {
      n.mesh = {
        ...n.mesh,
        uvs: Array.from(n.mesh.uvs),
        edgeIndices: Array.from(n.mesh.edgeIndices),
      };
    }
    return n;
  });

  const projectJson = {
    version: project.version,
    canvas: project.canvas,
    textures: serializedTextures,
    nodes: serializedNodes,
    animations: project.animations,
    parameters: project.parameters ?? [],
    physics_groups: project.physics_groups ?? [],
  };

  zip.file('project.json', JSON.stringify(projectJson, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Deserialize a .stretch ZIP file.
 * @param {File} file — the .stretch file from file input
 * @returns {Promise<{ project: object, images: Map<string, HTMLImageElement> }>}
 */
export async function loadProject(file) {
  const zip = await JSZip.loadAsync(file);

  const projectJsonStr = await zip.file('project.json').async('string');
  const project = JSON.parse(projectJsonStr);

  // Restore textures: load PNGs from zip → create blob URLs + Image elements
  const images = new Map();
  for (const tex of project.textures) {
    if (!tex.source) continue;
    try {
      const pngBlob = await zip.file(tex.source).async('blob');
      const blobUrl = URL.createObjectURL(pngBlob);

      // Wait for image to load
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          images.set(tex.id, img);
          resolve();
        };
        img.onerror = reject;
        img.src = blobUrl;
      });

      tex.source = blobUrl;
    } catch (err) {
      console.error(`Failed to load texture ${tex.id}:`, err);
    }
  }

  // Restore mesh typed data
  for (const node of project.nodes) {
    if (node.mesh) {
      node.mesh.uvs = new Float32Array(node.mesh.uvs);
      // edgeIndices stays as Array — partRenderer handles both Array and Set
    }
  }

  return { project, images };
}
