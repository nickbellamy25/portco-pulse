import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { sendOnboardingRequestEmail } from "@/lib/server/email";

export async function POST(request: Request) {
  const session = await auth();
  const user = session?.user as any;
  if (!user?.firmId || user.persona === "operator") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { companyId } = await request.json();
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const company = db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, companyId), eq(schema.companies.firmId, user.firmId)))
    .get();
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const status = (company as any).onboardingStatus;
  if (status !== "pending" && status !== "in_progress") {
    return NextResponse.json({ error: "Company is not in onboarding state" }, { status: 400 });
  }

  const firm = db.select().from(schema.firms).where(eq(schema.firms.id, user.firmId)).get();
  const firmName = firm?.name ?? "your firm";

  const operators = db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.companyId, companyId), eq(schema.users.firmId, user.firmId)))
    .all();

  const emails = operators.map((u) => u.email).filter(Boolean);
  if (emails.length === 0) {
    return NextResponse.json({ message: "No operators found for this company. Add operators in Company Settings first." });
  }

  const operatorUserIds = operators.map((u) => u.id);
  const emailSettings = db
    .select()
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.firmId, user.firmId))
    .get() ?? null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const chatLink = `${appUrl}/submit/${(company as any).submissionToken}`;

  await sendOnboardingRequestEmail({
    to: emails,
    companyName: company.name,
    firmName,
    chatLink,
    settings: emailSettings,
    firmId: user.firmId,
    operatorUserIds,
  });

  // Update the sent timestamp
  db.update(schema.companies)
    .set({ onboardingRequestSentAt: new Date().toISOString() } as any)
    .where(eq(schema.companies.id, companyId))
    .run();

  return NextResponse.json({
    message: `Onboarding reminder sent to ${emails.length} operator${emails.length === 1 ? "" : "s"}.`,
  });
}
