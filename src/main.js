import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
// fonts are served from this site (no Google Fonts request: faster first paint, no third-party call)
import '@fontsource/figtree/latin-400.css'
import '@fontsource/figtree/latin-500.css'
import '@fontsource/figtree/latin-600.css'
import '@fontsource/figtree/latin-700.css'
import '@fontsource/italiana/latin-400.css'
import '@fontsource/pinyon-script/latin-400.css'
import './style.css'

// Where demo requests go when Netlify Forms is not available (local computer, other hosts). CHANGE THIS to your real address.
const DEMO_EMAIL = 'hello@plinkmind.world'

const R = 0.5625 // mirror width / height (portrait videos)
const GAP = 14   // distance between chapters
const ACCENTS = [
  { n: 'Gold', c: '#E2BE7C' }, { n: 'Rose gold', c: '#E0A596' },
  { n: 'Platinum', c: '#D5DAE3' }, { n: 'Ruby', c: '#C21A4B' },
]
// Edit the story here. crop = how a landscape video is cropped into the portrait mirror.
const CH = [
  { k: 'Glamify XR smart mirror', h: 'The future of luxury, reflected.', p: 'Clients try on makeup, couture and fine jewelry in real time, right inside your boutique.', bg: 'hero-earring', color: '#1c1118', cta: 'Try the AI makeup mirror' },
  { k: '01 · Beauty and makeup', h: 'Flawless color, on her.', p: 'Sit in front of the mirror and AI reads her features, then applies a complete look live: foundation to lipstick, for a wedding, Diwali or the office.', video: 'beauty-tryon', prop: 'lipstick', color: '#3b1624', cta: 'AI makeup on your face' },
  { k: '02 · Fashion and apparel', h: 'An endless wardrobe.', p: 'Garments follow her shoulders, arms and turns in the live mirror, and a realistic AI photo shows how they look on her. A digital wardrobe, right in the fitting area.', video: 'fashion-gown', prop: 'cloth', color: '#14203a' },
  { k: '03 · Jewelry and luxury', h: 'Every facet, alive.', p: 'Earrings and necklaces in 3D, with sparkle that reacts to the light in the room and follows every turn of her head.', video: 'bridal-ring', prop: 'gem', color: '#2c2210' },
  { k: 'Technology', h: 'Live. Private. No app.', p: 'Face, hand, hair and body tracking run in real time on the device, so the camera picture never leaves it. Nothing to install: it opens in the browser.', prop: 'rings', color: '#0d2a2a' },
  { k: 'Your turn', h: 'Design your look.', p: 'Choose a metal and shade, then book a live demo for your boutique.', video: 'boutique-mirror', color: '#2a1420', finale: true },
]
const N = CH.length
const $ = (s) => document.querySelector(s)
// "mobile" = the single-column layout: a narrow screen held upright (matches the CSS breakpoint)
const mobile = () => innerWidth < 900 && innerWidth / innerHeight <= 1.25
const touch = matchMedia('(pointer:coarse)').matches
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)')
const lowPower = touch && (navigator.hardwareConcurrency || 4) <= 4 // older or budget phones: fewer particles
const glEl = $('#gl')
const heroBg = $('#heroBg')
heroBg.play().catch(() => {})

/* ---------- scene ---------- */
// phones get a lighter render (no antialiasing, lower pixel density) so scrolling stays smooth
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: !(touch && Math.min(innerWidth, innerHeight) < 600), powerPreference: 'high-performance' })
let pixelRatio = Math.min(devicePixelRatio, touch ? 1.5 : 2) // lowered automatically if the device cannot keep up (see tick)
renderer.setPixelRatio(pixelRatio)
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
  Object.assign(v, { src: `/videos/${ch.video}.mp4`, muted: true, loop: true, playsInline: true, preload: 'metadata' }) // full download starts after "Enter", so the hero video loads first
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
const DN = lowPower ? 220 : touch ? 350 : 700, dp = new Float32Array(DN * 3)
for (let i = 0; i < DN; i++) { dp[i * 3] = (Math.random() - 0.5) * 24; dp[i * 3 + 1] = (Math.random() - 0.5) * 12; dp[i * 3 + 2] = 10 - Math.random() * (GAP * N + 14) }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3))
const dustMat = new THREE.PointsMaterial({ color: ACCENTS[0].c, size: 0.035, transparent: true, opacity: 0.7 })
scene.add(new THREE.Points(dustGeo, dustMat))

/* ---------- html overlay ---------- */
const FINALE = `
  <div class="sw" id="sw">${ACCENTS.map((a, i) => `<button type="button" data-c="${a.c}" style="background:${a.c}" class="${i ? '' : 'on'}" aria-label="${a.n}" title="${a.n}"></button>`).join('')}</div>
  <div class="ctas"><button type="button" class="tryon-cta" data-tryon>Try it on live</button><button type="button" class="tryon-cta ai" data-aitryon>See it on you (AI photo)</button></div>
  <form id="demoForm" novalidate>
    <input type="email" name="email" placeholder="Your work email" autocomplete="email" required aria-label="Your work email">
    <input type="text" name="boutique" placeholder="Boutique or brand (optional)" autocomplete="organization" maxlength="120" aria-label="Boutique or brand">
    <input type="text" name="company-website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit">Request a demo</button>
    <p class="demo-msg" role="status" aria-live="polite"></p>
  </form>`
CH.forEach((c, i) => {
  const s = document.createElement('section')
  s.className = 'ch ' + (items[i].side === 1 ? 'l' : 'r') + (c.finale ? ' fin' : '')
  const cta = c.cta ? `<div class="ctas"><button type="button" class="tryon-cta ai-mk" data-automakeup>&#10022; ${c.cta}</button></div>` : ''
  s.innerHTML = `<div class="box"><p class="k">${c.k}</p><h${i ? 2 : 1}>${c.h}</h${i ? 2 : 1}><p class="t">${c.p}</p>${cta}${c.finale ? FINALE : ''}</div>`
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
// Demo requests: sent to Netlify Forms (Netlify > Forms, with e-mail alerts). Where that is not available (your own
// computer, another host) the visitor's e-mail app opens instead, pre-filled, so no request is lost.
$('#demoForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = e.currentTarget, msg = f.querySelector('.demo-msg'), btn = f.querySelector('button')
  const email = f.email.value.trim(), boutique = f.boutique.value.trim()
  const say = (t, err = false) => { msg.textContent = t; msg.classList.toggle('err', err) }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Please enter a valid e-mail address.', true); f.email.focus(); return }
  if (f['company-website'].value) return // filled in by a bot
  btn.disabled = true; say('Sending...')
  const mail = () => {
    location.href = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent('Glamify XR demo request')}&body=${encodeURIComponent(`Please contact me about a Glamify XR demo.\n\nE-mail: ${email}\nBoutique / brand: ${boutique || '-'}`)}`
    say('Your e-mail app should open with the request ready to send.'); btn.disabled = false
  }
  try {
    const r = await fetch('/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'form-name': 'demo', email, boutique }).toString() })
    // Netlify answers a form post with 200 and "server: Netlify"; anything else (404/405 on other servers) means no Netlify Forms here
    if (!r.ok || !/netlify/i.test(r.headers.get('server') || '')) return mail()
    f.classList.add('sent'); say(`Thank you! We will be in touch at ${email} soon.`)
  } catch { mail() }
})

/* ---------- scroll + animation ---------- */
// The scroll length is measured against the tallest phone viewport (#probe = 100lvh), so the browser's
// address bar sliding in and out never changes the scroll progress. It is cached, not re-measured on every scroll.
const probe = $('#probe')
let maxS = 1
const measure = () => { maxS = Math.max(1, document.documentElement.scrollHeight - probe.offsetHeight) }
const maxScroll = () => maxS
let target = 0, cur = 0, mx = 0, my = 0
addEventListener('scroll', () => { target = Math.min(1, Math.max(0, scrollY / maxS)) }, { passive: true })
if (!touch && !reduceMotion.matches) addEventListener('mousemove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5 }, { passive: true })
$('#toEnd').onclick = (e) => { e.preventDefault(); scrollTo({ top: maxScroll(), behavior: 'smooth' }); focusFormWhenShown() }
// put the cursor in the e-mail field once the finale has faded in (a hidden field cannot take focus)
function focusFormWhenShown(tries = 0) {
  const i = $('#demoForm input'), fin = $('.ch.fin')
  if (i && getComputedStyle(fin).visibility === 'visible' && +fin.style.opacity > 0.6) i.focus({ preventScroll: true })
  else if (tries < 80) setTimeout(() => focusFormWhenShown(tries + 1), 150)
}
$('#top').onclick = (e) => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }) }

let lastW = 0, lastH = 0
function resize(force) {
  const w = innerWidth, h = innerHeight
  // On phones, the address bar sliding away changes innerHeight by ~60-120px. Re-sizing the canvas for that causes flicker
  // and jumps, so small height-only changes are ignored.
  if (!force && touch && w === lastW && Math.abs(h - lastH) < 160) return
  lastW = w; lastH = h
  measure()
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(w, h)
  cam.aspect = w / h
  cam.fov = cam.aspect < 0.8 ? 55 : 42 // wider view on tall phone screens
  cam.updateProjectionMatrix()
  const m = mobile(), short = h < 520 && w / h > 1.25
  const scale = m ? (w >= 600 ? 0.9 : 0.8) : short ? 0.85 : 1 // phone 0.8, tablet 0.9, sideways phone 0.85, laptop/desktop 1
  items.forEach((it) => {
    it.stage.position.x = m ? 0 : it.side * 2.6
    // the finale has the most text (swatches, buttons, form), so on phones its mirror sits higher and a little smaller
    const fin = m && it.ch.finale
    it.stage.position.y = m ? (fin ? (h < 780 ? 2.45 : 2.05) : 1.3) : 0
    it.stage.scale.setScalar(fin ? scale * (h < 780 ? 0.66 : 0.78) : scale)
  })
}
let resizeTimer = 0
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120) }) // wait until resizing/rotating settles
addEventListener('orientationchange', () => setTimeout(() => resize(true), 300))
addEventListener('load', measure)
resize(true)
renderer.compile(scene, cam) // compile shaders now, not on the first scroll

const tmp = new THREE.Color()
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const hintEl = $('#hint')
const last = texts.map(() => ({ o: -1, y: 1e9, vis: '' })) // what we last wrote to each chapter, to skip needless DOM writes
let lastCo = -1, lastHint = -1, lastDot = -1

/* One animation loop only. It stops while the tab is hidden or the try-on studio is open, and restarts afterwards. */
let rafId = 0, frames = 0, slow = 0, prevMs = 0
const studioOpen = () => document.body.classList.contains('studio-open') || document.body.classList.contains('at-open')
const startLoop = () => { if (!rafId) { prevMs = 0; rafId = requestAnimationFrame(tick) } }
const stopLoop = () => { cancelAnimationFrame(rafId); rafId = 0 }
const pauseVideos = () => { items.forEach((it) => it.video && !it.video.paused && it.video.pause()); if (!heroBg.paused) heroBg.pause() }
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopLoop(); pauseVideos() } else if (!studioOpen()) startLoop() })

// If the device cannot hold ~40fps, lower the render sharpness a step (never below 1x) instead of stuttering.
function watchSpeed(dt) {
  if (dt > 120) return // a tab switch or a hiccup, not a real measurement
  frames++
  if (frames < 60) return // let the first second settle (shader compile, video start)
  slow = slow * 0.95 + dt * 0.05
  if (slow > 26 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25); slow = 16
    renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight)
  }
}

function tick(ms) {
  rafId = requestAnimationFrame(tick)
  const dt = prevMs ? ms - prevMs : 16; prevMs = ms
  watchSpeed(dt)
  const time = reduceMotion.matches ? 0 : ms / 1000 // reduced motion: no floating, spinning or waving, scrolling still works
  cur += (target - cur) * (reduceMotion.matches ? 0.25 : 0.06)
  const t = cur * (N - 1)
  const camZ = 7 - t * GAP
  cam.position.set(Math.sin(t * 1.3) * 0.5 + mx * 0.6, 0.2 - my * 0.4, camZ)
  cam.lookAt(cam.position.x * 0.3, -0.1, camZ - 10)
  // first page: full-screen video; the 3D world fades in over it as you scroll
  const co = clamp((t - 0.3) / 0.6, 0, 1)
  if (co !== lastCo) {
    glEl.style.opacity = co
    heroBg.style.visibility = co >= 1 ? 'hidden' : 'visible' // fully covered by the 3D scene: no need to composite it
    lastCo = co
  }
  if (co < 1) heroBg.style.transform = `scale(${1.04 + t * 0.1})`
  if (co >= 1) { if (!heroBg.paused) heroBg.pause() } else if (heroBg.paused && !document.hidden) heroBg.play().catch(() => {})
  bg.lerp(tmp.set(CH[clamp(Math.round(t), 0, N - 1)].color), 0.04)
  scene.fog.color.copy(bg)

  const ready = document.body.classList.contains('ready')
  items.forEach((it, i) => {
    const d = Math.abs(t - i)
    if (it.video) {
      if (d < 1.1 && ready) { if (it.video.paused) it.video.play().catch(() => {}) }
      else if (!it.video.paused) it.video.pause()
    }
    const near = d < 1.8 // chapters further away are lost in the fog: do not draw or animate them
    it.stage.parent.visible = near
    if (near) {
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
    }
    // text overlay: only touch the DOM when something actually changed
    const el = texts[i], o = clamp(1 - d * 2.4, 0, 1), L = last[i]
    const y = Math.round((i - t) * 60 * 10) / 10
    if (o > 0) {
      if (L.vis !== 'visible') { el.style.visibility = 'visible'; L.vis = 'visible' }
      if (Math.abs(o - L.o) > 0.004) { el.style.opacity = o; L.o = o }
      if (Math.abs(y - L.y) > 0.2) { el.style.transform = `translate3d(0,${y}px,0)`; L.y = y }
    } else if (L.vis !== 'hidden') { el.style.visibility = 'hidden'; el.style.opacity = 0; L.vis = 'hidden'; L.o = 0 }
    el.style.pointerEvents = o > 0.5 ? 'auto' : 'none'
  })
  const cd = Math.round(t)
  if (cd !== lastDot) { dots.forEach((dEl, i) => dEl.classList.toggle('on', i === cd)); lastDot = cd }
  const ho = Math.round(clamp(1 - target * 25, 0, 1) * 100) / 100
  if (ho !== lastHint) { hintEl.style.opacity = ho; lastHint = ho }
  renderer.render(scene, cam)
}
startLoop()

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
// First visit: the full 3.2 s intro. Coming back: a short one (the visitor has seen it, and the files are cached).
let seen = false
try { seen = localStorage.getItem('gm_intro_seen') === '1'; localStorage.setItem('gm_intro_seen', '1') } catch { /* private mode */ }
const INTRO_MS = seen || reduceMotion.matches ? 900 : 3200
const ring = $('#ring'), pct = $('#pct'), t0 = performance.now()
;(function load(now) {
  const p = Math.min(1, (now - t0) / INTRO_MS)
  ring.style.strokeDashoffset = 1 - p
  pct.textContent = Math.round(p * 100) + '%'
  if (p < 1) return requestAnimationFrame(load)
  pct.textContent = 'ready'
  $('#enter').hidden = false
  $('#enter').focus({ preventScroll: true }) // keyboard users can press Enter / Space straight away
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
  // unlock video playback on iPhone (needs a tap): briefly play each clip
  items.forEach((it) => it.video && it.video.play().then(() => { if (Math.abs(0 - it.i) > 1) it.video.pause() }).catch(() => {}))
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
// The studio code is not part of the first download: it is fetched in the background once the visitor is in
// (so it is usually ready before they tap), or on the first tap at the latest.
let studioP = null
const loadStudio = () => (studioP ||= import('./tryon/studio.js').then((m) => m.initStudio({
  // the 3D scene sleeps while the studio covers it, so the camera and face tracking get all of the phone's power
  onOpen: () => { stopLoop(); pauseVideos() },
  onClose: () => { if (!document.hidden) startLoop() },
})).catch((e) => { studioP = null; throw e }))
const openStudio = (e) => {
  const b = e.currentTarget; b.setAttribute('aria-busy', 'true')
  loadStudio().then((s) => s.open(b.hasAttribute('data-automakeup') ? { mode: 'auto' } : {})).catch(() => alert('The try-on studio could not load. Please check your connection and try again.')).finally(() => b.removeAttribute('aria-busy'))
}
document.querySelectorAll('[data-tryon],[data-automakeup]').forEach((b) => b.addEventListener('click', openStudio))
const idle = (fn, ms) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, ms))
addEventListener('load', () => idle(() => loadStudio().catch(() => {}), 4000))

/* ---------- "See It On You": AI photo outfit try-on (separate from the live camera studio, loaded only when opened) ---------- */
let aiP = null
const openAi = () => {
  aiP ||= import('./aitryon/aitryon.js').then((m) => m.initAiTryOn({ onOpen: () => { stopLoop(); pauseVideos() }, onClose: () => { if (!document.hidden) startLoop() } }))
  aiP.then((ai) => ai.open()).catch(() => { aiP = null; alert('This part of the site could not load. Please check your connection and try again.') })
}
document.querySelectorAll('[data-aitryon]').forEach((b) => b.addEventListener('click', openAi))

/* ---------- account (optional sign-in; the site works without it) ---------- */
import('./account/account.js').then((m) => m.initAccount()).catch(() => {})
