// MediaPipe Face Landmarker + smoothing + head pose (roll, turn, scale).
// The MediaPipe library is large, so it is only downloaded when the studio actually needs it (dynamic import below).

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm'
import { PointSetFilter } from './filters.js'
import { headFrame } from './headpose.js'

const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export async function createTracker() {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const files = await FilesetResolver.forVisionTasks(WASM)
  const make = (delegate) => FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.3, minTrackingConfidence: 0.3, // lower = the model gives up on a moving face less often (fewer blinks)
  })
  try { return await make('GPU') } catch { return await make('CPU') }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// Different features need different smoothing: anchors for jewellery use the base profile; makeup edges (lips, eyes) use a calmer one.
const PROFILES = { base: { minCutoff: 1, beta: 250, dCutoff: 1, floor: 0.15 }, calm: { minCutoff: 0.6, beta: 300, dCutoff: 1, floor: 0.2 } }

export class Face {
  constructor() { this.P = null; this.filter = new PointSetFilter(PROFILES.base); this.calm = new PointSetFilter(PROFILES.calm); this.rejects = 0; this.streak = 0 }
  reset() { this.P = null; this.filter.reset(); this.calm.reset(); this.streak = 0 }

  // lm: 478 landmarks (x, y, depth z) from ONE new camera frame. tSec = when it was analysed. Returns null if the reading is an obvious glitch.
  update(lm, W, H, mirror, tSec = performance.now() / 1000) {
    let inside = 0
    const raw = lm.map((q) => { if (q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1) inside++; return { x: (mirror ? 1 - q.x : q.x) * W, y: q.y * H, z: (q.z || 0) * W } }) // depth uses the same scale as x
    const finite = raw[1] && Number.isFinite(raw[1].x + raw[1].y + raw[10].x + raw[152].y + raw[234].x + raw[454].x)
    if (!finite) { this.rejects++; return null }
    if (this.P && this.fw) { // glitch guard: a head cannot jump more than ~0.8 face widths or change size by 40% between two camera pictures
      const prev = { x: (this.P[234].x + this.P[454].x) / 2, y: (this.P[234].y + this.P[454].y) / 2 }, cur = { x: (raw[234].x + raw[454].x) / 2, y: (raw[234].y + raw[454].y) / 2 }
      const jump = Math.hypot(cur.x - prev.x, cur.y - prev.y) / this.fw, ratio = dist(raw[234], raw[454]) / this.fw
      if ((jump > 0.8 || ratio > 1.6 || ratio < 0.55) && this.streak < 3) { this.streak++; this.rejects++; return null } // after 3 in a row it is real movement
    }
    this.streak = 0
    const P = (this.P = this.filter.apply(raw, tSec, this.fw || W * 0.3)), Pm = this.calm.apply(raw, tSec, this.fw || W * 0.3)
    const fw = dist(P[234], P[454]), fh = dist(P[10], P[152])
    const d = { x: P[10].x - P[152].x, y: P[10].y - P[152].y }, l = Math.hypot(d.x, d.y) || 1
    let a = P[33], b = P[263]; if (a.x > b.x) [a, b] = [b, a]
    this.fw = fw
    const frame = headFrame(P)
    return {
      P, Pm, W, H, fw, fh, frame, fw3: frame.a * 2, // fw3 = true head width (does not shrink when the head turns)
      up: { x: d.x / l, y: d.y / l },
      roll: Math.atan2(b.y - a.y, b.x - a.x),
      yaw: frame.turn, // real turn from the 3D head frame: about -1..1 (0 = straight, 0.5 = about 30 degrees)
      nod: frame.nod,  // up/down
      inFrame: inside / lm.length,
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
