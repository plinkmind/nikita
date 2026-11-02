// Copies the MediaPipe WASM runtime from node_modules into public/mediapipe/wasm, so the site serves it itself
// (same version as the JavaScript package, no dependency on a third-party CDN). Runs automatically before dev and build.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), dst = join(root, 'public', 'mediapipe', 'wasm')
if (!existsSync(src)) { console.error('MediaPipe is not installed. Run "npm install" first.'); process.exit(1) }
mkdirSync(dst, { recursive: true }); cpSync(src, dst, { recursive: true })
console.log('MediaPipe WASM runtime copied to public/mediapipe/wasm')
