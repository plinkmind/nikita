// Draws the warped garment mesh (garmentwarp.js) on the GPU (WebGL).
//
// Colours: the garment photo's own colours are kept. On top of them only LIGHT is applied, as a brightness factor:
//  - the folds and light/shadow of what you are wearing, taken from the camera picture as a RATIO (local brightness / brightness
//    around it, limited to -20%..+18%). A ratio does not carry the colour of your own clothes, only how light falls on them.
//    Big brightness steps (your own neckline or straps, a print, things behind you) are left out: only soft changes count as folds.
//    (A soft print on your own clothes can still show a little: that is the limit of using the picture for shading.)
//  - the body's curvature (the sides of the torso turn away from the camera and get a little darker, more so on the side away
//    from the room light) and the room's exposure and colour cast (from the face light estimate, light.js).
// Outline: above the hips the garment is limited to your body outline (person mask from the pose model, slightly widened) so it does
// not hang in the air beside you; below the hips it keeps its own shape (a skirt can be wider than you).
const VS = `
attribute vec2 pos, uv; attribute float turn, clip;
uniform vec2 size;
varying vec2 vuv, vsc; varying float vturn, vclip;
void main() { vuv = uv; vsc = pos / size; vturn = turn; vclip = clip; gl_Position = vec4(pos.x / size.x * 2.0 - 1.0, 1.0 - pos.y / size.y * 2.0, 0.0, 1.0); }`
const FS = `
precision mediump float;
varying vec2 vuv, vsc; varying float vturn, vclip;
uniform sampler2D garm, frame, person;
uniform vec2 px, poff; uniform float rs, rl, fold, expo, lx, usePerson, contrast;
uniform vec3 tint;
const vec3 LW = vec3(0.299, 0.587, 0.114);
float Y(vec2 p) { return dot(texture2D(frame, p).rgb, LW); }
void main() {
  vec4 g = texture2D(garm, vuv);
  if (g.a < 0.004) discard;
  // fold / light ratio from the camera picture: small-area brightness over wider-area brightness
  vec2 s = px * rs, l = px * rl;
  float sm = (Y(vsc) * 2.0 + Y(vsc + vec2(s.x, 0.0)) + Y(vsc - vec2(s.x, 0.0)) + Y(vsc + vec2(0.0, s.y)) + Y(vsc - vec2(0.0, s.y))) / 6.0;
  float lg = (Y(vsc + vec2(l.x, 0.0)) + Y(vsc - vec2(l.x, 0.0)) + Y(vsc + vec2(0.0, l.y)) + Y(vsc - vec2(0.0, l.y))
            + Y(vsc + l * 0.7) + Y(vsc - l * 0.7) + Y(vsc + vec2(l.x, -l.y) * 0.7) + Y(vsc + vec2(-l.x, l.y) * 0.7) + sm) / 9.0;
  // a fold or a soft shadow changes brightness by a little; a big change is an EDGE of something (your own neckline, a strap, a
  // stone behind you): those are not carried onto the garment
  float r = sm / max(lg, 0.03), dev = abs(log(r));
  float ratio = mix(1.0, clamp(r, 0.8, 1.18), fold * (1.0 - smoothstep(0.07, 0.18, dev)));
  // body curvature: front faces the camera (cos = 1), sides turn away; the side toward the light is brighter
  float c = cos(vturn), side = sin(vturn);
  float shade = mix(0.74, 1.0, smoothstep(-0.1, 0.85, c)) * (1.0 + 0.12 * contrast * side * lx);
  vec3 rgb = g.rgb * ratio * shade * expo * tint;
  float m = texture2D(person, vsc - poff).a;
  float a = g.a * mix(1.0, smoothstep(0.08, 0.45, m), vclip * usePerson);
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0) * a, a);
}`

export function createGarmentGL() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2
  let gl = null
  try { gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: true }) } catch { gl = null }
  if (!gl) return null
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
  let prog, U, A, tex, buf, lost = false, garmFor = null, idxN = 0, meshFor = null
  function setup() {
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    U = Object.fromEntries(['size', 'garm', 'frame', 'person', 'px', 'poff', 'rs', 'rl', 'fold', 'expo', 'lx', 'usePerson', 'contrast', 'tint'].map((n) => [n, gl.getUniformLocation(prog, n)]))
    A = Object.fromEntries(['pos', 'uv', 'turn', 'clip'].map((n) => [n, gl.getAttribLocation(prog, n)]))
    buf = { pos: gl.createBuffer(), uv: gl.createBuffer(), turn: gl.createBuffer(), clip: gl.createBuffer(), idx: gl.createBuffer() }
    tex = [0, 1, 2].map((i) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t })
    gl.uniform1i(U.garm, 0); gl.uniform1i(U.frame, 1); gl.uniform1i(U.person, 2)
    garmFor = null; meshFor = null
  }
  try { setup() } catch { return null }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true })
  canvas.addEventListener('webglcontextrestored', () => { try { setup(); lost = false } catch { lost = true } })
  const upload = (i, src) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[i]); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src) }
  const attr = (name, data, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf[name]); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(A[name]); gl.vertexAttribPointer(A[name], n, gl.FLOAT, false, 0, 0) }
  const one = new Uint8Array([255, 255, 255, 255]), half = document.createElement('canvas')
  // garment: canvas with alpha; mesh: garmentMesh(); W: warpMesh() result; frame: shown picture (any size, same framing);
  // person: { canvas (alpha = person), off: {x, y} px } or null; o: { fold, light, sw }
  function render(w, h, garment, mesh, Wp, frame, person, o = {}) {
    if (lost) return null
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    gl.viewport(0, 0, w, h); gl.useProgram(prog)
    if (garmFor !== garment) { upload(0, garment); garmFor = garment }
    // the camera picture is only used for soft light changes: a half-size copy is enough (and cheaper to send to the GPU each frame)
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1); if (half.width !== hw || half.height !== hh) { half.width = hw; half.height = hh }
    half.getContext('2d').drawImage(frame, 0, 0, hw, hh); upload(1, half)
    if (person) upload(2, person.canvas); else { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex[2]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, one) }
    attr('pos', Wp.pos, 2); attr('turn', Wp.turn, 1); attr('clip', Wp.clip, 1)
    if (meshFor !== mesh) {
      const uv = new Float32Array(mesh.uv.length); for (let i = 0; i < uv.length; i += 2) { uv[i] = (mesh.uv[i] + 0.5) / garment.width; uv[i + 1] = (mesh.uv[i + 1] + 0.5) / garment.height }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW); idxN = mesh.idx.length; meshFor = mesh
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv); gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx)
    const L = o.light, sw = o.sw || w * 0.3
    gl.uniform2f(U.size, w, h); gl.uniform2f(U.px, 1 / w, 1 / h)
    gl.uniform2f(U.poff, person ? (person.off?.x || 0) / w : 0, person ? (person.off?.y || 0) / h : 0)
    gl.uniform1f(U.rs, Math.max(2, sw * 0.02)); gl.uniform1f(U.rl, Math.max(8, sw * 0.12)); gl.uniform1f(U.fold, o.fold ?? 0.75)
    // exposure: half way toward the room's brightness (a garment photo is usually brighter than a room); colour cast at half strength
    gl.uniform1f(U.expo, L ? Math.max(0.7, Math.min(1.05, 0.5 + 0.5 * L.bright)) : 1)
    gl.uniform3f(U.tint, ...(L ? L.tint.map((v) => 1 + (v - 1) * 0.5) : [1, 1, 1]))
    gl.uniform1f(U.lx, L ? L.dir.x : 0); gl.uniform1f(U.contrast, L ? Math.min(1, L.contrast) : 0.3)
    gl.uniform1f(U.usePerson, person ? 1 : 0)
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawElements(gl.TRIANGLES, idxN, gl.UNSIGNED_SHORT, 0)
    return canvas
  }
  function dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext() }
  return { render, dispose, get ok() { return !lost } }
}
