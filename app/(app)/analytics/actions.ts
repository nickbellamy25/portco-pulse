"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { sendInvestorNoteEmail } from "@/lib/server/email";

export async function saveInvestorSubmissionNoteAction(
  submissionId: string,
  note: string
): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as any;

  if (user.persona === "operator" || user.persona === "independent_operator") {
    throw new Error("Unauthorized");
  }

  const submission = db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.id, submissionId),
        eq(schema.submissions.firmId, user.firmId)
      )
    )
    .get();

  if (!submission) throw new Error("Not found");

  db.update(schema.submissions)
    .set({ investorNote: note || null } as any)
    .where(eq(schema.submissions.id, submissionId))
    .run();
}

export async function saveInvestorNoteAction(
  kpiValueId: string,
  note: string
): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as any;

  // Investors only — operators cannot annotate
  if (user.persona === "operator" || user.persona === "independent_operator") {
    throw new Error("Unauthorized");
  }

  // Verify the kpi_value belongs to this firm
  const kpiValue = db
    .select()
    .from(schema.kpiValues)
    .where(
      and(
        eq(schema.kpiValues.id, kpiValueId),
        eq(schema.kpiValues.firmId, user.firmId)
      )
    )
    .get();

  if (!kpiValue) throw new Error("Not found");

  db.update(schema.kpiValues)
    .set({ investorNote: note || null })
    .where(eq(schema.kpiValues.id, kpiValueId))
    .run();

  // Only send notification when adding/updating a note (not clearing it)
  if (!note) return;

  // Look up supporting data for the email
  const [company, period, kpiDef, emailSettings] = [
    db.select().from(schema.companies).where(eq(schema.companies.id, kpiValue.companyId)).get(),
    db.select().from(schema.periods).where(eq(schema.periods.id, kpiValue.periodId)).get(),
    db.select().from(schema.kpiDefinitions).where(eq(schema.kpiDefinitions.id, kpiValue.kpiDefinitionId)).get(),
    db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, user.firmId)).get() ?? null,
  ];

  // Find operator users for this company (persona filter prevents firm admins from leaking in)
  const operators = db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.companyId, kpiValue.companyId),
        eq(schema.users.firmId, user.firmId),
        eq(schema.users.persona, "operator")
      )
    )
    .all();

  const recipientEmails = operators.map((o) => o.email).filter(Boolean);
  const operatorUserIds = operators.map((o) => o.id);
  if (!recipientEmails.length) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  await sendInvestorNoteEmail({
    to: recipientEmails,
    companyName: company?.name ?? "Your Company",
    kpiName: kpiDef?.label ?? "KPI",
    noteText: note,
    period: period?.periodStart?.slice(0, 7) ?? "",
    analyticsLink: `${appUrl}/analytics?company=${kpiValue.companyId}`,
    settings: emailSettings,
    firmId: user.firmId,
    companyId: kpiValue.companyId,
    operatorUserIds,
  });
}
