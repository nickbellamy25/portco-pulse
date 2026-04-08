# Context — PortCo Pulse
Project-specific rules and lessons. Format: `[YYYY-MM-DD] | what went wrong | rule to prevent it`

---

## Database & Migrations

[2026-03-14] | Drizzle migrate() sometimes doesn't pick up new migration files in tsx scripts | Apply schema changes manually: `node -e "const Database = require('better-sqlite3'); const db = new Database('portco-pulse.db'); db.exec('ALTER TABLE ... ADD COLUMN ...'); console.log('done');"` — always verify with a quick select after.

[2026-03-14] | Hard-deleting kpi_definitions throws FK constraint error | Always soft-delete KPIs: `db.update(schema.kpiDefinitions).set({ active: false }).where(...)`. First delete threshold_rules for that KPI (no downstream FKs), then soft-delete the definition. Never hard-delete.

[2026-03-19] | db:reset wiped manual columns not tracked by Drizzle | `pnpm db:reset` is now the ONLY command needed — seed.ts embeds all manual migrations. No separate migrate-manual.js needed. Steps: (1) stop dev server, (2) `pnpm db:reset`, (3) start dev server, (4) log out and back in.

[2026-03-14] | SQLite EPERM file lock during db:reset | Always stop the dev server (Ctrl+C) before running `pnpm db:reset`. SQLite on Windows locks the .db file.

[2026-03-14] | Stale firmId in JWT session after db:reset | After any db:reset, log out and back in before testing — the session has the old firmId which no longer exists.

---

## KPI Config

[2026-03-19] | KPI settings changed via UI reverted on db:reset | Seed script is source of truth. When changing any KPI config (direction, thresholds, label, etc.), always update BOTH the live DB AND `scripts/seed.ts` so the change survives a future db:reset.

[2026-03-20] | Headcount ragDirection was "higher_is_better" causing wrong coloring | Changed to "any_variance" — Headcount is a neutral stock metric, not directional. See `scripts/seed.ts` around the Headcount KPI definition.

---

## Date Handling

[2026-03-15] | `new Date("YYYY-MM-DD")` parses as UTC midnight, shifts one day back in Eastern time on Windows | Always parse YYYY-MM-DD strings with noon suffix: `new Date(dateStr + "T12:00:00")`. For outputting back to YYYY-MM-DD after date arithmetic, use local components: `` `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` `` — never `.toISOString().slice(0,10)` which converts to UTC.

[2026-03-15] | Business day calculations produced wrong end dates | Start date cursor from noon (not midnight or end-of-day) so result dates are also at noon and safe for toLocalDateStr.

---

## UI / Display

[2026-03-18] | KPI unit "#" rendered next to numbers looked wrong | Suppress the `#` unit entirely — show count as plain number. Rule for all `fmtVal` functions: `$` prefix for currency, `%` suffix for percentage, nothing for all other units including `#`.

[2026-03-20] | Status badge labels inconsistent across the app | Standard is "On Track / At Risk / Off Track" everywhere. Never use "High/Medium/Low Priority" or "Green/Amber/Red" as text labels. Badge colors: green for On Track, amber for At Risk, red for Off Track.

---

## Fonts / CSS

[2026-03-14] | Tailwind v4 `@theme inline` circular reference (`--font-sans: var(--font-sans)`) didn't resolve | Set font directly on `body` in `@layer base` in globals.css: `font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;`. Don't use @theme tokens for this. Next.js font variable is set with `variable: "--font-sans"` in layout.tsx.

---

## Production Standards

[2026-03-19] | Multiple instances of localhost hardcoding found | Never hardcode `localhost` or any URL. Always use `process.env.NEXT_PUBLIC_APP_URL`. File paths must use `DB_PATH` / `UPLOADS_DIR` env vars. Email sender must come from DB settings, not hardcode. All code must work in production with only the deployment checklist steps.

---

## Shell / Terminal

[2026-03-14] | PowerShell breaks multi-line `node -e "..."` quotes badly | Never use multi-line `node -e "..."` in PowerShell. Write a .js file and run with `node file.js` instead.

[2026-03-14] | Commands with `&&` don't work in VSCode terminal on this machine | Run commands separately, not chained with `&&`. VSCode terminal is PowerShell.

---

## Charts

[2026-03-18] | Threshold lines on trend chart only appeared for some companies and looked confusing | Removed threshold lines from the Performance Trends chart. KPI Health tiles (pure text, no bars) cover the same info more cleanly.

[2026-03-18] | Bars/gauges on KPI Health tiles added visual noise without insight | KPI Health = pure text tiles only. No bars, no gauges. Fixed width `w-72`, flex-wrap layout.

---

## Chat Q&A Response Style

[2026-04-06] | Chat Q&A responses were too wordy — lead-up sentences, "Here's what I found" preambles, assistant framing | Both `assemblePortfolioQASystemPrompt` and the ANSWERING KPI QUESTIONS section of `assembleSystemPrompt` must enforce: (1) lead with the answer/number, (2) no preambles, (3) short sentences, (4) written summary 2–3 lines max (tables are fine), (5) analyst tone — state facts directly. Persona is "senior PE analyst", not "analytics assistant". Never regress these rules.

---

## Analytics

[2026-03-20] | Summing incomplete monthly ÷12 plan values gave wrong quarterly/annual totals | For $ KPIs with annual-granularity plans: store raw annual target separately (`planAnnualTarget`). Client uses `planAnnualTarget / 4` for quarterly plan and `planAnnualTarget` directly for FY Plan — never sum the per-month ÷12 values.

[2026-03-20] | Aggregation rules unclear across view modes | $ (currency) → sum. % (percent) → average. # (count/integer) → last (end-of-period stock metric, e.g. headcount at end of quarter).

---

## Workflow

[2026-04-06] | Direct file edits made instead of using subagents — violates CLAUDE.md workflow rule | All code changes, file edits, and codebase exploration MUST go through the Agent tool. Use Explore subagent for reading/exploring, general-purpose subagent for edits. Never use Edit/Write/Bash tools directly on app code. Only use Read/Grep/Glob to gather just enough context to brief a subagent precisely.

---

## Chat Pane — Submission Tracking Chips

[2026-04-06] | Outstanding API returned a single combined `outstanding` array — no distinction between companies with no record vs partial submissions | Split into `noSubmission` (no submission record at all) and `partial` (record exists but status !== "submitted"). Both arrays required for the two dynamic reminder chips.

[2026-04-06] | Reminder chips were generic and didn't distinguish submission state | Submission Tracking chips: static "Which companies are at risk of missing this period's deadline?", dynamic "Send reminders to companies with no submission" (if noSubmission.length > 0), dynamic "Send reminders to companies with partial submissions" (if partial.length > 0). Never add back "Who hasn't submitted" or "most recently" chips — those are obvious from the page.

---

## Chat Pane — File Attachment

[2026-04-06] | FileUploadZone was a plain function — callers couldn't trigger file open or pass dropped files from outside the component | FileUploadZone is now a forwardRef component exposing `FileUploadZoneHandle` (`handleFiles`, `triggerOpen`). Always use the ref when embedding in ChatInterface for the paperclip button. The `compact` prop hides the drop zone and shows only pending chips.

[2026-04-06] | PortfolioQAPane file attachment doesn't upload to backend — Q&A endpoint doesn't support files | For Q&A pane: files are collected as `qaPendingFiles` (File[]) state and appended as `[Attached: filename]` lines in the sent message text. No actual upload occurs. This is intentional — the icon provides UI consistency without backend scope creep.

---

## Chat Pane — Session Persistence

[2026-04-06] | portfolioMessages state was in ChatPanelExpanded which unmounts when panel closes — messages lost on every close | Lifted to PersistentChatPanel (always mounted), backed by sessionStorage key `pulse_qa_messages_v1`. Lazy initializer reads from sessionStorage on mount; useEffect writes on every change. Cleared by topbar signOut before calling NextAuth signOut. CompanyChat messages are handled server-side (no change needed).

---

## Chat Pane — Auto-collapse

[2026-04-06] | Auto-collapse on navigation (pathname useEffect in PersistentChatPanel) was removed per user request | Panel now stays open when navigating between pages. If re-adding collapse behavior in the future, use prevPathnameRef guard to skip mount, and only collapse if the panel was already closed (not force-close on open panels).

---

## Chat Pane Layout

[2026-04-06] | Chat pane used `position: fixed` rendered outside the flex row, then `sticky` inside the flex row — both caused overlay | Correct pattern: `h-screen flex flex-col` on the outer shell, `shrink-0 z-40` on the topbar wrapper, `flex flex-1 min-h-0` on the content row, `overflow-y-auto` on `<main>`. Panel is a plain flex child: `w-[360px] shrink-0 border-l border-border bg-white flex flex-col overflow-hidden` — no `fixed`, no `sticky`, no `z-index`. Page content scrolls within `<main>`, not the browser window. Never use `sticky` or `fixed` for the chat panel.

[2026-04-06] | Chat pane bottom gets clipped — message input not visible | Chat pane outer div must include `h-full` to fill the available height from its flex-row parent. Without it, the panel only sizes to its content and `overflow-hidden` clips the footer. Full class set: `shrink-0 h-full border-l border-border flex flex-col overflow-hidden transition-[width] ...`.

[2026-04-06] | `h-full` on inner chat panel divs caused bottom cutoff despite outer `h-full` being correct | In a `flex flex-col` parent, inner children must use `flex-1 min-h-0` (not `h-full`) to correctly fill remaining space. `h-full` resolves as a percentage of the parent's block size and is unreliable in flex context. Applies to: `ChatPanelExpanded` root div, `PortfolioQAPane` root div, and any full-height flex children inside the panel.

[2026-04-06] | ROOT CAUSE of persistent chat pane bottom cutoff: `zoom: 0.85` on root layout wrapper | `app/layout.tsx` line 31 wraps all children in `<div style={{ zoom: 0.85 }}>`. CSS `zoom` scales elements visually to 85% but `h-screen` (100vh) uses the unscaled viewport height. Result: the panel covers only 85% of the visible viewport and the bottom 15% is blank/clipped. Fix: remove `zoom: 0.85` from the root layout wrapper div. The inner flex chain (layout.tsx → PersistentChatPanel.tsx) is structurally correct — `zoom` was the only issue.

[2026-04-06] | `bg-white` Ask AI tab was invisible — blends into white page background | Never use `bg-white` on the closed chat tab; the page background is also white so the tab disappears. Use `bg-gray-50` (slightly off-white) or a clearly distinct color. Diagnostic test: use `bg-red-500` to confirm hot-reload is working, then apply the real color.

[2026-04-06] | Ask AI tab color spec (confirmed by user): white bg, black text, light gray border | Exact spec: `background-color: white`, `color: black` for "Ask AI" text, `border: 1px solid #e0e0e0`, `hover: background #f5f5f5`. Keep green (`text-green-600`) ONLY for the small icon. Do not use any green on the background or text.

[2026-04-06] | Hint text rendered twice in company chat — once as `<p>` above textarea, once as textarea placeholder | `ChatInterface` renders its `hintText` prop as a `<p>` above the textarea. Do not pass `hintText` from `CompanyChat` — the textarea placeholder is sufficient. If removing the paragraph hint from `ChatInterface` entirely, also update the submit page to ensure it doesn't rely on it.

[2026-04-06] | Direct file edits made instead of using subagents — violates CLAUDE.md workflow rule | All code changes, file edits, and codebase exploration MUST go through the Agent tool with appropriate subagents (general-purpose for edits, Explore for exploration). Never use Edit/Write/Bash directly for app code. The main context reads files only to brief a subagent precisely.

[2026-04-06] | Assistant message bubble background didn't extend behind wide table content — `max-w-[85%]` was applied to both user and assistant bubbles | For chat message bubbles: user messages get `max-w-[85%]` (right-aligned pill), assistant messages get `w-full overflow-x-auto` (full-width block) so tables and other wide content are always contained within the background.

[2026-04-06] | Chat AI summary contradicted its own table — stated Culinary Concepts had fastest revenue growth when the table showed OptiFi at +2.8% (Culinary was worst at -9.9%) | Add consistency rule to system prompt: written summary must always match the data/table generated. Never let narrative contradict numbers.

[2026-04-06] | Chat AI narrated its thought process out loud ("Wait — correcting the sort:") in a PE analyst context | System prompt must explicitly prohibit self-correction narration — present only the final correct answer, never the reasoning process.

[2026-04-06] | Chat AI still opened with wrong company name before self-correcting, even after no-narration rule | No-narration rule alone is insufficient — model generates opening line before computing. Need explicit compute-first rule: "When ranking or comparing, compute the correct answer from data FIRST, then write. Opening statement must match the conclusion."

[2026-04-06] | Chat Q&A conclusions repeated table data verbosely — named 2nd and 3rd place, restated trends visible in the table | Conclusion rule: one sentence answering exactly what was asked (winner + key figure). Only add a second sentence if it reveals something NOT shown in the table. Never name 2nd/3rd place unless asked. If it's in the table, don't repeat it in prose.

[2026-04-06] | Chat Q&A tables had no visual hierarchy — all rows looked equal | Table formatting rule: bold all column headers (**header**). Bold every cell in the most relevant row (**value**) — e.g. the top-ranked company in a ranking question.

[2026-04-06] | Chat Q&A added a conclusion sentence that just restated what the bold row already showed | If the answer is visually clear from the bolded row, omit the written conclusion entirely. Only add a conclusion if it reveals something NOT in the table (e.g. all companies declined, a notable outlier). Never restate the bold row in prose.

[2026-04-06] | Chat Q&A tables were not sorted by the metric relevant to the question | Table rows must be sorted by the metric most relevant to the question — e.g. fastest-growth question → sort by growth rate descending so the answer is at the top row.

[2026-04-06] | Collapsed Pulse AI tab showed icon after text — icon appeared at top of flex-col but vertical-rl + rotate(180deg) text reads bottom-to-top, so visually the order was reversed | In a flex-col vertical tab with rotated text, DOM order is visually reversed. To read "icon → text" from bottom to top, put the text span FIRST in DOM and the icon SECOND. The expanded header (icon then text, left-to-right) is the reference — the collapsed tab must match it visually.

[2026-04-06] | Notification linkUrl pointed investors to /submit/[token] operator chat UI | In topbar handleClick, intercept linkUrls starting with /submit/ or /onboard/ and redirect to /submissions for firm-side users. The onboarding_request notification correctly targets operators in code but stale DB data can affect investors.

[2026-04-06] | PortfolioQAPane messages state was component-local — lost on navigation | Lift messages state to ChatPanelExpanded and pass as props to PortfolioQAPane. This keeps the portfolio chat session alive when user navigates between Dashboard, Analytics, and back.

[2026-04-06] | Chip auto-send in ChatInterface must guard against re-firing on re-render | Use autoMessageSentRef (useRef) to ensure autoMessage only fires once. The ref persists across re-renders unlike a useState flag.

[2026-04-06] | Collapsed tab writing-mode/rotation iterated many times without convergence | FINAL SOLUTION for collapsed vertical tab: render icon + label as a normal horizontal flex row (identical to expanded header: `flex items-center gap-2`), then rotate the entire container with `transform: rotate(270deg)` as a single unit. No writing-mode, no per-element rotation. Any future change to the tab must follow this pattern — do not reintroduce writing-mode.

[2026-04-06] | autoMessage prop in ChatInterface could re-fire on re-render | Guard with `useRef`: `const autoMessageSentRef = useRef(false)`. Set to true before calling sendMessage. Never use useState for this guard — it causes an extra render cycle.

[2026-04-06] | Company context pill (green badge) reverted in chat panel header | Delete the `badge` variable entirely from ChatPanelExpanded — never re-add. Company name is implied by the chat context.

[2026-04-06] | Company chips rendered above ChatInterface instead of at bottom | Always pass chips via `promptChips` prop to ChatInterface; never render a chip div above the component. ChatInterface renders them above its own input area.

[2026-04-06] | Chat panel stayed open when navigating between pages | Add a pathname-watching useEffect in PersistentChatPanel (outer component) that collapses if chatOpen is true on route change. Guard with prevPathnameRef to skip mount.

[2026-04-06] | Submission Tracking chips were generic status questions visible on the page | Chips on /submissions must be action-oriented. Static: "Who hasn't submitted this period?", "Which company submitted most recently?". Dynamic reminder chip: only show if outstanding companies exist, name them, trigger confirmation flow before calling sendRemindersAction.

[2026-04-06] | Chat Q&A tables still not sorted by relevant metric in growth questions | Sort rule must be explicit: sort by the metric that answers the question (e.g. for growth questions sort by growth %, not absolute value). Compute full sort before writing context line. This is in assemblePortfolioQASystemPrompt.

[2026-04-06] | Chat Q&A conclusions still verbose with seasonal notes and run-rate commentary | Conclusion rule must explicitly forbid: seasonal explanations, run-rate commentary, interpretations of why the winner won. Only add conclusion for structural data limitations causing misinterpretation.

---

## Chat Pane — System Prompt Quality

[2026-04-07] | Company chat (Analytics) had weaker ANSWERING KPI QUESTIONS rules than portfolio Q&A — different quality standards per tab | The ANSWERING KPI QUESTIONS section in `assembleSystemPrompt` must be kept identical to the ANSWERING QUESTIONS rules in `assemblePortfolioQASystemPrompt`. Any future prompt quality changes must be applied to BOTH functions simultaneously.

[2026-04-07] | Added clarifying questions rule — AI started asking about obvious PE terms like "active KPI alerts" | Clarifying questions rule must use PE analyst judgment: standard terms are interpreted directly, never asked about. Only ask when question is truly unresolvable. Never offer "if you meant X" alternatives — pick best interpretation and answer it.

[2026-04-07] | AI was explaining data gaps ("I don't have access to deadline policies") instead of answering | No-hedging rule: never explain what data you don't have unless the question literally cannot be answered. Never offer multiple interpretations. Pick the most reasonable read and answer it.

---

## Chat Pane — Chips

[2026-04-07] | Submit chip must never cycle out of rotation regardless of being clicked | Fixed chips (submit, informational settings chips) are rendered separately from the rotating pool and never added to `usedChips`. Rotating chips fill the remaining slots. The submit chip occupies slot 3 on most pages, slot 1 on Submissions.

[2026-04-07] | AI settings editing via chat decided against | Settings chips are informational only. No `propose_setting_change` tool, no mutation API. If this is ever revisited, it requires: new tool in handler.ts, confirmation card UI, PATCH API endpoint, and notification on alert-rule changes.

---

## Analytics / Submissions Bug

[2026-04-07] | `status is not defined` crash in `analytics.ts:1096` when viewing old Submissions period | Variable was `status` but should be `baseStatus` (defined ~15 lines above). Always use `baseStatus` in `getSubmissionTracking` — the `status` object key is assigned from it, not the other way around.

---

## ChatInterface

[2026-04-07] | ChatInterface `text-sm` was larger than PortfolioQAPane `text-xs` when rendered in the compact panel | `ChatInterface` has a `compact` prop. Set `compact={true}` in `CompanyChat` (panel context). Never set it on the operator submission page. Affects: message bubble font + padding, textarea font, quick reply chip font.

---

## Chat Chips

[2026-04-07] | Submit chip was buried at end of rotating pool — only visible after 4 other chips were used | `ChatInterface` has `fixedChip` prop. Fixed chips are always rendered last, never added to `usedPromptChips`. Pool is capped at 2 when `fixedChip` is present so total visible stays at 3.

[2026-04-07] | Prompt chips showed during active submission (after AI started asking for values) | Add `!messages.some(m => m.role === "user")` to the chips render condition. Chips are for conversation start only — suppress as soon as user has sent any message.

[2026-04-07] | Quick reply chips and prompt chips both visible simultaneously | Prompt chips are already suppressed when `quickReplies.length > 0`. The user-message check is a separate, earlier gate.

---

## PDF Extraction

[2026-04-07] | Scanned PDFs returned "can't read" error instead of being processed | Scanned PDFs (text < 100 chars) now stored as base64 with `extractionMethod: "pdf_document"`. Handler sends them as Anthropic `document` blocks. `AnthropicContentBlock` union extended with `document` type.

[2026-04-07] | `detectDocumentTypes` only scanned first 2000 chars — missed keywords on later pages | Changed sample to 8000 chars. Combined financials (BS + IS + CF on pages 1-3) now detected correctly.

[2026-04-07] | AI asked operator to confirm document type even when it could read the PDF content | DOCUMENT RECORDING section in both system prompts updated: Claude self-identifies document types from content. Only asks if type is genuinely unresolvable. Never asks for a document with standard financial statement headings.

---

## Firm Settings

[2026-04-07] | "From Name" and "Firm Name" were two separate fields doing the same thing | Merged into one "Firm Name" field that saves to both `firms.name` (app-wide) and `emailSettings.fromName` (email sender). `saveFirmNameAction` updates firms table; `handleSave` passes `fromName: localFirmName` to `saveEmailSettingsAction`.

[2026-04-07] | Firm name, from email were in Notifications tab — wrong location | Moved to General tab (renamed from Access). Rendered as "Firm Details" section with own Save button above "Team Access" section.

---

## Notifications

[2026-04-07] | `!to.length` early return in email functions blocked in-app notifications even when email recipients ARE configured | Fixed: `!to.length` removed from early return; email-sending block now has `&& to.length > 0` guard internally. In-app notification block is unconditional (gated only by `firmId && *InAppEnabled`).

[2026-04-07] | In-app notification titles used email subjects — too long, truncated in the bell panel | Replace `title: subject` with short specific strings: `"${companyName} submitted ${period}"`, `"${companyName}: ${periodLabel} submission voided"`, `"Portfolio digest — ${monthYear}"`, `"${firmName} — share data for ${companyName}"`. Never use email subject as in-app title.

---

## Performance

[2026-04-07] | Page loads slow, notification polling too aggressive | SQLite PRAGMAs: synchronous=NORMAL, cache_size=-20000, temp_store=MEMORY. Notification poll 60s not 10s. Batch N+1 queries in analytics (period lookups, dashboard company data). Add indexes on thresholdRules and kpiDefinitions.

---

## Plan Tracking

[2026-04-07] | Plan completeness check counted company-specific KPIs (capacity_utilization, arr, etc.) that were never in the plan | Only check firm-level KPIs (companyId IS NULL) that the company actually reports on. Company-specific operational metrics are excluded from plan completeness.

---

## Drag-Drop File Submission

[2026-04-07] | autoMessage fired before file uploads completed — ChatInterface rendered and sent empty message while uploads were still in progress | Initialize `uploadingFiles` state to `true` when `initialFiles` are present: `useState(!!initialFiles && initialFiles.length > 0)`. This shows the loader immediately and prevents ChatInterface from mounting prematurely.

[2026-04-07] | Pre-chat context card ("What data are you submitting? Actuals/Plan") showed during auto-submit | Set `contextDismissed` initial state to true when `autoMessage` is present: `useState(initialMessages.length > 0 || !!autoMessage)`.

[2026-04-07] | "Switching to submission mode" message and back button created jarring UX during file submission | Remove detection message from QA pane sendMessage. Hide back button when `pendingSubmissionFiles.length > 0`. Clear chatMessages in handleFileSubmission.

[2026-04-07] | Combined file documents showed yellow badges on Submission Tracking (viaCombined flag) | Remove viaCombined distinction in DocChip — any found document shows green regardless of source.

[2026-04-07] | KPI table disappeared after clicking Submit | handleConfirm was appending a duplicate submittedPayload card. The onConfirm callback already swaps pendingPayload→submittedPayload in-place. handleConfirm should only append the success text message.

---

## Session 2026-04-07 — Chat Submission Card Fixes

[2026-04-07] | Submission card disappeared after clicking Submit — race condition between onConfirm swap and handleConfirm success message | Atomic swap: handleConfirm now accepts messageIndex and does the pendingPayload→submittedPayload swap in a single setMessages call. No separate success message appended — the green "Submitted" badge on the card is sufficient.

[2026-04-07] | "Submitted to..." message after the card was redundant | Removed entirely. The submitted card with its green badge is the confirmation.

[2026-04-07] | Company name missing from confirmation card header | Added `companyName` prop to ConfirmationSummary. Company name is the primary heading (text-base font-semibold), period title is secondary (text-sm text-muted-foreground).

[2026-04-07] | Prompt chips didn't reappear after completed submission | Changed hasActiveConversation check from `messages.some(m => m.role === "user")` to `findLastIndex` comparison — chips show again when the last user message is before the last submitted card.

[2026-04-07] | Documents detected banner and Missing KPIs banner hidden on submitted cards | Both banners had `!isSubmitted &&` guard. Removed so they show on submitted cards too.

[2026-04-07] | ConfirmationSummary too large in compact panel | Added `compact` prop. Compact uses text-[11px] for labels/values, text-[10px] for notes/section headers/banners, tighter padding (px-2.5, py-2, py-1 rows, space-y-2).

[2026-04-07] | Drag highlight on textarea flickered — dragEnter/dragLeave fired on child elements | Use counter ref pattern: dragEnter increments, dragLeave decrements, highlight clears only when counter hits 0.

[2026-04-07] | detectedDocs only populated from upload metadata, not from Claude's record_document tool calls | Added setDetectedDocs update in the record_document handler so documents identified by Claude during chat also appear in the confirmation card's detected documents banner. Fixes scanned PDFs and any file where upload auto-detection misses but Claude identifies the type.

[2026-04-07] | detectedDocuments not persisted on message object — lost on component remount | Added `detectedDocuments` field to ChatMessage interface. handleConfirm stores detectedDocs on the submitted message. Submitted card reads from `msg.detectedDocuments ?? detectedDocs`.

---

## Chat Panel Navigation

[2026-04-07] | Chat messages persisted across page navigation — old submission cards showed on unrelated pages | Added pathname-watching useEffect in ChatPanelExpanded that clears chatMessages on every route change. Uses prevPathnameRef to skip initial mount. Existing switchingCompany logic kept for same-page company tab switches.

[2026-04-07] | Switching company tabs on same page (Settings) didn't reset chat — ChatInterface stayed mounted with old messages | Root cause: chatMessages state cleared but ChatInterface's internal useState wasn't reset because component stayed mounted. Fix: add `key={ctx.companyId}` to both CompanyChat renders in PersistentChatPanel so React forces a full remount when the company changes.

---

## Submission Tracking

[2026-04-07] | New company appeared in all historical periods in Submission Tracking | Filter companies by investmentDate in getSubmissionTracking — compare by YYYY-MM month granularity (not exact day) so mid-month investments show in their month. Fallback to createdAt when investmentDate is null.

---

## Company Onboarding

[2026-04-07] | New company didn't appear on Onboarding tab | saveCompanyAction now sets onboardingStatus: "pending" on company creation. This makes new companies immediately visible on the Onboarding tab.

[2026-04-07] | No notification when new company created | saveCompanyAction now calls createInAppNotifications with eventType "onboarding_request" after company insert, targeting all firm users.

---

## Demo Files

[2026-04-07] | Demo files need to be realistic and test specific platform capabilities | Brighton XLSX: 3-tab financials (tests document recognition). Apex TXT: messy informal email (tests unstructured extraction). Culinary PDF: formatted P&L (tests PDF handling). Pinnacle XLSX: 3-year historical (tests onboarding). Seed cleans demo dir on each run (rmSync). Numbers must be plausible continuations of seeded history.

---

## Document Checklist in Submission Forms

[2026-04-08] | Document checklist not showing in chat submission forms | Pass `requiredDocs` and `requiredDocCadences` from company through page.tsx → ChatInterface → ConfirmationSummary. ConfirmationSummary renders a Required Documents section with ✓ (uploaded), ✗ (missing), ○ (not due) indicators. Cadence-aware using `isDocDue()` logic. Combined financials coverage detection included.

---

## Submission Error Handling

[2026-04-08] | /api/review returns `{ error: msg }` but ChatInterface checks `data.message` — real errors hidden behind generic alert | Changed review endpoint to return `{ message: ... }`. ChatInterface now checks both `data.message` and `data.error` as fallback. Added console.error in catch block.

---

## Company Creation — Required Fields

[2026-04-08] | New companies created without investmentDate showed in all historical Submission Tracking periods | saveCompanyAction now sets investmentDate (defaults to today). Add Company dialog now requires all fields: name, fund, industry, investmentDate. All marked with * and button disabled until filled.

[2026-04-08] | investmentDate comparison used exact day vs periodStart (1st of month) — company invested mid-month excluded from its own month | Changed filter to compare by YYYY-MM (month granularity): `effectiveDate.slice(0, 7) <= period.periodStart.slice(0, 7)`. A company invested on April 7 now correctly appears in the April period.

[2026-04-08] | Companies with null investmentDate showed in all historical periods | Filter now falls back to `createdAt` date when investmentDate is null, so legacy companies without investmentDate don't pollute historical periods.

---

## Document Checklist on Submission Card

[2026-04-08] | Document checklist only showed for companies with requiredDocs configured — companies with no required docs showed nothing | Always show ALL 4 doc types (BS, IS, CF, IU) as badge-style indicators on every submission card regardless of company config. Gray = not required, green = detected, red = required but missing. Matches Submission Tracking page DocChip style.

[2026-04-08] | Document checklist text-based (✓/✗/○) didn't match Submission Tracking badge style | Use inline badge row matching DocChip: `bg-gray-50 text-gray-300 border-gray-200` (not required), `bg-green-100 text-green-700 border-green-300` (detected), `bg-red-100 text-red-600 border-red-300` (missing). Constants: ALL_DOC_KEYS, DOC_ABBR, DOC_FULL in ConfirmationSummary.

[2026-04-08] | Document badges not interactive — user couldn't correct wrong detection | Draft cards: required doc badges are clickable (toggle green↔red via onToggleDoc callback). Gray badges not clickable. Submitted/canceled cards: read-only. onToggleDoc updates detectedDocs state in ChatInterface.

[2026-04-08] | Chat card doc badges showed all red even though documents were recorded in financial_documents table | Context endpoint (`/api/chat/context`) must query financial_documents for each submitted card and attach detectedDocuments. Expansion: combined_financials → individual statement types via includedStatements. This links chat cards to the same DB source as Submission Tracking.

[2026-04-08] | requiredDocs/requiredDocCadences not passed to firm-side chat — document checklist never showed | `/api/chat/context` must return requiredDocs and requiredDocCadences from company record. CompanyChat in PersistentChatPanel must pass both to ChatInterface. Operator page (page.tsx) already did this correctly.

---

## Submission Card States

[2026-04-08] | Cancel button removed pending card entirely — no visual record it existed | Cancel swaps pendingPayload → canceledPayload (not filter/delete). ChatMessage interface has canceledPayload field. ConfirmationSummary has isCanceled prop → gray "Canceled" badge (XCircle icon), read-only, no buttons.

[2026-04-08] | "Missing KPIs" amber box was redundant — KPI table already shows what's missing | Removed missingKpis calculation and amber box from ConfirmationSummary entirely. Document badge row is the only supplementary section below KPIs.

---

## Re-show Submitted Card

[2026-04-08] | Claude said it couldn't re-show a submitted card — suggested resubmitting | Added show_last_card tool (handler.ts). System prompt instructs Claude to call it when asked to re-show/redisplay. Client finds last submittedPayload message and appends a read-only copy at current conversation position. Does NOT create a new draft — re-shows the submitted card with green badge.

[2026-04-08] | First attempt used submit_structured_data to re-show — created a new draft instead of showing the submitted card | show_last_card is a SEPARATE tool from submit_structured_data. Never use submit_structured_data to re-show — that creates a new draft. show_last_card re-displays the existing submitted card read-only.
