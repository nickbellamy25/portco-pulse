"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Pencil, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface KpiEntry {
  value: number | null;
  operator_note?: string | null;
}

interface SubmissionPayload {
  submission_type: "periodic" | "plan";
  period?: string;
  fiscal_year?: number;
  kpis: Record<string, KpiEntry>;
  overall_note?: string | null;
}

interface Props {
  payload: SubmissionPayload;
  enabledKpis: Array<{ key: string; label: string; unit: string | null; valueType: string }>;
  companyName?: string;
  onConfirm: (editedPayload: SubmissionPayload) => void;
  onCancel?: () => void;
  isSubmitting: boolean;
  isSubmitted?: boolean;
  isCanceled?: boolean;
  detectedDocuments?: string[];
  requiredDocs?: string;
  requiredDocCadences?: string;
  submissionPeriod?: string;
  compact?: boolean;
  onToggleDoc?: (docKey: string) => void;
  onEdit?: () => void;
  versionNumber?: number;
}

const ALL_DOC_KEYS = ["balance_sheet", "income_statement", "cash_flow_statement", "investor_update"] as const;
const DOC_ABBR: Record<string, string> = {
  balance_sheet: "BS",
  income_statement: "IS",
  cash_flow_statement: "CF",
  investor_update: "IU",
};
const DOC_FULL: Record<string, string> = {
  balance_sheet: "Balance Sheet",
  income_statement: "Income Statement",
  cash_flow_statement: "Cash Flow Statement",
  investor_update: "Investor Update",
};

const KPI_SECTIONS: Record<string, string[]> = {
  Finance: ["revenue", "gross_margin", "ebitda", "cash_balance", "capex", "operating_cash_flow"],
  Operations: ["customer_acquisition_cost", "headcount", "churn_rate", "inventory_days", "nps_score", "employee_turnover_rate"],
};

export function ConfirmationSummary({ payload, enabledKpis, companyName, onConfirm, onCancel, isSubmitting, isSubmitted = false, isCanceled = false, detectedDocuments, requiredDocs, requiredDocCadences, submissionPeriod, compact = false, onToggleDoc, onEdit, versionNumber }: Props) {
  const [editableKpis, setEditableKpis] = useState<Record<string, KpiEntry>>(() => ({ ...payload.kpis }));
  const [overallNote, setOverallNote] = useState(payload.overall_note ?? "");
  const [editingCell, setEditingCell] = useState<{ key: string; field: "value" | "note" } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const px = compact ? "px-2.5" : "px-5";
  const py = compact ? "py-2" : "py-4";
  const textSize = compact ? "text-[11px]" : "text-sm";
  const noteSize = compact ? "text-[10px]" : "text-xs";

  function formatDisplay(key: string, value: number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    const def = enabledKpis.find((k) => k.key === key);
    if (!def) return String(value);
    if (def.valueType === "currency") return `$${value.toLocaleString()}`;
    if (def.valueType === "percent") return `${value}%`;
    return String(value);
  }

  function startEdit(key: string, field: "value" | "note") {
    const entry = editableKpis[key];
    const raw = field === "value" ? (entry?.value ?? "") : (entry?.operator_note ?? "");
    setEditingCell({ key, field });
    setEditingValue(String(raw));
  }

  function commitEdit() {
    if (!editingCell) return;
    const { key, field } = editingCell;
    setEditableKpis((prev) => {
      const entry = { ...(prev[key] ?? { value: null }) };
      if (field === "value") {
        const trimmed = editingValue.trim();
        entry.value = trimmed === "" ? null : Number(trimmed);
      } else {
        entry.operator_note = editingValue.trim() || null;
      }
      return { ...prev, [key]: entry };
    });
    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") setEditingCell(null);
  }

  function handleConfirmClick() {
    onConfirm({ ...payload, kpis: editableKpis, overall_note: overallNote.trim() || null });
  }

  // Parse required docs
  const requiredDocKeys = (requiredDocs ?? "").split(",").filter(Boolean);


  function renderRows(kpis: typeof enabledKpis) {
    return kpis.map((kpi) => {
      const entry = editableKpis[kpi.key];
      const hasValue = entry?.value !== null && entry?.value !== undefined;
      const isEditingValue = editingCell?.key === kpi.key && editingCell.field === "value";
      const isEditingNote = editingCell?.key === kpi.key && editingCell.field === "note";

      return (
        <tr key={kpi.key} className="border-b border-border/50 last:border-0">
          <td className={`${compact ? "py-1" : "py-2"} pr-4 ${textSize} text-muted-foreground w-[35%]`}>{kpi.label}</td>

          {/* Value */}
          <td className={`${compact ? "py-1" : "py-2"} pr-4 w-[25%]`}>
            {!isSubmitted && isEditingValue ? (
              <input
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                className={`w-full ${textSize} font-medium border border-primary rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary bg-background`}
              />
            ) : isSubmitted ? (
              <span className={`${textSize} font-medium px-1 ${!hasValue ? "text-amber-600" : ""}`}>
                {formatDisplay(kpi.key, entry?.value)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => startEdit(kpi.key, "value")}
                title="Click to edit"
                className={`${textSize} font-medium text-left w-full rounded px-1 py-0.5 hover:bg-muted transition-colors cursor-text ${!hasValue ? "text-amber-600" : ""}`}
              >
                {formatDisplay(kpi.key, entry?.value)}
              </button>
            )}
          </td>

          {/* Note */}
          <td className={`${compact ? "py-1" : "py-2"} ${noteSize} text-muted-foreground w-[40%]`}>
            {!isSubmitted && isEditingNote ? (
              <input
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                placeholder="Add a note…"
                className="w-full text-xs border border-primary rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary bg-background"
              />
            ) : isSubmitted ? (
              <span className="italic">{entry?.operator_note || ""}</span>
            ) : (
              <button
                type="button"
                onClick={() => startEdit(kpi.key, "note")}
                title="Click to edit note"
                className="text-left w-full rounded px-1 py-0.5 hover:bg-muted transition-colors cursor-text italic"
              >
                {entry?.operator_note || (
                  <span className="not-italic text-muted-foreground/40">add note</span>
                )}
              </button>
            )}
          </td>
        </tr>
      );
    });
  }

  const standardKeys = new Set(Object.values(KPI_SECTIONS).flat());
  const otherKpis = enabledKpis.filter((k) => !standardKeys.has(k.key));

  return (
    <div className="border border-border rounded-xl bg-card shadow-sm overflow-hidden w-full">
      <div className={`${px} ${py} border-b border-border bg-muted/40 flex items-start justify-between gap-3`}>
        <div>
          {companyName && (
            <h3 className={`font-semibold ${compact ? "text-[11px]" : "text-base"}`}>{companyName}</h3>
          )}
          <p className={`${compact ? "text-[10px]" : "text-sm"} text-muted-foreground ${companyName ? "" : `font-semibold ${compact ? "text-[11px]" : "text-base"} text-foreground`}`}>
            {payload.submission_type === "periodic"
              ? `${formatPeriodLabel(payload.period ?? "")} Submission`
              : `FY ${payload.fiscal_year} Annual Plan`}
          </p>
          {!isSubmitted && !isCanceled && (
            <p className={`${noteSize} text-muted-foreground mt-0.5`}>
              Click any value or note to edit inline. Submit when ready.
            </p>
          )}
        </div>
        {!isSubmitted && !isCanceled && versionNumber && versionNumber > 0 && (
          <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 ${noteSize} font-medium`}>
            Editing v{versionNumber}
          </span>
        )}
        {isSubmitted && (
          <div className="flex items-center gap-1.5">
            {versionNumber && versionNumber > 1 && (
              <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 ${noteSize} font-medium`}>
                v{versionNumber}
              </span>
            )}
            <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 ${noteSize} font-medium`}>
              <CheckCircle2 className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`} /> Submitted
            </span>
          </div>
        )}
        {isCanceled && (
          <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 ${noteSize} font-medium`}>
            <XCircle className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`} /> Canceled
          </span>
        )}
      </div>

      <div className={`${px} ${compact ? "py-2 space-y-2" : "py-4 space-y-5"}`}>
        {Object.entries(KPI_SECTIONS).map(([section, keys]) => {
          const sectionKpis = enabledKpis.filter((k) => keys.includes(k.key));
          if (sectionKpis.length === 0) return null;
          return (
            <div key={section}>
              <p className={`${compact ? "text-[10px]" : "text-xs"} font-medium uppercase tracking-wide text-muted-foreground mb-0.5`}>{section}</p>
              <table className="w-full"><tbody>{renderRows(sectionKpis)}</tbody></table>
            </div>
          );
        })}

        {otherKpis.length > 0 && (
          <div>
            <p className={`${compact ? "text-[10px]" : "text-xs"} font-medium uppercase tracking-wide text-muted-foreground mb-0.5`}>Other</p>
            <table className="w-full"><tbody>{renderRows(otherKpis)}</tbody></table>
          </div>
        )}

        {/* Overall note */}
        <div className={`border-t border-border ${compact ? "pt-2" : "pt-3"}`}>
          <p className={`${noteSize} text-muted-foreground mb-1`}>Overall note</p>
          {isSubmitted ? (
            overallNote ? <p className={`${textSize} italic text-muted-foreground`}>{overallNote}</p> : null
          ) : (
            <textarea
              value={overallNote}
              onChange={(e) => setOverallNote(e.target.value)}
              placeholder="Any general context for this submission…"
              rows={2}
              className={`w-full ${textSize} resize-none border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/40 bg-background`}
            />
          )}
        </div>

        <div>
          <p className={`${noteSize} font-medium uppercase tracking-wide text-muted-foreground mb-1`}>Documents</p>
          <div className="flex items-center gap-1.5">
            {ALL_DOC_KEYS.map((key) => {
              const abbr = DOC_ABBR[key];
              const full = DOC_FULL[key];
              const required = requiredDocKeys.includes(key);
              const detected = (detectedDocuments?.includes(key) ?? false) ||
                (detectedDocuments?.includes("combined_financials") && ["balance_sheet", "income_statement", "cash_flow_statement"].includes(key));
              const editable = !isSubmitted && !isCanceled && required && !!onToggleDoc;

              let chipClass: string;
              let tipText: string;
              if (!required) {
                chipClass = "bg-gray-50 text-gray-300 border-gray-200";
                tipText = `${full} — not required`;
              } else if (detected) {
                chipClass = "bg-green-100 text-green-700 border-green-300";
                tipText = `${full} — detected`;
              } else {
                chipClass = "bg-red-100 text-red-600 border-red-300";
                tipText = `${full} — missing`;
              }

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!editable}
                  onClick={() => editable && onToggleDoc?.(key)}
                  className={`inline-flex items-center px-1.5 py-0.5 ${compact ? "text-[9px]" : "text-[10px]"} font-bold rounded border select-none ${chipClass} ${editable ? "cursor-pointer hover:opacity-80" : "cursor-default"} disabled:cursor-default`}
                  title={tipText}
                >
                  {abbr}
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {!isSubmitted && !isCanceled && (
        <div className={`${px} ${py} border-t border-border flex gap-2`}>
          {onCancel && (
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
          )}
          <Button onClick={handleConfirmClick} disabled={isSubmitting} className="flex-1">
            {isSubmitting ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</>
            ) : (
              <><CheckCircle2 className="h-4 w-4 mr-2" />Submit</>
            )}
          </Button>
        </div>
      )}

      {isSubmitted && onEdit && (
        <div className={`${px} ${py} border-t border-border`}>
          <Button variant="outline" onClick={onEdit} className="w-full" size={compact ? "sm" : "default"}>
            <Pencil className="h-3.5 w-3.5 mr-2" />
            Edit Submission
          </Button>
        </div>
      )}
    </div>
  );
}

function formatPeriodLabel(period: string): string {
  if (!period || period.length < 7) return period;
  const [year, month] = period.split("-");
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const m = parseInt(month, 10);
  return `${monthNames[m - 1] ?? month} ${year}`;
}
