# PRD: Conversational Chat Submission Interface for PortCo Pulse

**Version**: 1.0
**Status**: Ready for Implementation
**Target**: Claude Code
**Stack**: Next.js 16 App Router · TypeScript · SQLite / Drizzle ORM · NextAuth v5 · Tailwind CSS v4 · shadcn/ui · pnpm

---

## 1. Feature Overview

PortCo Pulse is replacing its two structured form pages — the periodic KPI submission form (`/submit/[token]`) and the annual plan submission form (`/plan/[token]`) — with a conversational chat interface powered by the Claude API. Operators at portfolio companies can upload financial documents (PDFs, Excel files, CSVs, Word docs, scanned images) and/or type KPI data in free-form text; the assistant extracts structured KPI data, resolves ambiguities through targeted follow-up questions, and presents a confirmation summary before submitting a validated JSON payload to a firm-side review queue. The change reduces operator friction (no more wrestling with field-by-field forms), improves data completeness (Claude can extract from any document format), and adds a human review step before data enters the database — protecting data integrity and giving GPs visibility into how data arrived.

---

## 2. Scope

### In Scope

- Replace `/submit/[token]` page with a chat interface for periodic submissions (monthly KPI actuals + financial documents).
- Replace `/plan/[token]` page with a chat interface for annual plan submissions (monthly KPI targets).
- Server-side document pre-processing pipeline for PDF, Excel/CSV, Word, and scanned image uploads before passing to Claude.
- Multi-turn streaming chat using the Claude API with stateful conversation management.
- Extraction of all 12 KPIs (Finance + Operations) from unstructured inputs; unit normalization; operator notes.
- Confirmation step: operator reviews extracted data before submission.
- Pending review queue: extracted JSON is stored as a pending submission awaiting firm-user approval.
- Firm-side review UI: a "Pending Review" status and review modal within the existing Submission Tracking page.
- New Drizzle schema tables for pending submissions and chat message history.
- Audit trail distinguishing chat-submitted data from form-submitted data.
- "Pending Review" added as a fourth status alongside Not Submitted / Partial / Complete in Submission Tracking — including filter support and badge counts.

### Out of Scope

- Auto-committing extracted data to the database without firm-user approval.
- Real-time collaboration (multiple operators submitting simultaneously to the same token).
- Voice input.
- Extraction from video or audio files.
- Changes to the existing form-based submission paths (they are replaced, not modified alongside chat).
- Firm-user ability to edit extracted values in bulk outside of the review modal (inline editing in the review modal is in scope).
- Automated email notifications when a pending submission arrives (can be added later using existing Resend integration).

---

## 3. Architecture

### 3.1 Route Structure

The chat interface lives at the same token-based URLs. Both existing page files are replaced — no new URL slugs are introduced.

```
app/
  submit/
    [token]/
      page.tsx              ← replaced: was form, now renders ChatSubmissionPage
      _components/
        ChatInterface.tsx   ← new: the chat UI component
        FileUploadZone.tsx  ← new: drag-and-drop file upload within chat
        ConfirmationSummary.tsx ← new: structured pre-confirmation display
  plan/
    [token]/
      page.tsx              ← replaced: was form, now renders ChatPlanPage
      _components/          ← shared with submit/ or colocated copies
  api/
    chat/
      submit/
        route.ts            ← new: streaming chat endpoint for periodic submissions
      plan/
        route.ts            ← new: streaming chat endpoint for plan submissions
    upload/
      route.ts              ← new: document pre-processing endpoint
    review/
      [submissionId]/
        route.ts            ← new: approve / reject / edit pending submission
```

Both `ChatSubmissionPage` and `ChatPlanPage` are thin wrappers that pass `submissionType` and `token` as props to a shared `<ChatInterface>` component. All token validation logic (existing) is called at the top of each page server component before rendering.

### 3.2 Replacing the Existing Routes

Each existing `page.tsx` is refactored as follows:

1. Keep all existing token validation logic (lookup company by token, validate expiry, reject invalid tokens with existing error states).
2. Remove the form JSX entirely.
3. Render `<ChatInterface submissionType="periodic" | "plan" token={token} company={company} />`.
4. The page remains fully unauthenticated (token-based access only) — no NextAuth session required.

### 3.3 Claude API Call Structure

**Streaming**: All Claude API calls use streaming responses (`stream: true`) via the Anthropic SDK's `anthropic.messages.stream()`. The server-side route handler uses a `ReadableStream` to pipe the streamed response to the client. The client uses the Vercel AI SDK's `useChat` hook (or a lightweight equivalent) to consume the stream and render tokens as they arrive.

**Non-streaming calls**: The document pre-processing step (extracting text from uploaded files server-side) is a non-streaming synchronous call that happens before the main chat turn begins.

**Tool use**: Claude is given one tool — `submit_structured_data` — that it calls when it is ready to present the final JSON payload for confirmation. This signals to the frontend to render the `<ConfirmationSummary>` component with the structured data. The tool call does not write to the database; it is the mechanism by which structured data is passed from the Claude response to the React UI layer.

```typescript
// Tool definition passed to Claude
const tools = [
  {
    name: "submit_structured_data",
    description: "Call this when you have extracted all available KPI data and the operator has confirmed the summary. Pass the complete validated JSON object.",
    input_schema: {
      type: "object",
      properties: {
        payload: {
          type: "object",
          description: "The complete periodic or plan submission JSON matching the defined schema."
        }
      },
      required: ["payload"]
    }
  }
];
```

When Claude calls `submit_structured_data`, the frontend intercepts the tool call, renders `<ConfirmationSummary>`, and presents "Confirm & Submit" / "Make Changes" buttons. Only when the operator clicks "Confirm & Submit" does the browser send a `POST /api/review/[submissionId]` request with `action: "operator_confirmed"`, writing the pending record to SQLite.

### 3.4 System Prompt Design

The system prompt is assembled server-side before each API call and injects company-specific context. See Section 6 for the full draft system prompt.

### 3.5 Document Upload Handling

Documents are uploaded to `POST /api/upload` before or during the chat. The upload endpoint:
1. Receives the file via `multipart/form-data`.
2. Runs format-specific extraction (see Section 7 — Document Processing Pipeline).
3. Returns a structured extraction result: `{ fileName, mimeType, extractedText, extractionMethod, pageCount? }`.
4. The extracted text is stored temporarily in the chat's server-side conversation state and injected into the next Claude message as a `user`-role content block with source attribution.

Files are not stored permanently — they exist only in memory during the extraction step and as plain text in the conversation history. This avoids blob storage infrastructure.

### 3.6 Conversation State Management

Conversation history is stored in a new `chat_messages` table in SQLite (see Section 4). Each chat session is keyed by `company_token + submission_type + period` (for periodic) or `company_token + submission_type + fiscal_year` (for plan). This allows a session to survive page reloads and partial completions.

On page load, the server fetches any existing messages for the session and hydrates the chat UI. The Claude API always receives the full conversation history for the current session (since context windows are large enough for typical submission conversations).

### 3.7 Pending Review Storage and the Review Queue

When an operator confirms their submission, a record is written to the `pending_submissions` table. This record:
- Holds the full extracted JSON payload.
- Is tagged as `status: "pending_review"`.
- Is surfaced in the Submission Tracking page under a new "Pending Review" status alongside the existing Not Submitted / Partial / Complete statuses.

Firm users see pending submissions in a "Pending Review" badge/filter in Submission Tracking. Clicking a pending record opens a review modal where they can approve (which writes the data to the existing `submissions` / `kpi_values` tables using existing insertion logic), reject (which marks the pending record as rejected and notifies no one by default), or edit individual KPI values before approving.

---

## 4. Data Model Changes

All schema changes are made via Drizzle schema files and applied with `pnpm drizzle-kit generate` then `pnpm drizzle-kit migrate`. No manual database edits.

### 4.1 New Table: `pending_submissions`

Stores the extracted JSON payload awaiting firm-user review.

```typescript
// schema/pending-submissions.ts
export const pendingSubmissions = sqliteTable("pending_submissions", {
  id:                  text("id").primaryKey(),                 // UUID
  companyId:           text("company_id").notNull(),            // FK → companies.id
  token:               text("token").notNull(),                 // the submission token used
  submissionType:      text("submission_type").notNull(),       // "periodic" | "plan"
  period:              text("period"),                          // "YYYY-MM" for periodic, null for plan
  fiscalYear:          integer("fiscal_year"),                  // e.g. 2026 for plan, null for periodic
  extractedPayload:    text("extracted_payload").notNull(),     // JSON string — the full validated JSON
  missingKpis:         text("missing_kpis"),                   // JSON array of missing KPI keys
  extractionSource:    text("extraction_source").notNull(),     // "chat" — audit trail (vs. legacy "form")
  operatorConfirmed:   integer("operator_confirmed", { mode: "boolean" }).notNull().default(false),
  status:              text("status").notNull().default("pending_review"), // "pending_review" | "approved" | "rejected"
  reviewedBy:          text("reviewed_by"),                    // firm user id who reviewed, null until reviewed
  reviewedAt:          integer("reviewed_at", { mode: "timestamp" }),
  reviewNotes:         text("review_notes"),                   // optional rejection reason or note
  submittedAt:         integer("submitted_at", { mode: "timestamp" }).notNull(),
  createdAt:           integer("created_at", { mode: "timestamp" }).notNull(),
});
```

### 4.2 New Table: `chat_messages`

Stores conversation history per chat session for continuity across page reloads.

```typescript
// schema/chat-messages.ts
export const chatMessages = sqliteTable("chat_messages", {
  id:              text("id").primaryKey(),                 // UUID
  sessionKey:      text("session_key").notNull(),           // token + type + period/year
  companyId:       text("company_id").notNull(),
  role:            text("role").notNull(),                  // "user" | "assistant" | "tool"
  content:         text("content").notNull(),               // message text or JSON for tool calls
  contentType:     text("content_type").notNull().default("text"), // "text" | "tool_call" | "tool_result"
  createdAt:       integer("created_at", { mode: "timestamp" }).notNull(),
});

// Index for fast session lookup
export const chatMessagesBySession = index("chat_messages_session_key_idx")
  .on(chatMessages.sessionKey);
```

### 4.3 Changes to Existing Tables

**`submissions` table** — add one column to support audit trail:

```typescript
extractionSource: text("extraction_source").default("form"), // "form" | "chat"
```

This column is set to `"chat"` when a firm user approves a `pending_submission` that originated from the chat interface. Existing form submissions remain `"form"`.

**No other existing tables are modified.**

### 4.4 Submission Status Extension

The existing `submissions` status logic (Not Submitted / Partial / Complete) is extended. "Pending Review" is not stored on the `submissions` table — it is a virtual status derived from the presence of a `pending_submissions` record with `status = "pending_review"` for the same company + period. The Submission Tracking query is updated to LEFT JOIN `pending_submissions` and emit "Pending Review" when such a record exists and no `submissions` record has been approved for the same period.

---

## 5. UI/UX Specifications

### 5.1 Operator-Side: Chat Interface

**Entry State**

When an operator navigates to `/submit/[token]` or `/plan/[token]`:
- The page shows the company name and the submission period/type in a small header.
- Below is a chat window with a single assistant message: a warm opening prompt that tells the operator what to do (see Section 6 for the draft opening message).
- A text input at the bottom and a file upload button (paperclip icon).
- No form fields. No submission button at entry — the submission is triggered through the conversation.

**File Upload UX**

- Clicking the paperclip icon or dragging a file into the chat window triggers upload.
- Supported types: PDF, Excel (`.xlsx`, `.xls`), CSV, Word (`.docx`, `.doc`), images (`.png`, `.jpg`, `.jpeg`, `.tiff`).
- Max file size: 20 MB per file. Up to 5 files per submission session.
- On upload, a file attachment chip appears in the chat input area (like email attachments).
- When sent, the chip renders as a message bubble with a file icon, file name, and a small "Extracting..." spinner.
- Once extraction completes (typically < 5 seconds server-side), Claude's streaming response begins.
- If extraction fails, the chat shows an inline error: "I had trouble reading [filename]. Could you try re-uploading or paste the data directly?"

**Clarification Flow**

- Claude asks one or two targeted questions at a time — not a laundry list. (The system prompt enforces this.)
- Questions appear as assistant messages. The operator replies in the text input.
- If the operator is stuck, they can type "skip" or "I don't have that" and Claude handles gracefully.

**Confirmation Step**

- When Claude has enough data (or the operator has indicated they're done providing information), Claude calls the `submit_structured_data` tool.
- The frontend intercepts the tool call and renders `<ConfirmationSummary>` — a structured card showing all extracted KPI values in a clean two-column table (Finance / Operations), a list of uploaded documents, and missing KPIs flagged in amber.
- Two buttons: **"Confirm & Submit for Review"** (primary) and **"Make Changes"** (secondary, resumes the chat).
- Clicking "Confirm & Submit for Review" sends the confirmation to the server, writes the `pending_submissions` record, and shows the success state.

**Success State**

- The chat input is disabled.
- A green confirmation banner: "Submitted for review. Your data has been sent to [Firm Name] for review. You'll hear from them if anything needs clarification."
- The submission token is now marked as "used" (pending review) — re-navigating to the same URL shows: "This submission is currently under review. No further action needed."

**Edge Cases**

- If the operator closes the browser mid-conversation, the session is restored from `chat_messages` on the next visit to the same URL.
- If a pending submission already exists for this token+period, the page shows the confirmation banner immediately without re-opening the chat.
- If no company is found for the token or the token is expired, show the existing error page (no change).

### 5.2 Firm-Side: Review Queue in Submission Tracking

**Pending Review Status**

- A new status chip "Pending Review" is added alongside Not Submitted / Partial / Complete.
- Color: amber/yellow (distinct from the existing green for Complete, orange for Partial, gray for Not Submitted).
- The existing Status filter dropdown in Submission Tracking includes "Pending Review" as an option.
- The header of the Submission Tracking page shows a badge count of pending reviews (e.g., "3 Pending").

**Review Modal**

Clicking a row with "Pending Review" status opens a modal (shadcn `<Dialog>`):

- **Header**: Company name, period, submitted timestamp, extraction source ("Chat").
- **Extracted values panel** (left): All 12 KPIs displayed in a table with extracted value and any operator note. Missing KPIs flagged with "—" and an amber indicator.
- **Plan comparison panel** (right, periodic only): The approved plan values for the same period, with a variance column (actual vs. plan). Variance coloring respects the existing RAG direction logic (lower-is-better KPIs like churn and CAC are colored inversely).
- **Document list**: Uploaded documents listed with extraction status.
- **Operator notes**: Any per-KPI notes the operator provided, shown inline.
- **Edit controls**: Each KPI value in the extracted values panel is an editable inline field. The firm user can correct any value before approving.
- **Action buttons**:
  - **Approve** — writes approved (possibly edited) values to the `submissions` / `kpi_values` tables using existing insertion logic. Sets `pending_submissions.status = "approved"`, `reviewedBy`, `reviewedAt`. Updates Submission Tracking status to Partial or Complete depending on documents.
  - **Reject** — opens a small text field for a rejection reason. Sets `pending_submissions.status = "rejected"`. The operator's token URL will show: "Your submission was not accepted. Please contact [firm] for details."
  - **Close** — dismisses without action.

---

## 6. Claude API Integration

### 6.1 Model

Use `claude-sonnet-4-5` (or the latest Sonnet-class model available at implementation time). Sonnet provides the right balance of extraction quality, speed, and cost for this use case. Do not use Haiku (insufficient for messy document extraction) or Opus (unnecessarily expensive for a submission flow).

### 6.2 System Prompt Structure

The system prompt has three sections:
1. **Role and context** — who Claude is and what it's doing.
2. **Company context** — injected per-request: company name, KPI configuration, current period, prior submission values.
3. **Behavior rules** — extraction logic, KPI mapping, normalization, conversation style (mirrors the skill SKILL.md).

**Draft System Prompt**:

```
You are the submission assistant for PortCo Pulse, a portfolio monitoring platform used by
{{firm_name}}. You are helping an operator at {{company_name}} submit their
{{submission_type_label}} for {{period_label}}.

COMPANY CONTEXT
- Company: {{company_name}}
- Submission type: {{submission_type}} (periodic | plan)
- Reporting period: {{period_label}}
- KPIs configured for this company: {{enabled_kpi_list}}
  (Note: if a KPI is not in this list, do not ask for or extract it)
- Prior period actuals (for reference): {{prior_period_json}}

WHAT YOU ARE DOING
Your job is to extract structured KPI data from whatever the operator provides — uploaded
documents, free-form text, or both — and produce a validated JSON object. You do not write
to any database. When you have finished extracting and the operator has confirmed, call the
submit_structured_data tool with the final JSON.

EXTRACTION RULES
[Include the full KPI mapping table, unit normalization rules, and document extraction
instructions from the skill SKILL.md. These are injected here verbatim or by reference.]

CONVERSATION STYLE
- Be direct and efficient. Operators are busy finance professionals.
- Acknowledge uploads immediately: "Got the income statement — extracting values now."
- Ask one or two targeted follow-up questions at a time, never a long list.
- If the operator says they don't have a value, accept it gracefully and move on.
- Present the confirmation summary in a clean, scannable format before calling the tool.
- After confirmation, call submit_structured_data immediately. Do not add more questions.

OPENING MESSAGE
Greet the operator briefly, tell them what submission this is for, and invite them to upload
documents or type data in any format. Example:
"Hi! I'm here to help you submit {{company_name}}'s {{period_label}} data. You can upload
your financial statements (income statement, balance sheet, cash flow) or just type your
numbers — whatever's easiest. What do you have for me?"
```

**Injection values** (assembled server-side in the route handler):

| Placeholder | Source |
|---|---|
| `{{firm_name}}` | `companies.firm_name` (via token lookup) |
| `{{company_name}}` | `companies.name` |
| `{{submission_type}}` | Determined from URL (`/submit/` vs. `/plan/`) |
| `{{submission_type_label}}` | "monthly KPI submission" or "FY2026 annual plan" |
| `{{period_label}}` | e.g. "March 2025" or "FY 2026" |
| `{{enabled_kpi_list}}` | Per-company KPI overrides (cascade from firm-wide defaults) |
| `{{prior_period_json}}` | Last approved submission for this company, JSON-serialized |

### 6.3 Conversation State Management Across Turns

- On each `POST /api/chat/submit` or `/api/chat/plan`, the handler loads the full `chat_messages` history for the session from SQLite.
- It appends the new user message (and any document extraction results as additional user content blocks).
- It sends the full history to Claude with the system prompt.
- Claude's response is streamed back to the client.
- The assistant message (including any tool calls) is persisted to `chat_messages` before the stream closes.
- If Claude calls `submit_structured_data`, the tool call payload is also persisted as a `tool` role message.

The session key is: `sha256(token + submission_type + period_or_year)` — deterministic, no state needed client-side.

### 6.4 Token Budget

Typical submission conversation: ~3,000–8,000 input tokens (including history and extracted document text) and ~500–1,500 output tokens. Set `max_tokens: 4096` on each call. No need for extended thinking for this use case.

---

## 7. Document Processing Pipeline

All document processing happens **server-side** in `POST /api/upload` before Claude sees any content. No new infrastructure — use npm packages compatible with the existing stack.

### 7.1 PDF

**Library**: `pdf-parse` (already likely present, or `pdfjs-dist` for more robust extraction).

**Process**:
1. Parse PDF to extract raw text, preserving page breaks and rough layout.
2. Attempt to identify document type from text: look for keywords like "Income Statement", "Balance Sheet", "Cash Flow", "Investor Update" in the first 200 characters of each page.
3. Pass extracted text to Claude with a preamble: `"[Extracted from PDF: {fileName}, {pageCount} pages, detected type: {detectedType}]\n\n{text}"`.

**Scanned PDFs** (no selectable text): Use `tesseract.js` (runs in Node, no external service needed) to perform OCR on each page image before text extraction. Flag as `extractionMethod: "ocr"` in the result.

### 7.2 Excel / XLSX

**Library**: `xlsx` (SheetJS — the npm package, already a common dependency).

**Process**:
1. Parse all sheets. For each sheet, convert to CSV-like text using `XLSX.utils.sheet_to_csv()`.
2. Include sheet name as a section header: `"=== Sheet: {sheetName} ===\n{csvContent}"`.
3. Preserve dollar signs and number formatting by using `rawDenumbers: false` in SheetJS options so formatted values (e.g., "$1,234,000") pass through.
4. If a sheet is empty (< 3 non-empty cells), skip it.

### 7.3 CSV

**Library**: Node built-in `fs` + `csv-parse` (or simple string splitting for small files).

**Process**:
1. Read raw file as UTF-8 string.
2. Pass directly to Claude as text with preamble: `"[Extracted from CSV: {fileName}]\n\n{rawCsvContent}"`.
3. No pre-processing — Claude handles irregular CSV structure well from raw text.

### 7.4 Word / DOCX

**Library**: `mammoth` (converts DOCX to plain text or Markdown).

**Process**:
1. Use `mammoth.extractRawText({ buffer })` to get plain text.
2. Alternatively, use `mammoth.convertToMarkdown({ buffer })` to preserve table structure — prefer this as it retains table formatting that Claude can parse.
3. Pass with preamble: `"[Extracted from Word document: {fileName}]\n\n{markdownContent}"`.

### 7.5 Images (JPEG, PNG, TIFF)

**Approach**: Pass the image directly to Claude as a vision input (base64-encoded image in the `image` content block type). Claude's vision capability handles typed tables, scanned forms, and handwritten figures without requiring server-side OCR.

**Process**:
1. Read image as Buffer.
2. Convert to base64.
3. Include as an `image` content block in the user message: `{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64String } }`.
4. Prepend a text block: `"This is an uploaded document image from {fileName}. Please extract all KPI data visible in this image."`.

**Size limit**: Resize images larger than 1568px on the longest edge before encoding (use `sharp` — already a common Next.js dependency for image optimization). This keeps tokens within Claude's image limits.

### 7.6 Unsupported File Types

Return a `400` with `{ error: "unsupported_file_type", message: "Please upload a PDF, Excel, CSV, Word, or image file." }`. The chat UI shows this as an inline error.

---

## 8. Acceptance Criteria

### Chat Interface — Operator Side

- [ ] Navigating to `/submit/[token]` with a valid token shows the chat interface (not a form). The existing token validation error states are preserved for invalid/expired tokens.
- [ ] Navigating to `/plan/[token]` with a valid token shows the chat interface for plan submissions.
- [ ] An operator can type free-form KPI data and receive a structured extraction response from Claude.
- [ ] An operator can upload a PDF, Excel, CSV, Word, or image file; the chat acknowledges the upload and Claude extracts data from it.
- [ ] Uploading an unsupported file type shows an inline error and does not break the chat session.
- [ ] The chat session survives a page reload (history is restored from `chat_messages`).
- [ ] Claude asks targeted follow-up questions for missing KPIs and accepts "I don't have that" gracefully.
- [ ] The confirmation summary renders as a structured `<ConfirmationSummary>` component (not inline text) when Claude calls `submit_structured_data`.
- [ ] Clicking "Confirm & Submit for Review" writes a `pending_submissions` record to SQLite and shows the success state.
- [ ] Clicking "Make Changes" dismisses the confirmation and resumes the chat.
- [ ] Re-navigating to the same URL after submission shows the "under review" state, not a fresh chat.

### Review Queue — Firm Side

- [ ] The Submission Tracking page shows "Pending Review" as a status, with an amber chip.
- [ ] The status filter includes "Pending Review" and correctly filters the table.
- [ ] A badge in the Submission Tracking header shows the count of pending reviews for the current filters.
- [ ] Clicking a row with "Pending Review" opens the review modal.
- [ ] The review modal shows all 12 KPI values (or null for missing), operator notes, and uploaded document list.
- [ ] For periodic submissions, the modal shows the plan comparison column with variance and correct RAG coloring (respecting lower-is-better direction per KPI).
- [ ] Each KPI value in the modal is editable inline.
- [ ] Clicking "Approve" writes data to the existing `submissions` / `kpi_values` tables, sets `pending_submissions.status = "approved"`, and updates Submission Tracking status to Partial or Complete.
- [ ] Clicking "Reject" prompts for a reason, sets `pending_submissions.status = "rejected"`, and returns the operator-facing URL to a "not accepted" state.
- [ ] The existing Fund, Industry, and Status filters continue to work correctly after these changes. Filter state persists across page navigation.
- [ ] Per-company KPI overrides still cascade correctly — the review modal only shows KPIs enabled for the company.

### Data Integrity

- [ ] No KPI data is written to `submissions` or `kpi_values` without a firm user clicking "Approve".
- [ ] `extraction_source = "chat"` is set on all submissions that flow through the new chat path.
- [ ] Existing form-submitted data (if any) retains `extraction_source = "form"`.
- [ ] The schema migration runs cleanly via `pnpm drizzle-kit generate && pnpm drizzle-kit migrate` with no errors.

### Document Processing

- [ ] PDF text extraction works for standard PDFs (income statements, balance sheets).
- [ ] Scanned PDF extraction (OCR via tesseract.js) works for a simple table image.
- [ ] Excel/XLSX extraction preserves formatted number values (with dollar signs and commas).
- [ ] DOCX extraction preserves table structure as Markdown.
- [ ] Image upload sends the image directly to Claude as a vision input.

---

## 9. Implementation Sequence

Follow this order. Each step depends on the ones before it.

### Step 1 — Schema Migration (foundation for everything else)

1. Add `pending_submissions` table to the Drizzle schema.
2. Add `chat_messages` table to the Drizzle schema.
3. Add `extraction_source` column to the existing `submissions` table.
4. Run `pnpm drizzle-kit generate` and `pnpm drizzle-kit migrate`.
5. Verify migration ran cleanly with `pnpm drizzle-kit studio` or a quick query.

**Dependencies**: None. Start here.

---

### Step 2 — Document Upload Endpoint

1. Create `app/api/upload/route.ts`.
2. Install required packages: `pnpm add pdf-parse tesseract.js xlsx mammoth sharp csv-parse`.
3. Implement per-format extraction logic (see Section 7). Return `{ fileName, mimeType, extractedText, extractionMethod }`.
4. Add file type validation and size validation (20 MB limit).
5. Write a quick test: upload a sample PDF and verify extracted text is returned.

**Dependencies**: Step 1 (needs to know the schema exists, but doesn't write to DB directly).

---

### Step 3 — Chat API Route (Core Claude Integration)

1. Create `app/api/chat/submit/route.ts` and `app/api/chat/plan/route.ts`.
2. Install Anthropic SDK if not present: `pnpm add @anthropic-ai/sdk`.
3. Implement session key derivation (`sha256(token + type + period)`).
4. Implement history load from `chat_messages`.
5. Implement system prompt assembly with company context injection.
6. Implement Claude API call with streaming and the `submit_structured_data` tool definition.
7. Implement response streaming to the client.
8. Implement persistence of assistant message and tool calls to `chat_messages` after stream completes.
9. Handle the `submit_structured_data` tool call: do NOT write to DB here — return the tool call payload to the client in the stream with a special event type `data: [TOOL_CALL] {...}`.

**Dependencies**: Step 1 (chat_messages table), Step 2 (upload route must exist for integration).

---

### Step 4 — Chat UI Components

1. Create `app/submit/[token]/_components/ChatInterface.tsx`.
   - Uses `useChat`-style hook (or implement a lightweight equivalent using `fetch` + `ReadableStream`).
   - Renders message history.
   - Handles the `[TOOL_CALL]` stream event: when received, render `<ConfirmationSummary>` and hide the chat input.
2. Create `FileUploadZone.tsx` — drag-and-drop + click-to-upload, calls `POST /api/upload`, appends extracted text to the next user message.
3. Create `ConfirmationSummary.tsx` — structured display of extracted KPIs, documents, and missing fields. "Confirm" and "Make Changes" buttons.
4. Update `app/submit/[token]/page.tsx` to render `<ChatInterface>` instead of the existing form.
5. Update `app/plan/[token]/page.tsx` similarly.
6. Add the "under review" state to both pages (check for existing `pending_submission` with `status = "pending_review"` on page load and render the static state if found).

**Dependencies**: Steps 2 and 3 must exist for the UI to call.

---

### Step 5 — Confirmation & Pending Submission Write

1. Create `app/api/review/[submissionId]/route.ts`.
2. Implement `POST` handler for `action: "operator_confirmed"`: validate token ownership, write `pending_submissions` record from the tool call payload.
3. Implement `POST` handler for `action: "approve"`: validate firm user session (NextAuth), write to `submissions` / `kpi_values` using existing insertion logic, set `extraction_source = "chat"`, update `pending_submissions.status = "approved"`.
4. Implement `POST` handler for `action: "reject"`: validate firm user session, set `pending_submissions.status = "rejected"`, save rejection reason.

**Dependencies**: Steps 1, 3, and 4.

---

### Step 6 — Submission Tracking Updates (Firm Side)

1. Update the Submission Tracking query to LEFT JOIN `pending_submissions` and compute the virtual "Pending Review" status.
2. Add "Pending Review" to the status chip renderer (amber color).
3. Add "Pending Review" to the Status filter dropdown.
4. Add the pending review badge count to the Submission Tracking page header.
5. Implement the review modal (`<ReviewModal>`) with the extracted values panel, plan comparison panel, inline editing, and Approve/Reject controls.
6. Wire Approve/Reject buttons to `POST /api/review/[submissionId]`.
7. Verify existing Fund, Industry, and Status filters still work. Verify filter state persists.
8. Verify RAG variance coloring respects lower-is-better direction for churn, CAC, inventory days, and employee turnover rate.

**Dependencies**: Step 5 (approve/reject endpoints must exist).

---

### Step 7 — Integration Testing & Acceptance Criteria Verification

1. Run through all acceptance criteria in Section 8 manually against a local dev environment.
2. Test the full end-to-end flow: operator chat → document upload → extraction → confirmation → pending → firm review → approve → Submission Tracking status updates to Complete.
3. Test the rejection flow.
4. Test session restoration (reload mid-conversation).
5. Test with each document type (PDF, XLSX, CSV, DOCX, image).
6. Verify no existing filter state is broken.
7. Verify schema migration is idempotent (run `drizzle-kit migrate` twice — second run should be a no-op).

**Dependencies**: All previous steps.

---

## Appendix A — KPI Direction Reference (for RAG Coloring)

The review modal's variance column must respect the existing directional logic:

| KPI | Direction | Better when... |
|---|---|---|
| revenue | higher | actual > plan |
| gross_margin | higher | actual > plan |
| ebitda | higher | actual > plan |
| cash_balance | higher | actual > plan |
| capex | lower | actual < plan |
| operating_cash_flow | higher | actual > plan |
| customer_acquisition_cost | lower | actual < plan |
| headcount | neutral | no RAG coloring |
| churn_rate | lower | actual < plan |
| inventory_days | lower | actual < plan |
| nps_score | higher | actual > plan |
| employee_turnover_rate | lower | actual < plan |

---

## Appendix B — Environment Variables Required

```bash
ANTHROPIC_API_KEY=sk-ant-...        # Claude API key
# All existing env vars unchanged
```

No other new infrastructure or environment variables are required.
