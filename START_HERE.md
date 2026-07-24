# 🚀 START HERE: Deploy to Cloudflare Pages

Your sour.ai app is ready to deploy to **Cloudflare Pages**. The entire backend (API) now runs as **Cloudflare Pages Functions** — no separate server needed!

---

## What's Ready?

✅ **Backend**
- 3 API endpoints built as Pages Functions
- Gemini API integration (with Groq fallback)
- Model routing (Omni-Flash, Intelligence, Ultra, Overclock)
- Automatic key rotation for high throughput

✅ **Frontend**
- React app configured to call `/api/*` endpoints
- Works with Cloudflare Pages + Pages Functions
- Works locally with Express server
- Environment-aware (auto-detects Pages vs local)

✅ **Documentation**
- 4 guide documents (see below)
- Step-by-step checklists
- Troubleshooting guides
- Architecture explanations

---

## 📖 Which Guide Should I Read?

### **In a Hurry? (5 minutes)**
→ Read: **CLOUDFLARE_QUICK_START.md**
- Quick setup steps
- Copy-paste commands
- Basic verification

### **Want Step-by-Step? (10 minutes)**
→ Read: **DEPLOYMENT_INSTRUCTIONS.md** ⭐ **START HERE**
- Complete walkthrough
- Every step explained
- What to expect at each stage

### **Need Detailed Reference?**
→ Read: **CLOUDFLARE_DEPLOYMENT.md**
- Architecture overview
- Troubleshooting section
- Customization options
- Local development setup

### **Visual Checklist?**
→ Use: **DEPLOYMENT_CHECKLIST.md**
- Checkbox format
- Phase-by-phase breakdown
- All your next steps

### **Overview of Changes?**
→ See: **SETUP_SUMMARY.txt**
- What was created/modified
- Architecture diagram
- Before/after comparison

---

## ⚡ 5-Step Deployment (TL;DR)

1. **Get API keys**
   - Gemini: https://aistudio.google.com/app/apikey
   - Groq (optional): https://console.groq.com

2. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Add Cloudflare Pages deployment"
   git push origin main
   ```

3. **Create Pages project**
   - Go to https://dash.cloudflare.com
   - Pages → Create project → Connect to Git
   - Root: `sour.ai`, Build: `npm run build`, Output: `dist`

4. **Add environment variables**
   - Settings → Environment variables
   - Add: `GEMINI_API_KEY` = your-key

5. **Redeploy**
   - Deployments → Retry failed build
   - Wait 2-3 minutes
   - Visit `https://your-project.pages.dev` ✓

---

## 📂 Project Structure

```
sour.ai/
├── functions/
│   ├── api/
│   │   ├── chat.ts          ← /api/chat endpoint
│   │   ├── agent.ts         ← /api/agent endpoint
│   │   └── health.ts        ← /api/health endpoint
│   └── shared/
│       └── ai.ts            ← Gemini/Groq integration
│
├── src/
│   ├── lib/api.ts           ← API URL helper (IMPORTANT)
│   ├── App.tsx              ← Updated to use apiUrl()
│   └── ...rest of frontend
│
├── DEPLOYMENT_INSTRUCTIONS.md    ⭐ Main guide
├── CLOUDFLARE_QUICK_START.md     Quick reference
├── CLOUDFLARE_DEPLOYMENT.md      Detailed docs
├── DEPLOYMENT_CHECKLIST.md       Checklist
├── SETUP_SUMMARY.txt             What changed
└── START_HERE.md                 This file
```

---

## 🔑 How API URLs Work

Your frontend is configured to automatically detect the environment:

```typescript
// src/lib/api.ts
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

// On Cloudflare Pages:
apiUrl('/api/chat') → '/api/chat' (uses Pages Functions)

// On local Express:
apiUrl('/api/chat') → 'http://localhost:3000/api/chat' (if VITE_API_BASE set)

// On custom backend:
apiUrl('/api/chat') → 'https://api.example.com/api/chat' (if VITE_API_BASE set)
```

No code changes needed — it just works!

---

## ✨ What Changed From Before

### Before (Old Setup)
- Frontend: Cloudflare Pages
- Backend: Separate Node server (Render, Railway, VPS, etc.)
- Two deployments to manage
- More complex setup

### After (New Setup)
- **Frontend + Backend: Both on Cloudflare Pages**
- One dashboard
- One deployment
- Simpler, faster, more integrated

---

## 🎯 Next Step: Read the Deployment Guide

**→ Open and follow: `DEPLOYMENT_INSTRUCTIONS.md`**

It has:
- ✅ Step-by-step walkthrough (takes 15 min)
- ✅ What to expect at each stage
- ✅ How to verify it works
- ✅ Troubleshooting if anything goes wrong

---

## 💬 Questions Before You Start?

**Q: Do I need to change any code?**
- A: No! Everything is already configured. You just deploy.

**Q: What about local development?**
- A: Still works! `npm run dev` runs Express server on localhost:3000

**Q: Will it cost money?**
- A: Cloudflare Pages is free. You only pay for API calls to Gemini/Groq (your keys).

**Q: Can I use my own domain?**
- A: Yes! Add custom domain in Cloudflare Pages after deployment.

**Q: How do I handle high traffic?**
- A: Add more API keys: `GEMINI_API_KEYS=key1,key2,key3,key4,key5`
- Backend automatically rotates through them.

**Q: What if something breaks?**
- A: Check `CLOUDFLARE_DEPLOYMENT.md` troubleshooting section
- Or check build logs in Cloudflare Pages dashboard

---

## 📞 Resources

- **Main deployment guide:** `DEPLOYMENT_INSTRUCTIONS.md`
- **Cloudflare docs:** https://developers.cloudflare.com/pages/
- **Gemini API:** https://ai.google.dev/
- **Groq API:** https://console.groq.com

---

## 🚀 Ready?

**Open `DEPLOYMENT_INSTRUCTIONS.md` and follow the 5 steps.**

Your app will be live on Cloudflare Pages in ~15 minutes!

Good luck! 🎉
