// MediaPipe Face Landmarker + smoothing + head pose (roll, turn, scale).
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export async function createTracker() {
  const files = await FilesetResolver.forVisionTasks(WASM)
  const make = (delegate) => FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
  })
  try { return await make('GPU') } catch { return await make('CPU') }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export class Face {
  constructor() { this.P = null }
  reset() { this.P = null }

  // lm: 478 normalized landmarks. Returns pixel points and pose measurements.
  update(lm, W, H, mirror) {
    const fresh = !this.P
    if (fresh) this.P = lm.map(() => ({ x: 0, y: 0 }))
    const P = this.P
    for (let i = 0; i < lm.length; i++) {
      const x = (mirror ? 1 - lm[i].x : lm[i].x) * W, y = lm[i].y * H
      if (fresh) { P[i].x = x; P[i].y = y } else { P[i].x += (x - P[i].x) * 0.65; P[i].y += (y - P[i].y) * 0.65 } // smoothing
    }
    const fw = dist(P[234], P[454]), fh = dist(P[10], P[152])
    const d = { x: P[10].x - P[152].x, y: P[10].y - P[152].y }, l = Math.hypot(d.x, d.y) || 1
    let a = P[33], b = P[263]; if (a.x > b.x) [a, b] = [b, a]
    return {
      P, W, H, fw, fh,
      up: { x: d.x / l, y: d.y / l },
      roll: Math.atan2(b.y - a.y, b.x - a.x),
      yaw: (P[1].x - (P[234].x + P[454].x) / 2) / fw, // about -0.3 (turned left) to 0.3 (turned right)
    }
  }
}
