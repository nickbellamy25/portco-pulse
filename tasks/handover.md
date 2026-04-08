# Handover — PortCo Pulse

## Current state (as of 2026-04-07)

The app is fully functional as a local prototype. All Phase 1 + Phase 2 features are complete. Phase 3 (polish) is in progress. Latest session focused on: chat submission card fixes, chat panel navigation reset, submission tracking investment date filtering, company onboarding flow, and ConfirmationSummary compact sizing.

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
- Seeded with 8 PE companies + 1 independent operator, Jan 2023 – Mar 2026 history (Apr 2026 period open)
- 24 seed notifications (12 per firm user), mixed submission states for Mar 2026, demo files in `uploads/demo/`
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

### Session 2026-04-06 (continued) — Chat pane polish pass 2

- Removed company context pill from expanded panel header (was reverting)
- Both collapsed/expanded "Pulse AI" labels now use `text-muted-foreground` (consistent gray)
- Panel collapses on page navigation via pathname useEffect with prevPathnameRef mount guard
- Company chips moved to bottom: removed from above ChatInterface, now passed as `promptChips` prop rendered above input
- Chips suppressed on `/admin/settings` and `/settings` routes
- `ChatInterface` assistant bubbles: `w-full overflow-x-auto` (was `max-w-[80%]` shared with user bubbles)
- Submission Tracking: new `GET /api/submissions/outstanding` endpoint; dynamic reminder chip names specific companies; confirmation flow in chat before calling `sendRemindersAction(firmId, periodId)`; static chips updated to action-oriented
- System prompt sort rule: sort by answering metric (growth % not absolute), compute before writing
- System prompt conclusion rule: forbids seasonal notes, run-rate commentary, Note paragraphs unless data limitation

---

### Session 2026-04-06 (continued) — Chat pane fixes pass 3

Six chat pane fixes:

1. **Removed "Company Chat" button** from company settings page header (`app/(app)/admin/companies/client.tsx`). Was a leftover from old UI.

2. **Paperclip icon inside message input on all pages:**
   - `FileUploadZone` converted to `forwardRef`, exposes `FileUploadZoneHandle` (`handleFiles`, `triggerOpen`). Added `compact` prop — when true, hides the verbose drop zone and shows only pending chips.
   - `ChatInterface`: input area now has drag-drop handlers on the outer wrapper, compact FileUploadZone with ref, and a paperclip icon button between the textarea and Send button.
   - `PortfolioQAPane`: paperclip icon + hidden file input + drag-drop added to input row. Files show as pending chips; names are prepended to message text when sent (no actual upload to Q&A endpoint).

3. **Two dynamic reminder chips on Submission Tracking:**
   - `/api/submissions/outstanding` now returns `noSubmission` + `partial` arrays instead of a combined `outstanding` array.
   - Chips: removed "Who hasn't submitted this period?" and "Which company submitted most recently?". Replaced with: "Which companies are at risk of missing this period's deadline?" (static), "Send reminders to companies with no submission" (dynamic), "Send reminders to companies with partial submissions" (dynamic).
   - Confirmation flow names specific companies; calls `sendRemindersAction` per company.

4. **Removed auto-collapse on navigation** — deleted the `pathname` useEffect from the outer `PersistentChatPanel` function. Panel stays open when navigating.

5. **Persistent chat session across all pages** — `portfolioMessages` lifted from `ChatPanelExpanded` (unmounts on close) to `PersistentChatPanel` (always mounted), backed by `sessionStorage` key `pulse_qa_messages_v1`. Survives panel close/reopen and page navigation. Clears on logout (topbar signOut now calls `sessionStorage.removeItem` first).

6. **Removed Actions column and Remind button** from Submission Tracking periodic table. `handleSendReminders`, `sending` state removed from `submissions/client.tsx`. Reminder functionality now exclusively through Pulse AI chat chips.

---

### Session 2026-04-07 — Chat quality audit + UX improvements

**Unified chat message persistence:**
- Single `chatMessages` state in `PersistentChatPanel` (sessionStorage key `pulse_chat_messages_v1`) shared between `PortfolioQAPane` and `CompanyChat`
- `ChatInterface` gains optional `onMessagesChange` callback — fires on every messages state change
- `CompanyChat` receives `messages` + `onMessagesChange` props; uses persisted messages if available, falls back to `ctx.initialMessages`
- Company-switch reset: `prevCompanyIdRef` detects switching between two non-null companies and clears `chatMessages`; portfolio↔company navigation preserves history

**System prompt quality audit (all tabs):**
- `assembleSystemPrompt` (company chat — Analytics, operator submission, plan): upgraded ANSWERING KPI QUESTIONS section to match portfolio Q&A rules — no declarative opener, compute-first sort, bold table headers + most-relevant row, omit conclusion if self-evident, no seasonal/run-rate commentary, no narration
- Both prompts: added PE analyst judgment rule — standard terms ("active KPI alerts", "at risk of missing deadline", "this period", etc.) are interpreted directly, never asked about
- Both prompts: "pick best interpretation and answer it" rule — no "if you meant X" hedging, no explaining data gaps unless question literally can't be answered
- Clarifying questions only when question is truly unresolvable (e.g. "show me the data" with no KPI/period/company)

**Chat UX improvements:**
- Chip rotation: clicking a chip replaces it with the next unused one from an extended pool; `usedChips` state resets on pathname change
- Dashboard pool: 8 chips. Submissions: 3 static + dynamic reminder chips. Company chat: 6 chips.
- Max 3 chips visible at any time
- Chat pane draggable from left edge (min 320px, max 640px); resets to 384px on collapse
- Textarea auto-expands with content up to 128px; resets on send
- `ChatInterface` gets `compact` prop — when true (panel context), uses `text-xs` + smaller padding matching PortfolioQAPane style

**Bug fixes:**
- `analytics.ts:1096`: `status is not defined` — changed to `baseStatus` (caused crash when navigating to old period on Submissions)
- Font mismatch: Analytics chat was `text-sm`, Dashboard/Submissions was `text-xs` — fixed via `compact` prop

**AI settings editing — decided against:**
- Discussed AI-driven KPI settings editing via chat; decided it's overreach for this stage
- Reasons: high-stakes changes, confirmation fatigue risk, audit trail concerns, form UI is 3 clicks away
- Settings chips will be informational only (read KPI rules, show thresholds) — no mutations via chat

---

### Session 2026-04-07 (continued) — Chat chip refactor + UX fixes

**Chat chip + submission refactor (Part 1 + Part 2 — plan complete):**
- `ChatInterface` gains `fixedChip?: string` prop — always visible, never consumed by `usedPromptChips`. Pool capped at 2 when fixedChip is set.
- `CompanyChat`: Analytics now passes `ANALYTICS_CHIP_POOL` as `promptChips` (6 chips, 2 visible) + `fixedChip="Submit this period's data for {company}"` always pinned as slot 3.
- Company Settings: keeps 3 fixed chips (`promptChips`), no `fixedChip`.
- Auto-submit on company picker selection: override `CompanyChat` receives `autoSubmit={true}` → passes `autoMessage` to `ChatInterface` → immediately fires submission message when company is selected from picker.
- Prompt chips suppressed after first user message: `!messages.some(m => m.role === "user")` added to chip render condition.
- System prompt: "Most at risk" definition added to `assembleSystemPrompt` (was only in portfolioQA).

**PDF extraction fixes:**
- `app/api/upload/route.ts`: scanned PDFs now sent as native Anthropic `document` blocks (base64) instead of returning "can't read" error. New `extractionMethod: "pdf_document"`, `pdfBase64` field added to `UploadResult`.
- `lib/chat/session.ts`: `AnthropicContentBlock` extended with `document` type.
- `lib/chat/handler.ts`: new branch handles `pdf_document` extraction method.
- `detectDocumentTypes` sample widened from 2000 → 8000 chars so keywords on later pages (page 2 income statement, page 3 cash flow) are caught.
- Both system prompts: DOCUMENT RECORDING section strengthened — Claude reads document content and self-identifies types (including combined_financials) without asking operator. Only asks when type is truly unresolvable.

**Drag visual on textarea:**
- `ChatInterface`: `isDraggingOver` state added. Textarea shows `ring-2 ring-primary border-primary` on drag-over.

**Scroll to bottom on mount:**
- `PortfolioQAPane` and `ChatInterface` both now scroll to bottom on mount when existing messages are present. Fixes "loads at top" bug after navigation.

**Duplicate chips fix:**
- Prompt chips suppressed when `quickReplies.length > 0` (AI quick-reply chips take over during submission flow).

**Notifications:**
- `sendSubmissionNotificationEmail` and `sendSubmissionVoidedEmail`: removed `!to.length` early return that was blocking in-app notifications when no email recipients configured. Email sending now gated by `to.length > 0` inside the email block only.
- Topbar notification poll: 30s → 10s.
- In-app notification titles rewritten to be short and clear (all 4 that used email subject as title): submission_received, submission_voided, monthly_digest, onboarding_request.

**Firm name + Firm Settings restructure:**
- `firms.name` is now editable via Firm Settings.
- `saveFirmNameAction` + `saveFirmEmailAction` added to `actions.ts`.
- Firm Settings tab renamed "Access" → "General". First section is "Firm Details" (Firm Name + From Email, their own Save button). Second section is "Team Access".
- "Firm Name" and "From Name" merged into one field — saves to both `firms.name` and `emailSettings.fromName`.
- "From Email" moved from Notifications tab to General tab.
- Notifications tab now only has the event table (no firm config fields).

---

### Session 2026-04-07 (continued) — Seed data extended to March 2026 + demo files

**March 2026 submissions (mixed states for demo):**
- Complete: Apex Industrial (3 docs), Brighton Healthcare (4 docs), Veridian Software (2 docs), Culinary Concepts (KPI-only, no required docs)
- Partial: Keystone Logistics (KPIs only, docs pending), OptiFi Solutions (KPIs only, docs pending)
- Not submitted: Evergreen Fitness (skipped), StreamVibe Media (in onboarding)
- March 2026 `submittedAt` dates set to early April (Apr 2-5) for realistic "submitted a few days ago" display

**Onboarding advancement:**
- StreamVibe Media: "pending" → "in_progress" (2 uploaded onboarding docs)
- Culinary Concepts: "in_progress" → "complete"

**Seed notifications (24 total, 12 per user):**
- 8 unread per user: 6 submission_received (Apex, Brighton, Veridian, Keystone partial, OptiFi partial, Culinary), 2 RAG alerts (Evergreen EBITDA off track, Keystone margin at risk)
- 4 read per user: monthly digest, Culinary onboarding complete, Keystone plan revision, StreamVibe onboarding in progress

**Demo files for April 2026 (in `uploads/demo/`):**
- `apex_april2026_kpi_report.xlsx` — messy Excel with scattered metrics, section labels, N/A values
- `keystone_april2026_monthly_memo.pdf` — CFO memo PDF with narrative + embedded KPI data
- `veridian_april2026_saas_metrics.csv` — messy CSV from Stripe/BI dashboards
- `pinnacle_retail_april2026_report.pdf` — informal PDF for a new fictional company (Pinnacle Retail Group) for demoing the company creation flow

**Other seed updates:**
- Period creation extended to April 2026 (open, no submissions — ready for demo submissions)
- TechVault extended to include March 2026 data
- March 2026 annotations added for all 6 submitting companies with operator notes and investor annotations

---

### Session 2026-04-07 (continued) — Performance audit, demo files, drag-drop submission

**Performance optimizations:**
- SQLite PRAGMAs: `synchronous=NORMAL`, 20MB cache, `temp_store=MEMORY` (`lib/db/index.ts`)
- 3 new indexes: `kpi_definitions_firm_active_idx`, `threshold_rules_firm_kpi_idx`, `threshold_rules_firm_company_idx`
- N+1 query fixes in `getCompanyAnalytics` (batch period lookups) and `getPortfolioDashboardData` (batch submissions + KPI values)
- Notification polling: 10s → 60s (`topbar.tsx`)
- SessionStorage writes debounced 500ms (`PersistentChatPanel.tsx`)

**Demo files reworked (`uploads/demo/`, generated by seed):**
- `apex_april2026_ops_update.txt` — messy informal email (tests unstructured data extraction)
- `brighton_april2026_financials.xlsx` — 3-tab XLSX: Income Statement, Balance Sheet, Cash Flow with KPIs buried in IS footer (tests document type recognition from single upload)
- `culinary_april2026_pnl.pdf` — formatted P&L with footer KPIs (tests PDF submission)
- `pinnacle_retail_historical_financials.xlsx` — 3 years FY2023-2025 across IS+BS+CF (tests holistic onboarding)
- Old keystone PDF and veridian CSV removed. Demo dir cleaned on each seed run (`rmSync`).

**Plan completeness fix (`analytics.ts:getPlanTracking`):**
- Completeness now checks only firm-level KPIs (`companyId IS NULL`) that the company actually reports on
- Company-specific operational KPIs (capacity_utilization, bed_occupancy, arr, etc.) excluded from check
- Some plans made intentionally partial in seed: Evergreen (missing capex, ocf), OptiFi (missing cash_balance, headcount, employee_turnover)
- Result: 4 Complete, 2 Partial, 2 No Submission for FY2026

**Drag-and-drop file submission from Pulse AI panel:**
- Drop a file in the QA pane → auto-detect company from filename → switch to CompanyChat → upload file → auto-send with extraction prompt
- `matchCompanyFromFilename()` — word-based fuzzy matching against company names
- If no match: opens company picker with files stashed
- `handleFileSubmission()` clears messages, sets override, stashes files
- CompanyChat uploads files on mount via `/api/upload` (initializes `uploadingFiles=true` to prevent premature autoMessage)
- Auto-message: explicit KPI extraction instructions with period="current period", type="actuals"
- Pre-chat context card (`contextDismissed`) skipped when `autoMessage` is set
- No "switching to submission mode" message, no back button during file submission
- `autoUploads` prop on ChatInterface — used by autoMessage useEffect

**Document detection in submission card:**
- `ConfirmationSummary` gains `detectedDocuments?: string[]` prop
- Green banner showing "Documents detected: Balance Sheet, Income Statement, Cash Flow Statement" above the amber "Missing" banner
- `detectedDocs` state in ChatInterface, populated from upload results (`detectedIncludedStatements` or `detectedDocumentType`)

**Submission Tracking document badges:**
- Combined file documents now show green (was yellow/amber for `viaCombined`)
- A detected statement is green regardless of whether it came from a standalone or combined file

**Drag highlight on QA pane:**
- `isDraggingOverQa` state added to PortfolioQAPane
- Textarea shows `ring-2 ring-primary border-primary` on drag-over (matches ChatInterface behavior)

**Post-submit card fix:**
- `handleConfirm` no longer appends duplicate `submittedPayload` card — the in-place swap from `onConfirm` is sufficient
- Only appends the success text message after API call

---

### Session 2026-04-07 (continued) — Chat submission card + navigation fixes

**Chat submission card fixes (ChatInterface + ConfirmationSummary):**
- Submission card persists after Submit: atomic swap in handleConfirm (accepts messageIndex, single setMessages call)
- Removed "Submitted to..." text message — green "Submitted" badge on card is sufficient
- Company name added as primary heading on confirmation card (ConfirmationSummary gains `companyName` prop)
- Font hierarchy: company name = text-base semibold, period = text-sm muted
- Prompt chips reappear after completed submission (findLastIndex check instead of any-user-message check)
- Documents detected + Missing KPIs banners now visible on submitted cards (removed `!isSubmitted` guards)
- `compact` prop on ConfirmationSummary: text-[11px] labels/values, text-[10px] notes/headers, tighter padding
- Drag highlight counter fix: dragEnter/dragLeave use ref counter to prevent flicker on child elements
- detectedDocs now populated from Claude's `record_document` tool calls (not just upload auto-detection)
- detectedDocuments stored on message object for persistence across remounts

**Chat panel navigation reset:**
- Added pathname-watching useEffect in ChatPanelExpanded: clears chatMessages on every route change
- Added `key={ctx.companyId}` on both CompanyChat renders: forces remount when company changes on same page
- Standard UX: chat starts fresh on each page, context chips are page-appropriate

**Submission tracking + onboarding:**
- Companies filtered by investmentDate in getSubmissionTracking — only show from investment month onwards
- New companies get `onboardingStatus: "pending"` on creation (appear on Onboarding tab immediately)
- Auto in-app notification on company creation (onboarding_request event type)

---

## What's next — Phase 3 remaining

**Phase 3 remaining:**
1. Wire company-specific KPIs into chat submission
2. Fix variance coloring for lower-is-better KPIs (CapEx, Churn Rate, etc.)
3. Submission Tracking UX review
4. Combined financials edge case
5. Blocklist mode for member access scopes

**Demo prep remaining:**
- Test full drag-drop submission flow end-to-end (Brighton XLSX, Apex TXT, Culinary PDF)
- Test onboarding flow with Pinnacle historical XLSX
- Verify chat panel resets properly across all navigation paths

---

## Key decisions made

- **Chat-first submission UX**: Operators submit via conversational AI (Claude), not forms
- **Annualization of $ KPIs**: Annual plan ÷ 12 per month; % and # KPIs use annual target directly
- **Status labels**: "On Track / At Risk / Off Track" everywhere
- **Chart philosophy**: Portfolio Dashboard = cross-company comparison. Company Analytics = intra-company depth
- **Soft-delete for KPIs**: `active=false`, never hard-delete
- **Seed is source of truth**: Any KPI config change in UI must also be updated in `scripts/seed.ts`
- **Chat pane width**: 384px fixed (not vw-based)
- **FileUploadZone**: `forwardRef` with `FileUploadZoneHandle` (`handleFiles`, `triggerOpen`). `compact` prop hides drop zone, shows only pending chips.
- **Chat session key**: `pulse_qa_messages_v1` in sessionStorage — portfolio Q&A messages persist across panel open/close and navigation; cleared on logout.
- **Reminder chips**: two dynamic chips (no submission / partial) on /submissions, both confirm before sending, call `sendRemindersAction` per company. Static chip: "Which companies are at risk of missing this period's deadline?"
- **No auto-collapse**: panel stays open on navigation (previous auto-collapse on route change removed).
- **Assistant bubbles**: `w-full` (full-width), user bubbles: `max-w-[85%]`
- **Collapsed tab layout**: `rotate(270deg)` on a horizontal `flex items-center gap-2` row — mirrors expanded header, no writing-mode
- **Portfolio Q&A response format**: context line → sorted table (all rows ranked) → conclusion only if it adds information not visible in the table
- **Chips**: always visible (not empty-state only); click auto-submits; `autoMessageSentRef` guards against re-fire on re-render
- **Notification routing**: `/submit/` and `/onboard/` links are intercepted for firm users and redirected to `/submissions`
- **AI settings editing via chat**: decided against — overreach at this stage. Settings chips are informational only (read-only answers about current config). Mutations stay in the form UI.
- **Chat message persistence**: single `chatMessages` sessionStorage store shared across all chat modes. Company switch resets; portfolio↔company nav preserves.
- **`compact` prop on ChatInterface**: when rendered in the panel (`CompanyChat`), use `text-xs` + smaller padding. Operator submission page stays at `text-sm`.
- **Chip rotation**: `usedChips` Set state per component; chips reset on pathname change; max 3 visible. Fixed chips (submit, informational) never enter the rotation pool.
- **fixedChip prop on ChatInterface**: fixed chips never enter usedPromptChips rotation; pool capped at 2 when fixedChip is present; always rendered last.
- **Prompt chips suppressed after first user message**: `!messages.some(m => m.role === "user")` gates the entire chip block. Chips are conversation starters only.
- **Scanned PDFs**: sent to Claude as native `document` blocks (base64). Non-scanned PDFs: text extracted, detection window 8000 chars.
- **Firm Settings General tab**: "Firm Name" (→ firms.name + emailSettings.fromName) + "From Email" in their own section with dedicated Save button. Tab renamed General; subheadings: Firm Details, Team Access.
- **In-app notification titles**: always short and specific (company + period/event), never email subject string.
- **Topbar notification poll**: 10s interval.
- **Chat resets on navigation**: pathname-watching useEffect clears chatMessages on every route change. CompanyChat has `key={ctx.companyId}` for same-page company switches.
- **Submission card persistence**: handleConfirm does atomic swap (pendingPayload→submittedPayload) in a single setMessages call. No separate success message. detectedDocuments stored on the message object.
- **ConfirmationSummary compact sizing**: text-[11px] for labels/values, text-[10px] for notes/section headers/banners, px-2.5 py-2 padding.
- **Prompt chips after submission**: chips reappear when lastSubmittedIndex > lastUserIndex (conversation cycle complete).
- **Company onboarding**: new companies get `onboardingStatus: "pending"` + in-app notification on creation.
- **Submission tracking date filter**: companies filtered by investmentDate — only shown from investment month onwards.

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
