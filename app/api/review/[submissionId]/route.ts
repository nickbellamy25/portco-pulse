/**
 * GET /api/review/[submissionId] — fetch pending submission details for the review modal
 * POST /api/review/[submissionId] — approve | reject (firm-user, investor persona only)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc, max } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const user = session.user as any;

  const { submissionId } = await params;

  const pending = db.select().from(schema.pendingSubmissions).where(eq(schema.pendingSubmissions.id, submissionId)).get();
  if (!pending) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const company = db.select().from(schema.companies).where(eq(schema.companies.id, pending.companyId)).get();
  if (!company || company.firmId !== user.firmId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // KPI definitions for this company
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id)
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

  // Plan comparison data (periodic submissions only)
  let planValues: Record<string, number | null> = {};
  if (pending.submissionType === "periodic" && pending.period) {
    const fiscalYear = parseInt(pending.period.slice(0, 4), 10);
    const activePlan = db
      .select()
      .from(schema.kpiPlans)
      .where(and(eq(schema.kpiPlans.companyId, company.id), eq(schema.kpiPlans.fiscalYear, fiscalYear)))
      .orderBy(desc(schema.kpiPlans.version))
      .get();
    if (activePlan) {
      const pvals = db.select().from(schema.kpiPlanValues).where(eq(schema.kpiPlanValues.planId, activePlan.id)).all();
      for (const pv of pvals) {
        const def = kpiDefs.find((d) => d.id === pv.kpiDefinitionId);
        if (def) planValues[def.key] = pv.value ?? null;
      }
    }
  }

  // Resolve submitted-by user name
  let submittedByUser: string | null = null;
  if (pending.submittedByUserId) {
    const submitter = db.select().from(schema.users).where(eq(schema.users.id, pending.submittedByUserId)).get();
    submittedByUser = submitter?.name ?? submitter?.email ?? null;
  }

  return NextResponse.json({
    pending: { ...pending, submittedByUser },
    companyName: company.name,
    kpiDefs: kpiDefs.map((d) => ({ key: d.key, label: d.label, unit: d.unit, valueType: d.valueType, ragDirection: d.ragDirection })),
    planValues,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const user = session.user as any;
  if (user.persona !== "investor") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { submissionId } = await params;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { action, editedValues, rejectionReason } = body;

  const pending = db
    .select()
    .from(schema.pendingSubmissions)
    .where(eq(schema.pendingSubmissions.id, submissionId))
    .get();

  if (!pending) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (pending.status !== "pending_review") {
    return NextResponse.json({ error: "already_reviewed", status: pending.status }, { status: 409 });
  }

  // Verify firm access
  const company = db.select().from(schema.companies).where(eq(schema.companies.id, pending.companyId)).get();
  if (!company || company.firmId !== user.firmId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "reject") {
    db.update(schema.pendingSubmissions)
      .set({
        status: "rejected",
        reviewedBy: user.id,
        reviewedAt: now,
        reviewNotes: rejectionReason ?? null,
      })
      .where(eq(schema.pendingSubmissions.id, submissionId))
      .run();

    return NextResponse.json({ success: true, status: "rejected" });
  }

  if (action === "approve") {
    const payload = JSON.parse(pending.extractedPayload) as {
      submission_type: "periodic" | "plan";
      period?: string;
      fiscal_year?: number;
      kpis: Record<string, { value: number | null; operator_note?: string | null }>;
      overall_note?: string | null;
    };

    // Merge any inline edits made by firm user in the review modal
    const mergedKpis = { ...payload.kpis };
    if (editedValues && typeof editedValues === "object") {
      for (const [key, val] of Object.entries(editedValues)) {
        if (mergedKpis[key]) {
          mergedKpis[key] = { ...mergedKpis[key], value: val as number | null };
        } else {
          mergedKpis[key] = { value: val as number | null };
        }
      }
    }

    if (pending.submissionType === "periodic") {
      await approvePeriodicSubmission(pending, company, user, payload, mergedKpis, nowIso, now);
    } else {
      await approvePlanSubmission(pending, company, user, payload, mergedKpis, nowIso);
    }

    // Mark pending as approved
    db.update(schema.pendingSubmissions)
      .set({ status: "approved", reviewedBy: user.id, reviewedAt: now, reviewNotes: null })
      .where(eq(schema.pendingSubmissions.id, submissionId))
      .run();

    return NextResponse.json({ success: true, status: "approved" });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

async function approvePeriodicSubmission(
  pending: schema.PendingSubmission,
  company: schema.Company,
  user: any,
  payload: any,
  mergedKpis: Record<string, { value: number | null; operator_note?: string | null }>,
  nowIso: string,
  now: Date
) {
  const periodStr = pending.period ?? payload.period;
  if (!periodStr) throw new Error("No period in pending submission");

  // Find or create the period
  let period = db
    .select()
    .from(schema.periods)
    .where(and(
      eq(schema.periods.firmId, company.firmId),
      eq(schema.periods.periodType, "monthly"),
      eq(schema.periods.periodStart, `${periodStr}-01`)
    ))
    .get();

  if (!period) {
    const periodId = crypto.randomUUID();
    db.insert(schema.periods).values({
      id: periodId,
      firmId: company.firmId,
      periodType: "monthly",
      periodStart: `${periodStr}-01`,
      status: "open",
    }).run();
    period = db.select().from(schema.periods).where(eq(schema.periods.id, periodId)).get()!;
  }

  // Determine next version number
  const latestSub = db
    .select()
    .from(schema.submissions)
    .where(and(
      eq(schema.submissions.companyId, company.id),
      eq(schema.submissions.periodId, period.id)
    ))
    .orderBy(desc(schema.submissions.version))
    .get();

  const nextVersion = latestSub ? latestSub.version + 1 : 1;

  // Always create a new submission version
  const subId = crypto.randomUUID();
  db.insert(schema.submissions).values({
    id: subId,
    firmId: company.firmId,
    companyId: company.id,
    periodId: period.id,
    version: nextVersion,
    status: "submitted",
    submittedAt: nowIso,
    submittedByUserId: null,
    note: payload.overall_note ?? null,
    lastUpdatedAt: nowIso,
    extractionSource: "chat",
  } as any).run();
  const submission = db.select().from(schema.submissions).where(eq(schema.submissions.id, subId)).get()!;

  // Load KPI definitions by key
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id);
  const kpiByKey = Object.fromEntries(kpiDefs.map((d) => [d.key, d]));

  // Insert KPI values for this version
  for (const [key, entry] of Object.entries(mergedKpis)) {
    const kpiDef = kpiByKey[key];
    if (!kpiDef) continue;
    if (entry.value === null && !entry.operator_note) continue;

    db.insert(schema.kpiValues).values({
      submissionId: submission.id,
      firmId: company.firmId,
      companyId: company.id,
      periodId: period.id,
      kpiDefinitionId: kpiDef.id,
      actualNumber: entry.value ?? null,
      note: entry.operator_note ?? null,
    }).run();
  }
}

async function approvePlanSubmission(
  pending: schema.PendingSubmission,
  company: schema.Company,
  user: any,
  payload: any,
  mergedKpis: Record<string, { value: number | null; operator_note?: string | null }>,
  nowIso: string
) {
  const fiscalYear = pending.fiscalYear ?? payload.fiscal_year;
  if (!fiscalYear) throw new Error("No fiscal year in pending submission");

  // Get latest existing plan version
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

  // Load KPI definitions by key
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id);
  const kpiByKey = Object.fromEntries(kpiDefs.map((d) => [d.key, d]));

  for (const [key, entry] of Object.entries(mergedKpis)) {
    const kpiDef = kpiByKey[key];
    if (!kpiDef) continue;
    db.insert(schema.kpiPlanValues).values({
      planId,
      kpiDefinitionId: kpiDef.id,
      periodMonth: null,
      value: entry.value ?? null,
    }).run();
  }
}
