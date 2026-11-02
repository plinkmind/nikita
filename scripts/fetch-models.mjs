// OPTIONAL: downloads the MediaPipe models into public/models so your site serves them itself (faster, works where
// storage.googleapis.com is blocked). Then set VITE_MODEL_BASE=/models/ in .env. Models are Apache-2.0 licensed by Google.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATHS = [
  'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  'image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite',
]
for (const p of PATHS) {
  const out = join(root, 'public', 'models', p)
  if (existsSync(out)) { console.log('have   ', p); continue }
  const r = await fetch('https://storage.googleapis.com/mediapipe-models/' + p)
  if (!r.ok) { console.error('FAILED ', p, r.status); continue }
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log('saved  ', p)
}
