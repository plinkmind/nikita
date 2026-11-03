# Backend architecture

## What was there before
The project is a **Vite + plain JavaScript** website (no framework): a Three.js scroll story (`src/main.js`), the live camera
try-on studio with MediaPipe (`src/tryon/`), and the "See It On You" AI photo page (`src/aitryon/`). Hosting: **Netlify, free plan**.
Before this update the only server code was one Netlify Function that forwarded AI requests, plus an unused Node server for
Google Cloud. There was no database, no accounts, no saved images; "Saved looks" in the studio live in the browser only.

| Feature | Needs the backend? |
|---|---|
| Live camera studio (makeup, jewellery, nails, hair colour, garment photo, saved looks in the browser) | No, runs fully in the browser (unchanged) |
| See It On You (AI outfit try-on): upload, generate, status, history, delete | **Yes** |
| AI hairstyles (studio > AI Photo tab) | **Yes** (and a paid key) |
| Accounts, profile, guest sessions | **Yes** |

## Design choices
- **Language/runtime: JavaScript on Node 20**, same language as the website, no build step for the backend.
- **One app, three ways to run:** `backend/src/app.js` turns a web-standard `Request` into a `Response`.
  - Netlify Function `netlify/functions/api.mjs` (production on your current site; nothing else to host)
  - `backend/server.js` (any Node host: your PC, a VPS, Render, Docker) - also serves the built website
  - inside the Vite dev server (`vite.config.js`), so `npm run dev` runs website + API together
- **Database: Netlify Blobs** on Netlify (included in every plan, zero setup, strong consistency is used, atomic "create only if
  new" writes for unique e-mails). On your computer the same data goes to a folder (`.data/`). Both are behind one small storage
  interface (`backend/src/db/storage.js`), so a SQL database can be added later as a third driver without changing the services.
  Blobs is a key-value store, which fits this data well (records are always read by id or listed by owner).
- **Minimal dependencies:** password hashing (scrypt), sessions, uploads and validation use Node's built-in modules. Runtime
  packages: `@netlify/blobs` (storage on Netlify) and, in the browser, `@gradio/client` (free AI mode).

## Folder layout
```
backend/
  server.js                 standalone Node server (API + website)
  src/
    app.js                  createApp(): middleware pipeline + router + error handling
    config.js               all settings from environment variables, with safe defaults
    routes.js               every endpoint in one table
    http.js                 Request/Response helpers, cookies, size-limited body readers, ApiError
    node-adapter.js         Node http <-> web Request/Response (server.js, vite.config.js)
    dotenv.js               reads .env for the standalone server
    middleware/
      security.js           CORS, CSRF header check, rate limiting
      auth.js               session cookie -> user, guest cookie -> guest owner
    controllers/            thin HTTP layer: auth, user, tryon, health
    services/
      auth.js               scrypt hashing, validation, register/login
      tryon.js              try-on job lifecycle, retention, clean-up, guest -> account transfer
      images.js             magic-number image validation, real width/height, private file keys
    db/
      storage.js            drivers: blobs | fs | memory
      models.js             User, Session, TryOn, RateLimit (key layout + validation)
    providers/              AI services, one file each (fashn.js, replicate.js, free.js), registry in index.js
netlify/functions/api.mjs   Netlify entry for /api/*
netlify/functions/cleanup.mjs  scheduled hourly clean-up
```

## Data model (keys in the "db" store)
| Key | Value |
|---|---|
| `users/<userId>` | `{ id, email, name, passwordHash, createdAt, updatedAt, lastLoginAt }` |
| `users-by-email/<sha256(email)>` | `{ userId }` unique index, written atomically |
| `sessions/<sha256(token)>` | `{ userId, createdAt, expiresAt }` (the raw token only exists in the user's cookie) |
| `user-sessions/<userId>/<hash>` | index to sign out everywhere / delete an account |
| `tryons/<owner>/<jobId>` | job: type, provider, status, stage, options, error, result info, timestamps, expiry |
| `rl/<bucket>/<key>/<window>` | rate-limit counters |

Images ("files" store): `<owner>/<jobId>/person|garment|result`, never public: the only way to read one is
`GET /api/images/:id/result` with the owner's session.

## Image and privacy rules
- Uploaded photos: validated (real type by magic numbers, real dimensions, size), stored only while the AI works, **deleted as
  soon as the job finishes**; leftovers are removed by the clean-up after `INPUT_RETENTION_MINUTES` (60).
- Free mode: the photos go from the browser straight to Hugging Face; they never reach our backend. Only the result is saved.
- Results: guests `GUEST_RETENTION_HOURS` (24 h); accounts `RESULT_RETENTION_DAYS` (30 days, 0 = until deleted) or until the user deletes them.
- Account deletion removes everything. Logs never contain photos, passwords or tokens.

## Security summary
scrypt password hashes with per-user salt and constant-time comparison; same answer and timing for unknown e-mail and wrong
password; random 256-bit session tokens stored only as SHA-256 hashes; HttpOnly + SameSite=Lax (+ Secure in production) cookies;
CSRF header on every state change; CORS allow-list; per-IP and per-visitor rate limits stored in the database (shared by all
serverless instances); body size limits before parsing; strict id/route patterns; private image responses with
`Content-Security-Policy: sandbox` and `nosniff`; generic 500 messages (details only in server logs); secrets only in env vars.

## Adding another AI model
Write `backend/src/providers/<name>.js` with `{ id, label, type, mode: 'server', paid, licence, available(cfg), start(), check(), cancel() }`
(see `fashn.js`), add it to `PROVIDERS` and `pickProvider()` in `providers/index.js`, and add its settings to `config.js`.
Add a mock of its API to `tests/backend/helpers.mjs` and a test to `tests/backend/api.test.mjs`.

## Limits to know
- Netlify Functions: 60 s per request and about 4.5 MB per upload (why photos are resized to 1536 px in the browser and the
  free model runs in the browser). Each status poll is a short request.
- Netlify free plan: 300 credits/month; **each production deploy costs 15 credits**; when credits run out the site is paused
  until the next month. Functions/Blobs use a little compute; normal use of this site is small.
- Blobs is eventually consistent by default; this backend asks for **strong** consistency.
