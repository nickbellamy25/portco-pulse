# Handover — PortCo Pulse

## Current state (as of 2026-04-13)

The app is fully functional as a local prototype. All Phase 1 + Phase 2 features are complete. Phase 3 polish continues. Latest session: major dashboard and UI polish pass — removed threshold marker from bar chart, added clickable company names, rewrote dashboard alerts to use RAG (% variance from plan) instead of absolute threshold rules, added Gross Margin to Plan Attainment table, added per-KPI staleness indicator, onboarding system prompt rewrite, and onboarding reminder chip on Pulse AI panel.

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

### Session 2026-04-08 — Document checklist, error handling, company creation fixes

**Document checklist in submission forms:**
- `page.tsx` passes `requiredDocs` + `requiredDocCadences` from company to ChatInterface
- `ChatInterface` forwards to both ConfirmationSummary renders (pending + submitted cards)
- `ConfirmationSummary` renders "Required Documents" section with status indicators:
  - ✓ green = uploaded (including via combined financials coverage)
  - ✗ red = required and due but missing
  - ○ gray = not due this period (cadence-aware)
- Replaces old "Documents detected" green banner

**Submission error handling fix:**
- `/api/review` error response changed from `{ error: ... }` to `{ message: ... }` to match client expectation
- ChatInterface checks both `data.message` and `data.error` as fallback
- Added `console.error` in catch block for browser debugging

**Company creation — required fields + investmentDate:**
- `saveCompanyAction` now sets `investmentDate` (from dialog input, defaults to today)
- Add Company dialog: all fields required (name, fund, industry, investmentDate) with `*` labels and disabled button
- `SaveCompanyInput` type extended with `investmentDate?: string`

**investmentDate period filtering fix:**
- Changed `getSubmissionTracking` filter from exact day comparison to YYYY-MM month granularity
- A company invested on April 7 now correctly appears in the April period
- Null investmentDate falls back to `createdAt` date (legacy compat)

**Pinnacle Retail DB fix:**
- Created `scripts/fix-pinnacle.js` to set `onboarding_status = 'pending'` for existing Pinnacle company
- Pinnacle was created before the `onboardingStatus: "pending"` code was added to `saveCompanyAction`

---

### Session 2026-04-08 (continued) — Submission card overhaul

**Submission card states (ChatInterface + ConfirmationSummary):**
- Three states: Draft (no badge, editable, Submit/Cancel), Submitted (green badge, read-only), Canceled (gray badge, read-only)
- Cancel button now swaps pendingPayload → canceledPayload instead of deleting
- `canceledPayload` added to ChatMessage interface
- `isCanceled` prop on ConfirmationSummary: gray badge with XCircle icon, read-only values/notes, no footer buttons

**Document badge row (replaces old text checklist):**
- ALL 4 doc types (BS, IS, CF, IU) always shown as inline badges on every card
- Matches Submission Tracking DocChip style: gray (not required), green (detected), red (missing)
- Interactive on draft cards: click required-doc badge to toggle detected status (green↔red)
- Read-only on submitted/canceled cards
- Constants: ALL_DOC_KEYS, DOC_ABBR, DOC_FULL replace old DOC_LABELS
- Old text-based checklist (✓/✗/○), isDocDue function, cadenceMap parsing all removed
- "Missing KPIs" amber box removed entirely

**Document detection linked to DB (financial_documents):**
- `/api/chat/context` now queries financial_documents for each submitted card in history
- Expands combined_financials → individual statement types via includedStatements
- Attaches detectedDocuments to initialMessages so badges show correct colors
- Same DB source as Submission Tracking page — badges now consistent

**requiredDocs wired to firm-side chat:**
- `/api/chat/context` returns requiredDocs + requiredDocCadences from company record
- CompanyChat passes both to ChatInterface
- Document badges now render on firm-side panel (were previously missing)

**Re-show submitted card:**
- New `show_last_card` tool in handler.ts (periodic mode only)
- System prompt: "RE-SHOWING A CARD" section instructs Claude to call show_last_card
- Client handler finds last submittedPayload message, appends read-only copy
- First attempt (using submit_structured_data) was wrong — created new draft. Replaced with dedicated tool.

**Known issue — document badges may show red on first load:**
- After submitting via chat, the `detectedDocs` state should be populated from upload handler responses
- For history-loaded cards, the context API queries financial_documents (fix deployed this session)
- User may need to hard-refresh (Ctrl+Shift+R) or navigate away and back to trigger fresh API call
- If badges still show red after refresh, investigate: upload handler detection, record_document tool calls, or detectedDocs state flow

### Session 2026-04-08 (continued) — Firm-side submission routing from Pulse AI panel

**Problem:** When a firm-side investor types KPI data into the Pulse AI panel (on Dashboard or any page), the data was sent to `/api/chat/qa` which has NO submission tools — Claude could only produce markdown analysis, never a submission card.

**Root cause:** The panel renders `PortfolioQAPane` (Q&A endpoint) on Dashboard/Submissions pages. Only Analytics and Company Settings pages route to `CompanyChat` (submission endpoint). The user expected submissions to work from any page.

**Changes made (5 files, partially working):**

1. `lib/chat/system-prompt.ts` — Changed "operator" → "user" throughout `assembleSystemPrompt()` so firm-side investors aren't treated differently from operators. Added stronger INTENT RECOGNITION section.

2. `lib/chat/handler.ts` — Added `tool_choice: { type: "tool", name: "submit_structured_data" }` when message has 3+ numbers or file uploads (forces tool call instead of markdown). Updated tool description.

3. `components/layout/PersistentChatPanel.tsx`:
   - Added submission-data detection in PortfolioQAPane's `sendMessage` (3+ numbers → submission intent)
   - Added company auto-detection from message text using `matchCompanyFromFilename`
   - Added `onTextSubmission` callback + `handleTextSubmission` in parent to route text submissions through CompanyChat override
   - Added `autoMessageOverride` prop to CompanyChat for passing user's original text
   - CompanyChat starts with empty messages when `autoMessageOverride` is set (no old history)
   - "Portfolio chat" back button hidden during text submissions
   - Route-change message clear skips when `submissionOverrideId` is active

4. `app/submit/[token]/_components/ChatInterface.tsx`:
   - `submit_structured_data` tool_call handler now replaces empty placeholder instead of appending (prevents blank bubble)
   - `sendMessageRef` pattern to prevent autoMessage useEffect cleanup from canceling the timeout

5. `app/api/chat/context/route.ts` — Added `canceledPayload` to InitialMsg type. Checks whether real submission exists in DB before marking as submitted vs canceled.

**Current status — TWO BUGS REMAIN:**

1. **Paste twice required**: First paste detects company, switches to CompanyChat with `autoMessageOverride`, but the auto-send doesn't fire reliably. User has to paste again. The `sendMessageRef` fix was applied but isn't working. Suspect: the issue may be in CompanyChat's rendering lifecycle, not ChatInterface's useEffect. Need to add console.log tracing to find where the message gets lost in the chain: PortfolioQAPane → handleTextSubmission → CompanyChat mount → ChatInterface mount → autoMessage useEffect → sendMessageRef.current().

2. **Messages disappear on navigation**: Even with the `submissionOverrideId` guard on the pathname-change clear, messages still disappear. Suspect: the override itself may be getting torn down. The `submissionOverrideId` state lives in ChatPanelExpanded, which may unmount/remount during navigation, resetting all state. Or the context fetch for the normal company (non-override) may overwrite the override context. Need to trace: does `submissionOverrideId` survive navigation? Does `overrideCtx` persist? Does `showOverride` stay true?

**Recommended approach for next session:**
1. Add console.log tracing at each step of the override flow to identify exactly where it breaks
2. Consider simplifying the architecture: instead of the 4-component hop (QAPane → Parent → CompanyChat → ChatInterface), consider making the QA endpoint itself support submission when company is identified
3. OR: move the submission detection + company matching to the parent component so it happens before the QA pane even renders

### Session 2026-04-08 (continued) — Per-page chat storage + submission routing bug fixes

**Two bugs in firm-side submission routing from Pulse AI panel:**

Bug 1: "Paste twice required" — autoMessage didn't fire reliably after company detection switched to CompanyChat.
- **Root cause**: React StrictMode runs effects twice. The `autoMessageSentRef.current = true` was set BEFORE the setTimeout, so StrictMode's cleanup cleared the timer and the second invocation saw the ref as true → skipped.
- **Fix** (`ChatInterface.tsx`): Moved `autoMessageSentRef.current = true` inside the setTimeout callback. StrictMode cleanup clears the timer, ref stays false, second invocation starts a new timer that succeeds.

Bug 2: "Messages disappear on navigation" — submission cards vanished when navigating between pages.
- **Root cause (layer 1)**: `PersistentChatPanel` had a pathname-watching effect (lines 78-85) that cleared `submissionOverrideId` on EVERY navigation. This killed the override before `ChatPanelExpanded` could use it.
- **Root cause (layer 2)**: Single shared `chatMessages` state meant clearing messages for one page affected all pages. No per-page isolation.
- **Root cause (layer 3)**: `showOverride` was gated by `targetCompanyId === null`, so navigating to Analytics (where targetCompanyId is set from URL) killed the override even when it should persist.
- **Root cause (layer 4)**: The `loading` state in ChatPanelExpanded would unmount CompanyChat during navigation (spinner showed), causing ChatInterface to remount with fresh `autoMessageSentRef` → autoMessage re-fired → duplicate submission cards.

**Architecture change — per-page chat storage (`PersistentChatPanel.tsx`):**
- Replaced single `pulse_chat_messages_v1` sessionStorage key with per-page keys: `pulse_chat_page_v1_${pathname}`
- Each page stores `{ messages, overrideCompanyId }` independently
- On navigation: save current page state → load new page state → restore `submissionOverrideId` from stored state
- `submissionOverrideId` initializer reads from per-page storage on mount
- `chatMessagesRef` tracks latest messages for the save-on-navigate effect without re-triggering
- Debounced save (500ms) persists both messages and overrideCompanyId

**Other fixes in `PersistentChatPanel.tsx`:**
- Removed pathname-change message clearing effect from `ChatPanelExpanded` (parent handles per-page swap now)
- Override context fetch: removed `targetCompanyId` dependency — override persists regardless of page
- `showOverride = overrideCtx !== null` (removed `&& targetCompanyId === null`)
- Company-switch message clear guarded by `&& !submissionOverrideId`
- `autoSubmit={chatMessages.length === 0}` on override CompanyChat — prevents re-fire when messages already exist (navigating back to a page with saved submission history)
- Back button: removed `!pendingSubmissionText` check — always visible when override is active

**Logout cleanup (`topbar.tsx`):**
- Updated signOut to iterate and remove all `pulse_chat_page_v1_*` sessionStorage keys instead of single old key

**Expected behavior after fix:**
- Dashboard: paste KPI data → submission card → submit/cancel → card stays visible
- Navigate to Tracking → fresh chat (loaded from Tracking's per-page state, empty by default)
- Navigate back to Dashboard → submission card restored (loaded from Dashboard's per-page state), override re-activates, no autoMessage re-fire
- Each page has independent chat history that persists in sessionStorage

---

### Session 2026-04-08 (continued) — Context card fix on Dashboard

**Problem:** Opening Pulse AI panel on the Dashboard showed the "What data are you submitting?" submission context card (Actuals/Plan selector + period picker) instead of the Portfolio Q&A chips. The panel should be in Q&A mode on Dashboard since no company is selected.

**Root cause:** `PersistentChatPanel.tsx` always passes `mode="periodic"` to `ChatInterface` (line 365). `ChatInterface` shows the context card when `mode === "periodic" && !contextDismissed` (line 444). Since Dashboard has no company selected (`effectiveCompanyId` is null), the panel should be in Q&A mode — but `mode="periodic"` was unconditionally set.

**Fix:** Added `&& companyId` to the context card render condition in `ChatInterface.tsx` line 444. Now the card only renders when there's an actual company to submit data for. Portfolio Q&A mode (no companyId) skips the card and shows chips directly.

**File changed:** `app/submit/[token]/_components/ChatInterface.tsx` — line 444 condition.

### Session 2026-04-08 (continued) — Pulse AI chat panel audit + UX fixes

**"Invalid token." fix:**
- FileUploadZone + paperclip button now gated by `(token || companyId)` — hidden in Q&A mode (no company selected)
- Drag-drop handler in input area also guarded — prevents accidental uploads in Q&A mode
- Root cause: empty token + no companyId sent to `/api/upload` which rejected with "Invalid token."

**Company context bar (replaces back arrow):**
- New bar below header: "Submitting for **{companyName}**" with "✕ Exit" button
- Shows when `effectiveCompanyId && companyMeta && !operatorCompanyId`
- Exit button only visible when company was manually selected (not auto-set from URL)
- On Analytics/Settings pages (company from URL), bar shows without Exit
- Removed `ChevronLeft` import (no longer used)

**Submission type selection:**
- Removed auto-send of "Submit this period's data" when selecting company from picker
- Added `SUBMISSION_CHIPS_FN` with 3 chips: periodic actuals, annual plan, historical/onboarding
- Chips show first in pool when company is active, Q&A chips rotate in after
- `handleSelectCompany` only sets `pendingAutoMessage` when files are pending (drag-drop flow)

**Context card updates (ChatInterface):**
- Added "Onboarding" as third DataType option alongside Actuals and Plan
- `type DataType = "actuals" | "plan" | "onboarding"`
- Period hint changes when onboarding selected: "List the range of historical periods..."
- Context card shows for all modes (removed `mode === "periodic"` gate)
- `sendContextDataType` now uses `join(",")` instead of old `"both"` logic
- Card text/padding/buttons shrunk to `text-xs` to match compact chat panel

**Files changed:**
- `app/submit/[token]/_components/ChatInterface.tsx` — file upload guards, context card updates
- `components/layout/PersistentChatPanel.tsx` — context bar, submission chips, auto-send removal

---

### Session 2026-04-09 — Pulse AI panel: Q&A-first architecture + chip fixes

**Core architecture change — Q&A mode is default on all pages:**
- Removed the `useEffect` that auto-set `activeCompanyId` from `companyIdFromUrl` on Analytics/Settings pages
- Previously, opening the panel on Analytics or Company Settings immediately showed submission mode (context card, submission chips)
- Now ALL pages start in Q&A mode with page-specific chips + "Submit data for a company →" fixed chip
- User explicitly enters submission mode by clicking the fixed chip → selecting a company
- Exit button always visible on context bar, returns to Q&A mode by clearing activeCompanyId + companyMeta
- Removed `dismissedContextBar` workaround state (was added mid-session, then made unnecessary by the root fix)

**Submission mode has no prompt chips:**
- Chips suppressed when `effectiveCompanyId` is set: `promptChips={effectiveCompanyId ? [] : buildChips()}`
- The context card (Actuals/Plan/Onboarding) handles submission type selection
- Removed `SUBMISSION_CHIPS_FN` (no longer used)

**Page-specific Q&A chips restored:**
- Dashboard: "Who's behind on plan YTD?", "Which company has deteriorated most over the last 3 periods?"
- Tracking: "Send reminders to companies with no submission this period" (first), "Which companies are at risk of missing this period's deadline?"
- Analytics (company in URL): company-specific Q&A via COMPANY_CHIPS_FN(urlCompanyName) — "How is {name} tracking against plan?", alerts, worst KPI, headcount, margin
- Analytics (no company): dashboard fallback chips
- Company Settings (company in URL): "What KPIs are configured for {name}?", "What are the current alert thresholds for {name}?", "What documents are required for {name}?"
- Company Settings (no company): dashboard fallback chips
- Firm Settings: "How do firmwide KPI settings and overrides work?", "What are the current firmwide KPI thresholds?"
- `urlCompanyName` resolved from companyList via companyIdFromUrl (no submission mode needed)

**Chip text alignment fix:**
- Added `text-left` to chip button classes in ChatInterface.tsx (multi-line chips were centering text)

**Files changed:**
- `components/layout/PersistentChatPanel.tsx` — core architecture change + chip pools
- `app/submit/[token]/_components/ChatInterface.tsx` — chip text-left alignment

---

### Session 2026-04-10 — Document type detection rewrite

**Problem:** Culinary Concepts demo PDF (P&L with "Profit & Loss Statement" header, Revenue, Gross Profit, Operating Expenses line items) was not detected as income_statement on Submission Tracking. All doc badges showed gray.

**Root cause chain:**
1. `pdf-parse` library silently failed on hand-built PDFs (generated by `buildTextPdf` in seed.ts — raw PDF stream commands without proper font encoding)
2. Silent catch block fell through to base64 vision path
3. Vision path had NO `detectDocumentTypes` call — only the text extraction path ran detection
4. Even if detection ran, the old patterns only matched document titles ("Balance Sheet", "Income Statement") not line items

**Fix — 3 layers:**

1. **Raw PDF stream fallback** (`extractPdf` in `app/api/upload/route.ts`):
   - When pdf-parse fails, decode buffer as latin1 and run `detectDocumentTypes` on raw stream text
   - Catches PDFs with embedded text streams even when pdf-parse can't parse them
   - Only falls through to undetected vision if raw text also fails

2. **Line-item-based detection** (replaced `DOC_TYPE_PATTERNS`):
   - Split into `DOC_TYPE_STRONG` (structural keywords unique to each statement type) and `DOC_TYPE_WEAK` (generic terms that appear anywhere)
   - Strong: "current assets", "cost of sales", "operating activities", etc.
   - Weak: "revenue", "EBITDA", "gross margin", "cash flow", "capex"
   - Scoring: requires 2+ strong OR 1 strong + 1 weak to detect. Weak-only matches are ignored.
   - Prevents false positives from informal emails mentioning "revenue" or "EBITDA"

3. **CSV detection added** (`extractCsv`):
   - CSVs now run through `detectDocumentTypes` (previously skipped entirely)
   - Returns `detectedDocumentType` and `detectedIncludedStatements`

4. **Sample size**: increased from 8000 → 12000 characters

**Test results on demo files:**
- Culinary P&L PDF: income_statement (6 strong matches) ✅
- Brighton IS/BS/CF sheets: each correctly detected ✅
- Brighton combined XLSX: combined_financials (BS+IS+CF) ✅
- Pinnacle historical XLSX: combined_financials (BS+IS+CF) ✅
- Apex informal email: no detection (0 strong, 3 weak → correctly rejected) ✅

**File changed:** `app/api/upload/route.ts`

---

### Session 2026-04-11 — Edit & resubmit KPI forms + version history

**Edit submitted forms (ConfirmationSummary + ChatInterface):**
- "Edit Submission" button on submitted cards (Pencil icon, outline style)
- Version badge (blue "v2", "v3") on submitted cards when version > 1
- "Editing v{N}" amber badge on draft cards loaded from existing submissions
- `handleEdit(messageIndex)` swaps submittedPayload→pendingPayload for in-place editing
- handleConfirm stores version from API response on the message

**Chat-driven edit flow (load_submission_for_edit tool):**
- New Anthropic tool: `load_submission_for_edit` with `period` + optional `company_name` params
- Server handler queries latest submission for company+period, loads KPI values + documents
- Sends SSE event with payload, detectedDocuments, currentVersion, companyId, companyName, enabledKpis, userId
- Works from BOTH company mode (period only) and Q&A mode (period + company_name fuzzy match)
- Client handler in ChatInterface renders editable card pre-populated from DB
- editCompanyIdRef + editCompanyNameRef + editEnabledKpisRef + editUserIdRef handle Q&A mode context
- No panel mode switch needed — refs provide all context for confirm flow
- System prompt instructs Claude to call tool immediately (no confirmation, no narration)

**Version tracking in API:**
- `writePeriodicSubmission()` returns `{ id, version }` instead of just `id`
- `/api/review` returns `version` in response JSON
- `isResubmission` flag now correctly set to `version > 1` in email notification

**Message persistence fix:**
- PersistentChatPanel now passes `companyMeta.initialMessages` to ChatInterface (was hardcoded `[]`)
- Submitted cards persist across page refresh (reconstructed from DB chat history)

**Submission Tracking version badge:**
- Blue "v{N}" badge shown in Status column when version > 1

**System prompt updates:**
- EDITING PRIOR SUBMISSIONS section in assembleSystemPrompt with forceful tool-calling instructions
- Portfolio Q&A prompt updated with editing knowledge + instruction to use tool directly from Q&A mode
- PLATFORM KNOWLEDGE bullets updated in both prompts

**Files changed:**
- `lib/server/submissions.ts` — return type change
- `app/api/review/route.ts` — version in response, isResubmission fix
- `app/submit/[token]/_components/ConfirmationSummary.tsx` — Edit button, version badge, editing badge
- `app/submit/[token]/_components/ChatInterface.tsx` — handleEdit, version tracking, edit event handler, company/KPI/userId refs
- `components/layout/PersistentChatPanel.tsx` — initialMessages pass-through
- `lib/chat/handler.ts` — load_submission_for_edit tool + handlers in both chat functions
- `lib/chat/system-prompt.ts` — editing instructions + knowledge
- `app/(app)/submissions/client.tsx` — version badge

---

### Session 2026-04-13 — Dashboard & UI polish, onboarding rewrite, RAG alert consolidation

**Dashboard & UI Polish:**
1. Removed firm-wide threshold marker (dashed red line + label) from Portfolio Performance bar chart — removed SEVERITY_COLOR, RULE_LABEL, SEVERITY_LABEL constants, ReferenceLine import
2. Added period label to bar chart heading: "Latest Submission · Feb 2026" (derived from most common period across companies)
3. Added left border to Pulse AI chat panel (`border-l border-border` on expanded panel container)
4. Made company names clickable on dashboard — bar chart Y-axis, trend legend, alert cards all link to `/analytics?company={id}`. Default black text, blue on hover only (no underline)
5. Removed redundant date displays on Company Analytics — removed "Showing April 2026" next to dropdown and "Viewing Apr 26" badge above chart
6. Added Gross Margin to Plan Attainment table between Revenue and EBITDA. Removed "Overall" column. Added vertical separators between KPI sections. Fixed `undefined%` bug for null percent values. Removed "(through Apr)" from title since Through column exists per row
7. Added per-KPI staleness indicator — when a KPI's latest data is from an earlier month than the company's latest submission, cells render italic at 70% opacity with hover tooltip "Data through Feb only"

**Onboarding System:**
8. Added onboarding reminder chip to Pulse AI chat panel — appears when a company with pending/in_progress onboarding is selected on Analytics or Company Settings. Created `/api/companies/onboarding-remind` endpoint. Updated `/api/companies` to return `onboardingStatus`
9. Rewrote onboarding system prompt for proper data granularity handling — monthly, quarterly, semi-annual, annual, multi-year, mixed granularity, non-calendar fiscal years. Core rule: never fabricate data at finer granularity than provided
10. Updated onboarding UI hint — changed to "All data will be processed unless otherwise noted" (opposite of periodic's "Only data from periods you list will be collected")

**Alert System Consolidation (RAG):**
11. Rewrote dashboard alerts to use RAG (% variance from plan) instead of absolute threshold rules. Rewrote `getLatestSubmissionRagCount()` in `lib/server/analytics.ts` and updated `LatestSubmissionKpiViolation` type. Alert cards now show "Off Track: -23.5% vs plan" instead of "Off Track if < $500K". Companies without a plan are excluded from alerts
12. Updated dashboard alert card UI — shows KPI actual value + variance % from plan with color coding

**Audit Findings:**
- `evaluateAlerts()` in `lib/server/alerts.ts` is dead code (never called)
- `sendRagAlertEmail()` in `actions.ts` is the active alert email system (already RAG-based)
- `threshold_rules` and `alerts` tables left in DB but no longer read for display
- Company Analytics `activeAlerts` reads from `alerts` table but is not rendered in UI

**Files changed:**
- `components/charts/portfolio-chart.tsx` — removed threshold line, added period label, clickable company names
- `components/layout/PersistentChatPanel.tsx` — left border, onboarding chip
- `app/(app)/analytics/client.tsx` — removed redundant date label
- `components/charts/trend-chart.tsx` — removed "Viewing" badge
- `app/(app)/dashboard/page.tsx` — clickable company names, RAG-based alert cards
- `components/dashboard/plan-attainment.tsx` — added Gross Margin column, separators, staleness indicator
- `lib/server/analytics.ts` — added grossMargin to plan summary, rewrote getLatestSubmissionRagCount to RAG
- `lib/chat/system-prompt.ts` — rewrote onboarding period handling
- `app/submit/[token]/_components/ChatInterface.tsx` — updated onboarding hint text
- `app/api/companies/route.ts` — added onboardingStatus to response
- `app/api/companies/onboarding-remind/route.ts` — new endpoint

### Session 2026-04-13 (continued) — Chat panel fixes, onboarding overhaul, dashboard chart filter

**Chat panel company list refresh:**
- Company list in Pulse AI "Select a company" dropdown was stale — fetched once on mount, never refreshed
- Added `chatOpen` to the useEffect dependency array in `PersistentChatPanel.tsx` — refetches `/api/companies` every time panel opens
- Newly added companies (e.g., Pinnacle Retail) now appear without hard refresh

**Onboarding banner removed from Company Settings:**
- Removed blue "Onboarding request sent to X operators" banner from Company Info tab
- Removed: banner JSX, `sendingOnboarding` state, `handleSendOnboardingRequest` handler, `sendOnboardingRequestAction` server action from `client.tsx` and `actions.ts`
- Onboarding reminders now managed exclusively via Pulse AI chat chips (existing chips on Analytics/Company Settings pages)
- `/api/companies/onboarding-remind` endpoint preserved (used by chat chip intercept)

**Onboarding context card period fix:**
- Period input now clears when "Onboarding" data type is selected (was autofilling with current period)
- Changed `contextPeriods` state initialization from `contextPeriod ?? ""` to `""` — empty for all modes
- `contextPeriod` still used as placeholder hint text

**Onboarding multi-year extraction (agentic loop in handler.ts):**
- `handleChatRequest`: Added while loop that continues when `stop_reason === "tool_use"` in onboarding mode
- After absorbing each period, builds tool_result messages and continues conversation with Claude
- Claude gets confirmation ("Saved N KPIs for FY20XX. Continue with next period.") and processes remaining years
- Capped at 10 iterations for safety
- `SUBMIT_STRUCTURED_DATA_ONBOARDING_TOOL` description updated to mention multi-period behavior
- Periodic mode completely unchanged (loop exits after first iteration)

**Firm-side onboarding support (agentic loop in pulse handler):**
- `handlePulseChatRequest` was hardcoded to periodic mode — firm users selecting "Onboarding" still went through periodic endpoint
- Added `isOnboarding` detection from `contextDataType`
- When `isOnboarding && company`: uses `assembleOnboardingSystemPrompt(ctx)`, onboarding tool set, and full agentic while loop (same pattern as operator handler)
- Auto-absorbs onboarding data, sends `onboarding_absorbed` events to client
- Opening question changed to onboarding-specific message
- Tool choice forcing disabled for onboarding mode
- Periodic-only events (record_document, void_session, load_for_edit) gated with `!isOnboarding`

**Period labels for non-monthly data:**
- Added `periodLabel` field to submission payload (optional)
- System prompt instructs Claude: annual → "FY2025", quarterly → "Q1 2024", semi-annual → "H1 2024", monthly → omit
- `onboarding_absorbed` event includes `periodLabel` from payload
- ChatInterface `onboarding_absorbed` handler uses `event.periodLabel || formatPeriodLabel(event.period)`
- ConfirmationSummary accepts optional `periodLabel` prop, uses it when present for card header

**Dashboard chart filter — exclude onboarding-only companies:**
- `getPortfolioChartData` now filters out companies with `onboardingStatus = "pending"` or `"in_progress"`
- Prevents annual onboarding data (e.g., Pinnacle $21.5M annual revenue) from being compared against monthly data
- Chart title changed to "Portfolio Performance — Periodic Submissions" (covers both bar and trend charts)
- Snapshot sub-heading remains "Latest Submission" (no period date — varies by company)
- Removed the old "Latest Submission · APR 2026" format (period label was misleading)

**Confirmed (no code changes):**
- Firm users can submit onboarding data without operators via Pulse AI panel (select company → Onboarding mode)
- Onboarded data correctly flows to Analytics page (no investmentDate filter there)
- Submission Tracking excludes pre-investment periods by design (investmentDate filter) — left as-is per user decision

**Files changed:**
- `components/layout/PersistentChatPanel.tsx` — chatOpen dependency for company list refresh
- `app/(app)/admin/companies/client.tsx` — removed onboarding banner + related state/handler
- `app/(app)/admin/companies/actions.ts` — removed sendOnboardingRequestAction
- `lib/chat/handler.ts` — agentic loop for onboarding (both handleChatRequest + handlePulseChatRequest), periodLabel passthrough, isOnboarding detection in pulse handler
- `lib/chat/system-prompt.ts` — periodLabel in schema + instructions
- `app/submit/[token]/_components/ChatInterface.tsx` — period clear on all modes, periodLabel usage in absorbed handler
- `app/submit/[token]/_components/ConfirmationSummary.tsx` — periodLabel prop
- `lib/server/analytics.ts` — onboarding status filter in getPortfolioChartData, snapshot label updates
- `components/charts/portfolio-chart.tsx` — chart title "Portfolio Performance — Periodic Submissions", removed period label from snapshot heading
- `app/(app)/dashboard/page.tsx` — removed period selector client component (was added then reverted)

### Session 2026-04-13 (continued) — RAG audit, dashboard polish, Q&A chip persistence

**RAG audit — full cleanup:**
- Removed `hasAlert` from `getPortfolioChartData()` and `portfolio-chart.tsx` (was reading `alerts` table, never rendered)
- Removed `kpiThresholds` from `getPortfolioChartData()` (built from `threshold_rules`, never consumed by any component)
- Migrated monthly digest (`/api/cron/monthly-digest`) from `alerts` table count to `getLatestSubmissionRagCount()` (plan variance)
- Updated chat system prompt: replaced `thresholdRules` query with `ragThresholds` from `kpiDefinitions` (ragDirection, ragGreenPct, ragAmberPct)
- Removed dead `evaluateAlerts()` function from `lib/server/alerts.ts`
- Removed unused `activeAlerts` query + field from `getCompanyAnalytics()` (read from `alerts` table, never rendered in UI)
- Removed threshold fallback from `KpiHealthChart` — now plan-only RAG, shows "No plan configured" when no plan exists
- Removed threshold query from `getCompanyAnalytics()` (was feeding KpiHealthChart fallback)
- **Result: zero runtime reads of `alerts` table, one remaining read of `threshold_rules` in seed only**

**Dashboard plan resolution bug fix:**
- `getLatestSubmissionRagCount()` had a simplified plan value resolver that only handled 2 cases (annual and monthly)
- Missed `quarterly_end` (Headcount), `quarterly_total`, `annual_end`, and per-KPI `planGranularity`
- Caused Headcount to show as massively off track (comparing against wrong plan value)
- Replaced with full 6-case granularity switch matching `getPlanValue()` logic from `getCompanyAnalytics()`

**Dashboard Off Track / At Risk grid polish:**
- Removed redundant "Off Track" / "At Risk" status labels from each KPI row (already in section heading)
- New KPI row format: `EBITDA >15% from plan of $4,200    -28.6% ($3,011)` — left shows rule threshold + plan, right shows variance % + actual
- Added `rulePct` to `LatestSubmissionKpiViolation` type (threshold % that triggered the status)
- Heading counts now show **violation count** (individual KPIs) not company count

**Other UI changes:**
- Removed "Total Submissions" stat card from Company Analytics Key Metrics (not relevant)
- Context card period placeholder now dynamic — shows firm's latest open period (e.g., "April 2026") instead of hardcoded "March 2025"

**Q&A chip persistence:**
- Chips now stay visible in Q&A mode after questions are asked/answered (was disappearing after first user message)
- Used chips rotate out and get replaced by next in the pool
- Full chip pools passed to ChatInterface (Dashboard: 6 chips, Company: 5 chips) — was previously sliced to 2
- Submission mode still suppresses chips after first message (conversation starters only)

**Submission intent detection from Q&A panel:**
- Added `onMessageIntercept` callback to ChatInterface — lets parent intercept user text before it goes to the AI
- PersistentChatPanel detects submission intent: explicit phrases ("submit data", "enter data"), 3+ numbers, or file uploads
- Question patterns excluded from interception ("what", "how", "show me", etc.)
- Company auto-detection from message text via `matchCompanyFromFilename`
- If company found: auto-switches to submission mode and forwards the message
- If not found: opens company picker, stashes text as `pendingSubmissionText`, forwards after selection

**Files changed:**
- `lib/server/analytics.ts` — removed hasAlert, kpiThresholds, activeAlerts, threshold queries; fixed plan resolution; added rulePct
- `lib/server/alerts.ts` — emptied (dead code removed)
- `lib/chat/system-prompt.ts` — replaced thresholdRules with ragThresholds from kpiDefs
- `app/api/cron/monthly-digest/route.ts` — migrated to getLatestSubmissionRagCount
- `app/(app)/dashboard/page.tsx` — grid redesign, violation counts
- `app/(app)/analytics/client.tsx` — removed Total Submissions card, removed thresholds prop
- `components/charts/portfolio-chart.tsx` — removed hasAlert
- `components/charts/kpi-health-chart.tsx` — removed threshold fallback, plan-only RAG
- `app/submit/[token]/_components/ChatInterface.tsx` — onMessageIntercept, Q&A chip persistence, context period
- `components/layout/PersistentChatPanel.tsx` — submission intent detection, full chip pools, pendingSubmissionText
- `app/api/chat/context/route.ts` — added latestPeriodLabel
- `app/submit/[token]/page.tsx` — dynamic contextPeriod from latest open period

---

## What's next — Phase 3 remaining

**Phase 3 remaining:**
1. Wire company-specific KPIs into chat submission
2. Fix variance coloring for lower-is-better KPIs (CapEx, Churn Rate, etc.)
3. Submission Tracking UX review
4. Combined financials edge case
5. Blocklist mode for member access scopes
6. Verify document badge fix — after hard refresh, confirm Brighton's chat card shows BS/IS/CF green
7. End-to-end test onboarding multi-year flow — upload Pinnacle historical XLSX, verify all 3 years ingested with correct period labels
8. Test firm-side onboarding via Pulse AI panel — select company, choose Onboarding, upload file
9. Verify build compiles cleanly

**Audit items (low priority):**
- `threshold_rules` and `alerts` tables remain in DB schema + seed but have zero runtime reads — consider dropping in a future migration
- `sendThresholdBreachEmail()` in email.ts is orphaned
- `components/dashboard/period-selector.tsx` was created but never used — can be deleted

**Demo prep remaining:**
- Test full drag-drop submission flow end-to-end
- Test onboarding flow with Pinnacle historical XLSX after db:reset
- Verify chat panel resets properly across all navigation paths
- Verify document badges match Submission Tracking on all companies

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
- **Add Company dialog**: all fields required (name, fund, industry, investmentDate). investmentDate defaults to today. Button disabled until all filled.
- **investmentDate filter**: compare by YYYY-MM month granularity, not exact day. Fallback to createdAt for legacy companies.
- **Document checklist**: replaces old "Documents detected" banner. Shows required docs with ✓/✗/○ status, cadence-aware, combined financials coverage.
- **Document badge row**: always shows ALL 4 doc types (BS, IS, CF, IU) as inline badges. Gray = not required, green = detected, red = missing. Interactive on draft cards (toggle via onToggleDoc). Replaces old text-based ✓/✗/○ checklist.
- **show_last_card tool**: dedicated tool for re-showing submitted cards. Never use submit_structured_data for re-show (that creates a new draft). Client finds last submittedPayload and appends read-only copy.
- **Canceled card state**: canceledPayload on ChatMessage. Cancel swaps (not deletes). Gray badge with XCircle. Read-only.
- **Document detection linked to DB**: context API queries financial_documents for submitted cards. Same source as Submission Tracking. combined_financials expanded via includedStatements.
- **Q&A-first panel architecture**: Pulse AI panel starts in Q&A mode on ALL pages. `companyIdFromUrl` is never auto-set to `activeCompanyId`. User enters submission mode explicitly via "Submit data for a company →" chip. Exit returns to Q&A.
- **No chips in submission mode**: When `effectiveCompanyId` is set, promptChips and fixedChip are empty. Context card handles submission type selection.
- **Page-specific Q&A chips**: Each page has its own chip pool. Analytics/Settings use `urlCompanyName` (from companyList + companyIdFromUrl) for company-specific Q&A chips without entering submission mode.
- **Document detection by line items**: Detection uses DOC_TYPE_STRONG (structural keywords unique to each statement type) + DOC_TYPE_WEAK (generic financial terms). Requires 2+ strong OR 1 strong + 1 weak. Weak-only never triggers. This prevents informal emails from being misclassified.
- **Raw PDF fallback detection**: When pdf-parse fails, buffer.toString("latin1") extracts raw PDF stream text for detection before falling back to undetected vision.
- **CSV detection**: CSVs now run through detectDocumentTypes (previously no detection).
- **Dashboard alerts use RAG**: Alerts are now based on % variance from plan (not absolute threshold rules). Companies without a plan are excluded. `getLatestSubmissionRagCount()` is the source. Old `evaluateAlerts()` is dead code.
- **Clickable company names**: Dashboard bar chart Y-axis, trend legend, and alert cards link to `/analytics?company={id}`. Default black text, blue on hover only — never permanently blue.
- **Plan Attainment table**: Shows Revenue, Gross Margin, EBITDA (3 KPIs). No "Overall" column. Vertical separators between KPI sections. Per-KPI staleness indicator (italic + 70% opacity + tooltip).
- **Gross Margin YTD**: Averaged (not summed) because it's a percentage KPI. Annual plan target used directly (no prorating).
- **Onboarding data granularity**: Never fabricate finer granularity than provided. Annual totals → last month of fiscal year. Never divide by 12 to create fake monthly data.

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
