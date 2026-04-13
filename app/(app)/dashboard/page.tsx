import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getPortfolioDashboardData, getCompanyFilterOptions, getPortfolioChartData, getAccessibleCompanyIds, getPortfolioPlanSummary, getLatestSubmissionRagCount } from "@/lib/server/analytics";
import Link from "next/link";
import { Building2, AlertTriangle, Clock } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { ExportDataButton } from "@/components/dashboard/export-button";
import { FilterBarUrl } from "@/components/filters/filter-bar-url";
import { Suspense } from "react";
import { PortfolioPerformanceSection } from "@/components/charts/portfolio-chart";
import { PlanAttainmentSection } from "@/components/dashboard/plan-attainment";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fund?: string; industry?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;

  // Non-investor personas go to their company analytics
  if (user.persona === "operator" || user.persona === "independent_operator") {
    redirect(`/analytics?company=${user.companyId}`);
  }

  const params = await searchParams;
  const allowedIds = getAccessibleCompanyIds(user.id, user.firmId);
  const filters = {
    fund: params.fund ?? "",
    industry: params.industry ?? "",
    status: params.status ?? "current",
    allowedIds,
  };

  const data = getPortfolioDashboardData(user.firmId, filters);
  const filterOptions = getCompanyFilterOptions(user.firmId);

  const portfolioChartData = getPortfolioChartData(user.firmId, data.companies.map((c) => c.id));
  const planSummary = getPortfolioPlanSummary(user.firmId, data.companies.map((c) => c.id));
  const latestRag = getLatestSubmissionRagCount(user.firmId, data.companies.map((c) => c.id));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Portfolio Dashboard</h1>
        <ExportDataButton firmId={user.firmId} />
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <Suspense fallback={null}><FilterBarUrl funds={filterOptions.funds} industries={filterOptions.industries} /></Suspense>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Total Companies"
          value={data.totalCompanies}
          iconBg="bg-blue-50"
          icon={<Building2 className="h-5 w-5 text-blue-500" />}
        />
        <StatCard
          label="Pending Submissions (This Period)"
          value={data.pendingSubmissions}
          iconBg="bg-orange-50"
          icon={<Clock className="h-5 w-5 text-orange-500" />}
        />
        <StatCard
          label="Off Track / At Risk (Latest Submission)"
          value={latestRag.offTrackCount + latestRag.atRiskCount}
          iconBg="bg-red-50"
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
        />
      </div>

      {/* Portfolio Performance */}
      <PortfolioPerformanceSection chartData={portfolioChartData} />

      {/* Plan Attainment */}
      {planSummary.totalWithPlan > 0 && (
        <PlanAttainmentSection planSummary={planSummary} />
      )}

      {/* Off Track / At Risk — latest submission detail */}
      {latestRag.companies.length > 0 && (() => {
        function fmtKpiValue(actual: number, unit: string | null): string {
          if (unit === "$") return `$${actual.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
          if (unit === "%") return `${actual.toFixed(1)}%`;
          return actual.toLocaleString("en-US", { maximumFractionDigits: 1 });
        }
        const offTrack = latestRag.companies.filter((c) => c.worstSeverity === "high");
        const atRisk = latestRag.companies.filter((c) => c.worstSeverity === "medium");
        const offTrackViolations = offTrack.reduce((n, c) => n + c.violations.filter((v) => v.ragStatus === "red").length, 0);
        const atRiskViolations = atRisk.reduce((n, c) => n + c.violations.filter((v) => v.ragStatus === "amber").length, 0);

        function CompanyCard({ c, isRed }: { c: typeof latestRag.companies[0]; isRed: boolean }) {
          return (
            <div className={`p-3 rounded-lg border ${isRed ? "bg-red-50/60 border-red-100" : "bg-amber-50/60 border-amber-100"}`}>
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isRed ? "text-red-500" : "text-amber-500"}`} />
                  <Link href={`/analytics?company=${c.companyId}`} className="font-medium text-sm truncate hover:text-blue-600">{c.companyName}</Link>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{c.periodLabel}</span>
              </div>
              <div className="space-y-1.5 pl-5">
                {c.violations.map((v) => {
                  return (
                    <div key={v.kpiKey} className="flex items-baseline justify-between gap-3">
                      <p className="text-xs min-w-0">
                        <span className="font-semibold">{v.kpiLabel}</span>
                        <span className={`ml-1.5 ${isRed ? "text-red-600" : "text-amber-600"}`}>
                          &gt;{v.rulePct}% from plan of {fmtKpiValue(v.plan, v.unit)}
                        </span>
                      </p>
                      <span className="text-xs tabular-nums shrink-0">
                        <span className={`font-semibold ${isRed ? "text-red-600" : "text-amber-600"}`}>{v.variancePct >= 0 ? "+" : ""}{v.variancePct.toFixed(1)}%</span>
                        {" "}<span className="text-muted-foreground">({fmtKpiValue(v.actual, v.unit)})</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-base mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Off Track / At Risk — Latest Submission
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-2">
                  Off Track ({offTrackViolations})
                </p>
                {offTrack.length === 0
                  ? <p className="text-sm text-muted-foreground italic">None</p>
                  : <div className="space-y-2">{offTrack.map((c) => <CompanyCard key={c.companyId} c={c} isRed={true} />)}</div>
                }
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">
                  At Risk ({atRiskViolations})
                </p>
                {atRisk.length === 0
                  ? <p className="text-sm text-muted-foreground italic">None</p>
                  : <div className="space-y-2">{atRisk.map((c) => <CompanyCard key={c.companyId} c={c} isRed={false} />)}</div>
                }
              </div>
            </div>
          </div>
        );
      })()}

      {data.totalCompanies === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>No portfolio companies found. Add companies in the admin panel.</p>
        </div>
      )}
    </div>
  );
}
