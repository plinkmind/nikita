// Test rig scene (NOT part of the website): a photo-scanned human head rendered with three.js at KNOWN positions,
// rotations, distances and lighting. Because we know exactly where every vertex of the scan is, we also know exactly where
// the real ear lobes, nostrils and lips are in every rendered frame: ground truth for the tracker.
// Head scan: "Lee Perry-Smith" by Infinite-Realities, CC BY 3.0 (from the three.js examples).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export async function createRig(W = 960, H = 720, fovDeg = 52) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(W, H, false); renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#cfc8bd')
  // fovDeg is the VERTICAL field of view; 52 deg vertical at 4:3 is a typical laptop / phone front camera (~66 deg horizontal)
  const camera = new THREE.PerspectiveCamera(fovDeg, W / H, 0.1, 1000); camera.position.set(0, 0, 0); camera.lookAt(0, 0, -1)
  const amb = new THREE.HemisphereLight('#ffffff', '#6b5a4a', 1.2); scene.add(amb)
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(0.6, 0.8, 1); scene.add(key)
  const tex = await new THREE.TextureLoader().loadAsync(new URL('./head/Map-COL.jpg', import.meta.url).href)
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false
  const gltf = await new GLTFLoader().loadAsync(new URL('./head/LeePerrySmith.glb', import.meta.url).href)
  const mesh = gltf.scene.children[0]
  mesh.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0 })
  mesh.geometry.computeBoundingBox()
  const bb = mesh.geometry.boundingBox, size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3())
  // pivot = centre of the head so rotations look like a person turning the head
  const pivot = new THREE.Group(); scene.add(pivot)
  // rotation centre ~ the middle of the head (above the bust centre), like a neck joint would turn it
  const HEAD_C = new THREE.Vector3(0, 1.4, -0.2)
  mesh.position.set(-ctr.x - HEAD_C.x, -ctr.y - HEAD_C.y, -ctr.z - HEAD_C.z); pivot.add(mesh)
  // scale to real centimetres: chosen so the scan's face is the same size as MediaPipe's canonical face (face width 15.3 cm
  // between landmarks 234 and 454), measured with the tracker once (bust height then ~40 cm, head breadth ~15 cm)
  const k = 5.1; pivot.scale.setScalar(k)
  const pos = mesh.geometry.attributes.position
  const vtx = (i, out = new THREE.Vector3()) => out.fromBufferAttribute(pos, i)
  // world position of a mesh vertex (cm) and its projection to pixels
  const world = (i) => { mesh.updateWorldMatrix(true, false); return vtx(i).applyMatrix4(mesh.matrixWorld) }
  const project = (p) => { const v = p.clone().project(camera); return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, depth: -p.z } }
  // px per cm at a world point (for converting pixel errors to centimetres)
  const pxPerCm = (p) => (H / 2) / Math.tan((fovDeg * Math.PI) / 360) / Math.max(1, -p.z)
  // The HEAD turns on the neck while the shoulders stay put (like a person): every vertex is rotated about a neck pivot by a
  // weight that is 1 for the head, 0 for the shoulders and blends smoothly along the neck (simple linear-blend skinning).
  const ORIG = pos.array.slice(), NECK_PIVOT = new THREE.Vector3(0, 0.4, -0.3), WEIGHT = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) { const yr = ORIG[i * 3 + 1] - ctr.y, t = Math.min(1, Math.max(0, (yr + 0.95) / 0.5)) /* torso (incl. the collarbone notch at y=-1.04) never turns with the head */; WEIGHT[i] = t * t * (3 - 2 * t) }
  const I = new THREE.Quaternion(), Q = new THREE.Quaternion(), Qw = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3()
  let lastKey = ''
  function pose({ yaw = 0, pitch = 0, roll = 0, x = 0, y = 0, dist = 55, body = 0 } = {}) {
    // yaw > 0: the person turns to THEIR left (head turns toward image right in an un-mirrored camera); body = shoulder turn
    const key = [yaw, pitch, roll].join()
    if (key !== lastKey) {
      lastKey = key; Q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'))
      const a = pos.array
      for (let i = 0; i < pos.count; i++) {
        const w = WEIGHT[i]; v.set(ORIG[i * 3] - ctr.x, ORIG[i * 3 + 1] - ctr.y, ORIG[i * 3 + 2] - ctr.z).sub(NECK_PIVOT)
        if (w > 0) { Qw.copy(I).slerp(Q, w); v.applyQuaternion(Qw) }
        v.add(NECK_PIVOT); a[i * 3] = v.x + ctr.x; a[i * 3 + 1] = v.y + ctr.y; a[i * 3 + 2] = v.z + ctr.z
      }
      pos.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere()
    }
    pivot.rotation.set(0, body, 0); pivot.position.set(x, y, -dist); pivot.updateMatrixWorld(true)
  }
  function light({ intensity = 1, colour = '#ffffff', side = 0.6, ambient = 1 } = {}) {
    key.intensity = 2.2 * intensity; key.color.set(colour); key.position.set(side, 0.8, 1); amb.intensity = 1.2 * ambient
  }
  const render = () => { renderer.render(scene, camera); return canvas }
  // vertex search helpers (to define the ground-truth points once)
  function findVertex(score) { let best = -1, bs = -Infinity; const v = new THREE.Vector3(); for (let i = 0; i < pos.count; i++) { vtx(i, v); const s = score(v); if (s > bs) { bs = s; best = i } } return best }
  const local = (i) => new THREE.Vector3(ORIG[i * 3], ORIG[i * 3 + 1], ORIG[i * 3 + 2]).sub(ctr).multiplyScalar(k) // vertex in bust-centred cm (rest pose)
  return { THREE, renderer, scene, camera, mesh, pivot, canvas, W, H, pose, light, render, world, project, pxPerCm, findVertex, local, bb, size, ctr, k, count: pos.count, vtx, setBackground: (c) => { scene.background = new THREE.Color(c) } }
}
