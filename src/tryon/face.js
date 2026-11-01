// MediaPipe Face Landmarker + smoothing + head pose (roll, turn, scale).
// The MediaPipe library is large, so it is only downloaded when the studio actually needs it (dynamic import below).

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm'
import { PointSetFilter } from './filters.js'

const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export async function createTracker() {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const files = await FilesetResolver.forVisionTasks(WASM)
  const make = (delegate) => FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
  })
  try { return await make('GPU') } catch { return await make('CPU') }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export class Face {
  constructor() { this.P = null; this.filter = new PointSetFilter() }
  reset() { this.P = null; this.filter.reset() }

  // lm: 478 normalized landmarks from ONE new camera frame. tSec = when that frame was analysed (seconds).
  // Returns pixel points (smoothed with a One Euro filter on real timestamps) plus pose measurements.
  update(lm, W, H, mirror, tSec = performance.now() / 1000) {
    let inside = 0
    const raw = lm.map((q) => { if (q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1) inside++; return { x: (mirror ? 1 - q.x : q.x) * W, y: q.y * H } })
    const P = (this.P = this.filter.apply(raw, tSec, this.fw || W * 0.3))
    const fw = dist(P[234], P[454]), fh = dist(P[10], P[152])
    const d = { x: P[10].x - P[152].x, y: P[10].y - P[152].y }, l = Math.hypot(d.x, d.y) || 1
    let a = P[33], b = P[263]; if (a.x > b.x) [a, b] = [b, a]
    this.fw = fw
    return {
      P, W, H, fw, fh,
      up: { x: d.x / l, y: d.y / l },
      roll: Math.atan2(b.y - a.y, b.x - a.x),
      yaw: (P[1].x - (P[234].x + P[454].x) / 2) / fw, // about -0.3 (turned left) to 0.3 (turned right)
      inFrame: inside / lm.length, // 1 = whole face inside the camera picture; low = partly out of frame
    }
  }
}

// Extra models. Each one is downloaded only when a product that needs it is applied (never on the home page).
const MODELS = 'https://storage.googleapis.com/mediapipe-models/'
const POSE = MODELS + 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const HAND = MODELS + 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const SEG = MODELS + 'image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite' // 1 = hair
let visionP
const vision = () => visionP || (visionP = import('@mediapipe/tasks-vision').then(async (m) => ({ m, files: await m.FilesetResolver.forVisionTasks(WASM) })))
async function make(name, opts, modelAssetPath) {
  const { m, files } = await vision()
  const mk = (delegate) => m[name].createFromOptions(files, { ...opts, baseOptions: { modelAssetPath, delegate } })
  try { return await mk('GPU') } catch { return await mk('CPU') }
}
export const createPoseTracker = () => make('PoseLandmarker', { runningMode: 'VIDEO', numPoses: 1 }, POSE)
export const createHandTracker = () => make('HandLandmarker', { runningMode: 'VIDEO', numHands: 2 }, HAND)
export const createSegmenter = () => make('ImageSegmenter', { runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false }, SEG)
