/**
 * POST /api/review
 * action: "operator_confirmed" — writes submission directly to live tables (no approval step)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { sendSubmissionVoidedEmail, sendSubmissionNotificationEmail } from "@/lib/server/email";
import { writePeriodicSubmission, type DocRecord } from "@/lib/server/submissions";

function buildSubmissionTypeLabel(periodType: string, periodStart: string): string {
  const d = new Date(`${periodStart.slice(0, 10)}T12:00:00`);
  if (periodType === "quarterly") {
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    return `Q${quarter} ${d.getFullYear()} periodic submission`;
  }
  const monthName = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `${monthName} periodic submission`;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { action, token, companyId: bodyCompanyId, submissionType, period, fiscalYear, payload, submittedByUserId, docRecords, uploadedFiles, submissionId, voidReason } = body;

  if (!["operator_confirmed", "void_submission"].includes(action)) {
    return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
  }

  if (!token && !bodyCompanyId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  let company;
  if (token) {
    company = db.select().from(schema.companies).where(eq(schema.companies.submissionToken, token)).get();
  } else if (bodyCompanyId) {
    // Firm-side investor: verify auth + firm ownership
    const session = await auth();
    const user = session?.user as any;
    if (!user || user.persona !== "investor") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    company = db.select().from(schema.companies).where(
      and(eq(schema.companies.id, bodyCompanyId), eq(schema.companies.firmId, user.firmId))
    ).get();
  }
  if (!company) {
    return NextResponse.json({ message: "invalid_token" }, { status: 401 });
  }

  // ── Void a prior session submission ─────────────────────────────────────────
  if (action === "void_submission") {
    if (!submissionId) return NextResponse.json({ error: "missing_submission_id" }, { status: 400 });
    const sub = db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId)).get();
    if (!sub || sub.companyId !== company.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Look up period label before deleting
    const subPeriod = db.select().from(schema.periods).where(eq(schema.periods.id, sub.periodId)).get();
    const periodLabel = subPeriod ? subPeriod.periodStart.slice(0, 7) : "unknown";
    const submissionTypeLabel = subPeriod
      ? buildSubmissionTypeLabel(subPeriod.periodType, subPeriod.periodStart)
      : "periodic submission";

    db.delete(schema.kpiValues).where(eq(schema.kpiValues.submissionId, submissionId)).run();
    db.delete(schema.financialDocuments).where(eq(schema.financialDocuments.submissionId, submissionId)).run();
    db.delete(schema.submissions).where(eq(schema.submissions.id, submissionId)).run();

    // Fire voided notification
    const emailSettings = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, company.firmId)).get();
    const recipients = ((emailSettings as any)?.submissionVoidedRecipients ?? "")
      .split(",").map((e: string) => e.trim()).filter(Boolean);
    await sendSubmissionVoidedEmail({
      to: recipients,
      companyName: company.name,
      submissionType: submissionTypeLabel,
      periodLabel,
      voidedDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      voidReason: voidReason || undefined,
      settings: emailSettings ?? null,
      firmId: company.firmId,
      companyId: company.id,
    });

    revalidatePath("/submissions");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
    return NextResponse.json({ voided: submissionId });
  }

  if (!submissionType || !payload) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // Merge explicit docRecords (Claude-confirmed) with auto-detected uploadedFiles.
    // Explicit records take precedence; auto-detected fills in any gaps.
    const explicitByName = new Map<string, DocRecord>((docRecords ?? []).map((r: DocRecord) => [r.fileName, r]));
    const mergedDocRecords: DocRecord[] = [...(docRecords ?? [])];
    for (const u of (uploadedFiles ?? []) as DocRecord[]) {
      if (!explicitByName.has(u.fileName) && u.filePath && u.documentType) {
        mergedDocRecords.push(u);
      }
    }

    if (submissionType === "periodic") {
      const id = await writePeriodicSubmission(company, payload, submittedByUserId ?? null, nowIso, mergedDocRecords);

      // Send submission notification to firm recipients
      try {
        const emailConfig = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, company.firmId)).get() ?? null;
        const firmRecipients = emailConfig?.submissionNotificationRecipients?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
        const companyCc = ((company as any).submissionCcEmails ?? "").split(",").map((e: string) => e.trim()).filter(Boolean);
        const notifTo = [...new Set([...firmRecipients, ...companyCc])];
        if (notifTo.length > 0) {
          await sendSubmissionNotificationEmail({
            to: notifTo,
            companyName: company.name,
            period: payload.period ?? "",
            submissionTime: nowIso,
            isResubmission: false,
            settings: emailConfig,
            firmId: company.firmId,
            companyId: company.id,
          });
        }
      } catch (err) {
        console.error("[review] submission notification email failed:", err);
      }

      revalidatePath("/submissions");
      revalidatePath("/dashboard");
      revalidatePath("/analytics");
      return NextResponse.json({ id });
    } else {
      const id = await writePlanSubmission(company, payload, nowIso);
      revalidatePath("/submissions");
      revalidatePath("/analytics");
      return NextResponse.json({ id });
    }
  } catch (err: any) {
    console.error("[review] submission write failed:", err);
    return NextResponse.json({ message: err.message ?? "write_failed" }, { status: 500 });
  }
}

async function writePlanSubmission(
  company: schema.Company,
  payload: any,
  nowIso: string
) {
  const fiscalYear: number = payload.fiscal_year;
  if (!fiscalYear) throw new Error("No fiscal_year in payload");

  const latestPlan = db
    .select()
    .from(schema.kpiPlans)
    .where(and(eq(schema.kpiPlans.companyId, company.id), eq(schema.kpiPlans.fiscalYear, fiscalYear)))
    .orderBy(desc(schema.kpiPlans.version))
    .get();
  const nextVersion = latestPlan ? latestPlan.version + 1 : 1;

  const planId = crypto.randomUUID();
  db.insert(schema.kpiPlans).values({
    id: planId,
    firmId: company.firmId,
    companyId: company.id,
    fiscalYear,
    granularity: "annual",
    version: nextVersion,
    submittedAt: nowIso,
    note: payload.overall_note ?? null,
  }).run();

  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id);
  const kpiByKey = Object.fromEntries(kpiDefs.map((d) => [d.key, d]));

  for (const [key, entry] of Object.entries(payload.kpis as Record<string, { value: number | null }>)) {
    const kpiDef = kpiByKey[key];
    if (!kpiDef) continue;
    db.insert(schema.kpiPlanValues).values({
      planId,
      kpiDefinitionId: kpiDef.id,
      periodMonth: null,
      value: entry.value ?? null,
    }).run();
  }

  return planId;
}
