# Glamify XR (Responsive Version)

One website, one codebase. The same page adapts to phones, tablets, laptops and desktops.
Built with Vite, Three.js and MediaPipe Face Landmarker, plus a backend (accounts, AI try-on, history) in `backend/`.

> **Start here for the current version: section O (backend).** Sections I and K describe an older separate AI server
> (`server/`) that has been **replaced** by the new backend.

---

## A. Run it on your computer (step by step)

### 1. Extract the ZIP
Right-click `Glamify-XR-Responsive.zip` and choose **Extract All** (Windows) or double-click it (Mac).
You will get a folder called `Glamify-XR-Responsive`.

### 2. Install Node.js (one time only)
1. Go to https://nodejs.org and download the **LTS** version.
2. Install it with the default options.
3. Check it worked. Open a terminal (see step 3) and type:
   ```
   node -v
   ```
   You should see a number like `v20.x.x` or higher.

### 3. Open the project in VS Code
1. Install VS Code from https://code.visualstudio.com if you don't have it.
2. Open VS Code, then **File > Open Folder...** and choose `Glamify-XR-Responsive`.
3. Open the terminal inside VS Code: **Terminal > New Terminal**.

### 4. Install the dependencies (one time only)
```
npm install
```
This downloads Three.js, MediaPipe and Vite. It can take a minute. A `node_modules` folder will appear. That is normal, and you never need to upload it anywhere.

### 5. Start the website
```
npm run dev
```
Your browser opens at `http://localhost:5173`. Press `Ctrl + C` in the terminal to stop it.

---

## B. Test it on a phone

1. Connect your phone to the **same Wi-Fi** as your computer.
2. Run `npm run dev`. The terminal prints a line like `Network: http://192.168.1.25:5173/`.
3. Type that address in your phone's browser.

This is enough to check the layout, scrolling and 3D scene.

**Important: the camera will NOT work on that address.** Phones only allow camera access on secure pages (`https://`). `http://192.168...` is not secure, so you will see the message *"Camera needs a secure page"*. This is a browser rule, not a bug.
To test the camera on a phone, deploy to Netlify (section D). Netlify gives you an `https://` address.
On a computer, `http://localhost:5173` counts as secure, so the camera works there.

### Giving camera permission
- **Chrome (Android / desktop):** tap **Allow** when asked. If you tapped Block by mistake, tap the lock or camera icon in the address bar > **Permissions** > **Camera** > **Allow**, then press **Start Camera** again.
- **Safari (iPhone / iPad):** tap **Allow**. If you blocked it: **Settings > Safari > Camera > Ask** (or Allow), reload, press **Start Camera**.
- The camera only starts after you tap **Try It On**. It stops when you close the studio, lock the phone or switch tabs.

---

## C. Build the production version
```
npm run build
```
This creates a `dist` folder with the final website. To preview it:
```
npm run preview
```

---

## D. Put it on Netlify

### Option 1: drag and drop (easiest)
1. Run `npm run build`.
2. Go to https://app.netlify.com/drop (log in).
3. Drag the **`dist`** folder onto the page. Done.

If your site `glamify-xr` already exists: open it in Netlify > **Deploys** > drag the `dist` folder into the "Drag and drop" area.

### Option 2: connect GitHub (updates automatically)
1. Upload this folder to a GitHub repository (`node_modules` and `dist` are ignored automatically).
2. In Netlify: **Add new site > Import from Git**, choose the repository.
3. Settings are already read from `netlify.toml` (build command `npm run build`, publish folder `dist`). Click **Deploy**.

---

## E. What was changed (plain language)

**Try-On Studio (top priority)**
- On phones: camera on top, buttons directly under it, product controls under that. Everything scrolls normally. The cause of the overlap was that the studio squeezed its own content to fit the screen height. It now stacks and scrolls.
- The camera box matches the real camera shape and is never taller than 62% of the screen.
- Tablets: stacked when narrow, side by side when wide enough. Phones held sideways: side by side, with the controls scrolling.
- Bigger touch targets (44px buttons, larger colour swatches on touch screens).
- Fixed a style clash: the studio's colour swatches were picking up spacing meant for the main page's swatches.
- Camera: lighter video size on phones, protection against double taps starting two streams, `playsinline` and `muted` always set, camera released when the studio closes, when you switch tabs, or when the page is hidden.
- Face tracking runs about 22 times a second on phones (every frame on computers). The makeup and jewellery drawing is unchanged.
- The face-tracking library now downloads only when the studio opens, so the first page loads faster.

**Main page, scrolling and 3D**
- The scroll length no longer changes when the phone's address bar slides in and out, and small height-only changes no longer re-create the 3D canvas.
- Only one animation loop. It pauses when the tab is hidden or the studio is open, and resumes afterwards.
- 3D chapters far from the camera are not drawn or animated. The hero page skips 3D drawing while only the video is visible.
- Text overlays only update the page when something actually changed (fewer page updates while scrolling).
- Render sharpness lowers itself automatically (never below 1x) if a device cannot keep up.
- Fewer dust particles on weaker phones. Lighter video loading until you press Enter.
- Reduced-motion setting is respected (no floating or spinning, scrolling still works). This also fixed a bug where one line of the loader stayed invisible.
- Layout: single column for upright phones and tablets, a compact side-by-side layout for phones held sideways, bigger type on large screens, safe-area padding for notches, 16px form text so iPhone does not zoom in, visible keyboard focus, bigger tap area on the chapter dots.
- The desktop layout (900px and wider) keeps the original design, colours, fonts, logo and 3D positions.

**Content note:** on very short phones (screen shorter than 600px, e.g. iPhone SE) the one-line paragraph in the last section is hidden so the email form stays visible. On every other size all text is shown.

---

## F. What was and was not tested

Tested (in a real headless Chromium browser):
- The Try-On Studio layout using the real `tryon.css` and studio HTML at 320x700, 360x800, 390x844, 430x932, 768x1024, 1024x1366, 1366x768, 1920x1080 and 844x390. Measured: no overlap between camera and buttons, no sideways scrolling.
- The text of all 6 chapters at the same sizes (plus 320x568): nothing cut off or behind the header, no sideways scrolling.
- All JavaScript files pass a syntax check.

**Not tested**, because the environment used to prepare this had no internet access:
- `npm install` and `npm run build` could not be run, so the production build is not verified. Please run them (sections A and C) and tell me if anything fails.
- The 3D scene, scroll animation, and the real camera and face tracking were not run. They need the Three.js and MediaPipe packages and a physical camera.
- Real iPhone Safari, iPad Safari, Android Chrome and Edge were not available. The code follows the rules those browsers need, but it has not been checked on them. Please test on your own devices.
- No `package-lock.json` is included (it is created the first time you run `npm install`).

Your original ZIP (`glamify-xr (4).zip`) was not changed. Keep it as your backup.

---

## G. Update 2: jewellery, catalogue, saved looks, compare

**Done and tested in a browser (with a fake camera, no real face):**
- **Jewellery fixes.** Why it drifted: earrings were anchored on the cheek/jaw (not the ear), necklaces were anchored to the chin at jaw height, and the face was cleared the instant tracking dropped. Now: earrings sit at the ear lobe using the head's own left-right and up directions (so they follow tilt and turn, and fade out on the far ear when the head turns); necklaces use the shoulders from the Pose model when it finds them (downloaded only when a necklace is applied) and otherwise a face-based estimate; tracking smoothing adapts to speed (steady when still, responsive when moving); the last position is held for 0.3 seconds if tracking blinks.
- **Catalogue** (`src/tryon/catalog.js`): products are grouped (Earrings, Necklaces, Nose rings, Head jewellery, Makeup). All entries are labelled demonstration entries: no brands, prices or stock. Products show a small colour icon; set `image: '/images/x.jpg'` on a product to show a photo instead.
- **Favourites** (star on any product), **Save Look** (saves products + a photo from the camera), **Saved** tab (open or delete looks), **Compare** tab (two saved looks side by side), **Share** button (only appears where the browser supports sharing files).
- Everything is stored **in this browser only** (`localStorage`). There is no account or cloud sync.
- Fixed a layout bug where the side panel squeezed its sections on laptop-height screens.

**Adding products later:** add an entry to `MAKEUP` in `makeup.js` or `JEWELLERY` in `jewellery.js`, then list its id in a group in `catalog.js`.

**Not tested (needs a real person, camera and internet):** real face and shoulder tracking accuracy, the Pose model download (`pose_landmarker_lite` from Google storage; if it fails, necklaces silently use the face-based estimate), iPhone/iPad Safari, Android Chrome.

**Not built yet:** Shop & Try On (Amazon / Meesho / Myntra), AI style assistant, try-on on an uploaded photo of yourself, backend/accounts. There are no placeholder buttons for these.

---

## H. Update 3: nails, hair and outfits

All three are in the Try-On Studio as tabs (Hair, Outfits, Nails). Each downloads its tracking model **only when you apply a product that needs it**, never on the home page. Applying a second product of the same kind replaces the first (one hairstyle, one nail design, one base garment, one jacket).

**Nails** (hand model)
- Polish colours (nude, pink, red, black/dark), French manicure, glitter, ombre, chrome.
- Shapes: square, round, almond, coffin, stiletto. Finish: glossy or matte. Colour strength slider. Works on both hands.
- Each nail follows its finger (direction, length, thickness). Polish is drawn on the **back of the hand** only; there is a "Show nails: Always" option because the palm/back detection has not been tested on real hands.

**Hair** (updated in Update 5)
- Live: **hair colour** on your real hair (a hair-segmentation mask recolours it, 11 colours, intensity slider). The earlier flat live hairstyles were removed because they looked like cartoon stickers.
- Hairstyles (short, bob, long, layered, wavy, curly, bangs) are made in the **AI Photo** tab.

**Outfits** (updated in Update 5)
- Live: **My clothing photo**: your own garment photo placed on your shoulders and torso (plain background removed automatically; Move up/down and Length sliders). It is NOT an AI try-on and not bent around your body. The earlier flat drawn garments were removed.
- Realistic outfits: **AI Photo** tab.

**Tested:** the studio running in a real browser with a fake camera and *simulated* tracking data (all three features applied together, saved as a look, at 8 screen sizes, no errors), plus drawing checks on synthetic head, body and hand shapes.
**Not tested:** the real hand, body and hair-segmentation models (they need internet and a real person), real-hand palm/back detection, and any iPhone/iPad/Android hardware. The model files are loaded from Google's public MediaPipe storage; if they fail to load the studio shows a message and everything else keeps working.

---

## I. Update 4: tracking foundation and AI photo try-on

Read `TRACKING-AUDIT.md` (what was wrong and why), `TRYON-MODELS.md` (which AI models, licences, costs) and `TESTING-REPORT.md` (what was and was not tested).

### See your real tracking quality
Open the site with `?debug` at the end of the address (for example `http://localhost:5173/?debug`), press **Try It On**. The preview shows landmarks and live numbers. Send me screenshots from your phone.

### AI Photo tab: how it works
The **AI Photo** tab makes a **generated image** (not a live preview). You choose your photo + a garment photo (outfit) or a hairstyle, tick a consent box, and press **Create AI try-on**. The photos go to **your own server** (the `server` folder), which sends them to **Google Cloud** and returns the result. Nothing is sent before you press the button. Until you set the server up, the tab honestly says it is not available.

- Outfits use Google's **Virtual Try-On** model (commercial licence; about $0.06 per image, check Google's price page). Note Google lists its discontinuation as **20 January 2027**: change `TRYON_MODEL` when a newer one exists.
- Hairstyles use **Gemini image editing**: a general image editor, so the face may change slightly. There is no identity guarantee.
- The open-source try-on models (IDM-VTON, CatVTON, OOTDiffusion) are **non-commercial licences**, so they are not used.

### Set up the AI server (one time, needs a Google Cloud account with billing)
1. Create a project at https://console.cloud.google.com and note the **project ID**. Turn on billing. Set a **budget alert** so costs cannot surprise you.
2. Install the Google Cloud CLI (https://cloud.google.com/sdk/docs/install), then in the terminal:
   ```
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   gcloud services enable aiplatform.googleapis.com run.googleapis.com cloudbuild.googleapis.com
   cd server
   gcloud run deploy glamify-ai --source . --region us-central1 --allow-unauthenticated --no-cpu-throttling --max-instances 1 --set-env-vars GCP_PROJECT=YOUR_PROJECT_ID,ALLOWED_ORIGINS=https://glamify-xr.netlify.app
   ```
   (`--max-instances 1` and `--no-cpu-throttling` are needed because jobs are kept in the server's memory while the AI works.)
3. In the Google Cloud console open **Cloud Run > glamify-ai > Security** and note its **service account**. Then open **IAM**, find that account and give it the role **Vertex AI User**.
4. Copy the service address that Cloud Run prints (it looks like `https://glamify-ai-xxxx.a.run.app`).
5. In **Netlify > Site settings > Environment variables** add `VITE_TRYON_API_URL` = that address, then **Deploys > Trigger deploy**. (For local testing, put it in a file named `.env` in the project root; see `.env.example`.)
6. Open the site, Try It On, tab **AI Photo**. It should now say the form is ready. Try one outfit.

Test the server code on your computer (no Google account needed, it uses a pretend Google): `cd server` then `npm test`.

### Privacy
Photos are held in server memory only while the job runs, never saved to disk or logged. A result is deleted after it is delivered, or after 10 minutes. The request is refused unless consent was given. Google processes the photos under its own terms, which the consent text says.

---

## J. Update 5: earrings, makeup stability, nails, honest live hair/outfits
Read `FIX-REPORT.md` (what was fixed and what still needs external services) and `REFERENCE-PHOTOS.md` (the images that would help most).
Everything was tested on simulated data only; please test on your phone with `?debug` and send me recordings.

---

## K. Update 6: real-model testing, stable tracking, photo jewellery, FASHN option
Read `FIX-REPORT.md` first (root causes, measured before/after), then `TESTING-REPORT.md`.

**New one-time step (automatic):** `npm run dev` and `npm run build` now copy MediaPipe's WASM runtime from `node_modules` into
`public/mediapipe/wasm`, so the site no longer depends on cdn.jsdelivr.net. Nothing to do; just run `npm install` once as before.

**Optional: serve the AI models from your own site** (faster first load, works where Google storage is blocked):
`npm run fetch-models`, then add `VITE_MODEL_BASE=/models/` to `.env` (and to Netlify's environment variables). About 50 MB.

**Photo jewellery:** Jewellery tab > "Product photos (demo)". To add your own product, see the comment above `photo(...)` in
`src/tryon/jewellery.js` and list its id in `src/tryon/catalog.js`. Replace the demo images before going live.

**(Replaced by section O.)** AI outfits with FASHN: create an API key at https://app.fashn.ai, then on the AI server set
`TRYON_PROVIDER=fashn` and `FASHN_API_KEY=...` (see `server/.env.example`). Hairstyles still need the Google Cloud setup from
section I. A server with only FASHN offers outfits and honestly reports hairstyles as not set up. Deploy the server as in section I
(it runs anywhere Node 18+ runs; with FASHN only, no Google project is needed: e.g. Render, Railway, Fly.io or Cloud Run).

---

## O. Update 9: complete backend (accounts, AI try-on API, private images, history)

Read `docs/BACKEND.md` (how it is built) and `docs/API.md` (every endpoint). Tests: `TESTING-REPORT.md` (top section).

### What you get
- **Accounts** (optional): sign up, sign in, sign out, profile, delete account. Header button **Sign in** (shows your name when
  signed in). **Guests** can do everything; their looks are kept 24 hours and move into the account if they sign up.
- **See It On You** now saves every look to **My looks** (history) with view, download and delete.
- **Private images**: only the owner can open their results; uploaded photos are deleted as soon as the AI has finished.
- **Live camera studio**: unchanged (it never needed a server).

### Free or paid?
| Part | Cost | What you need to do |
|---|---|---|
| Backend, database (Netlify Blobs), accounts, history | **Free** on Netlify's free plan | nothing: it deploys with the site |
| AI outfit try-on, **free mode** (IDM-VTON on Hugging Face) | **Free** | nothing (on by default). Limits: queue, small daily quota per visitor, best for tops, **non-commercial licence** |
| AI outfit try-on, **FASHN** (better, faster, commercial use) | **Paid**, about $0.075 per image | add `FASHN_API_KEY` in Netlify; the site switches to it automatically |
| AI hairstyles (studio > AI Photo) | **Paid**, about $0.04 per image (no free option exists) | add `REPLICATE_API_TOKEN` |
| Netlify free plan | 300 credits/month | **each `git push` (production deploy) costs 15 credits**; when credits run out Netlify pauses the site until next month. Push less often (batch changes) |

### Run everything on your computer (one command)
```
npm install
npm run dev
```
Opens http://localhost:5173 with the website **and** the API (`/api/...`). Data is saved in the `.data/` folder (ignored by git).
Optional keys: copy `.env.example` to `.env` and fill in what you need.

Production-like test: `npm run build` then `npm start` (website + API on http://localhost:8787).

### Deploy on Netlify (your current site)
1. Unzip this update over your project folder (keep your `.git` folder). Delete the old `server/` folder and
   `netlify/functions/tryon.mjs` if they are still there (both are replaced).
2. In VS Code's terminal:
   ```
   npm install
   npm run build
   git add .
   git commit -m "Update 9: backend with accounts, AI try-on API and history"
   git push
   ```
3. Netlify builds the site and the functions automatically (`netlify/functions/api.mjs` = the API, `cleanup.mjs` = hourly
   clean-up). Netlify Blobs needs no setup.
4. Check: open `https://<your-site>.netlify.app/api/health`. You should see `"ok":true` and `"storage":"blobs"`.
5. Optional, for paid AI: Netlify > your site > **Site configuration > Environment variables** > add `FASHN_API_KEY`
   and/or `REPLICATE_API_TOKEN`, then **Deploys > Trigger deploy**. Remove the old `VITE_TRYON_API_URL` if it exists.

Other hosts (VPS, Render, Railway, Docker): `npm install && npm run build && npm start`. Data goes to `DATA_DIR` (a folder
that must be kept between restarts: a "persistent disk"). Put the settings from `.env.example` in the host's environment.

### Tests
```
npm run test:backend        # 55 backend tests: accounts, security, uploads, AI flows (mocked), history, clean-up, on 3 storage drivers
```
Browser tests (need Playwright): see the top of `TESTING-REPORT.md`.

### Database: where is my data and how do I see it?
- On Netlify: **Netlify > your site > Blobs** (stores `glamify-db` and `glamify-files`).
- On your computer: the `.data/` folder (`.data/db/...` records, `.data/files/...` images).
- Backup: copy the `.data` folder, or use `npx netlify-cli blobs:list glamify-db`.

### If something does not work
| You see | Fix |
|---|---|
| "The Glamify server is not available here" | You opened the site with a plain file server. Use `npm run dev`, `npm start`, or Netlify |
| `/api/health` gives "Page not found" on Netlify | The update was not deployed: check the deploy log; `netlify/functions/api.mjs` must be in the repo |
| "AI outfit try-on is switched off" | `FREE_TRYON=false` is set and there is no `FASHN_API_KEY` |
| Free mode: "daily limit used up" | Hugging Face's free GPU time for that visitor is used up; it resets within 24 h |
| Site shows "Site not available" | Netlify credits used up for this month (see the table above) |

---

## P. Update 10: live AR tracking audit and 3D face mask

What changed for you (nothing to set up):
- **Foundation, concealer, blush and highlighter now sit on a real 3D model of your face** (468 tracked points, 898 triangles,
  drawn with WebGL). They bend around the cheek, follow smiles, get narrower when you turn your head and no longer spill
  onto the background when you nod or come close to the camera. Phones without WebGL automatically use the old 2D drawing.
- The makeup tab no longer shows "Loading hand tracking..." (that model only runs in the background to keep your hand in
  front of the makeup). A model that cannot download no longer shows "Loading..." again every few seconds.
- Head tracking was measured again and kept: it already removes about 75% of the shake with little delay.

Compare old and new on your phone: open `https://your-site/?mesh=0` (old 2D drawing) and the normal address (3D mask).
Full audit and measurements: `TRACKING-AUDIT.md`, `TESTING-REPORT.md`.

---

## Q. Update 11: AR improvements (phases 1-5 of the audit plan)

- **Makeup respects your hair and hands:** a strand of hair or a hand in front of the face is no longer painted over.
- **Light-aware shine:** jewellery, lip gloss and nail polish take their shine from where the room light comes from, and
  jewellery takes on the colour of warm or cool light.
- **3D jewellery (demo):** Jewellery tab > "3D jewellery (demo)": studs, hoops, jhumkas, gem drops and a pendant necklace,
  real 3D metal and gems that turn with your head and hide behind it. To use your own product later, export it as a GLB file
  (in centimetres, the ear hole or neck centre at the origin, hanging down), put it in `public/products/`, and add an entry
  in `src/tryon/jewellery.js` with `model: '/products/your-file.glb'`.
- **Phone report for Phase 6:** open `https://glamifyxr.netlify.app/?debug`, start Try It On, apply makeup + earrings, and send
  a screenshot of the PHONE REPORT line (frame time and GPU). That decides whether the AI models move to a background worker.
- Turn things off to compare: `?occ=0` (no hair/hand occlusion), `?mesh=0` (2D makeup).


## R. Update 16: live outfit preview and garment photos

- **Clothing photos on any background:** a shirt photographed on a bed, a floor or outdoors now gets its background removed too.
  A plain background still works best. The note under the upload says when the background was not plain ("check the edges").
- **The live outfit now follows your body:** sleeves turn with your arms, the shirt narrows at the waist, tilts and turns with
  you, stays inside your body outline, and your arms show in front of it. The garment's own colours and print are kept.
- **Honest limit:** this is still your 2D photo bent onto a simple body shape, not a 3D garment simulation. For a realistic
  picture of you wearing it, use **See It On You** (the AI photo try-on, unchanged).
- Compare with the old flat version: add `?warp=0` to the address.
