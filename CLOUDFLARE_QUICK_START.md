# Cloudflare Pages Deployment — Quick Start (5 minutes)

## What You're Deploying

Your entire sour.ai app (frontend + AI backend) runs on **Cloudflare Pages** using **Pages Functions**.

- ✅ Frontend: React app
- ✅ Backend: TypeScript Pages Functions at `/api/chat`, `/api/agent`, `/api/health`
- ✅ No separate server needed — everything on Cloudflare

---

## Quick Setup

### 1. Get API Keys (2 min)

**Required: Gemini API Key**
- Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
- Click **Create API Key** → **Create API key in new project**
- Copy the key

**Optional: Groq API Key** (fallback provider)
- Go to [console.groq.com](https://console.groq.com)
- Create an account and get an API key

### 2. Push to GitHub (1 min)

```bash
git add .
git commit -m "Add Cloudflare Pages Functions deployment"
git push origin main
```

### 3. Create Cloudflare Pages Project (2 min)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Pages** → **Create a project** → **Connect to Git**
3. Select your repository
4. Fill in:
   - **Root directory**: `sour.ai`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
5. Click **Save and deploy** (don't worry if it fails — we need env vars first)

### 4. Add API Keys as Environment Variables

In your Cloudflare Pages project:

1. Go to **Settings** → **Environment variables**
2. Under **Production**, add:
   ```
   GEMINI_API_KEY = <your-key-from-step-1>
   ```
   Or for multiple keys:
   ```
   GEMINI_API_KEYS = key1,key2,key3
   ```
3. (Optional) Add `GROQ_API_KEY` or `GROQ_API_KEYS`
4. Click **Save**

### 5. Trigger Deployment

Go to **Deployments** → Find the failed one → Click **Retry build**

Or just push a new commit:
```bash
git commit --allow-empty -m "Trigger redeploy with env vars"
git push origin main
```

---

## Done! 🎉

Your app is live at: `https://your-project-name.pages.dev`

Test it:
- **Frontend**: Visit the URL above
- **Health check**: Visit `/api/health` — should return `{"status":"ok","hasApiKey":true,...}`
- **Chat**: Send a message in the app — backend is running on Pages Functions

---

## What About the `/functions` Directory?

You'll see three files in `sour.ai/functions/`:
- `api/chat.ts` — Handles chat messages
- `api/agent.ts` — Handles the AI agent
- `api/health.ts` — Health check endpoint
- `shared/ai.ts` — Shared utilities

Cloudflare automatically routes:
- `POST /api/chat` → `functions/api/chat.ts`
- `POST /api/agent` → `functions/api/agent.ts`
- `GET /api/health` → `functions/api/health.ts`

No configuration needed — it's automatic.

---

## Troubleshooting

**Q: I get "No API keys configured"**
- A: Make sure `GEMINI_API_KEY` or `GEMINI_API_KEYS` is in Cloudflare Pages **Settings** → **Environment variables**
- Wait 1-2 min for changes to propagate
- Redeploy by pushing a commit or clicking **Retry build**

**Q: `/api/health` returns 404**
- A: Wait 2-3 min for the deploy to fully complete. Pages Functions take time to be ready.

**Q: The build fails**
- A: Check the build logs in Cloudflare Pages **Deployments** tab
- Common issue: missing `package-lock.json` — make sure it's committed
- Or TypeScript error — run `npm run lint` locally to fix

**Q: Can I use a custom domain?**
- A: Yes! Go to **Pages** → **Custom domains** and add your domain (e.g., `ai.example.com`)

---

## Next Steps

- **Monitor**: Check Cloudflare Pages analytics for request counts and errors
- **Scale**: Add more API keys to `GEMINI_API_KEYS` for higher throughput
- **Customize**: Edit the system prompts in `functions/shared/ai.ts`

For detailed docs, see [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md)

---

## Local Testing (Optional)

To test Pages Functions locally before deploying:

```bash
npm install -g wrangler
wrangler pages dev dist
# App runs at http://localhost:8788
```

Or use the Express server for quick testing:
```bash
npm run dev
# Visit http://localhost:3000
```
