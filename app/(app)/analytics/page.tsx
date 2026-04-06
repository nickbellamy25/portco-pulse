import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCompanies, getAllPeriods, getCompanyAnalytics, getCompanyFilterOptions, applyCompanyFilters, getAccessibleCompanyIds } from "@/lib/server/analytics";
import { AnalyticsClient } from "./client";
import { Suspense } from "react";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; period?: string; fund?: string; industry?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user as any;

  const params = await searchParams;
  const allowedIds = user.persona === "operator" ? null : getAccessibleCompanyIds(user.id, user.firmId);
  const filters = {
    fund: params.fund ?? "",
    industry: params.industry ?? "",
    status: params.status === "all" ? "" : (params.status ?? "current"),
    allowedIds,
  };

  const allCompanies = getCompanies(user.firmId);
  const filterOptions = getCompanyFilterOptions(user.firmId);

  // Apply filters to narrow the company list shown in the dropdown
  const companies = user.persona === "operator" ? [] : applyCompanyFilters(allCompanies, filters);

  // Operator: scope to their company. Admin: use query param, or first in filtered list.
  const companyId =
    user.persona === "operator"
      ? user.companyId
      : (companies.find((c) => c.id === params.company)?.id ?? companies[0]?.id ?? null);
  const allPeriods = getAllPeriods(user.firmId);

  // Always fetch full history — period filter is applied client-side as a spotlight
  const analytics = companyId
    ? getCompanyAnalytics(user.firmId, companyId)
    : null;

  const selectedPeriodId = params.period ?? allPeriods[0]?.id ?? null;
  const investmentDate = allCompanies.find((c) => c.id === companyId)?.investmentDate ?? null;

  return (
    <Suspense fallback={null}>
      <AnalyticsClient
        companies={companies}
        allPeriods={allPeriods}
        selectedCompanyId={companyId}
        selectedPeriodId={selectedPeriodId}
        analytics={analytics}
        isOperator={user.persona === "operator"}
        filterOptions={filterOptions}
        firmId={user.firmId}
        investmentDate={investmentDate}
      />
    </Suspense>
  );
}
