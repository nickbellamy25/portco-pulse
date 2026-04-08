import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_IMAGE_DIMENSION = 1568;

const SUPPORTED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "docx",
  "image/jpeg": "image",
  "image/png": "image",
  "image/tiff": "image",
  "image/webp": "image",
};

export interface UploadResult {
  fileName: string;
  mimeType: string;
  extractedText?: string;
  imageBase64?: string;
  imageMediaType?: string;
  extractionMethod: string;
  pageCount?: number;
  pdfBase64?: string;
  filePath?: string;             // relative path from UPLOADS_DIR root, e.g. "{companyId}/{uuid}-{name}"
  detectedDocumentType?: string; // auto-detected document type for Claude's awareness
  detectedIncludedStatements?: string[]; // for combined files
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const token = formData.get("token") as string | null;
    const bodyCompanyId = formData.get("companyId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "no_file", message: "No file provided." }, { status: 400 });
    }

    // Validate token or companyId
    let company;
    if (token) {
      company = db.select().from(schema.companies).where(eq(schema.companies.submissionToken, token)).get();
    } else if (bodyCompanyId) {
      // Firm-side investor: verify auth + firm ownership
      const session = await auth();
      const user = session?.user as any;
      if (!user || user.persona !== "investor") {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      company = db.select().from(schema.companies).where(
        and(eq(schema.companies.id, bodyCompanyId), eq(schema.companies.firmId, user.firmId))
      ).get();
    }
    if (!company) {
      return NextResponse.json({ error: "invalid_token", message: "Invalid token." }, { status: 401 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "file_too_large", message: "File exceeds 20 MB limit." }, { status: 400 });
    }

    const mimeType = file.type || "application/octet-stream";
    const format = SUPPORTED_TYPES[mimeType];

    if (!format) {
      return NextResponse.json(
        { error: "unsupported_file_type", message: "Please upload a PDF, Excel, CSV, Word, or image file." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name;

    // Save raw file to disk before extraction
    const savedFilePath = saveFileToDisk(buffer, company.id, fileName);

    let result: UploadResult;

    switch (format) {
      case "pdf":
        result = await extractPdf(buffer, fileName);
        break;
      case "xlsx":
        result = extractXlsx(buffer, fileName, mimeType);
        break;
      case "csv":
        result = extractCsv(buffer, fileName, mimeType);
        break;
      case "docx":
        result = await extractDocx(buffer, fileName, mimeType);
        break;
      case "image":
        result = await extractImage(buffer, fileName, mimeType);
        break;
      default:
        return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
    }

    result.filePath = savedFilePath ?? undefined;

    // If company is in onboarding, log this file to onboarding_documents and
    // auto-transition from "pending" → "in_progress" on first upload.
    const onboardingStatus = (company as any).onboarding_status ?? company.onboardingStatus;
    if (onboardingStatus === "pending" || onboardingStatus === "in_progress") {
      db.insert(schema.onboardingDocuments).values({
        firmId: company.firmId,
        companyId: company.id,
        fileName,
        filePath: savedFilePath,
      } as any).run();

      if (onboardingStatus === "pending") {
        db.update(schema.companies)
          .set({ onboardingStatus: "in_progress" } as any)
          .where(eq(schema.companies.id, company.id))
          .run();
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[upload] Error:", err);
    return NextResponse.json({ error: "extraction_failed", message: err.message ?? "Extraction failed." }, { status: 500 });
  }
}

async function extractPdf(buffer: Buffer, fileName: string): Promise<UploadResult> {
  // Try text extraction first
  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const data = await pdfParse(buffer);
    const text = data.text?.trim() ?? "";

    if (text.length > 100) {
      // Good text extraction
      const { primary, included } = detectDocumentTypes(text);
      return {
        fileName,
        mimeType: "application/pdf",
        extractedText: `[Extracted from PDF: ${fileName}, ${data.numpages} pages, detected type: ${primary}]\n\n${text}`,
        extractionMethod: "pdf_text",
        pageCount: data.numpages,
        detectedDocumentType: primary,
        detectedIncludedStatements: included.length > 0 ? included : undefined,
      };
    }
  } catch (_) {
    // fall through to OCR
  }

  // Scanned PDF — send as native PDF document block for Claude vision
  return {
    fileName,
    mimeType: "application/pdf",
    pdfBase64: buffer.toString("base64"),
    extractionMethod: "pdf_document",
  };
}

function extractXlsx(buffer: Buffer, fileName: string, mimeType: string): UploadResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: true });

  const sections: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws, { rawNumbers: false });
    const nonEmpty = csv.split("\n").filter((l: string) => l.replace(/,/g, "").trim().length > 0);
    if (nonEmpty.length < 3) continue;
    sections.push(`=== Sheet: ${sheetName} ===\n${nonEmpty.join("\n")}`);
  }

  const fullText = sections.join("\n\n");

  // Detect doc types from sheet names + content
  const sheetNameHints = wb.SheetNames.join(" ");
  const { primary, included } = detectDocumentTypes(sheetNameHints + "\n" + fullText);

  // Include detected type in prefix (matches PDF format so Claude can act on it)
  const typeNote = primary === "combined_financials"
    ? `combined_financials (${included.join(", ")})`
    : primary;
  const extractedText = sections.length > 0
    ? `[Extracted from Excel: ${fileName}, detected type: ${typeNote}]\n\n${fullText}`
    : `[Excel file ${fileName} appears to be empty or unreadable.]`;

  return {
    fileName,
    mimeType,
    extractedText,
    extractionMethod: "xlsx",
    detectedDocumentType: primary,  // always set (including "financial_document") so detection line and DB fallback work
    detectedIncludedStatements: included.length > 0 ? included : undefined,
  };
}

function extractCsv(buffer: Buffer, fileName: string, mimeType: string): UploadResult {
  const text = buffer.toString("utf-8");
  return {
    fileName,
    mimeType,
    extractedText: `[Extracted from CSV: ${fileName}]\n\n${text}`,
    extractionMethod: "csv",
  };
}

async function extractDocx(buffer: Buffer, fileName: string, mimeType: string): Promise<UploadResult> {
  const mammoth = await import("mammoth");
  // Use extractRawText; convertToMarkdown is not available in this version
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim() ?? "";

  return {
    fileName,
    mimeType,
    extractedText: text.length > 0
      ? `[Extracted from Word document: ${fileName}]\n\n${text}`
      : `[Word document ${fileName} appears to be empty.]`,
    extractionMethod: "docx_markdown",
  };
}

async function extractImage(buffer: Buffer, fileName: string, mimeType: string): Promise<UploadResult> {
  let imageBuffer = buffer;

  // Resize if needed to stay within Claude's image size limits
  try {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(buffer).metadata();
    const maxDim = Math.max(metadata.width ?? 0, metadata.height ?? 0);
    if (maxDim > MAX_IMAGE_DIMENSION) {
      imageBuffer = await sharp(buffer)
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .toBuffer();
    }
  } catch (_) {
    // sharp failed — use original buffer
  }

  // Normalize media type
  const mediaType = (mimeType === "image/tiff" ? "image/png" : mimeType) as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  return {
    fileName,
    mimeType,
    imageBase64: imageBuffer.toString("base64"),
    imageMediaType: mediaType,
    extractionMethod: "vision",
  };
}

function saveFileToDisk(buffer: Buffer, companyId: string, fileName: string): string | null {
  try {
    const companyDir = path.join(UPLOADS_DIR, companyId);
    fs.mkdirSync(companyDir, { recursive: true });
    const uuid = crypto.randomUUID();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const relativePath = path.join(companyId, `${uuid}-${safeName}`);
    fs.writeFileSync(path.join(UPLOADS_DIR, relativePath), buffer);
    return relativePath;
  } catch (err) {
    console.error("[upload] Failed to save file to disk:", err);
    return null;
  }
}

const DOC_TYPE_PATTERNS: Record<string, RegExp> = {
  balance_sheet: /balance sheet|assets|liabilities|equity/i,
  income_statement: /income statement|profit.{0,10}loss|p&l|revenue|gross profit/i,
  cash_flow_statement: /cash flow|operating activities|investing activities/i,
  investor_update: /investor update|portfolio update|dear investor/i,
};

function detectDocumentTypes(text: string): { primary: string; included: string[] } {
  const sample = text.slice(0, 8000);
  const found = Object.entries(DOC_TYPE_PATTERNS)
    .filter(([, re]) => re.test(sample))
    .map(([type]) => type);

  if (found.length === 0) return { primary: "financial_document", included: [] };
  if (found.length === 1) return { primary: found[0], included: [] };
  return { primary: "combined_financials", included: found };
}

/** Legacy single-type string for use in PDF extracted text annotation */
function detectDocumentType(text: string): string {
  return detectDocumentTypes(text).primary;
}
