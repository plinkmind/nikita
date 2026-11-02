# Testing report (Update 6)

## Environment
- Headless Chromium (Playwright), software rendering, MediaPipe Tasks Vision 0.10.17 (the version the site uses).
- **Real models**, byte-identical to Google's published files (same sizes, same internal file list):
  face_landmarker.task, hand_landmarker.task, pose_landmarker_lite/full.task, hair_segmenter.tflite.
  The multiclass segmenter used by default for hair colour could not be obtained here; the hair_segmenter (same "hair = 1" label) was used instead.
- **Real photos** from Google's own MediaPipe sample repository (google-ai-edge/mediapipe-samples, Apache-2.0): an adult portrait,
  three hand photos, a full-body photo. Your reference images were used for the jewellery and garment checks.
- **Fake camera:** Chromium's `--use-file-for-fake-video-capture` fed with videos made from those photos (still, moving side to
  side, tilting, moving closer/farther, a blank second where the face disappears).
- NOT available: a phone, a real camera, a real person turning or nodding, live AI services (no network access to them).
- Speed numbers are meaningless here (no GPU: about 250 ms per face analysis vs about 5 to 20 ms on a phone GPU), so the live studio
  tests processed only about 3 frames per second. Accuracy and stability were measured separately, frame by frame.

## How to rerun
```
npm install
node scripts/copy-wasm.mjs
npm run fetch-models                       # downloads the models into public/models (needs internet)
VITE_MODEL_BASE=/models/ VITE_DELEGATE=CPU npx vite --port 5199
node tests/run.mjs "test=motion"           # stability: old vs previous vs new (prints the table)
node tests/run.mjs "test=anchors" out.png  # ear lobe / nose / neck positions on the portrait
node tests/run.mjs "test=nails&img=hand1.jpg" out.png
node tests/e2e.mjs video.y4m out "lipstick,eyeliner,blush" # full studio with a fake camera
cd server && npm test                      # AI server against mock providers (35 checks)
```
(`npm i -D playwright` first if Playwright is not installed.)

## Results

### 1. Tracking stability (tests/harness.js "motion"), real face model
Detector run once per frame on 240 frames; all pipelines evaluated on the same landmarks; "realistic webcam noise" adds 0.9 px
per-point and 0.6 px common shake to the landmarks (typical of a 720p webcam).

| | Earring jitter still | Earring mean error moving | Earring worst | Lip jitter still | Lip mean error | Lip worst |
|---|---|---|---|---|---|---|
| No filter at all | 1.05 | 1.29 | 4.5 | 1.56 | 1.61 | 5.1 |
| First ZIP | 1.17 | 2.02 | 5.8 | 1.07 | 1.81 | 5.8 |
| Latest ZIP (before this update) | 4.20 | 2.23 | 13.5 | 4.79 | 2.52 | 18.7 |
| **This update** | **0.51** | **1.64** | **7.4** | **0.68** | **1.43** | **7.9** |

(pixels; frames never missed by any pipeline in this test). Filter settings were chosen by a grid search over about 100 combinations on
this data (`?grid=1`), weighting still jitter 3x against movement error.

### 2. Anchor placement on a real face (tests/harness.js "anchors")
Ear lobe, nostril-wing and neck points drawn on the portrait. The ear-lobe point was 1.7 cm too low on the first try and was moved;
nostril points sit on the nostril wings. Visual check only; a real ear varies by person (Size slider available).

### 3. Live studio, end to end (tests/e2e.mjs), fake camera with movement
| Feature | Result |
|---|---|
| Earrings (drawn jhumkas, kundan photo jhumkas) | Stay on the ear lobes through side-to-side movement, tilt and scale; disappear during the blank second and return after it. |
| Nose ring | On the nostril wing. |
| Necklaces (drawn + 3 photo necklaces) | At the base of the neck, hidden behind the chin; no jump when body tracking switches on/off (fixed during testing). |
| Makeup (lipstick, eyeliner, eyeshadow, blush, brows) | Inside the correct regions in all screenshots, lip texture visible, blush weaker on the turned-away cheek. |
| Hair colour | Burgundy: natural, strands kept. Black to honey-blonde: works but flatter (lightening very dark hair is hard). With a moving head and this machine's 1 mask per 1.2 s, the mask lagged ("ghost"); now runs every frame on computers (every 2nd on phones). On a real GPU the mask takes 10 to 20 ms. |
| Nails | See 4. |
| Live outfit (garment photo) | Placed on shoulders and torso, real shading blended in. Still clearly a 2D approximation; AI Photo is the realistic path. |
| Page errors | None (one blocked Google Fonts request, because this machine has no internet). |
| Layout | 1400x900 and 390x844: no horizontal overflow; fixed a bug where the product editor stayed visible on the AI Photo tab. |

### 4. Nails on real hand photos
| Photo | Result |
|---|---|
| Blue background, thumb up, fingertips visible | The 4 visible fingernails are painted exactly where the real nails are; looks natural. |
| Black background, fist | Tucked nails hidden; edge-on nails faded. |
| Two hands, fist | Only the front hand found by the model; tucked nails hidden; the visible index nail is NOT painted (fist edge case). |
| Same photos mirrored | Left/right labels flip and nail decisions match: mirroring is handled correctly. |
Found and fixed during testing: the first version of the 3D nail direction was inverted (painted tucked nails, hid visible ones).
**Not tested:** an open hand with the back toward the camera (no such photo available). Please send one.

### 5. AI server (server/test.mjs, 35 checks, all pass)
Consent required, image validation, size limits, CORS, rate limit, busy limit, honest "not configured" (no fake result), Google
request shapes, JWT signing, retries, timeouts, safety-filter handling, and the new FASHN provider (documented request shape,
polling, base64 result, PoseError message, wrong key). Against **mocks** only.

## Not tested (needs you)
- Your phone(s), Android Chrome / iPhone Safari, a live camera, real lighting.
- Head turning and nodding, a hand in front of the face, glasses, beards.
- Real AI results (need FASHN and/or Google Cloud keys).
