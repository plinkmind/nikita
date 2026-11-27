# Update 21: AI Photo Makeover connected to the real Replicate API (key from .env)
**Bugs fixed** (found by checking Replicate's API documentation against the Update 20 code):
1. Generated images were downloaded WITHOUT the API token. Replicate serves output files from replicate.delivery and requires
   the token: the first real result would have been refused (also affected AI hairstyles). Fixed for both.
2. Photos were always sent inline as data URIs; Replicate recommends data URIs only up to 256 KB. Larger photos now go
   through Replicate's Files API (uploaded once per job, reused, deleted from Replicate when the job ends).
3. "Check again" could never succeed after adding the key: `npm run dev` built the backend once and kept the old settings.
   The backend now re-reads `.env` when it changes. "Check again" also runs a live check (token accepted? models exist and
   accept our inputs?) instead of only asking whether a key is present.
4. A page with no server (VS Code Live Server, a double-clicked index.html) said "check your internet connection"; it now
   says the page is not connected to the server and how to start it (also on See It On You).
5. Replicate's own error reason (e.g. "Invalid token", "insufficient credit", a rejected input) was dropped; it is kept and
   shown under the error. HTTP 404 (model renamed) has its own message.
6. `.env` values with surrounding quotes or `export` in front, and placeholder values, are handled.

**New**: `GET /api/makeover/check`; `npm run makeover:check` (free) and `npm run makeover:live` (real generation from the
command line, saves the photo to test-results/); key-found lines in the dev and `npm start` terminals (first 3 characters
only); success / error / connected status messages on the page; `.env.*` and the live-test outputs in `.gitignore`.

**Not verified here**: a real Replicate call. This environment has no key and cannot reach replicate.com. Run
`npm run makeover:check`, then `npm run makeover:live -- your-photo.jpg "outfit"` with your key.

---

# Update 20: AI PHOTO MAKEOVER (personal AI makeup artist for a photo)
**Status: built and tested against simulated AI services. NOT yet run against the real AI services**: that needs your
`REPLICATE_API_TOKEN`. No AI-generated makeover photo has been received yet, so the quality of the real result (identity,
realism) is unverified until you run it with your key (README section S has the checklist).

**New**
- `backend/src/providers/makeover.js`: AI stylist (Replicate vision model `openai/gpt-4.1-mini`, or Claude with
  `ANTHROPIC_API_KEY`) and AI image editor (Replicate `google/nano-banana`; nano-banana-2 / -pro / FLUX Kontext also work),
  the stylist instructions, the plan parser (only expected keys, cleaned, length-limited) and the editor instruction.
- `backend/src/services/makeover.js`: the job: FASHN outfit (optional) -> stylist -> editor. Every step is start-then-poll,
  so no request takes more than a few seconds (Netlify stops functions at 10 s). Retries for "busy", honest failures.
- `backend/src/controllers/makeoverController.js`, routes `POST /api/makeover/generate`, `GET /api/makeover/status/:id`.
- `src/makeover/makeover.js` + `makeover.css`: the page (photo, outfit photo / description, occasion, instructions, hair and
  jewellery options, consent, progress per AI step, result with original + makeover, before/after slider, the AI's plan,
  Download / Save / Try Another / Edit Instructions / Create Another, My makeovers).
- Website: chapter "04 · AI Photo Makeover" with "✦ Create My AI Look"; "AI Photo Makeover" on the last screen.

**Changed**: `services/tryon.js` (shared storage handles the extra in-between image, makeover plan in job views, cancels a
running makeover on delete, new error messages), `config.js` (makeover settings; default single AI call timeout 20 s -> 8 s
to stay under Netlify's 10 s), `healthController.js` (`tryon.makeover`), `tryonController.js` (history `type=makeover`),
`app.js`, `routes.js`, `src/api/client.js`, `src/main.js`, `.env.example`, README (section S), docs/API.md.
Not changed: live AI Automatic Makeup, studio, makeup catalogue, jewellery, hair, nails, outfits, See It On You, accounts.

---

# Update 19: AI Automatic Makeup - debugged and fixed
The whole pipeline was traced stage by stage (camera -> model loading -> face detection -> landmarks -> analysis -> look ->
makeup state -> rendering) in the PRODUCTION configuration (GPU first, hair and hand occlusion on, models served by the site),
with real-face videos as the camera. The earlier test had forced the CPU and had no hair/hand models, so it missed these.

**Bugs found and fixed**
1. **Analysis waited for a perfectly straight face.** Frames turned more than 17 deg were thrown away. People at a laptop or
   phone look at the screen, not the lens (measured: 20 deg on a real-person video), so 60% of frames were rejected and the look
   took **14 s** to appear (it looked broken). Now frames up to ~29 deg are used (measurements are corrected for the turn), a
   strongly turned face is still read after 1.5 s, and the reading takes ~1.2 s (never more than 3 s). Result: makeup on
   **4.5 s after one click**, including loading the model.
2. **Silent face-detection failures.** Every detection error was skipped without a trace. On devices where the GPU model loads
   but fails on every frame, the person saw the camera with no makeup forever. Now 20 failures in a row switch to the CPU
   automatically; if that fails too, the real error is shown with a Retry button.
3. **Model loading errors were generic, with no retry**, and a slow connection had no feedback. Now the actual reason is shown
   ("Reason: Failed to fetch", a timeout...), with Retry; slow connections show "Still downloading... N s" (tested at 1.6 Mbps:
   66 s, then it works). The model starts downloading while the camera permission prompt is open.
4. **Models depended on storage.googleapis.com at runtime** (blocked by some ad blockers, company networks and ISPs). The build
   now downloads them into the site (`scripts/fetch-models.mjs`, run by `npm run build` and `npm run dev`; never fails the build)
   and the site serves them itself, with Google as the fallback.
5. **Two clicks to start, and an easy-to-miss entry.** "✦ Start AI Automatic Makeup" is now the primary gold button on the first
   screen, the beauty chapter and the finale (plus "✦ AI Makeup" in the header on wide screens). One click opens the studio on the
   AI Makeup tab and asks for the camera immediately.
6. **Daytime Auto look was nearly invisible** (nude "Polished office"): it read as "camera without makeup". Everyday looks are now
   clearly visible, and **every look is complete**: foundation, concealer, contour, blush, highlighter, eyeshadow, eyeliner,
   mascara, brows, lipstick and gloss (plus primer). Red lipstick in festive / bridal looks is applied deeper (it read as pink
   in warm light).
7. **Occasion change needed scrolling on phones.** Occasions are now a strip ON the camera view.
8. **No way to see what was happening.** A status line shows each stage: Camera on, Face model ready (GPU/CPU), Face tracked,
   Features read, Look on.

**Files changed**: src/tryon/studio.js, src/tryon/autolook.js, src/tryon/track/mediapipe.js, src/tryon/tryon.css, src/main.js,
src/style.css, index.html, scripts/fetch-models.mjs, vite.config.js, package.json, netlify.toml.
Not changed: makeup.js, head.js, masks.js, facemesh.js, tint.js, jewellery, nails, hair, outfits, AI photo, backend, accounts.

**Models (nothing to do on Netlify)**: the Netlify build downloads them automatically. On your computer `npm run dev` / `npm run
build` does the same (needs internet once). Without internet the site falls back to Google's storage, as before.
Test hooks (only with `?debug`): `?debug=stats` exposes the AI state for automated tests; `&failgpu` simulates a broken GPU.

---

# Update 18: AI Automatic Makeup mirror
A person sits in front of the camera; the mirror finds the face, reads the features and applies a complete makeup look live.
Built on the existing studio: same camera (camera.js), same face tracker (MediaPipe Face Landmarker + track/head.js), same
makeup renderer (makeup.js, 3D face mesh render/facemesh.js, lip tint render/tint.js, hair/hand occlusion render/masks.js).
No second camera or tracking system, and no camera frame is sent anywhere.

**How to open it**: "Try the AI makeup mirror" on the first screen, "AI makeup on your face" on the beauty chapter, or the
"AI Makeup" tab inside the studio. Code: `studio.open({ mode: 'auto' })`.

**Flow**: start screen -> Start Makeup Experience (camera permission) -> guidance until a face is in view ("come a little closer",
"look straight at the camera") -> about 1.4 s of analysis with a scanning effect over the real face -> the complete look fades in
-> the person changes occasion, intensity, shades, effects; Before/After, Capture Photo, Download, Save Look.
- A face that stays turned (angled laptop) is still read after 2.5 s, with measurements corrected for the turn.
- Away for 4 s (stood up, new customer): the look fades out and the face is read again. Same person: look and choices come back.
  Someone new: a fresh look for them.

**New files / changes**
- `src/tryon/autolook.js` (new): face analysis + styling engine.
  - Analysis (median of about 20 good frames): face shape (oval, round, long, square, heart), eye shape (almond, round, hooded)
    and spacing, lip fullness, brow darkness, and a foundation shade + undertone picked for how the skin looks ON THIS CAMERA.
    The panel says these are estimates, not a skin analysis.
  - 10 options: Auto Makeup, Natural Everyday, Office, Party, Glam, Wedding, Bridal, Engagement, Diwali, Holi; 2 looks each
    ("Try another AI look"). Every look is complete: primer, foundation, concealer, contour, blush, highlighter, eyeshadow,
    eyeliner, mascara, brows, lipstick, gloss (as the occasion needs).
  - Adapted to the face: foundation / concealer / contour / highlighter shades follow skin depth; blush and lipstick families follow
    undertone (e.g. maroon instead of red on deeper or cool skin); shorter liner wing on hooded eyes, longer on round eyes; more
    gloss on thin lips; contour placed for the face shape.
  - Auto Makeup: Diwali / Holi looks in the week of the festival (dates in `FESTIVALS`, UPDATE them for later years), otherwise
    party in the evening, office on working days, natural otherwise. The panel says why it chose.
- `src/tryon/makeup.js`: new **Contour** product (also in the manual Makeup tab), metallic gold eyeshadow (was flat yellow),
  adjustable liner wing, primer mask drawn with the 3D face mesh (it smeared the nose edge into the background on turned heads).
- `src/tryon/studio.js`: AI Makeup tab, start screen, analysis, fades, controls; errors (camera blocked, no camera, unsupported
  browser) shown on the start screen with Try again.
- `src/tryon/tryon.css`, `src/main.js`, `src/style.css`: styles and entry buttons.

**Edit the looks**: `OCCASIONS` in `src/tryon/autolook.js`. Each look is a list of [product, shade, strength, extras].

**Limits (honest)**: makeup is drawn from face landmarks in the browser (the right approach for live video), not generated by
an image AI, so it looks like makeup on the real face rather than a retouched photo. Face-shape thresholds were tuned on two test
faces only. Skin shade picking depends on the camera and light. Not yet tested with a real person on a real phone.

---

# Update 17: website improvements (layout, demo requests, copy, speed, link previews)
Website only: tracking, try-on and backend behave as before (backend suite 55/55).

**Layout**
- Phones held sideways: the loader's **Enter** button and the finale (buttons, form) were cut off. Both now fit (checked at 844x390 and 667x375).
- "Request a demo" is visible on every phone (short label "Demo"; on phones under 420px wide the logo shows the round mark).
- Upright phones: the finale mirror sits higher and smaller so the text no longer covers it.

**Demo requests (`src/main.js`, `index.html`)**
- New field: boutique or brand (optional), a hidden anti-spam field, and an on-page "Thank you" message.
- On Netlify, requests go to **Netlify Forms** (Netlify > your site > Forms). Turn on e-mail alerts there:
  Site configuration > Forms > Form notifications > Add notification > Email notification.
  If Forms says "not enabled", click **Enable form detection** once, then redeploy.
- Anywhere else (your computer, another host), the visitor's e-mail app opens with the request filled in.
  The fallback address is `DEMO_EMAIL` at the top of `src/main.js`. CHANGE IT to your real address.

**Copy**: claims the product cannot back up were replaced ("<5ms", "physics-based fabric drape", "precision ray-tracing").
The new text describes what the mirror does (live tracking on the device, AI photo for realistic outfits, 3D jewellery).
Edit it in the `CH` list at the top of `src/main.js`.

**Speed**
- Fonts are served from the site itself (@fontsource packages): no Google Fonts request, no layout jump.
- The try-on studio code is no longer in the first download (main script 73 kB -> 8 kB gzipped). It loads in the background
  after the page has loaded, so it is normally ready before the visitor taps "Try It On".
- Hero video has a poster image, so the first screen shows instantly.
- Loader: the full 3.2 s intro on the first visit, 0.9 s on return visits. The Enter button gets keyboard focus.

**Link previews and search**: Open Graph / Twitter tags and `public/og-image.jpg` (1200x630). The full address is filled in at
build time from Netlify's `URL` (or `SITE_URL` in `.env`). A `<noscript>` text block for visitors and crawlers without JavaScript.

**Trust**: the studio header says "Your camera picture stays on this device. Nothing is recorded or sent."

**Still to do (needs your decision or content)**
- The hero video (`public/videos/hero-earring.mp4`) shows garbled AI-generated menu text on its right side ("Preforance",
  "Abverative", "Visual indexrp"), visible on wide screens. Re-export or crop the video.
- Free AI try-on (IDM-VTON) has a non-commercial licence but is on by default; README section on models says it is not used.
  Decide, then set `VITE_FREE_TRYON=off` in Netlify environment variables if needed.
- Privacy policy / terms pages (face photos and accounts), customer logos or results, analytics.

---

# Update 16: body tracking and outfit try-on (Step 7)
Garment photos on busy backgrounds are now cut out (colour models + graph cut, merged with the plain-background method); the live
outfit is bent onto the body (torso follows shoulders, waist, hips and body turn; sleeves follow the arms), keeps the garment's
own colours (only light changes are applied), stays inside the body outline from the pose model's new person mask, and arms are
drawn in front of it. Still a 2D warp, not a cloth simulation; the AI photo try-on is unchanged. Details: `TRACKING-AUDIT.md` Update 16.

---

# Update 15: jewellery and 3D accessories (Step 6)
Neck anchor fixed (shoulder points no longer pull the necklace sideways), ear visibility along the camera's line of sight, 3D
necklace as a loop around the neck with an invisible neck hiding its back, turning with the body. Details: `TRACKING-AUDIT.md` Update 15.

---

# Update 14: hand and nail tracking (Step 4)
Hand tracking module (identity by position, voted left/right, missed-frame prediction, jump guard), nails moved onto the real
nail plates, hidden when covered by another finger or cut by the picture edge, curved-plate shading and light-aware shine.
Details: `TRACKING-AUDIT.md` Update 14.

---

# Update 13: hair segmentation and hair colour (Step 3)
Hair Segmenter model (sharper, 20x smaller download), only head-connected hair, mask moved with head turns, eyes/brows/lips and
forehead protected, segmenter reads the drawn frame, GPU recolouring that keeps the real strands and shine. Hairstyles stay
AI-generated (no fake live overlay). Details: `TRACKING-AUDIT.md` Update 13.

---

# Update 12: face tracking and 3D face mesh (Step 2)
Missed-frame prediction, jump guard against wrong detections, faster-reacting smoothing, named face anchors
(ears, eyes, brows, nose, lips, cheeks, jaw...) shown in `?debug`. Measurements: `TRACKING-AUDIT.md` Update 12.

---

# Update 11: AR plan phases 1-5
Phone performance report in `?debug`; perspective head fit tried and measured (kept off: not more accurate); hair/face
occlusion for makeup and hair over garments with edge-refined, motion-compensated masks; room light estimate for metal, gloss
and nail shine; demo 3D jewellery (Three.js) with head occlusion. Details: `TRACKING-AUDIT.md` (Update 11), `TESTING-REPORT.md`.

---

# Update 10: AR tracking audit and 3D face mask
Live studio only (the backend is unchanged). Skin makeup now uses a real 3D face mesh (WebGL) instead of flat shapes;
category pipelines and loading notes fixed. Audit, measurements and limitations: `TRACKING-AUDIT.md` (Update 10) and
`TESTING-REPORT.md`.

---

# Update 9: backend
New full-stack backend (`backend/`, docs in `docs/BACKEND.md` and `docs/API.md`, setup in README section O). This version also
contains all fixes from Updates 6.1 to 8 (garment cut-out and fitting, clothes never above the jaw, hand in front of face
items, natural primer/foundation/blush/eyeliner/mascara, smaller loading notes, exact camera-frame detection, automatic load
saving, free AI try-on, See It On You page). Test results: `TESTING-REPORT.md`.

---

# Fix report (Update 6): tracking stability, earrings, makeup, nails, jewellery realism

**What is different this time:** every result below was measured with the **real MediaPipe models** (the same model files the
website loads) running on **real photographs** in a real browser (headless Chromium). The previous update was tested only on
simulated landmarks. What I still could NOT do: run it on your phone, with a live camera, a real person moving and turning their
head, or with the paid AI services (no keys and no network access to them here). Details: `TESTING-REPORT.md`.

---

## 1. Root causes found (in your latest ZIP), and what fixes them

| # | Symptom you reported | Root cause (found in the code, confirmed by measurement) | Fix |
|---|---|---|---|
| 1 | Makeup and jewellery **flicker / shake** | The smoothing filter divided **absolute screen positions** by the face width before filtering. The face width itself jitters about 1% per frame, so the whole face "breathed" by several pixels every frame. Measured: with typical webcam noise the previous version had **4.2 px** of earring jitter while still, **4x worse than no filter at all** (1.05 px), and lip points jumped up to **18.7 px**. | New filters normalise only the *speed*, never the position (`src/tryon/track/filters.js`). Still jitter now **0.51 px** (earrings) and **0.68 px** (lips). |
| 2 | Makeup **swims / lags** behind the face | Tracking ran on one camera frame but was drawn over a newer frame (the screen refreshes at 60 Hz, the camera at 30 Hz, the phone ran detection only every 45 ms). Makeup and earrings also used two different filters, so they drifted apart. | **Frame sync:** each camera frame is analysed once and that exact frame is shown with its own tracking result (`studio.js loop`). One head model feeds every face item. |
| 3 | Earrings **land on the cheek, mouth or nose** | Ear positions were built from 3D landmark depth combined with **mirrored** x-coordinates. Mirroring one axis flips 3D handedness, so on some head turns the "outward" direction pointed across the face. The model's confidence thresholds were also lowered to 0.3, so unreliable landmark sets were used instead of being treated as "no face". | MediaPipe's **canonical 3D face model is fitted to every frame** (rotation, size and position, using only rigid points: eye corners, nose bridge, forehead, temples). All 3D maths happens in camera coordinates; mirroring is applied only at the end. Ear lobes, nose piercings and the neck are fixed points on that 3D head: they are **never taken from a nearby landmark**, so they cannot jump to the nose or mouth. Implausible landmark sets (bad fit) are rejected. Confidence back to 0.5 / 0.6 / 0.5. |
| 4 | Earrings **vanish too early** when turning | The far ear was hidden from about 7° of head turn. | Each ear has its own visibility from the fitted 3D rotation; the far ear fades between about 25° and 40° (when the head really hides it). |
| 5 | Makeup **blinks off** | Face items were switched off whenever more than 20% of the face left the picture, and dropped instantly on a missed frame. | Tracking presence fades in 90 ms / holds 160 ms / fades out 240 ms; partial faces keep their makeup. After a real loss (over 0.5 s) tracking restarts fresh instead of sliding in from the old place. |
| 6 | Nails painted in the **wrong places** | The "back of the hand" test was a 2D guess, never run on a real hand. | Rewritten with the model's **3D world landmarks**: each nail's facing direction is carried joint by joint along the finger, so a curled finger is handled. Checked on 3 real hand photos (see section 4). |
| 7 | Hair-colour edge **shimmers** | Raw 0/1 hair mask, stretched, from a different frame than the one shown. | Mask analysed on the shown frame, averaged over time, soft-edged; colour applied with the lighting-aware tint. |

## 2. Measured results (real face model, real photo, known motion, realistic webcam noise)

Test: the portrait photo moved with known amounts (still, side to side up to 440 px/s, tilt +/-12.6°, closer/farther +/-25%).
Error = distance from where the item should be. Pixels at a 960x720 frame, face about 135 px wide.

| | Earrings: jitter while still | Earrings: mean error moving | Earrings: worst error | Lips: jitter still | Lips: worst error |
|---|---|---|---|---|---|
| First ZIP | 1.17 px | 2.02 px | 5.8 px | 1.07 px | 5.8 px |
| **Your latest ZIP** | **4.20 px** | 2.23 px | 13.5 px | **4.79 px** | **18.7 px** |
| **This update** | **0.51 px** (-88%) | **1.64 px** (-26%) | **7.4 px** (-45%) | **0.68 px** (-86%) | **7.9 px** (-58%) |

Raw file: `tests/results-motion.json`. Rerun: see `TESTING-REPORT.md`.
**Not covered by this test:** turning left/right and nodding (a flat photo cannot turn). Those are handled by the 3D head fit and
checked geometrically, but **must be confirmed on a real person**.

## 3. Different tracking for different features (as you asked)

| Feature | Tracking | Smoothing |
|---|---|---|
| Earrings, nose rings, necklace position | fitted 3D head only (no individual landmarks) | rigid head filter, responsive (tuned: 1 Hz / beta 45 position, 30 rotation) |
| Makeup | head pose + expression shape filtered separately | rigid filter for movement + calmer expression filter (lips, lids, brows) |
| Necklace tilt | body model shoulders (every 3rd frame) | own filter; the necklace position never depends on it, so it cannot jump |
| Nails | hand model, 2D + 3D world points, per hand | own filter per hand, hands below 0.6 confidence ignored |
| Hair colour | hair segmentation | time-averaged mask |
| Live outfit | body model every frame | own filter + fade on loss |

## 4. Feature by feature

**Earrings and jewellery.** Positions from the 3D head fit; per-ear visibility; earrings hang under gravity and swing.
**New: photo jewellery.** Real product photos (transparent PNG) are placed on the tracked ear lobe or neck at their **real size in
centimetres**, with a soft contact shadow, and necklaces are hidden behind the chin. Four demo products were cut out from the
reference images you sent (`public/products/demo/`, tool `scripts/cutout.py`). **Replace them with your own product photos before
going live** (several of the reference images look like they come from other websites). How to add products: comment at the top of
`JEWELLERY` in `src/tryon/jewellery.js`. The drawn (vector) jewellery is still there; product photos look far more realistic.

**Makeup.** Stable masks (see table). Lipstick keeps the real lip texture: the lips' brightness is measured and shifted toward the
shade, then the shade's colour is applied, inside a soft lip mask with the mouth opening cut out. Eyeshadow stops below the brow.
Blush and highlighter fade on the cheek that turns away.

**Nails.** Polish is painted inside an estimated nail shape on the last finger bone, in perspective (narrows when the finger rolls,
shortens when it tilts), keeps the real nail's light and shade, and is cut by a soft mask so it cannot spill onto the skin. Nails
facing away (tucked into a fist) and nails seen edge-on fade out. On 3 real hand photos: the 4 visible fingernails of the blue
background hand are painted where the real nails are; tucked nails are hidden. **Limitation:** there is no nail-segmentation model
in MediaPipe, so the nail outline is estimated from finger geometry; the test photos had no open hand with the back toward the camera
(please send one).

**Hair.** Live hair colour on your real hair (strands, shine and shadows kept). Live *haircuts* are not drawn: a flat shape over a
live camera cannot look like real hair, and I will not pretend otherwise. **Hairstyles are made in AI Photo**, now with 15 styles
taken from your reference sheets (sculpted bob, curtain bangs, shag, mermaid waves, deep curly side-part, half-up twisted crown...),
and a stricter identity-preserving instruction.

**Outfits.** Live mode = your garment photo on your shoulders and torso, now with your real light and folds blended in, and forearms
held in front of the body drawn over the garment. It is still an approximation (no cloth simulation). **Realistic outfits = AI Photo**
(a real try-on model). New: you can choose **FASHN tryon-v1.6** as the provider (purpose-built try-on, about 5 to 17 s per image) or
keep Google Virtual Try-On. See `TRYON-MODELS.md`.

## 5. What still needs external models, services or your input

| Need | What | Status |
|---|---|---|
| Realistic AI outfits | FASHN API key (paid per image) **or** Google Cloud Virtual Try-On | Code done and tested against mocks of the documented APIs; **not run live** (no keys here) |
| Realistic AI hairstyles | Google Cloud (Gemini image editing) | Code done, tested against a mock; **not run live** |
| Confirmation on real devices | Your phone + `?debug` | **Needed.** Turning, nodding, low light and real camera noise were not testable here |
| True nail outlines | A nail-segmentation model (none in MediaPipe) | Not available; geometric estimate used |
| Makeup that ignores a hand in front of the face | Face-skin class of the multiclass segmenter | Not done |
| Your own product photos | Transparent PNGs of your jewellery, garment photos you own | Waiting for you |
