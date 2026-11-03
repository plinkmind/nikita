# Tracking audit

## Update 10 (latest): full re-audit, 3D face mask, category pipelines
Everything below was checked in the current source code and measured with the real MediaPipe models (headless Chromium,
software rendering) on the 3D head-scan rig (`tests/rig/`: a scanned human head rendered at known turns, nods, tilts,
distances and lighting, so the true position of every point is known).

### Phase 1: how the live studio works today
| Question | Answer (from the code) |
|---|---|
| Face model | MediaPipe **Face Landmarker** (float16, 478 points, VIDEO mode, 1 face, GPU with CPU fallback). Confidence 0.5 / 0.6 / 0.5. `track/mediapipe.js` |
| Hand model | MediaPipe **Hand Landmarker** (2 hands, 21 picture points + 21 3D "world" points in metres per hand). Only loaded for nails (and, on computers, for hand-in-front-of-face occlusion). |
| Body model | MediaPipe **Pose Landmarker**: lite on phones, full on computers. Only loaded for outfits and necklaces. |
| Hair | MediaPipe image segmenter (hair = class 1). Only loaded for hair colour. |
| Camera frames | `getUserMedia` front camera (960x720 phones, 1280x720 computers). Each NEW camera frame (requestVideoFrameCallback) is analysed once by every model it needs, and that same frame is drawn with those results. |
| 2D -> 3D | MediaPipe's canonical 3D face (468 vertices, cm) is fitted to 36 rigid landmarks every frame (rotation + scale + position, Horn's method) -> real head turn, nod, roll and true size. Expression (lips, lids, brows) is the landmark offset in the head's own frame. Ear lobes, nose piercings and the neck are fixed 3D points on the fitted head. `track/head.js` |
| Three.js | Used only for the homepage animation. The studio draws on a canvas the size of the camera frame; there is no separate 3D camera that can drift out of line with the picture. New in this update: a WebGL face mesh that uses exactly the same pixel coordinates. |
| Confidence | Detector thresholds, plus a shape check (landmark sets that do not fit a face are rejected), plus presence fade (in 90 ms, hold 160 ms, out 240 ms), plus hands needing 2 frames in a row before they hide anything. |
| Mirroring, aspect ratio, canvas size, pixel ratio | Checked again: models analyse the un-mirrored camera frame; mirroring is applied once to the 2D output; the canvas equals the camera resolution; the preview box takes the camera aspect ratio; CSS scales it for any screen pixel ratio. Overlays and picture always share one coordinate system. |

### Phase 2: head tracking - measured, kept
The rig was replayed with webcam-like jitter added to the landmarks (0.9 px per point plus a shared shift, same as
`tests/harness.js`). `node tests/rig/tune.mjs`:

| | Still jitter | Error while moving (surface points) | Ear-lobe error | Head-turn error |
|---|---|---|---|---|
| No filter (raw detector) | 2.00 px | 0.21 cm | 0.50 cm | 2.6 deg |
| Current filter | **0.47 px** | 0.25 cm | 0.50 cm | 2.6 deg |

I tried 54 other filter settings, including lag compensation (prediction from the measured speed). None was better on
both stillness and lag at the same time, only different trade-offs. So the head filter was kept as it is. The
remaining error while moving is mostly the face model itself (0.21 cm before any filtering), not the smoothing.

### Phase 3: root cause still present, and fixed - skin products were flat stickers
Foundation, concealer, blush and highlighter were 2D shapes (ovals and polygons) placed between landmarks. Measured on the
rig: up to **2,362 pixels of blush/foundation painted on the background** outside the head (nodding down 23 deg), 615 px
at a 20 deg turn, 645 px close to the camera. A 2D oval also does not bend around the cheek or narrow when the head turns.

**Fix: a real 3D face mask** (`src/tryon/render/facemesh.js`). The 468 tracked points are drawn as MediaPipe's own
898-triangle face mesh in WebGL, with depth (z) from the 3D head fit, a depth buffer, and a surface direction per vertex.
Each skin product is painted once in the face's texture space (`track/facemesh.js`, UV coordinates from MediaPipe's
canonical face model) using the same anatomical landmarks as before, and the mesh wraps it onto the live face every frame.
Paint now stretches and foreshortens with the cheek, follows expressions (it is attached to the moving vertices), is hidden
where the nose covers the far cheek, and fades on surfaces seen edge-on.

| Pose (rig) | Paint outside the head, 2D | Paint outside the head, 3D mask |
|---|---|---|
| Front | 0 px | 0 px |
| Turn 20 deg | 615 px | 0 px |
| Turn 34 deg | 19 px | 4 px |
| Turn -46 deg | 0 px | 43 px (mesh edge, anti-aliasing) |
| Nod down 23 deg | **2,362 px** | 0 px |
| Look up 20 deg | 146 px | 0 px |
| Tilt 20 deg | 2 px | 0 px |
| Close (38 cm) | 645 px | 0 px |
| Far (90 cm) | 0 px | 0 px |

The 2D renderer stays as automatic fallback (no WebGL, or the WebGL context is lost). `?mesh=0` forces it, for comparison.
Lips, eyeliner, eyeshadow, mascara and brows were already traced directly along their landmark contours and were not changed.

### Phase 4/7: anchors and category pipelines (checked, `tests/e2e/categories.e2e.mjs`)
| Category | Models that run | Anchors |
|---|---|---|
| Makeup | face (+ hand on computers, only to keep a hand in front of the face uncovered) | lip / eye / brow contours, 3D face mask for skin |
| Jewellery | face + body (necklaces) | separate left/right ear lobes (3D head points, own visibility each), nostril, neck from the shoulders |
| Hair | face + hair segmentation | your real hair pixels |
| Nails | hand | each nail from the finger's 3D bones |
| Outfit | body | shoulders, torso, hips |

Fixed in this update: the hand model that only serves occlusion showed "Loading hand tracking..." on the makeup tab - it
now loads silently. A model that fails to download is no longer retried (with its "Loading..." note) every 8 seconds
forever: after 3 failures it waits until the studio is opened again. Hand instructions appear only on the Nails tab.

### What still needs outside models or assets (not fixable with overlays)
- **Nails**: MediaPipe has no nail-segmentation model, so the nail outline is estimated from the finger bones (shaped nail
  outlines, not rectangles, but not the real nail edge).
- **Hairstyles**: a live overlay cannot look like real hair; live mode recolours your real hair, cuts are made by the AI photo mode.
- **Outfits**: live mode places your garment photo on the shoulders and torso; it is not 3D cloth. Realistic results need the AI try-on (See It On You).
- **Lighting colour**: makeup blends with the real skin (multiply/soft-light/screen), but jewellery colours do not adapt to a warm or dim room.
- **Not tested here**: a real phone GPU, a real camera, a real person. Speed numbers from this sandbox (software rendering, no GPU) do not say how fast it runs on Android Chrome.

---

## Update 6: root causes confirmed with the real models
This section supersedes the tables further down where they disagree. Everything here was measured with the real MediaPipe
models on real photos (see `TESTING-REPORT.md`).

| Area | Finding | Change | File |
|---|---|---|---|
| Temporal smoothing | Positions were divided by a jittering face width before filtering: the whole face shook. Measured 4x MORE jitter than no filter. | Filters normalise speed only. Separate rigid-head and expression filters, tuned by grid search. | `track/filters.js`, `track/head.js` |
| Frame synchronisation | Landmarks from one camera frame drawn over a newer frame; extra models (hands, hair) ran on alternate frames. | Each camera frame analysed once and shown with its own results. Face and hands every frame. | `studio.js` |
| Head pose | 3D frame built from landmark depth mixed with mirrored x (flips handedness); turn threshold 7 deg. | Canonical 3D face model fitted per frame (Horn similarity, rigid points only). Mirror applied only to 2D output. | `track/head.js`, `track/geometry.js`, `track/canonical.js` |
| Landmark selection | Earrings derived from cheek-contour points. | Ear lobes / nose / neck are fixed 3D points on the fitted head; never a nearby landmark. | `track/head.js` ANCHORS |
| Confidence | Face thresholds lowered to 0.3/0.3/0.4 = unreliable landmarks used. | 0.5/0.6/0.5 + reject frames whose landmarks do not fit a face shape. | `track/mediapipe.js`, `track/head.js` |
| Tracking loss | Hard hide when 20% of face outside the frame; 300 ms hold then pop. | Presence fade (in 90 ms, hold 160 ms, out 240 ms); restart fresh after 0.5 s loss. | `track/filters.js` Presence |
| Hands | 2D-only back-of-hand guess; hand detection on the mirrored canvas copy. | Detection on the camera frame; 3D world landmarks; per-finger nail normal carried along the joints; edge-on fade. | `nails.js` |
| Models conflicting | "One extra model per frame" rule made nails/hair lag the video. | Per-model schedule on the same frame (face, hands: every frame; hair: every frame desktop / 2nd phone; necklace-only pose: every 3rd). | `studio.js` |
| Runtime loading | WASM from cdn.jsdelivr.net (third party). | WASM self-hosted from node_modules (`scripts/copy-wasm.mjs`); models optionally self-hosted (`npm run fetch-models`, `VITE_MODEL_BASE`). | `track/mediapipe.js` |
| Camera-to-canvas mapping, aspect ratio | Checked again: correct (canvas = video size, preview box takes the camera aspect ratio). | No change. | |

---

## Earlier audit (Update 4/5)

Written from the actual source code of this project. "Fixed" means changed and tested here (on simulated data, see TESTING-REPORT.md);
"Not fixed" means I found it and did not solve it.

## 1. How the existing tracking works

| Part | File | What it does |
|---|---|---|
| Camera | `src/tryon/camera.js` | `getUserMedia`, front camera, 960x720 ideal on phones, 1280x720 on desktop. `mirror = true` unless the rear camera is used. |
| Frame copy | `studio.js` `loop()` | Each screen redraw: video frame is drawn (mirrored) into a canvas `raw`, same size as the video. All overlays are drawn on a second canvas `fin`, then shown. |
| Face | `face.js` | MediaPipe **Face Landmarker**, 478 landmarks, `VIDEO` mode, 1 face, confidence 0.5. Outputs normalised x,y (0-1). `Face.update()` converts to pixels with `(mirror ? 1-x : x) * width`. Head **roll** = angle of the line between the eyes. **Turn (yaw)** = nose offset from the cheek midpoint / face width. |
| Hands | `studio.js`, `nails.js` | MediaPipe **Hand Landmarker** (only loaded when nails are applied). |
| Body | `studio.js`, `outfit.js` | MediaPipe **Pose Landmarker lite** (only loaded for outfits and necklaces). |
| Hair mask | `studio.js`, `hair.js` | MediaPipe **selfie multiclass segmenter** (only loaded for hair colour). |
| Drawing | `makeup.js`, `jewellery.js`, `hair.js`, `outfit.js`, `nails.js` | Canvas 2D drawing positioned from landmarks. |

## 2. Checked and found correct

- **Camera-to-canvas mapping.** Canvas size equals `videoWidth x videoHeight`, landmarks are scaled by the same width and height, and the preview box takes the video's aspect ratio (`--ar`). No stretching or letterbox mismatch.
- **Mirroring.** The picture and the landmarks are both mirrored with the same rule, so left/right agree. The hand model's left/right label (which assumes a mirrored image) is handled.
- **Makeup landmark choice.** Uses the proper contours (face oval, outer and inner lips, eye loops, brows) with holes for eyes, lips and brows, and proper blend modes. This is the best-built part of the project.

## 3. Problems found, root causes, status

| # | Problem | Root cause | Status |
|---|---|---|---|
| 1 | Jitter, then lag | Smoothing was a fixed blend per **screen redraw** (`alpha = 0.28 + speed*9`), so it changed with frame rate (60 fps device behaved differently from a 30 fps one) and was applied again and again to the same camera picture. | **Fixed.** One Euro filter (`filters.js`) on real timestamps, applied once per new camera picture. Simulated test at 30 fps: still jitter -33%, slow-motion error -26%, fast-motion error -37%. Not tuned on real footage. |
| 2 | Wasted work | On desktop the face model ran on every screen redraw (about 60 per second) although the camera only supplies about 30 new pictures, so every second analysis was a duplicate. | **Fixed.** Detection only when `video.currentTime` changed. Measured in the test: ~61 redraws per second vs ~20 model runs. |
| 3 | Items floating after tracking is lost | Tracking loss reset everything at once (earlier version) or held the last position, then vanished abruptly. | **Fixed.** Last position held up to 0.3 s while fading out, then removed. |
| 4 | Wrong placement when the face is cut by the frame edge | No confidence check: landmarks outside the picture were used as if reliable. | **Fixed.** If less than 80% of landmarks are inside the picture, face items are hidden and a message asks the user to move back. Hands below 0.6 handedness score are ignored. Body points need visibility above 0.5. |
| 5 | Jewellery anchors | Earrings were anchored on the cheek, necklaces on the chin. | **Fixed** earlier (ear lobe from head axes; necklace from shoulders). |
| 6 | **Head pose is a 2D guess** (partly addressed in Update 5: turn and nod now come from a 3D head frame built from landmark depth; the model's own pose matrix is still not used) | Turn is estimated from the nose position only; there is no nodding (pitch) and no depth. Face Landmarker can output a real 3D head-pose matrix, but it is switched off. | **Not fixed.** This limits how well hair, earrings and glasses-type items follow a head that turns or nods strongly. Plan: enable `outputFacialTransformationMatrixes`, derive yaw/pitch/roll, and verify the axis conventions against the `?debug` overlay on a real device. I did not ship it unverified because wrong axes would make things worse. |
| 7 | Live hair looks fake | A flat vector shape cannot hide your real hair, has no depth, no hair texture and no light matching. | **Cannot be fixed with overlays.** Added **AI photo mode** (real generated image). Live hair colour (real hair recoloured with a segmentation mask) is the realistic live option. |
| 8 | Live outfits look fake | Procedural flat garment shapes: no cloth shape change, no garment print or texture, arms and hands are not drawn in front of the clothes. | **Cannot be fixed with overlays.** Added **AI photo mode** with a real try-on model. Live mode stays a basic fit. |
| 9 | Nails look artificial | Nail region is estimated from the last finger bone only: no perspective, no nail plate segmentation, and the "back of hand" test is untested on real hands. | **Not fixed** beyond sizing by finger proportions. Real fix would need a nail-segmentation model. |
| 10 | Makeup paints over hands and hair that cover the face | No occlusion mask. | **Not fixed.** Plan: use the face-skin class of the segmentation model as a mask. |
| 11 | Overlays do not match the room lighting | Colours are fixed, no brightness or colour adaptation. | **Not fixed.** |
| 12 | Cost of blur effects | Makeup uses many large `shadowBlur` draws per frame. | **Not fixed.** Measure on a real mid-range Android phone first. |

## 4. Files changed for this audit
`filters.js` (new), `face.js`, `studio.js` (loop, tracking, debug), `photo.js` (new), `server/` (new), `looks.js`.

## 5. Models used
| Model | Used for | Loaded when |
|---|---|---|
| Face Landmarker (float16) | face, makeup, jewellery, hair styles | studio opens |
| Pose Landmarker lite | outfits, necklaces | an outfit or necklace is applied |
| Hand Landmarker | nails | a nail design is applied |
| Selfie multiclass segmenter | hair colour | hair colour is applied |
| Google Virtual Try-On (server) | AI outfit try-on | user presses Create in AI Photo |
| Gemini image editing (server) | AI hairstyle | user presses Create in AI Photo |

## 6. See your own tracking quality
Add `?debug` to the address (for example `https://glamify-xr.netlify.app/?debug`), open Try It On, and the preview shows landmarks, screen and camera frame rates, face-model time, how much of the face is in the picture, head roll and turn. Screenshots of that from your phone are the fastest way to guide the next round of fixes.
