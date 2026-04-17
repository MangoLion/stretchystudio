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
  if (tex.a <= 0.001) discard;
  out_color = tex * u_opacity;
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
  gl_PointSize = 7.0; // Slightly larger for outline
}
`;

// Wireframe fragment shader
export const WIRE_FRAG = `#version 300 es
precision mediump float;

uniform vec4 u_color;
uniform bool u_is_point;

out vec4 out_color;

void main() {
  if (u_is_point) {
    vec2 pc = gl_PointCoord - vec2(0.5);
    float dist = length(pc);
    if (dist > 0.5) discard;
    
    // Simple antialiasing
    float delta = 0.05;
    float alpha = 1.0 - smoothstep(0.45, 0.5, dist);
    
    // White fill with black outline
    if (dist > 0.3) {
      out_color = vec4(0.0, 0.0, 0.0, alpha); // Black outline
    } else {
      out_color = vec4(1.0, 1.0, 1.0, alpha); // White fill
    }
  } else {
    // Standard alpha-blended line — output straight RGBA (not pre-multiplied)
    out_color = u_color;
  }
}
`;
