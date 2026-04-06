"use server";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

import { endOfMonth } from "date-fns";
import { randomBytes } from "crypto";
import { sendInvitationEmail } from "@/lib/server/email";

// ─── Firm Team Actions ─────────────────────────────────────────────────────────

export async function inviteFirmUserAction(input: {
  firmId: string;
  email: string;
  name: string;
  role: "firm_admin" | "firm_member";
}) {
  const trimmed = input.email.trim().toLowerCase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Re-assign existing user — they already have credentials, no invite needed
  const existing = db.select().from(schema.users).where(eq(schema.users.email, trimmed)).get();
  if (existing) {
    db.update(schema.users)
      .set({ firmId: input.firmId, companyId: null, role: input.role, persona: "investor", name: input.name || existing.name })
      .where(eq(schema.users.id, existing.id))
      .run();
    return db.select().from(schema.users).where(eq(schema.users.id, existing.id)).get()!;
  }

  // New user — create with invite token
  const { hashSync } = await import("bcryptjs");
  const passwordHash = hashSync(randomBytes(16).toString("hex"), 10);
  const { createHash } = await import("crypto");
  const rawToken = randomBytes(32).toString("hex");
  const inviteToken = createHash("sha256").update(rawToken).digest("hex");
  const inviteTokenExpiresAt = Date.now() + 48 * 60 * 60 * 1000; // 48 hours
  const id = crypto.randomUUID();

  db.insert(schema.users).values({
    id,
    firmId: input.firmId,
    companyId: null,
    email: trimmed,
    passwordHash,
    name: input.name || null,
    role: input.role,
    persona: "investor",
    inviteToken,
    inviteTokenExpiresAt,
  }).run();

  const emailSettings = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, input.firmId)).get() ?? null;
  await sendInvitationEmail({
    to: trimmed,
    inviteLink: `${appUrl}/accept-invite/${rawToken}`,
    settings: emailSettings,
  });

  return db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
}

export async function removeFirmUserAction(userId: string) {
  db.delete(schema.users).where(eq(schema.users.id, userId)).run();
}

export async function updateFirmUserRoleAction(userId: string, role: "firm_admin" | "firm_member") {
  db.update(schema.users)
    .set({ role, persona: "investor" })
    .where(eq(schema.users.id, userId))
    .run();
}

export async function addUserScopeAction(input: {
  userId: string;
  firmId: string;
  scopeType: "company" | "fund" | "industry";
  scopeValue: string;
}) {
  // Prevent duplicates
  const existing = db
    .select()
    .from(schema.userAccessScopes)
    .where(
      and(
        eq(schema.userAccessScopes.userId, input.userId),
        eq(schema.userAccessScopes.firmId, input.firmId),
        eq(schema.userAccessScopes.scopeType, input.scopeType),
        eq(schema.userAccessScopes.scopeValue, input.scopeValue)
      )
    )
    .get();
  if (existing) return existing;

  const id = crypto.randomUUID();
  db.insert(schema.userAccessScopes).values({ id, ...input }).run();
  return db.select().from(schema.userAccessScopes).where(eq(schema.userAccessScopes.id, id)).get()!;
}

export async function removeUserScopeAction(scopeId: string) {
  db.delete(schema.userAccessScopes).where(eq(schema.userAccessScopes.id, scopeId)).run();
}

function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function saveEmailSettingsAction(input: {
  firmId: string;
  fromName: string;
  fromEmail: string;
  submissionReminderEnabled: boolean;
  monthlyDigestEnabled: boolean;
  thresholdAlertEnabled: boolean;
  submissionNotificationEnabled: boolean;
  planReminderEnabled?: boolean;
  reminderSubject: string;
  reminderBody: string;
  monthlyDigestRecipients: string;
  monthlyDigestSubject: string;
  monthlyDigestBody: string;
  thresholdAlertRecipients: string;
  thresholdAlertSubject: string;
  thresholdAlertBody: string;
  submissionNotificationRecipients: string;
  submissionNotificationSubject: string;
  submissionNotificationBody: string;
  invitationSubject: string;
  invitationBody: string;
  planReminderSubject?: string;
  planReminderBody?: string;
  planSubmittedRecipients?: string;
  planSubmittedSubject?: string;
  planSubmittedBody?: string;
  investorNoteNotificationEnabled?: boolean;
  investorNoteNotificationSubject?: string;
  investorNoteNotificationBody?: string;
  submissionReminderRecipients?: string;
  planReminderRecipients?: string;
  kpiOverrideNotificationEnabled?: boolean;
  kpiOverrideNotificationRecipients?: string;
  kpiOverrideNotificationSubject?: string;
  kpiOverrideNotificationBody?: string;
  ragAlertEnabled?: boolean;
  ragAlertRecipients?: string;
  ragAlertSubject?: string;
  ragAlertBody?: string;
  submissionNotificationInAppEnabled?: boolean;
  submissionReminderInAppEnabled?: boolean;
  ragAlertInAppEnabled?: boolean;
  thresholdAlertInAppEnabled?: boolean;
  kpiOverrideNotificationInAppEnabled?: boolean;
  investorNoteInAppEnabled?: boolean;
  monthlyDigestInAppEnabled?: boolean;
  planReminderMonth?: string | number;
  planReminderDay?: string | number;
  planDueMonth?: string | number;
  planDueDay?: string | number;
  reminderDaysBeforeDue?: string | number;
  planReminderDaysBeforeDue?: string | number;
}) {
  const existing = db
    .select()
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.firmId, input.firmId))
    .get();

  const payload = {
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    submissionReminderEnabled: input.submissionReminderEnabled,
    monthlyDigestEnabled: input.monthlyDigestEnabled,
    thresholdAlertEnabled: input.thresholdAlertEnabled,
    submissionNotificationEnabled: input.submissionNotificationEnabled,
    planReminderEnabled: input.planReminderEnabled ?? true,
    reminderSubject: input.reminderSubject,
    reminderBody: input.reminderBody,
    monthlyDigestRecipients: input.monthlyDigestRecipients,
    monthlyDigestSubject: input.monthlyDigestSubject,
    monthlyDigestBody: input.monthlyDigestBody,
    thresholdAlertRecipients: input.thresholdAlertRecipients,
    thresholdAlertSubject: input.thresholdAlertSubject,
    thresholdAlertBody: input.thresholdAlertBody,
    submissionNotificationRecipients: input.submissionNotificationRecipients,
    submissionNotificationSubject: input.submissionNotificationSubject,
    submissionNotificationBody: input.submissionNotificationBody,
    invitationSubject: input.invitationSubject,
    invitationBody: input.invitationBody,
    planReminderSubject: input.planReminderSubject || undefined,
    planReminderBody: input.planReminderBody || undefined,
    planSubmittedRecipients: input.planSubmittedRecipients ?? "",
    planSubmittedSubject: input.planSubmittedSubject || undefined,
    planSubmittedBody: input.planSubmittedBody || undefined,
    investorNoteNotificationEnabled: input.investorNoteNotificationEnabled ?? true,
    investorNoteNotificationSubject: input.investorNoteNotificationSubject || undefined,
    investorNoteNotificationBody: input.investorNoteNotificationBody || undefined,
    submissionReminderRecipients: input.submissionReminderRecipients ?? "",
    planReminderRecipients: input.planReminderRecipients ?? "",
    kpiOverrideNotificationEnabled: input.kpiOverrideNotificationEnabled ?? true,
    kpiOverrideNotificationRecipients: input.kpiOverrideNotificationRecipients ?? "",
    kpiOverrideNotificationSubject: input.kpiOverrideNotificationSubject || undefined,
    kpiOverrideNotificationBody: input.kpiOverrideNotificationBody || undefined,
    ragAlertEnabled: input.ragAlertEnabled ?? true,
    ragAlertRecipients: input.ragAlertRecipients ?? "",
    ragAlertSubject: input.ragAlertSubject || undefined,
    ragAlertBody: input.ragAlertBody || undefined,
    submissionNotificationInAppEnabled: input.submissionNotificationInAppEnabled ?? true,
    submissionReminderInAppEnabled: input.submissionReminderInAppEnabled ?? true,
    ragAlertInAppEnabled: input.ragAlertInAppEnabled ?? true,
    thresholdAlertInAppEnabled: input.thresholdAlertInAppEnabled ?? true,
    kpiOverrideNotificationInAppEnabled: input.kpiOverrideNotificationInAppEnabled ?? true,
    investorNoteInAppEnabled: input.investorNoteInAppEnabled ?? true,
    monthlyDigestInAppEnabled: input.monthlyDigestInAppEnabled ?? true,
    planReminderMonth: input.planReminderMonth !== undefined ? Number(input.planReminderMonth) : 12,
    planReminderDay: input.planReminderDay !== undefined ? Number(input.planReminderDay) : 1,
    planDueMonth: input.planDueMonth !== undefined ? Number(input.planDueMonth) : 1,
    planDueDay: input.planDueDay !== undefined ? Number(input.planDueDay) : 31,
    reminderDaysBeforeDue: input.reminderDaysBeforeDue !== undefined ? Number(input.reminderDaysBeforeDue) : 3,
    planReminderDaysBeforeDue: input.planReminderDaysBeforeDue !== undefined ? Number(input.planReminderDaysBeforeDue) : 30,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    db.update(schema.emailSettings)
      .set(payload)
      .where(eq(schema.emailSettings.id, existing.id))
      .run();
  } else {
    db.insert(schema.emailSettings)
      .values({ firmId: input.firmId, ...payload })
      .run();
  }
}

// ─── Firm-Wide KPI Actions ─────────────────────────────────────────────────────

export async function createFirmKpiAction(input: {
  firmId: string;
  key: string;
  label: string;
  section: string;
  unit: string;
  valueType: string;
  description?: string;
  displayOrder?: number;
}) {
  const id = crypto.randomUUID();
  db.insert(schema.kpiDefinitions).values({
    id,
    firmId: input.firmId,
    scope: "standard",
    companyId: null,
    key: input.key,
    label: input.label,
    section: input.section,
    unit: input.unit,
    description: input.description ?? null,
    valueType: input.valueType as any,
    isRequired: false,
    displayOrder: input.displayOrder ?? 99,
    active: true,
  }).run();
  return db.select().from(schema.kpiDefinitions).where(eq(schema.kpiDefinitions.id, id)).get();
}

export async function updateFirmKpiNoteAction(kpiId: string, description: string) {
  db.update(schema.kpiDefinitions)
    .set({ description: description || null })
    .where(eq(schema.kpiDefinitions.id, kpiId))
    .run();
}

export async function updateKpiCadenceAction(
  kpiId: string,
  cadence: "weekly" | "monthly" | "quarterly" | "bi-annual"
) {
  db.update(schema.kpiDefinitions)
    .set({ collectionCadence: cadence } as any)
    .where(eq(schema.kpiDefinitions.id, kpiId))
    .run();
}

export async function updateKpiRagCriteriaAction(
  kpiId: string,
  ragDirection: "higher_is_better" | "lower_is_better",
  ragGreenPct: number,
  ragAmberPct: number,
  ragAlertOnAmber: boolean,
  ragAlertOnRed: boolean
) {
  db.update(schema.kpiDefinitions)
    .set({ ragDirection, ragGreenPct, ragAmberPct, ragAlertOnAmber, ragAlertOnRed } as any)
    .where(eq(schema.kpiDefinitions.id, kpiId))
    .run();
}

export async function deleteFirmKpiAction(kpiId: string) {
  // Soft-delete the KPI (preserve historical kpi_values)
  db.update(schema.kpiDefinitions)
    .set({ active: false })
    .where(eq(schema.kpiDefinitions.id, kpiId))
    .run();
}

export async function updatePeriodDueDateAction(periodId: string, dueDate: string | null) {
  db.update(schema.periods)
    .set({ dueDate: dueDate || null })
    .where(eq(schema.periods.id, periodId))
    .run();
}

export async function saveDueDaysAction(firmId: string, dueDays: {
  monthly: number;
  quarterly: number;
  annual: number;
  biAnnual: number;
}) {
  const existing = db
    .select()
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.firmId, firmId))
    .get();

  const payload = {
    submissionDueDays: dueDays.monthly, // keep legacy field in sync
    dueDaysMonthly: dueDays.monthly,
    dueDaysQuarterly: dueDays.quarterly,
    dueDaysAnnual: dueDays.annual,
    dueDaysBiAnnual: dueDays.biAnnual,
  } as any;

  if (existing) {
    db.update(schema.emailSettings).set(payload).where(eq(schema.emailSettings.id, existing.id)).run();
  } else {
    db.insert(schema.emailSettings).values({ firmId, ...payload } as any).run();
  }

  const allPeriods = db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.firmId, firmId))
    .all();

  for (const period of allPeriods) {
    const days = period.periodType === "quarterly" ? dueDays.quarterly : dueDays.monthly;
    const monthEnd = endOfMonth(new Date(period.periodStart + "T12:00:00"));
    const dueDate = toLocalDateStr(addBusinessDays(monthEnd, days));
    db.update(schema.periods).set({ dueDate }).where(eq(schema.periods.id, period.id)).run();
  }
}

export async function saveFirmDocsAction(firmId: string, requiredDocs: string, requiredDocCadences: string) {
  const existing = db.select().from(schema.emailSettings).where(eq(schema.emailSettings.firmId, firmId)).get();
  const payload = {
    firmRequiredDocs: requiredDocs || null,
    firmRequiredDocCadences: requiredDocCadences || null,
  } as any;
  if (existing) {
    db.update(schema.emailSettings).set(payload).where(eq(schema.emailSettings.id, existing.id)).run();
  } else {
    db.insert(schema.emailSettings).values({ firmId, ...payload } as any).run();
  }
}
