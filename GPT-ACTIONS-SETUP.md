# 🤖 GPT Actions Setup Guide

This guide walks you through publishing Agent Toolbelt as a **GPT Action** so any ChatGPT user (or your own custom GPTs) can call your tools directly from a conversation.

---

## What Are GPT Actions?

GPT Actions let custom GPTs call external APIs during a conversation. When a user asks ChatGPT to "generate a JSON schema for a user profile," ChatGPT will call your Agent Toolbelt API, get the result, and present it in the conversation — and you earn per-call revenue.

---

## Prerequisites

- Agent Toolbelt deployed and accessible at a public URL (HTTPS required)
- An API key generated for the GPT to use
- An OpenAI account with access to GPT Builder (ChatGPT Plus or Team)

---

## Step 1: Generate a Dedicated API Key

Create an API key specifically for the GPT Action. This key will be stored in OpenAI's system and used for all calls from the GPT.

```bash
# Register a dedicated client for GPT Actions
curl -X POST https://yourdomain.com/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "gpt-actions@yourdomain.com", "name": "GPT Actions"}'
```

Save the returned API key (`atb_...`). You'll need it in Step 3.

**Tip:** Consider creating this on a `starter` or `pro` tier since GPT Actions can generate significant call volume.

---

## Step 2: Update the OpenAPI Spec

Open `openapi/openapi-gpt-actions.json` and replace `https://yourdomain.com` with your actual deployed URL:

```json
"servers": [
  {
    "url": "https://your-actual-domain.railway.app",
    "description": "Production"
  }
]
```

Redeploy after making this change.

---

## Step 3: Create the GPT

1. Go to **https://chat.openai.com/gpts/editor** (or ChatGPT → Explore GPTs → Create)

2. In the **Configure** tab, fill in:

   | Field | Value |
   |-------|-------|
   | **Name** | Agent Toolbelt |
   | **Description** | Generate schemas and extract structured data from text using the Agent Toolbelt API. |
   | **Instructions** | See below |

3. For **Instructions**, paste this:

```
You are a helpful assistant with access to Agent Toolbelt, a suite of API tools for working with data structures and text.

Available tools:
1. **Schema Generator** (generateSchema) — Generates JSON Schema, TypeScript interfaces, or Zod schemas from a natural language description. Use when the user needs a data model, validation schema, or type definition.

2. **Text Extractor** (extractFromText) — Extracts emails, URLs, phone numbers, dates, currencies, addresses, names, or JSON blocks from raw text. Use when the user pastes text and wants structured data pulled out.

How to use:
- When the user asks for a schema, call generateSchema with their description.
- When the user pastes text and wants data extracted, call extractFromText with their text and the appropriate extractors.
- Always present results clearly, formatting code blocks for schemas.
- If a request is ambiguous, ask which tool or format would be most helpful.
- For schema generation, default to json_schema format unless the user specifies typescript or zod.
- For text extraction, select the most relevant extractors based on what the user is looking for.
```

4. Scroll down to **Actions** → **Create new action**

5. In the Action editor:
   - **Authentication**: Click **Authentication** → select **API Key**
     - Auth Type: **Bearer**
     - API Key: Paste your `atb_...` key from Step 1
   - **Schema**: Click **Import from URL** and enter:
     ```
     https://yourdomain.com/openapi/openapi-gpt-actions.json
     ```
     Or paste the contents of `openapi/openapi-gpt-actions.json` directly.

6. **Privacy policy URL**: Enter:
   ```
   https://yourdomain.com/privacy.html
   ```

7. Click **Save** and then **Update** / **Publish**

---

## Step 4: Test It

Open your new GPT and try these prompts:

### Schema Generator
> "Generate a JSON schema for a product listing with title, price, description, and category"

> "Create a TypeScript interface for a user profile"

> "Give me a Zod schema for an event with start time, end time, and location"

### Text Extractor
> "Extract all emails and phone numbers from this text: Contact Sarah at sarah.jones@acme.com or (415) 555-0123. Also reach out to dev@startup.io for technical support."

> "Find all dates and currency amounts in: The invoice of $4,500.00 is due by March 15, 2026. A late fee of €50 applies after April 1, 2026."

> "Pull out all URLs from this paragraph: Check our docs at https://docs.example.com and our blog at https://blog.example.com/latest-updates"

---

## Step 5: Publish to the GPT Store

Once you've tested and are happy:

1. In the GPT editor → **Configure** → scroll to **Publishing**
2. Select **Everyone** to make it public in the GPT Store
3. Add a category (e.g., "Programming" or "Productivity")
4. Submit for review

**Revenue opportunity:** Every time a ChatGPT user uses your GPT, it calls your API. More users = more API calls = more billing revenue. GPTs in the store get organic discovery from millions of ChatGPT users.

---

## Architecture: How It Works

```
┌─────────────────────────────────────────────┐
│              ChatGPT / GPT Store             │
│                                              │
│  User: "Generate a schema for a user"        │
│        ↓                                     │
│  GPT sees generateSchema action available    │
│        ↓                                     │
│  Calls POST /api/tools/schema-generator      │
│  with Authorization: Bearer atb_...          │
│        ↓                                     │
│  Gets response, presents to user             │
└──────────────────┬──────────────────────────┘
                   │ HTTPS
                   ▼
┌─────────────────────────────────────────────┐
│           Agent Toolbelt (your server)       │
│                                              │
│  Auth → Rate Limit → Usage Track → Tool      │
│                                              │
│  Every call is:                              │
│  ✓ Authenticated (API key verified)          │
│  ✓ Rate limited (per-tier)                   │
│  ✓ Usage tracked (for billing)               │
│  ✓ Processed and returned                    │
└─────────────────────────────────────────────┘
```

---

## Updating Your GPT When You Add New Tools

When you add new tools to Agent Toolbelt:

1. Add the new tool's paths to `openapi/openapi-gpt-actions.json`
2. Redeploy your server
3. In the GPT editor → Actions → re-import the schema URL
4. Update the GPT Instructions to describe the new tool
5. Save and republish

**Pro tip:** The OpenAPI spec is served dynamically from your server, so you could also generate it automatically from your tool registry. A future enhancement could auto-generate the spec from registered tools.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Could not find valid auth" | Make sure auth type is Bearer and the key starts with `atb_` |
| Actions not appearing | Re-import the OpenAPI schema; check the URL is accessible |
| 401 errors in testing | Verify the API key is active: `GET /admin/clients/{id}/keys` |
| 429 errors | Your GPT key's tier limit is being hit — upgrade the tier |
| Schema import fails | Validate your JSON at jsonlint.com; ensure servers URL is correct |
| Privacy policy error | Make sure `/privacy.html` is accessible at your domain |

---

## Files Reference

| File | Purpose |
|------|---------|
| `openapi/openapi-gpt-actions.json` | OpenAPI 3.1 spec — paste/import into GPT builder |
| `public/privacy.html` | Privacy policy page (required by OpenAI) |
| `src/index.ts` | Serves `/.well-known/ai-plugin.json` discovery endpoint |

---

## What's Next

- **Add more tools** → More tools = more reasons for users to use your GPT = more revenue
- **Claude MCP** → Same tools, packaged for Claude (see future CLAUDE-MCP-SETUP.md)
- **LangChain** → Publish tools to LangChain Hub for developer discovery
- **Monitor** → Watch `/admin/usage` to see GPT-driven call volume grow
