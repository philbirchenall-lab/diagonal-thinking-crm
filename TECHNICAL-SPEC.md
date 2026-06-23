# Diagonal Thinking CRM — Living Technical Specification

> **Purpose:** Any agent (Codex sub-task, diagnostic session, or Dispatch) should be able to read this document cold and immediately understand the full system architecture without needing to grep the codebase.
>
> **Maintained by:** Claude Code (Dispatch) — update after every significant feature or architecture change.
> **Last updated:** 5 April 2026

---

## 1. System Overview

Diagonal Thinking CRM is a single-page React application (built with Vite) deployed on Vercel, backed by Supabase (Postgres + Edge Functions). It serves as the internal operations hub for Diagonal Thinking — a UK-based AI consultancy run by Phil Birchenall — and comprises three logical areas:

1. **CRM** (`crm.diagonalthinking.co`) — Contact management: create/edit/delete contacts, pipeline value tracking, CSV import/export, Mailchimp sync.
2. **Proposals** (`proposals.diagonalthinking.co`) — Proposal authoring in the CRM; the public viewer is a **separate Vercel project** (`dt-proposals`, not in this repository).
3. **Client Area** — ⚠️ verify — referenced in the project backlog (CA-001 through CA-004) but no implementation files found in this repository. Likely a planned or separate deployment.

The stack is: **Vite + React 19** (frontend) · **Supabase** (Postgres, RLS, Edge Functions, database webhooks) · **Vercel** (hosting, serverless API functions) · **Mailchimp** (audience sync) · **Resend** (transactional email) · **Squarespace** (public website + contact forms).

---

## 2. Repository Structure

```
diagonal-thinking-crm/
├── api/
│   └── mailchimp-sync.js          # Vercel serverless function — batch Mailchimp sync
├── public/
│   └── favicon.png                # App favicon
├── setup/
│   ├── schema.sql                 # Supabase schema (run manually in SQL Editor)
│   └── mailchimp-setup.md         # Step-by-step guide to activate Mailchimp webhook sync
├── sheets-api/
│   ├── README.md                  # Legacy Google Sheets backend docs (historical)
│   └── load-initial-data.js       # One-time data migration script (historical)
├── src/
│   ├── main.jsx                   # React entry point — wraps App in AuthWrapper
│   ├── App.jsx                    # Main CRM app (~35K lines) — contacts, proposals UI, Mailchimp
│   ├── AuthWrapper.jsx            # Supabase auth guard; falls back to local mode if no VITE_SUPABASE_URL
│   ├── db.js                      # Data access layer — abstracts Supabase vs. local Express API
│   └── proposals/
│       ├── ProposalForm.jsx        # Modal: cover fields + editor + preview + contact link
│       ├── ProposalEditor.jsx      # TipTap rich text editor with Placeholder extension
│       ├── ProposalPreview.jsx     # Renders TipTap JSON as styled HTML
│       ├── EditorToolbar.jsx       # Formatting buttons (Bold, Italic, H2, lists, etc.)
│       ├── TextImporter.jsx        # Collapsible text import UI
│       ├── proposalTemplates.js    # TipTap doc factory functions (generic + workshop templates)
│       └── proposalParser.js      # Regex-based text importer — extracts cover fields + body
├── supabase/
│   ├── config.toml                # Supabase local dev config
│   └── functions/
│       ├── contact-form/
│       │   └── index.ts           # Edge Function — public contact form handler (Squarespace)
│       ├── mailchimp-sync/
│       │   └── index.ts           # Edge Function — database webhook handler for Mailchimp
│       └── register-interest/
│           └── index.ts           # Edge Function — "Agent Advantage Page" lead registration
├── .env.example                   # Template for required environment variables
├── CODEX-BACKLOG.md               # Feature backlog + status tracking
├── TECHNICAL-SPEC.md              # This file
├── package.json                   # Vite + React 19 + Supabase JS + TipTap + Recharts
├── vite.config.js                 # Vite config with manual chunk splitting
└── vercel.json                    # SPA rewrite rule (non-API → index.html)
```

**Notable absences:**
- No `migrations/` directory — schema changes are applied manually via the Supabase SQL Editor using `setup/schema.sql`.
- No `.github/workflows/` — no CI/CD pipelines configured.
- No `dt-proposals` directory — the public proposal viewer is a separate repository/deployment.

---

## 3. Environment Variables

### 3a. Vercel (CRM app — `crm.diagonalthinking.co`)

| Variable | Service | Required | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Supabase | Required | Enables Supabase mode; without it the app falls back to local Express API |
| `VITE_SUPABASE_ANON_KEY` | Supabase | Required | Public anon key used by the frontend client; also used as fallback service key in `api/_lib/client-area.js` when `SUPABASE_SERVICE_ROLE_KEY` is absent |
| `MAILCHIMP_API_KEY` | Mailchimp | Required for MAIL-001/002 | Used by `api/mailchimp-sync.js` · **NOT YET SET** as of 2 Apr 2026 |
| `MAILCHIMP_AUDIENCE_ID` | Mailchimp | Required for MAIL-001/002 | Used by `api/mailchimp-sync.js` · **NOT YET SET** as of 2 Apr 2026 |

### 3b. Vercel (`dt-proposals` — separate project, `proposals.diagonalthinking.co`)

| Variable | Service | Required | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | Resend | Required for PROP-005 | Email sending · **NOT YET SET** as of 2 Apr 2026 |

### 3c. Supabase Edge Function Secrets

Stored via `supabase secrets set <KEY>=<VALUE>` and accessed via `Deno.env.get()`.

| Variable | Used in | Required | Notes |
|---|---|---|---|
| `SUPABASE_URL` | All Edge Functions | Required | Auto-injected by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | `contact-form`, `register-interest` | Required | Auto-injected by Supabase runtime |
| `MAILCHIMP_API_KEY` | `contact-form`, `mailchimp-sync`, `register-interest` | Required | Must be set via `supabase secrets set` |
| `MAILCHIMP_AUDIENCE_ID` | `mailchimp-sync` | Required | Must be set via `supabase secrets set` |
| `MAILCHIMP_SERVER` | `mailchimp-sync` | Required | e.g. `us8` — must be set via `supabase secrets set` |
| `RESEND_API_KEY` | `contact-form` | Optional | If absent, notification emails are silently skipped |

### 3d. Local Development Only

| Variable | Used in | Notes |
|---|---|---|
| `SUPABASE_URL` | `sheets-api/load-initial-data.js` | Local two-way sync script (legacy) |
| `SUPABASE_SERVICE_KEY` | `sheets-api/load-initial-data.js` | Local service role key (legacy) |

---

## 4. External Services

### Supabase
- **What it does:** Primary data store (Postgres), authentication (magic link/email), Row Level Security, and Edge Function hosting.
- **How it's connected:** Frontend uses `@supabase/supabase-js` with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Edge Functions use injected `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- **Key identifiers:**
  - Project ref: `unphfgcjfncnqhpvmrvf`
  - Edge Function base URL: `https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/`
- **RLS:** All contacts/proposals tables require `auth.role() = 'authenticated'`. Edge Functions use the service role key to bypass RLS.

### Vercel
- **What it does:** Hosts the SPA (static build) and serverless API functions under `/api/`.
- **How it's connected:** Automatic deploys from the `main` branch of this repo. `vercel.json` rewrites all non-API routes to `index.html`.
- **Projects:**
  - `diagonal-thinking-crm` → `crm.diagonalthinking.co`
  - `dt-proposals` → `proposals.diagonalthinking.co` (separate repo ⚠️ verify project name)

### Mailchimp
- **What it does:** Email marketing audience. Contacts are synced from Supabase to keep the Mailchimp audience up to date.
- **How it's connected:** Two sync paths:
  1. **Batch sync** (MAIL-001): CRM UI button → `POST /api/mailchimp-sync` (Vercel serverless) → Mailchimp Batch Members API
  2. **Auto-sync** (MAIL-002): Contact save in CRM → `POST /api/mailchimp-sync` (single contact, background)
  3. **Webhook sync**: Database change → Supabase webhook → `mailchimp-sync` Edge Function → Mailchimp Member API
  4. **Form ingest**: `contact-form` + `register-interest` Edge Functions sync on new contact creation
- **Key identifiers:**
  - Audience ID: `d89fc8d69c`
  - Server prefix: `us8`
  - Required custom merge fields: `COMPANY` (Text), `CRM_TYPE` (Text), `PHONE`, `SERVICES`, `NETPARTNER` (Text), `SOURCE`
  - ⚠️ Mailchimp merge field tags max 10 chars — tag is `NETPARTNER` not `NETWORK_PARTNER`

### Resend
- **What it does:** Transactional email. Currently used for two purposes:
  1. Internal notification email to `phil@diagonalthinking.co` on new contact form submission
  2. Proposal email to client (`api/send-proposal.js` — PROP-005, live)
- **How it's connected:** `contact-form` Edge Function calls Resend API directly. Proposal send is in `api/send-proposal.js` (Vercel serverless).
- **Sender address:** `notifications@diagonalthinking.co`
- **CC behaviour (PROP-014):** All proposal emails CC `phil@diagonalthinking.co` so Phil always receives a copy alongside the client.

### Squarespace
- **What it does:** Public marketing website (`diagonalthinking.co`). Contact forms on the site post to the `contact-form` Edge Function.
- **How it's connected:** Squarespace form action POSTs to `https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/contact-form`.
- **Also uses:** `register-interest` Edge Function for the "Agent Advantage Page" lead capture form.

### GitHub
- **What it does:** Source control. No GitHub Actions CI/CD configured.
- **Repo:** `diagonal-thinking-crm` (private)
- **Main branch:** `main` — Vercel auto-deploys on push.

---

## 5. Feature Annex

---

### F-01 — Contact Form → CRM Integration

**What it does:** Squarespace contact form submissions are captured, saved to Supabase `contacts` table, synced to Mailchimp, and trigger a notification email to Phil.

**Status:** Live

**Key files:**
- `supabase/functions/contact-form/index.ts`

**Entry point:** `POST https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/contact-form`

**Dependencies:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)
- `MAILCHIMP_API_KEY` (Supabase secret)
- `RESEND_API_KEY` (Supabase secret — optional; skips notification email if absent)

**Behaviour:**
- Upserts contact to `contacts` table (type: `"Enquiry"`, source: `"Squarespace"`) on conflict by email
- Inserts to `enquiries` table for a log trail
- Non-blocking Mailchimp sync (failure doesn't break response)
- Non-blocking Resend notification (failure doesn't break response)

**Known issues / notes:**
- Mailchimp audience ID (`d89fc8d69c`) and server (`us8`) are hardcoded in this function. They differ from the `mailchimp-sync` Edge Function which reads from env vars.
- `enquiries` table must exist in Supabase — not in `setup/schema.sql` ⚠️ verify schema.

---

### F-02 — Register Interest (Agent Advantage Page)

**What it does:** Lead capture form on the "Agent Advantage Page" of the Squarespace site.

**Status:** Live

**Key files:**
- `supabase/functions/register-interest/index.ts`

**Entry point:** `POST https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/register-interest`

**Dependencies:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)
- `MAILCHIMP_API_KEY` (Supabase secret)

**Behaviour:** Accepts `first_name`, `last_name`, `email`, `company`, `phone`. Upserts contact (type: `"Warm Lead"`, source: `"Agent Advantage Page"`). Non-blocking Mailchimp sync.

**Known issues / notes:** Mailchimp audience ID and server hardcoded (same as `contact-form`).

---

### F-03 — Mailchimp Sync — Bulk Button (MAIL-001)

**What it does:** "Sync to Mailchimp" toolbar button in the CRM sends all contacts (or selected contacts) to the Mailchimp audience in batches of 500.

**Status:** Deployed but blocked — `MAILCHIMP_API_KEY` and `MAILCHIMP_AUDIENCE_ID` not yet added to Vercel CRM env vars (as of 2 Apr 2026).

**Key files:**
- `api/mailchimp-sync.js` — Vercel serverless handler
- `src/App.jsx` — `handleMailchimpSync()` function, toolbar button UI

**Entry point:** `POST /api/mailchimp-sync`

**Dependencies:**
- `MAILCHIMP_API_KEY` (Vercel env var — not yet set)
- `MAILCHIMP_AUDIENCE_ID` (Vercel env var — not yet set)

**Known issues / notes:** Datacenter prefix is derived from the API key suffix (e.g. `abc-us21` → `us21`), so `MAILCHIMP_SERVER` is not needed for this path.

---

### F-04 — Mailchimp Sync — Auto-Sync on Save (MAIL-002)

**What it does:** Every time a contact is saved in the CRM, a background POST to `/api/mailchimp-sync` fires automatically (single contact, non-blocking).

**Status:** Deployed — awaiting MAIL-001 activation (API keys in Vercel env vars).

**Key files:**
- `src/App.jsx` — save handler fires background sync
- `api/mailchimp-sync.js` — same endpoint as MAIL-001

**Entry point:** `POST /api/mailchimp-sync` (called internally on contact save)

**Dependencies:** Same as MAIL-001 — `MAILCHIMP_API_KEY`, `MAILCHIMP_AUDIENCE_ID` in Vercel env vars.

**Known issues / notes:** Failures are logged to console only and do not surface to the user.

---

### F-05 — Mailchimp Sync — Database Webhook (MAIL-002 backend)

**What it does:** Supabase database webhook fires on INSERT/UPDATE/DELETE to the `contacts` table and calls the `mailchimp-sync` Edge Function to keep Mailchimp in sync.

**Status:** Deployed (Edge Function live). Webhook must be configured manually in the Supabase dashboard.

**Key files:**
- `supabase/functions/mailchimp-sync/index.ts`
- `setup/mailchimp-setup.md` — setup guide

**Entry point:** `POST https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/mailchimp-sync`

**Dependencies:**
- `MAILCHIMP_API_KEY`, `MAILCHIMP_AUDIENCE_ID`, `MAILCHIMP_SERVER` (Supabase secrets)

**Field mapping:**

| Supabase column | Mailchimp merge field |
|---|---|
| `contact_name` (first word) | `FNAME` |
| `contact_name` (remainder) | `LNAME` |
| `company` | `COMPANY` |
| `phone` | `PHONE` |
| `type` | `CRM_TYPE` |
| `services` (array → comma string) | `SERVICES` |
| `network_partner` (bool → Yes/No) | `NETPARTNER` (renamed from `NETWORK_PARTNER` — Mailchimp tag limit is 10 chars) |
| `source` | `SOURCE` |

**Known issues / notes:** JWT verification is disabled (`verify_jwt = false` in `supabase/config.toml`) — the webhook does not send a JWT so this is intentional.

---

### F-06 — CRM Contacts (Core)

**What it does:** Full contact management — list, search/filter, create, edit, delete, CSV import/export, pipeline value tracking.

**Status:** Live

**Key files:**
- `src/App.jsx` — entire CRM UI
- `src/db.js` — data access layer
- `src/AuthWrapper.jsx` — auth guard
- `setup/schema.sql` — database schema

**Entry point:** `https://crm.diagonalthinking.co`

**Dependencies:**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

**Data model (contacts table):**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK, auto-generated |
| `company` | TEXT | |
| `contact_name` | TEXT | |
| `email` | TEXT | Unique conflict key for upserts |
| `phone` | TEXT | |
| `type` | TEXT | Client / Warm Lead / Cold Lead / Mailing List |
| `services` | TEXT[] | Multi-select from fixed list |
| `projected_value` | NUMERIC | Pipeline value |
| `total_client_value` | NUMERIC | ⚠️ verify — added via CRM-004, not in schema.sql |
| `live_work_value` | NUMERIC | ⚠️ verify — added via CRM-004, not in schema.sql |
| `notes` | TEXT | |
| `source` | TEXT | |
| `date_added` | TEXT | YYYY-MM-DD string |
| `last_updated` | TEXT | YYYY-MM-DD string |
| `linkedin_url` | TEXT | |
| `network_partner` | BOOLEAN | ⚠️ verify — not in schema.sql |
| `created_at` | TIMESTAMPTZ | Auto |
| `research_notes` | TEXT | Call prep / prospect intel (freeform markdown) — added CRM-007 |
| `research_updated_at` | TIMESTAMPTZ | Auto-set when research saved — added CRM-007 |
| `research_source` | TEXT | e.g. "Sol call prep — 9 Apr 2026" — added CRM-007 |
| `research_updated_by` | TEXT | e.g. "Sol" — added CRM-007 |
| `platforms` | TEXT[] | AI platforms used by the client (ChatGPT / Anthropic Claude / Microsoft Copilot / Google Gemini / Other) — added CRM-008 |

**Known issues / notes:**
- `setup/schema.sql` reflects the initial schema. `network_partner`, `total_client_value`, `live_work_value`, and the four `research_*` columns were added via later migrations and are not in the SQL file.
- Research fields are intentionally excluded from `toSnake()` in `db.js` — standard contact saves never overwrite them. Use `saveContactResearch()` for targeted updates.
- RLS requires authenticated session — all reads/writes must go through an authenticated Supabase client.
- In local mode (no `VITE_SUPABASE_URL`), the app falls back to a local Express API on `http://localhost:3001/api/contacts`.

---

### F-07 — Proposals App (Authoring)

**What it does:** Create, edit, and manage proposals from within the CRM. Each proposal has cover fields (client name, program title, date, etc.) plus a rich text body authored in TipTap. Proposals are assigned a 6-char alphanumeric code for public sharing.

**Status:** Live (authoring); PROP-005 email send blocked.

**Key files:**
- `src/proposals/ProposalForm.jsx` — main modal (cover + editor + preview)
- `src/proposals/ProposalEditor.jsx` — TipTap editor
- `src/proposals/ProposalPreview.jsx` — styled HTML preview
- `src/proposals/EditorToolbar.jsx` — formatting controls
- `src/proposals/TextImporter.jsx` — paste-in text import
- `src/proposals/proposalTemplates.js` — template factory functions
- `src/proposals/proposalParser.js` — text-to-TipTap parser
- `src/db.js` — `loadProposals()`, `saveProposal()`, `deleteProposal()`

**Entry point:** Proposals tab in the CRM UI at `https://crm.diagonalthinking.co`

**Dependencies:**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `RESEND_API_KEY` (Vercel env var on `dt-proposals` — for PROP-005 email send, not yet set)

**Data model (proposals table):**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `slug` | TEXT | program-title-client-name-xxxx |
| `proposal_code` | TEXT | 6-char alphanumeric, read-only |
| `client_name` | TEXT | |
| `program_title` | TEXT | |
| `subtitle` | TEXT | |
| `prepared_for` | TEXT | |
| `prepared_by` | TEXT | Default: "Phil Birchenall, DIAGONAL // THINKING" |
| `date` | TEXT | DD Month YYYY format |
| `footer_label` | TEXT | Default: "The AI Advantage" |
| `tiptap_json` | JSONB | Full TipTap document JSON |
| `is_active` | BOOLEAN | |
| `contact_id` | UUID | FK to contacts (nullable) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Known issues / notes:**
- Draft auto-saved to `localStorage` to prevent data loss on accidental close.
- Public viewer is at `https://proposals.diagonalthinking.co/view?code=XXXXXX` — this is a **separate Vercel project** (`dt-proposals`), not in this repo.
- PDF generation URL base: `https://proposals.diagonalthinking.co/api/proposals/{id}`.

---

### F-08 — Proposals Panel in CRM Contact Record (PROP-009)

**What it does:** Read-only "Proposals" section in the contact detail modal sidebar. Shows all proposals linked to the contact (by `contact_id`, with `client_name` fallback), each with title, date, view count badge, and a Preview PDF link.

**Status:** Deployed — awaiting live verification.

**Key files:**
- `src/App.jsx` — contact detail modal sidebar (proposals panel section)
- `src/db.js` — `loadContactProposals()`, `loadProposalAccesses()`

**Entry point:** Contact detail modal in the CRM

**Dependencies:**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `proposal_access` table in Supabase (⚠️ verify — not in schema.sql)

---

### F-09 — Client Area

**What it does:** Client-facing area with magic link authentication, registration, and session management. Admin side lives in `src/clientArea.jsx` (CRM tab). Client-facing side is a **separate Next.js app** deployed to `client.diagonalthinking.co`.

**Status (CRM admin side):** Live — `ClientAreaTab`, `SessionEditorModal`, `ContactSessionsPanel` all deployed.
**Status (client-facing Next.js app):** Live at `client.diagonalthinking.co`. Lives in this repo under `client-area/` (registration, magic-link auth, and session pages).

**Key files (CRM admin side — this repo):**
- `src/clientArea.jsx` — CRM admin UI (session list, session editor, contact sessions panel)
- `api/client/sessions.js` — Vercel serverless: GET/POST/PATCH client sessions
- `api/client/auth/` — Magic link request and verification endpoints
- `api/_lib/client-area.js` — Shared logic: DB queries, email sending, slug generation

**Data model (Supabase tables used by Client Area):**

| Table | Purpose |
|---|---|
| `sessions` | Session records (name, slug, org, date, status) |
| `resources` | Resources per session (label, type, url, sort_order) |
| `engagement_log` | Event log — registrations (`event_type=resource_click, resource_id=null`) and resource opens |
| `magic_links` | One-time auth tokens (contact_id, session_slug, token, expires_at) |
| `contacts` | Linked organisation and registrant data |

**Engagement log entry shape (as returned to the UI in session.engagementLog):**

| Field | Notes |
|---|---|
| `id` | UUID |
| `contactId` | contact_id from DB — added 3 Apr 2026 (CC-D, CA-FE-006) |
| `eventType` | e.g. `resource_click` |
| `occurredAt` | Formatted datetime string (en-GB) |
| `occurredAtRaw` | ISO timestamp — added 3 Apr 2026 for future sorting use |
| `contactName` | Resolved contact name |
| `email` | Resolved contact email |
| `company` | Resolved contact company — added 3 Apr 2026 |
| `resourceLabel` | Resolved resource label |
| `resourceId` | resource_id from DB — added 3 Apr 2026 |

**Registration -> contact categorisation:**

When someone registers to access a Client Area, `ensureContactForSessionRegistration` (`client-area/src/lib/client-server.ts`) sets the contact `type` from the session type:

- Non-Open-Event sessions (in-house): the registrant is a client. A new contact is created with `type = "Client"`; an existing contact is raised to `Client`.
- Open Event sessions: the registrant stays on the `Mailing List`. A new contact is created with `type = "Mailing List"`; an existing contact's type is left unchanged.

Session type is resolved by `inferSessionType` (`client-area/src/lib/client-data.ts`), which yields `"open_event"` or `"in_house"`. There is no `session_type` column on the `sessions` table: the type is read from a `status::type` encoding when present, otherwise derived from `organisation_id` (null = Open Event, set = in-house). Open Events are always stored with a null `organisation_id` (`api/_lib/client-area.js`), so in current live data the gate keys off `organisation_id`. Verified 23 Jun 2026 against the live schema: 1 Open Event (CBSA, null org) and 18 in-house (org set).

> **Gotcha for future work (schema vs derived value):** always resolve session type through `inferSessionType`, never a raw `SELECT session_type FROM sessions`. Migration `20260402153305_add-session-type-to-sessions.sql` is empty (0 bytes) and the `session_type` column was never created in the live DB, so a raw column read returns nothing and any gate built on it would silently never fire. There is no `get_public_session_meta` RPC in this repo or the live DB either. The canonical source is the `inferSessionType` resolver.

CRM status never downgrades. The upgrade is gated by a contact-type rank (`Client` > `Warm Lead` > `Cold Lead` > `Mailing List`), so an existing `Client`, `Warm Lead`, or `Cold Lead` is never lowered to a weaker type. Changed 23 Jun 2026.

**Known issues / notes:**
- CA-BUG-001 (Open Resource button) is high priority and likely a missing href/click handler in the resource list component.

---

### F-10 — Supabase Schema Migrations

**What it does:** Database schema management.

**Status:** Manual — no automated migration runner.

**Key files:**
- `setup/schema.sql` — initial schema (contacts table + RLS + indexes)

**Notes:**
- All schema changes are applied manually via the Supabase SQL Editor.
- `setup/schema.sql` is the initial schema only. The following columns were added later and are **not** captured in the file:
  - `network_partner` (BOOLEAN)
  - `total_client_value` (NUMERIC) — CRM-004
  - `live_work_value` (NUMERIC) — CRM-004
  - `platforms` (TEXT[]) — CRM-008
- There is no `proposals` or `proposal_access` table definition in any file in this repo — those were created directly in the Supabase dashboard ⚠️ verify.

---

### F-11 — GitHub Actions / CI-CD

**What it does:** Automated build/test/deploy.

**Status:** Not configured. No `.github/workflows/` directory exists.

**Notes:**
- Deployments are triggered automatically by Vercel on push to `main`.
- No test suite, linting CI, or staging environment is configured.

---

### F-13 — Mailchimp Segmentation Fields (CRM-011)

**What it does:** Extends the Mailchimp sync to push segmentation data from the CRM, enabling audience filtering and targeted campaigns in Mailchimp.

**Status:** Deployed — 3 April 2026.

**Key files:**
- `api/mailchimp-sync.js` — all changes live here

**Entry point:** `POST /api/mailchimp-sync` (same endpoint as F-03/F-04)

**Dependencies:**
- `MAILCHIMP_API_KEY`, `MAILCHIMP_AUDIENCE_ID` (Vercel env vars)
- `MAILCHIMP_SERVER` (optional — derived from API key if absent)

**Behaviour:**

1. **Merge field bootstrap** — on every request, `ensureMergeFields()` fetches the audience's existing merge fields and creates `NETPARTNER` (text) and `CRM_TYPE` (text) if they are not already present. This is a no-op after the first successful run. Failures are now logged (not silently swallowed) to aid diagnosis.

2. **Per-contact merge field values** — each member payload now includes:

| CRM field | Mailchimp merge field tag | Value |
|---|---|---|
| `network_partner` (boolean) | `NETPARTNER` | `"Yes"` or `"No"` |
| `type` (string) | `CRM_TYPE` | verbatim string e.g. `"Client"`, `"Warm Lead"` |

> ⚠️ **Important**: Mailchimp merge field tags are limited to **10 characters**. The tag is `NETPARTNER` (10 chars), not `NETWORK_PARTNER` (15 chars). Using the longer form causes silent rejection by the Mailchimp API — this was the root cause of MAIL-BUG-003.

3. **Per-contact service tags** — after each batch upsert, `applyServiceTags()` fires a `POST /lists/{id}/members/{hash}/tags` call for every contact that has a non-empty `services` array. Each service string becomes a Mailchimp tag set to `status: "active"`. Tags already on the contact that are not in the current `services` list are **not** removed — this preserves any tags applied manually or from other sources.

**Field mapping summary (full set after CRM-011):**

| CRM field | Mailchimp destination | Notes |
|---|---|---|
| `fname` | `FNAME` merge field | |
| `lname` | `LNAME` merge field | |
| `company` | `COMPANY` merge field | |
| `pipeline` | `PIPELINE` merge field | |
| `services` (array) | `SERVICES` merge field (comma string) + individual tags | Both written |
| `network_partner` (bool) | `NETPARTNER` merge field | `"Yes"` / `"No"` — tag is 10 chars max |
| `type` (string) | `CRM_TYPE` merge field | |

**Known issues / notes:**
- `applyServiceTags()` makes one API call per contact with services, sequentially within each batch. For a typical CRM of <500 contacts this is acceptable.
- Services removed from a CRM contact are not removed as Mailchimp tags in this version. Only additions are synced.
- The `SERVICES` merge field (comma-separated string) is retained alongside the tag-based approach for backwards compatibility with any existing Mailchimp segments or automations that use it.

---

### F-12 — Nightly Log / Backlog Automation

**What it does:** Automated nightly status summaries and backlog updates.

**Status:** Live — managed externally via Claude Code scheduled tasks (not in this repository).

**Notes:**
- Scheduled agents run outside this codebase via the Claude Code Dispatch / scheduled task system.
- They write to `CODEX-BACKLOG.md` and produce status summaries.
- No cron or GitHub Action is involved.

---

## 6. Deployment Checklist

Use this when deploying a new feature.

### New Vercel Serverless Function (`/api/*.js`)
- [ ] Add required env vars in Vercel → Project → Settings → Environment Variables
- [ ] Push to `main` — Vercel auto-deploys
- [ ] Verify function at `https://crm.diagonalthinking.co/api/<function-name>`

### New Supabase Edge Function
- [ ] Create function file at `supabase/functions/<name>/index.ts`
- [ ] Set any required secrets: `supabase secrets set KEY=value`
- [ ] Deploy: `supabase functions deploy <name> --no-verify-jwt` (or without the flag if JWT is needed)
- [ ] If triggered by webhook: create Database Webhook in Supabase dashboard → Database → Webhooks
  - Table: the target table
  - Events: INSERT / UPDATE / DELETE (as needed)
  - Endpoint: `https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/<name>`

### Schema Change
- [ ] Write and test SQL in Supabase SQL Editor (supabase.com → project `unphfgcjfncnqhpvmrvf`)
- [ ] Update `setup/schema.sql` to keep it as a reference
- [ ] Note the change in `CODEX-BACKLOG.md`

### New Frontend Feature (with Supabase dependency)
- [ ] Confirm the required Supabase table/columns exist
- [ ] Ensure RLS policy covers the new operation
- [ ] Add env vars if any new secrets are needed
- [ ] Push to `main` — Vercel auto-deploys

### Unblocking MAIL-001/MAIL-002 (Mailchimp)
1. Go to Vercel → `diagonal-thinking-crm` → Settings → Environment Variables
2. Add `MAILCHIMP_API_KEY` and `MAILCHIMP_AUDIENCE_ID`
3. Redeploy (trigger a new deployment or use "Redeploy" in Vercel dashboard)
4. Test: open CRM → Toolbar → "Sync to Mailchimp"

### Unblocking PROP-005 (Resend proposal email)
1. Go to Vercel → `dt-proposals` → Settings → Environment Variables
2. Add `RESEND_API_KEY`
3. Redeploy the `dt-proposals` project
4. Test: open a proposal → "Send to client" button

---

## 7. Key Constants (hardcoded in source)

| Constant | Value | Location |
|---|---|---|
| Mailchimp Audience ID | `d89fc8d69c` | `contact-form/index.ts`, `register-interest/index.ts` |
| Mailchimp Server | `us8` | `contact-form/index.ts`, `register-interest/index.ts` |
| Supabase project ref | `unphfgcjfncnqhpvmrvf` | `setup/mailchimp-setup.md` |
| Proposals viewer URL | `https://proposals.diagonalthinking.co/view` | `src/App.jsx:1319` |
| Proposals PDF base URL | `https://proposals.diagonalthinking.co/api/proposals` | `src/App.jsx:1242` |
| Default prepared_by | `Phil Birchenall, DIAGONAL // THINKING` | `src/proposals/ProposalForm.jsx` |
| Default footer label | `The AI Advantage` | `src/proposals/ProposalForm.jsx` |
| Notification email recipient | `phil@diagonalthinking.co` | `supabase/functions/contact-form/index.ts` |
| Notification email sender | `notifications@diagonalthinking.co` | `supabase/functions/contact-form/index.ts` |
