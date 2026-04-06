import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, max, desc } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const docType = formData.get("docType") as string | null;
    const token = formData.get("token") as string | null;
    const periodId = formData.get("periodId") as string | null;
    const includedStatements = formData.get("includedStatements") as string | null;

    if (!file || !docType || !token) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 25MB limit" }, { status: 400 });
    }

    const validDocTypes = [
      "balance_sheet",
      "income_statement",
      "cash_flow_statement",
      "combined_financials",
      "investor_update",
    ];
    if (!validDocTypes.includes(docType)) {
      return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }

    // Verify company by token
    const company = db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.submissionToken, token))
      .get();
    if (!company) {
      return NextResponse.json({ error: "Invalid token" }, { status: 403 });
    }

    // Get requested period or latest open
    let period;
    if (periodId) {
      period = db
        .select()
        .from(schema.periods)
        .where(and(eq(schema.periods.id, periodId), eq(schema.periods.firmId, company.firmId)))
        .get();
    }
    if (!period) {
      period = db
        .select()
        .from(schema.periods)
        .where(eq(schema.periods.firmId, company.firmId))
        .orderBy(desc(schema.periods.periodStart))
        .get();
    }
    if (!period) {
      return NextResponse.json({ error: "No period found" }, { status: 400 });
    }

    // Get or create submission
    let submission = db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.companyId, company.id),
          eq(schema.submissions.periodId, period.id)
        )
      )
      .get();

    if (!submission) {
      const newId = crypto.randomUUID();
      db.insert(schema.submissions).values({
        id: newId,
        firmId: company.firmId,
        companyId: company.id,
        periodId: period.id,
        status: "draft",
        lastUpdatedAt: new Date().toISOString(),
      }).run();
      submission = db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, newId))
        .get()!;
    }

    // Compute version
    const maxVersionRow = db
      .select({ maxVersion: max(schema.financialDocuments.version) })
      .from(schema.financialDocuments)
      .where(
        and(
          eq(schema.financialDocuments.submissionId, submission.id),
          eq(schema.financialDocuments.documentType, docType as any)
        )
      )
      .get();
    const nextVersion = (maxVersionRow?.maxVersion ?? 0) + 1;

    // Store file locally
    const fileId = crypto.randomUUID();
    const ext = path.extname(file.name);
    const safeFileName = `${fileId}${ext}`;
    const relPath = `${company.firmId}/${company.id}/${period.id}/documents/${safeFileName}`;
    const uploadsRoot = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
    const absDir = path.join(uploadsRoot, company.firmId, company.id, period.id, "documents");
    const absPath = path.join(absDir, safeFileName);

    await mkdir(absDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(absPath, buffer);

    // Insert DB record
    const docId = crypto.randomUUID();
    db.insert(schema.financialDocuments).values({
      id: docId,
      firmId: company.firmId,
      companyId: company.id,
      periodId: period.id,
      submissionId: submission.id,
      documentType: docType as any,
      version: nextVersion,
      fileName: file.name,
      filePath: relPath,
      includedStatements: docType === "combined_financials" ? (includedStatements || null) : null,
    }).run();

    const doc = db
      .select()
      .from(schema.financialDocuments)
      .where(eq(schema.financialDocuments.id, docId))
      .get();

    return NextResponse.json(doc);
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }
}
