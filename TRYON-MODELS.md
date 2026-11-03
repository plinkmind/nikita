# AI try-on models: comparison and decision

Facts below come from the sources listed at the end. I did **not** run these models myself, so I make no claim about their relative
output quality. Prices change; check the provider's pricing page before you rely on a number.

## Update 9 (current)
The backend (`backend/src/providers/`) supports, chosen automatically:
- **Free mode: IDM-VTON** (yisol/IDM-VTON on Hugging Face). Free, runs in the visitor's browser (each visitor uses their own
  free GPU allowance; a Netlify Function could not wait minutes in Hugging Face's queue). Non-commercial licence (CC BY-NC-SA 4.0).
- **FASHN tryon-v1.6**: paid, commercial, server-side. Used automatically when `FASHN_API_KEY` is set.
- **FLUX.1 Kontext [pro] on Replicate** for hairstyles: paid. No free hairstyle model was found.
The older Google Vertex path (separate `server/`) was removed with the old server; it needed a paid Google Cloud project and was never set up.

## Outfit try-on

| Option | Licence / availability | Cost and speed (as reported) | Verdict for a business site |
|---|---|---|---|
| **IDM-VTON** | Code and weights: **CC BY-NC-SA 4.0 (non-commercial)**. Replicate page says "non-commercial use only". | About $0.024 per run, about 18 s on an A100 (Replicate). | **Not for commercial use.** Fine for research or a personal demo only. |
| **CatVTON** | Reported as CC BY-NC-SA 4.0 on the official repo. Lighter than IDM-VTON, easier to self-host. | Needs your own GPU. | **Not for commercial use** (same reason). |
| **OOTDiffusion** | A developer guide lists it among popular try-on models that carry the NC clause. | Needs your own GPU. | **Not for commercial use.** |
| **Google Vertex AI Virtual Try-On `virtual-try-on-001`** | Commercial Google Cloud API. GA since 20 Jan 2026. **Discontinuation date: 20 Jan 2027** (the model name must be updated). | About $0.06 per image (third-party price trackers; confirm on Google's page). Quota 50 requests per minute. Images up to 10 MB, PNG/JPEG, output size equals the input photo. One reseller reports about 80 s per image. | **Selected.** The only option I found with commercial terms, a documented REST API and no GPU to run yourself. |
| **FASHN tryon-v1.6** (added in Update 6) | Commercial API built only for virtual try-on. Documented REST API: `POST /v1/run`, poll `GET /v1/status/:id`, images as URL or base64, categories auto/tops/bottoms/one-pieces. | About $0.075 per image (1 credit per output; third-party comparison). FASHN docs: about 5 s (performance), 8 s (balanced), 12 to 17 s (quality), processed at 864x1296. Rate limit 25 per minute. | **Recommended option** for speed and garment detail. Set `TRYON_PROVIDER=fashn`. |
| Kling Kolors try-on (via fal.ai) | Hosted, reported commercial licence, about $0.07 per image. | - | Alternative; not integrated. |
| Perfect Corp | Hosted, about $0.05 per unit, 2 units per result (third-party). | - | Not evaluated further. |

**Decision:** the server supports two providers, chosen with `TRYON_PROVIDER`: `fashn` (recommended: dedicated try-on model, seconds instead of about a minute) or `google` (Vertex AI Virtual Try-On; retires 20 Jan 2027, model name is a setting). Neither has been run live from here (no keys); both are tested against mocks of their documented APIs.

## Hairstyle transformation
Update 6: the style list now follows the reference sheets you sent (15 styles), and the instruction asks the model to keep the face, identity, earrings, clothing, background and light, with a natural hairline. Your before/after example (curly) is the quality target.

I found no dedicated, commercially licensed hairstyle-transfer API that I could verify. Hairstyle research models exist, but I did not verify their licences, so I did not use them.
**Selected as the best verifiable option:** Gemini image editing (`gemini-2.5-flash-image`, about $0.039 per image per Google's published token price) with a fixed instruction such as "change only the hairstyle". It is a **general** image editor, not a hair model, so it can change the face, skin or background slightly and gives no identity guarantee. The page tells users it is AI-generated. The model name is a setting (`HAIR_MODEL`).

## What is NOT claimed
- No claim of perfect garment preservation, identity preservation or body-measurement accuracy.
- The server code was tested against a **mock** of Google (request shape, signing, errors). It has **not** been run against the live Google service, which needs your credentials and billing.

## Sources
- fashn.ai developer guide on try-on licences: https://fashn.ai/blog/so-you-want-to-build-a-virtual-try-on-app-a-developers-guide-to-not-getting
- IDM-VTON repository licence: https://github.com/yisol/idm-vton
- IDM-VTON on Replicate (cost, time, "non-commercial use only"): https://replicate.com/cuuupid/idm-vton
- CatVTON / IDM-VTON overview (licences): Medium article "Virtual Try-On in 2026: How CatVTON and IDM-VTON Work..." by anmjawad007 (search the title)
- Google Virtual Try-On 001 (GA, limits, discontinuation): https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/virtual-try-on-001
- Google REST request format: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-virtual-try-on-images
- Price comparison (third party): https://blog.picassoia.com/virtual-try-on-api-pricing-clothes-glasses-and-gemini
- Gemini image editing: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-editing

- FASHN API docs (endpoints, statuses, parameters): https://docs.fashn.ai/fashn-api/endpoints and https://docs.fashn.ai/api-reference/tryon-v1-6
- Try-on API price comparison (fal.ai, 2026): https://fal.ai/learn/tools/best-virtual-try-on-apis-2026
