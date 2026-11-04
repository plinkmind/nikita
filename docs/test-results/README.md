# Test screenshots
All from the automated tests (real MediaPipe models, fake camera). Debug dots: green = face landmarks, pink = ear-lobe points, blue = nose/neck points.
Photos: google-ai-edge/mediapipe-samples (Apache-2.0).

Backend (Update 9): `backend-*.jpg` come from `tests/e2e/fullstack.e2e.mjs` with a **mock** FASHN service (the result image is a
test colour block, not a real AI picture). They show the real flow: account, loading state, result, and "My looks" history
(one failed and one finished try-on).

Update 10: `3d-face-mask-vs-2d.jpg` - foundation, concealer, blush and highlighter on the scanned 3D test head (front, turn 20
and 34 deg, turn -46 deg, nod down 23 deg). Top row: the old 2D shapes (note the pink glow outside the face when nodding).
Bottom row: the new 3D face mask.

Update 11: `hair-occlusion.jpg` - real portrait, foundation + blush + brows: left without, right with the new hair/face
occlusion (the hair strand over the forehead keeps its real colour). `3d-jewellery.jpg` - the demo 3D jhumkas + pendant
necklace (top) and 3D hoops (bottom) on the scanned test head at front, turn 34 deg, turn -46 deg, nod down 23 deg, tilt 20 deg.

Update 12: `face-anchors-debug.jpg` - the full studio with `?debug` on the scanned test head (nod down, look up, tilt, close,
far, turn): yellow = named face anchors (eyes, brows, nose, lips, cheeks, jaw, chin, forehead), pink = ears, nostrils and neck
(faded when turned away), green dots = tracked face points, numbers at the bottom = the PHONE REPORT.

Update 13: `hair-colour-pipeline.jpg` - six shades on two real photos; in each block the columns are: before (binary mask +
flat tint), Update 11 (refined mask + flat tint), new (Hair Segmenter + protected mask + GPU recolouring with the real strands
and shine). `hair-colour-live.jpg` - the full live studio (fake camera, moving portrait), ash grey.

Update 14: `nails-before-after.jpg` - top row: real nails (no polish), previous nail overlay, new red, new nude; bottom row:
new French, chrome, almond shape. `nails-live-moving.jpg` - the full live studio (fake camera: the hand photo turning and
moving, mirrored selfie view) with red polish.

Update 15: `3d-jewellery-neck.jpg` - 3D jhumkas and the 3D necklace (now a loop around the neck, the back hidden by the neck)
on the scanned test head: front, turn 34 deg, turn -46 deg (far earring hidden behind the head), nod down, body turned, tilt.

Update 16: `step7-garment-cutout.png` - synthetic garment photos (striped and printed tee) on wood, cobblestones, trees, a street
and a checkerboard: photo, then the cut-out on a pink check (what was kept). `step7-outfit-pose.png` and `step7-outfit-portrait.png` -
the live outfit on two real photos at 6 framings (near, middle, far, shifted, tilted): left the previous flat garment, right the new
body-following warp. `step7-outfit-poses.png` - the warp on synthetic poses (red: body points; grey: where the arm is drawn back).
