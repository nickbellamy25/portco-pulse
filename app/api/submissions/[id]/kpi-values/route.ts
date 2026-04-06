/**
 * GET /api/submissions/[id]/kpi-values
 * Returns KPI values for a specific submission version as JSON.
 * Used by the analytics version selector overlay.
 */

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
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const user = session.user as any;

  const { id } = await params;

  const submission = db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, id))
    .get();

  if (!submission || submission.firmId !== user.firmId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

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
    .all()
    .filter((d) => d.companyId === null || d.companyId === submission.companyId);

  const defMap = Object.fromEntries(kpiDefs.map((d) => [d.id, d]));

  const values = kpiValues.map((v) => {
    const def = defMap[v.kpiDefinitionId];
    return {
      kpiKey: def?.key ?? v.kpiDefinitionId,
      kpiLabel: def?.label ?? v.kpiDefinitionId,
      unit: def?.unit ?? null,
      valueType: def?.valueType ?? null,
      actual: v.actualNumber ?? null,
      note: v.note ?? null,
    };
  });

  return NextResponse.json({
    submissionId: id,
    version: submission.version,
    submittedAt: submission.submittedAt ?? null,
    note: submission.note ?? null,
    values,
  });
}
