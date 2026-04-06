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
