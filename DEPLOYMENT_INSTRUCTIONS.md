# Complete Deployment Instructions for Cloudflare Pages

## What Has Been Done

I've prepared your sour.ai project to run **entirely on Cloudflare Pages** with the backend running as **Pages Functions**. No separate server needed.

### Files Added/Modified

**Backend (Pages Functions):**
- `functions/api/chat.ts` — Chat endpoint
- `functions/api/agent.ts` — AI Agent endpoint
- `functions/api/health.ts` — Health check
- `functions/shared/ai.ts` — Shared AI utilities (Gemini, Groq, model routing)

**Frontend Integration:**
- `src/lib/api.ts` — Dynamic API URL handling (supports local dev + Cloudflare Pages)
- `src/App.tsx` — Updated to use `apiUrl()` helper
- `src/components/workspace/AgentPanel.tsx` — Updated to use `apiUrl()` helper
- `src/vite-env.d.ts` — TypeScript configuration for Vite

**Configuration & Docs:**
- `.env.example` — Example environment variables
- `CLOUDFLARE_DEPLOYMENT.md` — Comprehensive deployment guide (detailed)
- `CLOUDFLARE_QUICK_START.md` — Quick 5-minute setup guide
- `README.md` — Updated with Cloudflare deployment link

---

## Step-by-Step Deployment

### **Step 1: Prepare API Keys (2 min)**

#### Get Gemini API Key (Required)
1. Go to https://aistudio.google.com/app/apikey
2. Click **Create API Key** → **Create API key in new project**
3. Copy and save the key (you'll need it in Step 4)

#### Get Groq API Key (Optional)
1. Go to https://console.groq.com
2. Create account → Get API key
3. (This is a fallback provider; Gemini is the primary)

---

### **Step 2: Push to GitHub (1 min)**

```bash
cd sour.ai
git add .
git commit -m "Add Cloudflare Pages Functions deployment"
git push origin main
```

---

### **Step 3: Create Cloudflare Pages Project (2 min)**

1. Go to https://dash.cloudflare.com
2. Click **Pages** → **Create a project** → **Connect to Git**
3. **Authorize GitHub** and select your repository
4. Select your branch (usually `main`)
5. **Build Settings:**
   - **Root directory:** `sour.ai`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
6. Click **Save and Deploy** (it will fail — that's OK, we need env vars first)

---

### **Step 4: Add Environment Variables (1 min)**

In your Cloudflare Pages project dashboard:

1. Go to **Settings** → **Environment variables**
2. Under **Production**, click **Add variable**
3. Add **one** of these:

   **Option A: Single Gemini Key**
   ```
   Variable name: GEMINI_API_KEY
   Value: <your-key-from-step-1>
   ```

   **Option B: Multiple Gemini Keys** (recommended for better throughput)
   ```
   Variable name: GEMINI_API_KEYS
   Value: key1,key2,key3
   ```

4. (Optional) Add Groq key:
   ```
   Variable name: GROQ_API_KEY
   Value: <your-groq-key>
   ```

5. Click **Save**

---

### **Step 5: Redeploy (1 min)**

**Option A:** Go to **Deployments** → Click the failed deployment → **Retry build**

**Option B:** Push a new commit:
```bash
git commit --allow-empty -m "Trigger redeploy with env vars"
git push origin main
```

Wait 2-3 minutes for deployment to complete.

---

### **Step 6: Verify Everything Works (1 min)**

1. **Check your app loads:**
   - Visit `https://your-project-name.pages.dev`
   - You should see the sour.ai interface

2. **Check backend is working:**
   - Visit `https://your-project-name.pages.dev/api/health`
   - You should see:
     ```json
     {
       "status": "ok",
       "hasApiKey": true,
       "geminiKeys": 1,
       "groqKeys": 0
     }
     ```

3. **Test chat:**
   - In the app, try sending a message
   - Backend should respond (may take 5-10 sec on first request — cold start)

---

## Done! 🎉

Your app is now live on Cloudflare Pages with a fully functional AI backend.

**Your app URL:** `https://your-project-name.pages.dev`

---

## How It Works

```
Browser Request
    ↓
Cloudflare Pages (Frontend HTML/JS/CSS)
    ↓
Browser sends POST /api/chat or /api/agent
    ↓
Cloudflare Pages Functions (TypeScript handlers)
    ↓
Calls Gemini or Groq API
    ↓
Response sent back to frontend
```

---

## API Endpoints Available

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check (shows API key status) |
| POST | `/api/chat` | Chat with the main AI |
| POST | `/api/agent` | Use the code editor agent |

---

## Common Questions

**Q: Can I add a custom domain?**
- A: Yes! Go to **Pages** → **Custom domains** and add your domain

**Q: What if I get "No API keys configured"?**
- A: 
  1. Verify `GEMINI_API_KEY` or `GEMINI_API_KEYS` is set in **Settings** → **Environment variables**
  2. Wait 1-2 minutes for changes to propagate
  3. Redeploy by pushing a commit

**Q: How do I add more API keys for higher throughput?**
- A: Set `GEMINI_API_KEYS=key1,key2,key3,key4` (comma-separated, no spaces)
- A: The backend automatically rotates through them

**Q: Can I still run locally?**
- A: Yes!
  - For Express server: `npm run dev` (visit http://localhost:3000)
  - For Pages Functions: `npm install -g wrangler` then `wrangler pages dev dist` (visit http://localhost:8788)

**Q: How much does this cost?**
- A: Cloudflare Pages is **free** with generous limits
- A: You only pay for the API calls to Gemini/Groq (your own API keys)

---

## For Detailed Information

- **Comprehensive guide:** See `CLOUDFLARE_DEPLOYMENT.md` in the project
- **Quick reference:** See `CLOUDFLARE_QUICK_START.md` in the project
- **Cloudflare docs:** https://developers.cloudflare.com/pages/
- **Gemini API:** https://ai.google.dev/
- **Groq API:** https://console.groq.com

---

## Troubleshooting

**Build fails in Cloudflare:**
- Check **Deployments** tab for error logs
- Usually missing dependencies — ensure `package-lock.json` is committed
- Run `npm run lint` locally to check for TypeScript errors

**Endpoints return 404:**
- Wait 2-3 minutes after deployment — Pages Functions take time to initialize
- Check that `functions/` directory exists with correct files

**High latency on first request:**
- This is normal! Pages Functions have a "cold start" on first request
- Subsequent requests are much faster
- If consistently slow, add more API keys to distribute load

**Rate limits hit:**
- Add more API keys: `GEMINI_API_KEYS=key1,key2,key3,key4,key5`
- The backend rotates through them automatically

---

## Next Steps

1. **Monitor your app:** Cloudflare Pages dashboard shows analytics
2. **Scale up:** Add more API keys if traffic grows
3. **Customize:** Edit system prompts in `functions/shared/ai.ts`
4. **Feedback:** If you hit issues, check the build logs in Cloudflare Pages

Enjoy your deployment! 🚀
