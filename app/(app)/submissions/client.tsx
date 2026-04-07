"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  Mail,
  Download,
  FileText,
  FileText as FileIcon,
  Calendar,
  Check,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SubmissionTrackingRow, SubmissionDocInfo, PlanTrackingRow, OnboardingRow } from "@/lib/server/analytics";

function parseDocCadences(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of (raw ?? "").split(",").filter(Boolean)) {
    const [key, cadence] = entry.split(":");
    if (key && cadence) map[key] = cadence;
  }
  return map;
}

function isDocDueThisPeriod(cadence: string, periodMonth: number): boolean {
  if (cadence === "quarterly") return periodMonth % 3 === 0;
  if (cadence === "bi-annual") return periodMonth === 6 || periodMonth === 12;
  if (cadence === "annual")    return periodMonth === 12;
  return true;
}

function isDocRequiredAndDue(row: SubmissionTrackingRow, key: string, periodMonth: number): boolean {
  if (!row.requiredDocs.includes(key)) return false;
  const cadences = parseDocCadences(row.requiredDocCadences);
  return isDocDueThisPeriod(cadences[key] ?? "monthly", periodMonth);
}

import type { Period } from "@/lib/db/schema";
import { sendRemindersAction, sendPlanRemindersAction, markOnboardingCompleteAction } from "./actions";
import { FilterBarUrl } from "@/components/filters/filter-bar-url";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  rows: SubmissionTrackingRow[];
  allPeriods: Period[];
  selectedPeriodId: string;
  periodLabel: string;
  periodDueDate: string | null;
  stats: {
    complete: number;
    partial: number;
    missing: number;
    completion: number;
  };
  firmId: string;
  filterOptions: { funds: string[]; industries: string[] };
  priorPendingRows?: SubmissionTrackingRow[];
  priorPeriodLabel?: string;
  planRows: PlanTrackingRow[];
  selectedPlanYear: number;
  availablePlanYears: number[];
  planDueDate: string;
  planStats: { submitted: number; draft: number; notStarted: number };
  onboardingRows: OnboardingRow[];
  isOperator?: boolean;
};

// ── Completeness chip cluster ─────────────────────────────────────────────────

const DOC_META = {
  balance_sheet:        { abbr: "BS", full: "Balance Sheet" },
  income_statement:     { abbr: "IS", full: "Income Statement" },
  cash_flow_statement:  { abbr: "CF", full: "Cash Flow" },
  investor_update:      { abbr: "IU", full: "Investor Update" },
} as const;
type DocKey = keyof typeof DOC_META;

function KpiChip({ status }: { status: SubmissionTrackingRow["status"] }) {
  const agreed = status === "submitted" || status === "partial";
  const inProgress = status === "draft";

  const chipClass = agreed
    ? "bg-green-100 text-green-700 border-green-300"
    : inProgress
    ? "bg-gray-100 text-gray-400 border-gray-200"
    : "bg-red-100 text-red-600 border-red-300";

  const tipText = agreed
    ? "Agreed KPI table confirmed and available as a source file."
    : inProgress
    ? "KPIs — in progress, not yet confirmed"
    : "KPIs — not submitted";

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger>
          <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border cursor-default select-none ${chipClass}`}>
            KPI
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{tipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DocChip({
  docKey,
  required,
  doc,
}: {
  docKey: DocKey;
  required: boolean;
  doc: SubmissionDocInfo;
}) {
  const { abbr, full } = DOC_META[docKey];

  let chipClass: string;
  let tipText: string;

  if (!required) {
    chipClass = "bg-gray-50 text-gray-300 border-gray-200";
    tipText = `${full} — not required`;
  } else if (doc && !doc.viaCombined) {
    chipClass = "bg-green-100 text-green-700 border-green-300";
    tipText = `${full} — detected`;
  } else if (doc && doc.viaCombined) {
    chipClass = "bg-amber-100 text-amber-700 border-amber-300";
    tipText = `${full} — partial (in combined file)`;
  } else {
    chipClass = "bg-red-100 text-red-600 border-red-300";
    tipText = `${full} — missing`;
  }

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border cursor-default select-none ${chipClass}`}
          >
            {abbr}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{tipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CompletenessCell({
  row,
  periodMonth,
}: {
  row: SubmissionTrackingRow;
  periodMonth: number;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <KpiChip status={row.status} />
      {(Object.keys(DOC_META) as DocKey[]).map((key) => (
        <DocChip
          key={key}
          docKey={key}
          required={isDocRequiredAndDue(row, key, periodMonth)}
          doc={
            key === "balance_sheet"       ? row.balanceSheetDoc :
            key === "income_statement"    ? row.incomeStatementDoc :
            key === "cash_flow_statement" ? row.cashFlowDoc :
                                           row.investorUpdateDoc
          }
        />
      ))}
    </div>
  );
}

// ── Source Files cell ─────────────────────────────────────────────────────────

const MAX_VISIBLE_FILES = 3;

function SourceFilesCell({
  files,
  submissionId,
  submissionVersion,
  submittedAt,
  periodLabel,
  kpisAgreed,
}: {
  files: Array<{ id: string; fileName: string; version: number; uploadedAt: string }>;
  submissionId: string | null;
  submissionVersion: number | null;
  submittedAt: string | null;
  periodLabel: string;
  kpisAgreed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  type FileEntry = { href: string; label: string; version: string; date: string };
  const allFiles: FileEntry[] = [];

  if (kpisAgreed && submissionId) {
    allFiles.push({
      href: `/api/submissions/${submissionId}/kpis`,
      label: `${periodLabel}_kpis_agreed.csv`,
      version: submissionVersion != null ? `v${submissionVersion}` : "",
      date: submittedAt ? format(new Date(submittedAt), "MM/dd/yyyy") : "",
    });
  }

  for (const f of files) {
    allFiles.push({
      href: `/api/documents/download/${f.id}`,
      label: f.fileName,
      version: `v${f.version}`,
      date: format(new Date(f.uploadedAt), "MM/dd/yyyy"),
    });
  }

  if (!allFiles.length) {
    return <span className="text-muted-foreground/40 text-xs">—</span>;
  }

  const visible = expanded ? allFiles : allFiles.slice(0, MAX_VISIBLE_FILES);
  const overflow = allFiles.length - MAX_VISIBLE_FILES;

  return (
    <div className="flex flex-col gap-1">
      {visible.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs min-w-0">
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
          <a
            href={f.href}
            target="_blank"
            rel="noopener noreferrer"
            title={f.label}
            className="truncate text-blue-600 hover:text-blue-800 hover:underline max-w-[140px]"
          >
            {f.label}
          </a>
          {(f.version || f.date) && (
            <span className="shrink-0 text-muted-foreground/60 whitespace-nowrap">
              {f.version}
              {f.version && f.date ? " · " : ""}
              {f.date}
            </span>
          )}
        </div>
      ))}
      {!expanded && overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-left text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          + {overflow} more
        </button>
      )}
      {expanded && overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-left text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  );
}

// ── Main Client Component ─────────────────────────────────────────────────────

export function SubmissionTrackingClient({
  rows,
  allPeriods,
  selectedPeriodId,
  periodLabel,
  periodDueDate,
  stats,
  firmId,
  filterOptions,
  planRows,
  selectedPlanYear,
  availablePlanYears,
  planDueDate,
  planStats,
  onboardingRows,
  isOperator = false,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasOnboarding = onboardingRows.some(
    (r) => r.onboardingStatus === "pending" || r.onboardingStatus === "in_progress"
  );

  const [activeView, setActiveView] = useState<"periodic" | "annual" | "onboarding">("periodic");
  const [sending, setSending] = useState<string | null>(null);
  const [sendingPlan, setSendingPlan] = useState<string | null>(null);
  const [confirmCompleteId, setConfirmCompleteId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  const selectedPeriod = allPeriods.find((p) => p.id === selectedPeriodId);
  const periodMonth = selectedPeriod ? parseInt(selectedPeriod.periodStart.slice(5, 7), 10) : 1;

  async function handleMarkComplete() {
    if (!confirmCompleteId) return;
    setCompleting(true);
    try {
      await markOnboardingCompleteAction(confirmCompleteId);
      toast.success("Onboarding marked as complete.");
      setConfirmCompleteId(null);
      router.refresh();
    } catch {
      toast.error("Failed to mark complete.");
    } finally {
      setCompleting(false);
    }
  }

async function handleSendReminders(companyId: string) {
    setSending(companyId);
    try {
      const result = await sendRemindersAction(firmId, selectedPeriodId, companyId);
      toast.success(result.message);
    } catch {
      toast.error("Failed to send reminder. Check email configuration.");
    } finally {
      setSending(null);
    }
  }

  async function handleSendPlanReminders(companyId: string) {
    setSendingPlan(companyId);
    try {
      const result = await sendPlanRemindersAction(firmId, selectedPlanYear, planDueDate, companyId);
      toast.success(result.message);
    } catch {
      toast.error("Failed to send plan reminder. Check email configuration.");
    } finally {
      setSendingPlan(null);
    }
  }

  function setPlanYear(year: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("planYear", String(year));
    router.push(`/submissions?${params.toString()}`);
  }

  const today = new Date().toISOString().split("T")[0];
  const isPlanOverdue = planDueDate < today;
  const isPeriodOverdue = !!periodDueDate && periodDueDate < today;

  return (
    <div className="p-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Submission Tracking</h1>
        {!isOperator && (
          <a
            href={`/api/export/submissions?periodId=${selectedPeriodId}`}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" />
            Export Data
          </a>
        )}
      </div>

      {/* View toggle */}
      <div className="inline-flex rounded-lg border border-border bg-muted p-1 mb-6">
        {(["periodic", "annual", ...(hasOnboarding ? ["onboarding"] : [])] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setActiveView(view as typeof activeView)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeView === view
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {view === "periodic" ? "Periodic" : view === "annual" ? "Annual Plan" : "Onboarding"}
          </button>
        ))}
      </div>

      {/* Filter bar — investors only */}
      {!isOperator && (
        <div className="mb-6">
          <FilterBarUrl funds={filterOptions.funds} industries={filterOptions.industries} />
        </div>
      )}

      {activeView === "periodic" && (<>

      {/* Period selector + stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Select Period</p>
          <select
            className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-white"
            value={selectedPeriodId}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("period", e.target.value);
              router.push(`/submissions?${params.toString()}`);
            }}
          >
            {allPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {format(new Date(p.periodStart + "T12:00:00"), "yyyy-MM")}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-2xl font-bold text-green-600">{stats.complete}</p>
          <p className="text-sm font-medium text-green-600">Complete</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-2xl font-bold text-yellow-600">{stats.partial}</p>
          <p className="text-sm font-medium text-yellow-600">Partial</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-2xl font-bold text-red-600">{stats.missing}</p>
          <p className="text-sm font-medium text-red-600">No Submission</p>
        </div>

      </div>

      {/* Submission Status Table */}
      <div className="bg-white rounded-xl border border-border overflow-hidden mb-12">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "240px" }}>Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "200px" }}>Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "170px" }}>Source Files</th>
                {!isOperator && <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "140px" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.companyId}
                  className="border-b border-border/50 hover:bg-muted/20"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.companyName}</p>
                  </td>
                  <td className="px-4 py-3">
                    <CompletenessCell row={row} periodMonth={periodMonth} />
                    {periodDueDate && row.status !== "submitted" && (
                      <p className={`flex items-center gap-1 text-xs mt-1 ${isPeriodOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                        <Calendar
                          className="shrink-0"
                          style={{ width: "0.7em", height: "0.7em", opacity: isPeriodOverdue ? 1 : 0.5 }}
                        />
                        Due {format(new Date(periodDueDate + "T12:00:00"), "MM/dd/yyyy")}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SourceFilesCell
                      files={row.sourceFiles}
                      submissionId={row.submissionId}
                      submissionVersion={row.version}
                      submittedAt={row.submittedAt}
                      periodLabel={periodLabel}
                      kpisAgreed={row.status === "submitted" || row.status === "partial"}
                    />
                  </td>
                  {!isOperator && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {row.status !== "submitted" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSendReminders(row.companyId); }}
                            disabled={sending === row.companyId}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                          >
                            <Mail className="h-3 w-3" />
                            {sending === row.companyId ? "Sending..." : "Remind"}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </>)}

      {activeView === "annual" && (<>


      {/* Plan year selector + stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Select Year</p>
          <select
            className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-white"
            value={selectedPlanYear}
            onChange={(e) => setPlanYear(Number(e.target.value))}
          >
            {availablePlanYears.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-2xl font-bold text-green-600">{planStats.submitted}</p>
          <p className="text-sm font-medium text-green-600">Complete</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-2xl font-bold text-yellow-600">{planStats.draft}</p>
          <p className="text-sm font-medium text-yellow-600">Partial</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-2xl font-bold text-red-600">{planStats.notStarted}</p>
          <p className="text-sm font-medium text-red-600">No Submission</p>
        </div>
      </div>

      {/* Plan Tracking Table */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "240px" }}>Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "180px" }}>Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "170px" }}>Source Files</th>
                {!isOperator && <th className="text-left px-4 py-3 font-medium text-muted-foreground" style={{ minWidth: "140px" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {planRows.map((row) => {
                const isComplete = row.planStatus === "complete";
                const isPartial = row.planStatus === "partial";
                const isNoSubmission = row.planStatus === "no_submission";
                const showDueDate = !isComplete;
                const planOverdue = isPlanOverdue && !isComplete;
                return (
                  <tr key={row.companyId} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.companyName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                        isComplete
                          ? "bg-green-100 text-green-700 border-green-200"
                          : isPartial
                          ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                          : "bg-red-100 text-red-700 border-red-200"
                      }`}>
                        {isComplete ? "Complete" : isPartial ? "Partial" : "No Submission"}
                      </span>
                      {showDueDate && (
                        <p className={`flex items-center gap-1 text-xs mt-1 ${planOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                          <Calendar
                            className="shrink-0"
                            style={{ width: "0.7em", height: "0.7em", opacity: planOverdue ? 1 : 0.5 }}
                          />
                          Due {format(new Date(planDueDate + "T12:00:00"), "MM/dd/yyyy")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SourceFilesCell
                        files={row.sourceFiles}
                        submissionId={null}
                        submissionVersion={null}
                        submittedAt={null}
                        periodLabel=""
                        kpisAgreed={false}
                      />
                    </td>
                    {!isOperator && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {!isComplete && (
                            <button
                              onClick={() => handleSendPlanReminders(row.companyId)}
                              disabled={sendingPlan === row.companyId}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                            >
                              <Mail className="h-3 w-3" />
                              {sendingPlan === row.companyId ? "Sending..." : "Remind"}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {/* ── ONBOARDING ─────────────────────────────────────────────────── */}
      {activeView === "onboarding" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {onboardingRows
            .filter((r) => r.onboardingStatus === "pending" || r.onboardingStatus === "in_progress")
            .map((row) => {
              const isPending = row.onboardingStatus === "pending";
              const isInProgress = row.onboardingStatus === "in_progress";
              const filesExpanded = expandedFiles[row.companyId] ?? false;

              return (
                <div key={row.companyId} className="bg-white rounded-xl border border-border p-5 flex flex-col gap-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-sm">{row.companyName}</p>
                      {(row.fund || row.industry) && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {[row.fund, row.industry].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <span className={cn(
                      "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border",
                      isPending
                        ? "bg-gray-50 text-gray-500 border-gray-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", isPending ? "bg-gray-400" : "bg-amber-400")} />
                      {isPending ? "Pending" : "In Progress"}
                    </span>
                  </div>

                  {/* Files received */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Files received</p>
                    {row.fileCount === 0 ? (
                      <p className="text-sm text-muted-foreground/60">No files yet</p>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            {row.fileCount} file{row.fileCount !== 1 ? "s" : ""} received
                          </p>
                          <button
                            type="button"
                            onClick={() => setExpandedFiles((prev) => ({ ...prev, [row.companyId]: !filesExpanded }))}
                            className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                          >
                            {filesExpanded ? "Hide" : "View"}
                          </button>
                        </div>
                        {filesExpanded && (
                          <div className="mt-2 space-y-1">
                            {row.files.map((f) => (
                              <div key={f.id} className="flex items-center gap-1.5 text-xs">
                                <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <a
                                  href={`/api/onboarding/download/${f.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline truncate max-w-[220px]"
                                >
                                  {f.fileName}
                                </a>
                                <span className="text-muted-foreground/50 shrink-0">
                                  {(() => { const d = new Date(f.uploadedAt.includes("T") ? f.uploadedAt : f.uploadedAt + "T12:00:00"); return isNaN(d.getTime()) ? "" : format(d, "MM/dd/yy"); })()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Last activity */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Last activity</p>
                    <p className="text-sm">
                      {(() => {
                        if (!row.lastActivity) return "—";
                        const d = new Date(row.lastActivity.includes("T") ? row.lastActivity : row.lastActivity + "T12:00:00");
                        return isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
                      })()}
                    </p>
                  </div>

                  {/* Footer actions */}
                  <div className="flex items-center gap-3 pt-2 border-t border-border/50 mt-auto">
                    {isInProgress && (
                      <button
                        type="button"
                        onClick={() => setConfirmCompleteId(row.companyId)}
                        className="ml-auto flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-md transition-colors font-medium"
                      >
                        <Check className="h-3 w-3" />
                        Mark as complete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Confirm Mark Complete dialog */}
      <Dialog open={!!confirmCompleteId} onOpenChange={(open) => { if (!open) setConfirmCompleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark onboarding as complete?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground pt-1">
              Are you sure you want to mark{" "}
              <span className="font-medium text-foreground">
                {onboardingRows.find((r) => r.companyId === confirmCompleteId)?.companyName}
              </span>
              {"'s onboarding as complete? This will close the onboarding tab for this company. You can still access their historical data on the Data page."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmCompleteId(null)} disabled={completing}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleMarkComplete} disabled={completing}>
              {completing ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
