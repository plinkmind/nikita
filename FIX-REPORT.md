# Update 8: free AI try-on + live tracking speed fixes
- **Free mode** for "See It On You" (no key, no cost): public IDM-VTON demo on Hugging Face, called from the visitor's browser.
  Limits: shared queue, small daily quota per visitor, upper-body garments best, **non-commercial licence**. Paid FASHN is used
  automatically when `FASHN_API_KEY` is set. Details: README section N.
- Checked options: Gemini image API has no free tier (paid only); the Kolors try-on demo has its API switched off; IDM-VTON's demo
  exposes a public API. Tested against an exact local copy of its interface (36/36 browser checks, plus the "not reachable" path).
- **Live tracking:** exact new-frame detection (frame callback), automatic load saving, hand occlusion only for confirmed hands,
  richer `?debug`. Regression-tested: earrings, lipstick and nails still track in the studio tests.

---

# Update 7: "See It On You" AI virtual outfit try-on (photo based)
New separate experience (header button **See It On You** and a button on the last chapter); the live camera mirror is unchanged.
Model: **FASHN tryon-v1.6** through the site's own Netlify Function (key stays on the server). Setup: README section M.

Tested here (README M "Test it locally"): the real built site + the real function code, with FASHN replaced by a local mock
(no key and no access to FASHN from this environment), in headless Chromium at 1440x900, 820x1180 and 390x844:
38/38 checks pass: open, health check, rejects non-images and too-small images, previews, consent gate, clothing type sent,
real stage + elapsed time while waiting, result shown, before/after drag, download, try another outfit, start over, no sideways
scrolling, and the honest "not switched on" state without a key. Backend: 15/15 (`tests/functions.test.mjs`).
**Not tested:** a real FASHN generation (needs your key). Your first real try is the live test.

---

# Update 6.1: fixes from your screen recording (2 Nov)

I went through your 2 min 44 s recording frame by frame. What it showed, why, and what changed:

| What the recording showed | Cause | Fix | Checked |
|---|---|---|---|
| **The T-shirt photo sat over your head**, with your face showing through an oval hole, and a big white box around it | (1) The garment photo's white background was not removed: the dark strip at the top of the screenshot made the background check fail. (2) Size came from the whole photo, not the garment, so the white margins were stretched over you. (3) Nothing stopped a wrong body reading from putting clothes above the chin. | (1) Edge strips (screenshot bars) are removed first; the background colour is taken from the whole border; two-tone checkerboards work; the cut stops at faint garment outlines; only the largest piece is kept (stray icons dropped). (2) The garment's own shoulder width and top (ignoring a hanger) are measured and matched to your shoulders. (3) A garment is cut off along your jaw line, so it can never cover the face; body readings whose shoulders are not below the chin (or are implausibly wide/narrow for your face) are ignored. | The garment photos you sent cut out (6 shown; the watermarked tee is not included) (`docs/test-results/garments-cutout.jpg`); navy and floral dresses sit on the model's shoulders. White-on-white (white tee on white backdrop) still loses a faint sleeve: use a contrasting background. |
| **Earrings and the necklace were drawn on top of your hand** when it passed in front of your face | Nothing knew where the hand was unless nails were applied. | On computers, the hand model now also runs (every 2nd frame) when makeup or jewellery is on, and the real hand is drawn back on top of face items and clothes. On phones this happens when nails are on (to save battery). | Test: the hand holding glasses now appears in front of the necklace (`docs/test-results/hand-in-front.jpg`). |
| **Primer made the face look smeared** | Blur at 1/7 resolution, 85% opacity. | Light smoothing (1/3 resolution, 38% opacity, soft edge). | Visual check. |
| **Foundation left a line between face and neck** | Hard-ish mask edge, high coverage. | Much wider soft edge; mostly a tone shift, little coverage. | Visual check. |
| **Blush looked like two red discs** | Round shape, strong multiply, placed low. | Soft oval from the apple of the cheek up along the cheekbone, lower strength. | Visual check (`docs/test-results/makeup-natural.jpg`). |
| **Eyeliner too thick, long wings; mascara spiky** | Constant thick line; long straight lash strokes. | Tapered liner (thin inside, thicker outside, short flick); mascara darkens the lash line plus fine short curved lashes. | Visual check. |
| **"Loading hand tracking" darkened the whole camera view**; "show your hand" hint stayed up on other tabs | Loading used the full-screen message; hints were not tab-aware. | Loading shows as a small note; hand/shoulder hints only on the Nails/Outfits tabs. | Visual check. |

What looked GOOD in your recording and was not changed: earrings staying on the ears while you moved, nails on the back of the hand
(including the French manicure), lipstick, hair colour.

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
