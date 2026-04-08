/**
 * GET /api/chat/context?companyId=<id>
 * Returns all data needed for the persistent chat panel to initialize for a company.
 * Used by PersistentChatPanel on the client to hydrate ChatInterface.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { deriveSessionKey, loadHistory } from "@/lib/chat/session";

export async function GET(req: NextRequest) {
  const session = await auth();
  const user = session?.user as any;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  // Operators can only access their own company
  const isOperator = user.persona === "operator" || user.persona === "independent_operator";
  if (isOperator && user.companyId !== companyId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const company = db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, companyId), eq(schema.companies.firmId, user.firmId)))
    .get();

  if (!company) return NextResponse.json({ error: "not found" }, { status: 404 });

  const firm = db
    .select()
    .from(schema.firms)
    .where(eq(schema.firms.id, company.firmId))
    .get();
  const firmName = firm?.name ?? "your firm";

  // Enabled KPI defs for this company
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id)
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

  const enabledKpis = kpiDefs.map((d) => ({
    key: d.key,
    label: d.label,
    unit: d.unit,
    valueType: d.valueType,
  }));

  // Chat mode
  const obStatus = (company as any).onboardingStatus as string | null;
  const chatMode: "periodic" | "onboarding" =
    obStatus === "pending" || obStatus === "in_progress" ? "onboarding" : "periodic";
  const chatEndpoint = chatMode === "onboarding" ? "/api/chat/onboard" : "/api/chat/submit";

  // Load chat history for display
  const sessionKey = deriveSessionKey((company as any).submissionToken, user.id);
  const history = loadHistory(sessionKey);

  type InitialMsg = {
    role: "user" | "assistant";
    content: string;
    submittedPayload?: Record<string, unknown>;
    detectedDocuments?: string[];
    divider?: string;
  };

  const initialMessages: InitialMsg[] = [];
  for (const h of history) {
    if (h.contentType === "text") {
      initialMessages.push({ role: h.role, content: h.content as string });
    } else if (h.contentType === "tool_call") {
      const blocks = h.content as any[];
      for (const b of blocks) {
        if (b.type === "tool_use" && b.name === "submit_structured_data") {
          const payload = b.input?.payload ?? b.input;
          if (payload) {
            // Look up documents recorded for this submission
            let docTypes: string[] = [];
            if (payload.period) {
              const periodRow = db
                .select()
                .from(schema.periods)
                .where(and(
                  eq(schema.periods.firmId, user.firmId),
                  eq(schema.periods.periodStart, `${payload.period}-01`)
                ))
                .get();
              if (periodRow) {
                const submission = db
                  .select()
                  .from(schema.submissions)
                  .where(and(
                    eq(schema.submissions.companyId, companyId!),
                    eq(schema.submissions.periodId, periodRow.id)
                  ))
                  .orderBy(desc(schema.submissions.version))
                  .limit(1)
                  .get();
                if (submission) {
                  const docs = db
                    .select()
                    .from(schema.financialDocuments)
                    .where(eq(schema.financialDocuments.submissionId, submission.id))
                    .all();
                  for (const d of docs) {
                    if (d.documentType === "combined_financials" && d.includedStatements) {
                      docTypes.push(...d.includedStatements.split(",").filter(Boolean));
                    } else {
                      docTypes.push(d.documentType);
                    }
                  }
                  docTypes = [...new Set(docTypes)];
                }
              }
            }
            initialMessages.push({
              role: "assistant",
              content: "",
              submittedPayload: payload,
              detectedDocuments: docTypes.length > 0 ? docTypes : undefined,
            });
          }
        }
      }
    }
  }

  // Opening message shown in UI when no prior history exists
  const openingMessage = isOperator
    ? `Hi — use this chat to submit your data or ask questions about ${company.name}. Attach files, type numbers directly, or ask me anything about your KPIs and submissions.`
    : `You're viewing ${company.name}. Ask me anything about their data and submissions, or submit data on their behalf.`;

  return NextResponse.json({
    token: (company as any).submissionToken as string,
    companyName: company.name,
    firmName,
    chatMode,
    chatEndpoint,
    initialMessages,
    enabledKpis,
    userId: user.id,
    openingMessage,
    requiredDocs: (company as any).requiredDocs ?? "",
    requiredDocCadences: (company as any).requiredDocCadences ?? "",
  });
}
