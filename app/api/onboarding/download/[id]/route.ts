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
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  const user = session.user as any;

  const { id } = await params;

  const doc = db
    .select()
    .from(schema.onboardingDocuments)
    .where(eq(schema.onboardingDocuments.id, id))
    .get();

  if (!doc) return new NextResponse("Not found", { status: 404 });
  if (doc.firmId !== user.firmId) return new NextResponse("Forbidden", { status: 403 });
  if (!doc.filePath) return new NextResponse("File not stored on disk", { status: 404 });

  const uploadsRoot = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
  const absPath = path.join(uploadsRoot, doc.filePath);

  if (!fs.existsSync(absPath)) return new NextResponse("File not found on disk", { status: 404 });

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
