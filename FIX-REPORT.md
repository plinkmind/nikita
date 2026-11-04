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
