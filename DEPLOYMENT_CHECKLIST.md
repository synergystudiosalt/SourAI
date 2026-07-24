# Cloudflare Pages Deployment Checklist

## ✅ Pre-Deployment (What I've Done)

- [x] Created Pages Functions handlers
  - [x] `functions/api/chat.ts` — Chat endpoint
  - [x] `functions/api/agent.ts` — Agent endpoint
  - [x] `functions/api/health.ts` — Health check
  - [x] `functions/shared/ai.ts` — AI utilities
- [x] Updated frontend API integration
  - [x] Created `src/lib/api.ts` — Dynamic URL helper
  - [x] Updated `src/App.tsx` to use `apiUrl()`
  - [x] Updated `src/components/workspace/AgentPanel.tsx` to use `apiUrl()`
  - [x] Created `src/vite-env.d.ts` for TypeScript
- [x] Fixed all TypeScript errors
- [x] Verified build succeeds (`npm run build`)
- [x] Created documentation
- [x] Created `.env.example`

---

## 📋 Your Deployment Checklist

### Phase 1: API Keys (5 min)

- [ ] **Get Gemini API Key**
  - Go to https://aistudio.google.com/app/apikey
  - Click "Create API Key" → "Create API key in new project"
  - Copy the key and save it somewhere safe

- [ ] **Get Groq API Key (Optional)**
  - Go to https://console.groq.com
  - Create account and get API key
  - Save for later (fallback provider)

### Phase 2: GitHub Setup (2 min)

- [ ] **Commit and push to GitHub**
  ```bash
  cd sour.ai
  git add .
  git commit -m "Add Cloudflare Pages Functions deployment"
  git push origin main
  ```

### Phase 3: Cloudflare Pages Setup (3 min)

- [ ] **Create Cloudflare Pages project**
  - Go to https://dash.cloudflare.com
  - Click **Pages** → **Create a project** → **Connect to Git**
  - Authorize GitHub and select your repository
  - Select branch (usually `main`)

- [ ] **Configure build settings**
  - Root directory: `sour.ai`
  - Build command: `npm run build`
  - Build output directory: `dist`
  - Click **Save and Deploy** (it will fail — that's OK)

### Phase 4: Environment Variables (1 min)

- [ ] **Add API keys to Cloudflare**
  - In your Pages project: **Settings** → **Environment variables**
  - Under **Production**, click **Add variable**
  - Variable name: `GEMINI_API_KEY`
  - Value: (paste your key from Phase 1)
  - Click **Save**

- [ ] **Optional: Add Groq key**
  - Variable name: `GROQ_API_KEY`
  - Value: (your Groq key from Phase 1)
  - Click **Save**

- [ ] **For multiple keys (better throughput)**
  - Instead of `GEMINI_API_KEY`, use `GEMINI_API_KEYS`
  - Value: `key1,key2,key3` (comma-separated, no spaces)

### Phase 5: Deployment (1 min)

- [ ] **Redeploy with environment variables**
  - Go to **Deployments** tab
  - Find the failed deployment
  - Click **Retry build**
  - Wait 2-3 minutes for build to complete

- [ ] **Alternative: Push new commit**
  ```bash
  git commit --allow-empty -m "Trigger redeploy with env vars"
  git push origin main
  ```

### Phase 6: Verification (2 min)

- [ ] **Check frontend loads**
  - Visit `https://your-project-name.pages.dev`
  - You should see the sour.ai UI

- [ ] **Check health endpoint**
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

- [ ] **Test chat**
  - In the app, try sending a message
  - Backend should respond (may take 5-10 sec first time)

- [ ] **Test agent** (if applicable)
  - Try using the agent panel
  - It should work with your project files

---

## 🎉 You're Done!

Your sour.ai app is now live on Cloudflare Pages:
```
https://your-project-name.pages.dev
```

---

## 📚 Documentation Reference

| Document | Purpose | Read Time |
|----------|---------|-----------|
| **DEPLOYMENT_INSTRUCTIONS.md** | Complete step-by-step guide | 10 min |
| **CLOUDFLARE_QUICK_START.md** | 5-minute quick start | 5 min |
| **CLOUDFLARE_DEPLOYMENT.md** | Detailed reference (troubleshooting, customization) | 15 min |
| **SETUP_SUMMARY.txt** | Overview of what's been done | 5 min |

---

## 🔧 Troubleshooting Quick Links

### Build Fails
→ Check build logs in Cloudflare **Deployments** tab
→ Common: missing `package-lock.json` or TypeScript errors
→ Run `npm run lint` locally to check for errors

### `/api/health` returns 404
→ Wait 2-3 minutes after deployment
→ Pages Functions take time to initialize
→ Refresh the page

### "No API keys configured" Error
→ Verify `GEMINI_API_KEY` or `GEMINI_API_KEYS` in environment variables
→ Wait 1-2 minutes for changes to propagate
→ Redeploy by pushing a commit

### High latency on first request
→ This is normal (cold start)
→ Subsequent requests are faster
→ Add more API keys if persistently slow: `GEMINI_API_KEYS=key1,key2,key3,key4`

---

## 💡 Pro Tips

### 1. Multiple API Keys = Better Throughput
```
GEMINI_API_KEYS=key1,key2,key3,key4,key5
```
Backend automatically rotates through them.

### 2. Monitor Your App
- Cloudflare Pages dashboard shows analytics
- Check request counts, errors, and latency
- No separate logs needed

### 3. Custom Domain
- Go to **Pages** → **Custom domains**
- Add your domain (e.g., `ai.example.com`)
- Follow Cloudflare's DNS setup

### 4. Local Development
```bash
# Option 1: Express server
npm run dev
# Visit http://localhost:3000

# Option 2: Pages Functions (closest to production)
npm install -g wrangler
wrangler pages dev dist
# Visit http://localhost:8788
```

### 5. Scale Up
- Add more API keys when traffic grows
- Cloudflare Pages autoscales with no configuration
- You only pay for API calls (Gemini/Groq)

---

## 📞 Support

- **Cloudflare docs:** https://developers.cloudflare.com/pages/
- **Pages Functions:** https://developers.cloudflare.com/pages/platform/functions/
- **Gemini API:** https://ai.google.dev/
- **Groq API:** https://console.groq.com

---

## 🚀 Next Steps (After Deployment)

1. **Monitor analytics** in Cloudflare Pages dashboard
2. **Add custom domain** if you have one
3. **Increase API keys** as traffic grows
4. **Share your app!** It's live for the world to use

Congratulations! Your sour.ai app is now live on Cloudflare Pages! 🎉
