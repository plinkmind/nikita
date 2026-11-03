// Hair colour, drawn per pixel on the GPU (WebGL) from the real camera picture and a soft hair mask.
//
// For every hair pixel the real brightness is kept as TEXTURE: the new brightness is the shade's brightness plus the pixel's
// own difference from the average hair brightness (with a limited contrast gain and a soft roll-off near white and black, so dark hair
// turned blonde keeps its strands without turning into noise or flat white). The shade gives the colour; 10% of the pixel's own colour variation is kept (natural warm and
// cool strands). Shine (bright, unsaturated pixels well above the average) keeps part of its whiteness, so highlights and
// shadows stay where the room light puts them. Everything is weighted by the mask, so nothing is drawn outside the hair.
//
// The mask arrives as two textures: the hair mask (alpha) and a "face" mask (alpha, inside the face outline). Inside the face the
// mask must be more certain before colour is applied (fringes, yes; forehead skin, no).
const VS = `attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`
const FS = `
precision mediump float;
varying vec2 uv;
uniform sampler2D frame, hair, face;
uniform vec3 col; uniform float ym, yt, strength;
const vec3 LW = vec3(0.299, 0.587, 0.114);
void main() {
  vec3 src = texture2D(frame, uv).rgb;
  float m = texture2D(hair, uv).a, f = texture2D(face, uv).a;
  float a = smoothstep(mix(0.15, 0.45, f), mix(0.6, 0.85, f), m) * strength;
  if (a < 0.003) { gl_FragColor = vec4(0.0); return; }
  float Y = dot(src, LW);
  // skin guard: a pixel much brighter than the hair AND skin-coloured (red clearly above blue) is skin under the soft mask edge
  // (forehead, temples), not hair. Only inside the face outline: outside it, light (blonde) hair looks the same and must stay.
  float skin = smoothstep(0.04, 0.12, src.r - src.b) * smoothstep(ym + 0.22, ym + 0.42, Y);
  a *= 1.0 - skin * f;
  if (a < 0.003) { gl_FragColor = vec4(0.0); return; }
  float k = clamp(yt / max(ym, 0.03), 0.55, 1.6);
  float Yr = yt + (Y - ym) * k;
  // soft shoulder and toe instead of a hard clip: very bright and very dark strands keep their order (texture) near white / black
  float Yn = Yr > 0.86 ? 0.86 + 0.14 * (1.0 - exp(-(Yr - 0.86) / 0.14)) : Yr < 0.06 ? 0.06 * exp((Yr - 0.06) / 0.06) : Yr;
  float yc = max(dot(col, LW), 0.03);
  vec3 c = col * (Yn / yc) + (src - Y) * 0.1;
  float sat = max(src.r, max(src.g, src.b)) - min(src.r, min(src.g, src.b));
  float shine = smoothstep(ym + 0.18, ym + 0.45, Y) * (1.0 - smoothstep(0.1, 0.35, sat));
  c = mix(c, mix(c, vec3(Yn + (Y - ym) * 0.35), 0.6), shine);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * a, a);
}`

export function createHairColour() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2
  let gl = null
  try { gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false }) } catch { gl = null }
  if (!gl) return null
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
  let prog, U, tex, lost = false
  function setup() {
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const lp = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0)
    U = Object.fromEntries(['frame', 'hair', 'face', 'col', 'ym', 'yt', 'strength'].map((n) => [n, gl.getUniformLocation(prog, n)]))
    tex = [0, 1, 2].map((i) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t })
    gl.uniform1i(U.frame, 0); gl.uniform1i(U.hair, 1); gl.uniform1i(U.face, 2)
  }
  try { setup() } catch { return null }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true })
  canvas.addEventListener('webglcontextrestored', () => { try { setup(); lost = false } catch { lost = true } })
  const upload = (i, src) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[i]); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src) }
  // frame: the shown camera picture; hairMask / faceMask: canvases whose alpha is the mask (any size, same framing as frame)
  // rgb: shade 0..1; ym: measured mean hair brightness; yt: shade brightness; strength 0..1
  function render(frame, hairMask, faceMask, rgb, ym, yt, strength) {
    if (lost) return null
    const W = frame.width, H = frame.height
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    gl.viewport(0, 0, W, H); gl.useProgram(prog)
    upload(0, frame); upload(1, hairMask); upload(2, faceMask)
    gl.uniform3f(U.col, rgb[0], rgb[1], rgb[2]); gl.uniform1f(U.ym, ym); gl.uniform1f(U.yt, yt); gl.uniform1f(U.strength, strength)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return canvas
  }
  function dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext() }
  return { render, dispose, get ok() { return !lost } }
}
