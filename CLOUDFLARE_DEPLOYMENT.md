# Deploy sour.ai to Cloudflare Pages (with Pages Functions Backend)

This guide walks you through deploying the entire sour.ai application (frontend + backend) to **Cloudflare Pages** using **Pages Functions**.

## Architecture

- **Frontend**: Built React app deployed to Cloudflare Pages
- **Backend**: Pages Functions handlers in `/functions` directory
- **API Routes**: 
  - `GET /api/health` — Health check
  - `POST /api/chat` — Chat endpoint
  - `POST /api/agent` — AI Agent endpoint

## Prerequisites

1. **Cloudflare Account** ([signup here](https://dash.cloudflare.com/sign-up))
2. **GitHub/GitLab Account** (to connect your repo)
3. **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey)
4. (Optional) **Groq API Key** from [console.groq.com](https://console.groq.com)

---

## Step 1: Prepare Your Repository

1. Push your project to GitHub (or GitLab/Gitea):
   ```bash
   git add .
   git commit -m "Prepare for Cloudflare Pages deployment"
   git push origin main
   ```

2. Verify the project structure includes:
   ```
   sour.ai/
   ├── functions/
   │   ├── api/
   │   │   ├── health.ts
   │   │   ├── chat.ts
   │   │   └── agent.ts
   │   └── shared/
   │       └── ai.ts
   ├── src/
   ├── dist/ (will be created by build)
   ├── package.json
   ├── vite.config.ts
   └── index.html
   ```

---

## Step 2: Create Cloudflare Pages Project

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **Pages** → **Create a project**
3. Select **Connect to Git**
4. Authorize GitHub/GitLab and select your repository
5. Select the branch (usually `main`)
6. In **Build settings**:
   - **Root directory**: `sour.ai`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`

   ![Cloudflare Pages build config](https://i.imgur.com/zABCD.png)

7. **Do NOT deploy yet** — we need to add environment variables first

---

## Step 3: Add Environment Variables

In the Cloudflare Pages project dashboard:

1. Go to **Settings** → **Environment variables**
2. Add the following for **Production**:

   | Variable | Value |
   |----------|-------|
   | `GEMINI_API_KEY` | Your API key from [Google AI Studio](https://aistudio.google.com/app/apikey) |
   | `GROQ_API_KEY` | (Optional) Your API key from [console.groq.com](https://console.groq.com) |

   **For multiple keys** (recommended for higher throughput):
   - Instead of `GEMINI_API_KEY`, use `GEMINI_API_KEYS=key1,key2,key3`
   - Instead of `GROQ_API_KEY`, use `GROQ_API_KEYS=key1,key2,key3`

3. Click **Save**

---

## Step 4: Deploy

1. Click **Deploy** in Cloudflare Pages
2. Wait for the build to complete (~2 min)
3. Once deployed, your app will be at:
   ```
   https://your-project-name.pages.dev
   ```

---

## Step 5: Verify Everything Works

1. **Check frontend loads**: Visit `https://your-project-name.pages.dev`
2. **Check health endpoint**: Visit `https://your-project-name.pages.dev/api/health`
   - You should see: `{"status":"ok","hasApiKey":true,"geminiKeys":1,"groqKeys":0}`
3. **Test chat**: Use the app to send a message — it should respond

---

## Customization Options

### Custom Domain

1. Go to **Pages** → Your project → **Custom domains**
2. Add your domain (e.g., `ai.example.com`)
3. Follow Cloudflare's DNS setup

### Increase Function Timeout

Pages Functions have a **default 30-second timeout**. For longer operations:

1. Create a `wrangler.toml` in the project root:
   ```toml
   [env.production]
   routes = [
     { pattern = "example.com/api/*", zone_name = "example.com" }
   ]

   [env.production.triggers.crons]
   crons = ["0 0 * * *"]

   [limits]
   cpu_ms = 50000  # 50 seconds (max allowed)
   ```

2. Redeploy

### Use Multiple API Keys for Load Balancing

Set multiple comma-separated keys:
```
GEMINI_API_KEYS=key1,key2,key3,key4
GROQ_API_KEYS=fallback1,fallback2
```

The backend automatically rotates through them.

---

## Troubleshooting

### "No API keys configured" Error

**Problem**: Backend returns error 500
**Solution**: 
- Verify environment variables are set in Cloudflare Pages **Settings** → **Environment variables**
- Check that `GEMINI_API_KEY` or `GEMINI_API_KEYS` is present
- Redeploy after adding variables

### Build Fails

**Problem**: Deployment says "Build failed"
**Solution**:
1. Check **Deployments** tab for error logs
2. Common issues:
   - `npm install` fails: Check `package-lock.json` is committed
   - TypeScript errors: Run `npm run lint` locally to fix
   - Missing root directory: Verify `sour.ai` is set in build settings

### Functions Not Working (404 on `/api/*`)

**Problem**: `/api/health` returns 404
**Solution**:
- Pages Functions must be in the `functions/` directory at the project root
- Verify directory structure: `sour.ai/functions/api/chat.ts` etc.
- Redeploy after creating/moving functions

### High Latency

**Problem**: Responses are slow
**Solution**:
- First request to a function is slow (cold start) — this is normal
- Subsequent requests warm up the function
- Consider using multiple API keys to distribute load
- Check API provider status (Gemini/Groq) for outages

---

## Local Development

To test Pages Functions locally:

```bash
# Install wrangler (Cloudflare's CLI tool)
npm install -g wrangler

# Run local dev server
wrangler pages dev dist

# Your app will be at http://localhost:8788
```

Or use the original Express server for dev:
```bash
npm run dev
# Visit http://localhost:3000
```

---

## Next Steps

- **Monitor usage**: Cloudflare Pages analytics show request counts, errors, and latency
- **Set up CI/CD**: Cloudflare automatically deploys on push to `main`
- **Scale API keys**: Add more Gemini/Groq keys to `GEMINI_API_KEYS` or `GROQ_API_KEYS`
- **Custom branding**: Use a custom domain instead of `*.pages.dev`

---

## References

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Pages Functions](https://developers.cloudflare.com/pages/platform/functions/)
- [Gemini API](https://ai.google.dev/)
- [Groq API](https://console.groq.com)
