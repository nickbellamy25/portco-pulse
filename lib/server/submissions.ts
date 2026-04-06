/**
 * Shared submission write functions — used by /api/review (periodic confirm flow)
 * and /api/chat/onboard (onboarding auto-absorption flow).
 */

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export interface DocRecord {
  fileName: string;
  filePath: string;
  documentType: string;
  includedStatements?: string[];
}

export async function writePeriodicSubmission(
  company: schema.Company,
  payload: any,
  submittedByUserId: string | null,
  nowIso: string,
  docRecords: DocRecord[] = [],
  extractionSource: string = "chat"
): Promise<string> {
  const periodStr: string = payload.period;
  if (!periodStr) throw new Error("No period in payload");

  // Find or create the period
  let period = db
    .select()
    .from(schema.periods)
    .where(
      and(
        eq(schema.periods.firmId, company.firmId),
        eq(schema.periods.periodType, "monthly"),
        eq(schema.periods.periodStart, `${periodStr}-01`)
      )
    )
    .get();

  if (!period) {
    const periodId = crypto.randomUUID();
    db.insert(schema.periods)
      .values({
        id: periodId,
        firmId: company.firmId,
        periodType: "monthly",
        periodStart: `${periodStr}-01`,
        status: "open",
      })
      .run();
    period = db.select().from(schema.periods).where(eq(schema.periods.id, periodId)).get()!;
  }

  // Next version number
  const latestSub = db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.companyId, company.id),
        eq(schema.submissions.periodId, period.id)
      )
    )
    .orderBy(desc(schema.submissions.version))
    .get();
  const nextVersion = latestSub ? latestSub.version + 1 : 1;

  const subId = crypto.randomUUID();
  db.insert(schema.submissions)
    .values({
      id: subId,
      firmId: company.firmId,
      companyId: company.id,
      periodId: period.id,
      version: nextVersion,
      status: "submitted",
      submittedAt: nowIso,
      submittedByUserId,
      note: payload.overall_note ?? null,
      lastUpdatedAt: nowIso,
      extractionSource,
    } as any)
    .run();

  // KPI definitions
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id);
  const kpiByKey = Object.fromEntries(kpiDefs.map((d) => [d.key, d]));

  for (const [key, entry] of Object.entries(
    payload.kpis as Record<string, { value: number | null; operator_note?: string | null }>
  )) {
    const kpiDef = kpiByKey[key];
    if (!kpiDef) continue;
    if (entry.value === null && !entry.operator_note) continue;
    db.insert(schema.kpiValues)
      .values({
        submissionId: subId,
        firmId: company.firmId,
        companyId: company.id,
        periodId: period.id,
        kpiDefinitionId: kpiDef.id,
        actualNumber: entry.value ?? null,
        note: entry.operator_note ?? null,
      })
      .run();
  }

  // Write financial document records
  const validTypes = [
    "balance_sheet",
    "income_statement",
    "cash_flow_statement",
    "investor_update",
    "combined_financials",
    "financial_document",
  ];
  for (const doc of docRecords) {
    if (!doc.filePath || !doc.documentType) continue;
    if (!validTypes.includes(doc.documentType)) continue;
    db.insert(schema.financialDocuments)
      .values({
        firmId: company.firmId,
        companyId: company.id,
        periodId: period.id,
        submissionId: subId,
        documentType: doc.documentType as any,
        fileName: doc.fileName,
        filePath: doc.filePath,
        includedStatements: doc.includedStatements?.join(",") ?? null,
        uploadedByUserId: submittedByUserId,
        uploadedAt: nowIso,
      })
      .run();
  }

  return subId;
}
