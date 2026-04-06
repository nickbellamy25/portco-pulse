# Handover — PortCo Pulse

## Current state (as of 2026-04-06)

The app is fully functional as a local prototype. The most recent major feature — the **conversational AI submission system** — was completed in early April 2026. All core features are working and the seed data round-trips cleanly via `pnpm db:reset`.

---

## What's done

### Auth + Core
- Full auth: login, JWT sessions (8h maxAge), firm/company scoping, invite flow
- Portfolio Dashboard: stat tiles, Portfolio Performance chart, Portfolio Trend chart, active alerts, plan attainment, Portfolio Q&A chat (investor-only)
- Submission Tracking: period selector, summary stats, status matrix table, per-company reminder buttons
- Company Analytics: Overview + Detail tabs, Monthly / Quarterly / YTD / Full Year views, Annual Plan section
- Plan submission form (`/plan/[token]`): fiscal year selector, monthly/annual granularity, versioning, investor comments
- Admin: Companies (full settings page), Periods, Firm Settings (General + Notifications + KPIs), Data page

### KPI System
- Firm-wide KPI definitions + per-company overrides (thresholds, cadence, alerts, RAG)
- Plan data: `kpi_plans` + `kpi_plan_values` tables, plan form, plan review in Analytics
- RAG status computed from plan vs actual (or threshold rule if no plan)
- Per-KPI investor annotations, RAG overrides, investor notes, operator notes
- Plan attainment tile on Dashboard
- Plan annualization: ÷12 per month for $ KPIs; % and # KPIs use annual target directly
- Aggregation rules: $ → sum, % → average, # → last (end-of-period stock metric)

### Chat Submission System (newest feature, Apr 2026)
- Conversational AI interface for operators to submit KPI data
- Supports periodic submissions, historical onboarding, plan submissions
- `lib/chat/handler.ts` — streaming Anthropic handler with tools: `submit_structured_data`, `suggest_quick_replies`, `request_clarification`
- `lib/chat/system-prompt.ts` — per-company context injection (KPIs, prior period, historical data, required docs)
- `lib/chat/session.ts` — persistent chat history
- `app/api/chat/submit` — periodic endpoint
- `app/api/chat/onboard` — historical onboarding (absorbs multiple periods in one session)
- `app/api/chat/plan` — plan submission endpoint
- `app/api/chat/qa` — portfolio Q&A (investor-only, single-turn)
- `app/api/chat/context` — hydrates ChatInterface for firm-side users
- `app/submit/[token]/` — main submission page with `ChatInterface`, `ConfirmationSummary`, `FileUploadZone` components
- `/onboard/[token]` redirects to `/submit/[token]`

### Email System
- 7 email events: Submission Received, KPI Alert, Monthly Digest, Submission Reminder, Plan Reminder, Plan Submitted, Platform Invitation
- Cron routes: `/api/cron/reminders`, `/api/cron/monthly-digest`, `/api/cron/plan-reminders`
- Dev mode: logs to console when `RESEND_API_KEY=re_placeholder`

### Database
- 15 tables, SQLite with WAL mode + foreign keys
- Seeded with 8 PE companies + 1 independent operator, Jan 2023 – Feb 2026 history
- FY2024 / FY2025 / FY2026 plans for 6 companies
- `pnpm db:reset` is the only command needed (seed.ts embeds all manual migrations)

### This session (2026-04-06)
- Chat pane layout fixed: was `position: fixed` (overlay), tried `sticky` (also overlay), correct solution is `h-screen flex flex-col` outer shell + `flex flex-1 min-h-0` content row + `overflow-y-auto` on `<main>` + plain flex child for panel (`w-[360px] shrink-0 ... overflow-hidden`, no fixed/sticky)
- Portfolio Q&A and Company Analytics chat system prompts updated: analyst tone, lead with answer/number, no preambles, 2–3 line max summaries, "senior PE analyst" persona
- Session management docs created: CLAUDE.md merged, tasks/ folder bootstrapped

---

## What's in progress / open items

0. **Chat pane redesign — plan approved, implement next session**
   - Plan: `PersistentChatPanel.tsx` full redesign + remove topbar Chat button
   - Closed state: 36px wide column (`2.25rem`), full height, primary-color background, vertical "Ask AI" text + icon, one click opens
   - Open state: `38vw` width (`min-w-[300px]`), animated via `transition-[width] duration-300 ease-in-out` with inline `style={{ width }}`
   - Never return null — outer container always renders as a flex child
   - `ChatPanelExpanded` only mounts when open (no API calls when closed)
   - `overflow-hidden` on outer div clips content during width animation
   - Files: `components/layout/PersistentChatPanel.tsx` (full redesign), `components/layout/topbar.tsx` (remove Chat button + useChatContext import)
   - Layout (`app/(app)/layout.tsx`) needs NO changes

1. **Company-specific KPIs not wired into the chat submission form** — custom KPIs added per company in Company Settings don't yet appear in the chat submission flow (`/submit/[token]`). Only firm-wide KPIs are currently shown.
2. **Submission Tracking UX** — detailed UX review not yet done; functional but may have rough edges
3. **Blocklist mode for member access scopes** — only allowlist is supported; blocklist mode (exclude specific companies for a member) not built
4. **Analytics Detail tab — variance coloring for lower-is-better KPIs** — positive variance is always green, even when that means worse performance (e.g. CapEx above plan = red, but shows green). Pre-existing issue, not introduced in last session.
5. **`middleware.ts` convention deprecated** in Next.js 16 — should eventually rename to `proxy.ts`, but works fine as-is

---

## Key decisions made

- **Chat-first submission UX**: Operators submit via conversational AI (Claude), not forms. The form (`submission-form.tsx`) still exists but the chat interface is the primary path.
- **Annualization of $ KPIs**: Annual plan ÷ 12 per month for currency KPIs; % and # KPIs use the annual target directly each month (rates and stock metrics don't divide).
- **Status labels**: "On Track / At Risk / Off Track" everywhere — not High/Medium/Low, not Green/Amber/Red as text.
- **Chart philosophy**: Portfolio Dashboard = cross-company comparison. Company Analytics = intra-company depth. KPI Health tiles are pure text — no bars or gauges.
- **Soft-delete for KPIs**: `active=false`, never hard-delete — FK constraints from `kpi_values` and `alerts`.
- **Seed is source of truth**: Any KPI config change in the UI must also be updated in `scripts/seed.ts`.

---

## User preferences & corrections

- Nicholas prefers concise, direct communication — no filler or summaries of what was just done
- Run commands separately (not with `&&`) — terminal is PowerShell in VSCode
- No Docker; local prototype first, then Linux hosting
- All code must be production-ready as written — no "we can fix this later for prod"
- Always use subagents for all code changes and exploration — never direct edits. This was corrected mid-session on 2026-04-06.

---

## Key files

| File | Purpose |
|---|---|
| `lib/db/schema.ts` | Full database schema |
| `lib/server/analytics.ts` | All analytics query logic (source of truth for KPI data) |
| `lib/server/alerts.ts` | Alert evaluation logic |
| `lib/server/email.ts` | Email sending (Resend) |
| `lib/chat/handler.ts` | Anthropic streaming chat handler |
| `lib/chat/system-prompt.ts` | Per-company system prompt assembly |
| `lib/auth/config.ts` | Full auth config (with DB) |
| `lib/auth/edge-config.ts` | Edge-safe auth config (no DB) |
| `scripts/seed.ts` | Seed script — source of truth for all initial data and KPI config |
| `app/(app)/analytics/client.tsx` | Company Analytics client (large, most complex page) |
| `app/(app)/dashboard/page.tsx` | Portfolio Dashboard |
| `app/(app)/admin/companies/client.tsx` | Company Settings (all tabs) |
| `app/(app)/admin/settings/client.tsx` | Firm Settings |
| `app/submit/[token]/submission-form.tsx` | Traditional submission form (less-used path) |
| `app/submit/[token]/_components/ChatInterface.tsx` | Chat submission UI |

---

## Open questions

- When should company-specific KPIs be wired into the chat submission? Is this the next priority?
- Should the submission form (`submission-form.tsx`) be deprecated in favor of chat-only?
