import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendPlanReminderEmail } from "@/lib/server/email";

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

    const daysBeforeDue = (settings as any).planReminderDaysBeforeDue ?? 30;
    const planDueMonth = settings.planDueMonth ?? 1;
    const planDueDay = settings.planDueDay ?? 31;

    // Find the next upcoming plan due date (this year or next year)
    const thisYear = today.getFullYear();
    let fiscalYear = thisYear;
    let planDue = new Date(`${thisYear}-${String(planDueMonth).padStart(2, "0")}-${String(planDueDay).padStart(2, "0")}T12:00:00`);
    planDue.setHours(0, 0, 0, 0);

    if (planDue <= today) {
      fiscalYear = thisYear + 1;
      planDue = new Date(`${thisYear + 1}-${String(planDueMonth).padStart(2, "0")}-${String(planDueDay).padStart(2, "0")}T12:00:00`);
      planDue.setHours(0, 0, 0, 0);
    }

    const reminderDate = new Date(planDue);
    reminderDate.setDate(reminderDate.getDate() - daysBeforeDue);

    if (reminderDate.getTime() !== today.getTime()) continue;

    const dueDateStr = `${fiscalYear}-${String(planDueMonth).padStart(2, "0")}-${String(planDueDay).padStart(2, "0")}`;

    const companies = db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.firmId, firm.id), eq(schema.companies.status, "current")))
      .all();

    let sent = 0;

    for (const company of companies) {
      // Skip if a plan already exists for this fiscal year
      const existingPlan = db
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

      if (existingPlan?.submittedAt) continue; // already submitted

      // Get operator emails
      const operators = db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.firmId, firm.id), eq(schema.users.companyId, company.id)))
        .all();

      const firmRecipients = ((settings as any).submissionReminderRecipients ?? "")
        .split(",").map((e: string) => e.trim()).filter(Boolean);
      const allEmails = Array.from(new Set([...operators.map((u) => u.email), ...firmRecipients]));
      if (!allEmails.length) continue;

      const planLink = `${process.env.NEXT_PUBLIC_APP_URL}/plan/${company.submissionToken}?year=${fiscalYear}`;

      await sendPlanReminderEmail({
        to: allEmails,
        companyName: company.name,
        fiscalYear,
        dueDate: dueDateStr,
        planLink,
        settings,
      });
      sent++;
    }

    results.push({ firmId: firm.id, status: `sent ${sent} plan reminders for FY${fiscalYear}` });
  }

  return NextResponse.json({ ok: true, results });
}
