"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { TrendingUp, Download, DollarSign, ClipboardList, Wallet, MessageSquare, Pencil, Check, X, FileText, ChevronDown, ChevronRight, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { KpiHealthChart } from "@/components/charts/kpi-health-chart";
import type { CompanyAnalyticsData } from "@/lib/server/analytics";
import type { Company, Period, KpiDefinition, KpiPlanValue } from "@/lib/db/schema";
import type { KpiMeta } from "@/components/charts/trend-chart";
import { FilterBarUrl } from "@/components/filters/filter-bar-url";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveInvestorNoteAction, saveInvestorSubmissionNoteAction } from "./actions";
import { useResizableColumns, type ResizeHandle as RH } from "./use-resizable-columns";
import {
  getCompanyPlanVersionsAction,
  saveInvestorPlanCommentAction,
  saveInvestorPlanNoteAction,
  type PlanVersionData,
} from "../admin/companies/actions";
import { toast } from "sonner";

type Props = {
  companies: Company[];
  allPeriods: Period[];
  selectedCompanyId: string | null;
  selectedPeriodId: string | null;
  analytics: CompanyAnalyticsData | null;
  isOperator: boolean;
  filterOptions: { funds: string[]; industries: string[] };
  firmId: string;
  investmentDate: string | null;
};

type RagStatus = "green" | "amber" | "red";

const RAG_CONFIG: Record<RagStatus, { label: string; dot: string; text: string; bg: string }> = {
  green: { label: "On Track",  dot: "bg-green-500", text: "text-green-700", bg: "bg-green-50"  },
  amber: { label: "At Risk",   dot: "bg-amber-400", text: "text-amber-700", bg: "bg-amber-50"  },
  red:   { label: "Off Track", dot: "bg-red-500",   text: "text-red-700",   bg: "bg-red-50"    },
};

function RagBadge({ status }: { status: RagStatus | null }) {
  if (!status) return null;
  const c = RAG_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function fmt(v: number | null, unit?: string | null): string {
  if (v === null || v === undefined) return "—";
  if (unit === "$" || unit === "currency") {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (unit === "%") return `${v.toFixed(1)}%`;
  return v.toLocaleString("en-US");
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

// Detail tab: full $ values (no abbreviation) + 2dp %
function fmtDetail(v: number | null, unit?: string | null): string {
  if (v === null || v === undefined) return "—";
  if (unit === "$" || unit === "currency") {
    const abs = Math.abs(v);
    const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return v < 0 ? `-$${formatted}` : `$${formatted}`;
  }
  if (unit === "%") return `${v.toFixed(2)}%`;
  return v.toLocaleString("en-US");
}

function fmtPct2(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function varianceColor(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  return v >= 0 ? "text-green-600" : "text-red-600";
}

function fmtPlanValue(v: number | null, kpi: KpiDefinition): string {
  if (v === null) return "—";
  if (kpi.unit === "%" || kpi.valueType === "percent") return `${v.toFixed(1)}%`;
  if (kpi.valueType === "currency") {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function aggValues(vals: (number | null)[], unit: string | null): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  if (!nums.length) return null;
  if (unit === "%") return nums.reduce((a, b) => a + b, 0) / nums.length; // average
  if (unit === "#") return nums[nums.length - 1]; // end-of-period (stock metric)
  return nums.reduce((a, b) => a + b, 0); // sum (flow metric)
}

function pctChange(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function ragRuleText(
  status: "green" | "amber" | "red",
  greenPct: number,
  amberPct: number,
  direction: "higher_is_better" | "lower_is_better" | "any_variance",
  isOverride: boolean
): string {
  const prefix = isOverride ? "Manual override · " : "";
  if (direction === "any_variance") {
    if (status === "green") return `${prefix}Within ${greenPct}% of plan`;
    if (status === "amber") return `${prefix}${greenPct}–${amberPct}% from plan`;
    return `${prefix}>${amberPct}% from plan`;
  }
  const below = direction === "lower_is_better" ? "above" : "below";
  if (status === "green") return `${prefix}Within ${greenPct}% of plan`;
  if (status === "amber") return `${prefix}${greenPct}–${amberPct}% ${below} plan`;
  return `${prefix}>${amberPct}% ${below} plan`;
}

// ─── Inline editable investor note cell ──────────────────────────────────────

function InvestorNoteCell({
  kpiValueId,
  initialNote,
}: {
  kpiValueId: string | null;
  initialNote: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!kpiValueId) return <span className="text-muted-foreground text-xs">—</span>;

  async function handleSave() {
    setSaving(true);
    try {
      await saveInvestorNoteAction(kpiValueId!, note);
      setEditing(false);
      toast.success("Note saved.");
    } catch {
      toast.error("Failed to save note.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-start gap-1 min-w-[160px]">
        <textarea
          ref={textareaRef}
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="text-xs border border-border rounded px-1.5 py-1 resize-none w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex flex-col gap-1 shrink-0">
          <button type="button" onClick={handleSave} disabled={saving} className="p-0.5 text-green-600 hover:text-green-700">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => { setNote(initialNote ?? ""); setEditing(false); }} className="p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex items-start gap-1 text-left w-full">
      {note ? (
        <span className="text-xs text-foreground/80 line-clamp-2">{note}</span>
      ) : (
        <span className="text-xs text-muted-foreground/50 italic">Add note…</span>
      )}
      <Pencil className="h-2.5 w-2.5 shrink-0 mt-0.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
    </button>
  );
}

// ─── Inline editable plan note cell (Annual Plan section) ────────────────────

function PlanNoteCell({
  planValueId,
  initialNote,
}: {
  planValueId: string;
  initialNote: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await saveInvestorPlanCommentAction(planValueId, note);
      setEditing(false);
      toast.success("Note saved.");
    } catch {
      toast.error("Failed to save note.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-start gap-1 min-w-[160px]">
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="text-xs border border-border rounded px-1.5 py-1 resize-none w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex flex-col gap-1 shrink-0">
          <button type="button" onClick={handleSave} disabled={saving} className="p-0.5 text-green-600 hover:text-green-700">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => { setNote(initialNote ?? ""); setEditing(false); }} className="p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex items-start gap-1 text-left w-full">
      {note ? (
        <span className="text-xs text-foreground/80 line-clamp-2">{note}</span>
      ) : (
        <span className="text-xs text-muted-foreground/50 italic">Add note…</span>
      )}
      <Pencil className="h-2.5 w-2.5 shrink-0 mt-0.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
    </button>
  );
}

// ─── Column resize primitives ─────────────────────────────────────────────────

function ResizeHandle({
  colIdx,
  r,
}: {
  colIdx: number;
  r: RH;
}) {
  return (
    <span
      className="absolute inset-y-0 right-0 w-3 flex items-center justify-center cursor-col-resize z-10 select-none group/rh"
      onMouseDown={(e) => r.startResize(e, colIdx)}
      onDoubleClick={(e) => { e.stopPropagation(); r.autoFit(colIdx); }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="block w-px h-4 bg-transparent group-hover/rh:bg-border transition-colors" />
    </span>
  );
}

function Rth({
  colIdx,
  r,
  children,
  className = "",
  style,
}: {
  colIdx: number;
  r: RH;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isSelected = r.selected.has(colIdx);
  return (
    <th
      data-col-idx={colIdx}
      className={`relative cursor-pointer select-none ${className}`}
      style={{
        ...style,
        ...(isSelected ? { borderBottom: "2px solid #3b82f6" } : {}),
      }}
      onClick={(e) => { if (e.detail === 2) return; r.toggleSelect(e, colIdx); }}
      onDoubleClick={(e) => { e.stopPropagation(); r.autoFit(colIdx); }}
      onMouseDown={(e) => { if (e.ctrlKey || e.metaKey) r.startDragSelect(e, colIdx); }}
    >
      {children}
      <ResizeHandle colIdx={colIdx} r={r} />
    </th>
  );
}

// ─── Plan Viewer (moved from Company Settings Plans tab) ─────────────────────

function PlanViewer({
  companyId,
  isOperator,
}: {
  companyId: string;
  isOperator: boolean;
}) {
  const currentYear = new Date().getFullYear();
  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ versions: PlanVersionData[]; kpiDefs: KpiDefinition[] } | null>(null);
  const [selectedVersionIdx, setSelectedVersionIdx] = useState(0);
  const [investorNote, setInvestorNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingPlanNote, setEditingPlanNote] = useState(false);

  // Column resize — plan sub-tables
  // KPI(0) + Jan-Dec(1-12) + Total(13) + Note(14 opt)
  const planMonthlyR = useResizableColumns([192, ...MONTHS.map(() => 72), 80, ...(isOperator ? [] : [260])]);
  // KPI(0) + Q1-Q4(1-4) + Total(5) + Note(6 opt)
  const planQuarterlyR = useResizableColumns([192, 88, 88, 88, 88, 80, ...(isOperator ? [] : [260])]);
  // KPI(0) + Target(1) + Note(2 opt)
  const planAnnualR = useResizableColumns([192, 120, ...(isOperator ? [] : [260])]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCompanyPlanVersionsAction(companyId, fiscalYear);
      setData(result);
      setSelectedVersionIdx(0);
      if (result.versions[0]) {
        setInvestorNote(result.versions[0].plan.investorNote ?? "");
      } else {
        setInvestorNote("");
      }
    } catch {
      toast.error("Failed to load plan data.");
    } finally {
      setLoading(false);
    }
  }, [companyId, fiscalYear]);

  useEffect(() => { load(); }, [load]);

  // Auto-fit data columns and size note columns to 1.5× KPI width after data loads
  useEffect(() => {
    if (!data) return;
    const raf = requestAnimationFrame(() => {
      const noteMonthly = isOperator ? [] : [MONTHS.length + 2];
      const noteQuarterly = isOperator ? [] : [6];
      const noteAnnual = isOperator ? [] : [2];
      planMonthlyR.autoFitIndices(Array.from({ length: MONTHS.length + 2 }, (_, i) => i), noteMonthly);
      planQuarterlyR.autoFitIndices([0, 1, 2, 3, 4, 5], noteQuarterly);
      planAnnualR.autoFitIndices([0, 1], noteAnnual);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const v = data.versions[selectedVersionIdx];
    if (!v) return;
    setInvestorNote(v.plan.investorNote ?? "");
    setEditingPlanNote(false);
  }, [selectedVersionIdx, data]);

  async function handleSave() {
    if (!data) return;
    const version = data.versions[selectedVersionIdx];
    if (!version) return;
    setSaving(true);
    try {
      await saveInvestorPlanNoteAction(version.plan.id, investorNote);
      toast.success("Comments saved.");
      setEditingPlanNote(false);
      load();
    } catch {
      toast.error("Failed to save comments.");
    } finally {
      setSaving(false);
    }
  }

  const version = data?.versions[selectedVersionIdx];
  const kpiDefs = data?.kpiDefs ?? [];

  const annualValueByKpi: Record<string, KpiPlanValue> = {};
  const monthlyValueByKpiMonth: Record<string, Record<number, KpiPlanValue>> = {};
  if (version) {
    for (const pv of version.values) {
      if (pv.periodMonth === null) {
        annualValueByKpi[pv.kpiDefinitionId] = pv;
      } else {
        if (!monthlyValueByKpiMonth[pv.kpiDefinitionId]) monthlyValueByKpiMonth[pv.kpiDefinitionId] = {};
        monthlyValueByKpiMonth[pv.kpiDefinitionId][pv.periodMonth] = pv;
      }
    }
  }

  const monthlyKpis = kpiDefs.filter((k) => k.planGranularity === "monthly");
  const quarterlyKpis = kpiDefs.filter((k) => k.planGranularity === "quarterly_end" || k.planGranularity === "quarterly_total");
  const annualKpis = kpiDefs.filter((k) => !k.planGranularity || k.planGranularity === "annual_end" || k.planGranularity === "annual_total" || k.planGranularity === "annual");

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="space-y-6 py-4">
      {/* Year selector */}
      <div className="flex items-center gap-3 px-6">
        <span className="text-sm font-medium">Fiscal Year</span>
        <div className="flex gap-1">
          {yearOptions.map((y) => (
            <button
              key={y}
              onClick={() => setFiscalYear(y)}
              className={`px-3 py-1 text-sm rounded-md border transition-colors ${
                fiscalYear === y ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground py-8 text-center px-6">Loading plan data…</div>}

      {!loading && data && data.versions.length === 0 && (
        <div className="text-center py-12 text-muted-foreground px-6">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No plan submitted for {fiscalYear}.</p>
          <p className="text-xs mt-1">The operator can submit a plan via the company chat (Company Settings → copy chat link).</p>
        </div>
      )}

      {!loading && version && (
        <>
          {/* Version tabs */}
          {data!.versions.length > 1 && (
            <div className="flex items-center gap-2 px-6">
              <span className="text-xs text-muted-foreground font-medium">Version:</span>
              <div className="flex gap-1 flex-wrap">
                {data!.versions.map((v, idx) => {
                  const label = `v${v.plan.version}`;
                  return (
                    <button
                      key={v.plan.id}
                      onClick={() => setSelectedVersionIdx(idx)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        idx === selectedVersionIdx ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted"
                      }`}
                    >
                      {label}{!v.plan.submittedAt && <span className="ml-1 opacity-60">(draft)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Plan header */}
          <div className="bg-muted/30 rounded-lg border border-border p-4 flex flex-wrap gap-4 items-start mx-6">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full mt-1 ${version.plan.submittedAt ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${version.plan.submittedAt ? "bg-green-500" : "bg-amber-400"}`} />
                {version.plan.submittedAt ? "Submitted" : "Draft"}
              </span>
            </div>
            {version.plan.submittedAt && (
              <div>
                <p className="text-xs text-muted-foreground">Submitted</p>
                <p className="text-sm mt-1">{new Date(version.plan.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Version</p>
              <p className="text-sm mt-1">
                {`v${version.plan.version}`}
                {data!.versions.length > 1 && <span className="text-muted-foreground ml-1">({selectedVersionIdx + 1} of {data!.versions.length})</span>}
              </p>
            </div>
            {version.plan.note && (
              <div className="w-full">
                <p className="text-xs text-muted-foreground">Operator Note</p>
                <p className="text-sm mt-1 italic text-muted-foreground">{version.plan.note}</p>
              </div>
            )}
            {!isOperator && (
              <div className="w-full">
                <p className="text-xs text-muted-foreground">Investor Note</p>
                {editingPlanNote ? (
                  <div className="flex items-start gap-1 mt-1">
                    <textarea
                      autoFocus
                      value={investorNote}
                      onChange={(e) => setInvestorNote(e.target.value)}
                      rows={2}
                      className="text-sm border border-border rounded px-1.5 py-1 resize-none w-full max-w-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <div className="flex flex-col gap-1 shrink-0">
                      <button type="button" onClick={handleSave} disabled={saving} className="p-0.5 text-green-600 hover:text-green-700">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => { setInvestorNote(version.plan.investorNote ?? ""); setEditingPlanNote(false); }} className="p-0.5 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setEditingPlanNote(true)} className="group flex items-start gap-1 text-left mt-1">
                    {investorNote ? (
                      <span className="text-sm text-foreground/80">{investorNote}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground/50 italic">Add note…</span>
                    )}
                    <Pencil className="h-2.5 w-2.5 shrink-0 mt-1 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </button>
                )}
              </div>
            )}
            {/* Sources panel */}
            {version.plan.submittedAt && (
              <div className="w-full">
                <p className="text-xs text-muted-foreground">Sources</p>
                <div className="mt-1 space-y-1.5">
                  {(() => {
                    const csvName = `${version.plan.fiscalYear}_plan_kpis.csv`;
                    return (
                      <div className="flex items-start gap-1.5">
                        <a
                          href={`/api/export/plan-kpis/${version.plan.id}`}
                          download={csvName}
                          className="flex items-center gap-1 text-sm text-foreground/80 hover:text-foreground min-w-0"
                          title={csvName}
                        >
                          <Download className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{csvName}</span>
                          <span className="text-xs text-muted-foreground shrink-0 ml-1">
                            ({new Date(version.plan.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{version.submittedByName && ` · ${version.submittedByName}`})
                          </span>
                        </a>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Plan values — grouped by granularity */}
          <div className="space-y-4">
            {/* Monthly KPIs */}
            {monthlyKpis.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider px-6">Monthly Targets</p>
                <div className="overflow-x-auto">
                  <table ref={planMonthlyR.tableRef} className="text-sm border border-border rounded-lg overflow-hidden" style={{ tableLayout: "fixed", width: "max-content" }}>
                    <colgroup>
                      {planMonthlyR.widths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <Rth colIdx={0} r={planMonthlyR} className="text-left px-4 py-2.5 font-medium text-muted-foreground sticky left-0 bg-muted/30">KPI</Rth>
                        {MONTHS.map((m, i) => (
                          <Rth key={m} colIdx={i + 1} r={planMonthlyR} className="px-3 py-2.5 text-right font-medium text-muted-foreground">{m}</Rth>
                        ))}
                        <Rth colIdx={MONTHS.length + 1} r={planMonthlyR} className="px-3 py-2.5 text-right font-medium text-muted-foreground border-l border-border">Total</Rth>
                        {!isOperator && <Rth colIdx={MONTHS.length + 2} r={planMonthlyR} className="px-4 py-2.5 text-left font-medium text-muted-foreground">Investor Note</Rth>}
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyKpis.map((kpi) => {
                        const monthMap = monthlyValueByKpiMonth[kpi.id] ?? {};
                        const firstPv = monthMap[1] ?? Object.values(monthMap)[0];
                        return (
                          <tr key={kpi.id} className="border-b border-border/50 hover:bg-muted/10">
                            <td className="px-4 py-2.5 sticky left-0 bg-white font-medium truncate">{kpi.label}</td>
                            {Array.from({ length: 12 }, (_, i) => {
                              const pv = monthMap[i + 1];
                              return (
                                <td key={i} className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                                  {pv ? fmtPlanValue(pv.value, kpi) : "—"}
                                </td>
                              );
                            })}
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground border-l border-border font-medium">
                              {kpi.valueType === "currency" ? (() => {
                                const vals = Array.from({ length: 12 }, (_, i) => monthMap[i + 1]?.value ?? null);
                                const sum = vals.reduce<number | null>((acc, v) => v !== null ? (acc ?? 0) + v : acc, null);
                                return sum !== null ? fmtPlanValue(sum, kpi) : "—";
                              })() : "—"}
                            </td>
                            {!isOperator && (
                              <td className="px-4 py-2.5">
                                {firstPv
                                  ? <PlanNoteCell planValueId={firstPv.id} initialNote={firstPv.investorComment ?? null} />
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Quarterly KPIs */}
            {quarterlyKpis.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider px-6">Quarterly Targets</p>
                <div className="overflow-x-auto">
                <table ref={planQuarterlyR.tableRef} className="text-sm border border-border rounded-lg overflow-hidden" style={{ tableLayout: "fixed", width: "max-content" }}>
                  <colgroup>
                    {planQuarterlyR.widths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <Rth colIdx={0} r={planQuarterlyR} className="text-left px-4 py-2.5 font-medium text-muted-foreground">KPI</Rth>
                      {["Q1", "Q2", "Q3", "Q4"].map((q, i) => (
                        <Rth key={q} colIdx={i + 1} r={planQuarterlyR} className="px-3 py-2.5 text-right font-medium text-muted-foreground">{q}</Rth>
                      ))}
                      <Rth colIdx={5} r={planQuarterlyR} className="px-3 py-2.5 text-right font-medium text-muted-foreground border-l border-border">Total</Rth>
                      {!isOperator && <Rth colIdx={6} r={planQuarterlyR} className="px-4 py-2.5 text-left font-medium text-muted-foreground">Investor Note</Rth>}
                    </tr>
                  </thead>
                  <tbody>
                    {quarterlyKpis.map((kpi) => {
                      const qMap = monthlyValueByKpiMonth[kpi.id] ?? {};
                      const firstPv = qMap[101];
                      return (
                        <tr key={kpi.id} className="border-b border-border/50 hover:bg-muted/10">
                          <td className="px-4 py-2.5 font-medium truncate">{kpi.label}</td>
                          {[101, 102, 103, 104].map((qKey) => {
                            const pv = qMap[qKey];
                            return (
                              <td key={qKey} className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                                {pv ? fmtPlanValue(pv.value, kpi) : "—"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground border-l border-border font-medium">
                            {kpi.valueType === "currency" ? (() => {
                              const vals = [101, 102, 103, 104].map((k) => qMap[k]?.value ?? null);
                              const sum = vals.reduce<number | null>((acc, v) => v !== null ? (acc ?? 0) + v : acc, null);
                              return sum !== null ? fmtPlanValue(sum, kpi) : "—";
                            })() : "—"}
                          </td>
                          {!isOperator && (
                            <td className="px-4 py-2.5">
                              {firstPv
                                ? <PlanNoteCell planValueId={firstPv.id} initialNote={firstPv.investorComment ?? null} />
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {/* Annual KPIs */}
            {annualKpis.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider px-6">Annual Targets</p>
                <div className="overflow-x-auto">
                <table ref={planAnnualR.tableRef} className="text-sm border border-border rounded-lg overflow-hidden" style={{ tableLayout: "fixed", width: "max-content" }}>
                  <colgroup>
                    {planAnnualR.widths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <Rth colIdx={0} r={planAnnualR} className="text-left px-4 py-2.5 font-medium text-muted-foreground">KPI</Rth>
                      <Rth colIdx={1} r={planAnnualR} className="text-right px-4 py-2.5 font-medium text-muted-foreground">Annual Target</Rth>
                      {!isOperator && <Rth colIdx={2} r={planAnnualR} className="text-left px-4 py-2.5 font-medium text-muted-foreground">Investor Note</Rth>}
                    </tr>
                  </thead>
                  <tbody>
                    {annualKpis.map((kpi) => {
                      const pv = annualValueByKpi[kpi.id];
                      return (
                        <tr key={kpi.id} className="border-b border-border/50 hover:bg-muted/10">
                          <td className="px-4 py-2.5 font-medium truncate">{kpi.label}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {pv ? fmtPlanValue(pv.value, kpi) : "—"}
                          </td>
                          {!isOperator && (
                            <td className="px-4 py-2.5">
                              {pv
                                ? <PlanNoteCell planValueId={pv.id} initialNote={pv.investorComment ?? null} />
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>

        </>
      )}
    </div>
  );
}

// ─── Main Client ──────────────────────────────────────────────────────────────

export function AnalyticsClient({
  companies,
  allPeriods,
  selectedCompanyId,
  selectedPeriodId,
  analytics,
  isOperator,
  filterOptions,
  firmId,
  investmentDate,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentStatus = searchParams.get("status") ?? "current";

  const [activeTab, setActiveTab] = useState<string>("overview");
  const [planOpen, setPlanOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"monthly" | "quarterly" | "ytd" | "fullYear">("monthly");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedQuarter, setSelectedQuarter] = useState<1 | 2 | 3 | 4>(
    Math.ceil((new Date().getMonth() + 1) / 3) as 1 | 2 | 3 | 4
  );
  const [selectedPeriodicSubmissionId, setSelectedPeriodicSubmissionId] = useState<string | null>(null);
  const [periodicVersionOverlay, setPeriodicVersionOverlay] = useState<Record<string, number | null> | null>(null);
  const [editingSubmissionNote, setEditingSubmissionNote] = useState(false);
  const [submissionInvestorNote, setSubmissionInvestorNote] = useState("");
  const [savingSubmissionNote, setSavingSubmissionNote] = useState(false);

  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`/analytics?${params.toString()}`);
  }

  // Sync default company to URL on mount so the chat panel can read it
  useEffect(() => {
    if (selectedCompanyId && !searchParams.get("company")) {
      const params = new URLSearchParams(window.location.search);
      params.set("company", selectedCompanyId);
      router.replace(`/analytics?${params.toString()}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPeriod = selectedPeriodId
    ? allPeriods.find((p) => p.id === selectedPeriodId) ?? null
    : null;
  const selectedPeriodYM = selectedPeriod ? selectedPeriod.periodStart.slice(0, 7) : null;

  // Periodic version data
  const periodicVersions = selectedPeriodYM && analytics
    ? (analytics.submissionVersionsByPeriod[selectedPeriodYM] ?? [])
    : [];
  const latestPeriodicVersion = periodicVersions[0] ?? null;
  const activePeriodicVersion = selectedPeriodicSubmissionId
    ? periodicVersions.find((v) => v.submissionId === selectedPeriodicSubmissionId) ?? latestPeriodicVersion
    : latestPeriodicVersion;

  // Reset version selection when period changes
  useEffect(() => {
    setSelectedPeriodicSubmissionId(null);
    setPeriodicVersionOverlay(null);
    setEditingSubmissionNote(false);
  }, [selectedPeriodYM]);

  // Sync investor note when active version changes
  useEffect(() => {
    setSubmissionInvestorNote(activePeriodicVersion?.investorNote ?? "");
    setEditingSubmissionNote(false);
  }, [activePeriodicVersion?.submissionId]);

  async function handleSaveSubmissionNote() {
    if (!activePeriodicVersion) return;
    setSavingSubmissionNote(true);
    try {
      await saveInvestorSubmissionNoteAction(activePeriodicVersion.submissionId, submissionInvestorNote);
      setEditingSubmissionNote(false);
      toast.success("Note saved.");
    } finally {
      setSavingSubmissionNote(false);
    }
  }

  // Fetch kpi values when a non-latest version is selected
  useEffect(() => {
    if (!selectedPeriodicSubmissionId || selectedPeriodicSubmissionId === latestPeriodicVersion?.submissionId) {
      setPeriodicVersionOverlay(null);
      return;
    }
    fetch(`/api/submissions/${selectedPeriodicSubmissionId}/kpi-values`)
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, number | null> = {};
        for (const v of (data.values ?? [])) {
          map[v.kpiKey] = v.actual;
        }
        setPeriodicVersionOverlay(map);
      })
      .catch(() => setPeriodicVersionOverlay(null));
  }, [selectedPeriodicSubmissionId, latestPeriodicVersion?.submissionId]);

  const km = analytics?.keyMetrics;

  // Chart data — full history
  const kpiMeta: KpiMeta[] = [];
  const chartData: Record<string, string | number | null>[] = [];
  if (analytics) {
    const numericKpiKeys = new Set(
      analytics.rawData.filter((r) => typeof r.actual === "number").map((r) => r.kpiKey)
    );
    const seen = new Set<string>();
    for (const r of analytics.rawData) {
      if (!seen.has(r.kpiKey) && numericKpiKeys.has(r.kpiKey)) {
        seen.add(r.kpiKey);
        kpiMeta.push({ key: r.kpiKey, label: r.kpiLabel, unit: r.unit });
      }
    }
    const byPeriod = new Map<string, Record<string, string | number | null>>();
    for (const r of analytics.rawData) {
      if (typeof r.actual !== "number") continue;
      const p = r.period.slice(0, 7);
      if (!byPeriod.has(p)) byPeriod.set(p, { period: p });
      byPeriod.get(p)![r.kpiKey] = r.actual;
    }
    chartData.push(
      ...[...byPeriod.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v)
    );
  }

  // KPI Health — always uses most recent data, not period-filtered
  const latestValues: Record<string, { value: number; unit: string | null; label: string; ragEffective: "green" | "amber" | "red" | null }> = {};
  if (analytics?.rawData.length) {
    const seen = new Set<string>();
    for (let i = analytics.rawData.length - 1; i >= 0; i--) {
      const r = analytics.rawData[i];
      if (!seen.has(r.kpiKey) && typeof r.actual === "number") {
        seen.add(r.kpiKey);
        latestValues[r.kpiKey] = { value: r.actual, unit: r.unit, label: r.kpiLabel, ragEffective: r.ragEffective };
      }
    }
  }

  // Period Detail data — apply version overlay if a non-latest version is selected
  const periodRows = (selectedPeriodYM && analytics
    ? analytics.rawData.filter((r) => r.period.slice(0, 7) === selectedPeriodYM)
    : []).map((r) =>
      periodicVersionOverlay
        ? { ...r, actual: periodicVersionOverlay[r.kpiKey] ?? null }
        : r
    );
  const hasPlanData = periodRows.some((r) => r.plan !== null);
  const hasYoY = periodRows.some((r) => r.priorYearActual !== null);

  // Compute YTD through month early — needed for hook column count initialization
  const ytdThroughMonth = analytics
    ? (() => {
        const yd = analytics.rawData.filter((r) => r.period.startsWith(`${selectedYear}-`));
        return yd.length > 0 ? Math.max(...yd.map((r) => parseInt(r.period.slice(5, 7)))) : null;
      })()
    : null;

  // Column resize — detail tab tables
  // KPI(0), Actual(1), [Status(2), Plan(3), Var%(4)], MoM%(5), YoY%(6), Note(7), InvNote(8 opt)
  const monthlyR = useResizableColumns([
    192, 88,
    ...(hasPlanData ? [88, 64, 80] : []),
    64, 64,
    260,
    ...(!isOperator ? [260] : []),
  ]);
  // KPI(0) + 3 months + Actual(4) + Status(5) + Plan(6) + Var%(7) + QoQ%(8) + YoY%(9) + Note(10) + InvestorNote(11 opt)
  const quarterlyR = useResizableColumns([192, 60, 60, 60, 88, 88, 64, 64, 64, 80, 260, ...(!isOperator ? [260] : [])]);
  const ytdR = useResizableColumns([192, ...Array.from({ length: ytdThroughMonth ?? 0 }, () => 60), 88, 88, 64, 64, 88]);
  const fullYearR = useResizableColumns([192, 80, ...MONTHS.map(() => 60), 80, 64, 80, 64]);

  // Auto-fit on view mode switch or date change.
  // requestAnimationFrame defers measurement until after the browser has laid out the table,
  // which guarantees cells contain their rendered content before we measure them.
  useEffect(() => {
    if (viewMode !== "monthly") return;
    // Guard: wait for useResizableColumns to finish its own reset before measuring.
    // When hasPlanData flips, the column count changes (e.g. 6→9) and the hook
    // resets widths asynchronously. If we measure before that reset commits we get
    // stale col elements and the fitted widths are immediately overwritten.
    const expectedCols = 5 + (hasPlanData ? 3 : 0) + (!isOperator ? 1 : 0);
    if (monthlyR.widths.length !== expectedCols) return;
    const raf = requestAnimationFrame(() => {
      const n = monthlyR.widths.length;
      const noteCount = isOperator ? 1 : 2;
      monthlyR.autoFitIndices(
        Array.from({ length: n - noteCount }, (_, i) => i),
        Array.from({ length: noteCount }, (_, i) => n - noteCount + i)
      );
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedPeriodId, hasPlanData, monthlyR.widths.length]);

  useEffect(() => {
    if (viewMode !== "quarterly") return;
    const raf = requestAnimationFrame(() => {
      quarterlyR.autoFitIndices(
        Array.from({ length: 10 }, (_, i) => i),
        isOperator ? [10] : [10, 11]
      );
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedQuarter, selectedYear]);

  useEffect(() => {
    if (viewMode !== "ytd") return;
    const raf = requestAnimationFrame(() => {
      ytdR.autoFitIndices(Array.from({ length: ytdR.widths.length }, (_, i) => i));
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedYear]);

  useEffect(() => {
    if (viewMode !== "fullYear") return;
    const raf = requestAnimationFrame(() => {
      fullYearR.autoFitIndices(Array.from({ length: fullYearR.widths.length }, (_, i) => i));
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedYear]);

  // Historical Raw Data
  const rawPeriods = analytics
    ? [...new Set(analytics.rawData.map((r) => r.period.slice(0, 7)))].sort().reverse()
    : [];
  const kpiOrder: { kpiKey: string; kpiLabel: string; unit: string | null }[] = [];
  if (analytics) {
    const seen = new Set<string>();
    for (const r of analytics.rawData) {
      if (!seen.has(r.kpiKey)) {
        seen.add(r.kpiKey);
        kpiOrder.push({ kpiKey: r.kpiKey, kpiLabel: r.kpiLabel, unit: r.unit });
      }
    }
  }
  type RawRow = NonNullable<typeof analytics>["rawData"][0];
  const cellMap = new Map<string, Map<string, RawRow>>();
  if (analytics) {
    for (const r of analytics.rawData) {
      const p = r.period.slice(0, 7);
      if (!cellMap.has(r.kpiKey)) cellMap.set(r.kpiKey, new Map());
      cellMap.get(r.kpiKey)!.set(p, r);
    }
  }

  // ── Derived data for view modes ────────────────────────────────────────────

  const availableYears = analytics
    ? [...new Set(analytics.rawData.map((r) => parseInt(r.period.slice(0, 4))))].sort().reverse()
    : [];

  // Monthly: prior month YM for MoM%
  const prevMonthYM = selectedPeriodYM
    ? (() => {
        const [y, m] = selectedPeriodYM.split("-").map(Number);
        const d = new Date(y, m - 2, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      })()
    : null;

  // Quarterly
  const qMonths = [1, 2, 3].map((i) => (selectedQuarter - 1) * 3 + i);
  const prevQ =
    selectedQuarter === 1
      ? { year: selectedYear - 1, q: 4 as const }
      : { year: selectedYear, q: (selectedQuarter - 1) as 1 | 2 | 3 | 4 };
  const prevQMonths = [1, 2, 3].map((i) => (prevQ.q - 1) * 3 + i);

  const quarterlyRows = analytics
    ? kpiOrder.map(({ kpiKey, kpiLabel, unit }) => {
        const qRows = qMonths.map(
          (m) => cellMap.get(kpiKey)?.get(`${selectedYear}-${String(m).padStart(2, "0")}`) ?? null
        );
        const pqRows = prevQMonths.map(
          (m) => cellMap.get(kpiKey)?.get(`${prevQ.year}-${String(m).padStart(2, "0")}`) ?? null
        );
        const qActual = aggValues(qRows.map((r) => (typeof r?.actual === "number" ? r.actual : null)), unit);
        const qPlanGranularity = qRows.find((r) => r?.planGranularity)?.planGranularity ?? null;
        const annualTarget = qRows.find((r) => r?.planAnnualTarget !== null)?.planAnnualTarget ?? null;
        // For annual_total: use annualTarget÷4. For end metrics: use last non-null. Otherwise: aggValues.
        let qPlan: number | null;
        if (annualTarget !== null && (qPlanGranularity === "annual_total" || qPlanGranularity === "annual" || qPlanGranularity === null)) {
          qPlan = annualTarget / 4;
        } else if (qPlanGranularity === "annual_end" || qPlanGranularity === "quarterly_end") {
          qPlan = [...qRows].reverse().find((r) => r?.plan !== null)?.plan ?? null;
        } else {
          qPlan = aggValues(qRows.map((r) => r?.plan ?? null), unit);
        }
        // Quarterly plan tooltip
        let qPlanTooltip: string | null = null;
        if (annualTarget !== null && (qPlanGranularity === "annual_total" || qPlanGranularity === "annual" || qPlanGranularity === null)) {
          const fmtAnn = unit === "$" ? `$${Math.round(annualTarget).toLocaleString("en-US")}` : annualTarget.toLocaleString("en-US");
          qPlanTooltip = `Annual target: ${fmtAnn} (÷4 quarterly run-rate)`;
        }
        const qVar = qActual !== null && qPlan !== null ? qActual - qPlan : null;
        const qVarPct = qVar !== null && qPlan ? (qVar / Math.abs(qPlan)) * 100 : null;
        const prevQActual = aggValues(pqRows.map((r) => (typeof r?.actual === "number" ? r.actual : null)), unit);
        const qoqPct = pctChange(qActual, prevQActual);
        const pyQActual = aggValues(qRows.map((r) => r?.priorYearActual ?? null), unit);
        const yoyPct = pctChange(qActual, pyQActual);
        const lastRow = [...qRows].reverse().find((r) => r !== null);
        return {
          kpiKey, kpiLabel, unit, qActual, qPlan, qPlanTooltip, qVar, qVarPct,
          prevQActual, qoqPct, pyQActual, yoyPct,
          qoqDelta: qActual !== null && prevQActual !== null ? qActual - prevQActual : null,
          yoyDelta: qActual !== null && pyQActual !== null ? qActual - pyQActual : null,
          ragEffective: lastRow?.ragEffective ?? null,
          ragOverride: lastRow?.ragOverride ?? false,
          ragGreenPct: lastRow?.ragGreenPct ?? 5,
          ragAmberPct: lastRow?.ragAmberPct ?? 15,
          ragDirection: lastRow?.ragDirection ?? "higher_is_better" as const,
          note: qRows.map((r) => r?.note).find(Boolean) ?? null,
          kpiValueId: lastRow?.kpiValueId ?? null,
          investorNote: lastRow?.investorNote ?? null,
          monthActuals: qRows.map((r) => (typeof r?.actual === "number" ? r.actual : null)),
        };
      })
    : [];

  // YTD
  const ytdLatestYM = ytdThroughMonth
    ? `${selectedYear}-${String(ytdThroughMonth).padStart(2, "0")}`
    : null;

  const ytdRows = analytics
    ? kpiOrder.map(({ kpiKey, kpiLabel, unit }) => {
        const latestRow = ytdLatestYM ? cellMap.get(kpiKey)?.get(ytdLatestYM) : null;
        const pyActuals = ytdThroughMonth
          ? Array.from({ length: ytdThroughMonth }, (_, i) =>
              cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`)?.priorYearActual ?? null
            )
          : [];
        const monthActuals = ytdThroughMonth
          ? Array.from({ length: ytdThroughMonth }, (_, i) => {
              const r = cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`);
              return typeof r?.actual === "number" ? r.actual : null;
            })
          : [];
        const pyYtdActual = aggValues(pyActuals, unit);
        return {
          kpiKey, kpiLabel, unit,
          ytdActual: latestRow?.ytdActual ?? null,
          ytdPlan: latestRow?.ytdPlan ?? null,
          ytdVar: latestRow?.ytdVariance ?? null,
          ytdVarPct: latestRow?.ytdVariancePct ?? null,
          pyYtdActual,
          yoyPct: pctChange(latestRow?.ytdActual ?? null, pyYtdActual),
          yoyDelta: latestRow?.ytdActual != null && pyYtdActual !== null ? latestRow.ytdActual - pyYtdActual : null,
          ragEffective: latestRow?.ragEffective ?? null,
          ragOverride: latestRow?.ragOverride ?? false,
          ragGreenPct: latestRow?.ragGreenPct ?? 5,
          ragAmberPct: latestRow?.ragAmberPct ?? 15,
          ragDirection: latestRow?.ragDirection ?? "higher_is_better" as const,
          monthActuals,
        };
      })
    : [];

  // Full Year
  const fullYearRows = analytics
    ? kpiOrder.map(({ kpiKey, kpiLabel, unit }) => {
        const monthActuals = Array.from({ length: 12 }, (_, i) => {
          const row = cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`);
          return typeof row?.actual === "number" ? row.actual : null;
        });
        const monthPlans = Array.from({ length: 12 }, (_, i) =>
          cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`)?.plan ?? null
        );
        const monthPlansGranularities = Array.from({ length: 12 }, (_, i) =>
          cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`)?.planGranularity ?? null
        );
        const pyActuals = Array.from({ length: 12 }, (_, i) =>
          cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`)?.priorYearActual ?? null
        );
        const fyTotal = aggValues(monthActuals, unit);
        const fyPlanGranularity = monthPlansGranularities.find((g) => g !== null) ?? null;
        const annualTarget2 = monthPlansGranularities.map((g, i) =>
          g === "annual_total" || g === "annual" || g === null
            ? (cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`)?.planAnnualTarget ?? null)
            : null
        ).find((v) => v !== null) ?? null;
        // For monthly-granularity KPIs, use planFyTotal (sum of all 12 plan values) so
        // attainment is always vs the full-year target, not just submitted months.
        const planFyTotalFromData = fyPlanGranularity === "monthly"
          ? (Array.from({ length: 12 }, (_, i) =>
              cellMap.get(kpiKey)?.get(`${selectedYear}-${String(i + 1).padStart(2, "0")}`)?.planFyTotal ?? null
            ).find((v) => v !== null) ?? null)
          : null;
        let fyPlan: number | null;
        if (planFyTotalFromData !== null) {
          fyPlan = planFyTotalFromData;
        } else if (annualTarget2 !== null) {
          fyPlan = annualTarget2;
        } else if (fyPlanGranularity === "annual_end") {
          fyPlan = monthPlans.find((v) => v !== null) ?? null;
        } else if (fyPlanGranularity === "quarterly_end") {
          fyPlan = [...monthPlans].reverse().find((v) => v !== null) ?? null;
        } else {
          fyPlan = aggValues(monthPlans, unit);
        }
        const pyFyTotal = aggValues(pyActuals, unit);
        const attainmentPct =
          fyTotal !== null && fyPlan !== null && fyPlan !== 0 ? (fyTotal / fyPlan) * 100 : null;
        const yoyPct = pctChange(fyTotal, pyFyTotal);
        return { kpiKey, kpiLabel, unit, monthActuals, fyTotal, fyPlan, attainmentPct, pyFyTotal, yoyPct };
      })
    : [];

  // Investment date — derived helpers for table separators and chart ReferenceLine
  const investmentPeriod = investmentDate ? investmentDate.slice(0, 7) : null; // YYYY-MM
  const investmentYear = investmentDate ? parseInt(investmentDate.slice(0, 4)) : null;
  const investmentMonth = investmentDate ? parseInt(investmentDate.slice(5, 7)) : null; // 1-indexed

  const TAB_CLASS = "rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground";

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Company Data</h1>
        <div className="flex items-center gap-3">
          {analytics && (
            <a
              href={`/api/export/analytics?companyId=${selectedCompanyId}`}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <Download className="h-4 w-4" />
              Export Data
            </a>
          )}
        </div>
      </div>

      {/* Company selector + filters (investors only) */}
      {!isOperator && (
        <div className="bg-white rounded-xl border border-border p-5 mb-8">
          <div className="flex items-center gap-3 flex-wrap">
            <FilterBarUrl funds={filterOptions.funds} industries={filterOptions.industries} hideStatus />
            <select
              className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={currentStatus}
              onChange={(e) => updateQuery({ status: e.target.value, company: null })}
            >
              <option value="all">All Statuses</option>
              <option value="current">Currently Held</option>
              <option value="exited">Exited</option>
            </select>
          </div>
          <div className="mt-4">
            <div className="mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Companies{companies.length > 0 ? ` · ${companies.length}` : ""}
              </span>
            </div>
            {companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No companies match your filters.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => updateQuery({ company: c.id, period: null })}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      c.id === selectedCompanyId
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-muted/40 border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!analytics && (
        <div className="text-center py-24 text-muted-foreground">
          <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>Select a company to view analytics.</p>
        </div>
      )}

      {analytics && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="justify-start rounded-none bg-transparent border-b border-border px-0 h-auto gap-0 w-full mb-8 [&>*]:flex-none">
            <TabsTrigger value="overview" className={TAB_CLASS}>Overview</TabsTrigger>
            <TabsTrigger value="detail" className={TAB_CLASS}>Detail</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          <TabsContent value="overview">
            {/* Period selector */}
            <div className="flex items-center gap-2 mb-6">
              <label className="text-sm font-medium text-muted-foreground">Period</label>
              <select
                value={selectedPeriodId ?? ""}
                onChange={(e) => updateQuery({ period: e.target.value || null })}
                className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">Latest</option>
                {allPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {format(new Date(p.periodStart + "T12:00:00"), "MMM yyyy")}
                  </option>
                ))}
              </select>
              {selectedPeriodId && (
                <button type="button" onClick={() => updateQuery({ period: null })} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Clear ×
                </button>
              )}
              {selectedPeriodYM && (
                <span className="text-xs text-muted-foreground">
                  Showing {format(new Date(selectedPeriodYM + "-01T12:00:00"), "MMMM yyyy")}
                </span>
              )}
            </div>

            {/* Key Metrics */}
            {km && (() => {
              // When period selected, pull actuals from periodRows; otherwise use server-computed TTM/latest
              const pRev = periodRows.find((r) => r.kpiKey === "revenue" && typeof r.actual === "number")?.actual as number | null ?? null;
              const pEbitda = periodRows.find((r) => r.kpiKey === "ebitda" && typeof r.actual === "number")?.actual as number | null ?? null;
              const pCash = periodRows.find((r) => r.kpiKey === "cash_balance" && typeof r.actual === "number")?.actual as number | null
                ?? periodRows.find((r) => r.unit === "$" && r.kpiLabel.toLowerCase().includes("cash") && typeof r.actual === "number")?.actual as number | null
                ?? null;
              const hasPeriod = !!selectedPeriodYM && periodRows.length > 0;
              return (
                <div className="mb-6">
                  <h2 className="font-semibold text-sm mb-3">Key Metrics{hasPeriod ? "" : " Summary"}</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="Total Submissions" value={km.totalSubmissions} iconBg="bg-blue-50" icon={<ClipboardList className="h-5 w-5 text-blue-500" />} />
                    <StatCard
                      label={hasPeriod ? "Revenue" : "Avg Monthly Revenue (TTM)"}
                      value={fmt(hasPeriod ? pRev : km.avgMonthlyRevenueTtm, "$")}
                      iconBg="bg-green-50"
                      icon={<DollarSign className="h-5 w-5 text-green-500" />}
                    />
                    <StatCard
                      label={hasPeriod ? "EBITDA" : "Avg Monthly EBITDA (TTM)"}
                      value={fmt(hasPeriod ? pEbitda : km.avgMonthlyEbitdaTtm, "$")}
                      iconBg="bg-purple-50"
                      icon={<TrendingUp className="h-5 w-5 text-purple-500" />}
                    />
                    <StatCard
                      label={hasPeriod ? "Cash Balance" : "Current Cash Balance"}
                      value={fmt(hasPeriod ? pCash : km.currentCash, "$")}
                      iconBg="bg-yellow-50"
                      icon={<Wallet className="h-5 w-5 text-yellow-500" />}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Performance Trends */}
            {chartData.length > 0 && kpiMeta.length > 0 && (
              <div className="bg-white rounded-xl border border-border p-6 mb-6">
                <h2 className="font-semibold text-sm mb-4">Performance Trends</h2>
                <TrendChart data={chartData} kpiMeta={kpiMeta} highlightPeriod={selectedPeriodYM} investmentPeriod={investmentPeriod} />
              </div>
            )}

            {/* KPI Health — period-specific when period selected, otherwise latest */}
            {(() => {
              const displayValues = selectedPeriodYM && periodRows.length > 0
                ? Object.fromEntries(
                    periodRows
                      .filter((r) => typeof r.actual === "number")
                      .map((r) => [r.kpiKey, { value: r.actual as number, unit: r.unit, label: r.kpiLabel, ragEffective: r.ragEffective }])
                  )
                : latestValues;
              return Object.keys(displayValues).length > 0
                ? <KpiHealthChart thresholds={analytics.thresholds} latestValues={displayValues} />
                : null;
            })()}
          </TabsContent>

          {/* ── DETAIL ───────────────────────────────────────────────────── */}
          <TabsContent value="detail" className="space-y-6">

            {/* ── Controls row ─────────────────────────────────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* View mode toggle */}
              <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
                {(["monthly", "quarterly", "ytd", "fullYear"] as const).map((mode, i) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-3 py-1.5 font-medium transition-colors ${i > 0 ? "border-l border-border" : ""} ${
                      viewMode === mode ? "bg-foreground text-background" : "hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {mode === "monthly" ? "Monthly" : mode === "quarterly" ? "Quarterly" : mode === "ytd" ? "YTD" : "Full Year"}
                  </button>
                ))}
              </div>

              {/* Monthly: period dropdown */}
              {viewMode === "monthly" && (
                <>
                  <select
                    value={selectedPeriodId ?? ""}
                    onChange={(e) => updateQuery({ period: e.target.value || null })}
                    className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">— Select a period —</option>
                    {allPeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {format(new Date(p.periodStart + "T12:00:00"), "MMM yyyy")}
                      </option>
                    ))}
                  </select>
                  {selectedPeriodId && (
                    <button type="button" onClick={() => updateQuery({ period: null })} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      Clear ×
                    </button>
                  )}
                </>
              )}

              {/* Quarterly: Q buttons + year */}
              {viewMode === "quarterly" && (
                <>
                  <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
                    {([1, 2, 3, 4] as const).map((q, i) => (
                      <button
                        key={q}
                        onClick={() => setSelectedQuarter(q)}
                        className={`px-3 py-1.5 font-medium transition-colors ${i > 0 ? "border-l border-border" : ""} ${
                          selectedQuarter === q ? "bg-foreground text-background" : "hover:bg-muted text-muted-foreground"
                        }`}
                      >
                        Q{q}
                      </button>
                    ))}
                  </div>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white"
                  >
                    {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </>
              )}

              {/* YTD / Full Year: year only */}
              {(viewMode === "ytd" || viewMode === "fullYear") && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-white"
                >
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              )}

              {/* Context label — quarterly/YTD/fullYear only; monthly period shown in dropdown */}
              {viewMode !== "monthly" && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {viewMode === "quarterly" &&
                    `Q${selectedQuarter} ${selectedYear} · vs Q${prevQ.q} ${prevQ.year} & Q${selectedQuarter} ${selectedYear - 1}`}
                  {viewMode === "ytd" && ytdThroughMonth &&
                    `YTD through ${format(new Date(`${selectedYear}-${String(ytdThroughMonth).padStart(2, "0")}-01T12:00:00`), "MMMM yyyy")}`}
                  {viewMode === "fullYear" && `FY ${selectedYear}`}
                </span>
              )}
            </div>

            {/* ── Main data table ───────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              {/* ── MONTHLY ── */}
              {viewMode === "monthly" && (
                !selectedPeriodYM ? (
                  <div className="px-6 py-12 text-center text-muted-foreground">
                    <p className="text-sm">Select a period to view monthly detail.</p>
                  </div>
                ) : periodRows.length === 0 ? (
                  <div className="px-6 py-12 text-center text-muted-foreground">
                    <p className="text-sm">No data submitted for this period.</p>
                  </div>
                ) : (
                  <>
                    {/* Version selector + metadata */}
                    {periodicVersions.length > 0 && (
                      <div className="border-b border-border px-4 py-3 space-y-2">
                        {periodicVersions.length > 1 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Version:</span>
                            <div className="flex gap-1 flex-wrap">
                              {periodicVersions.map((v) => (
                                <button
                                  key={v.submissionId}
                                  onClick={() => setSelectedPeriodicSubmissionId(v.submissionId)}
                                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                                    (activePeriodicVersion?.submissionId === v.submissionId)
                                      ? "bg-foreground text-background border-foreground"
                                      : "border-border hover:bg-muted"
                                  }`}
                                >
                                  v{v.version}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {activePeriodicVersion && (
                          <div className="flex flex-wrap gap-4 items-start">
                            <div>
                              <p className="text-xs text-muted-foreground">Status</p>
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full mt-1 bg-green-50 text-green-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                                Submitted
                              </span>
                            </div>
                            {activePeriodicVersion.submittedAt && (
                              <div>
                                <p className="text-xs text-muted-foreground">Submitted</p>
                                <p className="text-sm mt-1">{new Date(activePeriodicVersion.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs text-muted-foreground">Version</p>
                              <p className="text-sm mt-1">
                                {`v${activePeriodicVersion.version}`}
                                {periodicVersions.length > 1 && <span className="text-muted-foreground ml-1">({periodicVersions.findIndex((v) => v.submissionId === activePeriodicVersion.submissionId) + 1} of {periodicVersions.length})</span>}
                              </p>
                            </div>
                            {activePeriodicVersion.note && (
                              <div className="w-full">
                                <p className="text-xs text-muted-foreground">Operator Note</p>
                                <p className="text-sm mt-1 italic text-muted-foreground">{activePeriodicVersion.note}</p>
                              </div>
                            )}
                            {!isOperator && (
                              <div className="w-full">
                                <p className="text-xs text-muted-foreground">Investor Note</p>
                                {editingSubmissionNote ? (
                                  <div className="flex items-start gap-1 mt-1">
                                    <textarea
                                      autoFocus
                                      value={submissionInvestorNote}
                                      onChange={(e) => setSubmissionInvestorNote(e.target.value)}
                                      rows={2}
                                      className="text-sm border border-border rounded px-1.5 py-1 resize-none w-full max-w-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    />
                                    <div className="flex flex-col gap-1 shrink-0">
                                      <button type="button" onClick={handleSaveSubmissionNote} disabled={savingSubmissionNote} className="p-0.5 text-green-600 hover:text-green-700">
                                        <Check className="h-3.5 w-3.5" />
                                      </button>
                                      <button type="button" onClick={() => { setSubmissionInvestorNote(activePeriodicVersion.investorNote ?? ""); setEditingSubmissionNote(false); }} className="p-0.5 text-muted-foreground hover:text-foreground">
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => setEditingSubmissionNote(true)} className="group flex items-start gap-1 text-left mt-1">
                                    {submissionInvestorNote ? (
                                      <span className="text-sm text-foreground/80">{submissionInvestorNote}</span>
                                    ) : (
                                      <span className="text-sm text-muted-foreground/50 italic">Add note…</span>
                                    )}
                                    <Pencil className="h-2.5 w-2.5 shrink-0 mt-1 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                                  </button>
                                )}
                              </div>
                            )}
                            {/* Sources panel */}
                            <div className="w-full">
                              <p className="text-xs text-muted-foreground">Sources</p>
                              <div className="mt-1 space-y-1.5">
                                {/* Agreed KPI table */}
                                {activePeriodicVersion.submittedAt && (() => {
                                  const periodYM = selectedPeriodYM ?? "";
                                  const csvName = `${periodYM}_kpis_agreed.csv`;
                                  return (
                                    <div className="flex items-start">
                                      <a
                                        href={`/api/export/submission-kpis/${activePeriodicVersion.submissionId}`}
                                        download={csvName}
                                        className="flex items-center gap-1 text-sm text-foreground/80 hover:text-foreground min-w-0"
                                        title={csvName}
                                      >
                                        <Download className="h-3 w-3 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{csvName}</span>
                                        <span className="text-xs text-muted-foreground shrink-0 ml-1">
                                          ({new Date(activePeriodicVersion.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{activePeriodicVersion.submittedBy && ` · ${activePeriodicVersion.submittedBy}`})
                                        </span>
                                      </a>
                                    </div>
                                  );
                                })()}
                                {/* Uploaded documents */}
                                {activePeriodicVersion.documents.map((doc) => (
                                  <div key={doc.id} className="flex items-start">
                                    <a
                                      href={`/api/documents/download/${doc.id}`}
                                      download={doc.fileName}
                                      className="flex items-center gap-1 text-sm text-foreground/80 hover:text-foreground min-w-0"
                                      title={doc.fileName}
                                    >
                                      <Download className="h-3 w-3 shrink-0 text-muted-foreground" />
                                      <span className="truncate">{doc.fileName}</span>
                                      <span className="text-xs text-muted-foreground shrink-0 ml-1">
                                        ({new Date(doc.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{doc.uploadedBy && ` · ${doc.uploadedBy}`})
                                      </span>
                                    </a>
                                  </div>
                                ))}
                                {!activePeriodicVersion.submittedAt && activePeriodicVersion.documents.length === 0 && (
                                  <p className="text-sm text-muted-foreground/50 italic">No files</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  <div className="overflow-x-auto">
                    <table ref={monthlyR.tableRef} className="text-sm" style={{ tableLayout: "fixed", width: "max-content" }}>
                      <colgroup>
                        {monthlyR.widths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {(() => {
                            let ci = 0;
                            return (<>
                              <Rth colIdx={ci++} r={monthlyR} className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/30">KPI</Rth>
                              <Rth colIdx={ci++} r={monthlyR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Actual</Rth>
                              {hasPlanData && <>
                                <Rth colIdx={ci++} r={monthlyR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">Plan</Rth>
                                <Rth colIdx={ci++} r={monthlyR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Var %</Rth>
                                <Rth colIdx={ci++} r={monthlyR} className="text-center px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Status</Rth>
                              </>}
                              <Rth colIdx={ci++} r={monthlyR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">MoM%</Rth>
                              <Rth colIdx={ci++} r={monthlyR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">YoY%</Rth>
                              <Rth colIdx={ci++} r={monthlyR} className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">Operator Note</Rth>
                              {!isOperator && <Rth colIdx={ci++} r={monthlyR} className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Investor Note</Rth>}
                            </>);
                          })()}
                        </tr>
                      </thead>
                      <tbody>
                        {periodRows.map((row) => {
                          if (typeof row.actual !== "number") return null;
                          const prevActualRaw = prevMonthYM ? (cellMap.get(row.kpiKey)?.get(prevMonthYM)?.actual ?? null) : null;
                          const prevActual = typeof prevActualRaw === "number" ? prevActualRaw : null;
                          const momPct = pctChange(row.actual, prevActual);
                          return (
                            <tr key={row.kpiKey} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="px-4 py-3 font-medium sticky left-0 bg-white whitespace-nowrap">
                                {row.kpiLabel}
                                {row.unit && <span className="text-xs text-muted-foreground ml-1">({row.unit})</span>}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums font-medium">{fmtDetail(row.actual, row.unit)}</td>
                              {hasPlanData && <>
                                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground border-l border-border">
                                  {row.planTooltip ? (
                                    <TooltipProvider delay={200}>
                                      <Tooltip>
                                        <TooltipTrigger className="flex items-center justify-end gap-1 cursor-default w-full">
                                          {fmtDetail(row.plan, row.unit)}
                                          <Info className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs max-w-[200px]">
                                          {row.planTooltip}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : fmtDetail(row.plan, row.unit)}
                                </td>
                                <td className={`px-3 py-3 text-right tabular-nums text-xs ${varianceColor(row.planVariancePct)}`}>
                                  {row.planVariance !== null ? (
                                    <TooltipProvider delay={200}>
                                      <Tooltip>
                                        <TooltipTrigger className="cursor-default tabular-nums">
                                          {fmtPct2(row.planVariancePct)}
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                          {row.planVariance >= 0 ? "+" : ""}{fmtDetail(row.planVariance, row.unit)}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : "—"}
                                </td>
                                <td className="px-3 py-3 text-center">
                                  {row.ragEffective ? (
                                    <TooltipProvider delay={200}>
                                      <Tooltip>
                                        <TooltipTrigger className="cursor-default">
                                          <RagBadge status={row.ragEffective} />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                          {ragRuleText(row.ragEffective, row.ragGreenPct, row.ragAmberPct, row.ragDirection, !!row.ragOverride)}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : "—"}
                                </td>
                              </>}
                              <td className={`px-3 py-3 text-right tabular-nums text-xs border-l border-border ${varianceColor(momPct)}`}>
                                {momPct !== null && prevActual !== null ? (() => {
                                  const delta = (row.actual as number) - prevActual;
                                  return (
                                    <TooltipProvider delay={200}>
                                      <Tooltip>
                                        <TooltipTrigger className="cursor-default tabular-nums">
                                          {fmtPct2(momPct)}
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                          {delta >= 0 ? "+" : ""}{fmtDetail(delta, row.unit)}                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                })() : "—"}
                              </td>
                              <td className={`px-3 py-3 text-right tabular-nums text-xs ${varianceColor(row.yoyVariance)}`}>
                                {row.yoyVariancePct !== null && row.priorYearActual !== null ? (() => {
                                  const delta = (row.actual as number) - row.priorYearActual;
                                  return (
                                    <TooltipProvider delay={200}>
                                      <Tooltip>
                                        <TooltipTrigger className="cursor-default tabular-nums">
                                          {fmtPct2(row.yoyVariancePct)}
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                          {delta >= 0 ? "+" : ""}{fmtDetail(delta, row.unit)}                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                })() : "—"}
                              </td>
                              <td className="px-4 py-3 border-l border-border">
                                {row.note ? (
                                  <div className="flex items-start gap-1">
                                    <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                    <span className="text-xs text-foreground/70 line-clamp-2">{row.note}</span>
                                  </div>
                                ) : <span className="text-xs text-muted-foreground/40">—</span>}
                              </td>
                              {!isOperator && (
                                <td className="px-4 py-3">
                                  <InvestorNoteCell kpiValueId={row.kpiValueId} initialNote={row.investorNote} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
                )
              )}

              {/* ── QUARTERLY ── */}
              {viewMode === "quarterly" && (
                <div className="overflow-x-auto">
                  <table ref={quarterlyR.tableRef} className="text-sm" style={{ tableLayout: "fixed", width: "max-content" }}>
                    <colgroup>
                      {quarterlyR.widths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {(() => {
                          let ci = 0;
                          return (<>
                            <Rth colIdx={ci++} r={quarterlyR} className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/30">KPI</Rth>
                            {qMonths.map((m) => {
                              const isInvCol = investmentYear === selectedYear && investmentMonth === m;
                              return (
                                <Rth key={m} colIdx={ci++} r={quarterlyR} className={`text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap text-xs${isInvCol ? " border-l-2 border-slate-200" : ""}`}>
                                  {isInvCol ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="text-[9px] font-normal text-slate-400 leading-none">Investment</span>
                                      <span>{MONTHS[m - 1]}</span>
                                    </div>
                                  ) : MONTHS[m - 1]}
                                </Rth>
                              );
                            })}
                            <Rth colIdx={ci++} r={quarterlyR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">Q{selectedQuarter} Actual</Rth>
                            <Rth colIdx={ci++} r={quarterlyR} className="text-center px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">Status</Rth>
                            <Rth colIdx={ci++} r={quarterlyR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Q{selectedQuarter} Plan</Rth>
                            <Rth colIdx={ci++} r={quarterlyR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Var %</Rth>
                            <Rth colIdx={ci++} r={quarterlyR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">QoQ%</Rth>
                            <Rth colIdx={ci++} r={quarterlyR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">YoY%</Rth>
                            <Rth colIdx={ci++} r={quarterlyR} className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">Operator Note</Rth>
                            {!isOperator && <Rth colIdx={ci++} r={quarterlyR} className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Investor Note</Rth>}
                          </>);
                        })()}
                      </tr>
                    </thead>
                    <tbody>
                      {quarterlyRows.map((row) => (
                        <tr key={row.kpiKey} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-3 font-medium sticky left-0 bg-white whitespace-nowrap">
                            {row.kpiLabel}
                            {row.unit && <span className="text-xs text-muted-foreground ml-1">({row.unit})</span>}
                          </td>
                          {row.monthActuals.map((v, i) => {
                            const isInvCol = investmentYear === selectedYear && investmentMonth === qMonths[i];
                            return (
                              <td key={i} className={`px-3 py-3 text-right tabular-nums text-xs text-muted-foreground${isInvCol ? " border-l-2 border-slate-200" : ""}`}>
                                {v !== null ? fmtDetail(v, row.unit) : <span className="text-muted-foreground/30">—</span>}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3 text-right tabular-nums font-medium border-l border-border">{fmtDetail(row.qActual, row.unit)}</td>
                          <td className="px-4 py-3 text-center border-l border-border">
                            {row.ragEffective ? (
                              <TooltipProvider delay={200}>
                                <Tooltip>
                                  <TooltipTrigger className="cursor-default">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <RagBadge status={row.ragEffective} />
                                      {row.ragOverride && <span className="text-[10px] text-muted-foreground">manual</span>}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {ragRuleText(row.ragEffective, row.ragGreenPct, row.ragAmberPct, row.ragDirection, !!row.ragOverride)}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {row.qPlanTooltip ? (
                              <TooltipProvider delay={200}>
                                <Tooltip>
                                  <TooltipTrigger className="flex items-center justify-end gap-1 cursor-default w-full">
                                    {fmtDetail(row.qPlan, row.unit)}
                                    <Info className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                                    {row.qPlanTooltip}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : fmtDetail(row.qPlan, row.unit)}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums text-xs ${varianceColor(row.qVarPct)}`}>
                            {row.qVar !== null ? (
                              <TooltipProvider delay={200}>
                                <Tooltip>
                                  <TooltipTrigger className="cursor-default tabular-nums">
                                    {fmtPct2(row.qVarPct)}
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {row.qVar >= 0 ? "+" : ""}{fmtDetail(row.qVar, row.unit)}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : "—"}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums text-xs border-l border-border ${varianceColor(row.qoqPct)}`}>
                            {row.qoqDelta !== null ? (
                              <TooltipProvider delay={200}>
                                <Tooltip>
                                  <TooltipTrigger className="cursor-default tabular-nums">
                                    {fmtPct2(row.qoqPct)}
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {row.qoqDelta >= 0 ? "+" : ""}{fmtDetail(row.qoqDelta, row.unit)}                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : "—"}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums text-xs ${varianceColor(row.yoyPct)}`}>
                            {row.yoyDelta !== null ? (
                              <TooltipProvider delay={200}>
                                <Tooltip>
                                  <TooltipTrigger className="cursor-default tabular-nums">
                                    {fmtPct2(row.yoyPct)}
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {row.yoyDelta >= 0 ? "+" : ""}{fmtDetail(row.yoyDelta, row.unit)}                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 border-l border-border">
                            {row.note ? (
                              <div className="flex items-start gap-1">
                                <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                <span className="text-xs text-foreground/70 line-clamp-2">{row.note}</span>
                              </div>
                            ) : <span className="text-xs text-muted-foreground/40">—</span>}
                          </td>
                          {!isOperator && (
                            <td className="px-4 py-3">
                              <InvestorNoteCell kpiValueId={row.kpiValueId} initialNote={row.investorNote} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── YTD ── */}
              {viewMode === "ytd" && (
                ytdThroughMonth === null ? (
                  <div className="px-6 py-12 text-center text-muted-foreground">
                    <p className="text-sm">No data available for {selectedYear}.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table ref={ytdR.tableRef} className="text-sm" style={{ tableLayout: "fixed", width: "max-content" }}>
                      <colgroup>
                        {ytdR.widths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {(() => {
                            let ci = 0;
                            return (<>
                              <Rth colIdx={ci++} r={ytdR} className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/30">KPI</Rth>
                              {ytdThroughMonth && Array.from({ length: ytdThroughMonth }, (_, i) => {
                                const isInvCol = investmentYear === selectedYear && investmentMonth === i + 1;
                                return (
                                  <Rth key={i} colIdx={ci++} r={ytdR} className={`text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap text-xs${isInvCol ? " border-l-2 border-slate-200" : ""}`}>
                                    {isInvCol ? (
                                      <div className="flex flex-col items-end gap-0.5">
                                        <span className="text-[9px] font-normal text-slate-400 leading-none">Investment</span>
                                        <span>{MONTHS[i]}</span>
                                      </div>
                                    ) : MONTHS[i]}
                                  </Rth>
                                );
                              })}
                              <Rth colIdx={ci++} r={ytdR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">YTD Actual</Rth>
                              <Rth colIdx={ci++} r={ytdR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">YTD Plan</Rth>
                              <Rth colIdx={ci++} r={ytdR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Var %</Rth>
                              <Rth colIdx={ci++} r={ytdR} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">YoY%</Rth>
                              <Rth colIdx={ci++} r={ytdR} className="text-center px-4 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">Status</Rth>
                            </>);
                          })()}
                        </tr>
                      </thead>
                      <tbody>
                        {ytdRows.map((row) => (
                          <tr key={row.kpiKey} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-4 py-3 font-medium sticky left-0 bg-white whitespace-nowrap">
                              {row.kpiLabel}
                              {row.unit && <span className="text-xs text-muted-foreground ml-1">({row.unit})</span>}
                            </td>
                            {row.monthActuals.map((v, i) => {
                              const isInvCol = investmentYear === selectedYear && investmentMonth === i + 1;
                              return (
                                <td key={i} className={`px-3 py-3 text-right tabular-nums text-xs text-muted-foreground${isInvCol ? " border-l-2 border-slate-200" : ""}`}>
                                  {v !== null ? fmtDetail(v, row.unit) : <span className="text-muted-foreground/30">—</span>}
                                </td>
                              );
                            })}
                            <td className="px-4 py-3 text-right tabular-nums font-medium border-l border-border">{fmtDetail(row.ytdActual, row.unit)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtDetail(row.ytdPlan, row.unit)}</td>
                            <td className={`px-4 py-3 text-right tabular-nums text-xs ${varianceColor(row.ytdVarPct)}`}>
                              {row.ytdVar !== null ? (
                                <TooltipProvider delay={200}>
                                  <Tooltip>
                                    <TooltipTrigger className="cursor-default tabular-nums">
                                      {fmtPct2(row.ytdVarPct)}
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">
                                      {row.ytdVar >= 0 ? "+" : ""}{fmtDetail(row.ytdVar, row.unit)}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : "—"}
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums text-xs border-l border-border ${varianceColor(row.yoyPct)}`}>
                              {row.yoyDelta !== null ? (
                                <TooltipProvider delay={200}>
                                  <Tooltip>
                                    <TooltipTrigger className="cursor-default tabular-nums">
                                      {fmtPct2(row.yoyPct)}
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">
                                      {row.yoyDelta >= 0 ? "+" : ""}{fmtDetail(row.yoyDelta, row.unit)}                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3 text-center border-l border-border">
                              {row.ragEffective ? (
                                <TooltipProvider delay={200}>
                                  <Tooltip>
                                    <TooltipTrigger className="cursor-default">
                                      <div className="flex flex-col items-center gap-0.5">
                                        <RagBadge status={row.ragEffective} />
                                        {row.ragOverride && <span className="text-[10px] text-muted-foreground">manual</span>}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">
                                      {ragRuleText(row.ragEffective, row.ragGreenPct, row.ragAmberPct, row.ragDirection, !!row.ragOverride)}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* ── FULL YEAR ── */}
              {viewMode === "fullYear" && (
                <div className="overflow-x-auto">
                  <table ref={fullYearR.tableRef} className="text-sm" style={{ tableLayout: "fixed", minWidth: `${fullYearR.widths.reduce((a, b) => a + b, 0)}px` }}>
                    <colgroup>
                      {fullYearR.widths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {(() => {
                          let ci = 0;
                          return (<>
                            <Rth colIdx={ci++} r={fullYearR} className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/30">KPI</Rth>
                            <Rth colIdx={ci++} r={fullYearR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap border-r border-border">FY Plan</Rth>
                            {MONTHS.map((m, mi) => {
                              const isInvCol = investmentYear === selectedYear && investmentMonth === mi + 1;
                              return (
                                <Rth key={m} colIdx={ci++} r={fullYearR} className={`text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap text-xs${isInvCol ? " border-l-2 border-slate-200" : ""}`}>
                                  {isInvCol ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="text-[9px] font-normal text-slate-400 leading-none">Investment</span>
                                      <span>{m}</span>
                                    </div>
                                  ) : m}
                                </Rth>
                              );
                            })}
                            <Rth colIdx={ci++} r={fullYearR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">FY Actual</Rth>
                            <Rth colIdx={ci++} r={fullYearR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Att%</Rth>
                            <Rth colIdx={ci++} r={fullYearR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap border-l border-border">PY Actual</Rth>
                            <Rth colIdx={ci++} r={fullYearR} className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">YoY%</Rth>
                          </>);
                        })()}
                      </tr>
                    </thead>
                    <tbody>
                      {fullYearRows.map((row) => (
                        <tr key={row.kpiKey} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium sticky left-0 bg-white whitespace-nowrap">
                            {row.kpiLabel}
                            {row.unit && <span className="text-xs text-muted-foreground ml-1">({row.unit})</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground border-r border-border">{fmtDetail(row.fyPlan, row.unit)}</td>
                          {row.monthActuals.map((v, i) => {
                            const isInvCol = investmentYear === selectedYear && investmentMonth === i + 1;
                            return (
                              <td key={i} className={`px-3 py-2.5 text-right tabular-nums text-xs${isInvCol ? " border-l-2 border-slate-200" : ""}`}>
                                {v !== null ? fmtDetail(v, row.unit) : <span className="text-muted-foreground/30">—</span>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium border-l border-border">{fmtDetail(row.fyTotal, row.unit)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${
                            row.attainmentPct === null ? "text-muted-foreground"
                            : row.attainmentPct >= 100 ? "text-green-600"
                            : row.attainmentPct >= 80 ? "text-amber-600"
                            : "text-red-600"
                          }`}>
                            {row.attainmentPct !== null ? `${row.attainmentPct.toFixed(0)}%` : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground border-l border-border">{fmtDetail(row.pyFyTotal, row.unit)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${varianceColor(row.yoyPct)}`}>{fmtPct2(row.yoyPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Annual Plan (collapsible) ─────────────────────────────── */}
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setPlanOpen((o) => !o)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/20 transition-colors"
              >
                <h2 className="font-semibold text-sm">Annual Plan</h2>
                {planOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
              </button>

              {planOpen && (
                <div className="border-t border-border">
                  {selectedCompanyId ? (
                    <PlanViewer companyId={selectedCompanyId} isOperator={isOperator} />
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-sm">Select a company to view their plan.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
