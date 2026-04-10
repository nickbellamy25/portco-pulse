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

  // Try to detect from raw PDF stream text (works for text-layer PDFs even when pdf-parse fails)
  const rawText = buffer.toString("latin1");
  const { primary: rawPrimary, included: rawIncluded } = detectDocumentTypes(rawText);
  if (rawPrimary !== "financial_document") {
    return {
      fileName,
      mimeType: "application/pdf",
      pdfBase64: buffer.toString("base64"),
      extractionMethod: "pdf_document",
      detectedDocumentType: rawPrimary,
      detectedIncludedStatements: rawIncluded.length > 0 ? rawIncluded : undefined,
    };
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
  const { primary, included } = detectDocumentTypes(text);
  return {
    fileName,
    mimeType,
    extractedText: `[Extracted from CSV: ${fileName}, detected type: ${primary}]\n\n${text}`,
    extractionMethod: "csv",
    detectedDocumentType: primary,
    detectedIncludedStatements: included.length > 0 ? included : undefined,
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

/**
 * Document detection patterns split into strong (unique to statement type) and weak (appear in multiple contexts).
 * Strong signals are structural keywords that almost exclusively appear in that document type.
 * Weak signals are financial terms that can appear in any context (emails, memos, other statements).
 */
const DOC_TYPE_STRONG: Record<string, RegExp[]> = {
  balance_sheet: [
    /balance\s+sheet/i,
    /\bcurrent\s+assets\b/i,
    /\bcurrent\s+liabilities\b/i,
    /\bnon.?current\s+(assets|liabilities)\b/i,
    /\bshareholders?.{0,5}equity\b/i,
    /\bstockholders?.{0,5}equity\b/i,
    /\bretained\s+earnings\b/i,
    /\baccounts\s+receivable\b/i,
    /\baccounts\s+payable\b/i,
    /\bproperty.{0,15}equipment\b/i,
    /\blong.?term\s+(debt|liabilities)\b/i,
    /\btotal\s+assets\b/i,
    /\btotal\s+liabilities\b/i,
    /\bprepaid\s+(expenses|assets)\b/i,
    /\baccrued\s+(expenses|liabilities)\b/i,
    /\bgoodwill\b/i,
    /\bintangible\s+assets\b/i,
    /\bdeferred\s+(tax|revenue)\b/i,
  ],
  income_statement: [
    /income\s+statement/i,
    /profit\s*.{0,10}loss\s*(statement)?/i,
    /\bp\s*&\s*l\b/i,
    /\bcost\s+of\s+(sales|goods\s+sold|revenue)\b/i,
    /\bgross\s+profit\b/i,
    /\boperating\s+(expenses?|costs?)\b/i,
    /\boperating\s+income\b/i,
    /\bnet\s+(income|profit|loss|earnings)\b/i,
    /\bsga\b|\bselling.{0,15}(general|admin)/i,
    /\btotal\s+revenue\b/i,
    /\bother\s+(income|expense)/i,
    /\bincome\s+(before|from)\s+(tax|operations)/i,
    /\btax\s+(expense|provision)\b/i,
    /\bearnings\s+before\b/i,
  ],
  cash_flow_statement: [
    /cash\s+flow\s+(statement|from)/i,
    /\boperating\s+activities\b/i,
    /\binvesting\s+activities\b/i,
    /\bfinancing\s+activities\b/i,
    /\b(beginning|ending)\s+(cash|balance)\b/i,
    /\bcash\s+(and\s+cash\s+)?equivalents?\s*(,\s*)?(beginning|end)/i,
    /\bnet\s+(increase|decrease|change)\s+in\s+cash\b/i,
    /\bdepreciation\s+(and|&)\s+amortization\b/i,
    /\bcapital\s+expenditure/i,
    /\bproceeds\s+from\b/i,
    /\brepayment\s+of\b/i,
    /\bchanges?\s+in\s+working\s+capital\b/i,
  ],
  investor_update: [
    /investor\s+update/i,
    /portfolio\s+update/i,
    /dear\s+(investor|partner|stakeholder)/i,
    /quarterly\s+(update|review|report)/i,
    /management\s+(commentary|discussion|report)/i,
    /letter\s+to\s+(investor|shareholder|partner)/i,
  ],
};

/** Weak signals — common financial terms that appear across many document types and informal text */
const DOC_TYPE_WEAK: Record<string, RegExp[]> = {
  balance_sheet: [
    /\bassets\b/i,
    /\bliabilities\b/i,
    /\bequity\b/i,
  ],
  income_statement: [
    /\brevenue\b/i,
    /\bebitda\b/i,
    /\bgross\s+margin\b/i,
  ],
  cash_flow_statement: [
    /\bcash\s+flow\b/i,
    /\bcapex\b/i,
    /\boperating\s+cash\b/i,
  ],
  investor_update: [],
};

function detectDocumentTypes(text: string): { primary: string; included: string[] } {
  const sample = text.slice(0, 12000);
  const scores: Record<string, number> = {};

  for (const type of Object.keys(DOC_TYPE_STRONG)) {
    let strong = 0;
    let weak = 0;
    for (const re of DOC_TYPE_STRONG[type]) {
      if (re.test(sample)) strong++;
    }
    for (const re of (DOC_TYPE_WEAK[type] ?? [])) {
      if (re.test(sample)) weak++;
    }
    // Require structural evidence: 2+ strong signals, OR 1 strong + 1 weak
    // Weak-only matches are ignored (prevents emails/memos from triggering)
    if (strong >= 2 || (strong >= 1 && weak >= 1)) {
      scores[type] = strong + weak;
    }
  }

  const found = Object.keys(scores);
  if (found.length === 0) return { primary: "financial_document", included: [] };
  if (found.length === 1) return { primary: found[0], included: [] };

  // Multiple doc types detected — combined financials
  const statements = found.filter((t) => t !== "investor_update");
  if (statements.length >= 2) {
    return { primary: "combined_financials", included: statements };
  }

  // Pick highest scoring
  const best = found.sort((a, b) => scores[b] - scores[a])[0];
  return { primary: best, included: [] };
}
