# Glamify XR (Responsive Version)

One website, one codebase. The same page adapts to phones, tablets, laptops and desktops.
Built with Vite, Three.js and MediaPipe Face Landmarker.

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
