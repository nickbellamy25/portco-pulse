import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  const user = session.user as any;

  const { planId } = await params;

  const plan = db
    .select()
    .from(schema.kpiPlans)
    .where(eq(schema.kpiPlans.id, planId))
    .get();

  if (!plan) return new NextResponse("Not found", { status: 404 });

  // Verify the plan's company belongs to this firm
  const company = db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, plan.companyId), eq(schema.companies.firmId, user.firmId)))
    .get();

  if (!company) return new NextResponse("Forbidden", { status: 403 });

  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, user.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === plan.companyId)
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

  const planValues = db
    .select()
    .from(schema.kpiPlanValues)
    .where(eq(schema.kpiPlanValues.planId, planId))
    .all();

  // Monthly granularity — one column per month; annual = single Target column
  const hasMonthly = planValues.some((v) => v.periodMonth !== null);

  const headers = hasMonthly
    ? ["KPI", "Unit", ...MONTHS, "Annual Total"]
    : ["KPI", "Unit", "Annual Target"];
  const rows: string[][] = [headers];

  for (const def of kpiDefs) {
    const defVals = planValues.filter((v) => v.kpiDefinitionId === def.id);
    if (!defVals.length) continue;

    if (hasMonthly) {
      const monthMap: Record<number, number | null> = {};
      let annualVal: number | null = null;
      for (const v of defVals) {
        if (v.periodMonth !== null) monthMap[v.periodMonth] = v.value ?? null;
        else annualVal = v.value ?? null;
      }
      const monthlyNums = Array.from({ length: 12 }, (_, i) => monthMap[i + 1] ?? null);
      const total = annualVal ?? (monthlyNums.every((v) => v === null) ? null : monthlyNums.reduce((s, v) => (s ?? 0) + (v ?? 0), null as number | null));
      rows.push([
        def.label,
        def.unit ?? "",
        ...monthlyNums.map((v) => (v === null ? "" : String(v))),
        total === null ? "" : String(total),
      ]);
    } else {
      const annualVal = defVals.find((v) => v.periodMonth === null);
      rows.push([def.label, def.unit ?? "", annualVal ? String(annualVal.value ?? "") : ""]);
    }
  }

  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${plan.fiscalYear}_plan_kpis.csv"`,
    },
  });
}
