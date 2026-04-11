/**
 * Shared handler for /api/chat/submit (periodic) and /api/chat/onboard (onboarding).
 * Returns a streaming SSE response.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { deriveSessionKey, derivePulseSessionKey, loadHistory, saveMessage, buildAnthropicMessages, AnthropicContentBlock } from "./session";
import { buildSystemPromptContext, assembleSystemPrompt, assembleOnboardingSystemPrompt, buildPortfolioDataSection, assemblePortfolioQASystemPrompt } from "./system-prompt";
import { writePeriodicSubmission } from "@/lib/server/submissions";
import { auth } from "@/lib/auth";
import type { UploadResult } from "@/app/api/upload/route";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tool definitions ─────────────────────────────────────────────────────────

const SUBMIT_STRUCTURED_DATA_TOOL: Anthropic.Tool = {
  name: "submit_structured_data",
  description:
    "Call this IMMEDIATELY after extracting KPI values from user input. NEVER present a markdown table instead — this tool IS the response. An editable review card appears automatically for the user to correct values before submitting. Pass the complete extracted JSON object.",
  input_schema: {
    type: "object" as const,
    properties: {
      payload: {
        type: "object" as const,
        description: "The complete periodic or plan submission JSON matching the defined schema.",
      },
    },
    required: ["payload"],
  },
};

const SUBMIT_STRUCTURED_DATA_ONBOARDING_TOOL: Anthropic.Tool = {
  name: "submit_structured_data",
  description:
    "Call this immediately after extracting all KPI values for a specific historical period. Data is absorbed automatically — no operator confirmation required. Call once per period, as soon as you have all available values for that period.",
  input_schema: {
    type: "object" as const,
    properties: {
      payload: {
        type: "object" as const,
        description: "The periodic submission JSON for one historical period.",
      },
    },
    required: ["payload"],
  },
};

const SUGGEST_QUICK_REPLIES_TOOL: Anthropic.Tool = {
  name: "suggest_quick_replies",
  description:
    "Call this alongside any message where you ask the operator a clarifying question with a small set of likely answers. Provide 2–4 short reply options (max ~40 chars each) that cover the most probable responses. The operator can click one instead of typing.",
  input_schema: {
    type: "object" as const,
    properties: {
      replies: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "2–4 short reply options, e.g. ['Yes, correct', 'CapEx is $144,800', 'OCF is $319,600']",
      },
    },
    required: ["replies"],
  },
};

const VOID_SESSION_SUBMISSION_TOOL: Anthropic.Tool = {
  name: "void_session_submission",
  description:
    "Delete a submission that was made earlier in this session because it contained an error or was submitted to the wrong period. Call this when the operator asks to undo, revert, or correct a previous submission from this session. Only call this BEFORE resubmitting the corrected data.",
  input_schema: {
    type: "object" as const,
    properties: {
      period: {
        type: "string" as const,
        description: "YYYY-MM period of the submission to void (periodic submissions only).",
      },
      fiscal_year: {
        type: "integer" as const,
        description: "Fiscal year of the plan to void (plan submissions only).",
      },
      reason: {
        type: "string" as const,
        description: "Brief reason the operator gave for voiding. Omit if no reason was stated.",
      },
    },
  },
};

const RECORD_DOCUMENT_TOOL: Anthropic.Tool = {
  name: "record_document",
  description:
    "Record which financial document type(s) are included in an uploaded file. Call this once per uploaded file after confirming with the operator what the file contains. If uncertain (e.g. could be an investor update but not clearly labeled), ask the operator first. Do NOT call this for images or ad-hoc pastes — only for files with a clear document type.",
  input_schema: {
    type: "object" as const,
    properties: {
      fileName: {
        type: "string" as const,
        description: "Exact file name as uploaded by the operator.",
      },
      documentType: {
        type: "string" as const,
        enum: ["balance_sheet", "income_statement", "cash_flow_statement", "investor_update", "combined_financials"],
        description: "Use combined_financials if the file contains multiple statement types.",
      },
      includedStatements: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "For combined_financials only: list the statement types included.",
      },
    },
    required: ["fileName", "documentType"],
  },
};

const SHOW_LAST_CARD_TOOL: Anthropic.Tool = {
  name: "show_last_card",
  description:
    "Re-display the last submitted confirmation card. Call this when the operator asks to re-show, redisplay, or see the last submission card again. The card is displayed read-only — no resubmission occurs.",
  input_schema: {
    type: "object" as const,
    properties: {},
  },
};

const LOAD_SUBMISSION_FOR_EDIT_TOOL: Anthropic.Tool = {
  name: "load_submission_for_edit",
  description:
    "Load a previously submitted periodic submission for editing. Call this when the user asks to edit, revise, or update a past submission. Returns a pre-populated editable card with the existing KPI values and associated documents. The user can then modify values and re-submit to create a new version.",
  input_schema: {
    type: "object" as const,
    properties: {
      period: {
        type: "string" as const,
        description: "The YYYY-MM period of the submission to edit (e.g. '2026-03').",
      },
      company_name: {
        type: "string" as const,
        description: "Company name (required when no company is currently selected, e.g. in portfolio Q&A mode).",
      },
    },
    required: ["period"],
  },
};

const SAVE_SUBMISSION_NOTE_TOOL: Anthropic.Tool = {
  name: "save_submission_note",
  description:
    "Save a durable preference or convention learned about how this company submits data. Only call for facts that apply to ALL future sessions — not one-time context.",
  input_schema: {
    type: "object" as const,
    properties: {
      note: {
        type: "string" as const,
        description: "Concise, reusable note about this company's submission conventions.",
      },
    },
    required: ["note"],
  },
};

// ─── Doc detection ────────────────────────────────────────────────────────────

const DOC_LABELS: Record<string, string> = {
  balance_sheet:       "Balance Sheet",
  income_statement:    "Income Statement",
  cash_flow_statement: "Cash Flow Statement",
  investor_update:     "Investor Update",
};
const DOC_ORDER = ["balance_sheet", "income_statement", "cash_flow_statement", "investor_update"];

function buildDocDetectionLine(uploads: UploadResult[], requiredDocs: string[]): string | null {
  if (!uploads.length) return null;
  const hasFile = uploads.some((u) => u.extractionMethod !== "vision");
  if (!hasFile) return null;

  const detected = new Set<string>();
  for (const u of uploads) {
    if (u.detectedDocumentType && u.detectedDocumentType !== "financial_document") {
      if (u.detectedDocumentType === "combined_financials") {
        for (const s of (u.detectedIncludedStatements ?? [])) detected.add(s);
      } else {
        detected.add(u.detectedDocumentType);
      }
    }
  }

  const parts = DOC_ORDER.filter((key) => detected.has(key)).map((key) => `${DOC_LABELS[key]} ✓`);
  if (parts.length === 0) return null;
  return "Documents detected: " + parts.join(" · ");
}

// ─── Request / handler ────────────────────────────────────────────────────────

export interface ChatRequestBody {
  token: string;
  message: string;
  uploads?: UploadResult[];
  contextDataType?: "actuals" | "plan" | "both";
  contextPeriods?: string;
}

export interface ChatHandlerOptions {
  mode?: "onboarding";
}

export async function handleChatRequest(req: NextRequest, options?: ChatHandlerOptions) {
  const mode = options?.mode ?? "periodic";

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { token, message, uploads = [], contextDataType, contextPeriods } = body;

  const company = db.select().from(schema.companies).where(eq(schema.companies.submissionToken, token)).get();
  if (!company) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const firm = db.select().from(schema.firms).where(eq(schema.firms.id, company.firmId)).get();
  const firmName = firm?.name ?? "your firm";

  const session = await auth();
  const userId = (session?.user as any)?.id ?? "anonymous";
  const persona = (session?.user as any)?.persona ?? null;
  const includePortfolioData = mode === "periodic" && persona === "investor";

  const ctx = buildSystemPromptContext(company as any, firmName, { includePortfolioData });
  const systemPrompt = mode === "onboarding"
    ? assembleOnboardingSystemPrompt(ctx)
    : assembleSystemPrompt(ctx);

  // Unified session key — all modes (periodic, onboarding, plan) share one thread per company+user
  const sessionKey = deriveSessionKey(token, userId);

  const history = loadHistory(sessionKey);

  // Opening message differs by mode
  const OPENING_QUESTION = mode === "onboarding"
    ? "Hi — we'd like to collect your historical financial data to set up your company profile on the platform. Please share any financial statements, KPI reports, or other documents you have available, going back as far as possible. There's no strict format required — send what you have and we'll extract what we can. You can submit files in multiple batches over time."
    : "Hello — please share the data you'd like to submit. You can paste values, upload a file, or just describe what you have.";

  // Build user content blocks
  const userContentBlocks: AnthropicContentBlock[] = [];

  for (const upload of uploads) {
    if (upload.extractionMethod === "vision" && upload.imageBase64) {
      userContentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: upload.imageMediaType ?? "image/jpeg",
          data: upload.imageBase64,
        },
      });
      userContentBlocks.push({
        type: "text",
        text: `This is an uploaded document image from ${upload.fileName}. Please extract all KPI data visible in this image.`,
      });
    } else if (upload.extractionMethod === "pdf_document" && upload.pdfBase64) {
      userContentBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf" as const,
          data: upload.pdfBase64,
        },
      } as any);
      userContentBlocks.push({
        type: "text",
        text: `This is a PDF document: ${upload.fileName}. Please extract all KPI data, financial figures, and relevant information from it.`,
      });
    } else if (upload.extractedText) {
      userContentBlocks.push({ type: "text", text: upload.extractedText });
    }
  }

  if (message.trim()) {
    userContentBlocks.push({ type: "text", text: message });
  }

  const isGreeting = userContentBlocks.length === 0;
  if (isGreeting) {
    userContentBlocks.push({ type: "text", text: "Hello" });
  }

  // Prepend pre-chat context for periodic mode only
  if (
    mode === "periodic" &&
    !isGreeting &&
    history.length === 0 &&
    (contextDataType || contextPeriods?.trim())
  ) {
    const contextLines = ["[Submitter provided pre-chat context:]"];
    if (contextDataType) contextLines.push(`- Submitting: ${contextDataType}`);
    if (contextPeriods?.trim()) contextLines.push(`- Period(s): ${contextPeriods.trim()}`);
    userContentBlocks.unshift({ type: "text", text: contextLines.join("\n") });
  }

  if (!isGreeting) {
    const userStoredContent = [
      ...uploads.map((u) => `[Attached: ${u.fileName}]`),
      message,
    ].filter(Boolean).join("\n");
    saveMessage(sessionKey, company.id, "user", userStoredContent, "text");
  }

  const docDetectionLine = buildDocDetectionLine(uploads, ctx.requiredDocs);
  const anthropicMessages = buildAnthropicMessages(history, userContentBlocks, OPENING_QUESTION);

  // Tools differ by mode: onboarding has no void tool and uses the auto-absorb submit tool
  const tools: Anthropic.Tool[] = mode === "onboarding"
    ? [SUBMIT_STRUCTURED_DATA_ONBOARDING_TOOL, SUGGEST_QUICK_REPLIES_TOOL, RECORD_DOCUMENT_TOOL, SAVE_SUBMISSION_NOTE_TOOL]
    : [SUBMIT_STRUCTURED_DATA_TOOL, SUGGEST_QUICK_REPLIES_TOOL, SAVE_SUBMISSION_NOTE_TOOL, RECORD_DOCUMENT_TOOL, VOID_SESSION_SUBMISSION_TOOL, SHOW_LAST_CARD_TOOL, LOAD_SUBMISSION_FOR_EDIT_TOOL];

  // Detect submission intent: user is providing KPI data, not asking a question
  // Heuristic: 3+ distinct numbers (dollar amounts, percentages, plain numbers) or file uploads
  const numberMatches = message.match(/\$?\d[\d,.]+%?/g) || [];
  const looksLikeSubmission = uploads.length > 0 || numberMatches.length >= 3;
  const toolChoice: Anthropic.MessageCreateParams["tool_choice"] | undefined =
    mode === "periodic" && looksLikeSubmission && !isGreeting
      ? { type: "tool" as const, name: "submit_structured_data" }
      : undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        if (docDetectionLine) {
          send({ type: "doc_detection", line: docDetectionLine });
        }

        let fullText = "";

        const claudeStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages: anthropicMessages as any,
          tools,
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
        });

        for await (const event of claudeStream) {
          if (event.type === "content_block_delta") {
            const delta = event.delta as any;
            if (delta.type === "text_delta") {
              fullText += delta.text;
              send({ type: "text", content: delta.text });
            }
          }

          if (event.type === "message_stop") {
            const finalMsg = await claudeStream.finalMessage();

            if (fullText) {
              saveMessage(sessionKey, company.id, "assistant", fullText, "text");
            }

            const submitBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "submit_structured_data"
            ) as any;
            const repliesBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "suggest_quick_replies"
            ) as any;
            const noteBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "save_submission_note"
            ) as any;
            const docBlocks = finalMsg.content.filter(
              (b) => b.type === "tool_use" && b.name === "record_document"
            ) as any[];
            const voidBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "void_session_submission"
            ) as any;
            const showLastCardBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "show_last_card"
            ) as any;
            const editBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "load_submission_for_edit"
            ) as any;

            if (submitBlock || noteBlock || docBlocks.length > 0 || voidBlock || editBlock) {
              saveMessage(sessionKey, company.id, "assistant", finalMsg.content, "tool_call");
            }

            if (mode === "onboarding" && submitBlock) {
              // Auto-absorb: write directly to DB without client confirmation
              const payload = submitBlock.input?.payload ?? submitBlock.input;
              const nowIso = new Date().toISOString();

              // Resolve file paths for record_document entries from onboarding_documents table
              const onboardingDocs = db
                .select()
                .from(schema.onboardingDocuments)
                .where(eq(schema.onboardingDocuments.companyId, company.id))
                .all();

              const docRecords = docBlocks.map((b: any) => {
                const rec = b.input as { fileName: string; documentType: string; includedStatements?: string[] };
                // Match most recently uploaded file with this name
                const matches = onboardingDocs.filter((d) => d.fileName === rec.fileName);
                const matched = matches[matches.length - 1];
                return {
                  fileName: rec.fileName,
                  filePath: matched?.filePath ?? "",
                  documentType: rec.documentType,
                  includedStatements: rec.includedStatements,
                };
              });

              try {
                await writePeriodicSubmission(
                  company,
                  payload,
                  userId !== "anonymous" ? userId : null,
                  nowIso,
                  docRecords,
                  "onboarding"
                );
                const kpiCount = Object.values(
                  (payload.kpis ?? {}) as Record<string, { value: number | null }>
                ).filter((e) => e.value !== null).length;
                send({ type: "onboarding_absorbed", period: payload.period, kpiCount });
              } catch (err: any) {
                console.error("[chat/onboard] absorption failed:", err);
                send({ type: "error", message: "Failed to store data: " + (err.message ?? "unknown error") });
              }
            } else if (submitBlock) {
              // Periodic mode: send to client for operator confirmation
              const payload = submitBlock.input?.payload ?? submitBlock.input;
              send({ type: "tool_call", name: "submit_structured_data", payload });
            }

            if (repliesBlock) {
              const replies = repliesBlock.input?.replies;
              if (Array.isArray(replies) && replies.length > 0) {
                send({ type: "quick_replies", replies });
              }
            }

            for (const docBlock of docBlocks) {
              // In periodic mode, send to client to accumulate; in onboarding, already handled above
              if (mode === "periodic") {
                send({ type: "tool_call", name: "record_document", record: docBlock.input });
              }
            }

            if (voidBlock && mode === "periodic") {
              send({
                type: "tool_call",
                name: "void_session_submission",
                period: voidBlock.input?.period ?? null,
                fiscalYear: voidBlock.input?.fiscal_year ?? null,
                reason: voidBlock.input?.reason ?? null,
              });
            }

            if (showLastCardBlock) {
              send({ type: "show_last_card" });
            }

            if (editBlock) {
              const editPeriod = editBlock.input?.period as string;
              if (editPeriod) {
                const periodRow = db
                  .select()
                  .from(schema.periods)
                  .where(and(
                    eq(schema.periods.firmId, company.firmId),
                    eq(schema.periods.periodStart, `${editPeriod}-01`)
                  ))
                  .get();

                if (periodRow) {
                  const submission = db
                    .select()
                    .from(schema.submissions)
                    .where(and(
                      eq(schema.submissions.companyId, company.id),
                      eq(schema.submissions.periodId, periodRow.id),
                      eq(schema.submissions.status, "submitted")
                    ))
                    .orderBy(desc(schema.submissions.version))
                    .get();

                  if (submission) {
                    const kpiValues = db
                      .select()
                      .from(schema.kpiValues)
                      .where(eq(schema.kpiValues.submissionId, submission.id))
                      .all();

                    const kpiDefs = db
                      .select()
                      .from(schema.kpiDefinitions)
                      .where(and(
                        eq(schema.kpiDefinitions.firmId, company.firmId),
                        eq(schema.kpiDefinitions.active, true)
                      ))
                      .all()
                      .filter((d: any) => d.companyId === null || d.companyId === company.id);

                    const defById = new Map(kpiDefs.map((d: any) => [d.id, d]));
                    const kpis: Record<string, { value: number | null; operator_note?: string | null }> = {};
                    for (const v of kpiValues) {
                      const def = defById.get(v.kpiDefinitionId);
                      if (def) {
                        kpis[(def as any).key] = { value: v.actualNumber ?? null, operator_note: v.note ?? null };
                      }
                    }

                    const docs = db
                      .select()
                      .from(schema.financialDocuments)
                      .where(eq(schema.financialDocuments.submissionId, submission.id))
                      .all();

                    const detectedDocTypes: string[] = [];
                    for (const d of docs) {
                      if (d.documentType === "combined_financials" && d.includedStatements) {
                        detectedDocTypes.push(...d.includedStatements.split(",").filter(Boolean));
                      } else {
                        detectedDocTypes.push(d.documentType);
                      }
                    }

                    send({
                      type: "tool_call",
                      name: "load_submission_for_edit",
                      payload: {
                        submission_type: "periodic" as const,
                        period: editPeriod,
                        kpis,
                        overall_note: submission.note ?? null,
                      },
                      detectedDocuments: [...new Set(detectedDocTypes)],
                      currentVersion: submission.version,
                      companyId: company.id,
                      companyName: company.name,
                      enabledKpis: kpiDefs.map((d: any) => ({ key: d.key, label: d.label, unit: d.unit, valueType: d.valueType })),
                      userId,
                    });
                  }
                }
              }
            }

            if (noteBlock) {
              const newNote = noteBlock.input?.note?.trim();
              if (newNote) {
                const existing = (company as any).submissionNotes ?? "";
                const updated = existing ? `${existing}\n- ${newNote}` : `- ${newNote}`;
                db.update(schema.companies)
                  .set({ submissionNotes: updated } as any)
                  .where(eq(schema.companies.id, company.id))
                  .run();
              }
            }

            send({ type: "done", stopReason: finalMsg.stop_reason });
          }
        }
      } catch (err: any) {
        console.error("[chat handler] Claude error:", err);
        send({ type: "error", message: err.message ?? "Claude API error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── Unified Pulse handler (firm-side investors) ─────────────────────────────

export interface PulseChatRequestBody {
  message: string;
  companyId?: string;
  uploads?: UploadResult[];
  contextDataType?: "actuals" | "plan" | "both";
  contextPeriods?: string;
}

export async function handlePulseChatRequest(req: NextRequest) {
  const session = await auth();
  const user = session?.user as any;
  if (!user || user.persona !== "investor") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PulseChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { message, companyId, uploads = [], contextDataType, contextPeriods } = body;
  const firmId = user.firmId as string;
  const userId = user.id as string;

  const firm = db.select().from(schema.firms).where(eq(schema.firms.id, firmId)).get();
  const firmName = firm?.name ?? "your firm";

  // Look up company if companyId provided
  let company: any = null;
  if (companyId) {
    company = db.select().from(schema.companies)
      .where(and(eq(schema.companies.id, companyId), eq(schema.companies.firmId, firmId)))
      .get();
    if (!company) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
  }

  // Build system prompt based on mode
  let systemPrompt: string;
  let tools: Anthropic.Tool[];
  let docDetectionLine: string | null = null;

  if (company) {
    // Company mode: submission + Q&A
    const ctx = buildSystemPromptContext(company, firmName, { includePortfolioData: true });
    systemPrompt = assembleSystemPrompt(ctx);
    tools = [SUBMIT_STRUCTURED_DATA_TOOL, SUGGEST_QUICK_REPLIES_TOOL, SAVE_SUBMISSION_NOTE_TOOL, RECORD_DOCUMENT_TOOL, VOID_SESSION_SUBMISSION_TOOL, SHOW_LAST_CARD_TOOL, LOAD_SUBMISSION_FOR_EDIT_TOOL];
    docDetectionLine = buildDocDetectionLine(uploads, ctx.requiredDocs);
  } else {
    // Portfolio Q&A mode
    const portfolioDataJson = buildPortfolioDataSection(firmId);
    systemPrompt = assemblePortfolioQASystemPrompt(firmName, portfolioDataJson);
    tools = [SUGGEST_QUICK_REPLIES_TOOL, LOAD_SUBMISSION_FOR_EDIT_TOOL];
  }

  const sessionKey = derivePulseSessionKey(firmId, userId, companyId);
  const history = loadHistory(sessionKey);

  const OPENING_QUESTION = company
    ? `You're viewing ${company.name}. Ask me anything about their data and submissions, or submit data on their behalf.`
    : `How can I help you with your portfolio today?`;

  // Build user content blocks (same logic as handleChatRequest)
  const userContentBlocks: AnthropicContentBlock[] = [];

  for (const upload of uploads) {
    if (upload.extractionMethod === "vision" && upload.imageBase64) {
      userContentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: upload.imageMediaType ?? "image/jpeg", data: upload.imageBase64 },
      });
      userContentBlocks.push({ type: "text", text: `This is an uploaded document image from ${upload.fileName}. Please extract all KPI data visible in this image.` });
    } else if (upload.extractionMethod === "pdf_document" && upload.pdfBase64) {
      userContentBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf" as const, data: upload.pdfBase64 },
      } as any);
      userContentBlocks.push({ type: "text", text: `This is a PDF document: ${upload.fileName}. Please extract all KPI data, financial figures, and relevant information from it.` });
    } else if (upload.extractedText) {
      userContentBlocks.push({ type: "text", text: upload.extractedText });
    }
  }

  if (message.trim()) {
    userContentBlocks.push({ type: "text", text: message });
  }

  const isGreeting = userContentBlocks.length === 0;
  if (isGreeting) {
    userContentBlocks.push({ type: "text", text: "Hello" });
  }

  // Prepend pre-chat context if provided
  if (company && !isGreeting && history.length === 0 && (contextDataType || contextPeriods?.trim())) {
    const contextLines = ["[Submitter provided pre-chat context:]"];
    if (contextDataType) contextLines.push(`- Submitting: ${contextDataType}`);
    if (contextPeriods?.trim()) contextLines.push(`- Period(s): ${contextPeriods.trim()}`);
    userContentBlocks.unshift({ type: "text", text: contextLines.join("\n") });
  }

  // Save user message
  if (!isGreeting) {
    const userStoredContent = [
      ...uploads.map((u) => `[Attached: ${u.fileName}]`),
      message,
    ].filter(Boolean).join("\n");
    saveMessage(sessionKey, companyId ?? "portfolio", "user", userStoredContent, "text");
  }

  const anthropicMessages = buildAnthropicMessages(history, userContentBlocks, OPENING_QUESTION);

  // Detect submission intent for tool_choice forcing (only in company mode)
  const numberMatches = message.match(/\$?\d[\d,.]+%?/g) || [];
  const looksLikeSubmission = company && (uploads.length > 0 || numberMatches.length >= 3);
  const toolChoice: Anthropic.MessageCreateParams["tool_choice"] | undefined =
    looksLikeSubmission && !isGreeting
      ? { type: "tool" as const, name: "submit_structured_data" }
      : undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        if (docDetectionLine) {
          send({ type: "doc_detection", line: docDetectionLine });
        }

        let fullText = "";

        const claudeStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages: anthropicMessages as any,
          tools,
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
        });

        for await (const event of claudeStream) {
          if (event.type === "content_block_delta") {
            const delta = event.delta as any;
            if (delta.type === "text_delta") {
              fullText += delta.text;
              send({ type: "text", content: delta.text });
            }
          }

          if (event.type === "message_stop") {
            const finalMsg = await claudeStream.finalMessage();

            if (fullText) {
              saveMessage(sessionKey, companyId ?? "portfolio", "assistant", fullText, "text");
            }

            const submitBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "submit_structured_data"
            ) as any;
            const repliesBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "suggest_quick_replies"
            ) as any;
            const noteBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "save_submission_note"
            ) as any;
            const docBlocks = finalMsg.content.filter(
              (b) => b.type === "tool_use" && b.name === "record_document"
            ) as any[];
            const voidBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "void_session_submission"
            ) as any;
            const showLastCardBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "show_last_card"
            ) as any;
            const editBlock = finalMsg.content.find(
              (b) => b.type === "tool_use" && b.name === "load_submission_for_edit"
            ) as any;

            if (submitBlock || noteBlock || docBlocks.length > 0 || voidBlock || editBlock) {
              saveMessage(sessionKey, companyId ?? "portfolio", "assistant", finalMsg.content, "tool_call");
            }

            // Periodic submission: send to client for confirmation
            if (submitBlock) {
              const payload = submitBlock.input?.payload ?? submitBlock.input;
              send({ type: "tool_call", name: "submit_structured_data", payload });
            }

            if (repliesBlock) {
              const replies = repliesBlock.input?.replies;
              if (Array.isArray(replies) && replies.length > 0) {
                send({ type: "quick_replies", replies });
              }
            }

            for (const docBlock of docBlocks) {
              send({ type: "tool_call", name: "record_document", record: docBlock.input });
            }

            if (voidBlock) {
              send({
                type: "tool_call",
                name: "void_session_submission",
                period: voidBlock.input?.period ?? null,
                fiscalYear: voidBlock.input?.fiscal_year ?? null,
                reason: voidBlock.input?.reason ?? null,
              });
            }

            if (showLastCardBlock) {
              send({ type: "show_last_card" });
            }

            if (editBlock) {
              const editPeriod = editBlock.input?.period as string;
              const editCompanyName = editBlock.input?.company_name as string | undefined;

              // Resolve company: use existing company context, or look up by name from tool input
              let editCompany = company;
              if (!editCompany && editCompanyName) {
                const allCompanies = db.select().from(schema.companies)
                  .where(eq(schema.companies.firmId, firmId))
                  .all();
                // Fuzzy match: case-insensitive substring
                const lower = editCompanyName.toLowerCase();
                editCompany = allCompanies.find((c: any) => c.name.toLowerCase().includes(lower)) ?? null;
              }

              if (editPeriod && editCompany) {
                const periodRow = db
                  .select()
                  .from(schema.periods)
                  .where(and(
                    eq(schema.periods.firmId, editCompany.firmId),
                    eq(schema.periods.periodStart, `${editPeriod}-01`)
                  ))
                  .get();

                if (periodRow) {
                  const submission = db
                    .select()
                    .from(schema.submissions)
                    .where(and(
                      eq(schema.submissions.companyId, editCompany.id),
                      eq(schema.submissions.periodId, periodRow.id),
                      eq(schema.submissions.status, "submitted")
                    ))
                    .orderBy(desc(schema.submissions.version))
                    .get();

                  if (submission) {
                    const kpiValues = db
                      .select()
                      .from(schema.kpiValues)
                      .where(eq(schema.kpiValues.submissionId, submission.id))
                      .all();

                    const kpiDefs = db
                      .select()
                      .from(schema.kpiDefinitions)
                      .where(and(
                        eq(schema.kpiDefinitions.firmId, editCompany.firmId),
                        eq(schema.kpiDefinitions.active, true)
                      ))
                      .all()
                      .filter((d: any) => d.companyId === null || d.companyId === editCompany!.id);

                    const defById = new Map(kpiDefs.map((d: any) => [d.id, d]));
                    const kpis: Record<string, { value: number | null; operator_note?: string | null }> = {};
                    for (const v of kpiValues) {
                      const def = defById.get(v.kpiDefinitionId);
                      if (def) {
                        kpis[(def as any).key] = { value: v.actualNumber ?? null, operator_note: v.note ?? null };
                      }
                    }

                    const docs = db
                      .select()
                      .from(schema.financialDocuments)
                      .where(eq(schema.financialDocuments.submissionId, submission.id))
                      .all();

                    const detectedDocTypes: string[] = [];
                    for (const d of docs) {
                      if (d.documentType === "combined_financials" && d.includedStatements) {
                        detectedDocTypes.push(...d.includedStatements.split(",").filter(Boolean));
                      } else {
                        detectedDocTypes.push(d.documentType);
                      }
                    }

                    send({
                      type: "tool_call",
                      name: "load_submission_for_edit",
                      payload: {
                        submission_type: "periodic" as const,
                        period: editPeriod,
                        kpis,
                        overall_note: submission.note ?? null,
                      },
                      detectedDocuments: [...new Set(detectedDocTypes)],
                      currentVersion: submission.version,
                      companyId: editCompany.id,
                      companyName: editCompany.name,
                      enabledKpis: kpiDefs.map((d: any) => ({ key: d.key, label: d.label, unit: d.unit, valueType: d.valueType })),
                      userId,
                    });
                  }
                }
              }
            }

            if (noteBlock && company) {
              const newNote = noteBlock.input?.note?.trim();
              if (newNote) {
                const existing = (company as any).submissionNotes ?? "";
                const updated = existing ? `${existing}\n- ${newNote}` : `- ${newNote}`;
                db.update(schema.companies)
                  .set({ submissionNotes: updated } as any)
                  .where(eq(schema.companies.id, company.id))
                  .run();
              }
            }

            send({ type: "done", stopReason: finalMsg.stop_reason });
          }
        }
      } catch (err: any) {
        console.error("[chat/pulse] Claude error:", err);
        send({ type: "error", message: err.message ?? "Claude API error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
