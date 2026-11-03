# Testing report

## Update 13: hair segmentation and hair colour

| Test | Result |
|---|---|
| `tests/run.mjs "test=hairc"` on a studio portrait and an outdoor photo, 6 shades, real Hair Segmenter + Face Landmarker | skin spill 0.45 -> 0.12, halo 1.35 -> 0.31, flicker 0.030 -> 0.008, moving-mask match 0.69 -> 0.72; texture and shine rebuilt from the real hair (see `TRACKING-AUDIT.md` Update 13) |
| Dim / warm / cool light | hue within 0-8 deg of the shade on the portrait, up to ~20 deg on the outdoor photo under warm light |
| Full studio, moving portrait video, hair colour | GPU path active every frame, no console errors from the site; a pale forehead patch found while moving (mask from a newer video frame) - fixed and re-checked |
| Backend suite | 55/55 |

**Not tested:** phones (GPU shader and Hair Segmenter speed), long or curly hair (no free test photos with them were available here),
real people.

---

## Update 12: face tracking and 3D face mesh

| Test | Result |
|---|---|
| `npm run test:face` (scanned head, real Face Landmarker results, webcam-like jitter): normal, 15% missed frames, 3% wrong detections, 15 fps, mirrored | all better or equal, see `TRACKING-AUDIT.md` Update 12 (wrong-detection worst case 9.56 -> 3.58 cm, missed-frame error -45%, quick-move lag -22 to -25%, jitter +2.5%) |
| Named anchors vs the scan's ground truth | eyes, nose, lips, cheeks, chin 0.13-0.28 cm median; visibility agrees 90-100% |
| Full studio on the test-head video with `?debug` (turns, nod, tilt, close, far, dim and warm light, face leaving and coming back) | tracking, mesh and anchors follow; no console errors from the site. In this slow sandbox (2-5 analysed frames per second at 640x480) the face was sometimes not found on a strong upward look and while the head was out of view |
| Backend suite | 55/55 |

---

## Update 11: AR phases 1-5

Same environment as Update 10 (headless Chromium, software GPU, real MediaPipe models, scanned 3D test head + real portrait;
no phone, no real camera, no GPU).

| Test | Result |
|---|---|
| Phase 2, perspective vs flat head fit on the rig with webcam-like jitter (`node tests/rig/persp.mjs`) | flat fit is better for ear lobes (0.45 vs 0.87 cm median) - perspective switched off |
| Head tracker unchanged (`node tests/rig/eval.mjs`, `npm run test:tracking`) | identical to Update 10 |
| Phase 3, portrait: makeup with and without hair/face occlusion (`tests/run.mjs "test=occl"`) | hair strand over the forehead keeps its real colour; eyes and brows unaffected |
| Phase 3, full studio with a moving portrait video, hair colour + makeup | no errors; a hair-colour ghost found in the first version (previous mask not moved with the head) - fixed and re-checked |
| Phase 4, light direction on the rig, 7 lamps x 2 head turns (`tests/rig/run.mjs "test=lightest"`) | 5.6 deg average error facing the camera, 17.5 deg with the head turned 26 deg |
| Phase 5, 3D jewellery on the rig at 5 poses (`tests/rig/run.mjs "test=look"` with j3-* products) | pieces on the lobes; far earring hidden behind the head when turned; hanging pieces hang with gravity when tilted |
| Full studio category test incl. 3D jhumkas + 3D necklace (`tests/e2e/categories.e2e.mjs`) | pass: right models per category, 3D layer on, light estimate running, hand hints only on Nails, no console errors from the site |
| Backend suite (backend unchanged) | 55/55 pass |

**Not tested:** real phones (speed of the segmenter for occlusion, the WebGL mask and the 3D jewellery), real room lighting
(colour cast and exposure of the light estimate), real people's ears and hair.

---

## Update 10: AR tracking re-audit and 3D face mask

**Environment:** headless Chromium, software GPU (SwiftShader), real MediaPipe models from `public/models`, fake camera made
from a scanned 3D head (`tests/rig/`) turning, nodding, tilting, moving closer/farther, dim and warm light, leaving and
coming back. No phone, real camera or real person was available, and the sandbox has no GPU, so speed is not measured.

| Test | Result |
|---|---|
| Head tracker on the rig with webcam-like landmark jitter (`node tests/rig/tune.mjs`): still jitter 2.00 -> 0.47 px, movement error 0.21 cm (raw) / 0.25 cm (filtered), 54 alternative filter settings compared | current settings kept (no setting better on both) |
| Skin makeup (foundation, concealer, blush, highlighter) at 9 head poses, 2D vs new 3D face mask: paint landing outside the head | 2D: up to 2,362 px; 3D mask: 0 px at 8 poses, 43 px at a 46 deg turn (mesh edge) |
| Category switching in the full studio (`tests/e2e/categories.e2e.mjs`): makeup -> nails -> makeup -> remove nails -> jewellery -> hair -> outfit -> reset; models loaded per category, guidance text per tab, 3D mask active | pass: hand instructions only on the Nails tab; body model loads for necklace/outfit, hair model for hair colour; mask active |
| Console errors during the whole run | none from the site (only "request failed" for outside websites, the sandbox has no internet) |
| Backend suite (unchanged backend) | 55/55 pass |

Found and fixed: hand-occlusion model showed "Loading hand tracking..." on the makeup tab; a model that cannot download was
retried with a "Loading..." note every 8 s forever.

**Not tested:** real Android/iPhone (GPU speed of the WebGL mask, camera quality), a real person, real room lighting.

### Re-run
```
npm run fetch-models
VITE_MODEL_BASE=/models/ VITE_DELEGATE=CPU VITE_HAIR_MODEL=hair npx vite --port 5199      # terminal 1
node tests/rig/tune.mjs                                                                    # filter comparison (Node only)
node tests/rig/run.mjs "test=look" out.png              # makeup + jewellery on the head at 5 poses (add &mesh=0 for 2D)
node tests/rig/make-video.mjs rig.y4m                   # fake camera video of the head (see its header)
node tests/e2e/categories.e2e.mjs rig.y4m out.json      # category switching in the full studio
```

---

## Update 9: backend (accounts, AI try-on API, private images, history)

**Environment:** this project's real code, Node 22, headless Chromium (Playwright). The paid AI services were replaced by local
**mocks of their documented APIs** (FASHN, Replicate) and the free Hugging Face Space by a **local copy of its exact interface**
(Gradio 4.24.0, same `/tryon` endpoint and inputs, `tests/standin/`). Netlify Blobs was tested with Netlify's own local Blobs
server (`@netlify/blobs/server`). No real AI generation, no real Netlify deploy and no phone could be tested here.

| Test | Result |
|---|---|
| Backend suite, 18 scenarios x 3 storage drivers (memory, folder, Netlify Blobs): registration + validation, secure cookies, login/logout/session expiry, same message for unknown e-mail / wrong password, login rate limit, profile, CSRF + CORS + 404/405/400/413, upload validation (fake SVG, too small, missing, wrong type), FASHN flow with real result image and photos deleted afterwards, other users cannot read jobs/images, FASHN failures (pose, bad key, not-an-image) never produce a result, retry after "busy", free mode complete/fail, history order + delete (files really removed), guest looks moved into a new account, Replicate hairstyles, "not switched on" answers, generate rate limit, clean-up of expired looks / leftover photos / stuck jobs, account deletion removes all data, generic 500 messages | **54/54 pass** |
| Bundled Netlify function (esbuild, as Netlify builds it) with only Netlify's own environment (`NETLIFY_BLOBS_CONTEXT`): Blobs chosen automatically, Secure cookies, sign-up, free try-on, private image, scheduled clean-up | **1/1 pass** |
| Browser, website + real backend, FASHN mock, desktop 1440x900 and phone 390x844: guest generate (upload, loading stage, result from the private image URL, download), My looks, sign up from the guest notice (look moved into the account), header shows the name, second look, delete, sign out, wrong password message, sign in again, history back, failed generation shows a clear message and no image, no sideways scrolling | **36/36 pass** |
| Same browser flow in **free mode** against the local IDM-VTON copy (photos sent from the browser, result saved through `/complete`) | **34/34 pass** |
| Free-mode edge cases: website on a plain file host with no backend (free mode still works, result marked "not saved"); free service down (clear message, attempt recorded as failed) | **4/4 pass** |
| `npm run dev` (API inside Vite) and `npm start` (standalone server): health, sign-up, website files, WASM content type, missing files 404, path traversal blocked | pass |
| Live camera studio regression (fake camera, real MediaPipe face + hand models): lipstick, blush, kundan jhumkas on the ear lobes, face tracked every frame, hand found for occlusion | pass (ear positions identical to the previous version) |

Found and fixed during testing: browser form builder bug (uploads failed), typed e-mail lost after a wrong password, a failed
free attempt shown as "in progress" in history, empty numeric settings read as 0, missing files served as the homepage.

**Not tested (needs you / real services):** a real FASHN, Replicate or Hugging Face generation; a real Netlify deploy and
Netlify's real Blobs service; real phones; many simultaneous users.

### Re-run
```
npm install && npm run test:backend
npm run build && MODE=fashn node tests/e2e/serve.mjs 5300                       # terminal 1
node tests/e2e/fullstack.e2e.mjs http://127.0.0.1:5300 . tests/img/portrait.png tests/img/pose.jpg fashn   # terminal 2 (needs playwright)
```
Free mode: start the stand-in (`tests/standin/idm_vton_standin.py`, setup in its header), then
`MODE=free FREE_TRYON_SPACE=http://127.0.0.1:7861/ node tests/e2e/serve.mjs 5310` and run the same test with `free`.

---

## Update 6

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
