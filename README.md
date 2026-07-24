<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/5937ba8e-f4d6-4ab7-929d-4f757c37a2db

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root and set:
   - `GEMINI_API_KEY` — a single Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey), or
   - `GEMINI_API_KEYS` — a comma-separated pool of keys to rotate across for higher throughput
   - `GROQ_API_KEY` / `GROQ_API_KEYS` (optional) — used as an automatic fallback provider if every Gemini key/model is exhausted
3. Run the app:
   ```bash
   npm run dev
   ```
   The app will be at `http://localhost:3000`

## Deploy to Cloudflare Pages

**Deploy the entire app (frontend + backend) to Cloudflare Pages with Pages Functions:**

See [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md) for step-by-step instructions.

TL;DR:
1. Connect your GitHub repo to Cloudflare Pages
2. Set root directory to `sour.ai`
3. Add `GEMINI_API_KEY` (or `GEMINI_API_KEYS`) as environment variable
4. Deploy

### Model routing

Each sour.ai model tier is pinned to a specific model in `server.ts` (`MODEL_ROUTES`):

| Tier | Provider | Model |
| --- | --- | --- |
| Omni-Flash | Gemini | `gemini-3.5-flash-lite` |
| Intelligence | Groq | `llama-3.1-8b-instant` |
| Ultra | Gemini | `gemma-4-31b-it` |
| Overclock | Gemini | `gemma-4-31b-it` |

If a tier's primary model fails, every tier falls back to the same global fallback model (`gemma-4-21b`) before finally trying Groq's default model. No sampling parameters (`temperature`, `top_p`, `top_k`) are set on any request — `gemini-3.5-flash-lite` and the other configured models rely on their own built-in defaults/system-prompt steering instead.
