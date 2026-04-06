import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

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

  const doc = db
    .select()
    .from(schema.financialDocuments)
    .where(eq(schema.financialDocuments.id, id))
    .get();

  if (!doc) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Verify the submission belongs to the user's firm
  const submission = db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, doc.submissionId))
    .get();

  if (!submission || submission.firmId !== user.firmId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const uploadsRoot = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
  // Legacy seed paths are stored as "uploads/..." relative to cwd; real uploads are relative to uploadsRoot
  const absPath = doc.filePath.startsWith("uploads/")
    ? path.join(process.cwd(), doc.filePath)
    : path.join(uploadsRoot, doc.filePath);

  if (!fs.existsSync(absPath)) {
    return new NextResponse("File not found on disk", { status: 404 });
  }

  const fileBuffer = fs.readFileSync(absPath);
  const ext = path.extname(doc.fileName).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  const contentType = contentTypeMap[ext] ?? "application/octet-stream";

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${doc.fileName}"`,
    },
  });
}
