"use client";

type KpiEntry = {
  kpiKey: string;
  kpiLabel: string;
  unit: string | null;
  currentValue: number;
  rag: "red" | "amber" | "green" | null;  // null = no plan
};

const RAG_STYLE = {
  red:   { card: "border-red-200 bg-red-50",     value: "text-red-600",   badge: "bg-red-100 text-red-600 border-red-200",     dot: "bg-red-500"   },
  amber: { card: "border-amber-200 bg-amber-50", value: "text-amber-600", badge: "bg-amber-100 text-amber-600 border-amber-200", dot: "bg-amber-400" },
  green: { card: "border-green-200 bg-green-50", value: "text-green-600", badge: "bg-green-100 text-green-600 border-green-200", dot: "bg-green-500" },
  none:  { card: "border-border bg-white",        value: "text-foreground", badge: "",                                            dot: "bg-gray-400"  },
};

const RAG_LABEL = { red: "Off Track", amber: "At Risk", green: "On Track" };

function fmtVal(v: number, unit: string | null | undefined): string {
  if (unit === "$" || unit === "currency") {
    const neg = v < 0;
    const abs = Math.abs(v);
    let s: string;
    if (abs >= 1_000_000) s = `$${(abs / 1_000_000).toFixed(1)}M`;
    else if (abs >= 1_000) s = `$${(abs / 1_000).toFixed(0)}K`;
    else s = `$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    return neg ? `-${s}` : s;
  }
  if (unit === "%") return `${v.toFixed(1)}%`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

type Props = {
  latestValues: Record<string, { value: number; unit: string | null; label: string; ragEffective: "green" | "amber" | "red" | null }>;
};

export function KpiHealthChart({ latestValues }: Props) {
  const entries: KpiEntry[] = Object.entries(latestValues).map(([kpiKey, kv]) => ({
    kpiKey,
    kpiLabel: kv.label,
    unit: kv.unit,
    currentValue: kv.value,
    rag: kv.ragEffective,
  }));

  if (entries.length === 0) return null;

  const ORDER = { red: 0, amber: 1, green: 2, none: 3 } as const;
  entries.sort((a, b) => ORDER[a.rag ?? "none"] - ORDER[b.rag ?? "none"] || a.kpiLabel.localeCompare(b.kpiLabel));

  const redCount   = entries.filter((e) => e.rag === "red").length;
  const amberCount = entries.filter((e) => e.rag === "amber").length;
  const greenCount = entries.filter((e) => e.rag === "green").length;

  return (
    <div className="bg-white rounded-xl border border-border p-6 mb-6">
      <div className="mb-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="font-semibold text-sm">KPI Health</h2>
          <div className="flex items-center gap-3 text-xs">
            {redCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                <span className="text-muted-foreground">{redCount} Off Track</span>
              </span>
            )}
            {amberCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                <span className="text-muted-foreground">{amberCount} At Risk</span>
              </span>
            )}
            {greenCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                <span className="text-muted-foreground">{greenCount} On Track</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {entries.map((entry, i) => {
          const style = RAG_STYLE[entry.rag ?? "none"];

          return (
            <div key={`${entry.kpiKey}-${i}`} className={`rounded-lg border p-3.5 w-72 shrink-0 ${style.card}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-muted-foreground leading-tight">{entry.kpiLabel}</span>
                {entry.rag && (
                  <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${style.badge}`}>
                    {RAG_LABEL[entry.rag]}
                  </span>
                )}
              </div>
              <p className={`text-xl font-bold tabular-nums leading-tight ${style.value}`}>
                {fmtVal(entry.currentValue, entry.unit)}
              </p>
              <p className={`text-[11px] mt-1 leading-snug ${entry.rag ? `${style.value} opacity-80` : "text-muted-foreground"}`}>
                {entry.rag === null ? "No plan configured" : "vs. plan"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
