# Claude Code Instructions

> First: read tasks/handover.md, tasks/plan.md, and tasks/context.md

## Git Commits
- Do not add "Co-Authored-By" lines to commits

## Git Safety — CRITICAL
- **NEVER use destructive git commands without explicit user approval first**
- Destructive commands include: `git restore`, `git reset`, `git checkout .`, `git clean`, `git revert` (when it would discard work)
- **ALWAYS check for uncommitted changes BEFORE any git operation**: `git status` first, then show the user what would be affected
- **ALWAYS ask the user**: "I see uncommitted changes in [files]. Do you want me to [action]? This will discard those changes."
- If the user says "revert to original", ask: "Do you want to revert to the last commit, or to a specific earlier state? I see uncommitted changes in [files] — are you okay losing those?"
- **NEVER assume**: Even if reverting seems like the right move, the uncommitted changes might be important work in progress
- This rule exists because uncommitted work has been lost multiple times — treat all uncommitted changes as sacred unless explicitly told otherwise

## Workflow Rules
- **CRITICAL: Always use agents for all tasks**: Use the Task tool with appropriate subagents for ALL coding, file editing, research, and exploration tasks. Do NOT make direct edits or run commands yourself. This is a hard requirement for every session.
  - Code changes: Use general-purpose agent
  - File searches/exploration: Use Explore agent
  - Command execution: Use Bash agent
  - Research/investigation: Use appropriate specialized agent
- **Plan first**: Enter plan mode for any non-trivial task (3+ steps). Write the plan to `tasks/plan.md` before implementing.
- **One subagent per task**: Use subagents to keep main context clean. Throw more compute at hard problems.
- **Verify before marking complete**: Never mark a task done without proving it works — run tests, check logs, diff behavior. Ask: "Would a staff engineer approve this?"
- **Demand elegance**: For non-trivial changes, consider if there's a more elegant solution. If a fix feels hacky, rebuild it properly. Don't over-engineer simple things.
- **Autonomous bug fixing**: When given a bug, go to logs, find root cause, resolve it. No hand-holding needed.
- **If something goes wrong, STOP and re-plan** — never push through a broken approach.

## Core Principles
- **Simplicity first** — touch minimal code
- **Root causes only** — no temp fixes, no workarounds
- **Never assume** — verify paths, APIs, variables before using
- **Ask once** — one question upfront if unclear, never interrupt mid-task

## Required Project Files
Every project must have these files. They are **critical** — treat them as living documents.

### 0. `.gitignore` — Always present (committed)
- Every project gets a `.gitignore` from day one
- At minimum: `.DS_Store`, `node_modules/`, `.env`, `*.log`
- Documentation files (`tasks/`, `CLAUDE.md`, `README.md`) **should be committed** — they are project knowledge that colleagues need when picking up work
- Add project-specific ignores as needed

### 0.5. `README.md` — Always present (committed)
- Every project gets a `README.md` from day one
- What the project is (1-2 sentences)
- How to run / deploy it
- Tech stack
- Keep it short and useful — not a wall of text

### 1. `CLAUDE.md` — Project-level instructions (project root)
- Project-specific Claude Code instructions (tech stack, conventions, commands, etc.)
- Lives at the project root so Claude automatically picks it up when working in that directory
- **Must reference `tasks/` folder** — first line after the title should be: `> First: read tasks/handover.md, tasks/plan.md, and tasks/context.md`
- Keep it focused on things Claude needs to know for THIS project specifically

### 2. `tasks/handover.md` — Session continuity
- **Current state**: What's done, what's in progress, what's next
- **Key decisions made**: Design choices, architecture, tech stack decisions with reasoning
- **User preferences & corrections**: If the user corrects you or reminds you to do something a certain way, log it here so it never needs repeating
- **Gotchas & pitfalls**: Things that broke, workarounds, things NOT to do
- **Open questions**: Unresolved decisions or things to ask about next session
- **Files that matter**: Key files and what they do (don't list everything, just the important ones)

### 3. `tasks/plan.md` — Project roadmap
- Goal, phases, task breakdown, skill pipeline
- Only update when the plan actually changes — tasks completed, new tasks added, approach revised
- Don't touch it if nothing changed

### 4. `tasks/context.md` — Corrections & project rules
- **Auto-updated after every correction or error fix** within the project
- Captures project-specific do's and don'ts learned from mistakes
- When you make an error and the user corrects you, or you discover something doesn't work, immediately log it here
- This ensures the same mistake is never repeated — the file becomes a growing knowledge base of what works and what doesn't for this project
- Format: `[YYYY-MM-DD] | what went wrong | rule to prevent it`

### When to update
- **tasks/context.md**: Immediately after any correction, error fix, or discovery of a project-specific rule. Don't wait — update it in the moment. ALSO: Review and update during session closing to capture any learnings that were missed.
- **tasks/handover.md**: After completing a significant task, after receiving a correction/preference, and always before ending a session.
- **tasks/plan.md**: Only when the plan actually changed.
- **CLAUDE.md**: When project conventions or tooling change.

### Session flow
1. **Session start**: Read the project's `tasks/` folder (`handover.md`, `plan.md`, `context.md`) and `CLAUDE.md` (if they exist) before doing any work.
2. **During session**: Update `tasks/handover.md` after corrections, preferences, or key decisions. Update `tasks/context.md` immediately after any correction or error fix.
3. **Before closing** (~40% context remaining): Follow the session closing checklist below.

### Session closing checklist
When you estimate ~40% context window remaining, follow this checklist:

1. **Review learnings**: What corrections, errors, or discoveries happened this session? What patterns emerged? What didn't work as expected?
2. **Update `tasks/context.md`**: Log each learning as `[YYYY-MM-DD] | what went wrong | rule to prevent it`. This is NOT optional — every session produces learnings.
3. **Update `tasks/handover.md`**: Current state, what's done, what's next, key decisions, user preferences.
4. **Update `tasks/plan.md`**: Only if the plan actually changed (tasks completed, new tasks added, approach revised).
5. **Commit & push**: All task files together with a clear commit message.

### Session management
- **Do NOT use /compact** — it doesn't work well. Instead, start fresh sessions.
- **Proactively suggest ending the session** when you estimate ~40% context window remains. Say something like: "We're getting deep into this session — I'd recommend we wrap up. Let me update the handover and you can start a fresh session."

---

## Project: PortCo Pulse

Portfolio monitoring platform for private equity firms. Built by Nick Bellamy (Firm Admin).

### Project location
`C:\Users\Nicholas\OneDrive\Documents\Portco_Pulse\portco-pulse`

### Dev commands
```bash
cd portco-pulse
pnpm dev          # Start dev server on http://localhost:3000
pnpm build        # Production build
pnpm db:seed      # Re-seed (idempotent)
pnpm db:reset     # Wipe DB + re-seed (see context.md for gotchas)
pnpm db:generate  # Regenerate Drizzle migrations after schema changes
```

### Deployment
Deployment is simple — do not over-engineer infra suggestions:
1. Copy `.env.example` → `.env.local`, fill in: `NEXTAUTH_SECRET` (generate with `openssl rand -hex 32`), `NEXTAUTH_URL` + `NEXT_PUBLIC_APP_URL` (domain), `RESEND_API_KEY`, optionally `DB_PATH` and `UPLOADS_DIR` for persistent volume paths
2. `pnpm build && pnpm start`

### Test credentials
| Role | Email | Password |
|---|---|---|
| Firm Admin | nicholasmbellamy@gmail.com | admin123 |
| Firm Member | member@meridiancp.com | member123 |
| PE Operator (company-linked) | john.davis@apex-industrial.com | operator123 |
| Independent Operator | cfo@techvault.com | ind123 |

### Tech stack
- **Framework**: Next.js 16 (App Router) + TypeScript
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **Auth**: NextAuth.js v5 (beta) with credentials provider
- **UI**: Tailwind CSS v4 + shadcn/ui
- **Charts**: Recharts
- **AI**: Anthropic SDK (claude-sonnet-4-6) — chat submission + portfolio Q&A
- **Email**: Resend (logs to console if API key is placeholder)
- **Package manager**: pnpm

---

### What the app does

Portco Pulse lets a PE firm collect KPI data and financial documents from portfolio companies on a monthly cadence, track submission status, monitor performance against plan, and receive alerts when companies go off track.

Two user types:
- **Firm users** (Admin / Member) — manage the portfolio, review data, configure settings
- **Operators** (portco-side) — submit KPIs and documents via a conversational AI chat interface (no login required, token-based link)

---

### Navigation structure

| Page | Purpose |
|---|---|
| Portfolio Dashboard | Firm-wide overview: KPI bar chart, 12-month trend, alert list, summary stat cards, portfolio Q&A chat |
| Submission Tracking | Per-period submission status matrix (KPIs + each required doc per company) |
| Company Analytics | Per-company KPI table with Actual / Plan / Var / MoM / YoY, plus Annual Plan section |
| Company Settings | Per-company config: Info, Platform Access, Notifications, KPIs, Plan Config, Required Documents |
| Firm Settings | Firm-wide config: General, Notifications, KPIs |

---

### Key data concepts

**KPIs** are configured at firm level (Firm Settings → KPIs) and can be overridden per company. Each KPI has:
- Data type: $ (dollar), % (percent), # (count)
- RAG thresholds: Green ≤ X%, Amber ≤ Y% variance from plan
- Optional alert rule: triggers email when actual crosses a threshold (e.g. Revenue < $500K = OFF TRACK)
- Direction: higher-is-better or lower-is-better (affects variance coloring)
- Collection cadence: monthly, quarterly, bi-annual (can be overridden per company)

Current firm-wide KPIs:
- Finance: Revenue, Gross Margin, EBITDA, Cash Balance, CapEx, Operating Cash Flow, Customer Acquisition Cost
- Operations: Headcount, Churn Rate, Inventory Days, NPS Score, Employee Turnover Rate

**Submissions** are monthly. Each submission period tracks:
- KPI data entry via **conversational AI chat** (Claude handles extraction from typed values, uploaded CSVs, or financial documents)
- Required documents (configurable per company): Balance Sheet, Income Statement, Cash Flow Statement, Combined Financials, Investor Update
- Submission status: Not Submitted / Partial (submitted but missing docs) / Complete
- Submitted By + Date

**Plan** (Annual Plan) is submitted separately via a token-based `/plan/...` link. Plans are per fiscal year, per KPI, with monthly targets. Operators can save drafts and resubmit. Plan data populates the Var $ and Var % columns in Company Analytics.

**Alerts** fire when a KPI crosses its alert threshold on the latest submission. Shown on Portfolio Dashboard and in Submission Tracking. Status labels: **Off Track** (red), **At Risk** (amber), **On Track** (green).

**Onboarding**: New companies can be onboarded with historical data via the same token link (redirects `/onboard/[token]` → `/submit/[token]`). The AI absorbs multiple historical periods automatically.

---

### User & access model

Three personas:
- **investor** — PE firm admin/member. Full access. `firms.orgType = "pe_firm"`
- **operator** — PE portfolio company employee. Limited: Analytics (own company) + Company Settings (KPIs tab full card list, Company Info read-only). `firms.orgType = "pe_firm"`
- **independent_operator** — Self-managed business (no PE firm). Full Company Settings access, 1-tier KPI model. `firms.orgType = "operating_company"`

Firm-level users always have access to all companies. Company-specific operators are scoped to their company only.

Sidebar navigation:
- investor: Dashboard → Submission Tracking → Analytics → Company Settings → Firm Settings
- operator: Dashboard → Analytics → Company Settings → Settings
- independent_operator: Analytics → Company Settings → Settings

---

### Notifications / Email events

Configured in Firm Settings → Notifications. Firm-wide recipients set here; additional per-company recipients set in Company Settings → Notifications.

| Event | Trigger |
|---|---|
| Submission Received | Operator submits data |
| KPI Alert | Submission triggers an alert rule |
| Monthly Digest | Monthly portfolio summary |
| Submission Reminder | Auto before deadline; also manually triggered from Submission Tracking |
| Plan Reminder | Auto on configured date (Dec 1 default) |
| Plan Submitted | Operator submits/revises annual plan |
| Platform Invitation | New user added |

Sender configured as: From Name + From Email (must be verified sender domain).

---

### Company Settings tabs

| Tab | Content |
|---|---|
| Company Info | Name, Fund, Industry, Status (Currently Held / Exited), Submission Due Date Override |
| Platform Access | Operator emails (company-level); Firm-level users shown read-only below |
| Notifications | KPI Alert + Submission Received additional recipients per company |
| KPIs | Company-specific KPI overrides (additions or threshold changes vs firm-wide) |
| Plan Config | Plan submission link for operators |
| Required Documents | Which docs are required for this company's submissions |

---

### Company Analytics detail

- Company selector tabs at top
- View toggle: Overview / Detail
- Period toggle: Monthly / Quarterly / YTD / Full Year + month picker
- KPI table columns: KPI, Actual, Plan, Var $, Var %, Prev Month, MoM%, Prior Year, YoY%, Status, Note, Investor Note
- Annual Plan section (collapsible) below KPI table: fiscal year tabs, monthly targets grid + quarterly targets
- Plan annualization: annual ÷ 12 for $ KPIs (monthly view), ÷ 4 for quarterly; % and # KPIs use annual target directly

---

### Portfolio Dashboard detail

- **Stat cards**: Total Companies, Pending Submissions (this period), Alerts (latest submission), On Plan YTD
- **Portfolio Performance chart**: Horizontal bar chart, one bar per company, showing latest submission value for selected KPI
- **Portfolio Trend chart**: Line chart, last 12 months, one line per company. Toggle: Absolute / % Change
- **Alerts section**: Lists all companies with active alerts from the latest submission
- **Portfolio Q&A**: Investor-only chat panel for natural-language queries across portfolio data

---

### Submission Tracking detail

- Month selector (e.g. 2026-03)
- Summary: Complete / Partial / Missing counts
- Table: One row per company, columns for Status + each document type + KPIs
- Actions: Copy Link (operator submission link), Remind (sends submission reminder email)

---

### Chat submission system

The operator submission flow uses a conversational AI interface (Claude claude-sonnet-4-6):
- `app/submit/[token]/` — main submission page (periodic + onboarding modes)
- `lib/chat/handler.ts` — shared Anthropic streaming handler, tools: `submit_structured_data`, `suggest_quick_replies`, `request_clarification`
- `lib/chat/system-prompt.ts` — per-company system prompt with historical context, enabled KPIs, prior period data
- `lib/chat/session.ts` — persistent chat history stored in `kpi_values` (session key = company + period)
- `app/api/chat/submit` — periodic submission endpoint
- `app/api/chat/onboard` — historical onboarding endpoint (absorbs multiple periods)
- `app/api/chat/plan` — plan submission endpoint
- `app/api/chat/qa` — portfolio Q&A (investor-only, single-turn, no history)
- `app/api/chat/context` — hydrates ChatInterface for firm-side users

---

### Current portfolio companies (seed data)

8 PE companies across funds and industries:
- Apex Industrial Manufacturing (Industrial, Fund I)
- Brighton Healthcare Group (Healthcare)
- Culinary Concepts (Consumer Services)
- Evergreen Fitness (Consumer Discretionary)
- Keystone Logistics (Logistics)
- OptiFi Solutions (FinTech)
- StreamVibe Media (Digital Media)
- Veridian Software (Software/SaaS)

Plus 1 independent operator: TechVault Inc. (`cfo@techvault.com`)

---

### Architecture notes

- **Edge Runtime split**: `lib/auth/edge-config.ts` (no DB imports, for middleware) vs `lib/auth/config.ts` (full, with DB)
- **Analytics query layer**: All DB reads go through `lib/server/analytics.ts` — never direct DB calls from pages (exception: admin pages use db directly)
- **DB path**: `portco-pulse.db` at project root (configurable via `DB_PATH` env var)
- **Uploads**: `/uploads` folder at project root (configurable via `UPLOADS_DIR` env var)
- **Schema**: 15 tables — firms, companies, firm_link_tokens, users, periods, kpi_definitions, submissions, kpi_values, threshold_rules, alerts, financial_documents, email_settings, user_access_scopes, kpi_plans, kpi_plan_values
- **`pnpm db:reset`** is the ONLY command needed — seed.ts embeds all manual migrations

---

### What to keep in mind when building

- **Database migrations** — schema changes must go through Drizzle + manual node script. See `tasks/context.md` for the exact pattern.
- **Don't break existing filter state** — filters (Fund, Industry, Status) are global and persist across pages
- **RAG logic is directional** — some KPIs are lower-is-better (CapEx, Churn Rate, Employee Turnover, Inventory Days). Variance coloring must respect direction.
- **Submission status has three states** — Not Submitted, Partial, Complete. Partial = KPIs submitted but required docs missing.
- **Plan vs submission are separate flows** — Plan is submitted via `/plan/...` token link separately from the monthly KPI submission
- **Operator access is unauthenticated** — submission and plan forms are public token-based URLs, no login
- **Firm users are authenticated** — the main app requires login
- **Email sender domain must be verified** — don't hardcode sender; it comes from Firm Settings
- **Per-company overrides cascade** — firm-wide KPI config is the default; company-level settings override it
- **KPI value formatting** — suppress `#` unit; `$` prefix for currency; `%` suffix for percentage; nothing else
- **Status labels** — always "On Track / At Risk / Off Track" (not High/Medium/Low or Green/Amber/Red as text)
- **All code must be production-ready** — see `tasks/context.md` for production standards
- **Seed is source of truth for KPI config** — UI changes to KPI config revert on `db:reset`; always update `scripts/seed.ts` too
