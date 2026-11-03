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
