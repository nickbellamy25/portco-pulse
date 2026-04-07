/**
 * GET /api/submissions/outstanding
 * Returns companies broken down by no-submission vs partial for the most recent period.
 * Investor persona only.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc, ne } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  const user = session?.user as any;

  if (!user || user.persona !== "investor") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const firmId: string = user.firmId;

  // Most recent period for this firm
  const period = db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.firmId, firmId))
    .orderBy(desc(schema.periods.periodStart))
    .limit(1)
    .get();

  if (!period) {
    return NextResponse.json({ periodId: null, period: null, noSubmission: [], partial: [] });
  }

  // All active (non-exited) companies for this firm
  const allCompanies = db
    .select()
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.firmId, firmId),
        ne(schema.companies.status, "exited")
      )
    )
    .all();

  const noSubmission: Array<{ companyId: string; companyName: string }> = [];
  const partial: Array<{ companyId: string; companyName: string }> = [];

  for (const company of allCompanies) {
    const sub = db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.companyId, company.id),
          eq(schema.submissions.periodId, period.id)
        )
      )
      .get();

    if (!sub) {
      noSubmission.push({ companyId: company.id, companyName: company.name });
    } else if (sub.status !== "submitted") {
      partial.push({ companyId: company.id, companyName: company.name });
    }
  }

  // Format period label as "Month YYYY"
  const periodStart = period.periodStart;
  const [year, month] = periodStart.split("-");
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const periodLabel = `${monthNames[parseInt(month, 10) - 1]} ${year}`;

  return NextResponse.json({
    periodId: period.id,
    period: periodLabel,
    noSubmission,
    partial,
  });
}
