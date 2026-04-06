import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { companies, users, kpiDefinitions, emailSettings, firms, userAccessScopes, kpiCadenceOverrides, kpiAlertOverrides, kpiRagOverrides } from "@/lib/db/schema";
import { eq, isNull, isNotNull, and, inArray } from "drizzle-orm";
import { CompaniesClient } from "./client";
import { Suspense } from "react";
import { getAccessibleCompanyIds } from "@/lib/server/analytics";

export default async function CompaniesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user as any;
  const isOperator = user.persona === "operator";               // PE operator — limited access
  const isIndependent = user.persona === "independent_operator"; // Self-managed — full access, own company only
  const isCompanyScoped = isOperator || isIndependent;           // Only see their own company

  const firmId = user.firmId;

  const firm = db.select().from(firms).where(eq(firms.id, firmId)).get();
  const firmType = (firm?.orgType ?? "pe_firm") as "pe_firm" | "operating_company";

  const firmSettings = db.select().from(emailSettings).where(eq(emailSettings.firmId, firmId)).get();
  const firmDueDaysMonthly: number = (firmSettings as any)?.dueDaysMonthly ?? 15;
  const firmDueDaysQuarterly: number = (firmSettings as any)?.dueDaysQuarterly ?? 30;
  const firmDueDaysBiAnnual: number = (firmSettings as any)?.dueDaysBiAnnual ?? 45;
  const firmDueDaysAnnual: number = (firmSettings as any)?.dueDaysAnnual ?? 60;
  const firmReminderDays: number = (firmSettings as any)?.reminderDaysBeforeDue ?? 3;

  // Company-scoped users (PE operators + independent operators) only see their own company
  const allowedIds = isCompanyScoped ? null : getAccessibleCompanyIds(user.id, firmId);
  const allCompanies = isCompanyScoped
    ? db.select().from(companies).where(and(eq(companies.firmId, firmId), eq(companies.id, user.companyId))).all()
    : allowedIds != null
    ? db.select().from(companies).where(and(eq(companies.firmId, firmId), inArray(companies.id, allowedIds))).all()
    : db.select().from(companies).where(eq(companies.firmId, firmId)).all();

  // PE operators can't see the authorized users tab; everyone else can
  const allUsers = isOperator
    ? []
    : db.select().from(users).where(and(eq(users.firmId, firmId), isNotNull(users.companyId))).all();

  const customKpis = db
    .select()
    .from(kpiDefinitions)
    .where(
      and(
        eq(kpiDefinitions.firmId, firmId),
        eq(kpiDefinitions.scope, "custom"),
        isNotNull(kpiDefinitions.companyId)
      )
    )
    .orderBy(kpiDefinitions.displayOrder)
    .all();

  const firmKpiDefs = db
    .select()
    .from(kpiDefinitions)
    .where(
      and(
        eq(kpiDefinitions.firmId, firmId),
        isNull(kpiDefinitions.companyId),
        eq(kpiDefinitions.active, true)
      )
    )
    .orderBy(kpiDefinitions.section, kpiDefinitions.displayOrder)
    .all();

  const firmLevelUsers = db
    .select()
    .from(users)
    .where(and(eq(users.firmId, firmId), inArray(users.role, ["firm_admin", "firm_member"])))
    .all();

  const cadenceOverrides = db
    .select()
    .from(kpiCadenceOverrides)
    .where(eq(kpiCadenceOverrides.firmId, firmId))
    .all();

  const alertOverrides = db
    .select()
    .from(kpiAlertOverrides)
    .where(eq(kpiAlertOverrides.firmId, firmId))
    .all();

  const ragOverrides = db
    .select()
    .from(kpiRagOverrides)
    .where(eq(kpiRagOverrides.firmId, firmId))
    .all();

  const firmUserScopes = db
    .select()
    .from(userAccessScopes)
    .where(eq(userAccessScopes.firmId, firmId))
    .all();

  return (
    <Suspense fallback={null}>
    <CompaniesClient
      companies={allCompanies}
      firmId={firmId}
      allUsers={allUsers}
      customKpis={customKpis}
      firmKpiDefs={firmKpiDefs}
      firmDueDaysMonthly={firmDueDaysMonthly}
      firmDueDaysQuarterly={firmDueDaysQuarterly}
      firmDueDaysBiAnnual={firmDueDaysBiAnnual}
      firmDueDaysAnnual={firmDueDaysAnnual}
      firmReminderDays={firmReminderDays}
      firmEmailSettings={firmSettings ?? null}
      firmRequiredDocs={(firmSettings as any)?.firmRequiredDocs ?? null}
      firmRequiredDocCadences={(firmSettings as any)?.firmRequiredDocCadences ?? null}
      firmLevelUsers={firmLevelUsers}
      firmUserScopes={firmUserScopes}
      isOperator={isOperator}
      isIndependent={isIndependent}
      firmType={firmType}
      cadenceOverrides={cadenceOverrides}
      alertOverrides={alertOverrides}
      ragOverrides={ragOverrides}
    />
    </Suspense>
  );
}
