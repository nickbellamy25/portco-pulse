# Plan — PortCo Pulse

## Goal
Build a production-ready PE portfolio monitoring platform that a real PE firm could use day-one: collect KPI data + documents from portcos, track submission status, monitor performance against plan, receive alerts, and view portfolio analytics — all with a clean operator UX.

---

## Phase 1 — Core Platform ✅ COMPLETE

- [x] Auth + sessions (login, invite, JWT, firm/company scoping)
- [x] Portfolio Dashboard (stats, charts, alerts, plan attainment)
- [x] Submission Tracking (status matrix, reminders)
- [x] Company Analytics (Overview + Detail tabs, all view modes, plan review)
- [x] KPI system (firm-wide + per-company overrides, RAG, thresholds, alerts)
- [x] Plan submission flow (`/plan/[token]`, versioning, investor comments)
- [x] Company Settings (all 6 tabs)
- [x] Firm Settings (General + Notifications + KPIs)
- [x] Email system (7 event types, cron routes)
- [x] Seed data (8 PE companies + independent operator, 3+ years history)

---

## Phase 2 — Chat Submission System ✅ COMPLETE

- [x] Conversational AI submission interface (Claude claude-sonnet-4-6)
- [x] Periodic submission via chat (`/api/chat/submit`)
- [x] Historical onboarding via chat (`/api/chat/onboard`)
- [x] Plan submission via chat (`/api/chat/plan`)
- [x] Portfolio Q&A for investors (`/api/chat/qa`)
- [x] File upload in chat (CSVs, financial docs)
- [x] Confirmation summary cards (editable before commit)
- [x] Quick reply suggestions (Claude tool)
- [x] Persistent chat history per company/period
- [x] Context endpoint for firm-side chat hydration

---

## Phase 3 — Polish & Completeness (CURRENT)

- [ ] **Wire company-specific KPIs into chat submission** — custom KPIs added in Company Settings should appear in the operator's chat submission flow
- [ ] **Submission Tracking UX review** — detailed review pass; fix any rough edges in the status matrix
- [ ] **Fix variance coloring for lower-is-better KPIs** — positive variance should be red for CapEx, Churn Rate, etc. (currently always green)
- [ ] **Blocklist mode for member access scopes** — currently only allowlist (include specific companies); need blocklist (exclude specific companies)
- [ ] **Chat submission** — handle edge case: operator uploads combined financials that covers multiple statement types (logic partially exists via `combined_financials` doc type)
- [x] **Chat pane polish** — chips at bottom on all pages, remove company badge from header, collapse on navigation, assistant bubble full-width, tab color consistency, system prompt sort/conclusion fixes, dynamic reminder chip on Submission Tracking (live outstanding companies, confirmation flow, wired into sendRemindersAction)
- [x] **Chat submission card fixes** — card persists after submit, company name header, compact sizing, documents/missing banners on submitted cards, prompt chips reappear after submission, drag highlight fix
- [x] **Document badge row on submission cards** — always shows BS/IS/CF/IU, interactive toggle, linked to financial_documents DB, matches Submission Tracking style
- [x] **Re-show submitted card** — show_last_card tool, system prompt instruction, client handler
- [x] **Canceled card state** — canceledPayload, gray badge, read-only
- [x] **Chat panel navigation** — messages clear on page change, company chat remounts on company switch, standard UX
- [x] **Submission tracking date filter** — companies only shown from investment date onwards
- [x] **Company onboarding flow** — new companies get pending status + in-app notification on creation
- [x] **Document detection in chat** — record_document tool populates detectedDocs, persisted on message object
- [ ] **Verify document badge detection** — confirm badges show correct colors after page refresh for companies with recorded documents (Brighton test case)

---

## Phase 4 — Deployment

- [ ] Choose Linux hosting (Fly.io / Railway / VPS)
- [ ] Set up persistent volume for DB + uploads
- [ ] Configure env vars (see `CLAUDE.md` deployment checklist)
- [ ] Set up Resend with verified sender domain
- [ ] Set up cron job trigger for reminders + digest endpoints
- [ ] Final smoke test with real data

---

## Backlog (lower priority)

- Portfolio-level export (all companies, all periods) to Excel/CSV
- Multi-fund support (some firms manage multiple distinct funds with separate portcos)
- Operator dashboard improvements (operators currently have limited view)
- Mobile-responsive submission form (chat UI is partially responsive)
- `middleware.ts` → `proxy.ts` rename (deprecated convention in Next.js 16, works fine as-is)
