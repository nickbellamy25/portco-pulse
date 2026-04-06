"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, Save, RefreshCw, History, Trash2 } from "lucide-react";
import { savePlanAction, deletePlanDraftAction } from "./actions";
import { format } from "date-fns";
import type { KpiDefinition, KpiPlan, KpiPlanValue, Company } from "@/lib/db/schema";

type Props = {
  token: string;
  company: Company;
  kpiDefinitions: KpiDefinition[];
  plan: KpiPlan | null;
  planValues: KpiPlanValue[];
  fiscalYear: number;
  availableYears: number[];
  allPlanVersions: KpiPlan[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function groupBySection(defs: KpiDefinition[]) {
  const groups: Record<string, KpiDefinition[]> = {};
  for (const def of defs) {
    const section = def.section ?? "Other";
    if (!groups[section]) groups[section] = [];
    groups[section].push(def);
  }
  return groups;
}

function formatInputValue(val: string, valueType: string): string {
  if (!val || !["currency", "integer"].includes(valueType)) return val;
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return Math.floor(num).toLocaleString("en-US");
}

function versionLabel(version: number): string {
  return version === 1 ? "Original" : `Rev ${version - 1}`;
}

export function PlanForm({
  token,
  company,
  kpiDefinitions,
  plan,
  planValues,
  fiscalYear,
  availableYears,
  allPlanVersions,
}: Props) {
  const router = useRouter();

  const isSubmitted = plan?.submittedAt !== null && plan?.submittedAt !== undefined;
  const isReadOnly = isSubmitted;

  // Build initial values from existing plan values
  const initialValues: Record<string, string> = {};
  for (const pv of planValues) {
    if (pv.periodMonth === null || pv.periodMonth === undefined) {
      initialValues[pv.kpiDefinitionId] = pv.value !== null ? String(pv.value) : "";
    } else if (pv.periodMonth >= 101) {
      // Quarterly: periodMonth = 100 + quarter (101-104)
      const quarter = pv.periodMonth - 100;
      initialValues[`${pv.kpiDefinitionId}_q_${quarter}`] = pv.value !== null ? String(pv.value) : "";
    } else {
      // Monthly: periodMonth = 1-12
      initialValues[`${pv.kpiDefinitionId}_m_${pv.periodMonth}`] = pv.value !== null ? String(pv.value) : "";
    }
  }

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [note, setNote] = useState(plan?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  function handleChange(key: string, raw: string) {
    setValues((prev) => ({ ...prev, [key]: raw.replace(/,/g, "") }));
  }

  function handleYearChange(newYear: string) {
    router.push(`/plan/${token}?year=${newYear}`);
  }

  async function handleSave(action: "draft" | "submit") {
    setSaving(true);
    try {
      const payload: Record<string, number | null> = {};
      for (const [key, val] of Object.entries(values)) {
        payload[key] = val === "" ? null : Number(val);
      }
      await savePlanAction(token, payload, note, action, fiscalYear, "annual");
      toast.success(
        action === "submit" ? "Plan submitted successfully!" : "Draft saved."
      );
      window.location.reload();
    } catch (err: any) {
      toast.error(err?.message ?? "An error occurred.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartRevision() {
    // Saves a draft revision (server detects submitted state and creates new version)
    setSaving(true);
    try {
      const payload: Record<string, number | null> = {};
      for (const [key, val] of Object.entries(values)) {
        payload[key] = val === "" ? null : Number(val);
      }
      await savePlanAction(token, payload, note, "draft", fiscalYear, "annual");
      toast.success("Revision started. You can now edit the plan.");
      window.location.reload();
    } catch (err: any) {
      toast.error(err?.message ?? "An error occurred.");
    } finally {
      setSaving(false);
    }
  }

  const sections = groupBySection(kpiDefinitions);

  return (
    <div className="space-y-6">
      {/* Year selector + version badge */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-border">
        <Label className="shrink-0 text-sm font-medium">Fiscal Year</Label>
        <select
          value={fiscalYear}
          onChange={(e) => handleYearChange(e.target.value)}
          className="text-sm border border-border rounded-md px-3 py-1.5 bg-white"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {plan && (
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="outline" className="text-xs">
              {versionLabel(plan.version)}
            </Badge>
            {allPlanVersions.length > 1 && (
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
            )}
          </div>
        )}
      </div>

      {/* Version history */}
      {showHistory && allPlanVersions.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Plan History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {allPlanVersions.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{versionLabel(v.version)}</span>
                    {v.id === plan?.id && (
                      <Badge variant="outline" className="text-xs">Current</Badge>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {v.submittedAt
                      ? `Submitted ${format(new Date(v.submittedAt), "MMM d, yyyy")}`
                      : "Draft"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submitted banner */}
      {isSubmitted && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="font-medium text-green-800">Plan Submitted</p>
              <p className="text-sm text-green-700">
                Submitted {plan?.submittedAt ? format(new Date(plan.submittedAt), "MMMM d, yyyy") : ""}
                {plan && plan.version > 1 ? ` · ${versionLabel(plan.version)}` : ""}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleStartRevision}
            disabled={saving}
            className="flex items-center gap-2 shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Revise Plan
          </Button>
        </div>
      )}

      {/* KPI Entry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{fiscalYear} Plan Targets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(sections).map(([section, defs]) => (
            <div key={section}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{section}</h3>
              {/* Annual KPIs in 2-col grid */}
              {defs.filter(d => {
                const g = (d as any).planGranularity ?? "annual_total";
                return g === "annual_total" || g === "annual_end" || g === "annual";
              }).length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  {defs.filter(d => {
                    const g = (d as any).planGranularity ?? "annual_total";
                    return g === "annual_total" || g === "annual_end" || g === "annual";
                  }).map((def) => (
                    <div key={def.id}>
                      <Label htmlFor={def.id} className="flex items-center gap-1">
                        {def.label}
                        {def.unit && <span className="text-xs text-muted-foreground">({def.unit})</span>}
                      </Label>
                      <Input
                        id={def.id}
                        type="text"
                        inputMode="numeric"
                        value={formatInputValue(values[def.id] ?? "", def.valueType)}
                        onChange={(e) => !isReadOnly && handleChange(def.id, e.target.value)}
                        readOnly={isReadOnly}
                        className={`mt-1 ${isReadOnly ? "bg-muted/40 cursor-default" : ""}`}
                        placeholder={isReadOnly ? "—" : ""}
                      />
                    </div>
                  ))}
                </div>
              )}
              {/* Quarterly KPIs */}
              {defs.filter(d => {
                const g = (d as any).planGranularity ?? "annual_total";
                return g === "quarterly_total" || g === "quarterly_end";
              }).length > 0 && (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left font-medium text-muted-foreground py-2 pr-4 min-w-[160px]">KPI</th>
                        {["Q1", "Q2", "Q3", "Q4"].map(q => (
                          <th key={q} className="text-center font-medium text-muted-foreground py-2 px-2 min-w-[90px]">{q}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {defs.filter(d => {
                        const g = (d as any).planGranularity ?? "annual_total";
                        return g === "quarterly_total" || g === "quarterly_end";
                      }).map((def) => (
                        <tr key={def.id} className="border-t border-border/50">
                          <td className="py-2 pr-4 align-middle">
                            <span className="font-medium">{def.label}</span>
                            {def.unit && <span className="text-xs text-muted-foreground ml-1">({def.unit})</span>}
                          </td>
                          {[1, 2, 3, 4].map((q) => {
                            const key = `${def.id}_q_${q}`;
                            return (
                              <td key={q} className="py-2 px-2 align-middle">
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  value={formatInputValue(values[key] ?? "", def.valueType)}
                                  onChange={(e) => !isReadOnly && handleChange(key, e.target.value)}
                                  readOnly={isReadOnly}
                                  className={`h-8 text-xs text-center px-1 ${isReadOnly ? "bg-muted/40 cursor-default" : ""}`}
                                  placeholder={isReadOnly ? "—" : "0"}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Monthly KPIs */}
              {defs.filter(d => (d as any).planGranularity === "monthly").length > 0 && (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left font-medium text-muted-foreground py-2 pr-4 min-w-[160px]">KPI</th>
                        {MONTHS.map(m => (
                          <th key={m} className="text-center font-medium text-muted-foreground py-2 px-1 min-w-[80px]">{m}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {defs.filter(d => (d as any).planGranularity === "monthly").map((def) => (
                        <tr key={def.id} className="border-t border-border/50">
                          <td className="py-2 pr-4 align-middle">
                            <span className="font-medium">{def.label}</span>
                            {def.unit && <span className="text-xs text-muted-foreground ml-1">({def.unit})</span>}
                          </td>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                            const key = `${def.id}_m_${month}`;
                            return (
                              <td key={month} className="py-2 px-1 align-middle">
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  value={formatInputValue(values[key] ?? "", def.valueType)}
                                  onChange={(e) => !isReadOnly && handleChange(key, e.target.value)}
                                  readOnly={isReadOnly}
                                  className={`h-8 text-xs text-center px-1 ${isReadOnly ? "bg-muted/40 cursor-default" : ""}`}
                                  placeholder={isReadOnly ? "—" : "0"}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {/* Overall note */}
          <div className="pt-2 border-t border-border/50">
            <Label htmlFor="plan-note" className="text-sm font-medium">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="plan-note"
              value={note}
              onChange={(e) => !isReadOnly && setNote(e.target.value)}
              readOnly={isReadOnly}
              placeholder={isReadOnly ? "" : "Add any context or assumptions behind your plan targets…"}
              className={`mt-1 resize-none ${isReadOnly ? "bg-muted/40 cursor-default" : ""}`}
              rows={3}
            />
          </div>

          {/* Action buttons — hidden when read-only */}
          {!isReadOnly && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => handleSave("draft")}
                disabled={saving}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save Draft"}
              </Button>
              <Button
                onClick={() => handleSave("submit")}
                disabled={saving}
                className="flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                {saving ? "Submitting…" : plan ? `Submit ${versionLabel(plan.version)}` : "Submit Plan"}
              </Button>
              {plan && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm("Delete this draft? This cannot be undone.")) return;
                    await deletePlanDraftAction(token, plan.id);
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
