import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendMonthlyDigestEmail } from "@/lib/server/email";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Digest covers the previous calendar month
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodPrefix = prevMonth.toISOString().slice(0, 7); // e.g. "2026-02"
  const monthYear = prevMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const firms = db.select().from(schema.firms).all();
  const results: { firmId: string; status: string }[] = [];

  for (const firm of firms) {
    const settings = db
      .select()
      .from(schema.emailSettings)
      .where(eq(schema.emailSettings.firmId, firm.id))
      .get();

    if (!settings?.monthlyDigestEnabled) continue;

    const recipients = (settings.monthlyDigestRecipients ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    if (!recipients.length) continue;

    // Find the period matching the previous month
    const period = db
      .select()
      .from(schema.periods)
      .where(and(eq(schema.periods.firmId, firm.id)))
      .orderBy(desc(schema.periods.periodStart))
      .all()
      .find((p) => p.periodStart.startsWith(periodPrefix));

    const companies = db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.firmId, firm.id), eq(schema.companies.status, "current")))
      .all();

    const totalCompanies = companies.length;

    let submittedCount = 0;
    if (period) {
      const submissions = db
        .select()
        .from(schema.submissions)
        .where(and(eq(schema.submissions.firmId, firm.id), eq(schema.submissions.periodId, period.id)))
        .all();
      submittedCount = submissions.filter((s) => s.status === "submitted").length;
    }

    const activeAlerts = db
      .select()
      .from(schema.alerts)
      .where(and(eq(schema.alerts.firmId, firm.id), eq(schema.alerts.status, "active")))
      .all().length;

    await sendMonthlyDigestEmail({
      to: recipients,
      monthYear,
      totalCompanies,
      submittedCount,
      activeAlerts,
      settings,
    });

    results.push({ firmId: firm.id, status: "sent" });
  }

  return NextResponse.json({ ok: true, results });
}
