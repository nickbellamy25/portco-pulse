"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Upload, FileText, CheckCircle, Save, MessageSquarePlus, Trash2 } from "lucide-react";
import { saveSubmissionAction, updateCombinedStatementsAction, deleteSubmissionDraftAction } from "./actions";
import { format } from "date-fns";
import type {
  KpiDefinition,
  KpiValue,
  KpiPlan,
  KpiPlanValue,
  FinancialDocument,
  Company,
  Period,
  Submission,
} from "@/lib/db/schema";

type Props = {
  token: string;
  company: Company;
  period: Period;
  allPeriods: Period[];
  submission: Submission | null;
  kpiDefinitions: KpiDefinition[];
  kpiValues: KpiValue[];
  documents: FinancialDocument[];
  activePlan: KpiPlan | null;
  activePlanValues: KpiPlanValue[];
};

const DOC_TYPES = [
  { key: "balance_sheet", label: "Balance Sheet" },
  { key: "income_statement", label: "Income Statement" },
  { key: "cash_flow_statement", label: "Cash Flow Statement" },
  { key: "combined_financials", label: "Combined Financials" },
  { key: "investor_update", label: "Investor Update" },
] as const;

type DocType = typeof DOC_TYPES[number]["key"];

const COMBINED_STATEMENT_OPTIONS = [
  { key: "balance_sheet", label: "Balance Sheet" },
  { key: "income_statement", label: "Income Statement" },
  { key: "cash_flow_statement", label: "Cash Flow Statement" },
] as const;

type RagStatus = "green" | "amber" | "red";

function groupBySection(defs: KpiDefinition[]) {
  const groups: Record<string, KpiDefinition[]> = {};
  for (const def of defs) {
    const section = def.section ?? "Other";
    if (!groups[section]) groups[section] = [];
    groups[section].push(def);
  }
  return groups;
}

function formatPeriodLabel(periodStart: string) {
  return format(new Date(periodStart + "T12:00:00"), "MMMM yyyy");
}

function formatInputValue(val: string, valueType: string): string {
  if (!val || !["currency", "integer"].includes(valueType)) return val;
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return Math.floor(num).toLocaleString("en-US");
}

function formatPlanValue(value: number | null, def: KpiDefinition): string {
  if (value === null) return "—";
  if (def.valueType === "percent") return `${value}%`;
  if (def.valueType === "currency") {
    if (Math.abs(value) >= 1_000_000)
      return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000)
      return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toLocaleString("en-US")}`;
  }
  return value.toLocaleString("en-US");
}

function computeAutoRag(
  actual: number | null,
  plan: number | null,
  greenPct: number,
  amberPct: number,
  direction: string
): RagStatus | null {
  if (actual === null || plan === null || plan === 0) return null;
  const rawVariancePct = ((actual - plan) / Math.abs(plan)) * 100;
  // Positive signedVariance = good direction, negative = bad direction
  const signedVariance =
    direction === "higher_is_better" ? rawVariancePct : -rawVariancePct;
  if (signedVariance >= -greenPct) return "green";
  if (signedVariance >= -amberPct) return "amber";
  return "red";
}

const RAG_CONFIG: Record<RagStatus, { label: string; dot: string; text: string; bg: string; border: string }> = {
  green: { label: "On Track", dot: "bg-green-500", text: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
  amber: { label: "At Risk",  dot: "bg-amber-400", text: "text-amber-700", bg: "bg-amber-50",  border: "border-amber-200"  },
  red:   { label: "Off Track", dot: "bg-red-500",   text: "text-red-700",   bg: "bg-red-50",   border: "border-red-200"   },
};

export function SubmissionForm({
  token,
  company,
  period,
  allPeriods,
  submission,
  kpiDefinitions,
  kpiValues,
  documents,
  activePlan,
  activePlanValues,
}: Props) {
  const router = useRouter();
  const isSubmitted = submission?.status === "submitted";

  // ── Actual values ────────────────────────────────────────────────────────────
  const initialValues: Record<string, string> = {};
  for (const def of kpiDefinitions) {
    const existing = kpiValues.find((v) => v.kpiDefinitionId === def.id);
    if (existing) {
      initialValues[def.id] =
        existing.actualNumber !== null && existing.actualNumber !== undefined
          ? String(existing.actualNumber)
          : existing.actualText ?? "";
    }
  }
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  // ── Per-KPI notes ────────────────────────────────────────────────────────────
  const initialKpiNotes: Record<string, string> = {};
  for (const kv of kpiValues) {
    if (kv.note) initialKpiNotes[kv.kpiDefinitionId] = kv.note;
  }
  const [kpiNotes, setKpiNotes] = useState<Record<string, string>>(initialKpiNotes);


  // ── Submission note ──────────────────────────────────────────────────────────
  const [submissionNote, setSubmissionNote] = useState<string>(
    (submission as any)?.note ?? ""
  );

  // ── Note expansion state ─────────────────────────────────────────────────────
  const initialExpanded = new Set<string>(Object.keys(initialKpiNotes));
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(initialExpanded);

  // ── Upload / doc state ───────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [currentDocs, setCurrentDocs] = useState<FinancialDocument[]>(documents);

  const existingCombined = documents.find((d) => d.documentType === "combined_financials");
  const initialStatements = new Set<string>(
    existingCombined?.includedStatements?.split(",").filter(Boolean) ?? []
  );
  const [combinedStatements, setCombinedStatements] = useState<Set<string>>(initialStatements);
  const [updatingStatements, setUpdatingStatements] = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function handleChange(defId: string, raw: string) {
    setValues((prev) => ({ ...prev, [defId]: raw.replace(/,/g, "") }));
  }

  function handlePeriodChange(newPeriodId: string) {
    router.push(`/submit/${token}?period=${newPeriodId}`);
  }

  function getPlanValue(kpiDefId: string): number | null {
    const pv = activePlanValues.find((v) => v.kpiDefinitionId === kpiDefId);
    return pv?.value ?? null;
  }

  function getAutoRag(def: KpiDefinition): RagStatus | null {
    if (!activePlan) return null;
    const planVal = getPlanValue(def.id);
    const actualStr = values[def.id];
    const actual = actualStr !== "" && actualStr !== undefined ? Number(actualStr) : null;
    if (isNaN(actual as number)) return null;
    return computeAutoRag(
      actual,
      planVal,
      (def as any).ragGreenPct ?? 5,
      (def as any).ragAmberPct ?? 15,
      (def as any).ragDirection ?? "higher_is_better"
    );
  }

  // ── Save / submit ────────────────────────────────────────────────────────────
  async function handleSave(action: "draft" | "submit") {
    setSaving(true);
    try {
      const payload: Record<string, string | number | null> = {};
      for (const [id, val] of Object.entries(values)) {
        const def = kpiDefinitions.find((d) => d.id === id);
        if (!def) continue;
        if (["currency", "percent", "integer"].includes(def.valueType)) {
          payload[id] = val === "" ? null : Number(val);
        } else {
          payload[id] = val === "" ? null : val;
        }
      }

      const ragPayload: Record<string, { override: RagStatus | null; reason: string }> = {};
      for (const def of kpiDefinitions) {
        if (activePlan) {
          ragPayload[def.id] = { override: null, reason: "" };
        }
      }

      await saveSubmissionAction(
        token,
        payload,
        action,
        period.id,
        kpiNotes,
        ragPayload,
        submissionNote
      );
      toast.success(
        action === "submit" ? "Submission submitted successfully!" : "Draft saved."
      );
      if (action === "submit") window.location.reload();
    } catch (err: any) {
      toast.error(err?.message ?? "An error occurred.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatement(statementKey: string, checked: boolean) {
    const combinedDoc = currentDocs.find((d) => d.documentType === "combined_financials");
    const next = new Set(combinedStatements);
    if (checked) next.add(statementKey);
    else next.delete(statementKey);
    setCombinedStatements(next);

    if (combinedDoc) {
      setUpdatingStatements(true);
      try {
        await updateCombinedStatementsAction(combinedDoc.id, Array.from(next));
      } catch {
        toast.error("Failed to update included statements.");
        setCombinedStatements(combinedStatements);
      } finally {
        setUpdatingStatements(false);
      }
    }
  }

  async function handleFileUpload(docType: DocType, file: File) {
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File must be under 25MB.");
      return;
    }
    const allowed = [
      "application/pdf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.type)) {
      toast.error("Unsupported file type. Use PDF, Excel, PowerPoint, or Word.");
      return;
    }

    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);
      formData.append("token", token);
      formData.append("periodId", period.id);
      if (docType === "combined_financials") {
        formData.append("includedStatements", Array.from(combinedStatements).join(","));
      }

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Upload failed");
      }
      const doc = await res.json();
      setCurrentDocs((prev) => [
        ...prev.filter((d) => d.documentType !== docType || d.version < doc.version),
        doc,
      ]);
      toast.success(`${file.name} uploaded.`);
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  const sections = groupBySection(kpiDefinitions);
  const combinedDoc = currentDocs.find((d) => d.documentType === "combined_financials");
  const requiredDocKeys = new Set<string>(
    ((company as any).requiredDocs ?? "").split(",").filter(Boolean)
  );

  // Doc cadence filtering — a required doc not due this period shows as "not due"
  const periodMonth = parseInt(period.periodStart.slice(5, 7), 10);
  const docCadenceMap: Record<string, string> = {};
  for (const entry of ((company as any).requiredDocCadences ?? "").split(",").filter(Boolean)) {
    const [key, cadence] = entry.split(":");
    if (key && cadence) docCadenceMap[key] = cadence;
  }
  function isDocDue(key: string): boolean {
    const cadence = docCadenceMap[key] ?? "monthly";
    const m = periodMonth;
    if (cadence === "quarterly") return m % 3 === 0;
    if (cadence === "bi-annual") return m === 6 || m === 12;
    if (cadence === "annual")    return m === 12;
    return true;
  }
  const DOC_CADENCE_LABELS: Record<string, string> = {
    quarterly: "Quarterly", "bi-annual": "Bi-annual", annual: "Annual",
  };

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-border">
        <Label className="shrink-0 text-sm font-medium">Submitting for</Label>
        <select
          value={period.id}
          onChange={(e) => handlePeriodChange(e.target.value)}
          className="flex-1 text-sm border border-border rounded-md px-3 py-1.5 bg-white"
        >
          {allPeriods.map((p) => (
            <option key={p.id} value={p.id}>
              {formatPeriodLabel(p.periodStart)}
            </option>
          ))}
        </select>
        {activePlan && (
          <span className="text-xs text-muted-foreground shrink-0">
            {activePlan.fiscalYear} plan active
          </span>
        )}
      </div>

      {isSubmitted && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
          <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
          <div>
            <p className="font-medium text-green-800">Submission Complete</p>
            <p className="text-sm text-green-700">
              Any changes will revert the submission to draft. Recipients will be notified on re-submission.
            </p>
          </div>
        </div>
      )}

      {/* KPI Entry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">KPI Data Entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(sections).map(([section, defs]) => (
            <div key={section}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {section}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                {defs.map((def) => {
                  const planVal = getPlanValue(def.id);
                  const hasPlan = activePlan !== null;
                  const effectiveRag = getAutoRag(def);
                  const noteExpanded = expandedNotes.has(def.id);
                  const isNumeric = ["currency", "percent", "integer"].includes(def.valueType);

                  return (
                    <div key={def.id} className="space-y-1.5">
                      {/* Label */}
                      <Label htmlFor={def.id} className="flex items-center gap-1">
                        {def.label}
                        {def.unit && (
                          <span className="text-xs text-muted-foreground">({def.unit})</span>
                        )}
                        {def.isRequired && (
                          <span className="text-red-500 text-xs">*</span>
                        )}
                      </Label>

                      {/* Input */}
                      {def.valueType === "text" ? (
                        <Textarea
                          id={def.id}
                          value={values[def.id] ?? ""}
                          onChange={(e) => handleChange(def.id, e.target.value)}
                          className="resize-none"
                          rows={2}
                        />
                      ) : def.valueType === "boolean" ? (
                        <div className="mt-1">
                          <Switch
                            id={def.id}
                            checked={values[def.id] === "true"}
                            onCheckedChange={(checked) =>
                              handleChange(def.id, checked ? "true" : "false")
                            }
                          />
                        </div>
                      ) : def.valueType === "date" ? (
                        <Input
                          id={def.id}
                          type="date"
                          value={values[def.id] ?? ""}
                          onChange={(e) => handleChange(def.id, e.target.value)}
                        />
                      ) : (
                        <Input
                          id={def.id}
                          type="text"
                          inputMode="numeric"
                          value={formatInputValue(values[def.id] ?? "", def.valueType)}
                          onChange={(e) => handleChange(def.id, e.target.value)}
                          placeholder=""
                        />
                      )}

                      {/* Plan context + RAG (numeric KPIs with a plan only) */}
                      {hasPlan && isNumeric && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {activePlan!.granularity === "annual" ? "Annual target:" : "Monthly target:"}
                            {" "}
                            <span className="font-medium text-foreground/70">
                              {planVal !== null ? formatPlanValue(planVal, def) : "—"}
                            </span>
                          </span>
                          {effectiveRag && (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${RAG_CONFIG[effectiveRag].bg} ${RAG_CONFIG[effectiveRag].text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${RAG_CONFIG[effectiveRag].dot}`} />
                              {RAG_CONFIG[effectiveRag].label}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Per-KPI note */}
                      <div>
                        {!noteExpanded ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedNotes((prev) => new Set([...prev, def.id]))
                            }
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <MessageSquarePlus className="h-3 w-3" />
                            Add note
                          </button>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Note</span>
                              {!kpiNotes[def.id] && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedNotes((prev) => {
                                      const next = new Set(prev);
                                      next.delete(def.id);
                                      return next;
                                    })
                                  }
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                            <Textarea
                              value={kpiNotes[def.id] ?? ""}
                              onChange={(e) =>
                                setKpiNotes((prev) => ({ ...prev, [def.id]: e.target.value }))
                              }
                              placeholder="Add a note for this KPI…"
                              className="resize-none text-xs"
                              rows={2}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <Separator />

          {/* Submission-level note */}
          <div>
            <Label htmlFor="submission-note" className="text-sm font-medium">
              Submission Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="submission-note"
              value={submissionNote}
              onChange={(e) => setSubmissionNote(e.target.value)}
              placeholder="Add any overall comments about this submission…"
              className="mt-1 resize-none"
              rows={3}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            {!isSubmitted && (
              <Button
                variant="outline"
                onClick={() => handleSave("draft")}
                disabled={saving}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Draft"}
              </Button>
            )}
            <Button
              onClick={() => handleSave("submit")}
              disabled={saving}
              className="flex items-center gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {saving ? "Submitting..." : isSubmitted ? "Re-Submit" : "Submit"}
            </Button>
            {submission && !isSubmitted && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm("Delete this draft? This cannot be undone.")) return;
                  await deleteSubmissionDraftAction(token, submission.id);
                  router.refresh();
                }}
                disabled={saving}
                className="flex items-center gap-2 text-destructive hover:text-destructive ml-auto"
              >
                <Trash2 className="h-4 w-4" />
                Delete Draft
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Financial Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financial Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {DOC_TYPES.map(({ key, label }) => {
              const uploaded = currentDocs.filter((d) => d.documentType === key);
              const latest = uploaded.sort((a, b) => b.version - a.version)[0];
              const isCombined = key === "combined_financials";
              const requiredStatementCount = ["balance_sheet", "income_statement", "cash_flow_statement"]
                .filter((s) => requiredDocKeys.has(s)).length;
              const inRequiredList = isCombined ? requiredStatementCount >= 2 : requiredDocKeys.has(key);
              const due = isDocDue(key);
              const isRequired = inRequiredList && due;
              const isNotDueThisPeriod = inRequiredList && !due;
              const cadenceLabelForKey = DOC_CADENCE_LABELS[docCadenceMap[key] ?? ""] ?? null;

              return (
                <div
                  key={key}
                  className={`rounded-lg border bg-muted/20 transition-opacity ${isRequired ? "border-border" : isNotDueThisPeriod ? "border-border/50 opacity-60" : "border-border/40 opacity-40"}`}
                >
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        {latest && (
                          <p className="text-xs text-muted-foreground">
                            {latest.fileName} (v{latest.version})
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isNotDueThisPeriod && (
                        <Badge className="bg-muted text-muted-foreground border-border/60 text-xs">
                          {cadenceLabelForKey ?? "Not due"} — not due this month
                        </Badge>
                      )}
                      {latest && isRequired && (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                          Uploaded
                        </Badge>
                      )}
                      <label className={isRequired ? "cursor-pointer" : "cursor-not-allowed pointer-events-none"}>
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.xls,.xlsx,.ppt,.pptx,.doc,.docx"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(key as DocType, file);
                            e.target.value = "";
                          }}
                          disabled={uploading === key || !isRequired}
                        />
                        <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors">
                          <Upload className="h-3.5 w-3.5" />
                          {uploading === key ? "Uploading..." : latest ? "Replace" : "Upload"}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Combined financials — statement toggles */}
                  {isCombined && (
                    <div className="px-3 pb-3 pt-0 border-t border-border/60">
                      <p className="text-xs text-muted-foreground mb-2 mt-2">
                        Statements included in this document
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {COMBINED_STATEMENT_OPTIONS.map(({ key: sk, label: sl }) => {
                          const checked = combinedStatements.has(sk);
                          const statementRequired = isRequired && requiredDocKeys.has(sk);
                          return (
                            <button
                              key={sk}
                              type="button"
                              disabled={updatingStatements || !statementRequired}
                              onClick={() => statementRequired && handleToggleStatement(sk, !checked)}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                                !statementRequired
                                  ? "opacity-40 cursor-not-allowed bg-white text-muted-foreground border-border"
                                  : checked
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-white text-muted-foreground border-border hover:border-primary/50"
                              }`}
                            >
                              {sl}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Accepted: PDF, Excel, PowerPoint, Word. Max 25MB per file.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
