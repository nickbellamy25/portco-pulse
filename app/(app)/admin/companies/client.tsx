"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Plus, ExternalLink, Trash2, X, AlertTriangle, Building2, Pencil, Check, ChevronDown, CheckCircle2, Send, MessageSquare } from "lucide-react";
import { SettingsNav } from "@/components/layout/settings-nav";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import type { Company, User, KpiDefinition, EmailSettings, UserAccessScope, KpiCadenceOverride, KpiAlertOverride, KpiRagOverride } from "@/lib/db/schema";
import { KPI_LIBRARY } from "@/lib/kpi-library";
import { cn } from "@/lib/utils";
import {
  saveCompanyAction,
  updateCompanyBasicAction,
  updateCompanyScheduleAction,
  updateCompanyDocsAction,
  addCompanyUserAction,
  removeCompanyUserAction,
  updateCompanyUserEmailAction,
  addCustomKpiAction,
  deleteCustomKpiAction,
  deleteCompanyAction,
  saveCompanyEmailSettingsAction,
  type CompanyEmailEventSettings,
  updateCustomKpiRagCriteriaAction,
  upsertKpiCadenceOverrideAction,
  deleteKpiCadenceOverrideAction,
  upsertKpiAlertOverrideAction,
  deleteKpiAlertOverrideAction,
  upsertKpiRagOverrideAction,
  deleteKpiRagOverrideAction,
  sendOnboardingRequestAction,
} from "./actions";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Central European Time" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Japan (JST)" },
  { value: "Asia/Shanghai", label: "China (CST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
  { value: "UTC", label: "UTC" },
];

const REQUIRED_DOCS = [
  { key: "balance_sheet", label: "Balance Sheet" },
  { key: "income_statement", label: "Income Statement" },
  { key: "cash_flow_statement", label: "Cash Flow Statement" },
  { key: "investor_update", label: "Investor Update" },
];

type Props = {
  companies: Company[];
  firmId: string;
  allUsers: User[];
  customKpis: KpiDefinition[];
  firmKpiDefs: KpiDefinition[];
  firmDueDaysMonthly: number;
  firmDueDaysQuarterly: number;
  firmDueDaysBiAnnual: number;
  firmDueDaysAnnual: number;
  firmReminderDays: number;
  firmRequiredDocs: string | null;
  firmRequiredDocCadences: string | null;
  firmEmailSettings: EmailSettings | null;
  firmLevelUsers: User[];
  firmUserScopes: UserAccessScope[];
  isOperator?: boolean;      // PE operator — limited access, read-only company info
  isIndependent?: boolean;   // Independent operator — full access, own company only, 1-tier KPIs
  firmType?: "pe_firm" | "operating_company";
  cadenceOverrides: KpiCadenceOverride[];
  alertOverrides: KpiAlertOverride[];
  ragOverrides: KpiRagOverride[];
};

// ─── Company Info Section ─────────────────────────────────────────────────────

function CompanyInfoSection({
  company,
  onSaved,
  readOnly,
}: {
  company: Company;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const [name, setName] = useState(company.name);
  const [sector, setSector] = useState(company.industry ?? "");
  const [timezone, setTimezone] = useState((company as any).timezone ?? "America/New_York");
  const [fund, setFund] = useState((company as any).fund ?? "");
  const [status, setStatus] = useState<"current" | "exited">((company as any).status ?? "current");
  const [investmentDate, setInvestmentDate] = useState<string>((company as any).investmentDate ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { toast.error("Company name is required."); return; }
    setSaving(true);
    try {
      await updateCompanyBasicAction({ id: company.id, name, industry: sector, timezone, fund, status, investmentDate: investmentDate || null });
      toast.success("Company updated.");
      onSaved();
    } catch {
      toast.error("Failed to update company.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 p-6">
      {readOnly && (
        <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
          Company information is managed by your investment firm.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Company Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" disabled={readOnly} />
        </div>
        <div>
          <Label>Timezone</Label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1.5 w-full text-sm border border-border rounded-md px-3 py-2 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={readOnly}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Fund</Label>
          <Input
            value={fund}
            onChange={(e) => setFund(e.target.value)}
            placeholder="e.g. Fund II (leave blank if independent)"
            className="mt-1.5"
            disabled={readOnly}
          />
        </div>
        <div>
          <Label>Industry</Label>
          <Input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="e.g. Industrials, SaaS"
            className="mt-1.5"
            disabled={readOnly}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Status</Label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "current" | "exited")}
            className="mt-1.5 w-full text-sm border border-border rounded-md px-3 py-2 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={readOnly}
          >
            <option value="current">Currently Held</option>
            <option value="exited">Exited</option>
          </select>
        </div>
        <div>
          <Label>Initial investment date</Label>
          <input
            type="date"
            value={investmentDate}
            onChange={(e) => setInvestmentDate(e.target.value)}
            className="mt-1.5 w-full text-sm border border-border rounded-md px-3 py-2 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={readOnly}
          />
        </div>
      </div>
      {!readOnly && (
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Submission Overrides Tab ─────────────────────────────────────────────────

const DOC_CADENCE_OPTIONS = [
  { value: "monthly",   label: "Every month" },
  { value: "quarterly", label: "Quarterly" },
  { value: "bi-annual", label: "Bi-annual" },
  { value: "annual",    label: "Annual" },
];

function SubmissionOverridesTab({
  company,
  firmDueDaysMonthly,
  firmDueDaysQuarterly,
  firmDueDaysBiAnnual,
  firmDueDaysAnnual,
  firmReminderDays,
  firmRequiredDocs,
  firmRequiredDocCadences,
}: {
  company: Company;
  firmDueDaysMonthly: number;
  firmDueDaysQuarterly: number;
  firmDueDaysBiAnnual: number;
  firmDueDaysAnnual: number;
  firmReminderDays: number;
  firmRequiredDocs: string | null;
  firmRequiredDocCadences: string | null;
}) {
  const parseDocs = (s: string | null, fallback: string) =>
    (s ?? fallback).split(",").filter(Boolean);
  const parseCadences = (s: string | null) => {
    const map: Record<string, string> = {};
    for (const entry of (s ?? "").split(",").filter(Boolean)) {
      const [key, cadence] = entry.split(":");
      if (key && cadence) map[key] = cadence;
    }
    return map;
  };

  const firmDocs = new Set(parseDocs(firmRequiredDocs, "balance_sheet,income_statement,cash_flow_statement"));
  const firmCad = parseCadences(firmRequiredDocCadences);
  const initialDocs = (company as any).requiredDocs as string | null;
  const initialDocCadences = (company as any).requiredDocCadences as string | null;

  // Schedule state
  const [dueDaysMonthlyOverride, setDueDaysMonthlyOverride] = useState<string>(
    (company as any).dueDaysMonthly != null ? String((company as any).dueDaysMonthly) : ""
  );
  const [dueDaysQuarterlyOverride, setDueDaysQuarterlyOverride] = useState<string>(
    (company as any).dueDaysQuarterly != null ? String((company as any).dueDaysQuarterly) : ""
  );
  const [dueDaysBiAnnualOverride, setDueDaysBiAnnualOverride] = useState<string>(
    (company as any).dueDaysBiAnnual != null ? String((company as any).dueDaysBiAnnual) : ""
  );
  const [dueDaysAnnualOverride, setDueDaysAnnualOverride] = useState<string>(
    (company as any).dueDaysAnnual != null ? String((company as any).dueDaysAnnual) : ""
  );
  const [reminderDaysOverride, setReminderDaysOverride] = useState<string>(
    (company as any).reminderDaysBeforeDue != null ? String((company as any).reminderDaysBeforeDue) : ""
  );

  // Docs state
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(parseDocs(initialDocs, firmRequiredDocs ?? "balance_sheet,income_statement,cash_flow_statement"))
  );
  const [cadences, setCadencesState] = useState<Record<string, string>>(
    () => parseCadences(initialDocs !== null ? initialDocCadences : firmRequiredDocCadences)
  );

  const [saving, setSaving] = useState(false);

  function serialize(c: Record<string, string>) {
    return Object.entries(c).map(([k, v]) => `${k}:${v}`).join(",");
  }

  function parseOverride(val: string, min: number, max: number): number | null | "invalid" {
    if (!val.trim()) return null;
    const n = parseInt(val, 10);
    if (isNaN(n) || n < min || n > max) return "invalid";
    return n;
  }

  async function handleSave() {
    const monthly = parseOverride(dueDaysMonthlyOverride, 1, 90);
    const quarterly = parseOverride(dueDaysQuarterlyOverride, 1, 90);
    const biAnnual = parseOverride(dueDaysBiAnnualOverride, 1, 120);
    const annual = parseOverride(dueDaysAnnualOverride, 1, 180);
    const reminder = parseOverride(reminderDaysOverride, 1, 90);
    if (monthly === "invalid") { toast.error("Monthly due days must be between 1 and 90."); return; }
    if (quarterly === "invalid") { toast.error("Quarterly due days must be between 1 and 90."); return; }
    if (biAnnual === "invalid") { toast.error("Bi-Annual due days must be between 1 and 120."); return; }
    if (annual === "invalid") { toast.error("Annual due days must be between 1 and 180."); return; }
    if (reminder === "invalid") { toast.error("Reminder days must be between 1 and 90."); return; }
    setSaving(true);
    try {
      await Promise.all([
        updateCompanyScheduleAction({
          id: company.id,
          dueDaysMonthly: monthly as number | null,
          dueDaysQuarterly: quarterly as number | null,
          dueDaysBiAnnual: biAnnual as number | null,
          dueDaysAnnual: annual as number | null,
          reminderDaysBeforeDue: reminder as number | null,
        }),
        updateCompanyDocsAction(company.id, [...checked].join(","), serialize(cadences)),
      ]);
      toast.success("Overrides saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function resetAllToFirmDefault() {
    setSaving(true);
    try {
      await Promise.all([
        updateCompanyScheduleAction({
          id: company.id,
          dueDaysMonthly: null,
          dueDaysQuarterly: null,
          dueDaysBiAnnual: null,
          dueDaysAnnual: null,
          reminderDaysBeforeDue: null,
        }),
        updateCompanyDocsAction(company.id, null as any, null as any),
      ]);
      setDueDaysMonthlyOverride("");
      setDueDaysQuarterlyOverride("");
      setDueDaysBiAnnualOverride("");
      setDueDaysAnnualOverride("");
      setReminderDaysOverride("");
      setChecked(new Set(firmDocs));
      setCadencesState({ ...firmCad });
      toast.success("Reset to firm defaults.");
    } catch { toast.error("Failed to reset."); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-6">
      <p className="text-xs font-medium bg-muted/50 border border-border rounded-md px-3 py-2">
        Changes notify firm admin.
      </p>

      {/* Schedule */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Due date by cadence</h3>
        </div>
        <div className="space-y-1.5">
          {/* Column headers */}
          <div className="flex items-center gap-0 pb-0.5">
            <span className="w-20 shrink-0" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide w-20 shrink-0">Firm default</span>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Override</span>
          </div>
          {([
            { label: "Monthly",   val: dueDaysMonthlyOverride,   set: setDueDaysMonthlyOverride,   max: 90,  firm: firmDueDaysMonthly },
            { label: "Quarterly", val: dueDaysQuarterlyOverride,  set: setDueDaysQuarterlyOverride, max: 90,  firm: firmDueDaysQuarterly },
            { label: "Bi-Annual", val: dueDaysBiAnnualOverride,   set: setDueDaysBiAnnualOverride,  max: 120, firm: firmDueDaysBiAnnual },
            { label: "Annual",    val: dueDaysAnnualOverride,     set: setDueDaysAnnualOverride,    max: 180, firm: firmDueDaysAnnual },
          ] as { label: string; val: string; set: (v: string) => void; max: number; firm: number }[]).map(({ label, val, set, max, firm }) => (
            <div key={label} className="flex items-center gap-0">
              <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
              <span className="text-xs text-muted-foreground w-20 shrink-0">{firm}</span>
              <input
                type="number" min={1} max={max}
                value={val}
                onChange={(e) => set(e.target.value)}
                placeholder="—"
                className="w-14 text-xs border border-border rounded px-2 py-1 bg-white text-center"
              />
              <span className="text-xs text-muted-foreground ml-1.5">business days after period close</span>
              {val.trim() && (
                <button type="button" onClick={() => set("")} className="text-xs text-muted-foreground hover:text-foreground ml-1.5">×</button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-0 pt-1">
            <span className="text-xs text-muted-foreground w-20 shrink-0">Reminder</span>
            <span className="text-xs text-muted-foreground w-20 shrink-0">{firmReminderDays}</span>
            <input
              type="number" min={1} max={90}
              value={reminderDaysOverride}
              onChange={(e) => setReminderDaysOverride(e.target.value)}
              placeholder="—"
              className="w-14 text-xs border border-border rounded px-2 py-1 bg-white text-center"
            />
            <span className="text-xs text-muted-foreground ml-1.5">business days before due date</span>
            {reminderDaysOverride.trim() && (
              <button type="button" onClick={() => setReminderDaysOverride("")} className="text-xs text-muted-foreground hover:text-foreground ml-1.5">×</button>
            )}
          </div>
        </div>
      </div>

      {/* Required Documents */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Required documents</h3>
        <div className="space-y-1.5">
          {/* Column headers */}
          <div className="flex items-center gap-0 pb-0.5">
            <span className="w-36 shrink-0" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide w-36 shrink-0">Firm default</span>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Override</span>
          </div>
          {REQUIRED_DOCS.map((doc) => {
            const isChecked = checked.has(doc.key);
            const cadence = cadences[doc.key] ?? "monthly";
            const firmChecked = firmDocs.has(doc.key);
            const firmCadence = firmCad[doc.key] ?? "monthly";
            const isDirty = isChecked !== firmChecked || cadence !== firmCadence;
            const firmCadenceLabel = DOC_CADENCE_OPTIONS.find((o) => o.value === firmCadence)?.label ?? firmCadence;
            return (
              <div key={doc.key} className="flex items-center gap-0">
                <span className="text-xs text-muted-foreground w-36 shrink-0">{doc.label}</span>
                <span className="text-xs text-muted-foreground w-36 shrink-0">
                  {firmChecked ? <>{firmCadenceLabel}</> : <span className="italic">Not required</span>}
                </span>
                <Checkbox
                  id={`doc-${company.id}-${doc.key}`}
                  checked={isChecked}
                  onCheckedChange={(v) => {
                    const next = new Set(checked);
                    if (v) next.add(doc.key); else next.delete(doc.key);
                    setChecked(next);
                  }}
                />
                <select
                  value={cadence}
                  onChange={(e) => setCadencesState((prev) => ({ ...prev, [doc.key]: e.target.value }))}
                  disabled={!isChecked}
                  className="text-xs border border-border rounded px-2 py-1 bg-white disabled:opacity-40 disabled:cursor-not-allowed ml-2"
                >
                  {DOC_CADENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {isDirty && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set(checked);
                      if (firmChecked) next.add(doc.key); else next.delete(doc.key);
                      setChecked(next);
                      setCadencesState((prev) => ({ ...prev, [doc.key]: firmCadence }));
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground ml-1.5"
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="button" onClick={resetAllToFirmDefault} disabled={saving} className="text-xs text-muted-foreground hover:text-foreground">
          Reset to firm default
        </button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

// ─── Authorized Users Section ─────────────────────────────────────────────────

function canFirmUserSeeCompany(user: User, scopes: UserAccessScope[], company: Company): boolean {
  if (user.role === "firm_admin") return true;
  const userScopes = scopes.filter((s) => s.userId === user.id);
  if (userScopes.length === 0) return true;
  return userScopes.some(
    (s) =>
      (s.scopeType === "company" && s.scopeValue === company.id) ||
      (s.scopeType === "fund" && s.scopeValue === (company as any).fund) ||
      (s.scopeType === "industry" && s.scopeValue === company.industry)
  );
}

function AuthorizedUsersSection({
  companyId,
  firmId,
  initialUsers,
  company,
  firmLevelUsers,
  firmUserScopes,
}: {
  companyId: string;
  firmId: string;
  initialUsers: User[];
  company: Company;
  firmLevelUsers: User[];
  firmUserScopes: UserAccessScope[];
}) {
  const [localUsers, setLocalUsers] = useState<User[]>(initialUsers);
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");

  async function handleAdd() {
    if (!addEmail.trim()) return;
    setAdding(true);
    try {
      const user = await addCompanyUserAction(companyId, firmId, addEmail);
      setLocalUsers((prev) => [...prev, user as User]);
      setAddEmail("");
      setShowAdd(false);
      toast.success("User linked.");
    } catch {
      toast.error("Failed to add user.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    try {
      await removeCompanyUserAction(userId);
      setLocalUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User removed.");
    } catch {
      toast.error("Failed to remove user.");
    }
  }

  async function handleEditSave(userId: string) {
    if (!editEmail.trim()) return;
    try {
      await updateCompanyUserEmailAction(userId, editEmail);
      setLocalUsers((prev) => prev.map((u) => u.id === userId ? { ...u, email: editEmail.trim().toLowerCase() } : u));
      setEditingId(null);
      toast.success("Email updated.");
    } catch {
      toast.error("Failed to update email.");
    }
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-start mb-3">
        <div />
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="h-3 w-3 mr-1" /> Add User
          </Button>
          <p className="text-[11px] text-muted-foreground">New users receive an email invitation to set their password.</p>
        </div>
      </div>
      {showAdd && (
        <div className="flex items-center gap-2 mb-3">
          <Input
            type="email"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            placeholder="user@company.com"
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button size="sm" onClick={handleAdd} disabled={adding}>
            {adding ? "..." : "Add"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {localUsers.map((u) => (
          <div key={u.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20">
            {editingId === u.id ? (
              <>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="text-sm h-7 flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(u.id); if (e.key === "Escape") setEditingId(null); }}
                  autoFocus
                />
                <button onClick={() => handleEditSave(u.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="text-sm flex-1">{u.email}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-muted text-muted-foreground border-border">Operator</span>
                <button onClick={() => { setEditingId(u.id); setEditEmail(u.email); }} className="text-muted-foreground hover:text-foreground transition-colors ml-1">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleRemove(u.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
        {(() => {
          const visible = firmLevelUsers.filter((u) => canFirmUserSeeCompany(u, firmUserScopes, company));
          if (visible.length === 0) return null;
          return (
            <>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Firm-level access</span>
                <div className="flex-1 border-t border-border" />
              </div>
              {visible.map((u) => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/10">
                  <span className="text-sm flex-1 text-muted-foreground">{u.name ? `${u.name} (${u.email})` : u.email}</span>
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", u.role === "firm_admin" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-muted text-muted-foreground border-border")}>
                    {u.role === "firm_admin" ? "Admin" : "Member"}
                  </span>
                </div>
              ))}
            </>
          );
        })()}
        {localUsers.length === 0 && !showAdd && (
          <p className="text-xs text-muted-foreground italic">No company users added yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Firm-Wide KPIs Section ───────────────────────────────────────────────────

const CADENCE_LABELS: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", "bi-annual": "Bi-Annual" };

function FirmKpisSection({
  companyId,
  firmId,
  firmKpiDefs,
  isIndependent,
  cadenceOverrides,
  alertOverrides,
  ragOverrides,
}: {
  companyId: string;
  firmId: string;
  firmKpiDefs: KpiDefinition[];
  isIndependent?: boolean;
  cadenceOverrides: KpiCadenceOverride[];
  alertOverrides: KpiAlertOverride[];
  ragOverrides: KpiRagOverride[];
}) {
  const [cadenceState, setCadenceState] = useState<KpiCadenceOverride[]>(cadenceOverrides);
  const [alertState, setAlertState] = useState<KpiAlertOverride[]>(alertOverrides);
  const [ragState, setRagState] = useState<KpiRagOverride[]>(ragOverrides);

  // Unified criteria editing
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [cadenceValue, setCadenceValue] = useState<"weekly" | "monthly" | "quarterly" | "bi-annual">("monthly");
  const [alertOnAmber, setAlertOnAmber] = useState(true);
  const [alertOnRed, setAlertOnRed] = useState(true);
  const [ragGreenPct, setRagGreenPct] = useState("5");
  const [ragAmberPct, setRagAmberPct] = useState("15");
  const [ragDirection, setRagDirection] = useState<"higher_is_better" | "lower_is_better" | "any_variance">("higher_is_better");
  const [saving, setSaving] = useState(false);

  const cadenceOverrideByKpiId = Object.fromEntries(cadenceState.map((o) => [o.kpiDefinitionId, o]));
  const alertOverrideByKpiId = Object.fromEntries(alertState.map((o) => [o.kpiDefinitionId, o]));
  const ragOverrideByKpiId = Object.fromEntries(ragState.map((o) => [o.kpiDefinitionId, o]));
  const sections = Array.from(new Set(firmKpiDefs.map((k) => k.section ?? "Other")));

  function startEditing(kpi: KpiDefinition) {
    const cadenceOverride = cadenceOverrideByKpiId[kpi.id];
    const alertOverride = alertOverrideByKpiId[kpi.id];
    const ragOverride = ragOverrideByKpiId[kpi.id];
    setCadenceValue((cadenceOverride?.collectionCadence ?? (kpi as any).collectionCadence ?? "monthly") as any);
    setAlertOnAmber(alertOverride ? alertOverride.ragAlertOnAmber : ((kpi as any).ragAlertOnAmber ?? true));
    setAlertOnRed(alertOverride ? alertOverride.ragAlertOnRed : ((kpi as any).ragAlertOnRed ?? true));
    setRagGreenPct(String(ragOverride?.ragGreenPct ?? (kpi as any).ragGreenPct ?? 5));
    setRagAmberPct(String(ragOverride?.ragAmberPct ?? (kpi as any).ragAmberPct ?? 15));
    setRagDirection(ragOverride?.ragDirection ?? (kpi as any).ragDirection ?? "higher_is_better");
    setEditingFor(kpi.id);
  }

  async function handleSaveOverrides(kpi: KpiDefinition) {
    setSaving(true);
    try {
      await upsertKpiCadenceOverrideAction({ firmId, companyId, kpiDefinitionId: kpi.id, collectionCadence: cadenceValue });
      await upsertKpiAlertOverrideAction({ firmId, companyId, kpiDefinitionId: kpi.id, ragAlertOnAmber: alertOnAmber, ragAlertOnRed: alertOnRed });
      await upsertKpiRagOverrideAction({ firmId, companyId, kpiDefinitionId: kpi.id, ragGreenPct: parseFloat(ragGreenPct), ragAmberPct: parseFloat(ragAmberPct), ragDirection });
      setCadenceState((prev) => [...prev.filter((o) => o.kpiDefinitionId !== kpi.id), { id: "", firmId, companyId, kpiDefinitionId: kpi.id, collectionCadence: cadenceValue }]);
      setAlertState((prev) => [...prev.filter((o) => o.kpiDefinitionId !== kpi.id), { id: "", firmId, companyId, kpiDefinitionId: kpi.id, ragAlertOnAmber: alertOnAmber, ragAlertOnRed: alertOnRed }]);
      setRagState((prev) => [...prev.filter((o) => o.kpiDefinitionId !== kpi.id), { id: "", firmId, companyId, kpiDefinitionId: kpi.id, ragGreenPct: parseFloat(ragGreenPct), ragAmberPct: parseFloat(ragAmberPct), ragDirection }]);
      setEditingFor(null);
      toast.success("Overrides saved.");
    } catch {
      toast.error("Failed to save overrides.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetOverrides(kpi: KpiDefinition) {
    setSaving(true);
    try {
      const cadenceOverride = cadenceOverrideByKpiId[kpi.id];
      const alertOverride = alertOverrideByKpiId[kpi.id];
      const ragOverride = ragOverrideByKpiId[kpi.id];
      if (cadenceOverride) await deleteKpiCadenceOverrideAction(cadenceOverride.id);
      if (alertOverride) await deleteKpiAlertOverrideAction(alertOverride.id);
      if (ragOverride) await deleteKpiRagOverrideAction(ragOverride.id);
      setCadenceState((prev) => prev.filter((o) => o.kpiDefinitionId !== kpi.id));
      setAlertState((prev) => prev.filter((o) => o.kpiDefinitionId !== kpi.id));
      setRagState((prev) => prev.filter((o) => o.kpiDefinitionId !== kpi.id));
      setEditingFor(null);
      toast.success("Overrides reset to firm defaults.");
    } catch {
      toast.error("Failed to reset overrides.");
    } finally {
      setSaving(false);
    }
  }

  if (firmKpiDefs.length === 0) {
    return (
      <div className="px-6 pb-6">
        <p className="text-xs text-muted-foreground italic">No firm-wide KPIs defined yet.</p>
      </div>
    );
  }

  return (
    <div className="px-6 pb-4 space-y-4">
      {sections.map((section) => {
        const sectionKpis = firmKpiDefs.filter((k) => (k.section ?? "Other") === section);
        return (
          <div key={section}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{section}</p>
            <div className="rounded-lg border border-border overflow-hidden">
              {sectionKpis.map((kpi, i) => {
                const isEditing = editingFor === kpi.id;
                const cadenceOverride = cadenceOverrideByKpiId[kpi.id];
                const alertOverride = alertOverrideByKpiId[kpi.id];
                const ragOverride = ragOverrideByKpiId[kpi.id];
                const hasOverride = !!(cadenceOverride || alertOverride || ragOverride);
                const firmCadence = ((kpi as any).collectionCadence ?? "monthly") as string;
                const effectiveCadence = cadenceOverride?.collectionCadence ?? firmCadence;
                const firmAlertOnAmber = (kpi as any).ragAlertOnAmber ?? true;
                const firmAlertOnRed = (kpi as any).ragAlertOnRed ?? true;
                const effectiveAlertOnAmber = alertOverride ? alertOverride.ragAlertOnAmber : firmAlertOnAmber;
                const effectiveAlertOnRed = alertOverride ? alertOverride.ragAlertOnRed : firmAlertOnRed;
                const alertLabel = effectiveAlertOnAmber && effectiveAlertOnRed ? "A+R" : effectiveAlertOnRed ? "R only" : effectiveAlertOnAmber ? "A only" : "off";
                const unitLabel = kpi.valueType === "currency" ? "$" : kpi.valueType === "percent" ? "%" : kpi.valueType === "integer" ? "#" : (kpi.unit ?? "");
                const firmDir = (kpi as any).ragDirection ?? "higher_is_better";
                const firmGPct = (kpi as any).ragGreenPct ?? 5;
                const firmAPct = (kpi as any).ragAmberPct ?? 15;
                const dir = ragOverride?.ragDirection ?? firmDir;
                const gPct = ragOverride?.ragGreenPct ?? firmGPct;
                const aPct = ragOverride?.ragAmberPct ?? firmAPct;

                return (
                  <div key={kpi.id} className={i > 0 ? "border-t border-border/60" : ""}>
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-2 min-w-[180px]">
                        <span className="text-sm font-medium">{kpi.label}</span>
                        <span className="text-xs text-muted-foreground">{unitLabel || kpi.valueType}</span>
                      </div>
                      <div className="flex-1 flex items-center gap-1.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 font-medium">
                          {!isIndependent && ragOverride && (ragOverride.ragGreenPct !== firmGPct || ragOverride.ragAmberPct !== firmAPct || ragOverride.ragDirection !== firmDir) && <span className="opacity-60 mr-0.5">↻</span>}G ≤{gPct}%
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">A ≤{aPct}%</span>
                        <span className="text-xs text-muted-foreground">{dir === "higher_is_better" ? "Higher ↑" : dir === "lower_is_better" ? "Lower ↓" : "Either ↕"}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded border font-medium ml-1 bg-blue-50 text-blue-700 border-blue-200">
                          {!isIndependent && cadenceOverride && cadenceOverride.collectionCadence !== firmCadence && <span className="opacity-60 mr-0.5">↻</span>}
                          {CADENCE_LABELS[effectiveCadence] ?? effectiveCadence}
                        </span>
                        <span className={cn("text-xs px-1.5 py-0.5 rounded border font-medium ml-0.5", (!effectiveAlertOnAmber && !effectiveAlertOnRed) ? "bg-gray-50 text-gray-400 border-gray-200" : "bg-orange-50 text-orange-700 border-orange-200")}>
                          {!isIndependent && alertOverride && (alertOverride.ragAlertOnAmber !== firmAlertOnAmber || alertOverride.ragAlertOnRed !== firmAlertOnRed) && <span className="opacity-60 mr-0.5">↻</span>}
                          🔔 {alertLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => isEditing ? setEditingFor(null) : startEditing(kpi)} className="text-xs text-muted-foreground hover:text-foreground">
                          {!isIndependent ? "Override criteria" : "Edit criteria"}
                        </button>
                      </div>
                    </div>
                    {isEditing && (
                      <div className="px-4 py-3 bg-muted/30 border-t border-border/60 space-y-2.5">
                        {/* Column headers */}
                        {!isIndependent && (
                          <div className="flex items-center gap-3 pb-0.5">
                            <span className="w-16 shrink-0" />
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide w-52 shrink-0">Firm default</span>
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Override</span>
                          </div>
                        )}
                        {/* RAG override */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">RAG</span>
                          {!isIndependent && (
                            <span className="text-xs text-muted-foreground w-52 shrink-0">
                              G ≤{firmGPct}% · A ≤{firmAPct}% · {firmDir === "higher_is_better" ? "Higher is better" : firmDir === "lower_is_better" ? "Lower is better" : "Either direction"}
                            </span>
                          )}
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">G ≤</span>
                            <input type="number" min={0} max={50} step={0.5} value={ragGreenPct} onChange={(e) => setRagGreenPct(e.target.value)} className="w-12 text-xs border border-border rounded px-1.5 py-0.5 bg-white text-center" />
                            <span className="text-xs text-muted-foreground">% · A ≤</span>
                            <input type="number" min={0} max={100} step={0.5} value={ragAmberPct} onChange={(e) => setRagAmberPct(e.target.value)} className="w-12 text-xs border border-border rounded px-1.5 py-0.5 bg-white text-center" />
                            <span className="text-xs text-muted-foreground">%</span>
                            <select value={ragDirection} onChange={(e) => setRagDirection(e.target.value as any)} className="text-xs border border-border rounded px-1.5 py-0.5 bg-white ml-1">
                              <option value="higher_is_better">Higher is better</option>
                              <option value="lower_is_better">Lower is better</option>
                              <option value="any_variance">Either direction</option>
                            </select>
                          </div>
                        </div>
                        {/* Alert override */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Alert</span>
                          {!isIndependent && (
                            <span className="text-xs text-muted-foreground w-52 shrink-0">
                              {firmAlertOnAmber && firmAlertOnRed ? "Amber + Red" : firmAlertOnRed ? "Red only" : firmAlertOnAmber ? "Amber only" : "Off"}
                            </span>
                          )}
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={alertOnAmber} onChange={(e) => setAlertOnAmber(e.target.checked)} className="h-3 w-3" />
                            <span className="text-xs px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">AMBER</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={alertOnRed} onChange={(e) => setAlertOnRed(e.target.checked)} className="h-3 w-3" />
                            <span className="text-xs px-1 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">RED</span>
                          </label>
                        </div>
                        {/* Cadence override */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Cadence</span>
                          {!isIndependent && (
                            <span className="text-xs text-muted-foreground w-52 shrink-0">
                              {CADENCE_LABELS[firmCadence] ?? firmCadence}
                            </span>
                          )}
                          <select value={cadenceValue} onChange={(e) => setCadenceValue(e.target.value as any)} className="text-xs border border-border rounded px-1.5 py-0.5 bg-white">
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="bi-annual">Bi-Annual</option>
                          </select>
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-0.5">
                          <Button size="sm" onClick={() => handleSaveOverrides(kpi)} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingFor(null)}>Cancel</Button>
                          {hasOverride && !isIndependent && (
                            <button onClick={() => handleResetOverrides(kpi)} disabled={saving} className="ml-2 text-xs text-muted-foreground hover:text-red-500 transition-colors">
                              Reset to firm defaults
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Company-Specific KPIs Section ────────────────────────────────────────────

function CustomMetricsSection({
  companyId,
  firmId,
  initialKpis,
}: {
  companyId: string;
  firmId: string;
  initialKpis: KpiDefinition[];
}) {
  const [kpis, setKpis] = useState<KpiDefinition[]>(initialKpis);

  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"library" | "custom">("library");
  const [selectedKey, setSelectedKey] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newSection, setNewSection] = useState("Finance");
  const [newUnit, setNewUnit] = useState("");
  const [newValueType, setNewValueType] = useState("currency");
  const [newRequired, setNewRequired] = useState(false);
  const [saving, setSaving] = useState(false);

  // Unified criteria editing
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [ragDirection, setRagDirection] = useState<"higher_is_better" | "lower_is_better">("higher_is_better");
  const [ragGreenPct, setRagGreenPct] = useState("5");
  const [ragAmberPct, setRagAmberPct] = useState("15");
  const [ragAlertOnAmber, setRagAlertOnAmber] = useState(true);
  const [ragAlertOnRed, setRagAlertOnRed] = useState(true);
  const [cadenceValue, setCadenceValue] = useState<"weekly" | "monthly" | "quarterly" | "bi-annual">("monthly");

  const existingKeys = new Set(kpis.map((k) => k.key));
  const availableLibrary = KPI_LIBRARY.filter((item) => !existingKeys.has(item.key));
  const selectedLibraryItem = KPI_LIBRARY.find((k) => k.key === selectedKey);
  const sections = Array.from(new Set(kpis.map((k) => k.section ?? "Other")));

  function toKey(label: string) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  function startEditing(kpi: KpiDefinition) {
    setRagDirection(((kpi as any).ragDirection ?? "higher_is_better") as "higher_is_better" | "lower_is_better");
    setRagGreenPct(String((kpi as any).ragGreenPct ?? 5));
    setRagAmberPct(String((kpi as any).ragAmberPct ?? 15));
    setRagAlertOnAmber((kpi as any).ragAlertOnAmber ?? true);
    setRagAlertOnRed((kpi as any).ragAlertOnRed ?? true);
    setCadenceValue(((kpi as any).collectionCadence ?? "monthly") as any);
    setEditingFor(kpi.id);
  }

  function closeAdd() {
    setShowAdd(false);
    setSelectedKey("");
    setPendingNote("");
    setNewLabel("");
    setNewUnit("");
    setNewRequired(false);
    setNewSection("Finance");
    setNewValueType("currency");
  }

  async function handleAddFromLibrary() {
    if (!selectedKey) return;
    const item = KPI_LIBRARY.find((k) => k.key === selectedKey);
    if (!item) return;
    if (item.requiresNote && !pendingNote.trim()) return;
    setSaving(true);
    try {
      const kpi = await addCustomKpiAction({
        firmId,
        companyId,
        key: item.key,
        label: item.label,
        section: item.section,
        unit: item.unit,
        valueType: item.valueType,
        isRequired: false,
      });
      setKpis((prev) => [...prev, kpi as KpiDefinition]);
      closeAdd();
      toast.success(`${item.label} added.`);
    } catch {
      toast.error("Failed to add KPI.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCustom() {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      const kpi = await addCustomKpiAction({
        firmId,
        companyId,
        key: toKey(newLabel),
        label: newLabel.trim(),
        section: newSection,
        unit: newUnit,
        valueType: newValueType,
        isRequired: newRequired,
      });
      setKpis((prev) => [...prev, kpi as KpiDefinition]);
      closeAdd();
      toast.success(`${newLabel.trim()} added.`);
    } catch {
      toast.error("Failed to add KPI.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCriteria(kpi: KpiDefinition) {
    const green = parseFloat(ragGreenPct);
    const amber = parseFloat(ragAmberPct);
    if (isNaN(green) || isNaN(amber) || green <= 0 || amber <= 0 || green >= amber) {
      toast.error("Green % must be less than Amber %, and both must be positive.");
      return;
    }
    setSaving(true);
    try {
      await updateCustomKpiRagCriteriaAction(kpi.id, ragDirection, green, amber, ragAlertOnAmber, ragAlertOnRed, cadenceValue);
      setKpis((prev) => prev.map((k) => k.id === kpi.id ? { ...k, ragDirection, ragGreenPct: green, ragAmberPct: amber, ragAlertOnAmber, ragAlertOnRed, collectionCadence: cadenceValue } as any : k));
      setEditingFor(null);
      toast.success("KPI criteria saved.");
    } catch {
      toast.error("Failed to save criteria.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCustomKpiAction(id);
      setKpis((prev) => prev.filter((k) => k.id !== id));
      toast.success("KPI removed.");
    } catch {
      toast.error("Failed to remove KPI.");
    }
  }

  return (
    <div className="px-6 pb-4">
      {kpis.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground italic text-center py-3 border border-dashed border-border rounded-lg">
          No company-specific KPIs defined yet.
        </p>
      )}

      {kpis.length > 0 && (
        <div className="space-y-4 mb-4">
          {sections.map((section) => {
            const sectionKpis = kpis.filter((k) => (k.section ?? "Other") === section);
            return (
              <div key={section}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{section}</p>
                <div className="rounded-lg border border-border overflow-hidden">
                  {sectionKpis.map((kpi, i) => {
                    const isEditing = editingFor === kpi.id;
                    const unitLabel = kpi.valueType === "currency" ? "$" : kpi.valueType === "percent" ? "%" : kpi.valueType === "integer" ? "#" : (kpi.unit ?? "");
                    const dir = (kpi as any).ragDirection ?? "higher_is_better";
                    const gPct = (kpi as any).ragGreenPct ?? 5;
                    const aPct = (kpi as any).ragAmberPct ?? 15;
                    const kpiCadence = ((kpi as any).collectionCadence ?? "monthly") as string;
                    const alertA = (kpi as any).ragAlertOnAmber ?? true;
                    const alertR = (kpi as any).ragAlertOnRed ?? true;
                    const alertLbl = alertA && alertR ? "A+R" : alertR ? "R only" : alertA ? "A only" : "off";

                    return (
                      <div key={kpi.id} className={i > 0 ? "border-t border-border/60" : ""}>
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-muted/20 transition-colors">
                          <div className="flex items-center gap-2 min-w-[180px]">
                            <span className="text-sm font-medium">{kpi.label}</span>
                            <span className="text-xs text-muted-foreground">{unitLabel || kpi.valueType}</span>
                          </div>
                          <div className="flex-1 flex items-center gap-1.5">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 font-medium">G ≤{gPct}%</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">A ≤{aPct}%</span>
                            <span className="text-xs text-muted-foreground">{dir === "higher_is_better" ? "Higher ↑" : dir === "lower_is_better" ? "Lower ↓" : "Either ↕"}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium ml-1">{CADENCE_LABELS[kpiCadence] ?? kpiCadence}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ml-0.5 ${(!alertA && !alertR) ? "bg-gray-50 text-gray-400 border-gray-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}>
                              🔔 {alertLbl}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => isEditing ? setEditingFor(null) : startEditing(kpi)} className="text-xs text-muted-foreground hover:text-foreground">Edit criteria</button>
                            <button onClick={() => handleDelete(kpi.id)} className="text-muted-foreground hover:text-red-500 transition-colors ml-1"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                        {isEditing && (
                          <div className="px-4 py-3 bg-muted/30 border-t border-border/60 space-y-2.5">
                            {/* RAG row */}
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">RAG</span>
                              <div className="flex items-center gap-1.5">
                                <label className="text-xs text-muted-foreground">Direction</label>
                                <select value={ragDirection} onChange={(e) => setRagDirection(e.target.value as any)} className="text-xs border border-border rounded px-1.5 py-0.5 bg-white">
                                  <option value="higher_is_better">Adverse variance: below plan ↓</option>
                                  <option value="lower_is_better">Adverse variance: above plan ↑</option>
                                  <option value="any_variance">Adverse variance: either direction ↕</option>
                                </select>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs px-1 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 text-[10px] font-bold">GREEN</span>
                                <span className="text-xs text-muted-foreground">within</span>
                                <input type="number" min="0.1" step="0.5" value={ragGreenPct} onChange={(e) => setRagGreenPct(e.target.value)} className="w-14 text-xs border border-border rounded px-1.5 py-0.5 bg-white" />
                                <span className="text-xs text-muted-foreground">% of plan</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">AMBER</span>
                                <span className="text-xs text-muted-foreground">within</span>
                                <input type="number" min="0.1" step="0.5" value={ragAmberPct} onChange={(e) => setRagAmberPct(e.target.value)} className="w-14 text-xs border border-border rounded px-1.5 py-0.5 bg-white" />
                                <span className="text-xs text-muted-foreground">% of plan</span>
                              </div>
                            </div>
                            {/* Alert row */}
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Alert</span>
                              <span className="text-xs text-muted-foreground">Send alert when status is</span>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={ragAlertOnAmber} onChange={(e) => setRagAlertOnAmber(e.target.checked)} className="h-3 w-3" />
                                <span className="text-xs px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">AMBER</span>
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={ragAlertOnRed} onChange={(e) => setRagAlertOnRed(e.target.checked)} className="h-3 w-3" />
                                <span className="text-xs px-1 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">RED</span>
                              </label>
                            </div>
                            {/* Cadence row */}
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Cadence</span>
                              <select value={cadenceValue} onChange={(e) => setCadenceValue(e.target.value as any)} className="text-xs border border-border rounded px-1.5 py-0.5 bg-white">
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                                <option value="quarterly">Quarterly</option>
                                <option value="bi-annual">Bi-Annual</option>
                              </select>
                            </div>
                            <div className="flex gap-1.5 pt-0.5">
                              <Button size="sm" onClick={() => handleSaveCriteria(kpi)} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingFor(null)}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add KPI panel */}
      {showAdd ? (
        <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/30 space-y-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setAddMode("library")}
              className={cn(
                "text-xs px-2.5 py-1 rounded-md border transition-colors",
                addMode === "library"
                  ? "bg-white border-border font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              From Library
            </button>
            <button
              onClick={() => setAddMode("custom")}
              className={cn(
                "text-xs px-2.5 py-1 rounded-md border transition-colors",
                addMode === "custom"
                  ? "bg-white border-border font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Create Custom
            </button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={closeAdd}>
              <X className="h-3 w-3" />
            </Button>
          </div>

          {addMode === "library" ? (
            <>
              <div className="flex items-center gap-2">
                <select
                  value={selectedKey}
                  onChange={(e) => { setSelectedKey(e.target.value); setPendingNote(""); }}
                  className="flex-1 text-sm border border-border rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="">Select a KPI from the library…</option>
                  <optgroup label="Finance">
                    {availableLibrary.filter((k) => k.section === "Finance").map((k) => (
                      <option key={k.key} value={k.key}>{k.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Operations">
                    {availableLibrary.filter((k) => k.section === "Operations").map((k) => (
                      <option key={k.key} value={k.key}>{k.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Sales">
                    {availableLibrary.filter((k) => k.section === "Sales").map((k) => (
                      <option key={k.key} value={k.key}>{k.label}{k.requiresNote ? " *" : ""}</option>
                    ))}
                  </optgroup>
                </select>
                <Button
                  size="sm"
                  onClick={handleAddFromLibrary}
                  disabled={saving || !selectedKey || (!!selectedLibraryItem?.requiresNote && !pendingNote.trim())}
                >
                  {saving ? "..." : "Add"}
                </Button>
              </div>
              {selectedLibraryItem?.requiresNote && (
                <div>
                  <p className="text-xs text-amber-700 font-medium mb-1">
                    * Pipeline definition required — how does your firm define &quot;pipeline&quot; for this metric?
                  </p>
                  <textarea
                    value={pendingNote}
                    onChange={(e) => setPendingNote(e.target.value)}
                    placeholder="e.g. All CRM opportunities at Stage 2 or above with an expected close date within the next 90 days"
                    className="w-full resize-none text-xs border border-border rounded px-2 py-1.5 bg-white"
                    rows={2}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Label *</label>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. Customer NPS"
                    className="h-7 text-xs mt-0.5"
                  />
                  {newLabel && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">key: {toKey(newLabel)}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Section</label>
                  <select
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                    className="w-full h-7 text-xs border border-border rounded px-1.5 mt-0.5 bg-white"
                  >
                    <option>Finance</option>
                    <option>Operations</option>
                    <option>Sales</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Unit</label>
                  <Input
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    placeholder="$, %, #, days…"
                    className="h-7 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Value Type</label>
                  <select
                    value={newValueType}
                    onChange={(e) => setNewValueType(e.target.value)}
                    className="w-full h-7 text-xs border border-border rounded px-1.5 mt-0.5 bg-white"
                  >
                    <option value="currency">Currency</option>
                    <option value="percent">Percent</option>
                    <option value="integer">Integer</option>
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`req-${companyId}`}
                  checked={newRequired}
                  onCheckedChange={(v) => setNewRequired(!!v)}
                />
                <label htmlFor={`req-${companyId}`} className="text-xs">Required field</label>
              </div>
              <Button size="sm" onClick={handleAddCustom} disabled={saving || !newLabel.trim()}>
                {saving ? "..." : "Add Metric"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => { setShowAdd(true); setAddMode("library"); }}>
          <Plus className="h-3 w-3 mr-1" /> Add KPI
        </Button>
      )}
    </div>
  );
}

// ─── Company Notifications Section ───────────────────────────────────────────

const COMPANY_EMAIL_EVENTS = [
  { key: "submissionNotification",   group: "submissions", label: "Submission Received",  firmRecipientsKey: "submissionNotificationRecipients",   firmEnabledKey: "submissionNotificationEnabled",        firmInAppEnabledKey: "submissionNotificationInAppEnabled" },
  { key: "submissionVoided",         group: "submissions", label: "Submission Voided",    firmRecipientsKey: "submissionVoidedRecipients",         firmEnabledKey: "submissionVoidedEnabled",              firmInAppEnabledKey: "submissionVoidedInAppEnabled" },
  { key: "submissionReminder",       group: "submissions", label: "Submission Reminder",  firmRecipientsKey: "submissionReminderRecipients",       firmEnabledKey: "submissionReminderEnabled",            firmInAppEnabledKey: "submissionReminderInAppEnabled" },
  { key: "ragAlert",                 group: "kpi",         label: "RAG Status Alert",     firmRecipientsKey: "ragAlertRecipients",                 firmEnabledKey: "ragAlertEnabled",                     firmInAppEnabledKey: "ragAlertInAppEnabled" },
  { key: "thresholdAlert",           group: "kpi",         label: "KPI Threshold Alert",  firmRecipientsKey: "thresholdAlertRecipients",           firmEnabledKey: "thresholdAlertEnabled",               firmInAppEnabledKey: "thresholdAlertInAppEnabled" },
  { key: "kpiOverride",              group: "kpi",         label: "KPI Override",         firmRecipientsKey: "kpiOverrideNotificationRecipients",  firmEnabledKey: "kpiOverrideNotificationEnabled",      firmInAppEnabledKey: "kpiOverrideNotificationInAppEnabled" },
  { key: "investorNoteNotification", group: "kpi",         label: "Investor Note Added",  firmRecipientsKey: null,                                 firmEnabledKey: "investorNoteNotificationEnabled",     firmInAppEnabledKey: "investorNoteInAppEnabled" },
  { key: "monthlyDigest",            group: "platform",    label: "Monthly Digest",       firmRecipientsKey: "monthlyDigestRecipients",            firmEnabledKey: "monthlyDigestEnabled",                firmInAppEnabledKey: "monthlyDigestInAppEnabled" },
];

const COMPANY_EMAIL_GROUPS = [
  { key: "submissions", label: "Submission" },
  { key: "kpi",         label: "KPI" },
  { key: "platform",    label: "Platform" },
];

function CompanyEmailRow({
  event,
  firmSettings,
  companySettings,
  onRecipientsChange,
  onEnabledChange,
  onInAppEnabledChange,
}: {
  event: (typeof COMPANY_EMAIL_EVENTS)[number];
  firmSettings: EmailSettings | null;
  companySettings: CompanyEmailEventSettings;
  onRecipientsChange: (val: string) => void;
  onEnabledChange: (val: boolean) => void;
  onInAppEnabledChange: (val: boolean) => void;
}) {
  const firmEnabled: boolean = event.firmEnabledKey ? ((firmSettings as any)?.[event.firmEnabledKey] ?? true) : true;
  const firmInAppEnabled: boolean = (firmSettings as any)?.[event.firmInAppEnabledKey] ?? true;
  const firmRecipients: string = event.firmRecipientsKey ? ((firmSettings as any)?.[event.firmRecipientsKey] ?? "") : "";
  const companyEnabled = companySettings.enabled ?? firmEnabled;
  const companyInAppEnabled = companySettings.inAppEnabled ?? firmInAppEnabled;

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-start gap-4 px-4 py-3 bg-white">
        <div className="w-[180px] shrink-0 pt-1">
          <p className="text-sm font-medium">{event.label}</p>
        </div>
        <div className="flex-1">
          {event.key === "investorNoteNotification" ? (
            <span className="text-xs text-muted-foreground">Sent to per-company users, which are managed in the Access tab</span>
          ) : (
            <div className="space-y-1.5">
              <input
                type="text"
                value={firmRecipients}
                readOnly
                placeholder="None configured at firm level"
                className="w-full text-xs border border-border rounded px-2.5 py-1.5 bg-muted/30 font-mono text-muted-foreground cursor-default"
              />
              <input
                type="text"
                value={companySettings.recipients}
                onChange={(e) => onRecipientsChange(e.target.value)}
                placeholder="+ Additional recipients for this company"
                className="w-full text-xs border border-border rounded px-2.5 py-1.5 bg-white font-mono"
              />
            </div>
          )}
        </div>
        {/* Email toggle */}
        <div className="shrink-0 w-[52px] flex justify-center pt-1">
          <Switch checked={companyEnabled} onCheckedChange={onEnabledChange} />
        </div>
        {/* In-app toggle */}
        <div className="shrink-0 w-[52px] flex justify-center pt-1">
          <Switch checked={companyInAppEnabled} onCheckedChange={onInAppEnabledChange} />
        </div>
      </div>
    </div>
  );
}

function initCompanyEmailSettings(company: any): Record<string, CompanyEmailEventSettings> {
  const saved: Record<string, CompanyEmailEventSettings> = (() => {
    try { return JSON.parse((company as any).companyEmailSettings ?? "{}") ?? {}; } catch { return {}; }
  })();
  // Back-fill from legacy columns if new JSON not yet saved
  if (!saved["submissionNotification"]?.recipients && (company as any).submissionCcEmails) {
    saved["submissionNotification"] = { ...saved["submissionNotification"], recipients: (company as any).submissionCcEmails };
  }
  if (!saved["thresholdAlert"]?.recipients && (company as any).alertCcEmails) {
    saved["thresholdAlert"] = { ...saved["thresholdAlert"], recipients: (company as any).alertCcEmails };
  }
  const defaults: Record<string, CompanyEmailEventSettings> = {};
  const base: CompanyEmailEventSettings = { recipients: "", enabled: true, inAppEnabled: true };
  for (const e of COMPANY_EMAIL_EVENTS) {
    defaults[e.key] = { ...base, ...(saved[e.key] ?? {}) };
  }
  return defaults;
}

function CompanyNotificationsSection({ company, firmEmailSettings }: { company: any; firmEmailSettings: EmailSettings | null }) {
  const [settings, setSettings] = useState<Record<string, CompanyEmailEventSettings>>(
    () => initCompanyEmailSettings(company)
  );
  const [saving, setSaving] = useState(false);

  function updateEvent(key: string, patch: Partial<CompanyEmailEventSettings>) {
    setSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveCompanyEmailSettingsAction(company.id, settings);
      toast.success("Notification settings saved.");
    } catch {
      toast.error("Failed to save notification settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-b border-border">
          <div className="w-[180px] shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Event</div>
          <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recipients</div>
          <div className="shrink-0 w-[52px] text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</div>
          <div className="shrink-0 w-[52px] text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">In-App</div>
        </div>
        {COMPANY_EMAIL_GROUPS.map((group) => {
          const events = COMPANY_EMAIL_EVENTS.filter((e) => e.group === group.key);
          return (
            <div key={group.key}>
              <div className="px-4 py-1.5 bg-muted/40 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              {events.map((event) => (
                <CompanyEmailRow
                  key={event.key}
                  event={event}
                  firmSettings={firmEmailSettings}
                  companySettings={settings[event.key] ?? { recipients: "", enabled: true, inAppEnabled: true }}
                  onRecipientsChange={(val) => updateEvent(event.key, { recipients: val })}
                  onEnabledChange={(val) => updateEvent(event.key, { enabled: val })}
                  onInAppEnabledChange={(val) => updateEvent(event.key, { inAppEnabled: val })}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Client ──────────────────────────────────────────────────────────────

export function CompaniesClient({
  companies,
  firmId,
  allUsers,
  customKpis,
  firmKpiDefs,
  firmDueDaysMonthly,
  firmDueDaysQuarterly,
  firmDueDaysBiAnnual,
  firmDueDaysAnnual,
  firmReminderDays,
  firmEmailSettings,
  firmRequiredDocs,
  firmRequiredDocCadences,
  firmLevelUsers,
  firmUserScopes,
  isOperator,
  isIndependent,
  firmType,
  cadenceOverrides,
  alertOverrides,
  ragOverrides,
}: Props) {
  const isPE = firmType === "pe_firm" || !firmType; // default to PE behavior
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filter state — client-side, not URL-based
  const [filterFund, setFilterFund] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterStatus, setFilterStatus] = useState("current");

  // Derive filter options from full company list
  const fundSet = new Set<string>();
  for (const c of companies) {
    fundSet.add((c as any).fund != null ? (c as any).fund : "independent");
  }
  const availableFunds = [...fundSet].sort((a, b) => {
    if (a === "independent") return 1;
    if (b === "independent") return -1;
    return a.localeCompare(b);
  });
  const industrySet = new Set<string>();
  for (const c of companies) {
    if (c.industry) industrySet.add(c.industry);
  }
  const availableIndustries = [...industrySet].sort();

  // Apply filters
  const filteredCompanies = companies.filter((c) => {
    if (filterFund) {
      if (filterFund === "independent") { if ((c as any).fund != null) return false; }
      else { if ((c as any).fund !== filterFund) return false; }
    }
    if (filterIndustry && c.industry !== filterIndustry) return false;
    if (filterStatus && (c as any).status !== filterStatus) return false;
    return true;
  });

  const firstCompanyId = [...filteredCompanies].sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null;
  const sortedCompanies = [...companies].sort((a, b) => a.name.localeCompare(b.name));
  const urlCompanyId = searchParams.get("company");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    (urlCompanyId && companies.find((c) => c.id === urlCompanyId))
      ? urlCompanyId
      : sortedCompanies[0]?.id ?? null
  );

  function selectCompany(id: string | null) {
    setSelectedCompanyId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set("company", id);
    } else {
      params.delete("company");
    }
    router.replace(`/admin/companies?${params.toString()}`, { scroll: false });
  }

  // Sync default company to URL on mount so the chat panel can read it
  useEffect(() => {
    if (selectedCompanyId && !searchParams.get("company")) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("company", selectedCompanyId);
      router.replace(`/admin/companies?${params.toString()}`, { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeTab, setActiveTab] = useState("info");

  // Add Company dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addIndustry, setAddIndustry] = useState("");
  const [addIndustryCustom, setAddIndustryCustom] = useState("");
  const [addFund, setAddFund] = useState("");
  const [addFundCustom, setAddFundCustom] = useState("");
  const [addTimezone, setAddTimezone] = useState("America/New_York");
  const [addSaving, setAddSaving] = useState(false);

  // Derived lists of existing industries + funds in this firm
  const existingIndustries = Array.from(
    new Set(companies.map((c) => (c as any).industry).filter(Boolean))
  ).sort() as string[];
  const existingFunds = Array.from(
    new Set(companies.map((c) => (c as any).fund).filter(Boolean))
  ).sort() as string[];

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Onboarding request
  const [sendingOnboarding, setSendingOnboarding] = useState(false);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;

  function openAdd() {
    setAddName("");
    setAddIndustry(""); setAddIndustryCustom("");
    setAddFund(""); setAddFundCustom("");
    setAddTimezone("America/New_York");
    setAddOpen(true);
  }

  async function handleAdd() {
    if (!addName.trim()) { toast.error("Company name is required."); return; }
    const industryValue = addIndustry === "__new__" ? addIndustryCustom.trim() : addIndustry;
    const fundValue = addFund === "__new__" ? addFundCustom.trim() : addFund;
    setAddSaving(true);
    try {
      const result = await saveCompanyAction({ name: addName, slug: "", industry: industryValue, fund: fundValue, firmId });
      toast.success("Company created.");
      setAddOpen(false);
      router.refresh();
      if (result?.id) selectCompany(result.id);
    } catch {
      toast.error("Failed to create company.");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedCompany) return;
    if (deleteConfirmName !== selectedCompany.name) {
      toast.error("Company name does not match.");
      return;
    }
    setDeleting(true);
    try {
      await deleteCompanyAction(selectedCompany.id);
      toast.success(`${selectedCompany.name} deleted.`);
      setDeleteOpen(false);
      selectCompany(null);
      router.refresh();
    } catch {
      toast.error("Failed to delete company.");
    } finally {
      setDeleting(false);
    }
  }

  function copyToken(c: Company) {
    const url = `${window.location.origin}/submit/${c.submissionToken}`;
    navigator.clipboard.writeText(url);
    toast.success(`Chat link copied for ${c.name}`);
  }

  function copyPlanLink(c: Company) {
    const url = `${window.location.origin}/plan/${c.submissionToken}`;
    navigator.clipboard.writeText(url);
    toast.success(`Chat link copied for ${c.name}`);
  }

  async function handleSendOnboardingRequest() {
    if (!selectedCompany) return;
    setSendingOnboarding(true);
    try {
      await sendOnboardingRequestAction(selectedCompany.id, firmId);
      toast.success("Onboarding request sent.");
      router.refresh();
    } catch {
      toast.error("Failed to send onboarding request.");
    } finally {
      setSendingOnboarding(false);
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      {/* Settings top nav */}
      <SettingsNav />

      {/* Company selector card — hidden for company-scoped users (single company, pre-selected) */}
      {!isOperator && !isIndependent && (
        <div className="bg-white rounded-xl border border-border p-5 mb-6">
          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground mr-1">Filter:</span>
            <select
              value={filterFund}
              onChange={(e) => {
                const value = e.target.value;
                setFilterFund(value);
                const newFiltered = companies.filter((c) => {
                  if (value) {
                    if (value === "independent") { if ((c as any).fund != null) return false; }
                    else { if ((c as any).fund !== value) return false; }
                  }
                  if (filterIndustry && c.industry !== filterIndustry) return false;
                  if (filterStatus && (c as any).status !== filterStatus) return false;
                  return true;
                });
                if (!newFiltered.some((c) => c.id === selectedCompanyId))
                  selectCompany(newFiltered[0]?.id ?? null);
              }}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-white min-w-[130px]"
            >
              <option value="">All Funds</option>
              {availableFunds.map((f) => (
                <option key={f} value={f}>{f === "independent" ? "Independent" : f}</option>
              ))}
            </select>
            <select
              value={filterIndustry}
              onChange={(e) => {
                const value = e.target.value;
                setFilterIndustry(value);
                const newFiltered = companies.filter((c) => {
                  if (filterFund) {
                    if (filterFund === "independent") { if ((c as any).fund != null) return false; }
                    else { if ((c as any).fund !== filterFund) return false; }
                  }
                  if (value && c.industry !== value) return false;
                  if (filterStatus && (c as any).status !== filterStatus) return false;
                  return true;
                });
                if (!newFiltered.some((c) => c.id === selectedCompanyId))
                  selectCompany(newFiltered[0]?.id ?? null);
              }}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-white min-w-[140px]"
            >
              <option value="">All Industries</option>
              {availableIndustries.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => {
                const value = e.target.value;
                setFilterStatus(value);
                const newFiltered = companies.filter((c) => {
                  if (filterFund) {
                    if (filterFund === "independent") { if ((c as any).fund != null) return false; }
                    else { if ((c as any).fund !== filterFund) return false; }
                  }
                  if (filterIndustry && c.industry !== filterIndustry) return false;
                  if (value && (c as any).status !== value) return false;
                  return true;
                });
                if (!newFiltered.some((c) => c.id === selectedCompanyId))
                  selectCompany(newFiltered[0]?.id ?? null);
              }}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-white min-w-[120px]"
            >
              <option value="">All Statuses</option>
              <option value="current">Currently Held</option>
              <option value="exited">Exited</option>
            </select>
            <div className="ml-auto">
              <Button onClick={openAdd}>
                <Plus className="h-4 w-4 mr-2" />
                Add Company
              </Button>
            </div>
          </div>

          {/* Company pills */}
          <div className="mt-4">
            <div className="mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Companies{filteredCompanies.length > 0 ? ` · ${filteredCompanies.length}` : ""}
              </span>
            </div>
            {filteredCompanies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No companies match your filters.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...filteredCompanies].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { selectCompany(c.id); setActiveTab("info"); }}
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
            {selectedCompany && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <button
                  onClick={() => copyToken(selectedCompany)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-white hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Company Chat
                </button>
                <span className="w-px h-4 bg-border mx-1 self-center" />
                <button
                  onClick={() => { setDeleteConfirmName(""); setDeleteOpen(true); }}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-red-200 bg-white hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedCompany.name}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      {selectedCompany && (
        <div key={selectedCompanyId}>
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="justify-start rounded-none bg-transparent border-b border-border px-6 h-auto gap-0 w-full">
                {(isOperator && !isIndependent
                  ? [
                      { value: "info", label: "Company Info" },
                      { value: "kpis", label: "KPIs" },
                    ]
                  : [
                      { value: "info", label: "Company Info" },
                      { value: "users", label: "Access" },
                      { value: "notifications", label: "Notifications" },
                      { value: "kpis", label: "KPIs" },
                      { value: "overrides", label: "Submission Overrides" },
                    ]
                ).map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="info" className="mt-0">
                {/* Onboarding banner — only shown while pending or in_progress; hidden once complete */}
                {!isOperator && (() => {
                  const obStatus = (selectedCompany as any).onboardingStatus as string | null;
                  if (obStatus !== "pending" && obStatus !== "in_progress") return null;
                  const operatorUsers = allUsers.filter((u) => u.companyId === selectedCompany.id);

                  const sentAt = (selectedCompany as any).onboardingRequestSentAt as string | null;
                  const sentDate = sentAt
                    ? new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : null;
                  const count = operatorUsers.length;
                  return (
                    <div className="flex items-start gap-3 mx-6 mt-6 p-4 rounded-lg border border-blue-200 bg-blue-50/60">
                      <Check className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-blue-800">
                          Onboarding request sent{sentDate ? ` ${sentDate}` : ""} to {count} operator{count !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={handleSendOnboardingRequest} disabled={sendingOnboarding}>
                          {sendingOnboarding ? "Sending..." : "Remind"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setActiveTab("users")}>
                          Add operators
                        </Button>
                      </div>
                    </div>
                  );
                })()}
                <CompanyInfoSection
                  company={selectedCompany}
                  onSaved={() => router.refresh()}
                  readOnly={isOperator && !isIndependent}
                />
              </TabsContent>

              {(!isOperator || isIndependent) && (
                <TabsContent value="users" className="mt-0">
                  <AuthorizedUsersSection
                    companyId={selectedCompany.id}
                    firmId={firmId}
                    initialUsers={allUsers.filter((u) => u.companyId === selectedCompany.id)}
                    company={selectedCompany}
                    firmLevelUsers={firmLevelUsers}
                    firmUserScopes={firmUserScopes}
                  />
                </TabsContent>
              )}

              {(!isOperator || isIndependent) && (
                <TabsContent value="notifications" className="mt-0">
                  <CompanyNotificationsSection company={selectedCompany} firmEmailSettings={firmEmailSettings} />
                </TabsContent>
              )}

              <TabsContent value="kpis" className="mt-0">
                {(isOperator || isIndependent) ? (
                  // ── Operator view: full KPI card list ──────────────────────
                  <>
                    <div className="px-6 pt-6 pb-3">
                      {isIndependent ? (
                        <p className="text-xs text-muted-foreground">
                          Manage the KPIs tracked for your business and configure collection cadence below.
                        </p>
                      ) : (
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1 whitespace-nowrap">
                            <Building2 className="h-3 w-3" />
                            Set by your investment firm
                          </span>
                          <span className="text-xs text-muted-foreground">
                            These KPIs are monitored by your investment firm. Collection cadence overrides can be set below.
                          </span>
                        </div>
                      )}
                    </div>
                    <FirmKpisSection
                      companyId={selectedCompany.id}
                      firmId={firmId}
                      firmKpiDefs={firmKpiDefs}
                      isIndependent={isIndependent}
                      cadenceOverrides={cadenceOverrides.filter((o) => o.companyId === selectedCompany.id)}
                      alertOverrides={alertOverrides.filter((o) => o.companyId === selectedCompany.id)}
                      ragOverrides={ragOverrides.filter((o) => o.companyId === selectedCompany.id)}
                    />
                    <div className="mx-6 flex items-center gap-3 py-1">
                      <div className="flex-1 border-t border-border" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Company-Only</span>
                      <div className="flex-1 border-t border-border" />
                    </div>
                    <div className="px-6 pb-2">
                      <p className="text-xs text-muted-foreground">KPIs tracked exclusively for this company — not visible to other portfolio companies.</p>
                    </div>
                    <CustomMetricsSection
                      companyId={selectedCompany.id}
                      firmId={firmId}
                      initialKpis={customKpis.filter((k) => k.companyId === selectedCompany.id)}
                    />
                  </>
                ) : (
                  // ── Investor/admin view: firm-wide KPIs + company-specific KPIs ──
                  <>
                    <div className="px-6 pt-6 pb-4">
                      <p className="text-xs font-medium bg-muted/50 border border-border rounded-md px-3 py-2">
                        Changes notify firm admin. <span className="text-muted-foreground font-normal">↻ indicates a value overridden from the firm default.</span>
                      </p>
                    </div>
                    <div className="px-6 pb-2">
                      <h3 className="text-sm font-semibold">Firm-Wide KPIs</h3>
                    </div>
                    <FirmKpisSection
                      companyId={selectedCompany.id}
                      firmId={firmId}
                      firmKpiDefs={firmKpiDefs}
                      isIndependent={false}
                      cadenceOverrides={cadenceOverrides.filter((o) => o.companyId === selectedCompany.id)}
                      alertOverrides={alertOverrides.filter((o) => o.companyId === selectedCompany.id)}
                      ragOverrides={ragOverrides.filter((o) => o.companyId === selectedCompany.id)}
                    />
                    <div className="px-6 pt-4 pb-2">
                      <h3 className="text-sm font-semibold">Company-Specific KPIs</h3>
                    </div>
                    <CustomMetricsSection
                      companyId={selectedCompany.id}
                      firmId={firmId}
                      initialKpis={customKpis.filter((k) => k.companyId === selectedCompany.id)}
                    />
                  </>
                )}
              </TabsContent>

              {(!isOperator || isIndependent) && (
                <TabsContent value="overrides" className="mt-0">
                  <SubmissionOverridesTab
                    company={selectedCompany}
                    firmDueDaysMonthly={firmDueDaysMonthly}
                    firmDueDaysQuarterly={firmDueDaysQuarterly}
                    firmDueDaysBiAnnual={firmDueDaysBiAnnual}
                    firmDueDaysAnnual={firmDueDaysAnnual}
                    firmReminderDays={firmReminderDays}
                    firmRequiredDocs={firmRequiredDocs}
                    firmRequiredDocCadences={firmRequiredDocCadences}
                  />
                </TabsContent>
              )}
            </Tabs>
          </div>

        </div>
      )}

      {/* Add Company dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Company</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Company Name *</Label>
              <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Apex Industrial Manufacturing" className="mt-1" />
            </div>
            <div>
              <Label>Fund</Label>
              <select
                value={addFund}
                onChange={(e) => setAddFund(e.target.value)}
                className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-white"
              >
                <option value="">— None —</option>
                {existingFunds.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value="__new__">+ Add new fund…</option>
              </select>
              {addFund === "__new__" && (
                <Input
                  value={addFundCustom}
                  onChange={(e) => setAddFundCustom(e.target.value)}
                  placeholder="e.g. Fund IV"
                  className="mt-2"
                  autoFocus
                />
              )}
            </div>
            <div>
              <Label>Industry</Label>
              <select
                value={addIndustry}
                onChange={(e) => setAddIndustry(e.target.value)}
                className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-white"
              >
                <option value="">— None —</option>
                {existingIndustries.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
                <option value="__new__">+ Add new industry…</option>
              </select>
              {addIndustry === "__new__" && (
                <Input
                  value={addIndustryCustom}
                  onChange={(e) => setAddIndustryCustom(e.target.value)}
                  placeholder="e.g. Industrials, SaaS"
                  className="mt-2"
                  autoFocus
                />
              )}
            </div>
            <div>
              <Label>Timezone</Label>
              <select
                value={addTimezone}
                onChange={(e) => setAddTimezone(e.target.value)}
                className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-white"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addSaving}>
              {addSaving ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Company confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedCompany?.name}?</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="font-medium text-foreground">{selectedCompany?.name}</span> and all of its submissions, KPI history, alerts, and authorized users. This action cannot be undone.
            </p>
            <div>
              <Label className="text-sm">
                Type <span className="font-mono font-semibold">{selectedCompany?.name}</span> to confirm
              </Label>
              <Input
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={selectedCompany?.name}
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmName !== selectedCompany?.name}
            >
              {deleting ? "Deleting..." : "Delete Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
