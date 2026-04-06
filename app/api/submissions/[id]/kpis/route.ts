import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const user = session.user as any;

  const { id } = await params;

  const submission = db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, id))
    .get();

  if (!submission || submission.firmId !== user.firmId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const company = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, submission.companyId))
    .get();

  const period = db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.id, submission.periodId))
    .get();

  const kpiValues = db
    .select()
    .from(schema.kpiValues)
    .where(eq(schema.kpiValues.submissionId, id))
    .all();

  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(
      and(
        eq(schema.kpiDefinitions.firmId, submission.firmId),
        eq(schema.kpiDefinitions.active, true)
      )
    )
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all();

  const defMap = Object.fromEntries(kpiDefs.map((d) => [d.id, d]));

  const periodLabel = period
    ? `${period.periodStart.slice(0, 7)}`
    : submission.periodId;
  const companyName = company?.name ?? submission.companyId;

  const rows = kpiValues.map((v) => {
    const def = defMap[v.kpiDefinitionId];
    return [
      companyName,
      periodLabel,
      def?.label ?? v.kpiDefinitionId,
      def?.unit ?? "",
      v.actualNumber ?? "",
      v.note ?? "",
    ];
  });

  const header = ["Company", "Period", "KPI", "Unit", "Value", "Note"];
  const csvLines = [header, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
  );
  const csv = csvLines.join("\r\n");

  const fileName = `${periodLabel}_kpis_agreed.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
