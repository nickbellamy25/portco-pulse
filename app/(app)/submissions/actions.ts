"use server";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { sendReminderEmail, sendPlanReminderEmail, sendOnboardingCompleteEmail } from "@/lib/server/email";
import { auth } from "@/lib/auth";

export async function markOnboardingCompleteAction(companyId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as any;
  if (user.persona === "operator") throw new Error("Forbidden");

  const company = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!company) throw new Error("Company not found");

  const firm = db.select().from(schema.firms).where(eq(schema.firms.id, company.firmId)).get();
  const firmName = firm?.name ?? "your firm";

  const operators = db.select().from(schema.users).where(
    and(eq(schema.users.companyId, companyId), eq(schema.users.firmId, company.firmId), eq(schema.users.persona, "operator"))
  ).all();
  const emails = operators.map((u) => u.email).filter(Boolean);
  const emailSettings = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, company.firmId)).get() ?? null;

  db.update(schema.companies)
    .set({
      onboardingStatus: "complete",
      onboardingCompletedAt: new Date().toISOString(),
    } as any)
    .where(eq(schema.companies.id, companyId))
    .run();

  if (emails.length > 0) {
    await sendOnboardingCompleteEmail({
      to: emails,
      companyName: company.name,
      firmName,
      settings: emailSettings,
    });
  }
}

export async function sendRemindersAction(firmId: string, periodId: string, companyId?: string) {
  const period = db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.id, periodId))
    .get();

  if (!period) throw new Error("Period not found");

  const companies = db
    .select()
    .from(schema.companies)
    .where(companyId
      ? and(eq(schema.companies.firmId, firmId), eq(schema.companies.id, companyId))
      : eq(schema.companies.firmId, firmId))
    .all();

  const emailSettings = db
    .select()
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.firmId, firmId))
    .get();

  let sent = 0;
  const errors: string[] = [];

  for (const company of companies) {
    const sub = db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.companyId, company.id),
          eq(schema.submissions.periodId, periodId)
        )
      )
      .get();

    // Skip if already submitted
    if (sub?.status === "submitted") continue;

    // Compute missing docs for this company/period
    const requiredDocs: string[] = (company.requiredDocs ?? "").split(",").filter(Boolean);
    const DOC_LABELS: Record<string, string> = {
      balance_sheet: "Balance Sheet",
      income_statement: "Income Statement",
      cash_flow_statement: "Cash Flow Statement",
      investor_update: "Investor Update",
    };
    let missingDocs: string[] = [];
    if (!sub) {
      // No submission at all — all required docs are missing
      missingDocs = requiredDocs.map((d) => DOC_LABELS[d] ?? d);
    } else {
      // Partial — check which docs are missing
      const docs = db.select().from(schema.financialDocuments)
        .where(eq(schema.financialDocuments.submissionId, sub.id))
        .all();
      const uploadedTypes = new Set(docs.map((d) => d.documentType));
      missingDocs = requiredDocs
        .filter((d) => !uploadedTypes.has(d as any))
        .map((d) => DOC_LABELS[d] ?? d);
      // Also flag if KPIs not submitted
      if (!(sub as any).kpisSubmitted) missingDocs.unshift("KPI Data");
    }

    // Find company operators to email (persona filter prevents firm admins from leaking in)
    const operators = db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.firmId, firmId),
          eq(schema.users.companyId, company.id),
          eq(schema.users.persona, "operator")
        )
      )
      .all();

    const emails = operators.map((u) => u.email).filter(Boolean);
    const operatorUserIds = operators.map((u) => u.id);

    if (emails.length === 0) continue;

    try {
      await sendReminderEmail({
        to: emails,
        companyName: company.name,
        period: period.periodStart.slice(0, 7),
        dueDate: period.dueDate ?? "—",
        submissionLink: `${process.env.NEXT_PUBLIC_APP_URL}/submit/${company.submissionToken}`,
        missingDocs,
        settings: emailSettings ?? null,
        firmId,
        companyId: company.id,
        operatorUserIds,
      });
      sent++;
    } catch (e) {
      errors.push(company.name);
    }
  }

  if (errors.length > 0) {
    return {
      message: `Sent ${sent} reminders. Failed for: ${errors.join(", ")}. Check email configuration.`,
    };
  }
  return { message: `Reminder emails sent to ${sent} companies.` };
}

export async function sendPlanRemindersAction(
  firmId: string,
  fiscalYear: number,
  planDueDate: string,
  companyId?: string
) {
  const companies = db
    .select()
    .from(schema.companies)
    .where(
      companyId
        ? and(eq(schema.companies.firmId, firmId), eq(schema.companies.id, companyId))
        : eq(schema.companies.firmId, firmId)
    )
    .all();

  const emailSettings = db
    .select()
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.firmId, firmId))
    .get();

  let sent = 0;
  const errors: string[] = [];

  for (const company of companies) {
    const operators = db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.firmId, firmId),
          eq(schema.users.companyId, company.id),
          eq(schema.users.persona, "operator")
        )
      )
      .all();

    const emails = operators.map((u) => u.email).filter(Boolean);
    if (emails.length === 0) continue;

    try {
      await sendPlanReminderEmail({
        to: emails,
        companyName: company.name,
        fiscalYear,
        dueDate: planDueDate,
        planLink: `${process.env.NEXT_PUBLIC_APP_URL}/plan/${company.submissionToken}`,
        settings: emailSettings ?? null,
      });
      sent++;
    } catch {
      errors.push(company.name);
    }
  }

  if (errors.length > 0) {
    return {
      message: `Sent ${sent} plan reminders. Failed for: ${errors.join(", ")}. Check email configuration.`,
    };
  }
  return { message: `Plan reminder emails sent to ${sent} companies.` };
}
