import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { format } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user as any;

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

  const company = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!company || company.firmId !== user.firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, user.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === companyId);

  const periods = db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.firmId, user.firmId))
    .orderBy(schema.periods.periodStart)
    .all();

  const headers = ["Period", "Status", ...kpiDefs.map((d) => d.label)];
  const rows: string[][] = [headers];

  for (const period of periods) {
    const sub = db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.companyId, companyId), eq(schema.submissions.periodId, period.id)))
      .get();

    if (!sub) continue;

    const vals = db
      .select()
      .from(schema.kpiValues)
      .where(eq(schema.kpiValues.submissionId, sub.id))
      .all();

    rows.push([
      format(new Date(period.periodStart + "T12:00:00"), "yyyy-MM"),
      sub.status,
      ...kpiDefs.map((d) => {
        const v = vals.find((val) => val.kpiDefinitionId === d.id);
        return v ? String(v.actualNumber ?? v.actualText ?? "") : "";
      }),
    ]);
  }

  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const safeName = company.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${safeName}-kpi-export-${format(new Date(), "yyyy-MM-dd")}.csv"`,
    },
  });
}
