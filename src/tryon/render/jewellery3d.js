// 3D jewellery (Three.js): real 3D pieces with metal and gem materials, lit by the estimated room light, hidden by the head
// where the head is in front of them.
//
// Coordinates: the same as everything else in the studio. One Three.js unit = one pixel of the camera frame; x to the right,
// y up (= minus picture y), z toward the viewer (= minus tracker depth). An orthographic camera looks straight at the picture,
// so a piece at picture position (x, y) is drawn exactly there - nothing to keep in sync with a second 3D camera.
// The head pose (rotation, size, position) is the fitted 3D head from track/head.js; pieces are modelled in centimetres.
//
// Occlusion: the tracked face mesh (468 points) and an ellipsoid for the rest of the head are drawn into the depth buffer only
// (invisible). So the far earring disappears behind the cheek / head when you turn, and the chin hides the necklace when you
// look down - per pixel, not by fading.
//
// Pieces: built in code from simple shapes for the demo (no files needed). A real product can be a GLB file instead:
// add `model: '/products/my-earring.glb'` to its catalogue entry. Model it in centimetres, with the point that goes through
// the ear lobe (or the centre of the neck line) at the origin, hanging along -y, front facing +z.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FACE_TRI } from '../track/facemesh.js'
import { ANCHORS } from '../track/head.js'
import { apply, rotate } from '../track/geometry.js'

// ---------- demo pieces, in centimetres ----------
const gold = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.26 })
const gem = (c) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, ior: 2.0, reflectivity: 1, specularIntensity: 1 })
const pearl = () => new THREE.MeshPhysicalMaterial({ color: 0xf6efe6, metalness: 0, roughness: 0.25, sheen: 1, sheenColor: new THREE.Color(0xffe8f0), clearcoat: 0.6 })

function stud(col) {
  const g = new THREE.Group()
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.09, 12, 32), gold(col)); g.add(bezel)
  const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), gem(0xffffff)); stone.scale.set(1, 1, 0.6); g.add(stone)
  g.userData.hang = false; return g
}
function hoop(col) {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.11, 16, 72), gold(col)); ring.position.y = -1.15
  const plane = new THREE.Group(); plane.add(ring); plane.rotation.y = Math.PI * 0.38 // the hoop hangs along the side of the head
  g.add(plane); g.userData.hang = true; return g
}
function jhumka(col) {
  const g = new THREE.Group(), m = gold(col)
  const top = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 28), m); g.add(top)
  const topGem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), gem(0xffd9e6)); topGem.scale.z = 0.6; g.add(topGem)
  const link = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), m); link.position.y = -0.55; g.add(link)
  // the bell: a lathe profile (dome that flares out), radius ~0.85 cm, height ~1.2 cm
  const prof = [[0.05, 0], [0.25, -0.05], [0.42, -0.2], [0.55, -0.45], [0.68, -0.8], [0.82, -1.1], [0.86, -1.2], [0.8, -1.22]].map(([x, y]) => new THREE.Vector2(x, y))
  const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), m); bell.position.y = -0.8; bell.material.side = THREE.DoubleSide; g.add(bell)
  const ringBand = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.05, 8, 64), m); ringBand.rotation.x = Math.PI / 2; ringBand.position.y = -2.0; g.add(ringBand)
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 12, 8), pearl(), 18)
  const mtx = new THREE.Matrix4(); for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; mtx.makeTranslation(Math.cos(a) * 0.86, -2.12, Math.sin(a) * 0.86); beads.setMatrixAt(i, mtx) } g.add(beads)
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), pearl()); drop.position.y = -2.55; g.add(drop)
  g.userData.hang = true; return g
}
function drop(col) {
  const g = new THREE.Group(), m = gold(col)
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), m); g.add(top)
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 6), m); chain.position.y = -0.8; g.add(chain)
  const prof = [[0, 0.55], [0.18, 0.4], [0.35, 0.05], [0.4, -0.25], [0.3, -0.5], [0, -0.6]].map(([x, y]) => new THREE.Vector2(x, y))
  const stone = new THREE.Mesh(new THREE.LatheGeometry(prof, 6), gem(0x9ee6c8)); stone.position.y = -2.1; stone.scale.z = 0.7; g.add(stone)
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.25, 6, 1, true), m); cap.position.y = -1.55; cap.rotation.x = Math.PI; g.add(cap)
  g.userData.hang = true; return g
}
// necklace: beads along a U curve in front of the collarbones, with a pendant (centimetres, origin = middle of the neck line)
function necklace(col, fwCm) {
  const g = new THREE.Group(), m = gold(col), half = fwCm * 0.36, dropCm = fwCm * 0.5
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-half, fwCm * 0.18, -1.5), new THREE.Vector3(0, -dropCm, 1.2), new THREE.Vector3(half, fwCm * 0.18, -1.5))
  const n = 46, beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 14, 10), m, n), mtx = new THREE.Matrix4()
  for (let i = 0; i < n; i++) { const p = curve.getPoint(i / (n - 1)); mtx.makeTranslation(p.x, p.y, p.z); beads.setMatrixAt(i, mtx) } g.add(beads)
  const mid = curve.getPoint(0.5)
  const pend = new THREE.Group(); pend.position.copy(mid)
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 12, 40), m); frame.position.y = -0.75; pend.add(frame)
  const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), gem(0xd0103a)); stone.scale.z = 0.55; stone.position.y = -0.75; pend.add(stone)
  g.add(pend)
  return g
}
export const DEMO = { stud, hoop, jhumka, drop, necklace }

// ---------- renderer ----------
const BASE = new THREE.Matrix4() // scratch
export function createJewellery3D() {
  const canvas = document.createElement('canvas')
  let renderer
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: true }) } catch { return null }
  renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(0, 2, 0, -2, -50000, 50000); camera.position.z = 20000
  const pmrem = new THREE.PMREMGenerator(renderer), env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = env
  const key = new THREE.DirectionalLight(0xffffff, 1.6), amb = new THREE.AmbientLight(0xffffff, 0.35); scene.add(key, amb, key.target)
  // invisible occluders: face mesh + head ellipsoid (depth only)
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false })
  const faceGeo = new THREE.BufferGeometry(), facePos = new Float32Array(468 * 3)
  faceGeo.setAttribute('position', new THREE.BufferAttribute(facePos, 3)); faceGeo.setIndex(new THREE.BufferAttribute(FACE_TRI, 1))
  const face = new THREE.Mesh(faceGeo, occMat); face.frustumCulled = false; face.renderOrder = -1; scene.add(face)
  const headEll = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), occMat); headEll.renderOrder = -1; headEll.matrixAutoUpdate = false; scene.add(headEll)
  const ears = { lobeL: new THREE.Group(), lobeR: new THREE.Group() }, neckG = new THREE.Group(); scene.add(ears.lobeL, ears.lobeR, neckG)
  const swing = { lobeL: { a: 0, v: 0, x: null, t: 0 }, lobeR: { a: 0, v: 0, x: null, t: 0 } }
  const loader = new GLTFLoader(), models = {}
  let current = { ear: null, neck: null }

  // which pieces to show: { ear: {key, build, col, size, model}, neck: {...} } (key changes -> rebuild)
  function setPieces(want) {
    for (const slot of ['ear', 'neck']) {
      const w = want[slot], key = w ? `${w.key}:${w.col}` : null
      if ((current[slot]?.k || null) === key) continue
      const groups = slot === 'ear' ? [ears.lobeL, ears.lobeR] : [neckG]
      groups.forEach((G) => { G.children.slice().forEach((c) => { G.remove(c); if (!c.userData.fromFile) c.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.() }) }) })
      current[slot] = w ? { k: key } : null
      if (!w) continue
      groups.forEach((G, side) => {
        if (w.model) { // a real product file
          const add = (gltf, g2) => { const o = gltf.scene.clone(true); o.userData.fromFile = true; g2.add(o) }
          if (models[w.model]) add(models[w.model], G); else if (side === 0) loader.load(w.model, (gl) => { models[w.model] = gl; if (current[slot]?.k === key) groups.forEach((g2) => add(gl, g2)) })
        } else { const o = w.build(w.col, w.fwCm); o.userData.hang = o.userData.hang ?? false; G.add(o) }
        G.userData.hang = w.hang
      })
    }
  }

  // light: render/light.js value (display coordinates: x right, y down, z toward the viewer)
  function render(M, light, T, size = { ear: 1, neck: 1 }, neckFrame = null) {
    const { W, H, fit, mirror } = M
    if (canvas.width !== W || canvas.height !== H) { renderer.setSize(W, H, false); camera.right = W; camera.bottom = -H; camera.updateProjectionMatrix() }
    // light
    if (light) {
      key.position.set(light.dir.x * 1000, -light.dir.y * 1000, light.dir.z * 1000); key.target.position.set(0, 0, 0)
      const c = new THREE.Color(Math.min(1, light.tint[0]), Math.min(1, light.tint[1]), Math.min(1, light.tint[2]))
      key.color.copy(c); amb.color.copy(c)
      key.intensity = 1.2 * light.bright * (0.6 + Math.min(1, light.contrast)); amb.intensity = 0.3 * light.bright; scene.environmentIntensity = 0.75 * light.bright
    }
    // head pose as a 4x4: canonical cm -> world (display pixels, y up, z toward the viewer)
    const sx = mirror ? -1 : 1, R = fit.R, s = fit.s, t = fit.t
    const F = (r) => [sx * r[0], -r[1], -r[2]]
    const cR = [0, 1, 2].map((c) => F([R[0][c] * s, R[1][c] * s, R[2][c] * s])), ct = F(t); ct[0] += mirror ? W : 0
    const head = new THREE.Matrix4().set(cR[0][0], cR[1][0], cR[2][0], ct[0], cR[0][1], cR[1][1], cR[2][1], ct[1], cR[0][2], cR[1][2], cR[2][2], ct[2], 0, 0, 0, 1)
    // occluders
    for (let i = 0; i < 468; i++) { const p = M.P[i]; facePos[i * 3] = p.x; facePos[i * 3 + 1] = -p.y; facePos[i * 3 + 2] = -p.z }
    faceGeo.attributes.position.needsUpdate = true; faceGeo.computeBoundingSphere()
    headEll.matrix.copy(head).multiply(BASE.compose(new THREE.Vector3(0, 1, -2.6), new THREE.Quaternion(), new THREE.Vector3(6.9, 9, 9.2)))
    // forward direction of the head in the world (for hanging pieces: they turn with the head but hang with gravity)
    const fw = rotate(R, [0, 0, 1]), fwd = new THREE.Vector3(sx * fw[0], -fw[1], -fw[2]), yaw = Math.atan2(fwd.x, fwd.z)
    for (const name of ['lobeL', 'lobeR']) {
      const G = ears[name]; if (!G.children.length) continue
      const p = new THREE.Vector3(...ANCHORS[name].p).applyMatrix4(head)
      const sw = swing[name], dt = Math.min(0.05, Math.max(0.001, T - sw.t)), vx = sw.x === null ? 0 : (p.x - sw.x) / Math.max(0.001, T - sw.t)
      const target = Math.max(-0.45, Math.min(0.45, -vx / (M.fw3 * 6))) * 0.6
      sw.v += (-120 * (sw.a - target) - 9 * sw.v) * dt; sw.a += sw.v * dt; sw.x = p.x; sw.t = T
      const k = s * (0.9 + 0.6 * (size.ear ?? 0.5))
      G.matrixAutoUpdate = false
      if (G.userData.hang) G.matrix.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, sw.a, 'YXZ')), new THREE.Vector3(name === 'lobeL' ? -k : k, k, k)) // pair: one ear mirrored
      else G.matrix.copy(head).multiply(BASE.compose(new THREE.Vector3(...ANCHORS[name].p), new THREE.Quaternion(), new THREE.Vector3(k / s, k / s, k / s))) // a stud follows the head exactly
    }
    if (neckG.children.length && neckFrame) {
      const nz = -apply(fit, ANCHORS.neck.p)[2] // depth of the neck line
      neckG.position.set(neckFrame.o.x, -neckFrame.o.y, nz); neckG.rotation.set(0, 0, -neckFrame.rot)
      const k = s * (0.8 + 0.4 * (size.neck ?? 0.5)); neckG.scale.set(k, k, k)
    }
    renderer.render(scene, camera)
    return canvas
  }
  function dispose() { setPieces({}); env.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss?.() }
  return { setPieces, render, dispose, canvas }
}
