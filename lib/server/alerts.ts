import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { sendThresholdBreachEmail } from "@/lib/server/email";

export async function evaluateAlerts(submissionId: string, firmId: string) {
  const submission = db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, submissionId))
    .get();
  if (!submission) return;

  const company = db.select().from(schema.companies).where(eq(schema.companies.id, submission.companyId)).get();
  const emailConfig = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, firmId)).get() ?? null;

  // Build threshold alert recipient list: firm-wide + company-specific CC
  const firmAlertRecipients = emailConfig?.thresholdAlertRecipients
    ?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
  const companyCcRecipients = ((company as any)?.alertCcEmails ?? "")
    .split(",").map((e: string) => e.trim()).filter(Boolean);
  const alertRecipients = [...new Set([...firmAlertRecipients, ...companyCcRecipients])];

  const kpiValues = db
    .select()
    .from(schema.kpiValues)
    .where(eq(schema.kpiValues.submissionId, submissionId))
    .all();

  // Get applicable threshold rules (company-specific first, then firm-level)
  const companyRules = db
    .select()
    .from(schema.thresholdRules)
    .where(
      and(
        eq(schema.thresholdRules.firmId, firmId),
        eq(schema.thresholdRules.companyId, submission.companyId),
        eq(schema.thresholdRules.active, true)
      )
    )
    .all();

  const firmRules = db
    .select()
    .from(schema.thresholdRules)
    .where(
      and(
        eq(schema.thresholdRules.firmId, firmId),
        isNull(schema.thresholdRules.companyId),
        eq(schema.thresholdRules.active, true)
      )
    )
    .all();

  // Build effective rules: company overrides firm
  const effectiveRules = new Map<string, schema.ThresholdRule>();
  for (const r of firmRules) {
    effectiveRules.set(r.kpiDefinitionId, r);
  }
  for (const r of companyRules) {
    effectiveRules.set(r.kpiDefinitionId, r);
  }

  for (const [kpiDefId, rule] of effectiveRules) {
    const kv = kpiValues.find((v) => v.kpiDefinitionId === kpiDefId);
    if (!kv || kv.actualNumber === null || kv.actualNumber === undefined) continue;

    const actual = kv.actualNumber;
    let breached = false;
    if (rule.ruleType === "lt" && actual < rule.thresholdValue) breached = true;
    if (rule.ruleType === "lte" && actual <= rule.thresholdValue) breached = true;
    if (rule.ruleType === "gt" && actual > rule.thresholdValue) breached = true;
    if (rule.ruleType === "gte" && actual >= rule.thresholdValue) breached = true;

    const kpiDef = db
      .select()
      .from(schema.kpiDefinitions)
      .where(eq(schema.kpiDefinitions.id, kpiDefId))
      .get();

    const label = kpiDef?.label ?? "KPI";
    const valueType = kpiDef?.valueType ?? "number";
    const fmt = (n: number) =>
      valueType === "currency"
        ? `$${Math.abs(n).toLocaleString()}${n < 0 ? " (negative)" : ""}`
        : valueType === "percent"
        ? `${n}%`
        : n.toLocaleString();
    const ruleLabel: Record<string, string> = { lt: "below", lte: "at or below", gt: "above", gte: "at or above" };
    const message = breached
      ? `${label} ${ruleLabel[rule.ruleType] ?? rule.ruleType} ${fmt(rule.thresholdValue)} · Actual: ${fmt(actual)}`
      : `Resolved: ${label} within threshold`;

    // Upsert alert
    const existing = db
      .select()
      .from(schema.alerts)
      .where(
        and(
          eq(schema.alerts.submissionId, submissionId),
          eq(schema.alerts.kpiDefinitionId, kpiDefId)
        )
      )
      .get();

    if (existing) {
      db.update(schema.alerts)
        .set({
          status: breached ? "active" : "resolved",
          severity: rule.severity,
          message,
        })
        .where(eq(schema.alerts.id, existing.id))
        .run();
    } else if (breached) {
      db.insert(schema.alerts).values({
        firmId,
        companyId: submission.companyId,
        periodId: submission.periodId,
        submissionId,
        kpiDefinitionId: kpiDefId,
        severity: rule.severity,
        message,
        status: "active",
      }).run();
    }

    // Send threshold breach email on new or re-triggered breach
    if (breached && alertRecipients.length > 0 && company) {
      const period = db.select().from(schema.periods).where(eq(schema.periods.id, submission.periodId)).get();
      await sendThresholdBreachEmail({
        to: alertRecipients,
        companyName: company.name,
        kpiLabel: label,
        actual: fmt(actual),
        thresholdValue: fmt(rule.thresholdValue),
        ruleType: rule.ruleType,
        severity: rule.severity,
        period: period?.periodStart?.slice(0, 7) ?? "",
        settings: emailConfig,
      });
    }
  }
}
