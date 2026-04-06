import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAllPeriods, getSubmissionTracking, ensureCurrentPeriod, getCompanyFilterOptions, getAccessibleCompanyIds, getPlanTracking, getOnboardingTracking } from "@/lib/server/analytics";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format, endOfMonth, addDays } from "date-fns";
import { SubmissionTrackingClient } from "./client";
import { Suspense } from "react";

function computePeriodDueDate(periodStart: string, submissionDueDays: number): string {
  const monthEnd = endOfMonth(new Date(periodStart + "T12:00:00"));
  let d = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate(), 12, 0, 0);
  let added = 0;
  while (added < submissionDueDays) {
    d = addDays(d, 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; fund?: string; industry?: string; status?: string; planYear?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user as any;
  if (user.persona === "independent_operator") redirect("/analytics");

  const isOperator = user.persona === "operator";

  // Operators must have a company linked
  if (isOperator && !user.companyId) redirect("/dashboard");

  const params = await searchParams;

  // Operators are scoped to their own company only — ignore fund/industry/status filters
  const allowedIds = isOperator
    ? [user.companyId as string]
    : getAccessibleCompanyIds(user.id, user.firmId);

  const filters = {
    fund: isOperator ? "" : (params.fund ?? ""),
    industry: isOperator ? "" : (params.industry ?? ""),
    status: isOperator ? "current" : (params.status ?? "current"),
    allowedIds,
  };

  const currentPeriod = ensureCurrentPeriod(user.firmId);
  const allPeriods = getAllPeriods(user.firmId);
  const filterOptions = isOperator ? { funds: [], industries: [] } : getCompanyFilterOptions(user.firmId);

  const selectedPeriodId =
    params.period ?? currentPeriod?.id ?? allPeriods[0]?.id ?? "";

  const { rows, period } = selectedPeriodId
    ? getSubmissionTracking(user.firmId, selectedPeriodId, filters)
    : { rows: [], period: null };

  // Prior period (one before selected, for late submissions banner)
  const selectedIdx = allPeriods.findIndex((p) => p.id === selectedPeriodId);
  const priorPeriod = selectedIdx >= 0 ? allPeriods[selectedIdx + 1] ?? null : null;
  const { rows: priorRows } = priorPeriod
    ? getSubmissionTracking(user.firmId, priorPeriod.id, filters)
    : { rows: [] };
  const priorPendingRows = priorRows.filter((r) => r.status !== "submitted");
  const priorPeriodLabel = priorPeriod
    ? format(new Date(priorPeriod.periodStart + "T12:00:00"), "yyyy-MM")
    : "";

  // Stats
  const complete = rows.filter((r) => r.status === "submitted").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const missing = rows.filter((r) => r.status === "missing").length;
  const completion =
    rows.length > 0 ? Math.round((complete / rows.length) * 100) : 0;

  const periodLabel = period
    ? format(new Date(period.periodStart + "T12:00:00"), "yyyy-MM")
    : "";

  // ─── Plan tracking ────────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const availablePlanYears = [currentYear - 1, currentYear, currentYear + 1];
  const selectedPlanYear = params.planYear
    ? parseInt(params.planYear, 10)
    : currentYear;

  const planRows = getPlanTracking(user.firmId, selectedPlanYear, filters);

  const emailSettings = db
    .select()
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.firmId, user.firmId))
    .get();

  const planDueMonth = emailSettings?.planDueMonth ?? 1;
  const planDueDay = emailSettings?.planDueDay ?? 31;
  const planDueDate = `${selectedPlanYear}-${String(planDueMonth).padStart(2, "0")}-${String(planDueDay).padStart(2, "0")}`;

  const planSubmitted = planRows.filter((r) => r.planStatus === "complete").length;
  const planDraft = planRows.filter((r) => r.planStatus === "partial").length;
  const planNotStarted = planRows.filter((r) => r.planStatus === "no_submission").length;

  const onboardingRows = getOnboardingTracking(user.firmId);

  return (
    <Suspense fallback={null}>
      <SubmissionTrackingClient
        rows={rows}
        allPeriods={allPeriods}
        selectedPeriodId={selectedPeriodId}
        periodLabel={periodLabel}
        periodDueDate={
          period
            ? (period.dueDate ?? computePeriodDueDate(period.periodStart, ((emailSettings as any)?.dueDaysMonthly ?? 15)))
            : null
        }
        stats={{ complete, partial, missing, completion }}
        firmId={user.firmId}
        filterOptions={filterOptions}
        priorPendingRows={priorPendingRows}
        priorPeriodLabel={priorPeriodLabel}
        planRows={planRows}
        selectedPlanYear={selectedPlanYear}
        availablePlanYears={availablePlanYears}
        planDueDate={planDueDate}
        planStats={{ submitted: planSubmitted, draft: planDraft, notStarted: planNotStarted }}
        onboardingRows={onboardingRows}
        isOperator={isOperator}
      />
    </Suspense>
  );
}
