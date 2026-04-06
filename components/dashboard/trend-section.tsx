"use client";

import { TrendChart } from "@/components/charts/trend-chart";
import type { KpiMeta } from "@/components/charts/trend-chart";

type Props = {
  companyName: string;
  chartData: Array<Record<string, string | number | null>>;
  kpiMeta: KpiMeta[];
};

export function DashboardTrendSection({ companyName, chartData, kpiMeta }: Props) {
  return (
    <div className="bg-white rounded-xl border border-border p-6 mb-8">
      <div className="mb-5">
        <h2 className="font-semibold text-sm">Performance Trends</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{companyName}</p>
      </div>
      {chartData.length > 1 && kpiMeta.length > 0 ? (
        <TrendChart data={chartData} kpiMeta={kpiMeta} />
      ) : (
        <p className="text-sm text-muted-foreground text-center py-10">No submission data yet for this company.</p>
      )}
    </div>
  );
}
