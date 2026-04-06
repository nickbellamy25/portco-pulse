"use server";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { sendSubmissionNotificationEmail, sendRagAlertEmail } from "@/lib/server/email";
import { computeRagPct, isDocDueThisPeriod, parseDocCadences } from "@/lib/server/analytics";

const kpiValueSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

type RagOverrideEntry = {
  override: "green" | "amber" | "red" | null;
  reason: string;
};

export async function saveSubmissionAction(
  token: string,
  kpiValues: Record<string, string | number | null>,
  action: "draft" | "submit",
  periodId?: string,
  kpiNotes?: Record<string, string>,
  ragOverrides?: Record<string, RagOverrideEntry>,
  submissionNote?: string
) {
  // Verify token
  const company = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.submissionToken, token))
    .get();
  if (!company) throw new Error("Invalid token");

  // Get requested period or fall back to latest
  let period;
  if (periodId) {
    period = db
      .select()
      .from(schema.periods)
      .where(and(eq(schema.periods.id, periodId), eq(schema.periods.firmId, company.firmId)))
      .get();
  }
  if (!period) {
    period = db
      .select()
      .from(schema.periods)
      .where(eq(schema.periods.firmId, company.firmId))
      .orderBy(desc(schema.periods.periodStart))
      .get();
  }
  if (!period) throw new Error("No period found");

  // Get or create submission
  let submission = db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.companyId, company.id),
        eq(schema.submissions.periodId, period.id)
      )
    )
    .get();

  const now = new Date().toISOString();
  const isResubmission = submission?.status === "submitted";

  if (!submission) {
    const newId = crypto.randomUUID();
    db.insert(schema.submissions).values({
      id: newId,
      firmId: company.firmId,
      companyId: company.id,
      periodId: period.id,
      status: "draft",
      lastUpdatedAt: now,
    }).run();
    submission = db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, newId))
      .get()!;
  } else if (submission.status === "submitted") {
    // Revert to draft on edit
    db.update(schema.submissions)
      .set({ status: "draft", submittedAt: null, submittedByUserId: null, lastUpdatedAt: now })
      .where(eq(schema.submissions.id, submission.id))
      .run();
  }

  // Upsert KPI values
  for (const [kpiDefId, value] of Object.entries(kpiValues)) {
    const kpiDef = db
      .select()
      .from(schema.kpiDefinitions)
      .where(eq(schema.kpiDefinitions.id, kpiDefId))
      .get();
    if (!kpiDef) continue;

    const isNumeric = ["currency", "percent", "integer"].includes(kpiDef.valueType);
    const numVal = isNumeric && value !== null && value !== "" ? Number(value) : null;
    const textVal = !isNumeric && value !== null ? String(value) : null;

    const existing = db
      .select()
      .from(schema.kpiValues)
      .where(
        and(
          eq(schema.kpiValues.submissionId, submission.id),
          eq(schema.kpiValues.kpiDefinitionId, kpiDefId)
        )
      )
      .get();

    const note = kpiNotes?.[kpiDefId] ?? null;
    const ragEntry = ragOverrides?.[kpiDefId];
    const ragOverride = ragEntry?.override ?? null;
    const ragOverrideReason = ragEntry?.reason || null;

    if (existing) {
      db.update(schema.kpiValues)
        .set({ actualNumber: numVal, actualText: textVal, note, ragOverride, ragOverrideReason })
        .where(eq(schema.kpiValues.id, existing.id))
        .run();
    } else {
      db.insert(schema.kpiValues).values({
        submissionId: submission.id,
        firmId: company.firmId,
        companyId: company.id,
        periodId: period.id,
        kpiDefinitionId: kpiDefId,
        actualNumber: numVal,
        actualText: textVal,
        note,
        ragOverride,
        ragOverrideReason,
      }).run();
    }
  }

  // Save submission-level note
  db.update(schema.submissions)
    .set({ lastUpdatedAt: now, note: submissionNote ?? null })
    .where(eq(schema.submissions.id, submission.id))
    .run();

  if (action === "submit") {
    const submissionMonth = parseInt(period.periodStart.slice(5, 7), 10);

    // Load company cadence overrides to determine effective cadence per KPI
    const cadenceOverrides = db
      .select()
      .from(schema.kpiCadenceOverrides)
      .where(eq(schema.kpiCadenceOverrides.companyId, company.id))
      .all();
    const cadenceOverrideMap = Object.fromEntries(cadenceOverrides.map((o) => [o.kpiDefinitionId, o.collectionCadence]));

    function isKpiDue(def: schema.KpiDefinition): boolean {
      if ((def as any).companyId !== null) return true; // custom KPIs always due
      const cadence = cadenceOverrideMap[def.id] ?? ((def as any).collectionCadence ?? "monthly");
      if (cadence === "weekly" || cadence === "monthly") return true;
      if (cadence === "quarterly") return submissionMonth % 3 === 0;
      if (cadence === "bi-annual") return submissionMonth === 6 || submissionMonth === 12;
      if (cadence === "annual") return submissionMonth === 12;
      return true;
    }

    const kpiDefs = db
      .select()
      .from(schema.kpiDefinitions)
      .where(
        and(
          eq(schema.kpiDefinitions.firmId, company.firmId),
          eq(schema.kpiDefinitions.isRequired, true),
          eq(schema.kpiDefinitions.active, true)
        )
      )
      .all()
      .filter((d) => d.companyId === null || d.companyId === company.id)
      .filter(isKpiDue); // only validate KPIs due this period

    for (const def of kpiDefs) {
      const val = db
        .select()
        .from(schema.kpiValues)
        .where(
          and(
            eq(schema.kpiValues.submissionId, submission.id),
            eq(schema.kpiValues.kpiDefinitionId, def.id)
          )
        )
        .get();
      if (!val || (val.actualNumber === null && !val.actualText)) {
        throw new Error(`Required KPI "${def.label}" is missing.`);
      }
    }

    db.update(schema.submissions)
      .set({ status: "submitted", submittedAt: now, lastUpdatedAt: now })
      .where(eq(schema.submissions.id, submission.id))
      .run();

    // Send submission notification
    const emailConfig = db
      .select()
      .from(schema.emailSettings)
      .where(eq(schema.emailSettings.firmId, company.firmId))
      .get() ?? null;

    const firmRecipients = emailConfig?.submissionNotificationRecipients
      ?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
    const companyCc = ((company as any).submissionCcEmails ?? "")
      .split(",").map((e: string) => e.trim()).filter(Boolean);
    const recipients = [...new Set([...firmRecipients, ...companyCc])];

    if (recipients.length > 0) {
      await sendSubmissionNotificationEmail({
        to: recipients,
        companyName: company.name,
        period: period.periodStart,
        submissionTime: now,
        isResubmission,
        settings: emailConfig,
      });
    }

    // ─── RAG alerts ───────────────────────────────────────────────────────────
    if ((emailConfig as any)?.ragAlertEnabled) {
      const alertRecipients = ((emailConfig as any).ragAlertRecipients ?? "")
        .split(",").map((e: string) => e.trim()).filter(Boolean);
      const companyCcAlerts = ((company as any).alertCcEmails ?? "")
        .split(",").map((e: string) => e.trim()).filter(Boolean);
      const alertToList = [...new Set([...alertRecipients, ...companyCcAlerts])];

      if (alertToList.length > 0) {
        const fiscalYear = parseInt(period.periodStart.slice(0, 4));
        const activePlan = db
          .select()
          .from(schema.kpiPlans)
          .where(
            and(
              eq(schema.kpiPlans.companyId, company.id),
              eq(schema.kpiPlans.fiscalYear, fiscalYear)
            )
          )
          .orderBy(desc(schema.kpiPlans.version))
          .get();

        if (activePlan) {
          const planValues = db
            .select()
            .from(schema.kpiPlanValues)
            .where(eq(schema.kpiPlanValues.planId, activePlan.id))
            .all();
          const planValueByKpiId: Record<string, number | null> = Object.fromEntries(
            planValues.map((pv) => [pv.kpiDefinitionId, pv.value])
          );

          const allKpiDefs = db
            .select()
            .from(schema.kpiDefinitions)
            .where(
              and(
                eq(schema.kpiDefinitions.firmId, company.firmId),
                eq(schema.kpiDefinitions.active, true)
              )
            )
            .all()
            .filter((d) => d.companyId === null || d.companyId === company.id);
          const kpiDefById = Object.fromEntries(allKpiDefs.map((d) => [d.id, d]));

          const companyAlertOverrides = db
            .select()
            .from(schema.kpiAlertOverrides)
            .where(
              and(
                eq(schema.kpiAlertOverrides.companyId, company.id),
                eq(schema.kpiAlertOverrides.firmId, company.firmId)
              )
            )
            .all();
          const alertOverrideByKpiId = Object.fromEntries(
            companyAlertOverrides.map((o) => [o.kpiDefinitionId, o])
          );

          const submittedKpiValues = db
            .select()
            .from(schema.kpiValues)
            .where(eq(schema.kpiValues.submissionId, submission.id))
            .all();

          const issues: Array<{ kpiLabel: string; ragStatus: "amber" | "red"; variancePct: number }> = [];

          for (const kv of submittedKpiValues) {
            if (kv.actualNumber === null) continue;
            const def = kpiDefById[kv.kpiDefinitionId];
            if (!def) continue;
            if (!["currency", "percent", "integer"].includes(def.valueType)) continue;

            const planVal = planValueByKpiId[kv.kpiDefinitionId];
            if (planVal == null || planVal === 0) continue;

            const ragStatus = computeRagPct(kv.actualNumber, planVal, def.ragGreenPct, def.ragAmberPct, def.ragDirection);
            if (!ragStatus || ragStatus === "green") continue;

            const override = alertOverrideByKpiId[kv.kpiDefinitionId];
            const alertOnAmber = override ? override.ragAlertOnAmber : ((def as any).ragAlertOnAmber ?? true);
            const alertOnRed = override ? override.ragAlertOnRed : ((def as any).ragAlertOnRed ?? true);

            if (ragStatus === "amber" && !alertOnAmber) continue;
            if (ragStatus === "red" && !alertOnRed) continue;

            const rawPct = ((kv.actualNumber - planVal) / Math.abs(planVal)) * 100;
            const signedPct = def.ragDirection === "any_variance" ? -Math.abs(rawPct) : def.ragDirection === "lower_is_better" ? -rawPct : rawPct;

            issues.push({ kpiLabel: def.label, ragStatus, variancePct: signedPct });
          }

          if (issues.length > 0) {
            await sendRagAlertEmail({
              to: alertToList,
              companyName: company.name,
              period: period.periodStart,
              issues,
              settings: emailConfig,
            });
          }
        }
      }
    }
  }

  return { success: true, action };
}

export async function deleteSubmissionDraftAction(token: string, submissionId: string) {
  const company = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.submissionToken, token))
    .get();
  if (!company) throw new Error("Invalid token");

  // Only allow deleting drafts, not submitted submissions
  const sub = db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.id, submissionId), eq(schema.submissions.companyId, company.id)))
    .get();
  if (!sub || sub.status === "submitted") throw new Error("Cannot delete this submission");

  db.delete(schema.kpiValues).where(eq(schema.kpiValues.submissionId, submissionId)).run();
  db.delete(schema.submissions).where(eq(schema.submissions.id, submissionId)).run();
}

export async function updateCombinedStatementsAction(
  documentId: string,
  statements: string[]
) {
  db.update(schema.financialDocuments)
    .set({ includedStatements: statements.join(",") })
    .where(eq(schema.financialDocuments.id, documentId))
    .run();
}
