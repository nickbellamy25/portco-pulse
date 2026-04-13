"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import type { PortfolioChartData } from "@/lib/server/analytics";

const COMPANY_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#6366f1", // indigo
  "#14b8a6", // teal
];

function fmtVal(v: number, unit?: string | null): string {
  if (unit === "%" ) return `${v.toFixed(1)}%`;
  if (unit == null || unit === "$" || unit === "currency") {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  // integer / other units
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function SnapshotTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const periodLabel = entry.payload?.periodLabel;
  return (
    <div className="bg-white border border-border rounded-lg shadow-lg px-4 py-3 text-sm">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className="font-semibold tabular-nums">{fmtVal(entry.value, unit)}</p>
      {periodLabel && (
        <p className="text-xs text-muted-foreground mt-1">{periodLabel}</p>
      )}
    </div>
  );
}

function TrendTooltip({ active, payload, label, indexed }: any) {
  if (!active || !payload?.length) return null;
  const validEntries = payload.filter((e: any) => e.value != null);
  if (!validEntries.length) return null;
  return (
    <div className="bg-white border border-border rounded-lg shadow-lg px-4 py-3 text-sm min-w-[180px]">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      {validEntries.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full inline-block shrink-0"
              style={{ background: entry.color ?? entry.stroke ?? entry.fill }}
            />
            <span className="text-muted-foreground text-xs">{entry.name}</span>
          </div>
          <span className="tabular-nums text-xs font-medium">
            {indexed
              ? `${entry.value > 0 ? "+" : ""}${entry.value.toFixed(1)}%`
              : fmtVal(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}


type Props = {
  chartData: PortfolioChartData;
};

export function PortfolioPerformanceSection({ chartData }: Props) {
  const defaultKpi = chartData.kpiOptions.find((k) => k.key === "revenue")?.key ?? chartData.kpiOptions[0]?.key ?? "";
  const [kpi, setKpi] = useState(defaultKpi);
  const [indexed, setIndexed] = useState(true);

  const activeKpi = chartData.kpiOptions.some((k) => k.key === kpi) ? kpi : defaultKpi;
  const activeUnit = chartData.kpiOptions.find((k) => k.key === activeKpi)?.unit ?? null;

  const getLatest = (c: PortfolioChartData["companies"][0]) => c.latestValues[activeKpi] ?? null;

  // Snapshot: sorted descending, nulls at bottom
  const snapshotData = chartData.companies
    .map((c) => ({ id: c.id, name: c.name, value: getLatest(c), hasAlert: c.hasAlert, periodLabel: c.latestPeriodLabel }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    }) as Array<{ id: string; name: string; value: number | null; hasAlert: boolean }>;

  const snapshotWithData = snapshotData.filter((d) => d.value !== null) as Array<{
    id: string;
    name: string;
    value: number;
    hasAlert: boolean;
    periodLabel: string | null;
  }>;

  const snapshotPeriodLabel = (() => {
    const labels = snapshotWithData.map(d => d.periodLabel).filter(Boolean);
    if (!labels.length) return null;
    // Most common label (most companies report the same period)
    const counts = new Map<string, number>();
    labels.forEach(l => counts.set(l!, (counts.get(l!) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  })();

  // Trend: use simple indexed keys (c0, c1...) to avoid UUID issues in Recharts dataKey
  const trendDataAbsolute = chartData.trendPeriods.map((p) => {
    const byCompany = p.byKpi[activeKpi] ?? {};
    const row: Record<string, any> = { period: p.period, label: p.label };
    chartData.companies.forEach((c, i) => {
      row[`c${i}`] = byCompany[c.id] ?? null;
    });
    return row;
  });

  // Indexed view: normalize each company to % change from its first non-null value
  const trendData = (() => {
    if (!indexed) return trendDataAbsolute;
    const baselines: Record<string, number> = {};
    chartData.companies.forEach((_, i) => {
      const key = `c${i}`;
      for (const row of trendDataAbsolute) {
        if (row[key] != null) { baselines[key] = row[key]; break; }
      }
    });
    return trendDataAbsolute.map((row) => {
      const newRow: Record<string, any> = { period: row.period, label: row.label };
      chartData.companies.forEach((_, i) => {
        const key = `c${i}`;
        const base = baselines[key];
        const val = row[key];
        newRow[key] = val != null && base != null && base !== 0
          ? +((( val - base) / base) * 100).toFixed(2)
          : null;
      });
      return newRow;
    });
  })();

  const hasSnapshotData = snapshotWithData.length > 0;
  const hasTrendData = trendData.some((p) =>
    chartData.companies.some((_, i) => p[`c${i}`] != null)
  );

  const router = useRouter();
  const companyIdByName = new Map(snapshotWithData.map(d => [d.name, d.id]));

  const snapshotHeight = Math.max(snapshotWithData.length * 38 + 80, 140);

  const renderCompanyTick = ({ x, y, payload }: any) => {
    const name: string = payload.value ?? "";
    const display = name.length > 24 ? name.slice(0, 24) + "…" : name;
    const cId = companyIdByName.get(name);
    return (
      <text
        x={x} y={y} dy={4} textAnchor="end" fill="#6b7280" fontSize={11}
        style={{ cursor: "pointer" }}
        onClick={() => cId && router.push(`/analytics?company=${cId}`)}
        onMouseEnter={(e) => { e.currentTarget.setAttribute("fill", "#3b82f6"); }}
        onMouseLeave={(e) => { e.currentTarget.setAttribute("fill", "#6b7280"); }}
      >
        {display}
      </text>
    );
  };

  if (chartData.companies.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-border p-6 mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-semibold text-sm">Portfolio Performance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {chartData.companies.length} {chartData.companies.length === 1 ? "company" : "companies"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Firm-Wide KPI</span>
          <select
            value={activeKpi}
            onChange={(e) => setKpi(e.target.value)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {chartData.kpiOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Snapshot — latest period horizontal bar */}
      <div className="mb-8">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Latest Submission{snapshotPeriodLabel ? ` · ${snapshotPeriodLabel}` : ""}
        </p>
        {hasSnapshotData ? (
          <ResponsiveContainer width="100%" height={snapshotHeight}>
            <BarChart
              layout="vertical"
              data={snapshotWithData}
              margin={{ top: 0, right: 72, left: 0, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => fmtVal(v, activeUnit)}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={148}
                tick={renderCompanyTick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<SnapshotTooltip unit={activeUnit} />} cursor={{ fill: "#f9fafb" }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(v: any) => fmtVal(v as number, activeUnit)}
                  style={{ fontSize: 11, fill: "#6b7280" }}
                />
                {snapshotWithData.map((_, i) => (
                  <Cell key={i} fill="#3b82f6" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No data for this period.
          </p>
        )}
      </div>

      {/* Trend — line chart, last 12 months */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Portfolio Trend · Last 12 Months
          </p>
          <div className="flex gap-0.5 bg-muted/60 rounded-lg p-0.5">
            {(["Absolute", "% Change"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setIndexed(opt === "% Change")}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  (opt === "% Change") === indexed
                    ? "bg-white shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/50"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        {hasTrendData ? (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={indexed ? (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%` : (v) => fmtVal(v, activeUnit)}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  width={indexed ? 48 : 60}
                />
                <Tooltip content={<TrendTooltip indexed={indexed} />} />
                {chartData.companies.map((c, i) => (
                  <Line
                    key={c.id}
                    type="monotone"
                    dataKey={`c${i}`}
                    stroke={COMPANY_COLORS[i % COMPANY_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    name={c.name}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {/* Company legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
              {chartData.companies.map((c, i) => (
                <div key={c.id} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                    style={{ background: COMPANY_COLORS[i % COMPANY_COLORS.length] }}
                  />
                  <span
                    className="text-xs text-muted-foreground hover:text-blue-600 cursor-pointer"
                    onClick={() => router.push(`/analytics?company=${c.id}`)}
                  >
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No trend data available yet.
          </p>
        )}
      </div>
    </div>
  );
}
