import type { PortfolioPlanSummary, CompanyPlanSummary } from "@/lib/server/analytics";
import Link from "next/link";

type Props = {
  planSummary: PortfolioPlanSummary;
};

type RagStatus = "green" | "amber" | "red";

const RAG_CONFIG: Record<RagStatus, { label: string; dot: string; text: string; bg: string; border: string }> = {
  green: { label: "On Track",  dot: "bg-green-500",  text: "text-green-700",  bg: "bg-green-50",  border: "border-green-100" },
  amber: { label: "At Risk",   dot: "bg-amber-400",  text: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-100" },
  red:   { label: "Off Track", dot: "bg-red-500",    text: "text-red-700",    bg: "bg-red-50",    border: "border-red-100"   },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtCompact(v: number | null, unit?: string | null): string {
  if (v === null || v === undefined) return "—";
  if (unit === "%" || unit === "percent") return `${v.toFixed(1)}%`;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function RagPill({ status }: { status: RagStatus | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const c = RAG_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function KpiCell({
  data,
  isPercent = false,
  separator = false,
  companyLatestMonth,
}: {
  data: CompanyPlanSummary["revenue"];
  isPercent?: boolean;
  separator?: boolean;
  companyLatestMonth?: number | null;
}) {
  const borderCls = separator ? " border-r border-border/40" : "";
  if (!data) return <td className={`px-4 py-3 text-right text-muted-foreground text-sm${borderCls}`} colSpan={3}>—</td>;

  const isStale = companyLatestMonth != null && data.thruMonth != null && data.thruMonth < companyLatestMonth;
  const staleTitle = isStale ? `Data through ${MONTHS[(data.thruMonth ?? 1) - 1]} only` : undefined;

  const varPctColor =
    data.ytdVariancePct === null
      ? "text-muted-foreground"
      : data.ytdVariancePct >= 0
      ? "text-green-600"
      : "text-red-600";

  return (
    <>
      <td className={`px-3 py-3 text-right tabular-nums text-sm font-medium${isStale ? " italic opacity-70" : ""}`} title={staleTitle}>
        {isPercent ? (data.ytdActual != null ? `${data.ytdActual.toFixed(1)}%` : "—") : fmtCompact(data.ytdActual)}
      </td>
      <td className={`px-3 py-3 text-right tabular-nums text-sm text-muted-foreground${isStale ? " italic opacity-70" : ""}`} title={staleTitle}>
        {isPercent ? (data.ytdPlan != null ? `${data.ytdPlan.toFixed(1)}%` : "—") : fmtCompact(data.ytdPlan)}
      </td>
      <td className={`px-3 py-3 text-right tabular-nums text-xs ${varPctColor}${borderCls}${isStale ? " italic opacity-70" : ""}`} title={staleTitle}>
        {fmtPct(data.ytdVariancePct)}
      </td>
    </>
  );
}

export function PlanAttainmentSection({ planSummary }: Props) {
  const { fiscalYear, companies, ragDistribution } = planSummary;
  const throughMonth = Math.max(...companies.map((c) => c.latestMonth ?? 0));
  const monthLabel = throughMonth > 0 ? MONTHS[throughMonth - 1] : null;

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-sm">
            Plan Attainment — {fiscalYear} YTD
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Revenue, Gross Margin and EBITDA vs approved annual plan</p>
        </div>

        {/* RAG distribution pills */}
        <div className="flex items-center gap-2">
          {(["green", "amber", "red"] as RagStatus[]).map((r) => {
            const count = ragDistribution[r];
            if (count === 0) return null;
            const c = RAG_CONFIG[r];
            return (
              <span key={r} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                {count} {c.label}
              </span>
            );
          })}
          {ragDistribution.noPlan > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-full border border-border">
              {ragDistribution.noPlan} No Plan
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/30 min-w-[160px]">Company</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground border-r border-border/40" colSpan={3}>
                Revenue YTD
              </th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground border-r border-border/40" colSpan={3}>
                Gross Margin YTD
              </th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground border-r border-border/40" colSpan={3}>
                EBITDA YTD
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap text-right">Through</th>
            </tr>
            <tr className="border-b border-border bg-muted/10">
              <th className="sticky left-0 bg-muted/10" />
              {["Actual", "Plan", "Var%"].map((h) => (
                <th key={`rev-${h}`} className={`px-3 py-2 text-right text-xs font-medium text-muted-foreground/70${h === "Var%" ? " border-r border-border/40" : ""}`}>{h}</th>
              ))}
              {["Actual", "Plan", "Var%"].map((h) => (
                <th key={`gm-${h}`} className={`px-3 py-2 text-right text-xs font-medium text-muted-foreground/70${h === "Var%" ? " border-r border-border/40" : ""}`}>{h}</th>
              ))}
              {["Actual", "Plan", "Var%"].map((h) => (
                <th key={`ebitda-${h}`} className={`px-3 py-2 text-right text-xs font-medium text-muted-foreground/70${h === "Var%" ? " border-r border-border/40" : ""}`}>{h}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.companyId} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-3 font-medium sticky left-0 bg-white">
                  <Link
                    href={`/analytics?company=${c.companyId}`}
                    className="hover:text-blue-600 hover:underline transition-colors"
                  >
                    {c.companyName}
                  </Link>
                </td>
                <KpiCell data={c.revenue} separator companyLatestMonth={c.latestMonth} />
                <KpiCell data={c.grossMargin} isPercent separator companyLatestMonth={c.latestMonth} />
                <KpiCell data={c.ebitda} separator companyLatestMonth={c.latestMonth} />
                <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                  {c.latestMonth ? MONTHS[c.latestMonth - 1] : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
