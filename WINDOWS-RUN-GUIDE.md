# AgriSense AI — Windows Quick Start Guide

This guide walks you through running AgriSense AI on a Windows 10/11 machine from a clean zip file. Total time: ~10 minutes.

---

## Prerequisites

### 1. Install Node.js 20+ (required)

1. Go to https://nodejs.org/en/download/
2. Download the **Windows Installer (.msi)** for **Node.js 20 LTS** (or newer)
3. Run the installer — accept all defaults (this also installs `npm`)
4. Verify installation:
   - Open **PowerShell** (press `Win + X`, click "Terminal" or "Windows PowerShell")
   - Run:
     ```powershell
     node --version
     npm --version
     ```
   - You should see `v20.x.x` and `10.x.x` or higher

### 2. Install Git (recommended, for version control)

1. Go to https://git-scm.com/download/win
2. Download and install with default options
3. Verify:
   ```powershell
   git --version
   ```

### 3. Get an OpenAI API key

1. Go to https://platform.openai.com/api-keys
2. Log in or sign up
3. Click **"Create new secret key"**
4. Copy the key (starts with `sk-...`) — you'll paste it into `.env` in step 4 below
5. Make sure you have billing set up at https://platform.openai.com/settings/organization/billing (a $5 credit is plenty for testing — each agent run costs ~$0.01–0.05 with gpt-4o)

### 4. (If you're in Bangladesh/another restricted region) Get a VPN

OpenAI blocks API calls from Bangladesh and several other countries. If you're in a restricted region:

- **Option A**: Install a VPN (ProtonVPN free tier, NordVPN, ExpressVPN, etc.) and connect to a US/UK/Singapore server before running `npm run dev`.
- **Option B**: Deploy to Vercel (free) — see "Deploy to Vercel" section at the bottom of this guide.

---

## Setup

### Step 1: Extract the zip file

1. Right-click the `agrisense-ai.zip` file
2. Select **"Extract All..."**
3. Choose a location without spaces in the path (recommended: `C:\agrisense-ai`)
   - ⚠️ Avoid paths like `C:\Users\Your Name\Documents\...` — the space can cause issues
4. Click **Extract**

### Step 2: Open PowerShell in the project folder

1. Open the extracted folder in File Explorer
2. Click the address bar at the top
3. Type `powershell` and press Enter
   - A PowerShell window opens, already in the project folder
4. Verify you're in the right place:
   ```powershell
   ls
   ```
   You should see `package.json`, `src/`, `prisma/`, etc.

### Step 3: Install dependencies

```powershell
npm install
```

This takes 1–3 minutes. You'll see some warnings about deprecated packages — that's normal, ignore them. When done, you should see a `node_modules/` folder.

### Step 4: Configure your OpenAI API key

1. In PowerShell, list files to confirm `.env` exists:
   ```powershell
   ls .env
   ```
2. Open `.env` in Notepad:
   ```powershell
   notepad .env
   ```
3. Replace the placeholder key with your real key. The file should look like:
   ```env
   DATABASE_URL=file:./db/custom.db

   # OpenAI API key
   OPENAI_API_KEY=sk-your-real-key-here

   # Optional: override the default model
   # OPENAI_MODEL=gpt-4o
   ```
4. Save the file (`Ctrl+S`) and close Notepad

### Step 5: Initialize the database

```powershell
npm run db:push
```

You should see output ending with `🚀 Your database is now in sync with your schema.` This creates the SQLite database file at `db/custom.db`.

### Step 6: Start the dev server

**If you're in a region where OpenAI is blocked (e.g. Bangladesh), connect your VPN now.**

```powershell
npm run dev
```

You should see:
```
▲ Next.js 16.1.x (Turbopack)
- Local:        http://localhost:3000
✓ Ready in xxxms
```

Leave this PowerShell window open. The server runs until you press `Ctrl+C`.

### Step 7: Open the app in your browser

1. Open your browser (Chrome, Edge, Firefox — any modern browser works)
2. Go to **http://localhost:3000**
3. You should see the AgriSense AI chat interface

---

## Testing the agent

### Test 1: Full plan in one message (best demo flow)

Type this into the chat box and press Enter:

> I have 30 decimal in Jashore, loamy soil, tubewell water, Rabi season, budget 25000 taka. Build me a complete plan.

**What you should see:**

1. The chat shows "Agent is thinking..." for 10–30 seconds
2. The right-side **Visible Agent Trace** panel fills with 6 tool calls in sequence:
   - `save_profile` (0ms) — saves your 6 intake fields
   - `get_weather` (~1.5s) — real Open-Meteo call for Jashore
   - `rag_search` (~1ms) — retrieves KB chunks
   - `recommend_crops` (~1ms) — ranks 3+ crops
   - `get_crop_calendar` (~1ms) — dated calendar
   - `compute_financials` (~1ms) — itemized costs + ROI
3. The chat shows a structured markdown answer with sections:
   - Recommended Crop + Rationale
   - 📅 Season Calendar (table with dated events)
   - 💰 Financial Projection (itemized costs, ROI, break-even)
   - ⚠️ Risks & Advisories
   - 📚 Sources (lists weather API + KB sources + tools called)

**Click any tool call in the trace panel** to expand it and see:
- The exact parameters sent (e.g. `{"location": "Jashore"}`)
- The raw JSON return value (real weather data, real KB chunks, etc.)

### Test 2: Verify weather data is real

Click the `get_weather` entry in the trace panel. You should see:
- `latitude: 23.16971` (Jashore's real latitude)
- `longitude: 89.21371` (Jashore's real longitude)
- 7 days of forecast with realistic temperatures and rainfall

This proves the agent is calling a real external API, not inventing data.

### Test 3: Multi-turn memory

Send a follow-up message:

> What was the budget I told you about?

The agent should respond with `25000 taka` without you having to repeat it. This proves the **memory** behavior (Tier 0 #4) — the profile is persisted in SQLite.

---

## Troubleshooting

### `npm install` fails with permission errors

Run PowerShell as Administrator:
1. Right-click the PowerShell icon
2. Select **"Run as administrator"**
3. `cd` to your project folder
4. Retry `npm install`

### `npm run dev` shows "port 3000 already in use"

Another process is using port 3000. Either:
- Find and kill it:
  ```powershell
  netstat -ano | findstr :3000
  taskkill /PID <PID> /F
  ```
- Or use a different port:
  ```powershell
  $env:PORT=3001; npm run dev
  ```
  Then open http://localhost:3001

### OpenAI returns `403 Country, region, or territory not supported`

You're in a region OpenAI blocks. Solutions:

1. **Connect a VPN** to US/UK/Singapore, then restart `npm run dev`
2. **Deploy to Vercel** instead (see below) — Vercel's servers are in supported regions
3. **Switch to a different LLM provider** available in your region:
   - Anthropic Claude: edit `src/lib/agent/loop.ts` to use `@anthropic-ai/sdk`
   - Google Gemini: use `@google/generative-ai`
   - Local Ollama: run `ollama serve` and point to `http://localhost:11434/v1`

The tool-calling interface is identical across providers, so only the LLM call construction needs to change.

### OpenAI returns `401 Invalid API key`

Your key is wrong or expired. Generate a new one at https://platform.openai.com/api-keys and update `.env`.

### OpenAI returns `429 Too many requests` or `insufficient_quota`

You've hit rate limits or your account has no billing set up. Go to https://platform.openai.com/settings/organization/billing and add a payment method.

### Weather tool returns "fetch failed" intermittently

Open-Meteo is usually reliable but can have brief outages. The agent handles this gracefully — it will tell the user weather data was unavailable and proceed with KB-only recommendations. Just retry the message.

### Page loads but chat shows "⚠️ LLM call failed"

Check the PowerShell window where `npm run dev` is running — the full error stack trace is printed there. Common causes:
- Missing `OPENAI_API_KEY` in `.env`
- Typo in the key
- Network/firewall blocking outbound HTTPS to `api.openai.com`

### Database errors (`prisma`-related)

Reset the database:
```powershell
Remove-Item -Recurse -Force db
npm run db:push
```

### Want to start a fresh farmer session

Click the **"New Farmer"** button in the top-right corner of the app. This generates a new session ID and clears the chat history.

---

## Deploy to Vercel (recommended for hackathon demo)

If your local machine can't reach OpenAI (region block), deploy to Vercel — its servers are in supported regions.

### Step 1: Push to GitHub

1. Create a new repo at https://github.com/new (name it `TeamName-AgriSense` per the problem statement)
2. In PowerShell, in your project folder:
   ```powershell
   git init
   git add .
   git commit -m "Initial commit — Tier 0"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/TeamName-AgriSense.git
   git push -u origin main
   ```

⚠️ **Before committing**: verify `.gitignore` includes `.env` so your API key doesn't get pushed to GitHub. The project's `.gitignore` already excludes it by default.

### Step 2: Import to Vercel

1. Go to https://vercel.com/new
2. Sign in with GitHub
3. Click **"Import Git Repository"** and select your `TeamName-AgriSense` repo
4. In the **"Environment Variables"** section, add:
   - Name: `OPENAI_API_KEY`
   - Value: `sk-your-real-key-here`
   - (Don't add `DATABASE_URL` — Vercel will use its own Postgres or you can use Vercel's built-in SQLite-compatible storage)
5. Click **"Deploy"**
6. Wait ~2 minutes for the build to complete
7. Vercel gives you a public URL like `https://teamname-agrisense.vercel.app` — share this for the demo

⚠️ **Note on SQLite + Vercel**: Vercel's serverless functions don't persist local files, so SQLite won't work in production. For the hackathon demo this is fine (each session just won't persist across deployments). For a production app, swap SQLite for Vercel Postgres or Turso (SQLite-compatible edge DB).

---

## What to demo to judges (4-minute script)

1. **30 seconds**: Open the deployed URL (or localhost). Briefly explain: "This is AgriSense AI, an autonomous agent that takes a farmer from empty field to costed plan."
2. **60 seconds**: Type a complete intake message and hit send. While the agent thinks, point at the trace panel and narrate: "Watch the right panel — the agent is making real API calls in sequence: saving the profile, fetching live weather from Open-Meteo, retrieving KB chunks via RAG, ranking crops, building a calendar, computing financials."
3. **60 seconds**: When the answer appears, scroll through it. Highlight:
   - The **Recommended Crop** section — point out it cites soil match, water match, budget fit (all from tool outputs)
   - The **Calendar** — point out the dated events and weather advisories
   - The **Financials** — point out itemized per-acre costs and ROI
4. **60 seconds**: Click the `get_weather` entry in the trace panel. Expand it. Show the real lat/long (23.17, 89.21 for Jashore) and the 7-day forecast. "This is real data from Open-Meteo, captured live during the demo — not invented by the LLM."
5. **30 seconds**: Click `rag_search` and expand. Show the KB chunks with source citations (BARC, DAE, BARI). "Every recommendation is grounded in retrieved data, not model recall."

Total: 4 minutes. Done.

---

## File structure (for your reference)

```
agrisense-ai/
├── .env                          ← your OpenAI key lives here
├── .gitignore                    ← .env is excluded from git
├── package.json                  ← dependencies + scripts
├── README.md                     ← full project documentation
├── WINDOWS-RUN-GUIDE.md          ← this file
├── prisma/
│   └── schema.prisma             ← DB schema (Farmer, Conversation, TraceEntry)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts     ← POST endpoint that runs the agent
│   │   │   ├── profile/route.ts  ← GET farmer profile + history
│   │   │   └── trace/route.ts    ← GET all tool-call trace entries
│   │   ├── layout.tsx
│   │   └── page.tsx              ← Chat UI + visible trace panel
│   └── lib/
│       ├── db.ts                 ← Prisma client singleton
│       ├── kb/
│       │   ├── crops.ts          ← Knowledge base (12 crops, 5 soils, 6 seasons)
│       │   └── rag.ts            ← TF-IDF retriever
│       └── agent/
│           ├── loop.ts           ← ReAct loop (OpenAI tool calling)
│           └── tools/
│               ├── registry.ts   ← Tool definitions + dispatcher
│               ├── weather.ts    ← Open-Meteo integration
│               ├── recommend.ts  ← Crop ranking algorithm
│               ├── financials.ts ← Cost/ROI/break-even calculator
│               └── calendar.ts   ← Dated crop calendar
└── db/                           ← SQLite DB file (created by db:push)
    └── custom.db
```

---

## Need help during the hackathon?

- **App won't start?** Check the PowerShell window — error messages are printed there
- **Agent gives weird answers?** Check the trace panel — every tool call's raw output is visible
- **Want to edit the system prompt?** It's in `src/lib/agent/loop.ts` — the `buildSystemPrompt()` function
- **Want to add a new crop?** Add it to the `CROPS` array in `src/lib/kb/crops.ts`
- **Want to add a new tool?** Add it to `src/lib/agent/tools/registry.ts` (definition + executor) and create the implementation file

Good luck! 🌾
