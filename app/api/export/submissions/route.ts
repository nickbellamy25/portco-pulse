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
  const periodId = searchParams.get("periodId");
  if (!periodId) return NextResponse.json({ error: "Missing periodId" }, { status: 400 });

  const companies = db.select().from(schema.companies).where(eq(schema.companies.firmId, user.firmId)).all();

  const headers = ["Company", "Industry", "Status", "KPIs", "Balance Sheet", "Income Statement", "Cash Flow", "Investor Update", "Submitted By", "Date"];
  const rows: string[][] = [headers];

  for (const company of companies) {
    const sub = db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.companyId, company.id), eq(schema.submissions.periodId, periodId)))
      .get();

    const docs = sub
      ? db.select().from(schema.financialDocuments).where(eq(schema.financialDocuments.submissionId, sub.id)).all()
      : [];

    const hasDoc = (type: string) => docs.some((d) => d.documentType === type) ? "Yes" : "No";

    let submittedBy = "";
    if (sub?.submittedByUserId) {
      const u = db.select().from(schema.users).where(eq(schema.users.id, sub.submittedByUserId)).get();
      submittedBy = u?.name ?? u?.email ?? "";
    }

    rows.push([
      company.name,
      (company as any).industry ?? "",
      sub?.status ?? "missing",
      sub?.status === "submitted" ? "Yes" : "No",
      hasDoc("balance_sheet"),
      hasDoc("income_statement"),
      hasDoc("cash_flow_statement"),
      hasDoc("investor_update"),
      submittedBy,
      sub?.submittedAt ? format(new Date(sub.submittedAt), "MM/dd/yyyy") : "",
    ]);
  }

  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="submission-tracking.csv"`,
    },
  });
}
