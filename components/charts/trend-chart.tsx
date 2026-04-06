"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format, subMonths, parseISO, startOfYear } from "date-fns";

export type KpiMeta = { key: string; label: string; unit: string | null };

type TrendChartProps = {
  data: Array<Record<string, string | number | null>>;
  kpiMeta: KpiMeta[];
  /** YYYY-MM string — if set, a vertical marker is drawn on that period */
  highlightPeriod?: string | null;
  /** YYYY-MM string — if set, a faint vertical investment separator is drawn */
  investmentPeriod?: string | null;
};

type TimeRange = "3M" | "6M" | "YTD" | "1Y" | "2Y" | "3Y" | "ALL";
const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "YTD", label: "YTD" },
  { value: "1Y", label: "1Y" },
  { value: "2Y", label: "2Y" },
  { value: "3Y", label: "3Y" },
  { value: "ALL", label: "All time" },
];

const COLORS = [
  { line: "#3b82f6", fill: "#3b82f6" },
  { line: "#10b981", fill: "#10b981" },
];

function fmtVal(v: number, unit: string | null | undefined): string {
  if (unit === "$" || unit === "currency") {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (unit === "%") return `${v.toFixed(1)}%`;
  return v.toLocaleString("en-US");
}

function CustomTooltip({ active, payload, label, kpiMeta }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-lg shadow-lg px-4 py-3 text-sm min-w-[160px]">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      {payload.map((entry: any) => {
        const meta = kpiMeta.find((k: KpiMeta) => k.key === entry.dataKey);
        return (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: entry.color }} />
              <span className="text-muted-foreground">{meta?.label ?? entry.dataKey}</span>
            </div>
            <span className="font-semibold tabular-nums">
              {fmtVal(Number(entry.value), meta?.unit)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TrendChart({ data, kpiMeta, highlightPeriod, investmentPeriod }: TrendChartProps) {
  const defaultKpi1 = kpiMeta.find((k) => k.key === "revenue")?.key ?? kpiMeta[0]?.key ?? "";
  const defaultKpi2 = kpiMeta.find((k) => k.key === "ebitda")?.key ?? kpiMeta[1]?.key ?? "none";

  const [kpi1Key, setKpi1Key] = useState(defaultKpi1);
  const [kpi2Key, setKpi2Key] = useState(defaultKpi2);
  const [timeRange, setTimeRange] = useState<TimeRange>("3Y");

  const allPeriodStrs = data.map((d) => d.period as string).filter(Boolean).sort();
  const latestPeriod = allPeriodStrs[allPeriodStrs.length - 1];
  let filtered = data;
  if (latestPeriod && timeRange !== "ALL") {
    let cutoff: string;
    if (timeRange === "YTD") {
      cutoff = format(startOfYear(parseISO(latestPeriod + "-01")), "yyyy-MM");
    } else {
      const months = timeRange === "3M" ? 3 : timeRange === "6M" ? 6 : timeRange === "1Y" ? 12 : timeRange === "2Y" ? 24 : 36;
      cutoff = format(subMonths(parseISO(latestPeriod + "-01"), months - 1), "yyyy-MM");
    }
    filtered = data.filter((d) => (d.period as string) >= cutoff);
  }

  const formatted = filtered.map((d) => ({
    ...d,
    label: d.period ? format(parseISO((d.period as string) + "-01"), "MMM yy") : "",
  }));

  // Label for the highlighted period (e.g. "Nov 25")
  const highlightLabel = highlightPeriod
    ? formatted.find((d) => ((d as any).period as string) === highlightPeriod)?.label ?? null
    : null;

  // Investment separator label — only shown if the investment period is within the visible range
  const investmentLabel = investmentPeriod
    ? formatted.find((d) => ((d as any).period as string) === investmentPeriod)?.label ?? null
    : null;

  const kpi1 = kpiMeta.find((k) => k.key === kpi1Key);
  const kpi2 = kpi2Key !== "none" ? kpiMeta.find((k) => k.key === kpi2Key) : null;

  const kpi1Max = Math.max(...formatted.map((d) => Math.abs(Number((d as any)[kpi1Key] ?? 0))).filter(isFinite), 0);
  const kpi2Max = kpi2 ? Math.max(...formatted.map((d) => Math.abs(Number((d as any)[kpi2Key] ?? 0))).filter(isFinite), 0) : 0;
  const scaleRatio = kpi1Max > 0 && kpi2Max > 0 ? Math.max(kpi1Max / kpi2Max, kpi2Max / kpi1Max) : 1;
  const dualAxis = !!(kpi2 && kpi1 && (kpi1.unit !== kpi2.unit || scaleRatio > 5));

  const xTickCount = filtered.length <= 3 ? filtered.length : filtered.length <= 6 ? 6 : undefined;
  const showDots = filtered.length <= 6;

  return (
    <div>
      {/* Controls row */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-blue-500" />
            <select
              className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={kpi1Key}
              onChange={(e) => {
                setKpi1Key(e.target.value);
                if (e.target.value === kpi2Key) setKpi2Key("none");
              }}
            >
              {kpiMeta.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" />
            <select
              className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
              value={kpi2Key}
              onChange={(e) => setKpi2Key(e.target.value)}
            >
              <option value="none">— None —</option>
              {kpiMeta
                .filter((k) => k.key !== kpi1Key)
                .map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Selected period badge */}
          {highlightLabel && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
              Viewing {highlightLabel}
            </span>
          )}
          {/* Time range pills */}
          <div className="flex items-center gap-0.5 bg-muted/60 rounded-lg p-1">
            {TIME_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTimeRange(opt.value)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  timeRange === opt.value
                    ? "bg-white shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={formatted} margin={{ top: 4, right: dualAxis ? 72 : 16, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS[0].fill} stopOpacity={0.15} />
              <stop offset="95%" stopColor={COLORS[0].fill} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS[1].fill} stopOpacity={0.12} />
              <stop offset="95%" stopColor={COLORS[1].fill} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickLine={false}
            axisLine={false}
            tickCount={xTickCount}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={(v) => fmtVal(v, kpi1?.unit)}
            tick={{ fontSize: 11, fill: COLORS[0].line }}
            tickLine={false}
            axisLine={false}
            width={62}
            domain={((domain: readonly number[]) => {
              const [dataMin, dataMax] = domain as [number, number];
              const range = dataMax - dataMin || Math.abs(dataMax) * 0.1 || 1;
              return [Math.floor(dataMin - range * 0.4), Math.ceil(dataMax + range * 0.1)];
            }) as any}
          />
          {dualAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v) => fmtVal(v, kpi2?.unit)}
              tick={{ fontSize: 11, fill: COLORS[1].line }}
              tickLine={false}
              axisLine={false}
              width={58}
              domain={((domain: readonly number[]) => {
                const [dataMin, dataMax] = domain as [number, number];
                const range = dataMax - dataMin || Math.abs(dataMax) * 0.1 || 1;
                return [Math.floor(dataMin - range * 0.4), Math.ceil(dataMax + range * 0.1)];
              }) as any}
            />
          )}
          <Tooltip content={<CustomTooltip kpiMeta={kpiMeta} />} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey={kpi1Key}
            stroke={COLORS[0].line}
            strokeWidth={2}
            fill="url(#grad1)"
            dot={showDots ? { r: 4, fill: COLORS[0].line, strokeWidth: 0 } : false}
            activeDot={{ r: 5, strokeWidth: 0 }}
            name={kpi1Key}
            connectNulls
          />
          {kpi2 && (
            <Area
              yAxisId={dualAxis ? "right" : "left"}
              type="monotone"
              dataKey={kpi2Key}
              stroke={COLORS[1].line}
              strokeWidth={2}
              fill="url(#grad2)"
              dot={showDots ? { r: 4, fill: COLORS[1].line, strokeWidth: 0 } : false}
              activeDot={{ r: 5, strokeWidth: 0 }}
              name={kpi2Key}
              connectNulls
            />
          )}
          {/* Investment date separator */}
          {investmentLabel && (
            <ReferenceLine
              x={investmentLabel}
              yAxisId="left"
              stroke="#94a3b8"
              strokeWidth={1}
              strokeOpacity={0.5}
              label={{ value: "Investment", position: "insideTopLeft", fontSize: 9, fill: "#94a3b8", offset: 4 }}
            />
          )}
          {/* Vertical marker for selected period */}
          {highlightLabel && (
            <ReferenceLine
              x={highlightLabel}
              yAxisId="left"
              stroke="#3b82f6"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
