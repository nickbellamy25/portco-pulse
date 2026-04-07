# Handover — PortCo Pulse

## Current state (as of 2026-04-06)

The app is fully functional as a local prototype. All Phase 1 + Phase 2 features are complete. Phase 3 (polish) is partially done. This session focused entirely on Pulse AI chat pane quality: system prompt improvements, response format, collapsed tab layout, contextual chips, session persistence, and notification routing.

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

### Chat Submission System
- Conversational AI interface for operators to submit KPI data
- Supports periodic submissions, historical onboarding, plan submissions
- `lib/chat/handler.ts` — streaming Anthropic handler with tools
- `lib/chat/system-prompt.ts` — per-company context injection
- `lib/chat/session.ts` — persistent chat history
- Endpoints: `/api/chat/submit`, `/api/chat/onboard`, `/api/chat/plan`, `/api/chat/qa`, `/api/chat/context`
- `app/submit/[token]/` — main submission page

### Email System
- 7 email events, cron routes
- Dev mode: logs to console when `RESEND_API_KEY=re_placeholder`

### Database
- 15 tables, SQLite with WAL mode + foreign keys
- Seeded with 8 PE companies + 1 independent operator, Jan 2023 – Feb 2026 history
- `pnpm db:reset` is the only command needed

### Session 2026-04-06 — Pulse AI chat pane polish (full session)

**System prompt quality (`lib/chat/system-prompt.ts`):**
- Response format restructured: context line → table → conclusion (never open with declarative winner)
- Full table sorted by relevant metric (all rows ranked, not just winner moved to top)
- Bold column headers + bold most-relevant row in all comparison tables
- Conclusion omitted when the bold row makes the answer self-evident
- No-narration rule: never say "wait", "actually", "correcting" — present final answer only
- Compute-first rule: derive answer from data before writing — opening must match conclusion

**Collapsed tab layout:**
- Multiple approaches tried (writing-mode, rotation combos). Final solution: render icon + "Pulse AI" text as a normal horizontal flex row (mirroring the expanded header exactly), then rotate the whole container `rotate(270deg)` as a single unit. No writing-mode involved.

**Contextual prompt chips:**
- Built in `PortfolioQAPane`: Dashboard (4 chips), Submissions (3 chips)
- Built in `CompanyChat`: 3 company-specific chips using `ctx.companyName`
- Chips always visible (not just empty state); clicking auto-submits the message
- `ChatInterface` gained `autoMessage?: string` prop (fires once via ref guard)

**Portfolio Q&A session persistence:**
- Lifted `messages` state from `PortfolioQAPane` to `ChatPanelExpanded`
- Conversation survives navigation between pages (Dashboard → Analytics → back)

**Notification routing fix:**
- Topbar `handleClick` now intercepts `/submit/` and `/onboard/` links
- Firm-side users are redirected to `/submissions` instead of the operator chat UI

---

## What's next — Phase 3 remaining

1. **Wire company-specific KPIs into chat submission** — custom KPIs added in Company Settings don't appear in the operator's chat submission flow
2. **Fix variance coloring for lower-is-better KPIs** — positive variance is always green, even for CapEx above plan (should be red)
3. **Submission Tracking UX review** — detailed review pass; functional but may have rough edges
4. **Verify chat-submitted data surfaces in Submission Tracking matrix**
5. **Combined financials edge case** — operator uploads doc covering multiple statement types
6. **Blocklist mode for member access scopes** — only allowlist supported

---

## Key decisions made

- **Chat-first submission UX**: Operators submit via conversational AI (Claude), not forms
- **Annualization of $ KPIs**: Annual plan ÷ 12 per month; % and # KPIs use annual target directly
- **Status labels**: "On Track / At Risk / Off Track" everywhere
- **Chart philosophy**: Portfolio Dashboard = cross-company comparison. Company Analytics = intra-company depth
- **Soft-delete for KPIs**: `active=false`, never hard-delete
- **Seed is source of truth**: Any KPI config change in UI must also be updated in `scripts/seed.ts`
- **Chat pane width**: 384px fixed (not vw-based)
- **Assistant bubbles**: `w-full` (full-width), user bubbles: `max-w-[85%]`
- **Collapsed tab layout**: `rotate(270deg)` on a horizontal `flex items-center gap-2` row — mirrors expanded header, no writing-mode
- **Portfolio Q&A response format**: context line → sorted table (all rows ranked) → conclusion only if it adds information not visible in the table
- **Chips**: always visible (not empty-state only); click auto-submits; `autoMessageSentRef` guards against re-fire on re-render
- **Notification routing**: `/submit/` and `/onboard/` links are intercepted for firm users and redirected to `/submissions`

---

## User preferences & corrections

- Nicholas prefers concise, direct communication — no filler or summaries of what was just done
- Run commands separately (not with `&&`) — terminal is PowerShell in VSCode
- No Docker; local prototype first, then Linux hosting
- All code must be production-ready as written
- Always use subagents for all code changes and exploration — never direct edits
- Tab styling: always use inline styles when Tailwind bg classes conflict with theme variables

---

## Key files

| File | Purpose |
|---|---|
| `lib/db/schema.ts` | Full database schema |
| `lib/server/analytics.ts` | All analytics query logic |
| `lib/server/alerts.ts` | Alert evaluation logic |
| `lib/server/email.ts` | Email sending (Resend) |
| `lib/server/notify.ts` | In-app notification creation + link builder |
| `lib/chat/handler.ts` | Anthropic streaming chat handler |
| `lib/chat/system-prompt.ts` | Per-company + portfolio Q&A system prompts |
| `lib/auth/config.ts` | Full auth config (with DB) |
| `lib/auth/edge-config.ts` | Edge-safe auth config (no DB) |
| `scripts/seed.ts` | Seed script — source of truth for all initial data |
| `app/(app)/analytics/client.tsx` | Company Analytics client (large, most complex page) |
| `app/(app)/dashboard/page.tsx` | Portfolio Dashboard |
| `app/(app)/admin/companies/client.tsx` | Company Settings (all tabs) |
| `app/(app)/admin/settings/client.tsx` | Firm Settings |
| `app/submit/[token]/_components/ChatInterface.tsx` | Chat submission UI (also used in CompanyChat) |
| `components/layout/PersistentChatPanel.tsx` | Persistent Pulse AI chat panel |
| `components/layout/topbar.tsx` | Topbar + notification panel |
| `components/layout/chat-context.tsx` | Chat open/closed state (localStorage-backed) |
