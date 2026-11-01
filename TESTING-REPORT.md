# Testing report

**Read this first.** The environment these tests ran in has no real camera, no internet, no phones and no Google credentials.
So the tests prove that **our code behaves correctly on simulated data**. They do **not** prove that tracking looks good on a real
face, hand or body, or that Google's live service accepts the requests. Real-device testing is still to be done by you.

## What was tested and how

| Area | Method | Result |
|---|---|---|
| Smoothing quality | Simulated head motion with camera noise (still, slow sway, fast sway; 30 and 60 fps), old filter vs One Euro | At 30 fps: still jitter 3.0 -> 2.0, slow-motion error 12.5 -> 9.3, fast-motion error 13.2 -> 8.3 (thousandths of a face width). At 60 fps the fast-motion error was **worse** (11.9 -> 19.3); cameras at 60 fps are not covered by the tuning. |
| One analysis per camera frame | Chromium with a fake camera, counted face-model calls | About 61 screen redraws vs about 20 model runs per second. |
| Tracking loss | Fake tracker switched off | Jewellery is gone within 0.3 s (fade logic in place); message shown; returns when the face returns. |
| Face partly outside the picture | Fake tracker shifted out of frame | Face items hidden, message "Move back a little so your whole face is in the frame", back when in frame. |
| Server (`server/test.mjs`) | 29 automated checks against a **mock Google** | 29/29 passed: consent required, JSON/format/size/type validation, no prompt injection (hairstyle sent as an id), CORS, RS256 service-account signature verified with the public key, request URL and body match Google's documented format, retry after 429, quota/permission/empty/timeout errors, rate limit, busy limit, results deleted after delivery, honest "not configured" answer. |
| AI Photo tab (browser, real server + mock Google) | Playwright | Without a server: clear message and disabled button. With a server: button disabled until photos and consent; **no photo is sent before the button is pressed**; real elapsed-time display; result tagged AI-GENERATED; original/AI toggle; save to Saved; hairstyle mode works; no page errors. |
| Whole studio with simulated trackers | Playwright, fake camera, simulated face/body/hand/hair data | Hair, outfit, nails, jewellery applied together and saved: no errors at 320x700, 390x844, 768x1024, 1366x768, 1920x1080. Earlier rounds also covered 360x800, 430x932, 1024x1366 and a sideways phone. |
| Layout | Measured overlap and sideways scrolling | No overlap, no sideways scrolling. |
| Imports | Static check that every `import` resolves to a real export | 0 problems in 13 files. |

## Your checklist (Part 11)

| Item | Status |
|---|---|
| Different face angles, head movement | **Not tested** (no real camera). Known limit: turn is a 2D estimate, no nodding (audit item 6). |
| Different lighting, skin tones, hair colours | **Not tested.** No lighting adaptation exists (audit item 11). |
| Different body poses, hand positions, finger movement | **Not tested** on real people. Only synthetic landmark layouts. |
| Camera mirroring | Tested in code paths with the fake camera (mirrored). Rear camera **not tested**. |
| Android Chrome, iPhone Safari, iPad | **Not tested.** |
| `npm run build` | **Not run** for this round (no internet to install packages). Imports and syntax were checked statically. Please run it. |
| Live Google API calls | **Not run.** |
| "Is it better than before?" | **Measured only for smoothing and wasted work** (above). Realism of hair, outfits and nails on real people is **not measured**. |

## Feature status

| Feature | Status |
|---|---|
| Tracking foundation (filter, once-per-frame, confidence, fade, debug overlay) | Done, simulated-tested |
| Jewellery, makeup | Improved earlier; makeup occlusion not done |
| Nails | Landmark-based approximation, not a nail-segmentation model |
| Live hair styles | Stylised overlay (cannot be realistic); hair **colour** uses real hair mask |
| Live outfits | Basic overlay |
| AI photo outfit try-on (Google Virtual Try-On) | Server and UI done, **needs your Google Cloud setup**, not run live |
| AI photo hairstyle (Gemini image editing) | Server and UI done, **needs your Google Cloud setup**, not run live; general image editor, no identity guarantee |
| 3D head pose (pitch/yaw from the model's matrix) | **Not done** |
| Shop & Try On (Amazon/Meesho/Myntra), style assistant, accounts | **Not done** |
