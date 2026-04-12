/**
 * PartRenderer — manages one VAO per scene part.
 *
 * VAO layout (interleaved):
 *   attribute 0  a_position  vec2  (bytes 0-7)
 *   attribute 1  a_uv        vec2  (bytes 8-15)
 *   stride = 16 bytes per vertex
 *
 * Index buffer holds triangle indices as Uint16Array (or Uint32Array for >65k verts).
 */

const BYTES_PER_VERTEX = 16; // 4 floats × 4 bytes

export class PartRenderer {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {WebGLProgram}           meshProgram
   * @param {WebGLProgram}           wireProgram
   */
  constructor(gl, meshProgram, wireProgram) {
    this.gl = gl;
    this.meshProgram = meshProgram;
    this.wireProgram = wireProgram;
    /** @type {Map<string, PartGPUState>} */
    this._parts = new Map();
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  /**
   * Full mesh upload — call when mesh topology changes (new triangulation).
   * @param {string} partId
   * @param {{ vertices: Array<{x,y,uvX?,uvY?}>, uvs: Float32Array, triangles: Array<[number,number,number]> }} mesh
   */
  uploadMesh(partId, mesh) {
    const { gl } = this;
    const { vertices, uvs, triangles } = mesh;
    const n = vertices.length;

    // Build interleaved [x, y, u, v] buffer
    const vertexData = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      vertexData[i * 4]     = vertices[i].x;
      vertexData[i * 4 + 1] = vertices[i].y;
      vertexData[i * 4 + 2] = uvs[i * 2];
      vertexData[i * 4 + 3] = uvs[i * 2 + 1];
    }

    // Flat index array
    const indexData = new Uint16Array(triangles.length * 3);
    for (let i = 0; i < triangles.length; i++) {
      indexData[i * 3]     = triangles[i][0];
      indexData[i * 3 + 1] = triangles[i][1];
      indexData[i * 3 + 2] = triangles[i][2];
    }

    // Reuse or create GPU state
    let state = this._parts.get(partId);
    if (!state) {
      state = {
        vao:        null,
        vbo:        null,
        ibo:        null,
        edgeIbo:    null,
        texture:    null,
        indexCount: 0,
        edgeIndexCount: 0,
        vertCount:  0,
      };
      this._parts.set(partId, state);
    }

    if (!state.vao) state.vao = gl.createVertexArray();
    if (!state.vbo) state.vbo = gl.createBuffer();
    if (!state.ibo) state.ibo = gl.createBuffer();
    if (!state.edgeIbo) state.edgeIbo = gl.createBuffer();

    state.indexCount = indexData.length;
    state.vertCount  = n;

    // Bind VAO and upload buffers
    gl.bindVertexArray(state.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, state.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);

    // a_position: location 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);

    // a_uv: location 1
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 8);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

    // Edge indices
    if (mesh.edgeIndices) {
      const edgeData = new Uint16Array(mesh.edgeIndices);
      state.edgeIndexCount = edgeData.length;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.edgeIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edgeData, gl.STATIC_DRAW);
    } else {
      state.edgeIndexCount = 0;
    }

    // Ensure the main triangle ibo is bound to the VAO for the textured mesh pass
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.ibo);

    gl.bindVertexArray(null);
  }

  /**
   * Positions-only re-upload — hot path for vertex drag.
   * Does not change UVs or topology.
   * @param {string}                         partId
   * @param {Array<{x:number,y:number}>}     vertices
   * @param {Float32Array}                   uvs
   */
  uploadPositions(partId, vertices, uvs) {
    const { gl } = this;
    const state = this._parts.get(partId);
    if (!state) return;

    const n = vertices.length;
    const vertexData = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      vertexData[i * 4]     = vertices[i].x;
      vertexData[i * 4 + 1] = vertices[i].y;
      vertexData[i * 4 + 2] = uvs[i * 2];
      vertexData[i * 4 + 3] = uvs[i * 2 + 1];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexData);
  }

  /**
   * Upload (or replace) the texture for a part.
   * @param {string}                         partId
   * @param {HTMLImageElement|ImageBitmap|ImageData} source
   */
  uploadTexture(partId, source) {
    const { gl } = this;
    let state = this._parts.get(partId);
    if (!state) {
      // Create a stub state that can hold the texture before mesh arrives
      state = { vao: null, vbo: null, ibo: null, texture: null, indexCount: 0, vertCount: 0 };
      this._parts.set(partId, state);
    }

    if (state.texture) gl.deleteTexture(state.texture);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);

    state.texture = tex;
  }

  /**
   * Upload a simple 2-triangle quad as the GPU mesh for a part.
   * Used when no actual mesh exists, so the full texture rect renders correctly.
   * @param {string} partId
   * @param {number} w - image width in pixels (local space)
   * @param {number} h - image height in pixels (local space)
   */
  uploadQuadFallback(partId, w, h) {
    const vertices = [
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
    ];
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const triangles = [[0, 1, 2], [0, 2, 3]];
    // Don't set edgeIndices for fallback quad — no wireframe visualization for mesh-less parts
    this.uploadMesh(partId, { vertices, uvs, triangles, edgeIndices: [] });
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  /**
   * Draw one part's mesh (textured).
   * Caller must have already called gl.useProgram(meshProgram).
   * @param {string}       partId
   * @param {Float32Array} mvp      - 9-element column-major 3×3 matrix
   * @param {number}       opacity
   * @param {WebGLUniformLocation} uMvp
   * @param {WebGLUniformLocation} uTexture
   * @param {WebGLUniformLocation} uOpacity
   */
  drawPart(partId, mvp, opacity, uMvp, uTexture, uOpacity) {
    const { gl } = this;
    const state = this._parts.get(partId);
    if (!state || !state.vao || !state.texture || state.indexCount === 0) return;

    gl.uniformMatrix3fv(uMvp, false, mvp);
    gl.uniform1f(uOpacity, opacity);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.uniform1i(uTexture, 0);

    gl.bindVertexArray(state.vao);
    gl.drawElements(gl.TRIANGLES, state.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Draw part wireframe for selection overlay.
   * @param {string}       partId
   * @param {Float32Array} mvp
   * @param {WebGLUniformLocation} uMvp
   * @param {WebGLUniformLocation} uColor
   */
  drawWireframe(partId, mvp, uMvp, uColor) {
    const { gl } = this;
    const state = this._parts.get(partId);
    // Skip wireframe for fallback quads (no edge indices = no real mesh)
    if (!state || !state.vao || state.indexCount === 0 || state.edgeIndexCount === 0) return;

    gl.uniformMatrix3fv(uMvp, false, mvp);
    gl.uniform4f(uColor, 0.2, 0.9, 0.5, 0.6); // translucent green

    gl.bindVertexArray(state.vao);
    // Draw as lines — loop over each triangle
    gl.drawElements(gl.LINES, state.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Draw the boundary edge loop as a LINE_LOOP.
   * Caller must have already called gl.useProgram(wireProgram).
   * @param {string} partId
   * @param {Float32Array} mvp
   * @param {WebGLUniformLocation} uMvp
   * @param {WebGLUniformLocation} uColor
   */
  drawEdgeOutline(partId, mvp, uMvp) {
    const { gl } = this;
    const state = this._parts.get(partId);
    if (!state || !state.vao || state.edgeIndexCount === 0) return;

    gl.uniformMatrix3fv(uMvp, false, mvp);

    gl.bindVertexArray(state.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.edgeIbo);
    gl.drawElements(gl.LINE_LOOP, state.edgeIndexCount, gl.UNSIGNED_SHORT, 0);
    // Restore triangle IBO
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.ibo);
    gl.bindVertexArray(null);
  }

  /**
   * Draw vertices as points.
   * @param {string} partId
   * @param {Float32Array} mvp
   * @param {WebGLUniformLocation} uMvp
   * @param {WebGLUniformLocation} uColor
   */
  drawVertices(partId, mvp, uMvp, uColor) {
    const { gl } = this;
    const state = this._parts.get(partId);
    if (!state || !state.vao || state.vertCount === 0) return;

    gl.bindVertexArray(state.vao);

    // 1. Draw all vertices (Density points - dark blue/purple)
    gl.uniformMatrix3fv(uMvp, false, mvp);
    gl.uniform4f(uColor, 0.4, 0.2, 0.8, 0.8); // Purple for density
    gl.drawArrays(gl.POINTS, 0, state.vertCount);

    // 2. Draw edge vertices (Bright green)
    if (state.edgeIndexCount > 0) {
      gl.uniform4f(uColor, 0.2, 0.9, 0.1, 1.0); // Bright green for edges
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.edgeIbo);
      gl.drawElements(gl.POINTS, state.edgeIndexCount, gl.UNSIGNED_SHORT, 0);
      
      // Restore standard triangle index buffer binding for this VAO
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.ibo);
    }

    gl.bindVertexArray(null);
  }


  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Destroy GPU resources for a part.
   * @param {string} partId
   */
  destroyPart(partId) {
    const { gl } = this;
    const state = this._parts.get(partId);
    if (!state) return;
    if (state.vao)     gl.deleteVertexArray(state.vao);
    if (state.vbo)     gl.deleteBuffer(state.vbo);
    if (state.ibo)     gl.deleteBuffer(state.ibo);
    if (state.edgeIbo) gl.deleteBuffer(state.edgeIbo);
    if (state.texture) gl.deleteTexture(state.texture);
    this._parts.delete(partId);
  }

  destroyAll() {
    for (const id of this._parts.keys()) this.destroyPart(id);
  }
}
