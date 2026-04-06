import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendReminderEmail } from "@/lib/server/email";

function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firms = db.select().from(schema.firms).all();
  const results: { firmId: string; status: string }[] = [];

  for (const firm of firms) {
    const settings = db
      .select()
      .from(schema.emailSettings)
      .where(eq(schema.emailSettings.firmId, firm.id))
      .get();

    if (!settings?.submissionReminderEnabled) continue;

    const daysBeforeDue = settings.reminderDaysBeforeDue ?? 3;

    const period = db
      .select()
      .from(schema.periods)
      .where(eq(schema.periods.firmId, firm.id))
      .orderBy(desc(schema.periods.periodStart))
      .get();

    if (!period?.dueDate) continue;

    const dueDate = new Date(`${period.dueDate}T12:00:00`);
    dueDate.setHours(0, 0, 0, 0);
    const businessDaysUntilDue = businessDaysBetween(today, dueDate);

    if (businessDaysUntilDue !== daysBeforeDue) continue;

    // Send reminders to all non-submitted companies for this firm/period
    const companies = db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.firmId, firm.id), eq(schema.companies.status, "current")))
      .all();

    const DOC_LABELS: Record<string, string> = {
      balance_sheet: "Balance Sheet",
      income_statement: "Income Statement",
      cash_flow_statement: "Cash Flow Statement",
      investor_update: "Investor Update",
    };

    let sent = 0;
    for (const company of companies) {
      const sub = db
        .select()
        .from(schema.submissions)
        .where(and(eq(schema.submissions.companyId, company.id), eq(schema.submissions.periodId, period.id)))
        .get();

      if (sub?.status === "submitted") continue;

      const requiredDocs = (company.requiredDocs ?? "").split(",").filter(Boolean);
      let missingDocs: string[];
      if (!sub) {
        missingDocs = requiredDocs.map((d) => DOC_LABELS[d] ?? d);
      } else {
        const docs = db.select().from(schema.financialDocuments).where(eq(schema.financialDocuments.submissionId, sub.id)).all();
        const uploadedTypes = new Set(docs.map((d) => d.documentType));
        missingDocs = requiredDocs.filter((d) => !uploadedTypes.has(d as any)).map((d) => DOC_LABELS[d] ?? d);
        if (!(sub as any).kpisSubmitted) missingDocs.unshift("KPI Data");
      }

      const operators = db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.firmId, firm.id), eq(schema.users.companyId, company.id)))
        .all();

      const firmRecipients = ((settings as any).submissionReminderRecipients ?? "")
        .split(",").map((e: string) => e.trim()).filter(Boolean);
      const allEmails = Array.from(new Set([...operators.map((u) => u.email), ...firmRecipients]));
      if (!allEmails.length) continue;

      await sendReminderEmail({
        to: allEmails,
        companyName: company.name,
        period: period.periodStart.slice(0, 7),
        dueDate: period.dueDate,
        submissionLink: `${process.env.NEXT_PUBLIC_APP_URL}/submit/${company.submissionToken}`,
        missingDocs,
        settings,
      });
      sent++;
    }

    results.push({ firmId: firm.id, status: `sent ${sent} reminders` });
  }

  return NextResponse.json({ ok: true, results });
}
