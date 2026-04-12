// Vertex shader — textured mesh
export const MESH_VERT = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_uv;

uniform mat3 u_mvp;

out vec2 v_uv;

void main() {
  vec3 pos = u_mvp * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_uv = a_uv;
}
`;

// Fragment shader — sample texture with alpha
export const MESH_FRAG = `#version 300 es
precision mediump float;

in vec2 v_uv;

uniform sampler2D u_texture;
uniform float     u_opacity;

out vec4 out_color;

void main() {
  vec4 tex = texture(u_texture, v_uv);
  if (tex.a < 0.1) discard;
  out_color = vec4(tex.rgb, tex.a * u_opacity);
}
`;

// Wireframe vertex shader (2-D passthrough)
export const WIRE_VERT = `#version 300 es
precision highp float;

in vec2 a_position;
uniform mat3 u_mvp;

void main() {
  vec3 pos = u_mvp * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  gl_PointSize = 6.0; // Fixed size for vertices
}
`;

// Wireframe fragment shader
export const WIRE_FRAG = `#version 300 es
precision mediump float;

uniform vec4 u_color;
out vec4 out_color;

void main() {
  out_color = u_color;
}
`;
