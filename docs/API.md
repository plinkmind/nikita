# Glamify Mirror Me API (v1.0)

Base URL: the website itself, e.g. `https://your-site.netlify.app/api/...` (or `http://localhost:5173/api/...` with `npm run dev`).
All responses are JSON unless noted, and errors always look like this:

```json
{ "error": { "code": "short_machine_code", "message": "A sentence you can show to the user." } }
```

## Rules for every request

| Rule | Why |
|---|---|
| Requests that change something (`POST`, `PATCH`, `DELETE`) must send the header `X-Requested-With: glamify` | CSRF protection: other websites cannot send this header to us |
| Send cookies (`credentials: 'same-origin'`, or `'include'` for an allowed other origin) | Sign-in uses the `gm_session` cookie (HttpOnly, SameSite=Lax, Secure in production) |
| Other websites are refused unless listed in `ALLOWED_ORIGINS` | CORS |
| Rate limits answer `429` with a `Retry-After` header | brute force / cost protection |

Who owns a try-on: the signed-in user, otherwise a **guest** identified by the `gm_guest` cookie (created automatically on the
first try-on; guest looks expire after `GUEST_RETENTION_HOURS`, default 24 h). Signing up or in moves guest looks to the account.

---

## Health

### `GET /api/health`
```json
{ "ok": true, "version": "1.0.0", "storage": "blobs", "database": "ok", "accounts": true, "guests": true,
  "tryon": {
    "outfit": { "ready": true, "provider": { "id": "idm-vton-free", "label": "IDM-VTON (free demo on Hugging Face)", "mode": "browser", "paid": false, "licence": "...", "space": "yisol/IDM-VTON" } },
    "hair":   { "ready": false, "provider": null, "styles": ["h-bob", "..."], "colours": ["natural", "..."] } },
  "limits": { "maxImageMB": 4, "minImageSide": 256, "guestHours": 24, "resultDays": 30 } }
```
`503` with `"database": "error"` if storage cannot be reached. Never shows secrets.

---

## Accounts

### `POST /api/auth/register`
Body (JSON): `{ "email": "a@b.com", "password": "at least 8 characters", "name": "optional" }`
- `201` `{ "user": {...}, "claimedLooks": 0 }` and sets the session cookie
- `400 bad_email` / `weak_password` / `bad_name`, `409 email_taken`, `429 rate_limited` (5 per IP per hour)

### `POST /api/auth/login`
Body: `{ "email", "password" }` → `200 { "user", "claimedLooks" }` + session cookie.
`401 bad_login` (same message whether the e-mail exists or not), `429` (10 per IP per 15 min).

### `POST /api/auth/logout` → `200 { "ok": true }`; the session is deleted on the server and the cookie cleared.

### `GET /api/auth/me` → `200 { "user": {...} | null }`

User object: `{ "id", "email", "name", "createdAt", "lastLoginAt" }` (the password hash is never returned).

### `GET /api/user/profile` (signed in) → `{ "user", "stats": { "looks": 3, "total": 4 } }`, else `401 unauthorized`
### `PATCH /api/user/profile` (signed in) body `{ "name" }` → `{ "user" }`
### `DELETE /api/user` (signed in) body `{ "password" }` → `{ "ok": true }`
Deletes the account, every try-on record and image, and every session. `401 bad_password` if the password is wrong.

---

## Try-on

### `POST /api/tryon/generate`  (multipart/form-data)
| Field | Required | Value |
|---|---|---|
| `type` | yes | `outfit` or `hair` |
| `consent` | yes | `true` (the visitor ticked the consent box) |
| `person` | server providers | photo of the person (JPEG/PNG/WebP, max 4 MB, min 256 px) |
| `garment` | outfit + server provider | photo of the clothing |
| `category` | outfit | `auto` (default), `tops`, `bottoms`, `one-pieces` |
| `style`, `colour` | hair | ids from `/api/health` (`hair.styles`, `hair.colours`) |

Photos are checked by their real file contents (not the name), and their real width/height is read from the file.

Response `202 { "job": Job, "guest": true|false }`. With the **free** provider (`provider.mode = "browser"`) do not send photos:
the job comes back as `awaiting_client`; the browser runs the free model and then calls `/complete` (below).

Errors: `400 consent_required | bad_type | bad_category | bad_style | bad_colour | missing_image | bad_image_type | bad_image | image_too_small | image_too_big`,
`413 too_large | image_too_large`, `429 rate_limited` (8 per visitor per 10 min, 20 per IP), `503 not_configured` (that AI is not switched on).

### `GET /api/tryon/status/:id`
Returns `{ "job": Job }`. For server providers each call also asks the AI service for progress (at most every 1.5 s), so poll
every 2 seconds until `status` is `succeeded` or `failed`. `404` if the job does not exist **or belongs to someone else**.

### `POST /api/tryon/:id/complete`  (free provider only, multipart field `result`)
The finished image from the browser. It must be a real JPEG/PNG/WebP image. `409 already_finished` if the job is done.

### `POST /api/tryon/:id/fail`  (free provider only)  body `{ "code": "free_unreachable" | "free_quota" | "free_busy" | "free_error" | "cancelled" }`
Records that the free service failed, so the history shows it honestly.

### `GET /api/tryon/history?type=outfit|hair&limit=30`
`{ "items": [Job, ...], "guest": false }` newest first (guests also get `"guestHours"`). Expired items are removed.

### `DELETE /api/tryon/:id` → `{ "ok": true }`
Cancels the AI job if it is still running and deletes the record, the result image and any uploaded photos.

### `GET /api/images/:id/result`
The generated image (binary, `image/png|jpeg|webp`), **only for its owner** (`404` for anyone else). Sent with
`Cache-Control: private`. In the browser, fetch it with the cookie and show it as an object URL.

### Job object
```json
{ "id": "t2jyjcqzyaf3d1a56f54", "type": "outfit", "status": "processing", "stage": "generating",
  "options": { "category": "auto" },
  "provider": { "id": "fashn", "label": "FASHN Virtual Try-On v1.6", "mode": "server", "paid": true, "licence": "..." },
  "error": null,
  "result": { "url": "/api/images/t2jy.../result", "mime": "image/png", "width": 864, "height": 1296 },
  "createdAt": "...", "completedAt": "...", "expiresAt": "..." }
```
`status`: `queued` (waiting to start; also when the AI was busy and the start will be retried), `processing`,
`awaiting_client` (free provider), `succeeded`, `failed`. `error`: `{ code, message }` when failed, e.g. `pose`, `blocked`,
`input`, `timeout`, `provider_auth`, `provider_billing`, `provider_busy`, `provider_bad_image`, `free_quota`.
`result` is only present when `succeeded`; nothing is ever invented.

---

## Example (browser)
```js
const f = new FormData()
f.append('type', 'outfit'); f.append('consent', 'true'); f.append('category', 'auto')
f.append('person', personBlob, 'person.jpg'); f.append('garment', garmentBlob, 'garment.jpg')
let { job } = await (await fetch('/api/tryon/generate', { method: 'POST', body: f, headers: { 'X-Requested-With': 'glamify' } })).json()
while (!['succeeded', 'failed'].includes(job.status)) {
  await new Promise((r) => setTimeout(r, 2000))
  ;({ job } = await (await fetch(`/api/tryon/status/${job.id}`)).json())
}
if (job.status === 'succeeded') img.src = URL.createObjectURL(await (await fetch(job.result.url)).blob())
```
The site's own client is `src/api/client.js`.
