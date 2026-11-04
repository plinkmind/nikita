# Tracking audit

## Update 16 (latest): Step 7 - body tracking and outfit try-on
Changed: `src/tryon/outfit.js` (garment photo preparation, drawing), new `src/tryon/garmentcut.js` (busy-background cut-out),
new `src/tryon/render/garmentwarp.js` + `garmentgl.js` (body-following garment), `src/tryon/track/mediapipe.js` (person mask
from the pose model), `src/tryon/studio.js` (person mask, passes it to the outfit; one wording change in the upload note).
Not changed: face, hair, nails, makeup, jewellery, backend, website UI, the AI photo try-on.

**Two outfit modes, and what each one is:**
- **A. Live camera preview** (Outfits tab, "My clothing photo"): your garment photo bent onto your body in real time. It is a
  2D picture warped onto a simple body shape. It is **not** a 3D garment or cloth simulation: no drape, gravity, wrinkles of
  its own or back side, and a front-view photo cannot show what a garment looks like from the side.
- **B. AI photo try-on** ("See It On You"): unchanged. A real AI virtual try-on model (FASHN, paid, through the backend; or the
  free IDM-VTON demo in the browser) makes a new photo of you wearing the garment. That is the realistic mode.

**Body tracking: MediaPipe Pose Landmarker** (lite on phones, full on computers; 33 body points with visibility and depth). Kept.
It gives shoulders, elbows, wrists and hips, which is what a front-view garment needs; it now also outputs a **person mask** (body
outline). Cost of the mask, measured (`test=posecost`, CPU): pose model 50 -> 56 ms median (+12%), reading the mask back 0.2-4 ms.
It is only loaded while an outfit is applied.

**1. Garment background removal.** Before: only a plain background (flood fill from the edges); any other photo kept its
background. Now a second method runs on every photo: colour models of garment and background (k-means in Lab colour, background
from the border, garment from the middle), a graph cut (max-flow) so the cut follows real edges, a symmetry prior (garment photos
are front views), background shadows counted as background, then the edge refined at full size with a guided filter. The two are
merged: the flood fill result minus what the colour models call clearly background, plus what they call clearly garment.
Test: 48 synthetic garment photos (6 garments incl. stripes and a print x 8 backgrounds incl. wood, bed sheet, gradient, a
checkerboard and 3 real street photos), true outline known (`tests/run.mjs "test=garment"`):

| Cut-out accuracy (IoU, 1 = perfect) | Before | After |
|---|---|---|
| Plain backgrounds (white, checkerboard), median | 0.82 | **0.99** |
| Plain backgrounds, worst | 0.31 | 0.56 |
| Busy backgrounds, median | 0.27 (nothing removed) | **0.99** |
| Busy backgrounds, worst | 0.00 | 0.75 |
| Background left, busy (share of garment area) | 1.54 | **0.03** |
| Time per photo (once, on upload) | - | 0.29 s median, 0.65 s worst (sandbox CPU) |

Hardest cases (IoU below 0.9): a white-striped shirt on a white or light background (the soft shadow stays), vertical stripes on a
checkerboard, a beige shirt on a beige gradient, a charcoal shirt on dark street clutter. A garment worn by a person in the photo
is not separated from the person.

**2. Garment placement and deformation (render/garmentwarp.js).** The photo is measured once (collar, shoulder width, armpits,
sleeve directions, width per row) and cut into a 30 x 40 mesh. Every frame each mesh point is moved: the torso onto a turned
cylinder whose width follows shoulders, waist and hips (half way between the garment's own width and the body's, so loose
garments stay loose; below the hips the garment keeps its own shape), tilted with the shoulder line and bent along the torso
axis; each sleeve turns with the upper arm and a long sleeve bends at the elbow; left/right body turn from the shoulders' depth.
Synthetic poses (`test=outfitgeo`: arms down, out, up, akimbo, crossed, leaning, turned; two body sizes):

| | Result |
|---|---|
| Sleeve direction vs upper arm | 1.8-3.6 deg (arms down, akimbo, crossed, lean, turned); 11 deg arms out; 17 deg arms up |
| Garment shoulder vs outside of the body's shoulder | 0.06 shoulder widths (0.07 turned) |
| Folded-over mesh area | 0-2% (worst: arms raised) |

**3. Colours, light, occlusion (render/garmentgl.js).** Before, the camera picture was blended in with soft-light, which shifts the
garment's colours and shows what you wear underneath. Now only brightness is applied: soft folds and shadows from the picture as a
ratio (big brightness steps such as your own neckline or straps are left out), body curvature, room exposure and colour cast from
the face light estimate. Above the hips the garment is kept inside the person mask; arms beyond the sleeve end are put back from
the camera picture (cut to the person mask); face, jaw line and hair stay on top as before. Two real photos, 6 framings each
(near, middle, far, shifted, tilted both ways; `test=outfit`):

| | pose.jpg flat (before) | pose.jpg warp (new) | portrait.png flat | portrait.png warp |
|---|---|---|---|---|
| Garment outside the body outline, above the hips | 15.4% | **4.7%** | 16.1% | **2.7%** |
| Forearm skin covered by the garment | 12.7% | **9.6%** | 12.8% | **3.4%** |
| Colour change vs the garment photo (Lab chroma) | 4.8 | **2.2** | 5.6 | **3.2** |
| Brightness change (Lab L) | -5.3 | -1.4 | -1.5 | -0.7 |
| Draw time per frame (sandbox, software GPU) | 0.2 ms | 2.1 ms | 0.1 ms | 2.2 ms |

Steadiness (a still person, camera noise, 30 frames, `test=outfitjitter`): outline change per frame 0.16% (flat) vs 0.16% (warp)
on pose.jpg; 3.6% vs 1.5% on portrait.png (the warp needed extra smoothing of the turn angle, hips and elbows to get there; big
moves are followed at once). Full studio with a fake camera (moving body video): warp renderer and person mask active, no errors.

Remaining limits: not tested on a real phone or with a real person moving; one body photo and one portrait only (no standing
full-body test photo in the sandbox); the "person mask" metric uses the same model's mask as the renderer; arms raised above the
shoulders tear the sleeve seam a little; the turn angle comes from the pose model's depth, which is rough; garments are assumed to be
tops/dresses photographed from the front (trousers are not mapped to legs); the person's own clothes can still show faintly
through soft folds; the mirror view shows the garment photo as it is (a logo is not mirrored).

## Update 15: Step 6 - jewellery and 3D accessories
Changed: `src/tryon/jewellery.js` (neck anchor), `src/tryon/render/jewellery3d.js` (3D necklace, body turn), `src/tryon/track/head.js`
(ear visibility only - face landmarks and head pose unchanged). Jewellery designs unchanged.

**Earrings - why they cannot land on the cheek, nose or mouth:** each ear lobe is a separate fixed point on the fitted 3D head
(right and left), moved only by the head's rotation, size and position; it is never taken from a face landmark. Measured on the
3D test head with webcam-like jitter (`node tests/rig/jewel.mjs`): ear error 0.32-0.67 cm median per movement (turns, nods,
tilts, moving closer/farther, light, body turns), 95th percentile 0.45-1.29 cm; still jitter 0.22 px per frame.

**New: ear visibility along the camera's line of sight.** A head that is beside the middle of the picture is seen slightly from
the side, so its far ear disappears earlier. Before, visibility only used the head's own turn. Test with the head moved toward
the picture edges, up/down, and turned (`tests/rig/run.mjs "test=partial"`, 11 positions x 2 ears): earring shown exactly when the
real lobe is visible in **20 of 22** cases (before: 17 of 22). Hidden earrings fade out (and in 3D the head hides them per pixel).

**Necklace - neck anchor.** The body model's two shoulder points are often uneven, which shifted the necklace sideways by about
2 cm even with a still head. The neck base now takes its sideways position halfway between the shoulders and the head's own
neck estimate, and its height 3/4 from the shoulders (fitted and checked on the test head, `tests/rig/eval.mjs`):

| | Before | After |
|---|---|---|
| Neck error, median (all movements) | 1.93 cm | **1.05 cm** |
| Neck error, 95th percentile | 3.31 cm | 3.06 cm |
| Still head | 2.07 cm | 0.97 cm |
| Head turn (worst case) | 2.44 cm | 2.67 cm |
| Necklace still jitter | - | 0.34 px per frame |

**3D necklace (render/jewellery3d.js).** It is now a closed loop of beads AROUND the neck, front lower than the back, with an
invisible neck (cylinder) in the depth buffer: the chain goes behind the neck instead of ending in mid-air at the sides, the chin
still covers it when looking down (face mesh in the depth buffer), and it turns with the BODY (shoulder depth from the body
model), not with the head. Earrings: unchanged design, hung from their lobe anchors, swinging, turning with the head, hidden by
the head ellipsoid when the ear goes behind it. Lighting from the room light estimate, metal + gem materials, room reflections.

Remaining limits: real ears differ by about +-1 cm between people (no ear landmarks exist); the necklace error is largest while
the head turns (2.7 cm median) because neither the head nor the shoulders show the neck base directly; necklaces are drawn over
clothing (a real necklace is worn over clothing too) but not tucked under a collar or hidden by long hair; no phone test.

---

## Update 14: Step 4 - hand and nail tracking
Changed: new `src/tryon/track/hands.js` (hand tracking moved out of the studio and improved), `src/tryon/nails.js`
(placement, hiding, rendering), `src/tryon/studio.js` (uses the new hand tracker). Face and hair code unchanged.

**Model:** MediaPipe Hand Landmarker stays (21 points per hand in the picture + the same 21 points in 3D metres, left/right
label, 2 hands, GPU in the browser, free). It is the standard free browser model; there is no free nail-segmentation model to add.

**Test bench** (`tests/run.mjs "test=nailmotion&img=hand1.jpg"`): real hand photos moved with known transforms (side to side,
up and down, wrist rotation +-29 deg, closer/farther 0.7x-1.3x) with camera noise, the real Hand Landmarker on every frame; the
nails of the still picture, moved by the known transform, are the truth. Errors in nail lengths. Scenarios: normal, 15% missed
frames, 20% of frames with the left/right label flipped, 3% wrong detections; three speeds.

| Photo, scenario (normal speed) | Before: 95th % / worst | After: 95th % / worst | Nails flickering on/off |
|---|---|---|---|
| hand 1, normal | 0.16 / 0.23 | 0.16 / 0.23 | 0 -> 0 |
| hand 1, missed frames | 0.27 / 0.54 | 0.18 / 0.42 | 0 -> 0 |
| hand 1, left/right label flips | **1.09 / 3.32** | 0.17 / 0.25 | **20 -> 4** |
| hand 1, wrong detections | 0.17 / **1.85** | 0.17 / 0.69 | 0 -> 0 |
| hand 2, missed frames | 0.55 / 1.02 | 0.37 / 0.54 | |
| hand 2, wrong detections | 0.37 / **4.69** | 0.35 / 1.98 | |
| very fast moves (3x speed), all scenarios | | equal or better than before | |

**Placement on the real nails** (hand photo, 4 nails marked by hand): average distance from the real nail centre 13.3 px
(previous) -> **6.3 px** (at 720p); nail length and width closer to the real nails.

What changed:
1. **Hand identity by position**, left/right label voted over recent frames - a single wrong label no longer swaps nails
   between hands or flips which side of the finger is the nail side.
2. **Missed frames:** the hand keeps moving with its measured speed for up to 0.2 s.
3. **Jump guard:** a detection far from where the hand can be is held for ONE frame; it is accepted as soon as the next frame
   agrees (a real fast move), dropped if the next frame is back where the hand was expected. Faster hands get more room.
4. **Nail placement:** nail plate moved toward the fingertip and runs slightly past the model's fingertip point (which sits
   inside the fingertip); width 0.54 of the knuckle spacing.
5. **Confidence-based hiding:** a nail is hidden when it faces away (3D), is seen edge-on, is cut by the picture edge, is covered
   by another finger of the same hand that is nearer to the camera (fists, crossed fingers), or when the hand was seen in only
   one frame.
6. **Rendering:** nail-shaped mask (square, round, almond, coffin, stiletto) mapped with the finger's 3D orientation (perspective),
   edges softened in proportion to the nail size on screen, curved-plate shading (side walls, cuticle line, lighter free edge),
   gloss = soft broad shine + sharp core on the side facing the room light (light estimate), matte = no shine, the real nail's
   light and shade blended in. Designs unchanged (solid, French, glitter, ombre, chrome).

Remaining limits: the nail outline is still estimated from finger geometry (no nail-segmentation model), so long natural nails
or very short nails are drawn at an average size; placement was checked on one photo with visible nails (curled fingers) - an open
hand with the back facing the camera, the usual try-on pose, could not be tested with ground truth here; real phones not tested.

---

## Update 13: Step 3 - hair segmentation and hair colour
Changed: `src/tryon/hair.js`, new `src/tryon/render/haircolor.js`, `src/tryon/render/masks.js` (head-connected hair only),
`src/tryon/track/mediapipe.js` (hair model), `src/tryon/studio.js` (hair wiring only). Face tracking, makeup, nails, jewellery
and outfits unchanged (makeup's hair occlusion uses the same mask, so it now uses the hair model too).

**A. Hair colour try-on (live).** Pipeline per camera frame:
1. **Model: MediaPipe Hair Segmenter** (deep-learning, 512x512 input, 0.8 MB) instead of the selfie multiclass model
   (256x256, ~16 MB). Twice the input detail for hair and 20x less to download on a phone. Face, ears and neck are separated
   with the face tracker instead of the multiclass skin classes (`VITE_HAIR_MODEL=multi` switches back).
2. **Pixel mask:** labels -> soft mask -> guided filter against the camera picture (edges follow real strands) -> smoothing over
   time with the previous mask moved with the head (Update 11).
3. **Only hair attached to the head:** pieces of "hair" that do not touch an ellipse around the face are removed (trees, dark
   clothes, shadows the model mistakes for hair). Long hair is kept as long as it is connected.
4. **Follows the head:** the mask is moved to the current frame with the head's position, size AND rotation since the
   segmenter last ran (from the eye corners), because on phones the segmenter does not run on every frame.
5. **Same frame:** the segmenter now reads the exact picture that is drawn (not the live video, which may already show a newer
   frame) - in the live test this removed a pale patch on the forehead while moving.
6. **Protected:** eyes, eyebrows and lips never get hair colour; inside the face outline the mask must be more certain
   (fringe yes, forehead no) and bright skin-coloured pixels are left alone.
7. **Recolour on the GPU** (WebGL shader): new brightness = shade brightness + the pixel's own difference from the average hair
   brightness (limited contrast gain, soft roll-off near white and black), shade colour + 10% of the pixel's own colour
   variation, shine (bright, unsaturated) kept. 2D fallback without WebGL.

Outdoor photo (light hair, busy background): face-skin colour 0.05 (Update 11) -> 0.00, halo 6.0 -> 3.9, flicker 0.123 -> 0.042.

Measured on two real photos (studio portrait with short dark hair; outdoor photo, light hair, busy dark background), real
Hair Segmenter + Face Landmarker, 6 shades (`tests/run.mjs "test=hairc"`). "Before" = binary mask + 2D tint (before
Update 11), "Update 11" = refined mask + 2D tint (what was live until now), "new" = this pipeline.

| Measure (portrait, average of 6 shades) | Before | Update 11 | New |
|---|---|---|---|
| Colour on face skin below the brows (lower = better) | 0.14 | 0.45 | **0.12** |
| Halo on the white background next to the hair | 0* | 1.35 | **0.31** |
| Strand texture kept (1 = all) | 0.998 | 0.991 | 0.972 |
| Hue error vs the shade | 1.2 deg | 1.3 deg | 2.0 deg |
| Lightness reached, platinum on dark hair (target L 88) | 66.6 | 66.2 | **71.1** |
| Mask flicker on a still, noisy picture | 0.030 | - | **0.008** (refined) |
| Mask match while moving, segmenter every 3rd frame (IoU): not moved / moved / moved + turned + scaled | | 0.40 / 0.69 | **0.72** |

\* "Before" cannot show a halo in this measure: the background ring is defined from its own hard mask.

Texture numbers measure correlation of fine detail; the old 2D tint keeps it numerically because it paints a nearly uniform
colour over the hair while keeping the original pixel variation, which is exactly what looked flat and "painted". The new
shader rebuilds brightness and shine from the real hair, which is what makes it look like hair (compare
`docs/test-results/hair-colour-pipeline.jpg`). Under dim, warm and cool light the result stays within about 0-8 deg of the
shade's hue on the portrait (up to ~20 deg on the outdoor photo with warm light).

**B. Hairstyle try-on (AI).** Not live, by design: a 2D overlay cannot replace a hairstyle realistically, and the studio does
not pretend to. Hairstyles are generated from a photo in the AI Photo tab by an image-editing model on the backend (FLUX Kontext
on Replicate, paid, `REPLICATE_API_TOKEN`). Free alternative checked: HairFastGAN (AIRI research demo on Hugging Face, takes a
face photo plus a photo of the hairstyle to copy). It runs today, but has no stable API (no endpoint names, the work runs on the
lab's own server) and could not be tested from here, so it was not wired in.

Remaining limits: hair-coloured background touching the hair (dark trees next to dark hair) can still be coloured; very thin
flyaway strands are partly lost at the mask edge; dyeing very dark hair to platinum reaches L 71 of 88 (real dye has the same
problem, but the try-on cannot show bleach); no phone or real-camera test.

---

## Update 12: Step 2 - face tracking and 3D face mesh
Only the face tracker and face mesh changed (`src/tryon/track/head.js`, new `track/normals.js`, `render/facemesh.js` uses the
shared normals, debug view in `studio.js`). Hair, nails, makeup and outfit code were not touched.

**Technology decision.** MediaPipe Face Landmarker stays: it gives 478 points with depth (3D), runs on the phone GPU in the
browser, is free and is already measured here. The alternatives checked are either the same model underneath (TensorFlow.js
face-landmarks-detection, Human) or paid SDKs (DeepAR, Banuba). Its own head-pose matrix was not adopted: the studio's
canonical-face fit already gives the 3D pose, and a perspective version measured worse (Update 11).

**Test bench:** `node tests/rig/face.mjs` - the real Face Landmarker results of a scanned head with known ground truth
(30 face points, both ear lobes), with webcam-like jitter, under normal, missed-frame (15% of moving frames), wrong-detection
(3% of frames), 15 fps and mirrored conditions. Errors in cm on a real-size face.

| Measure | Before | After | Change |
|---|---|---|---|
| Still jitter | 0.444 px | 0.455 px | +2.5% (not visible) |
| Quick left-right move, 95th percentile | 0.68 cm | 0.53 cm | -22% lag |
| Quick up-down move, 95th percentile | 0.52 cm | 0.39 cm | -25% lag |
| Head turn / nod / tilt, 95th percentile | 0.94 / 0.69 / 0.35 cm | 0.95 / 0.69 / 0.30 cm | same / same / better |
| Closer and farther, 95th percentile | 0.33 cm | 0.32 cm | same |
| Lighting changes, 95th percentile | 0.38 cm | 0.38 cm | same |
| Missed frames: error on those frames (median / 95th) | 0.61 / 2.19 cm | 0.35 / 1.19 cm | -43% / -46% |
| Wrong detections: error on those frames (median / 95th / worst) | 1.78 / 7.62 / 9.56 cm | 0.26 / 1.08 / 3.58 cm | the jump is gone |
| 15 fps phone, quick left-right move, 95th | 0.68 cm | 0.55 cm | the guard does not hold back fast moves |
| Mirrored (selfie) view vs camera view | identical | identical | mapping correct |

What changed:
1. **Missed frames** (motion blur, a hand passing, a slow phone): the head keeps moving with its measured speed for up to
   250 ms (the speed is trusted less the longer the gap) instead of freezing while the real head moves on.
2. **Jump guard:** a detection far from where the head can be (more than 0.3 face widths, 11.5 deg or 15% size beyond the
   prediction per 1/30 s, allowed more on slower cameras) is held back for up to 2 frames. If it is still there on the 3rd
   frame it is real (a very fast move, or the face came back elsewhere) and the tracker jumps to it cleanly.
3. **Faster response:** the smoothing reacts sooner when the head starts to move (re-tuned on the bench, see the table).
4. **Named anchors** `M.anchor(name)`: earR/earL, eyeR/eyeL (+ inner/outer corners), browR/browL, noseTip, noseBridge,
   noseBase, nostrilR/L, lips, upperLip, lowerLip, lipCornerR/L, cheekR/L, cheekboneR/L, chin, jawR/jawL, jawLineR/L,
   forehead, neck. Each gives position, depth, surface direction, facing / visibility, size (px per cm) and roll. Named after
   the person's own side. Measured (median / 95th, cm): eyes 0.13-0.16 / 0.38-0.42, nose tip 0.20 / 0.50, lips 0.17 / 0.57,
   lip corners 0.16-0.17 / 0.50-0.58, cheeks 0.16-0.18 / 0.63-0.75, chin 0.24 / 0.71, ears 0.45 / 0.88; visibility agrees
   with the scan 90-100% of the time. `?debug` draws them with their names.
5. **3D face mesh**: it is built from the same tracked points, so it inherits all of the above (no frozen or jumping mesh on
   a bad frame); its surface directions now come from the shared `track/normals.js`.

Remaining limits: ear lobes and the neck are still estimated from an average head (about 0.45 cm median, 1 cm worst case for
real people whose ears differ); a turned head has the largest face error (0.95 cm at the 95th percentile, mostly the
detector itself: 0.95 cm unsmoothed); not run on a phone or a real person.

---

## Update 11: phases 1-5 of the approved AR plan
Plan and audit: the "Glamify Mirror Me - AR System Audit" document. Every phase was tested on the scanned 3D test head
(`tests/rig/`) and/or a real portrait photo, with the real MediaPipe models, in headless Chromium without a GPU.

| Phase | What was done | Measured result | Kept? |
|---|---|---|---|
| 1. Phone measurement | `?debug` now shows a PHONE REPORT line: frame time p50 / p95 over the last 120 frames, camera fps, CPU cores, memory, GPU name (also in `window.__glamify.perf`) | works (sandbox: p50 570-720 ms, software GPU - meaningless for phones) | yes |
| 2. Perspective head pose | Pinhole-camera fit (undo perspective, refit, project anchors with perspective), `tests/rig/persp.mjs` | **not better**: ear error median 0.45 cm flat vs 0.87 cm perspective (0.36 cm even with a re-fitted ear point); turn angle 2.6 -> 2.1 deg but nod 1.1 -> 1.5 deg. Face Landmarker's points behave like a flat projection | code kept, **switched off** (`FOCAL = 0`) |
| 3. Segmentation masks | `render/masks.js`: one segmenter result -> hair mask + face occluder, refined with a guided filter against the camera picture, smoothed over time with the previous mask MOVED with the head (no ghost) and weighted less when the head moves. Makeup is put back to the real picture where hair, a hand or an accessory covers the face (eyes and brows excluded). Long hair stays in front of the garment | portrait: foundation no longer tints the hair strands over the forehead (`docs/test-results/hair-occlusion.jpg`); refinement 16 ms (computer size) / 12 ms (phone size) in the sandbox; first version left a hair-colour "ghost" when moving, fixed by moving the previous mask with the head | yes (`?occ=0` turns it off) |
| 4. Light estimate | `render/light.js`: light direction from skin brightness vs. the 3D mask's surface directions (3 rounds, shadowed points and the brightest 8% shine left out), colour cast and exposure from the whole picture. Used by metal shading, jewellery colour, gloss and nail shine, 3D jewellery | direction error on the rig: **5.6 deg** average facing the camera (max 11.5), **17.5 deg** with the head turned 26 deg (max 21). Colour cast and exposure could not be checked: the rig's background is not lit by its lamp | yes |
| 5. 3D jewellery (demo) | `render/jewellery3d.js` (Three.js, loaded only when a 3D piece is applied): 3D studs, hoops, jhumkas, gem drops and a pendant necklace built in code, metal + gem materials, room reflections, lit by the light estimate; face mesh + head shape in the depth buffer hide the far earring and let the chin cover the necklace; hanging pieces swing and hang with gravity. GLB product files supported (`model:` in the catalogue entry) | rig at front, turn 34 deg, turn -46 deg, nod 23 deg, tilt 20 deg: pieces stay on the lobes, the far earring is hidden behind the head when turned (`docs/test-results/3d-jewellery.jpg`) | yes, new "3D jewellery (demo)" group |
| 6. Worker | not started: needs your phone's PHONE REPORT numbers first | - | - |

Limits that remain: ear lobes and the neck are still estimated (no landmarks for them exist); no nail segmentation; the
light estimate is a direction, not a full environment; the 3D pieces are demo designs until real GLB product models exist;
nothing here was run on a phone.

---

## Update 10: full re-audit, 3D face mask, category pipelines
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
