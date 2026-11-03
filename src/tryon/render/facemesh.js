// 3D face mask: the tracked face as a real triangle mesh (MediaPipe's 468-point topology, 898 triangles), drawn with WebGL.
//
// Why: skin products (foundation, concealer, blush, highlighter) used to be 2D shapes (ovals) placed between landmarks. A 2D
// oval does not bend around the cheek, does not get narrower when the head turns, and is painted on top of the nose when a
// cheek goes behind it. Here every product is painted ONCE into the face's texture space (UV, a flat "unwrapped" face, the
// same for everyone), and that texture is wrapped onto the live mesh every frame:
//  - every vertex is a tracked landmark in 3D (x, y on the picture, z = depth), so the paint stretches, foreshortens and
//    moves with the real face surface, including expressions (a smile lifts the blush with the cheek);
//  - a depth buffer hides parts of the face that are behind other parts (the far cheek behind the nose);
//  - each vertex knows which way its surface faces (from the fitted 3D head rotation): paint fades out on surfaces seen
//    edge-on, the way real makeup disappears around the side of the face.
// The camera picture and the mesh use the same coordinates (canvas pixels of the camera frame, mirrored for the selfie view),
// so there is no separate 3D camera to keep in sync. If WebGL is not available the studio falls back to the 2D renderer.
import { FACE_TRI, FACE_UV } from '../track/facemesh.js'
import { CANON } from '../track/canonical.js'
import { rotate } from '../track/geometry.js'

const N = 468

// outward surface normal of every vertex of the canonical face (computed once). Rotated by the head pose each frame.
const NORMALS = (() => {
  const n = new Float32Array(N * 3)
  for (let t = 0; t < FACE_TRI.length; t += 3) {
    const i = FACE_TRI[t] * 3, j = FACE_TRI[t + 1] * 3, k = FACE_TRI[t + 2] * 3
    const u = [CANON[j] - CANON[i], CANON[j + 1] - CANON[i + 1], CANON[j + 2] - CANON[i + 2]]
    const v = [CANON[k] - CANON[i], CANON[k + 1] - CANON[i + 1], CANON[k + 2] - CANON[i + 2]]
    const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    for (const a of [i, j, k]) { n[a] += x[0]; n[a + 1] += x[1]; n[a + 2] += x[2] }
  }
  for (let a = 0; a < n.length; a += 3) { const l = Math.hypot(n[a], n[a + 1], n[a + 2]) || 1; n[a] /= l; n[a + 1] /= l; n[a + 2] /= l }
  return n
})()

const VS = `
attribute vec3 aPos; attribute vec2 aUv; attribute float aFace;
uniform vec2 uSize; uniform float uZ0; uniform float uZk;
varying vec2 vUv; varying float vFace;
void main() {
  vUv = aUv; vFace = aFace;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, clamp((aPos.z - uZ0) * uZk, -0.99, 0.99), 1.0);
}`
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform float uAlpha;
varying vec2 vUv; varying float vFace;
void main() {
  // facing: 1 = surface turned to the camera, 0 = seen edge-on
  gl_FragColor = texture2D(uTex, vUv) * (uAlpha * smoothstep(0.08, 0.45, vFace));
}`

export function createFaceMesh() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 2
  let gl = null
  try { gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, preserveDrawingBuffer: true }) } catch { gl = null }
  if (!gl) return null
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
  let prog, loc, bPos, bUv, bFace, bIdx
  const textures = new Map()
  let last = null // last painted texture (debug view)
  let lost = false
  function setup() {
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    loc = { pos: gl.getAttribLocation(prog, 'aPos'), uv: gl.getAttribLocation(prog, 'aUv'), face: gl.getAttribLocation(prog, 'aFace'), size: gl.getUniformLocation(prog, 'uSize'), z0: gl.getUniformLocation(prog, 'uZ0'), zk: gl.getUniformLocation(prog, 'uZk'), tex: gl.getUniformLocation(prog, 'uTex'), alpha: gl.getUniformLocation(prog, 'uAlpha') }
    bPos = gl.createBuffer(); bFace = gl.createBuffer()
    bUv = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bUv); gl.bufferData(gl.ARRAY_BUFFER, FACE_UV, gl.STATIC_DRAW)
    bIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FACE_TRI, gl.STATIC_DRAW)
    textures.clear()
  }
  setup()
  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true })
  cv.addEventListener('webglcontextrestored', () => { try { setup(); lost = false } catch { lost = true } })

  const pos = new Float32Array(N * 3), face = new Float32Array(N)
  let box = null

  // upload this frame's face (once per frame, shared by every product)
  function update(M) {
    if (lost || !M?.fit) return false
    const { P, W, H } = M
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    let zs = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < N; i++) {
      const p = P[i]; pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; zs += p.z
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y
      const n = rotate(M.fit.R, [NORMALS[i * 3], NORMALS[i * 3 + 1], NORMALS[i * 3 + 2]])
      face[i] = -n[2] // camera looks along +z (away from the viewer); > 0 = facing the camera
    }
    const pad = 4
    box = { x: Math.max(0, Math.floor(x0 - pad)), y: Math.max(0, Math.floor(y0 - pad)) }
    box.w = Math.min(W, Math.ceil(x1 + pad)) - box.x; box.h = Math.min(H, Math.ceil(y1 + pad)) - box.y
    if (box.w < 4 || box.h < 4) { box = null; return false }
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW)
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(loc.pos)
    gl.bindBuffer(gl.ARRAY_BUFFER, bFace); gl.bufferData(gl.ARRAY_BUFFER, face, gl.DYNAMIC_DRAW)
    gl.vertexAttribPointer(loc.face, 1, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(loc.face)
    gl.bindBuffer(gl.ARRAY_BUFFER, bUv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(loc.uv)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx)
    gl.uniform2f(loc.size, W, H); gl.uniform1f(loc.z0, zs / N); gl.uniform1f(loc.zk, 1 / W)
    gl.viewport(0, 0, W, H)
    return true
  }

  // the texture for one product look, painted once in face texture space and cached (key = product + shade + options)
  function texture(key, paint) {
    let t = textures.get(key)
    if (t) return t
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S
    paint(c.getContext('2d'), S)
    t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (textures.size > 40) { const [k0, t0] = textures.entries().next().value; gl.deleteTexture(t0); textures.delete(k0) } // shade changes: keep memory bounded
    textures.set(key, t); last = c
    return t
  }

  // draw one texture on the face; the result is composited into `c` with each [blend mode, opacity] pass
  function draw(c, tex, passes) {
    if (lost || !box) return false
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc.tex, 0); gl.uniform1f(loc.alpha, 1)
    gl.drawElements(gl.TRIANGLES, FACE_TRI.length, gl.UNSIGNED_SHORT, 0)
    for (const [mode, alpha] of passes) {
      if (alpha <= 0.002) continue
      c.save(); c.globalCompositeOperation = mode; c.globalAlpha = Math.min(1, alpha)
      c.drawImage(cv, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h) // only the face area is composited
      c.restore()
    }
    return true
  }

  function dispose() { textures.forEach((t) => gl.deleteTexture(t)); textures.clear(); gl.getExtension('WEBGL_lose_context')?.loseContext() }
  return { update, texture, draw, dispose, canvas: cv, get lastTexture() { return last }, get ok() { return !lost } }
}

// ---- painting in face texture space ----
// UV of a landmark in texture pixels. Texture space is a frontal "unwrap" of the face: 1 unit of u is about 15.6 cm and 1 unit
// of v about 20.9 cm on a real face, so round shapes are drawn with that aspect (CM_U, CM_V) to come out round on the face.
export const CM_U = 15.65, CM_V = 20.9
export const uv = (i, S) => ({ x: FACE_UV[i * 2] * S, y: FACE_UV[i * 2 + 1] * S })
