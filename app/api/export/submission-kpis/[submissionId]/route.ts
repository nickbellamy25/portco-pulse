import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  const user = session.user as any;

  const { submissionId } = await params;

  const sub = db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, submissionId))
    .get();

  if (!sub || sub.firmId !== user.firmId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const period = db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.id, sub.periodId))
    .get();

  const company = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, sub.companyId))
    .get();

  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, user.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === sub.companyId);

  const kpiValues = db
    .select()
    .from(schema.kpiValues)
    .where(eq(schema.kpiValues.submissionId, submissionId))
    .all();

  const periodLabel = period ? period.periodStart.slice(0, 7) : "unknown";
  const companyName = company ? company.name.replace(/[^a-z0-9]/gi, "-").toLowerCase() : "unknown";

  const headers = ["KPI", "Unit", "Actual"];
  const rows: string[][] = [headers];

  for (const def of kpiDefs) {
    const val = kpiValues.find((v) => v.kpiDefinitionId === def.id);
    rows.push([
      def.label,
      def.unit ?? "",
      val ? String(val.actualNumber ?? val.actualText ?? "") : "",
    ]);
  }

  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${periodLabel}_kpis_agreed.csv"`,
    },
  });
}
