import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import './style.css'
import { initStudio } from './tryon/studio.js'

const R = 0.5625 // mirror width / height (portrait videos)
const GAP = 14   // distance between chapters
const ACCENTS = [
  { n: 'Gold', c: '#E2BE7C' }, { n: 'Rose gold', c: '#E0A596' },
  { n: 'Platinum', c: '#D5DAE3' }, { n: 'Ruby', c: '#C21A4B' },
]
// Edit the story here. crop = how a landscape video is cropped into the portrait mirror.
const CH = [
  { k: 'Glamify XR smart mirror', h: 'The future of luxury, reflected.', p: 'Clients try on makeup, couture and fine jewelry in real time, right inside your boutique.', bg: 'hero-earring', color: '#1c1118' },
  { k: '01 · Beauty and makeup', h: 'Flawless color, on her.', p: 'Hyper-realistic virtual makeup try-ons. Our AR technology matches colors exactly, from foundation to lipstick to eyeshadow.', video: 'beauty-tryon', prop: 'lipstick', color: '#3b1624' },
  { k: '02 · Fashion and apparel', h: 'An endless wardrobe.', p: 'See high-end garments with physics-based fabric drape. Clients explore a digital wardrobe without leaving the fitting area.', video: 'fashion-gown', prop: 'cloth', color: '#14203a' },
  { k: '03 · Jewelry and luxury', h: 'Every facet, alive.', p: 'Fine jewelry and watches with stunning clarity. Precision ray-tracing captures the sparkle of every diamond.', video: 'bridal-ring', prop: 'gem', color: '#2c2210' },
  { k: 'Technology', h: '<5ms. No perceptible lag.', p: 'Ultra-low latency, physics-based fabric drape, precision ray-tracing and volumetric facial tracking, together in one mirror.', prop: 'rings', color: '#0d2a2a' },
  { k: 'Your turn', h: 'Design your look.', p: 'Choose a metal and shade, then book a live demo for your boutique.', video: 'boutique-mirror', color: '#2a1420', finale: true },
]
const N = CH.length
const $ = (s) => document.querySelector(s)
const mobile = () => innerWidth < 900
const glEl = $('#gl')
const heroBg = $('#heroBg')
heroBg.play().catch(() => {})

/* ---------- scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
const scene = new THREE.Scene()
const bg = new THREE.Color(CH[0].color)
scene.background = bg
scene.fog = new THREE.Fog(bg.clone(), 6, 24)
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 80)
const sun = new THREE.DirectionalLight('#ffe3b8', 2)
sun.position.set(3, 5, 6)
scene.add(sun)

const frameMat = new THREE.MeshStandardMaterial({ color: ACCENTS[0].c, metalness: 1, roughness: 0.22 })
const propMat = new THREE.MeshPhysicalMaterial({ color: ACCENTS[0].c, metalness: 0.2, roughness: 0.12, clearcoat: 1, iridescence: 1, envMapIntensity: 2, flatShading: true })
const clothMat = new THREE.MeshStandardMaterial({ color: ACCENTS[0].c, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide })
const darkMat = new THREE.MeshStandardMaterial({ color: '#12161f', metalness: 0.8, roughness: 0.25 })

const frameGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
  Array.from({ length: 128 }, (_, i) => { const a = (i / 128) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * R, Math.sin(a), 0) }), true), 200, 0.05, 20, true)
const glassGeo = new THREE.CircleGeometry(1, 96)

function makeMirror(ch) {
  const v = document.createElement('video')
  Object.assign(v, { src: `/videos/${ch.video}.mp4`, muted: true, loop: true, playsInline: true, preload: 'auto' })
  const tex = new THREE.VideoTexture(v)
  tex.colorSpace = THREE.SRGBColorSpace
  if (ch.crop) { tex.repeat.set(ch.crop[0], 1); tex.offset.set(ch.crop[1], 0) }
  const glass = new THREE.Mesh(glassGeo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
  glass.scale.x = R
  const g = new THREE.Group()
  g.add(glass, new THREE.Mesh(frameGeo, frameMat))
  g.scale.setScalar(1.15)
  return { g, v }
}

function makeProp(type) {
  const g = new THREE.Group()
  if (type === 'lipstick') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.55, 32), darkMat)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.1, 32), frameMat); band.position.y = 0.3
    const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 8, 24), propMat); tip.position.y = 0.62
    g.add(body, band, tip); g.rotation.z = 0.3
  } else if (type === 'cloth') {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2, 32, 48), clothMat)
    cloth.userData.base = cloth.geometry.attributes.position.array.slice()
    g.add(cloth); g.userData.cloth = cloth
  } else if (type === 'gem') {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), propMat); gem.scale.y = 1.4
    g.add(gem)
  } else if (type === 'rings') {
    ;[0.9, 1.3, 1.7, 2.1].forEach((r) => g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.02, 12, 128), frameMat)))
  } else return null
  return g
}

const items = CH.map((ch, i) => {
  const side = i % 2 === 0 ? 1 : -1 // which side of the screen the 3D object sits on
  const root = new THREE.Group(); root.position.z = -i * GAP; scene.add(root)
  const stage = new THREE.Group(); root.add(stage)
  const island = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.35, 64), darkMat); island.position.y = -1.9
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.03, 16, 96), frameMat); rim.rotation.x = Math.PI / 2; rim.position.y = -1.72
  if (!ch.bg) stage.add(island, rim) // first chapter has no 3D island: its video fills the screen
  let mirror = null, video = null
  if (ch.video) { const m = makeMirror(ch); mirror = m.g; video = m.v; stage.add(mirror) }
  const prop = makeProp(ch.prop)
  if (prop) { if (ch.prop !== 'rings') prop.position.set(-side * 1.7, -0.5, 0.9); stage.add(prop) }
  return { ch, i, side, stage, mirror, video, prop }
})

// gold dust along the whole path
const DN = 700, dp = new Float32Array(DN * 3)
for (let i = 0; i < DN; i++) { dp[i * 3] = (Math.random() - 0.5) * 24; dp[i * 3 + 1] = (Math.random() - 0.5) * 12; dp[i * 3 + 2] = 10 - Math.random() * (GAP * N + 14) }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3))
const dustMat = new THREE.PointsMaterial({ color: ACCENTS[0].c, size: 0.035, transparent: true, opacity: 0.7 })
scene.add(new THREE.Points(dustGeo, dustMat))

/* ---------- html overlay ---------- */
const FINALE = `
  <div class="sw" id="sw">${ACCENTS.map((a, i) => `<button type="button" data-c="${a.c}" style="background:${a.c}" class="${i ? '' : 'on'}" aria-label="${a.n}" title="${a.n}"></button>`).join('')}</div>
  <button type="button" class="tryon-cta" data-tryon>Try it on now</button>
  <form id="demoForm"><input type="email" placeholder="Your work email" required><button type="submit">Request a demo</button></form>`
CH.forEach((c, i) => {
  const s = document.createElement('section')
  s.className = 'ch ' + (items[i].side === 1 ? 'l' : 'r')
  s.innerHTML = `<div class="box"><p class="k">${c.k}</p><h${i ? 2 : 1}>${c.h}</h${i ? 2 : 1}><p class="t">${c.p}</p>${c.finale ? FINALE : ''}</div>`
  $('#chs').appendChild(s)
  const d = document.createElement('button'); d.setAttribute('aria-label', 'Go to chapter ' + (i + 1))
  d.onclick = () => scrollTo({ top: (i / (N - 1)) * maxScroll(), behavior: 'smooth' })
  $('#dots').appendChild(d)
})
const texts = [...document.querySelectorAll('.ch')]
const dots = [...document.querySelectorAll('#dots button')]

$('#sw').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return
  document.querySelectorAll('#sw button').forEach((x) => x.classList.toggle('on', x === b))
  ;[frameMat, propMat, clothMat, dustMat].forEach((m) => m.color.set(b.dataset.c))
})
$('#demoForm').addEventListener('submit', (e) => {
  e.preventDefault()
  const email = e.target.querySelector('input').value
  // CHANGE THIS to your real email
  location.href = `mailto:hello@plinkmind.world?subject=${encodeURIComponent('Glamify XR demo request')}&body=${encodeURIComponent('Please contact me: ' + email)}`
})

/* ---------- scroll + animation ---------- */
const maxScroll = () => document.documentElement.scrollHeight - innerHeight
let target = 0, cur = 0, mx = 0, my = 0
addEventListener('scroll', () => { target = scrollY / maxScroll() }, { passive: true })
addEventListener('mousemove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5 }, { passive: true })
$('#toEnd').onclick = (e) => { e.preventDefault(); scrollTo({ top: maxScroll(), behavior: 'smooth' }) }
$('#top').onclick = (e) => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }) }

function resize() {
  renderer.setSize(innerWidth, innerHeight)
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix()
  items.forEach((it) => {
    it.stage.position.x = mobile() ? 0 : it.side * 2.6
    it.stage.position.y = mobile() ? 1 : 0
    it.stage.scale.setScalar(mobile() ? 0.7 : 1)
  })
}
addEventListener('resize', resize); resize()

const tmp = new THREE.Color()
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
function tick(ms) {
  requestAnimationFrame(tick)
  if (document.body.classList.contains('studio-open')) return // pause the 3D scene while the try-on studio is open
  const time = ms / 1000
  cur += (target - cur) * 0.06
  const t = cur * (N - 1)
  const camZ = 7 - t * GAP
  cam.position.set(Math.sin(t * 1.3) * 0.5 + mx * 0.6, 0.2 - my * 0.4, camZ)
  cam.lookAt(cam.position.x * 0.3, -0.1, camZ - 10)
  // first page: full-screen video; the 3D world fades in over it as you scroll
  const co = clamp((t - 0.3) / 0.6, 0, 1)
  glEl.style.opacity = co
  heroBg.style.transform = `scale(${1.04 + t * 0.1})`
  if (co >= 1) { if (!heroBg.paused) heroBg.pause() } else if (heroBg.paused) heroBg.play().catch(() => {})
  bg.lerp(tmp.set(CH[clamp(Math.round(t), 0, N - 1)].color), 0.04)
  scene.fog.color.copy(bg)

  items.forEach((it, i) => {
    const d = Math.abs(t - i)
    if (it.video) {
      if (d < 1.1 && document.body.classList.contains('ready')) { if (it.video.paused) it.video.play().catch(() => {}) }
      else if (!it.video.paused) it.video.pause()
    }
    if (it.mirror) {
      it.mirror.position.y = Math.sin(time + i) * 0.08
      it.mirror.rotation.y = -it.side * 0.25 + Math.sin(time * 0.5 + i) * 0.12 + mx * 0.25
    }
    const p = it.prop
    if (p) {
      if (it.ch.prop === 'rings') p.children.forEach((r, k) => { r.rotation.x = time * (0.3 + k * 0.12); r.rotation.y = time * (0.2 + k * 0.1) })
      else { p.position.y = -0.5 + Math.sin(time * 1.2 + i) * 0.1; p.rotation.y = time * 0.6 }
      const cloth = p.userData.cloth
      if (cloth) {
        const pos = cloth.geometry.attributes.position, b = cloth.userData.base
        for (let k = 0; k < pos.count; k++) { const x = b[k * 3], y = b[k * 3 + 1]; pos.array[k * 3 + 2] = Math.sin(x * 3.2 + y * 1.5 + time * 1.6) * 0.2 * (0.6 - y * 0.5) }
        pos.needsUpdate = true; cloth.geometry.computeVertexNormals(); p.rotation.y = 0.4
      }
    }
    const el = texts[i], o = clamp(1 - d * 2.4, 0, 1)
    el.style.opacity = o
    el.style.transform = `translateY(${(i - t) * 60}px)`
    el.style.pointerEvents = o > 0.5 ? 'auto' : 'none'
    dots[i].classList.toggle('on', Math.round(t) === i)
  })
  $('#hint').style.opacity = clamp(1 - target * 25, 0, 1)
  renderer.render(scene, cam)
}
requestAnimationFrame(tick)

/* ---------- loader + mirror break ---------- */
document.body.classList.add('locked')
const loader = $('#loader')
const rand = (a, b) => a + Math.random() * (b - a)

// the loader surface is a mirror built from glass shards (triangles)
const shards = []
;(() => {
  const C = 9, Rw = 6, pts = []
  for (let r = 0; r <= Rw; r++) {
    pts[r] = []
    for (let c = 0; c <= C; c++) {
      pts[r][c] = [(c / C) * 100 + (c === 0 || c === C ? 0 : rand(-4, 4)), (r / Rw) * 100 + (r === 0 || r === Rw ? 0 : rand(-5, 5))]
    }
  }
  for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) {
    const a = pts[r][c], b = pts[r][c + 1], d = pts[r + 1][c], e = pts[r + 1][c + 1]
    const tris = Math.random() > 0.5 ? [[a, b, e], [a, e, d]] : [[a, b, d], [b, e, d]]
    tris.forEach((t3) => {
      const el = document.createElement('div')
      el.className = 'shard'
      const cx = (t3[0][0] + t3[1][0] + t3[2][0]) / 3, cy = (t3[0][1] + t3[1][1] + t3[2][1]) / 3
      el.style.clipPath = `polygon(${t3.map((p) => p[0] + '% ' + p[1] + '%').join(',')})`
      el.style.transformOrigin = `${cx}% ${cy}%`
      el.style.background = 'radial-gradient(ellipse at 50% 38%,#1c2334,#0b0e15 78%)' // same on every shard, so the mirror looks seamless
      $('#shards').appendChild(el)
      shards.push({ el, cx, cy })
    })
  }
})()

// loading: a gold line draws around the logo
const ring = $('#ring'), pct = $('#pct'), t0 = performance.now()
;(function load(now) {
  const p = Math.min(1, (now - t0) / 3200)
  ring.style.strokeDashoffset = 1 - p
  pct.textContent = Math.round(p * 100) + '%'
  if (p < 1) return requestAnimationFrame(load)
  pct.textContent = 'ready'
  $('#enter').hidden = false
})(t0)

$('#enter').onclick = (e) => {
  e.currentTarget.disabled = true
  $('#lcontent').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' })
  loader.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,4px)' }, { transform: 'translate(5px,-5px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'none' }], { duration: 320 })
  setTimeout(shatter, 380)
}

function shatter() {
  document.body.classList.remove('locked')
  document.body.classList.add('ready')
  scrollTo(0, 0)
  loader.style.background = 'transparent'
  shards.forEach(({ el, cx, cy }) => {
    const dx = cx - 50, dy = cy - 50, dist = Math.hypot(dx, dy) / 70
    const x = (dx / 50) * innerWidth * rand(0.4, 0.9)
    const y = (dy / 50) * innerHeight * rand(0.2, 0.6) + innerHeight * rand(0.5, 1.1)
    el.animate([
      { transform: 'translate3d(0,0,0) rotateX(0) rotateY(0) rotateZ(0)', opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.6 },
      { transform: `translate3d(${x}px,${y}px,${rand(-300, 200)}px) rotateX(${rand(-180, 180)}deg) rotateY(${rand(-180, 180)}deg) rotateZ(${rand(-120, 120)}deg)`, opacity: 0, offset: 1 },
    ], { duration: rand(1000, 1500), delay: dist * 380, easing: 'cubic-bezier(.55,.05,.9,.45)', fill: 'forwards' })
  })
  setTimeout(() => loader.remove(), 2600)
}

/* ---------- virtual try-on studio ---------- */
const studio = initStudio()
document.querySelectorAll('[data-tryon]').forEach((b) => b.addEventListener('click', () => studio.open()))
