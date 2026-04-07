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
  onConfirm: (editedPayload: SubmissionPayload) => void;
  onCancel?: () => void;
  isSubmitting: boolean;
  isSubmitted?: boolean;
  detectedDocuments?: string[];
}

const KPI_SECTIONS: Record<string, string[]> = {
  Finance: ["revenue", "gross_margin", "ebitda", "cash_balance", "capex", "operating_cash_flow"],
  Operations: ["customer_acquisition_cost", "headcount", "churn_rate", "inventory_days", "nps_score", "employee_turnover_rate"],
};

export function ConfirmationSummary({ payload, enabledKpis, onConfirm, onCancel, isSubmitting, isSubmitted = false, detectedDocuments }: Props) {
  const [editableKpis, setEditableKpis] = useState<Record<string, KpiEntry>>(() => ({ ...payload.kpis }));
  const [overallNote, setOverallNote] = useState(payload.overall_note ?? "");
  const [editingCell, setEditingCell] = useState<{ key: string; field: "value" | "note" } | null>(null);
  const [editingValue, setEditingValue] = useState("");

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
          <td className="py-2 pr-4 text-sm text-muted-foreground w-[35%]">{kpi.label}</td>

          {/* Value */}
          <td className="py-2 pr-4 w-[25%]">
            {!isSubmitted && isEditingValue ? (
              <input
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                className="w-full text-sm font-medium border border-primary rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary bg-background"
              />
            ) : isSubmitted ? (
              <span className={`text-sm font-medium px-1 ${!hasValue ? "text-amber-600" : ""}`}>
                {formatDisplay(kpi.key, entry?.value)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => startEdit(kpi.key, "value")}
                title="Click to edit"
                className={`text-sm font-medium text-left w-full rounded px-1 py-0.5 hover:bg-muted transition-colors cursor-text ${!hasValue ? "text-amber-600" : ""}`}
              >
                {formatDisplay(kpi.key, entry?.value)}
              </button>
            )}
          </td>

          {/* Note */}
          <td className="py-2 text-xs text-muted-foreground w-[40%]">
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
      <div className="px-5 py-4 border-b border-border bg-muted/40 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base">
            {payload.submission_type === "periodic"
              ? `${formatPeriodLabel(payload.period ?? "")} Submission`
              : `FY ${payload.fiscal_year} Annual Plan`}
          </h3>
          {!isSubmitted && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Click any value or note to edit inline. Submit when ready.
            </p>
          )}
        </div>
        {isSubmitted && (
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
            <CheckCircle2 className="h-3 w-3" /> Submitted
          </span>
        )}
      </div>

      <div className="px-5 py-4 space-y-5">
        {Object.entries(KPI_SECTIONS).map(([section, keys]) => {
          const sectionKpis = enabledKpis.filter((k) => keys.includes(k.key));
          if (sectionKpis.length === 0) return null;
          return (
            <div key={section}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{section}</p>
              <table className="w-full"><tbody>{renderRows(sectionKpis)}</tbody></table>
            </div>
          );
        })}

        {otherKpis.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Other</p>
            <table className="w-full"><tbody>{renderRows(otherKpis)}</tbody></table>
          </div>
        )}

        {/* Overall note */}
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground mb-1.5">Overall note</p>
          {isSubmitted ? (
            overallNote ? <p className="text-sm italic text-muted-foreground">{overallNote}</p> : null
          ) : (
            <textarea
              value={overallNote}
              onChange={(e) => setOverallNote(e.target.value)}
              placeholder="Any general context for this submission…"
              rows={2}
              className="w-full text-sm resize-none border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/40 bg-background"
            />
          )}
        </div>

        {!isSubmitted && detectedDocuments && detectedDocuments.length > 0 && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
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

        {!isSubmitted && missingKpis.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            Missing: {missingKpis.map((k) => k.label).join(", ")}.
          </div>
        )}
      </div>

      {!isSubmitted && (
        <div className="px-5 py-4 border-t border-border flex gap-2">
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
