# Testing report

## Update 21: real-API integration

| Test | Result |
|---|---|
| Backend suite (`npm test`) | 83 of 83 (28 makeover tests on 2 storage drivers) |
| New: photo > 256 KB uploaded through the Files API once, reused by stylist + editor, deleted afterwards | pass (mock) |
| New: result download sends the token (the mock refuses downloads without it, as Replicate does) | pass (mock) |
| New: provider's reason kept (`error.detail`) | pass (mock) |
| New: live check - accepted token, wrong token (401), unknown model (404), model whose inputs changed | pass (mock) |
| `.env` added while `npm run dev` runs (BOM, quotes, CRLF), no restart: health not ready -> ready, live check OK | pass |
| `npm start` reads `.env` and reports the key (first 3 characters only) | pass |
| Page status: key works / wrong key / no key / static server (Live Server) -> 4 different, correct messages; Check again | pass |
| Full browser flow (upload, describe, occasion, instructions, create, result, download, another, failure) | pass (mock AI) |
| `npm run makeover:check` / `makeover:live` code paths (no key, check, full run saving a file) | pass (mock AI) |
| `npm run build` | pass |
| Secret scan of the project (r8_ / sk- / sk-ant- / fa- keys) | none found |
| **Real Replicate call** | **not run** (no key and no access to replicate.com here) |

## Update 20: AI Photo Makeover

**Real AI services: NOT tested** (no API keys in this environment, and replicate.com is not reachable from it). Everything
below runs against local mocks that follow the providers' documented APIs (Replicate predictions, FASHN /run + /status,
Anthropic /v1/messages). The mocks prove the pipeline (what is sent, in what order, how answers and failures are handled);
they cannot prove that the live services accept the requests or how good the generated photo is.

Backend (`npm test`: 77 of 77, of which 22 are the new makeover tests on two storage drivers)
| Test | Result |
|---|---|
| Not configured | 503 `not_configured`, names `REPLICATE_API_TOKEN`; health `ready: false` |
| Validation | consent, outfit photo or description required, unknown occasion, non-image upload: all rejected |
| Description only | stylist gets the photo + description + occasion + request; editor gets the REAL photo and an instruction with every planned product, "keep their identity exactly"; customer text never sent to the editor; plan returned; result private (other visitors 404); photos deleted; history type makeover |
| Outfit photo + FASHN | FASHN gets person + outfit; the makeup is applied to FASHN's dressed photo only |
| Outfit photo, no FASHN | nano-banana gets both images and is told to dress her; FLUX Kontext keeps her clothes and the result says so |
| FASHN cannot place the outfit | makeover still finishes, "outfit not placed" note |
| Stylist: unusable answer (retried once), no face, under 18, service error | job fails with the reason, editor never called, no image |
| Editor: blocked, not-an-image | job fails with the reason, no image |
| Claude stylist | key + images + request sent per the Messages API; plan used; on error the Replicate stylist takes over |
| Injection | plan text cleaned (no newlines, braces, tags), length-limited before it reaches the editor |
| Delete while running | AI job cancelled, record and files removed |

Browser (production build + real backend + mock AI services; the mock "result" is the test portrait stamped "MOCK RESULT")
| Test | Desktop 1400x900 | Phone 390x844 |
|---|---|---|
| Chapter "04 · AI Photo Makeover" and its button open the page | pass | pass |
| Not configured: message names the missing key, button disabled | pass | - |
| Photo, outfit photo + description, occasion, instructions, consent -> Create My AI Look | pass | pass |
| Progress per AI step -> "Your AI Makeover Is Ready!" | ~9 s with mocks | ~9.6 s |
| Plan shown: outfit, all 11 makeup items, hairstyle, jewellery; original + makeover + before/after slider | pass | pass |
| Download My Look (real file), My makeovers list | pass | pass |
| Try Another Makeup asks the stylist for a different look | pass | pass |
| Save My Look (guest) opens sign-up above the page | pass | pass |
| Edit My Instructions keeps the text and focuses it; Create Another Look clears everything | pass | pass |
| Failure (stylist: no face) shown as an error, no result | pass | pass |
| Website at 6 screen sizes, studio still opens | pass | |

**To verify with your key**: set `REPLICATE_API_TOKEN`, redeploy, open AI Photo Makeover, and try at least: a red bridal
lehenga photo, "black evening gown" as text, a pastel saree with occasion Engagement. Check the face is the same person,
skin texture is natural, and the makeup matches the plan shown under the photo.

## Update 19: AI Automatic Makeup debugging

**Not verified with a real webcam or a real phone.** This environment has no camera. All camera tests use Chrome's fake camera
fed with real-person videos, running the real MediaPipe models in the production build (GPU first, CPU fallback, hair and hand
occlusion on). That checks the whole software pipeline on real faces, but it is not proof on real hardware: please run the
checklist below on Desktop Chrome, Android Chrome and iPhone Safari.

Test faces: `bridal-ring.mp4` (a real woman, phone-shaped 720x1280: turning, smiling, open mouth, hand near the face),
the moving test portrait (desktop), `hero-earring.mp4` (head turned 26-44 deg).

| Test | Before (Update 18) | After |
|---|---|---|
| Click -> makeup fully on (production build, phone size) | 14 s (analysis stuck on a 20 deg head turn) | **4.5 s** (face found 1.5 s, features read ~1.2 s, fade 0.45 s) |
| Same, desktop portrait | 3.2 s (+ a second click) | 4.5 s including model load, one click |
| Products in every look | 7-11 | 12 (all 11 asked for + primer), all 10 occasions |
| Wedding Guest -> Diwali (from the strip on the camera) | - | whole look replaced (7 of 12 products change shade/strength) |
| Makeup outside the face (frontal portrait) | 0% | 0% |
| Lips: colour change inside vs a ring around them | - | 102 vs 12 (bridal video), 49 vs 10 (portrait) |
| Expressions on bridal video (open mouth, smile, turn, hand near face) | - | lips follow the mouth, teeth stay clean; makeup stops when the face leaves the picture (no floating) |
| Capture / Download | pass | pass (PNG 650-730 KB) |
| Face model blocked | generic message, reopen studio | real reason + Retry; Retry works when reachable |
| GPU fails on every frame (simulated) | camera without makeup, no message | switches to CPU, makeup on at 6 s |
| Slow internet 1.6 Mbps, empty cache | (60 s limit would fail) | "Still downloading... N s", model ready at 66 s, makeup on at 70 s |
| Camera blocked / no camera | message | message on the start screen + Try again |
| Existing categories (makeup, nails, 2D + 3D jewellery, hair colour, outfit) | - | unchanged (tests/e2e/categories.e2e.mjs) |
| Website at 6 sizes / backend suite | - | pass / 55 of 55 |

**Checklist for a real device** (open the site, press "✦ Start AI Automatic Makeup"): camera prompt appears at once; status line
reaches "Face model ready", "Face tracked", "Features read", "<look> on" within a few seconds; makeup visible on lips, eyes,
cheeks; turn, nod, blink, smile, open the mouth: makeup stays on; tap Wedding Guest then Diwali on the camera strip: the look
changes; Capture Photo, Download. If a stage stays grey or red, the status line and message say which one and why.

## Update 18: AI Automatic Makeup

Real MediaPipe Face Landmarker, headless Chromium with a fake camera, two real-face videos: (1) the test portrait moving
(turning +-7 deg, zooming, sliding), (2) `hero-earring.mp4`, a real woman turning her head 26-44 deg.

| Test | Result |
|---|---|
| Start -> face found -> look applied (portrait, desktop) | analysis starts 1.0 s after Start, look fully on at 3.2 s |
| Same, turned face, phone size 390x844 | analysis starts 3.4 s (waits 2.5 s for a straight look, then reads the turned face), look on at 5.8 s |
| All 10 occasions, portrait | each applies its complete look (10-12 products); makeup changes outside the face outline: **0%** for every look |
| Lip alignment (Bridal, portrait) | colour change inside the lips 222 vs 12 in a ring around them |
| Turned face (hero video) | primer smeared the nose edge into the background: fixed (primer mask from the 3D face mesh); lips, eyes, brows on target (checked on difference maps) |
| Controls | Try another look, intensity, lipstick shade, eyeshadow shade, effect on/off, Before/After, Remove all, Reset, Capture, Save Look: all pass |
| Camera blocked / no camera API | clear message on the start screen + Try again, no page errors |
| Face away 4 s | look fades out, face read again; same person gets the look back |
| Existing categories (makeup, nails, 2D + 3D jewellery, hair colour, outfit) | unchanged behaviour (tests/e2e/categories.e2e.mjs) |
| Website at 6 screen sizes, backend suite | pass / 55 of 55 |
| Frame time in this sandbox (2 CPU cores, no GPU, CPU model delegate) | 108 ms median: not representative; real phones use the GPU delegate |
| **Not tested** | a real person and a real phone; blinking and smiling with measured ground truth (the test videos have little of either); darker skin tones and hooded eyes on real faces |

## Update 17: website improvements

| Test | Result |
|---|---|
| Built site in Chromium at 360x740, 390x844, 820x1180, 1440x900, 844x390, 667x375 | header on one row, Enter button and whole finale (title, swatches, buttons, form) on screen at every size, no site errors |
| Demo form: bad e-mail / local server / simulated Netlify reply | error message / e-mail app fallback / form-name=demo&email=...&boutique=... posted, thank-you shown |
| "Try It On" with the studio loaded on demand (fake camera) | studio opens, camera starts, privacy line shown |
| Return visit | loader ready after ~0.9 s (first visit ~3.2 s) |
| Fonts | Figtree, Italiana, Pinyon Script load from the site; no request to fonts.googleapis.com |
| Backend suite | 55/55 |
| Not tested | a real Netlify deploy of the form (needs your Netlify account), real phones |

## Update 16: body tracking and outfit try-on

| Test | Result |
|---|---|
| `tests/run.mjs "test=garment"`: 48 synthetic garment photos, plain and busy backgrounds, true outline known | cut-out IoU median 0.82 -> 0.99 (plain), 0.27 -> 0.99 (busy); worst 0.75 (busy) |
| `tests/run.mjs "test=outfitgeo"`: synthetic poses (arms down/out/up/akimbo/crossed, lean, turn), 2 sizes | sleeve follows the arm within 2-4 deg (11/17 deg arms out/up); folded area <= 2% |
| `tests/run.mjs "test=outfit&img=pose.jpg"` and `img=portrait.png`: 6 framings each, flat vs warp | spill outside body 15-16% -> 3-5%; forearms covered 13% -> 3-10%; colour change 4.8-5.6 -> 2.2-3.2 |
| `tests/run.mjs "test=outfitjitter"`: still person, camera noise | warp as steady as flat (pose.jpg), steadier on portrait.png |
| `tests/run.mjs "test=posecost"`: pose model with / without person mask | 50 -> 56 ms median (CPU sandbox) |
| `tests/e2e.mjs` fake camera (moving body video) + garment photo | warp renderer + person mask active, no errors |
| Full studio category test / backend suite | pass, no site errors / 55 of 55 |
| Not tested | real phone, real person, standing full-body photo, real garment product photos |

---

## Update 15: jewellery and 3D accessories

| Test | Result |
|---|---|
| `node tests/rig/jewel.mjs` (test head, webcam-like jitter): ear and neck anchors per movement, still jitter | ears 0.32-0.67 cm median; neck 1.93 -> 1.05 cm median overall; jitter 0.22 px (ears), 0.34 px (necklace) |
| `tests/rig/run.mjs "test=partial"`: head near the picture edges, up/down, turned | earring shown exactly when the real lobe is visible in 20/22 cases (was 17/22) |
| 3D jhumkas + 3D necklace at 6 poses (`test=look`) | necklace wraps the neck, back hidden; far earring hidden by the head |
| Full studio category test incl. 3D jewellery | pass, no console errors from the site |
| Face bench / backend suite | unchanged / 55 of 55 |

---

## Update 14: hand and nail tracking

| Test | Result |
|---|---|
| `tests/run.mjs "test=nailmotion"` on two real hand photos, 3 speeds x 4 scenarios (normal, missed frames, label flips, wrong detections) | equal or better in every case; label flips 1.09 -> 0.17 nail lengths (95th %), wrong detections worst case 4.69 -> 1.98 |
| Nail centres vs real nails marked on a photo | 13.3 -> 6.3 px average |
| Full studio, moving + turning hand video, mirrored view, red polish | nails stay on the nails, no console errors from the site |
| Backend suite | 55/55 |

**Not tested:** an open hand with the back to the camera with ground truth, real nail shapes of different people, phones.

---

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
