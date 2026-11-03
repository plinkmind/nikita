// Loading of the MediaPipe Tasks runtime and models.
//  - The WASM runtime is SELF-HOSTED (copied from node_modules into /mediapipe/wasm by scripts/copy-wasm.mjs),
//    so its version always matches the JavaScript package and the site does not depend on a third-party CDN.
//  - Models load from VITE_MODEL_BASE when set (e.g. "/models/" after `npm run fetch-models`), with Google's
//    official model storage as the fallback. Nothing is downloaded until a product that needs it is applied.

const GOOGLE = 'https://storage.googleapis.com/mediapipe-models/'
const BASE = (import.meta.env.VITE_MODEL_BASE || '').trim()
const WASM = (import.meta.env.BASE_URL || '/') + 'mediapipe/wasm'
// VITE_DELEGATE=CPU forces the CPU (used by the automated tests, which have no real GPU)
const DELEGATES = import.meta.env.VITE_DELEGATE ? [import.meta.env.VITE_DELEGATE] : ['GPU', 'CPU']
const phone = () => matchMedia('(pointer:coarse)').matches || Math.min(screen.width, screen.height) < 700

export const MODEL_PATHS = {
  face: 'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  poseLite: 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  poseFull: 'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  hand: 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  // both segmenters label hair as category 1. Multiclass also labels face skin (3), body skin (2) and clothes (4).
  // Default (Update 13): the dedicated Hair Segmenter - 512x512 input (twice the detail of the multiclass model's 256x256), 0.8 MB
  // instead of about 16 MB to download. Face, ears and neck are separated from hair with the face tracker instead.
  // VITE_HAIR_MODEL=multi switches back to the multiclass model (its body-skin class also finds a hand over the face on phones).
  segMulti: 'image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  segHair: 'image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite',
}
const urls = (p) => [...new Set([BASE && BASE + p, GOOGLE + p].filter(Boolean))]

let visionP
export const vision = () => visionP || (visionP = import('@mediapipe/tasks-vision').then(async (m) => ({ m, files: await m.FilesetResolver.forVisionTasks(WASM) })).catch((e) => { visionP = null; throw e }))

async function make(name, opts, path) {
  const { m, files } = await vision()
  let last
  for (const modelAssetPath of urls(path)) {
    for (const delegate of DELEGATES) { // GPU is much faster; some phones/browsers only work on CPU
      try { const t = await m[name].createFromOptions(files, { ...opts, baseOptions: { modelAssetPath, delegate } }); t.__delegate = delegate; return t }
      catch (e) { last = e }
    }
  }
  throw last || new Error('model failed to load')
}

export const createFaceTracker = () => make('FaceLandmarker', {
  runningMode: 'VIDEO', numFaces: 1,
  minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.5,
}, MODEL_PATHS.face)

// phones use the lite body model (fast); computers use the full model (more accurate shoulders, elbows and hips)
export const createPoseTracker = () => make('PoseLandmarker', {
  runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.5,
}, phone() ? MODEL_PATHS.poseLite : MODEL_PATHS.poseFull)

export const createHandTracker = () => make('HandLandmarker', {
  runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
}, MODEL_PATHS.hand)

export const createSegmenter = () => make('ImageSegmenter', {
  runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false,
}, import.meta.env.VITE_HAIR_MODEL === 'multi' ? MODEL_PATHS.segMulti : MODEL_PATHS.segHair)
