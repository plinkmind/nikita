# Test screenshots
All from the automated tests (real MediaPipe models, fake camera). Debug dots: green = face landmarks, pink = ear-lobe points, blue = nose/neck points.
Photos: google-ai-edge/mediapipe-samples (Apache-2.0).

Backend (Update 9): `backend-*.jpg` come from `tests/e2e/fullstack.e2e.mjs` with a **mock** FASHN service (the result image is a
test colour block, not a real AI picture). They show the real flow: account, loading state, result, and "My looks" history
(one failed and one finished try-on).

Update 10: `3d-face-mask-vs-2d.jpg` - foundation, concealer, blush and highlighter on the scanned 3D test head (front, turn 20
and 34 deg, turn -46 deg, nod down 23 deg). Top row: the old 2D shapes (note the pink glow outside the face when nodding).
Bottom row: the new 3D face mask.
