"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendInvitationEmail, sendKpiOverrideEmail, sendOnboardingRequestEmail } from "@/lib/server/email";

// ─── Add / Edit Company (simple dialog) ──────────────────────────────────────

type SaveCompanyInput = {
  id?: string;
  name: string;
  slug: string;
  industry: string;
  fund: string;
  firmId: string;
};

export async function saveCompanyAction(input: SaveCompanyInput): Promise<{ id: string } | void> {
  const { id, name, slug, industry, fund, firmId } = input;
  if (id) {
    db.update(schema.companies)
      .set({ name: name.trim(), slug: slug.trim() || null, industry: industry.trim() || null, fund: fund.trim() || null } as any)
      .where(eq(schema.companies.id, id))
      .run();
  } else {
    const newId = crypto.randomUUID();
    db.insert(schema.companies).values({
      id: newId,
      firmId,
      name: name.trim(),
      slug: slug.trim() || null,
      industry: industry.trim() || null,
      fund: fund.trim() || null,
      submissionToken: randomBytes(32).toString("base64url"),
      requiredDocs: "balance_sheet,income_statement,cash_flow_statement,investor_update",
    } as any).run();
    return { id: newId };
  }
}

// ─── Update company basic info (gear dialog) ─────────────────────────────────

export async function updateCompanyBasicAction(input: {
  id: string;
  name: string;
  industry: string;
  timezone: string;
  fund: string;
  status: "current" | "exited";
  investmentDate: string | null;
}) {
  db.update(schema.companies)
    .set({
      name: input.name.trim(),
      industry: input.industry.trim() || null,
      timezone: input.timezone || null,
      fund: input.fund.trim() || null,
      status: input.status,
      investmentDate: input.investmentDate || null,
    } as any)
    .where(eq(schema.companies.id, input.id))
    .run();
}

// ─── Update company schedule overrides ───────────────────────────────────────

export async function updateCompanyScheduleAction(input: {
  id: string;
  dueDaysMonthly: number | null;
  dueDaysQuarterly: number | null;
  dueDaysBiAnnual: number | null;
  dueDaysAnnual: number | null;
  reminderDaysBeforeDue: number | null;
}) {
  db.update(schema.companies)
    .set({
      dueDaysMonthly: input.dueDaysMonthly,
      dueDaysQuarterly: input.dueDaysQuarterly,
      dueDaysBiAnnual: input.dueDaysBiAnnual,
      dueDaysAnnual: input.dueDaysAnnual,
      reminderDaysBeforeDue: input.reminderDaysBeforeDue,
    } as any)
    .where(eq(schema.companies.id, input.id))
    .run();
}

// ─── Required documents ───────────────────────────────────────────────────────

export async function updateCompanyDocsAction(id: string, requiredDocs: string | null, requiredDocCadences: string | null) {
  db.update(schema.companies)
    .set({ requiredDocs: requiredDocs ?? null, requiredDocCadences: requiredDocCadences ?? null } as any)
    .where(eq(schema.companies.id, id))
    .run();
}

// ─── Authorized users ─────────────────────────────────────────────────────────

export async function addCompanyUserAction(companyId: string, firmId: string, email: string) {
  const trimmed = email.trim().toLowerCase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let result: any;
  let rawInviteToken: string | null = null;

  // Link existing user if found — no invite needed, they already have credentials
  const existing = db.select().from(schema.users).where(eq(schema.users.email, trimmed)).get();
  if (existing) {
    db.update(schema.users).set({ companyId }).where(eq(schema.users.id, existing.id)).run();
    result = { ...existing, companyId };
  } else {
    // New user — create with invite token
    const { hashSync } = await import("bcryptjs");
    const passwordHash = hashSync(randomBytes(16).toString("hex"), 10);
    rawInviteToken = randomBytes(32).toString("hex");
    const { createHash } = await import("crypto");
    const inviteToken = createHash("sha256").update(rawInviteToken).digest("hex");
    const inviteTokenExpiresAt = Date.now() + 48 * 60 * 60 * 1000; // 48 hours
    const id = crypto.randomUUID();

    db.insert(schema.users).values({
      id,
      firmId,
      companyId,
      email: trimmed,
      passwordHash,
      role: "company_member",
      persona: "operator",
      inviteToken,
      inviteTokenExpiresAt,
    }).run();

    result = db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
  }

  const emailSettings = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, firmId)).get() ?? null;

  if (rawInviteToken) {
    await sendInvitationEmail({
      to: trimmed,
      inviteLink: `${appUrl}/accept-invite/${rawInviteToken}`,
      settings: emailSettings,
    });
  }

  // If company is in onboarding "pending" state, auto-send onboarding request to this user
  const company = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if ((company as any)?.onboardingStatus === "pending") {
    const firm = db.select().from(schema.firms).where(eq(schema.firms.id, firmId)).get();
    const firmName = firm?.name ?? "your firm";
    const chatLink = `${appUrl}/submit/${(company as any).submissionToken}`;
    await sendOnboardingRequestEmail({
      to: [trimmed],
      companyName: company!.name,
      firmName,
      chatLink,
      settings: emailSettings,
      firmId,
      operatorUserIds: [result.id],
    });
  }

  return result;
}

export async function sendOnboardingRequestAction(companyId: string, firmId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as any;
  if (user.persona === "operator") throw new Error("Forbidden");

  const company = db.select().from(schema.companies).where(
    and(eq(schema.companies.id, companyId), eq(schema.companies.firmId, firmId))
  ).get();
  if (!company) throw new Error("Company not found");

  const firm = db.select().from(schema.firms).where(eq(schema.firms.id, firmId)).get();
  const firmName = firm?.name ?? "your firm";

  const operators = db.select().from(schema.users).where(
    and(eq(schema.users.companyId, companyId), eq(schema.users.firmId, firmId))
  ).all();

  const emails = operators.map((u) => u.email).filter(Boolean);
  const operatorUserIds = operators.map((u) => u.id);
  const emailSettings = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, firmId)).get() ?? null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const chatLink = `${appUrl}/submit/${(company as any).submissionToken}`;

  await sendOnboardingRequestEmail({
    to: emails,
    companyName: company.name,
    firmName,
    chatLink,
    settings: emailSettings,
    firmId,
    operatorUserIds,
  });

  const updateSet: any = { onboardingRequestSentAt: new Date().toISOString() };
  if (!(company as any).onboardingStatus) {
    updateSet.onboardingStatus = "pending";
  }
  db.update(schema.companies).set(updateSet).where(eq(schema.companies.id, companyId)).run();
}

export async function removeCompanyUserAction(userId: string) {
  db.update(schema.users)
    .set({ companyId: null })
    .where(eq(schema.users.id, userId))
    .run();
}

export async function updateCompanyUserEmailAction(userId: string, email: string) {
  const trimmed = email.trim().toLowerCase();
  db.update(schema.users)
    .set({ email: trimmed })
    .where(eq(schema.users.id, userId))
    .run();
}

// ─── Company KPI Cadence Overrides ────────────────────────────────────────────

export async function upsertKpiCadenceOverrideAction(input: {
  firmId: string;
  companyId: string;
  kpiDefinitionId: string;
  collectionCadence: "weekly" | "monthly" | "quarterly" | "bi-annual";
}) {
  const existing = db
    .select()
    .from(schema.kpiCadenceOverrides)
    .where(
      and(
        eq(schema.kpiCadenceOverrides.companyId, input.companyId),
        eq(schema.kpiCadenceOverrides.kpiDefinitionId, input.kpiDefinitionId)
      )
    )
    .get();

  if (existing) {
    db.update(schema.kpiCadenceOverrides)
      .set({ collectionCadence: input.collectionCadence })
      .where(eq(schema.kpiCadenceOverrides.id, existing.id))
      .run();
  } else {
    db.insert(schema.kpiCadenceOverrides).values({
      firmId: input.firmId,
      companyId: input.companyId,
      kpiDefinitionId: input.kpiDefinitionId,
      collectionCadence: input.collectionCadence,
    }).run();
  }
}

export async function deleteKpiCadenceOverrideAction(id: string) {
  db.delete(schema.kpiCadenceOverrides).where(eq(schema.kpiCadenceOverrides.id, id)).run();
}

// ─── KPI alert overrides ──────────────────────────────────────────────────────

export async function upsertKpiAlertOverrideAction(input: {
  firmId: string;
  companyId: string;
  kpiDefinitionId: string;
  ragAlertOnAmber: boolean;
  ragAlertOnRed: boolean;
}) {
  const existing = db
    .select()
    .from(schema.kpiAlertOverrides)
    .where(
      and(
        eq(schema.kpiAlertOverrides.companyId, input.companyId),
        eq(schema.kpiAlertOverrides.kpiDefinitionId, input.kpiDefinitionId)
      )
    )
    .get();

  if (existing) {
    db.update(schema.kpiAlertOverrides)
      .set({ ragAlertOnAmber: input.ragAlertOnAmber, ragAlertOnRed: input.ragAlertOnRed })
      .where(eq(schema.kpiAlertOverrides.id, existing.id))
      .run();
  } else {
    db.insert(schema.kpiAlertOverrides).values({
      firmId: input.firmId,
      companyId: input.companyId,
      kpiDefinitionId: input.kpiDefinitionId,
      ragAlertOnAmber: input.ragAlertOnAmber,
      ragAlertOnRed: input.ragAlertOnRed,
    }).run();
  }

  // Notify firm if enabled
  const emailSettings = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, input.firmId)).get();
  if ((emailSettings as any)?.kpiOverrideNotificationEnabled) {
    const recipients = ((emailSettings as any)?.kpiOverrideNotificationRecipients ?? "")
      .split(",").map((e: string) => e.trim()).filter(Boolean);
    if (recipients.length > 0) {
      const company = db.select().from(schema.companies).where(eq(schema.companies.id, input.companyId)).get();
      const kpiDef = db.select().from(schema.kpiDefinitions).where(eq(schema.kpiDefinitions.id, input.kpiDefinitionId)).get();
      if (company && kpiDef) {
        const parts = [];
        if (input.ragAlertOnAmber) parts.push("alert on At Risk");
        if (input.ragAlertOnRed) parts.push("alert on Off Track");
        const overrideSummary = parts.length > 0 ? parts.join(", ") : "alerts disabled";
        await sendKpiOverrideEmail({
          to: recipients,
          companyName: company.name,
          kpiLabel: kpiDef.label,
          overrideSummary,
          settings: emailSettings ?? null,
        });
      }
    }
  }
}

export async function deleteKpiAlertOverrideAction(id: string) {
  db.delete(schema.kpiAlertOverrides).where(eq(schema.kpiAlertOverrides.id, id)).run();
}

// ─── KPI RAG overrides ────────────────────────────────────────────────────────

export async function upsertKpiRagOverrideAction(input: {
  firmId: string;
  companyId: string;
  kpiDefinitionId: string;
  ragGreenPct: number;
  ragAmberPct: number;
  ragDirection: "higher_is_better" | "lower_is_better" | "any_variance";
}) {
  const existing = db
    .select()
    .from(schema.kpiRagOverrides)
    .where(
      and(
        eq(schema.kpiRagOverrides.companyId, input.companyId),
        eq(schema.kpiRagOverrides.kpiDefinitionId, input.kpiDefinitionId)
      )
    )
    .get();

  if (existing) {
    db.update(schema.kpiRagOverrides)
      .set({ ragGreenPct: input.ragGreenPct, ragAmberPct: input.ragAmberPct, ragDirection: input.ragDirection })
      .where(eq(schema.kpiRagOverrides.id, existing.id))
      .run();
  } else {
    db.insert(schema.kpiRagOverrides).values({
      firmId: input.firmId,
      companyId: input.companyId,
      kpiDefinitionId: input.kpiDefinitionId,
      ragGreenPct: input.ragGreenPct,
      ragAmberPct: input.ragAmberPct,
      ragDirection: input.ragDirection,
    }).run();
  }
}

export async function deleteKpiRagOverrideAction(id: string) {
  db.delete(schema.kpiRagOverrides).where(eq(schema.kpiRagOverrides.id, id)).run();
}

// ─── Custom KPI definitions ───────────────────────────────────────────────────

export async function addCustomKpiAction(input: {
  firmId: string;
  companyId: string;
  key: string;
  label: string;
  section: string;
  unit: string;
  valueType: string;
  isRequired: boolean;
}) {
  const id = crypto.randomUUID();
  db.insert(schema.kpiDefinitions).values({
    id,
    firmId: input.firmId,
    companyId: input.companyId,
    scope: "custom",
    key: input.key,
    label: input.label,
    section: input.section || "Other",
    unit: input.unit || null,
    valueType: input.valueType,
    isRequired: input.isRequired,
    active: true,
    displayOrder: 99,
  } as any).run();
  return db.select().from(schema.kpiDefinitions).where(eq(schema.kpiDefinitions.id, id)).get()!;
}

export async function deleteCustomKpiAction(id: string) {
  db.update(schema.kpiDefinitions).set({ active: false }).where(eq(schema.kpiDefinitions.id, id)).run();
}

// ─── Company Notifications ────────────────────────────────────────────────────

export type CompanyEmailEventSettings = {
  recipients: string;
  enabled: boolean;
  inAppEnabled?: boolean;
};

export async function saveCompanyEmailSettingsAction(
  companyId: string,
  settings: Record<string, CompanyEmailEventSettings>
) {
  const json = JSON.stringify(settings);
  // Also write legacy columns for backward compat with alert/submission email sending
  const alertCcEmails = settings["thresholdAlert"]?.recipients?.trim() || null;
  const submissionCcEmails = settings["submissionNotification"]?.recipients?.trim() || null;
  db.update(schema.companies)
    .set({ companyEmailSettings: json, alertCcEmails, submissionCcEmails } as any)
    .where(eq(schema.companies.id, companyId))
    .run();
}

// ─── Custom KPI RAG criteria ──────────────────────────────────────────────────

export async function updateCustomKpiRagCriteriaAction(
  kpiId: string,
  ragDirection: "higher_is_better" | "lower_is_better",
  ragGreenPct: number,
  ragAmberPct: number,
  ragAlertOnAmber: boolean,
  ragAlertOnRed: boolean,
  collectionCadence: "weekly" | "monthly" | "quarterly" | "bi-annual"
) {
  db.update(schema.kpiDefinitions)
    .set({ ragDirection, ragGreenPct, ragAmberPct, ragAlertOnAmber, ragAlertOnRed, collectionCadence } as any)
    .where(eq(schema.kpiDefinitions.id, kpiId))
    .run();
}

// ─── Delete Company ───────────────────────────────────────────────────────────

export async function deleteCompanyAction(id: string) {
  db.delete(schema.companies).where(eq(schema.companies.id, id)).run();
}

// ─── Plan Review (Investor) ───────────────────────────────────────────────────

export type PlanVersionData = {
  plan: schema.KpiPlan;
  values: schema.KpiPlanValue[];
  submittedByName: string | null;
};

export async function getCompanyPlanVersionsAction(
  companyId: string,
  fiscalYear: number
): Promise<{ versions: PlanVersionData[]; kpiDefs: schema.KpiDefinition[] }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as any;

  // Verify company belongs to this firm
  const company = db.select().from(schema.companies).where(
    and(eq(schema.companies.id, companyId), eq(schema.companies.firmId, user.firmId))
  ).get();
  if (!company) throw new Error("Not found");

  const plans = db
    .select()
    .from(schema.kpiPlans)
    .where(and(eq(schema.kpiPlans.companyId, companyId), eq(schema.kpiPlans.fiscalYear, fiscalYear)))
    .orderBy(desc(schema.kpiPlans.version))
    .all();

  const planIds = plans.map((p) => p.id);
  const allValues = planIds.length
    ? db.select().from(schema.kpiPlanValues)
        .where(inArray(schema.kpiPlanValues.planId, planIds))
        .all()
    : [];

  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, user.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.section, schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === companyId)
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

  const submitterUserIds = [...new Set(plans.map((p) => p.submittedByUserId).filter((id): id is string => !!id))];
  const submitterNameMap = new Map<string, string>();
  if (submitterUserIds.length) {
    const users = db.select().from(schema.users).where(inArray(schema.users.id, submitterUserIds)).all();
    for (const u of users) submitterNameMap.set(u.id, u.name ?? u.email ?? u.id);
  }

  const versions: PlanVersionData[] = plans.map((plan) => ({
    plan,
    values: allValues.filter((v) => v.planId === plan.id),
    submittedByName: plan.submittedByUserId ? (submitterNameMap.get(plan.submittedByUserId) ?? null) : null,
  }));

  return { versions, kpiDefs };
}

export async function saveInvestorPlanCommentAction(
  planValueId: string,
  comment: string
): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as any;
  if (user.persona === "operator" || user.persona === "independent_operator") {
    throw new Error("Unauthorized");
  }

  // Verify the plan value's plan belongs to this firm
  const planValue = db.select().from(schema.kpiPlanValues).where(eq(schema.kpiPlanValues.id, planValueId)).get();
  if (!planValue) throw new Error("Not found");

  const plan = db.select().from(schema.kpiPlans).where(eq(schema.kpiPlans.id, planValue.planId)).get();
  if (!plan || plan.firmId !== user.firmId) throw new Error("Not found");

  db.update(schema.kpiPlanValues)
    .set({ investorComment: comment || null })
    .where(eq(schema.kpiPlanValues.id, planValueId))
    .run();
}

export async function saveInvestorPlanNoteAction(
  planId: string,
  note: string
): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as any;
  if (user.persona === "operator" || user.persona === "independent_operator") {
    throw new Error("Unauthorized");
  }

  const plan = db.select().from(schema.kpiPlans).where(eq(schema.kpiPlans.id, planId)).get();
  if (!plan || plan.firmId !== user.firmId) throw new Error("Not found");

  db.update(schema.kpiPlans)
    .set({ investorNote: note || null })
    .where(eq(schema.kpiPlans.id, planId))
    .run();
}
