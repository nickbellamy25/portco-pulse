# Handover — PortCo Pulse

## Current state (as of 2026-04-06)

The app is fully functional as a local prototype. All Phase 1 + Phase 2 features are complete. This session focused on chat pane polish and system prompt quality.

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

### Session 2026-04-06 (continued) — Chat pane features
- Contextual prompt chips: built for PortfolioQAPane (Dashboard: 4 chips, Submissions: 3 chips) and CompanyChat (3 company-specific chips using company name)
- Portfolio Q&A session persistence: lifted messages state to ChatPanelExpanded so conversation survives navigation between pages
- Notification routing fix: firm users clicking operator submission/onboard links are redirected to /submissions instead of the operator chat UI
- ChatInterface: added `autoMessage` prop for chip-triggered sends

### Session 2026-04-06 (this session) — Chat pane polish
- Fixed three outstanding chat pane issues: zoom root cause (`zoom: 0.85` removed from `app/layout.tsx`), Ask AI tab styling (inline styles to force white bg), duplicate hint text removed from `PortfolioQAPane`
- Removed textarea placeholder from `PortfolioQAPane`, added "Message..." placeholder
- Chat pane width: 38vw → 320px → 384px (final)
- Renamed tab label "Ask AI" → "Pulse AI"
- Added "Pulse AI" text + green icon to expanded pane header
- Fixed assistant message bubble: `w-full overflow-x-auto` so table backgrounds fill full width (was `max-w-[85%]`)
- Portfolio Q&A system prompt improvements:
  - Consistency rule: written summary must match the table/numbers
  - No narration rule: never say "wait", "actually", "correcting" — silently fix and present final answer only
- Strengthened CLAUDE.md session habits: "without being asked" + "mandatory, not optional" on three rules
- App committed to GitHub throughout session

---

## What's in progress / open items

### PRIORITY: Portfolio Q&A system prompt — compute-first rule (INTERRUPTED)
Was mid-task when session ended. Still needs:
- Add rule to `assemblePortfolioQASystemPrompt`: "When ranking or comparing companies, always compute the correct answer from the data FIRST, then write the response. The opening statement must match the conclusion. Never state a winner before verifying it against the numbers."
- The AI is still generating an incorrect opening line before self-correcting — the no-narration rule alone is not sufficient; need an explicit compute-first instruction.

### Phase 3 remaining
1. **Wire company-specific KPIs into chat submission** — custom KPIs added in Company Settings don't appear in the chat submission flow
2. **Submission Tracking UX review** — detailed review pass; functional but may have rough edges
3. **Fix variance coloring for lower-is-better KPIs** — positive variance is always green, even for CapEx above plan (should be red)
4. **Blocklist mode for member access scopes** — only allowlist supported
5. **Verify chat-submitted data surfaces in Submission Tracking matrix**
6. **Combined financials edge case** — operator uploads doc covering multiple statement types

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
| `lib/chat/handler.ts` | Anthropic streaming chat handler |
| `lib/chat/system-prompt.ts` | Per-company + portfolio Q&A system prompts |
| `lib/auth/config.ts` | Full auth config (with DB) |
| `lib/auth/edge-config.ts` | Edge-safe auth config (no DB) |
| `scripts/seed.ts` | Seed script — source of truth for all initial data |
| `app/(app)/analytics/client.tsx` | Company Analytics client (large, most complex page) |
| `app/(app)/dashboard/page.tsx` | Portfolio Dashboard |
| `app/(app)/admin/companies/client.tsx` | Company Settings (all tabs) |
| `app/(app)/admin/settings/client.tsx` | Firm Settings |
| `app/submit/[token]/_components/ChatInterface.tsx` | Chat submission UI |
| `components/layout/PersistentChatPanel.tsx` | Persistent Pulse AI chat panel |

---

## Open questions

- Should company-specific KPIs be wired into chat submission next?
- Should the old `submission-form.tsx` be deprecated in favour of chat-only?
