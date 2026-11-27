// OPTIONAL: downloads the MediaPipe models into public/models so your site serves them itself (faster, works where
// storage.googleapis.com is blocked). Then set VITE_MODEL_BASE=/models/ in .env. Models are Apache-2.0 licensed by Google.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// The models the site uses. The large multiclass segmenter (16 MB) is only fetched when VITE_HAIR_MODEL=multi.
const PATHS = [
  'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite',
  ...(process.env.VITE_HAIR_MODEL === 'multi' ? ['image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'] : []),
]
// Runs before every build (package.json "prebuild"). It never fails the build: without internet the site simply keeps
// loading the models from Google's storage, as before.
let ok = 0
for (const p of PATHS) {
  const out = join(root, 'public', 'models', p)
  if (existsSync(out)) { console.log('have   ', p); ok++; continue }
  try {
    const r = await fetch('https://storage.googleapis.com/mediapipe-models/' + p, { signal: AbortSignal.timeout(120000) })
    if (!r.ok) { console.warn('FAILED ', p, r.status); continue }
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 100000) { console.warn('FAILED ', p, 'file too small'); continue }
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, buf); console.log('saved  ', p); ok++
  } catch (e) { console.warn('FAILED ', p, e.message) }
}
console.log(`MediaPipe models: ${ok} of ${PATHS.length} in public/models` + (ok < PATHS.length ? ' (the missing ones load from Google storage)' : ''))
