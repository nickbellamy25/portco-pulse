"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type CashChartProps = {
  data: Array<{ name: string; cash: number }>;
};

function formatM(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

export function CashChart({ data }: CashChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={60}
        />
        <YAxis
          tickFormatter={formatM}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={55}
        />
        <Tooltip
          formatter={(val) => [formatM(Number(val)), "Cash Balance"]}
          cursor={{ fill: "#f5f5f5" }}
        />
        <Bar dataKey="cash" fill="#34a853" radius={[3, 3, 0, 0]} maxBarSize={60} />
      </BarChart>
    </ResponsiveContainer>
  );
}
