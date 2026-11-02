# Fix report: tracking, jewellery, makeup, nails, hair, outfits

Everything below was tested on **simulated data** (a synthetic 3D head, hand and body, and a fake camera). I could not use a real face, hand or
phone, so **I have not confirmed these fixes on your device**. Where a number is given it comes from `TESTING-REPORT.md`.

## 1. Earrings: root cause and fix
**Root cause (from the code):** earrings were placed from 2D face-outline points (234 and 454) plus a fixed 2D offset. The ear is not part of the face mesh. When the head turns, the contour point on the far side slides across the face, so the far earring was drawn on the cheek, mouth or nose. Whether to hide it was decided by a weak 2D "turn" number. Earrings also tilted with the head instead of hanging down.
**Fix:**
- A real 3D head frame is built from the landmarks' depth (`headpose.js`). The ear is placed outside, below and behind the cheek point along the head's own axes.
- An ear hidden by the turned head is **not drawn at all** (it is never moved to another landmark). Visibility fades smoothly, so it does not blink.
- Earrings hang under gravity and swing slightly when the head moves.
- Jewellery size comes from the true head width, so it keeps its size when the head turns.
**Measured on the synthetic head (144 truly hidden ears):** old method drew 64 of them (44%); new method draws 0. Visible-ear position error is about 40% smaller (0.05 vs 0.09 face widths on average). End to end through the studio: no earring pixels on the face centre at 0 to 60 degrees, also while looking down, also with a wrong reading every 7th frame.
**Not confirmed:** the real ear anatomy and the real accuracy of the model's depth values. An earring may still look a little too high or low on a real ear. `?debug` shows the head turn and nod, so I can adjust from your screenshots.

## 2. Makeup flicker
I could not reproduce your flicker without your device, so these are the causes I found in the code and fixed:
- Landmark jitter fed straight into the makeup shapes. **Fixed:** makeup uses its own calmer smoothing profile (still jitter about 25% lower than the base profile in the simulation, at the cost of slightly more lag).
- The face model gave up on a moving face too easily (confidence settings 0.5). **Changed** to 0.4 / 0.3 / 0.3.
- Short dropouts caused disappearing makeup. **Fixed:** the last good position is held for 0.2 s with no fading, then fades over 0.1 s. Test: a 120 ms dropout produced no dip.
- Bad single readings (a face jumping or changing size between two pictures) moved the makeup. **Fixed:** glitch guard rejects them. Test: with a wrong reading every 7th frame, the lipstick centre moved about 2 pixels.
- Detection ran on duplicate camera pictures, wasting time. **Fixed:** once per new camera picture.
- Several models ran at once and competed for the GPU. **Fixed:** at most one extra model (hands, body or hair mask) runs per camera picture, in addition to the face model.
**Not fixed:** makeup is still painted over a hand or hair that covers the face; lip and eye colours are not adapted to room lighting. **Still unknown:** whether your flicker is dropouts (camera model) or something else. `?debug` now counts "face dropouts" and "glitches rejected".

## 3. Hair
A live flat hairstyle can never look like real hair, so **the cartoon-like live hairstyles and bangs were removed**. What remains live is **hair colour on your real hair** (a hair mask recolours the actual hair and keeps its light and shadow). Hairstyles are created in the **AI Photo** tab (Gemini image editing, general image editor, no identity guarantee). The Hair tab has a button that takes you there.

## 4. Outfits
The drawn cartoon-like garments were **removed**. Live outfit now means **your own garment photo** placed on your shoulders and torso (real fabric and print, but not bent around your body, and your arms are not drawn in front of it). The realistic option is the **AI Photo** tab (Google Virtual Try-On). Why Google's model: IDM-VTON, CatVTON and OOTDiffusion are non-commercial licences (see `TRYON-MODELS.md`).

## 5. Nails
- **Perspective:** nail width now comes from the true 3D finger length and nail length from the length seen in the picture, so when a finger points toward the camera the nail gets shorter but not thinner, and it disappears when seen edge-on (tested with fingers tilted 0 to 75 degrees).
- **Spill:** nails are narrower than the finger (about 80% of its width on my test finger; real fingers not measured).
- **Blend:** polish is multiplied into the picture first (so the real nail's light and shade show through) and then laid on top at partial opacity.
- Left and right hands are tracked separately; readings below 0.6 confidence are ignored.
**Not fixed:** there is still no true nail-plate segmentation, so the nail outline is an estimate from the finger bones, and the "back of the hand" detection has never been tested on real hands. A nail-segmentation model would be the real fix.

## 6. Tracking engine
Different smoothing for different features (base profile for anchors, calm profile for makeup; hands keep the base profile because nothing I tried beat it in the simulation), depth is filtered, glitch guard, in-frame confidence, graceful loss, scheduler, `?debug` diagnostics. See `TRACKING-AUDIT.md`.

## 7. What still needs external models or services
| Need | What | Status |
|---|---|---|
| Realistic outfits | Google Cloud Virtual Try-On (paid, retires 20 Jan 2027) | Server and page built, **not run live** |
| Realistic hairstyles | Gemini image editing on Google Cloud (paid) | Server and page built, **not run live** |
| Real 3D head pose from the model (better turn and nod) | Turn on the face model's pose matrix | Not done |
| True nail outlines | A nail-segmentation model | Not done |
| Makeup that ignores hands and hair | Face-skin mask from the segmentation model | Not done |
| Photoreal jewellery | Your transparent product PNGs (see `REFERENCE-PHOTOS.md`) | Waiting for images |
