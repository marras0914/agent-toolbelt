# 🚀 SETUP & SHIP — Step by Step

This guide takes you from zero to live, billing-enabled API in about 30 minutes.

---

## Step 1: Local Setup (5 min)

```bash
cd agent-toolbelt

# Install dependencies
npm install

# Create your environment file
cp .env.example .env

# Generate a secure API key secret
openssl rand -hex 32
# → Paste this as API_KEY_SECRET in .env

# Start the dev server
npm run dev
```

Visit `http://localhost:3000` — you should see the landing page.

Test the flow:
```bash
# Register as a client
curl -s -X POST http://localhost:3000/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test"}' | jq .

# Copy the API key from the response, then call a tool:
curl -s -X POST http://localhost:3000/api/tools/schema-generator \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer atb_YOUR_KEY_HERE" \
  -d '{"description": "a user profile with name and email"}' | jq .
```

---

## Step 2: Set Up Stripe (10 min)

### 2a. Create Stripe Account
1. Go to https://dashboard.stripe.com/register
2. Verify your email and identity

### 2b. Create Your Product
1. Go to **Products** → **Add product**
2. Name: `Agent Toolbelt`
3. Create **3 prices** (recurring, monthly):
   - `Starter` → $29/month
   - `Pro` → $99/month
   - `Enterprise` → $499/month
4. Copy each **Price ID** (starts with `price_`)

### 2c. Set Up Webhook
1. Go to **Developers** → **Webhooks** → **Add endpoint**
2. URL: `https://YOUR_DOMAIN.com/stripe/webhook` (update after deploy)
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **Webhook Signing Secret** (starts with `whsec_`)

### 2d. Update .env
```bash
STRIPE_SECRET_KEY=sk_live_...          # From Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_...         # From the webhook you created
STRIPE_PRICE_STARTER=price_...          # Starter price ID
STRIPE_PRICE_PRO=price_...              # Pro price ID
STRIPE_PRICE_ENTERPRISE=price_...       # Enterprise price ID
```

### 2e. Test with Stripe CLI (optional but recommended)
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/stripe/webhook

# In another terminal, trigger a test event
stripe trigger checkout.session.completed
```

---

## Step 3: Deploy to Railway (10 min)

### 3a. Push to GitHub
```bash
# Initialize git
git init
echo "node_modules\ndist\ndata\n.env\n*.db" > .gitignore
git add .
git commit -m "Agent Toolbelt v1.0 — ready to ship"

# Create a GitHub repo and push
gh repo create agent-toolbelt --private --source=. --push
# OR manually: create repo on GitHub, then:
git remote add origin git@github.com:YOUR_USER/agent-toolbelt.git
git push -u origin main
```

### 3b. Deploy on Railway
1. Go to https://railway.app and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub Repo**
3. Select your `agent-toolbelt` repo
4. Railway auto-detects the Dockerfile

### 3c. Add Environment Variables
In Railway dashboard → your service → **Variables**:
```
PORT=3000
NODE_ENV=production
API_KEY_SECRET=<your generated secret>
USAGE_TRACKING_ENABLED=true
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
```

### 3d. Add Persistent Volume
Railway dashboard → your service → **Volumes** → **Add Volume**:
- Mount path: `/app/data`
- This ensures your SQLite database survives redeploys

### 3e. Add Custom Domain (optional)
Settings → **Networking** → **Generate Domain** or **Add Custom Domain**
- Example: `api.agenttoolbelt.com`

### 3f. Update Stripe Webhook URL
Go back to Stripe → Webhooks → Update the endpoint URL to:
`https://YOUR_RAILWAY_DOMAIN/stripe/webhook`

---

## Step 4: Verify Everything Works (5 min)

```bash
DOMAIN=https://your-app.railway.app

# Health check
curl $DOMAIN/api

# View tool catalog
curl $DOMAIN/api/tools/catalog

# Register a test client
curl -X POST $DOMAIN/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@yourdomain.com"}'

# Call a tool with the returned API key
curl -X POST $DOMAIN/api/tools/text-extractor \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer atb_..." \
  -d '{"text": "Contact john@test.com at (555) 123-4567", "extractors": ["emails", "phone_numbers"]}'

# Check usage stats
curl $DOMAIN/admin/usage
```

---

## Step 5: Go to Market

### Distribution Channels (in order of priority)

1. **RapidAPI** (rapidapi.com)
   - List each tool as a separate API
   - Their marketplace drives organic discovery
   - They handle billing too (alternative to self-hosted Stripe)

2. **Product Hunt**
   - Launch as "Agent Toolbelt — Microservices that AI agents pay to use"

3. **Developer Communities**
   - Reddit: r/ChatGPT, r/LangChain, r/MachineLearning, r/SideProject
   - Hacker News: "Show HN: We built an API toolkit for AI agents"
   - Twitter/X: Thread on the agent economy + your tools

4. **Agent Platform Integrations**
   - **OpenAI GPT Actions**: Package your catalog as a GPT Action schema
   - **Claude MCP**: Wrap tools as Model Context Protocol servers
   - **LangChain**: Publish tools to LangChain Hub

5. **Blog Content** (great for SEO)
   - "How to Build Monetizable Tools for AI Agents"
   - "The Agent Economy: Why API Microservices Are the New SaaS"

---

## Quick Reference

| What                  | URL                              |
|-----------------------|----------------------------------|
| Landing page          | `/`                              |
| API info              | `/api`                           |
| Tool catalog          | `/api/tools/catalog`             |
| API docs              | `/api/docs`                      |
| Register              | `POST /api/clients/register`     |
| Call a tool           | `POST /api/tools/:name`          |
| Upgrade plan          | `POST /billing/checkout`         |
| Stripe webhook        | `POST /stripe/webhook`           |
| Admin: global usage   | `GET /admin/usage`               |
| Admin: client keys    | `GET /admin/clients/:id/keys`    |
| Admin: client usage   | `GET /admin/clients/:id/usage`   |

---

## Alternative: Deploy to Render.com

If you prefer Render over Railway:
1. Go to render.com → New → Web Service
2. Connect your GitHub repo
3. Environment: Docker
4. Add environment variables (same as Railway)
5. Add a disk: mount path `/app/data`, size 1 GB
6. Deploy

---

## Alternative: Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch
fly launch --name agent-toolbelt --region iad

# Create persistent volume
fly volumes create toolbelt_data --size 1 --region iad

# Set secrets
fly secrets set API_KEY_SECRET=... STRIPE_SECRET_KEY=... ...

# Deploy
fly deploy
```

---

## What's Next?

See **ROADMAP.md** for the full plan, but immediate next steps:

1. ✅ Deploy and verify (you are here)
2. Build 1-2 more tools (Markdown converter? Cron builder?)
3. List on RapidAPI for organic discovery
4. Have your wife design a proper brand kit for the landing page
5. Write a launch blog post
6. Post to HN / Reddit / Twitter
