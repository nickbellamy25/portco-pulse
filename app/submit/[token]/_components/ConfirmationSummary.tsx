"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
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
  detectedDocuments?: string[];
  compact?: boolean;
}

const KPI_SECTIONS: Record<string, string[]> = {
  Finance: ["revenue", "gross_margin", "ebitda", "cash_balance", "capex", "operating_cash_flow"],
  Operations: ["customer_acquisition_cost", "headcount", "churn_rate", "inventory_days", "nps_score", "employee_turnover_rate"],
};

export function ConfirmationSummary({ payload, enabledKpis, companyName, onConfirm, onCancel, isSubmitting, isSubmitted = false, detectedDocuments, compact = false }: Props) {
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

  const missingKpis = enabledKpis.filter((k) => {
    const entry = editableKpis[k.key];
    return !entry || entry.value === null || entry.value === undefined;
  });

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
          {!isSubmitted && (
            <p className={`${noteSize} text-muted-foreground mt-0.5`}>
              Click any value or note to edit inline. Submit when ready.
            </p>
          )}
        </div>
        {isSubmitted && (
          <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 ${noteSize} font-medium`}>
            <CheckCircle2 className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`} /> Submitted
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

        {detectedDocuments && detectedDocuments.length > 0 && (
          <div className={`${compact ? "p-1.5" : "p-3"} bg-green-50 border border-green-200 rounded-lg ${noteSize} text-green-800`}>
            Documents detected: {detectedDocuments.map(d => {
              const labels: Record<string, string> = {
                balance_sheet: "Balance Sheet",
                income_statement: "Income Statement",
                cash_flow_statement: "Cash Flow Statement",
                combined_financials: "Combined Financials",
                investor_update: "Investor Update",
              };
              return labels[d] || d;
            }).join(", ")}
          </div>
        )}

        {missingKpis.length > 0 && (
          <div className={`${compact ? "p-1.5" : "p-3"} bg-amber-50 border border-amber-200 rounded-lg ${noteSize} text-amber-800`}>
            Missing: {missingKpis.map((k) => k.label).join(", ")}.
          </div>
        )}
      </div>

      {!isSubmitted && (
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
