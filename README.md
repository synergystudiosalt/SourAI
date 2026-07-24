<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/5937ba8e-f4d6-4ab7-929d-4f757c37a2db

## Cloudflare Pages deployment

**Prerequisites:**  Node.js

1. Connect this repository to Cloudflare Pages:
   ```bash
   # Build command
   npm run build
   # Build output directory
   dist
   ```
2. Add these variables in Cloudflare Pages → Settings → Environment variables:
   - `GEMINI_API_KEY` or `GEMINI_API_KEYS` — keys from [Google AI Studio](https://aistudio.google.com/app/apikey)
   - `GROQ_API_KEY` or `GROQ_API_KEYS` (optional fallback provider)
   - `POLLINATIONS_API_KEY` — required for image generation
3. Deploy. Cloudflare automatically publishes the React build and the `functions/` directory together.

See [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md) for step-by-step instructions.

TL;DR:
1. Connect your GitHub repo to Cloudflare Pages
2. Set root directory to `sour.ai`
3. Add `GEMINI_API_KEY` (or `GEMINI_API_KEYS`) as environment variable
4. Deploy

### Model routing

Each sour.ai model tier is pinned to a Cloudflare-compatible provider model in `functions/shared/ai.ts` (`MODEL_ROUTES`):

| Tier | Provider | Model |
| --- | --- | --- |
| Omni-Flash | Gemini | `gemini-3.5-flash-lite` |
| Intelligence | Gemini | `gemma-4-31b-it` |
| Ultra | Gemini | `gemma-4-31b-it` |
| Overclock | Gemini | `gemma-4-31b-it` |

If a tier's primary model fails, the Pages Function tries the global Gemini fallback and then Groq when configured.
