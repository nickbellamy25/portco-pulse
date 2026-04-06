"use server";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { sendPlanSubmittedEmail } from "@/lib/server/email";

// Values key format:
//   Annual granularity: key = kpiDefinitionId
//   Monthly granularity: key = `${kpiDefinitionId}_m_${month}` (month = 1–12)
export async function savePlanAction(
  token: string,
  values: Record<string, number | null>,
  note: string,
  action: "draft" | "submit",
  fiscalYear: number,
  granularity: "annual" | "monthly"
) {
  const company = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.submissionToken, token))
    .get();
  if (!company) throw new Error("Invalid token");

  // Get latest plan for this company + year
  const latestPlan = db
    .select()
    .from(schema.kpiPlans)
    .where(
      and(
        eq(schema.kpiPlans.companyId, company.id),
        eq(schema.kpiPlans.fiscalYear, fiscalYear)
      )
    )
    .orderBy(desc(schema.kpiPlans.version))
    .limit(1)
    .get() ?? null;

  const isAlreadySubmitted = latestPlan?.submittedAt !== null && latestPlan?.submittedAt !== undefined;
  const now = new Date().toISOString();

  let plan: schema.KpiPlan;

  if (!latestPlan) {
    // First-ever draft for this company + year
    const newId = crypto.randomUUID();
    db.insert(schema.kpiPlans).values({
      id: newId,
      firmId: company.firmId,
      companyId: company.id,
      fiscalYear,
      granularity,
      version: 1,
      note: note || null,
    }).run();
    plan = db.select().from(schema.kpiPlans).where(eq(schema.kpiPlans.id, newId)).get()!;
  } else if (isAlreadySubmitted) {
    // Starting a revision — create new version, copy existing values
    const newId = crypto.randomUUID();
    db.insert(schema.kpiPlans).values({
      id: newId,
      firmId: company.firmId,
      companyId: company.id,
      fiscalYear,
      granularity: latestPlan.granularity, // granularity is locked after first submission
      version: latestPlan.version + 1,
      note: note || null,
    }).run();
    plan = db.select().from(schema.kpiPlans).where(eq(schema.kpiPlans.id, newId)).get()!;

    // Copy values from the previous version as a starting point
    const prevValues = db
      .select()
      .from(schema.kpiPlanValues)
      .where(eq(schema.kpiPlanValues.planId, latestPlan.id))
      .all();
    for (const pv of prevValues) {
      db.insert(schema.kpiPlanValues).values({
        id: crypto.randomUUID(),
        planId: plan.id,
        kpiDefinitionId: pv.kpiDefinitionId,
        periodMonth: pv.periodMonth,
        value: pv.value,
      }).run();
    }
  } else {
    // Update existing draft note
    db.update(schema.kpiPlans)
      .set({ note: note || null })
      .where(eq(schema.kpiPlans.id, latestPlan.id))
      .run();
    plan = { ...latestPlan, note: note || null };
  }

  // Upsert KPI plan values
  for (const [key, value] of Object.entries(values)) {
    let kpiDefinitionId: string;
    let periodMonth: number | null;

    if (key.includes("_q_")) {
      const idx = key.lastIndexOf("_q_");
      kpiDefinitionId = key.substring(0, idx);
      const quarter = parseInt(key.substring(idx + 3), 10);
      periodMonth = 100 + quarter; // Q1→101, Q2→102, Q3→103, Q4→104
    } else if (key.includes("_m_")) {
      const idx = key.lastIndexOf("_m_");
      kpiDefinitionId = key.substring(0, idx);
      periodMonth = parseInt(key.substring(idx + 3), 10);
    } else {
      kpiDefinitionId = key;
      periodMonth = null;
    }

    const existing = db
      .select()
      .from(schema.kpiPlanValues)
      .where(
        and(
          eq(schema.kpiPlanValues.planId, plan.id),
          eq(schema.kpiPlanValues.kpiDefinitionId, kpiDefinitionId),
          periodMonth === null
            ? isNull(schema.kpiPlanValues.periodMonth)
            : eq(schema.kpiPlanValues.periodMonth, periodMonth)
        )
      )
      .get();

    if (existing) {
      db.update(schema.kpiPlanValues)
        .set({ value })
        .where(eq(schema.kpiPlanValues.id, existing.id))
        .run();
    } else {
      db.insert(schema.kpiPlanValues).values({
        id: crypto.randomUUID(),
        planId: plan.id,
        kpiDefinitionId,
        periodMonth,
        value,
      }).run();
    }
  }

  if (action === "submit") {
    db.update(schema.kpiPlans)
      .set({ submittedAt: now })
      .where(eq(schema.kpiPlans.id, plan.id))
      .run();

    // Notify firm
    const emailConfig = db
      .select()
      .from(schema.emailSettings)
      .where(eq(schema.emailSettings.firmId, company.firmId))
      .get() ?? null;

    const recipients = (emailConfig?.submissionNotificationRecipients ?? "")
      .split(",").map((e) => e.trim()).filter(Boolean);

    if (recipients.length > 0 && emailConfig?.submissionNotificationEnabled) {
      const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      const planLink = `${baseUrl}/admin/companies?company=${company.id}&tab=kpis`;
      await sendPlanSubmittedEmail({
        to: recipients,
        companyName: company.name,
        fiscalYear,
        version: plan.version,
        planLink,
        settings: emailConfig,
      });
    }
  }

  return { success: true, action };
}

export async function deletePlanDraftAction(token: string, planId: string) {
  const company = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.submissionToken, token))
    .get();
  if (!company) throw new Error("Invalid token");

  const plan = db
    .select()
    .from(schema.kpiPlans)
    .where(and(eq(schema.kpiPlans.id, planId), eq(schema.kpiPlans.companyId, company.id)))
    .get();
  if (!plan || plan.submittedAt) throw new Error("Cannot delete this plan");

  db.delete(schema.kpiPlanValues).where(eq(schema.kpiPlanValues.planId, planId)).run();
  db.delete(schema.kpiPlans).where(eq(schema.kpiPlans.id, planId)).run();
}
