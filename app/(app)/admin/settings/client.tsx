"use client";

import { useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Plus, Trash2, X, Pencil, UserPlus } from "lucide-react";
import { SettingsNav } from "@/components/layout/settings-nav";
import type { EmailSettings, KpiDefinition, User, UserAccessScope } from "@/lib/db/schema";
import {
  saveEmailSettingsAction,
  saveDueDaysAction,
  saveFirmDocsAction,
  createFirmKpiAction,
  deleteFirmKpiAction,
  updateFirmKpiNoteAction,
  updateKpiRagCriteriaAction,
  updateKpiCadenceAction,
  inviteFirmUserAction,
  removeFirmUserAction,
  updateFirmUserRoleAction,
  addUserScopeAction,
  removeUserScopeAction,
} from "./actions";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { KPI_LIBRARY } from "@/lib/kpi-library";

type Props = {
  firmId: string;
  currentUserId: string;
  settings: EmailSettings | null;
  kpiDefs: KpiDefinition[];
  firmUsers: User[];
  allCompanies: { id: string; name: string }[];
  userScopes: UserAccessScope[];
  funds: string[];
  industries: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Unified Event Row (recipients + template inline) ─────────────────────────

function EventRow({
  event,
  vals,
  prefs,
  onChange,
  onPrefChange,
}: {
  event: (typeof EMAIL_EVENTS)[number];
  vals: Record<string, string>;
  prefs: Record<string, boolean>;
  onChange: (key: string, val: string) => void;
  onPrefChange: (key: string, val: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const enabled = event.enabledKey ? (prefs[event.enabledKey] ?? true) : true;

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-4 px-4 py-3 bg-white">
        {/* Event label */}
        <div className="w-[180px] shrink-0">
          <p className="text-sm font-medium">{event.label}</p>
        </div>
        {/* Recipients */}
        <div className="flex-1">
          {event.hasRecipients && event.recipientsKey ? (
            <div className="space-y-1">
              <input
                type="text"
                value={vals[event.recipientsKey] ?? ""}
                onChange={(e) => onChange(event.recipientsKey!, e.target.value)}
                placeholder="admin@firm.com, partner@firm.com"
                className={cn(
                  "w-full text-xs border border-border rounded px-2.5 py-1.5 bg-white font-mono",
                  !enabled && "opacity-40 pointer-events-none"
                )}
              />
              {(event.key === "submissionNotification" || event.key === "thresholdAlert") && (
                <p className="text-xs text-muted-foreground">Per-company recipients managed in Company Settings</p>
              )}
              {event.key === "submissionReminder" && (
                <p className="text-xs text-muted-foreground">Per-company recipients managed in Company Settings</p>
              )}
            </div>
          ) : event.key === "investorNoteNotification" ? (
            <span className="text-xs text-muted-foreground">Sent to per-company users, which are managed in Company Settings</span>
          ) : (
            <span className="text-xs text-muted-foreground">Auto-sent</span>
          )}
        </div>
        {/* Email toggle */}
        <div className="shrink-0 w-[52px] flex justify-center">
          {event.enabledKey ? (
            <Switch
              checked={prefs[event.enabledKey] ?? true}
              onCheckedChange={(v) => onPrefChange(event.enabledKey!, v)}
            />
          ) : (
            <span className="text-[10px] text-muted-foreground text-center">Always on</span>
          )}
        </div>
        {/* In-app toggle */}
        <div className="shrink-0 w-[52px] flex justify-center">
          {event.inAppEnabledKey ? (
            <Switch
              checked={prefs[event.inAppEnabledKey] ?? true}
              onCheckedChange={(v) => onPrefChange(event.inAppEnabledKey!, v)}
            />
          ) : (
            <span className="text-[10px] text-muted-foreground text-center">—</span>
          )}
        </div>
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 w-[72px] flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Edit
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <div className={cn("px-4 pb-4 pt-3 bg-muted/10 border-t border-border/60 space-y-3", !enabled && "opacity-40 pointer-events-none")}>
          <div>
            <label className="text-xs text-muted-foreground">Subject</label>
            <Input
              value={vals[event.subjectKey] ?? ""}
              onChange={(e) => onChange(event.subjectKey, e.target.value)}
              className="mt-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Body</label>
            <Textarea
              value={vals[event.bodyKey] ?? ""}
              onChange={(e) => onChange(event.bodyKey, e.target.value)}
              className="mt-1 resize-none font-mono text-xs"
              rows={8}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Variables:{" "}
            {event.variables.map((v) => (
              <code key={v} className="bg-muted px-1 py-0.5 rounded text-[10px] mr-1">{`{{${v}}}`}</code>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Firm KPIs Section ────────────────────────────────────────────────────────

function FirmKpisSection({
  firmId,
  initialKpis,
}: {
  firmId: string;
  initialKpis: KpiDefinition[];
}) {
  const router = useRouter();
  const [kpis, setKpis] = useState<KpiDefinition[]>(initialKpis);

  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"library" | "custom">("library");
  const [selectedKey, setSelectedKey] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customSection, setCustomSection] = useState("Finance");
  const [customUnit, setCustomUnit] = useState("");
  const [customValueType, setCustomValueType] = useState("currency");
  const [addSaving, setAddSaving] = useState(false);

  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Unified KPI criteria editing
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [ragDirection, setRagDirection] = useState<"higher_is_better" | "lower_is_better">("higher_is_better");
  const [ragGreenPct, setRagGreenPct] = useState("5");
  const [ragAmberPct, setRagAmberPct] = useState("15");
  const [ragAlertOnAmber, setRagAlertOnAmber] = useState(true);
  const [ragAlertOnRed, setRagAlertOnRed] = useState(true);
  const [cadenceValue, setCadenceValue] = useState<"weekly" | "monthly" | "quarterly" | "bi-annual">("monthly");
  const [criteriaSaving, setCriteriaSaving] = useState(false);

  function startEditing(kpi: KpiDefinition) {
    setRagDirection(((kpi as any).ragDirection ?? "higher_is_better") as "higher_is_better" | "lower_is_better");
    setRagGreenPct(String((kpi as any).ragGreenPct ?? 5));
    setRagAmberPct(String((kpi as any).ragAmberPct ?? 15));
    setRagAlertOnAmber((kpi as any).ragAlertOnAmber ?? true);
    setRagAlertOnRed((kpi as any).ragAlertOnRed ?? true);
    setCadenceValue(((kpi as any).collectionCadence ?? "monthly") as any);
    setEditingFor(kpi.id);
  }

  async function handleSaveCriteria(kpi: KpiDefinition) {
    const green = parseFloat(ragGreenPct);
    const amber = parseFloat(ragAmberPct);
    if (isNaN(green) || isNaN(amber) || green <= 0 || amber <= 0 || green >= amber) {
      toast.error("Green % must be less than Amber %, and both must be positive.");
      return;
    }
    setCriteriaSaving(true);
    try {
      await updateKpiRagCriteriaAction(kpi.id, ragDirection, green, amber, ragAlertOnAmber, ragAlertOnRed);
      await updateKpiCadenceAction(kpi.id, cadenceValue);
      setKpis((prev) => prev.map((k) => k.id === kpi.id
        ? { ...k, ragDirection, ragGreenPct: green, ragAmberPct: amber, ragAlertOnAmber, ragAlertOnRed, collectionCadence: cadenceValue } as any
        : k
      ));
      setEditingFor(null);
      toast.success("KPI criteria saved.");
    } catch {
      toast.error("Failed to save criteria.");
    } finally {
      setCriteriaSaving(false);
    }
  }

  const existingKeys = new Set(kpis.map((k) => k.key));
  const availableLibrary = KPI_LIBRARY.filter((item) => !existingKeys.has(item.key));
  const selectedLibraryItem = KPI_LIBRARY.find((k) => k.key === selectedKey);
  const sections = Array.from(new Set(kpis.map((k) => k.section ?? "Other")));

  function toKey(label: string) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  async function handleAddFromLibrary() {
    if (!selectedKey) return;
    const item = KPI_LIBRARY.find((k) => k.key === selectedKey);
    if (!item) return;
    if (item.requiresNote && !pendingNote.trim()) return;
    setAddSaving(true);
    try {
      const kpi = await createFirmKpiAction({
        firmId, key: item.key, label: item.label, section: item.section,
        unit: item.unit, valueType: item.valueType,
        description: item.requiresNote ? pendingNote.trim() : undefined,
        displayOrder: kpis.length + 1,
      });
      setKpis((prev) => [...prev, kpi as KpiDefinition]);
      setSelectedKey(""); setPendingNote(""); setShowAdd(false);
      toast.success(`${item.label} added.`);
    } catch { toast.error("Failed to add KPI."); }
    finally { setAddSaving(false); }
  }

  async function handleAddCustom() {
    if (!customLabel.trim()) return;
    setAddSaving(true);
    try {
      const kpi = await createFirmKpiAction({
        firmId, key: toKey(customLabel), label: customLabel.trim(),
        section: customSection, unit: customUnit, valueType: customValueType,
        displayOrder: kpis.length + 1,
      });
      setKpis((prev) => [...prev, kpi as KpiDefinition]);
      setCustomLabel(""); setCustomUnit(""); setCustomSection("Finance"); setCustomValueType("currency"); setShowAdd(false);
      toast.success(`${customLabel.trim()} added.`);
    } catch { toast.error("Failed to add KPI."); }
    finally { setAddSaving(false); }
  }

  async function handleSaveNote(kpiId: string) {
    setNoteSaving(true);
    try {
      await updateFirmKpiNoteAction(kpiId, noteText);
      setKpis((prev) => prev.map((k) => k.id === kpiId ? { ...k, description: noteText || null } : k));
      setEditingNoteFor(null);
      toast.success("Note saved.");
    } catch { toast.error("Failed to save note."); }
    finally { setNoteSaving(false); }
  }

  async function handleDeleteKpi(kpiId: string, label: string) {
    try {
      await deleteFirmKpiAction(kpiId);
      setKpis((prev) => prev.filter((k) => k.id !== kpiId));
      toast.success(`${label} removed.`);
    } catch { toast.error("Failed to remove KPI."); }
  }

  return (
    <div className="space-y-4">
      {kpis.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">No firm-wide KPIs configured yet.</p>
      )}
      {sections.map((section) => {
        const sectionKpis = kpis.filter((k) => (k.section ?? "Other") === section);
        return (
          <div key={section}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{section}</p>
            <div className="rounded-lg border border-border overflow-hidden">
              {sectionKpis.map((kpi, i) => {
                const isEditing = editingFor === kpi.id;
                const isEditingNote = editingNoteFor === kpi.id;
                const kpiCadence = ((kpi as any).collectionCadence ?? "monthly") as string;
                const CADENCE_LABELS: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", "bi-annual": "Bi-Annual" };
                const unitLabel = kpi.valueType === "currency" ? "$" : kpi.valueType === "percent" ? "%" : kpi.valueType === "integer" ? "#" : (kpi.unit ?? "");
                const dir = (kpi as any).ragDirection ?? "higher_is_better";
                const gPct = (kpi as any).ragGreenPct ?? 5;
                const aPct = (kpi as any).ragAmberPct ?? 15;
                const alertAmber = (kpi as any).ragAlertOnAmber ?? true;
                const alertRed = (kpi as any).ragAlertOnRed ?? true;
                const alertLabel = alertAmber && alertRed ? "A+R" : alertRed ? "R only" : alertAmber ? "A only" : "off";
                return (
                  <div key={kpi.id} className={i > 0 ? "border-t border-border/60" : ""}>
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-2 min-w-[180px]">
                        <span className="text-sm font-medium">{kpi.label}</span>
                        <span className="text-xs text-muted-foreground">{unitLabel || kpi.valueType}</span>
                      </div>
                      {/* Summary badges */}
                      <div className="flex-1 flex items-center gap-1.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 font-medium">G ≤{gPct}%</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">A ≤{aPct}%</span>
                        <span className="text-xs text-muted-foreground">{dir === "higher_is_better" ? "↑" : dir === "lower_is_better" ? "↓" : "↕"}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium ml-1">{CADENCE_LABELS[kpiCadence] ?? kpiCadence}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ml-0.5 ${(!alertAmber && !alertRed) ? "bg-gray-50 text-gray-400 border-gray-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}>
                          🔔 {alertLabel}
                        </span>
                        {!isEditingNote && kpi.description && (
                          <span className="text-xs text-muted-foreground italic ml-1 truncate max-w-[160px]">· {kpi.description}</span>
                        )}
                        {!isEditingNote && !kpi.description && KPI_LIBRARY.find((l) => l.key === kpi.key)?.requiresNote && (
                          <button onClick={() => { setEditingNoteFor(kpi.id); setNoteText(""); }} className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 ml-1">
                            <Pencil className="h-2.5 w-2.5" /> Add pipeline definition
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => isEditing ? setEditingFor(null) : startEditing(kpi)} className="text-xs text-muted-foreground hover:text-foreground">Edit criteria</button>
                        <button onClick={() => handleDeleteKpi(kpi.id, kpi.label)} className="text-muted-foreground hover:text-red-500 transition-colors ml-1"><Trash2 className="h-3.5 w-3.5" /></button>
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
                        {/* Actions */}
                        <div className="flex gap-1.5 pt-0.5">
                          <Button size="sm" onClick={() => handleSaveCriteria(kpi)} disabled={criteriaSaving}>{criteriaSaving ? "Saving..." : "Save"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingFor(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                    {isEditingNote && (
                      <div className="px-4 py-2.5 bg-muted/30 border-t border-border/60 space-y-1.5">
                        <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Define what 'pipeline' means for your firm…" className="resize-none text-xs" rows={2} />
                        <div className="flex gap-1.5">
                          <Button size="sm" onClick={() => handleSaveNote(kpi.id)} disabled={noteSaving}>{noteSaving ? "..." : "Save note"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingNoteFor(null)}>Cancel</Button>
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

      {showAdd ? (
        <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/30 space-y-3">
          <div className="flex items-center gap-1">
            {(["library", "custom"] as const).map((mode) => (
              <button key={mode} onClick={() => setAddMode(mode)} className={cn("text-xs px-2.5 py-1 rounded-md border transition-colors", addMode === mode ? "bg-white border-border font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {mode === "library" ? "From Library" : "Create Custom"}
              </button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setShowAdd(false); setSelectedKey(""); setPendingNote(""); setCustomLabel(""); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          {addMode === "library" ? (
            <>
              <div className="flex items-center gap-2">
                <select value={selectedKey} onChange={(e) => { setSelectedKey(e.target.value); setPendingNote(""); }} className="flex-1 text-sm border border-border rounded-md px-2 py-1.5 bg-white">
                  <option value="">Select a KPI from the library…</option>
                  {["Finance", "Operations", "Sales"].map((sec) => (
                    <optgroup key={sec} label={sec}>
                      {availableLibrary.filter((k) => k.section === sec).map((k) => (
                        <option key={k.key} value={k.key}>{k.label}{k.requiresNote ? " *" : ""}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button size="sm" onClick={handleAddFromLibrary} disabled={addSaving || !selectedKey || (!!selectedLibraryItem?.requiresNote && !pendingNote.trim())}>
                  {addSaving ? "..." : "Add"}
                </Button>
              </div>
              {selectedLibraryItem?.requiresNote && (
                <div>
                  <p className="text-xs text-amber-700 font-medium mb-1">* Pipeline definition required</p>
                  <Textarea value={pendingNote} onChange={(e) => setPendingNote(e.target.value)} placeholder="e.g. All CRM opportunities at Stage 2+ with a close date within 90 days" className="resize-none text-xs bg-white" rows={2} />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Label *</label>
                  <input type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="e.g. Return on Equity" className="mt-0.5 w-full text-xs border border-border rounded px-2 py-1.5 bg-white" />
                  {customLabel && <p className="text-[10px] text-muted-foreground mt-0.5">key: {toKey(customLabel)}</p>}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Function</label>
                  {(() => {
                    const PREDEFINED = ["Finance", "Operations", "Sales", "Marketing", "HR", "Technology", "Legal", "Other"];
                    const isCustom = !PREDEFINED.includes(customSection);
                    return (
                      <>
                        <select
                          value={isCustom ? "__custom__" : customSection}
                          onChange={(e) => setCustomSection(e.target.value === "__custom__" ? "" : e.target.value)}
                          className="mt-0.5 w-full text-xs border border-border rounded px-2 py-1.5 bg-white"
                        >
                          {PREDEFINED.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          <option value="__custom__">Custom…</option>
                        </select>
                        {isCustom && (
                          <input
                            type="text"
                            value={customSection}
                            onChange={(e) => setCustomSection(e.target.value)}
                            placeholder="Enter function name"
                            autoFocus
                            className="mt-1 w-full text-xs border border-border rounded px-2 py-1.5 bg-white"
                          />
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Unit</label>
                  <input type="text" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} placeholder="$, %, #, days…" className="mt-0.5 w-full text-xs border border-border rounded px-2 py-1.5 bg-white" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Value Type</label>
                  <select value={customValueType} onChange={(e) => setCustomValueType(e.target.value)} className="mt-0.5 w-full text-xs border border-border rounded px-2 py-1.5 bg-white">
                    <option value="currency">Currency</option><option value="percent">Percent</option><option value="integer">Integer</option><option value="number">Number</option><option value="text">Text</option>
                  </select>
                </div>
              </div>
              <Button size="sm" onClick={handleAddCustom} disabled={addSaving || !customLabel.trim()}>{addSaving ? "..." : "Add Metric"}</Button>
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

// ─── Team Tab ─────────────────────────────────────────────────────────────────

function AccessScopeRow({
  user,
  firmId,
  scopes,
  setScopes,
  allCompanies,
  funds,
  industries,
}: {
  user: User;
  firmId: string;
  scopes: UserAccessScope[];
  setScopes: (fn: (prev: UserAccessScope[]) => UserAccessScope[]) => void;
  allCompanies: { id: string; name: string }[];
  funds: string[];
  industries: string[];
}) {
  const [addType, setAddType] = useState<"company" | "fund" | "industry">("company");
  const [addValue, setAddValue] = useState("");
  const [adding, setAdding] = useState(false);

  const valueOptions = addType === "company"
    ? allCompanies.map((c) => ({ label: c.name, value: c.id }))
    : addType === "fund"
    ? funds.map((f) => ({ label: f === "independent" ? "Independent" : f, value: f }))
    : industries.map((i) => ({ label: i, value: i }));

  async function handleAdd() {
    if (!addValue) return;
    setAdding(true);
    try {
      const scope = await addUserScopeAction({ userId: user.id, firmId, scopeType: addType, scopeValue: addValue });
      setScopes((prev) => [...prev, scope as UserAccessScope]);
      setAddValue("");
      toast.success("Access scope added.");
    } catch { toast.error("Failed to add scope."); }
    finally { setAdding(false); }
  }

  async function handleRemove(scopeId: string) {
    try {
      await removeUserScopeAction(scopeId);
      setScopes((prev) => prev.filter((s) => s.id !== scopeId));
      toast.success("Scope removed.");
    } catch { toast.error("Failed to remove scope."); }
  }

  function scopeLabel(scope: UserAccessScope) {
    if (scope.scopeType === "company") {
      return allCompanies.find((c) => c.id === scope.scopeValue)?.name ?? scope.scopeValue;
    }
    if (scope.scopeType === "fund") return scope.scopeValue === "independent" ? "Independent" : scope.scopeValue;
    return scope.scopeValue;
  }

  function scopeTypeLabel(type: string) {
    return type === "company" ? "Company" : type === "fund" ? "Fund" : "Industry";
  }

  return (
    <div className="px-4 py-3 bg-muted/10 border-t border-border/60 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Access</p>
      {scopes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">All companies visible. Add grants below to limit access to specific companies, funds, or industries.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((scope) => (
            <span key={scope.id} className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded-full px-2.5 py-0.5">
              <span className="text-muted-foreground">{scopeTypeLabel(scope.scopeType)}:</span>
              <span className="font-medium">{scopeLabel(scope)}</span>
              <button onClick={() => handleRemove(scope.id)} className="text-muted-foreground hover:text-red-500 ml-0.5">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <select
          value={addType}
          onChange={(e) => { setAddType(e.target.value as any); setAddValue(""); }}
          className="text-xs border border-border rounded px-2 py-1 bg-white"
        >
          <option value="company">Company</option>
          <option value="fund">Fund</option>
          <option value="industry">Industry</option>
        </select>
        <select
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1 bg-white flex-1"
        >
          <option value="">Select…</option>
          {valueOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button size="sm" onClick={handleAdd} disabled={adding || !addValue}>
          {adding ? "…" : "Add"}
        </Button>
      </div>
    </div>
  );
}

function TeamSection({
  firmId,
  currentUserId,
  initialUsers,
  allCompanies,
  userScopes,
  funds,
  industries,
}: {
  firmId: string;
  currentUserId: string;
  initialUsers: User[];
  allCompanies: { id: string; name: string }[];
  userScopes: UserAccessScope[];
  funds: string[];
  industries: string[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [scopesMap, setScopesMap] = useState<Record<string, UserAccessScope[]>>(() =>
    Object.fromEntries(initialUsers.map((u) => [u.id, userScopes.filter((s) => s.userId === u.id)]))
  );
  const [expandedAccess, setExpandedAccess] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"firm_admin" | "firm_member">("firm_member");
  const [inviting, setInviting] = useState(false);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const user = await inviteFirmUserAction({ firmId, email: inviteEmail.trim(), name: inviteName.trim(), role: inviteRole });
      setUsers((prev) => {
        const exists = prev.find((u) => u.id === user.id);
        return exists ? prev.map((u) => u.id === user.id ? user as User : u) : [...prev, user as User];
      });
      setInviteEmail(""); setInviteName(""); setInviteRole("firm_member"); setShowInvite(false);
      toast.success("Team member added.");
    } catch { toast.error("Failed to add team member."); }
    finally { setInviting(false); }
  }

  async function handleRemove(userId: string, name: string) {
    if (!confirm(`Remove ${name || "this user"} from the team?`)) return;
    try {
      await removeFirmUserAction(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      router.refresh();
      toast.success("Team member removed.");
    } catch { toast.error("Failed to remove team member."); }
  }

  const roleLabel = (role: string) => role === "firm_admin" ? "Admin" : "Member";

  return (
    <div className="space-y-6">
      <div>
        <div className="flex justify-between items-start mb-3">
          <div />
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setShowInvite((v) => !v)}>
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add Member
            </Button>
            <p className="text-[11px] text-muted-foreground">New users receive an email invitation to set their password. Operator users are managed per-company in Company Settings.</p>
          </div>
        </div>

        {showInvite && (
          <div className="mt-4 p-4 rounded-lg border border-border bg-muted/20 space-y-3">
            <h3 className="text-sm font-medium">Add Team Member</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Jane Smith" className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Email *</Label>
                <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="jane@firm.com" className="mt-1 h-8 text-sm" />
              </div>
            </div>
            <div className="max-w-[200px]">
              <Label className="text-xs">Role</Label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)} className="mt-1 w-full text-sm border border-border rounded-md px-2.5 py-1.5 bg-white">
                <option value="firm_admin">Admin — full access</option>
                <option value="firm_member">Member — view access</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>{inviting ? "Adding..." : "Add"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowInvite(false); setInviteEmail(""); setInviteName(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No team members yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Access</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => {
                const isMember = u.role === "firm_member";
                const isExpanded = expandedAccess === u.id;
                const scopeCount = (scopesMap[u.id] ?? []).length;
                return (
                  <Fragment key={u.id}>
                    <tr className={cn("bg-white hover:bg-muted/20", i > 0 && "border-t border-border/60")}>
                      <td className="px-4 py-3 font-medium">{u.name ?? <span className="text-muted-foreground italic">—</span>}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.id === currentUserId ? (
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", u.role === "firm_admin" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-muted text-muted-foreground border-border")}>
                            {roleLabel(u.role)}
                          </span>
                        ) : (
                          <select
                            defaultValue={u.role}
                            onChange={async (e) => {
                              const role = e.target.value as "firm_admin" | "firm_member";
                              try {
                                await updateFirmUserRoleAction(u.id, role);
                                setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, role } : x));
                                toast.success("Role updated.");
                              } catch { toast.error("Failed to update role."); }
                            }}
                            className="text-xs border border-border rounded px-2 py-0.5 bg-white"
                          >
                            <option value="firm_admin">Admin</option>
                            <option value="firm_member">Member</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isMember ? (
                          <button
                            onClick={() => setExpandedAccess(isExpanded ? null : u.id)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {scopeCount > 0 ? `${scopeCount} grant${scopeCount > 1 ? "s" : ""}` : "All companies"}
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">All companies</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.id !== currentUserId && (
                          <button onClick={() => handleRemove(u.id, u.name ?? u.email)} className="text-muted-foreground hover:text-red-500 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && isMember && (
                      <tr className="border-t border-border/60">
                        <td colSpan={5} className="p-0">
                          <AccessScopeRow
                            user={u}
                            firmId={firmId}
                            scopes={scopesMap[u.id] ?? []}
                            setScopes={(fn) => setScopesMap((prev) => ({ ...prev, [u.id]: fn(prev[u.id] ?? []) }))}
                            allCompanies={allCompanies}
                            funds={funds}
                            industries={industries}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Firm Required Docs Section ───────────────────────────────────────────────

const FIRM_DOCS = [
  { key: "balance_sheet",       label: "Balance Sheet" },
  { key: "income_statement",    label: "Income Statement" },
  { key: "cash_flow_statement", label: "Cash Flow Statement" },
  { key: "investor_update",     label: "Investor Update" },
];

const DOC_CADENCE_OPTIONS = [
  { value: "monthly",   label: "Every month" },
  { value: "quarterly", label: "Quarterly" },
  { value: "bi-annual", label: "Bi-annual" },
  { value: "annual",    label: "Annual" },
];

function FirmDocsSection({ checked, cadences, onCheckedChange, onCadenceChange, disabled }: {
  checked: Set<string>;
  cadences: Record<string, string>;
  onCheckedChange: (next: Set<string>) => void;
  onCadenceChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {FIRM_DOCS.map((doc) => {
        const isChecked = checked.has(doc.key);
        const cadence = cadences[doc.key] ?? "monthly";
        return (
          <div key={doc.key} className="flex items-center gap-3">
            <Checkbox
              id={`firm-doc-${doc.key}`}
              checked={isChecked}
              onCheckedChange={(v) => {
                const next = new Set(checked);
                if (v) next.add(doc.key); else next.delete(doc.key);
                onCheckedChange(next);
              }}
              disabled={disabled}
            />
            <label htmlFor={`firm-doc-${doc.key}`} className="text-sm cursor-pointer w-48">
              {doc.label}
            </label>
            <select
              value={cadence}
              onChange={(e) => onCadenceChange({ ...cadences, [doc.key]: e.target.value })}
              disabled={!isChecked || disabled}
              className="text-xs border border-border rounded px-2 py-1 bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {DOC_CADENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ─── Notifications Tab ────────────────────────────────────────────────────────

const EMAIL_EVENTS = [
  // ── Submissions ──
  {
    key: "submissionNotification",
    group: "submissions",
    label: "Submission Received",
    description: "Company submits KPI data or an annual plan",
    recipientsKey: "submissionNotificationRecipients",
    enabledKey: "submissionNotificationEnabled",
    inAppEnabledKey: "submissionNotificationInAppEnabled",
    subjectKey: "submissionNotificationSubject",
    bodyKey: "submissionNotificationBody",
    variables: ["company_name", "period", "submitted_by", "submission_time", "revenue", "ebitda", "ocf", "gross_margin", "cash", "dashboard_link"],
    hasRecipients: true,
  },
  {
    key: "submissionVoided",
    group: "submissions",
    label: "Submission Voided",
    description: "An operator voids a previously submitted KPI submission via the company chat",
    recipientsKey: "submissionVoidedRecipients",
    enabledKey: "submissionVoidedEnabled",
    inAppEnabledKey: "submissionVoidedInAppEnabled",
    subjectKey: "submissionVoidedSubject",
    bodyKey: "submissionVoidedBody",
    variables: ["company_name", "submission_type", "voided_date", "void_reason", "company_page_link"],
    hasRecipients: true,
  },
  {
    key: "submissionReminder",
    group: "submissions",
    label: "Submission Reminder",
    description: "Reminder sent before a KPI or plan submission deadline",
    recipientsKey: "submissionReminderRecipients",
    enabledKey: "submissionReminderEnabled",
    inAppEnabledKey: "submissionReminderInAppEnabled",
    subjectKey: "reminderSubject",
    bodyKey: "reminderBody",
    variables: ["company_name", "period", "due_date", "submission_link", "missing_docs"],
    hasRecipients: true,
  },
  // ── KPI Alerts ──
  {
    key: "ragAlert",
    group: "kpi",
    label: "RAG Status Alert",
    description: "Submission includes At Risk or Off Track KPIs vs plan",
    recipientsKey: "ragAlertRecipients",
    enabledKey: "ragAlertEnabled",
    inAppEnabledKey: "ragAlertInAppEnabled",
    subjectKey: "ragAlertSubject",
    bodyKey: "ragAlertBody",
    variables: ["company_name", "period", "issues_summary", "issues_list", "dashboard_link"],
    hasRecipients: true,
  },
  {
    key: "thresholdAlert",
    group: "kpi",
    label: "KPI Threshold Alert",
    description: "KPI crosses an alert threshold",
    recipientsKey: "thresholdAlertRecipients",
    enabledKey: "thresholdAlertEnabled",
    inAppEnabledKey: "thresholdAlertInAppEnabled",
    subjectKey: "thresholdAlertSubject",
    bodyKey: "thresholdAlertBody",
    variables: ["company_name", "metric_name", "value", "period", "submission_date", "threshold_value", "severity", "dashboard_link"],
    hasRecipients: true,
  },
  {
    key: "kpiOverride",
    group: "kpi",
    label: "KPI Override",
    description: "Company-level KPI alert settings customized",
    recipientsKey: "kpiOverrideNotificationRecipients",
    enabledKey: "kpiOverrideNotificationEnabled",
    inAppEnabledKey: "kpiOverrideNotificationInAppEnabled",
    subjectKey: "kpiOverrideNotificationSubject",
    bodyKey: "kpiOverrideNotificationBody",
    variables: ["company_name", "kpi_label", "override_summary", "dashboard_link"],
    hasRecipients: true,
  },
  {
    key: "investorNoteNotification",
    group: "kpi",
    label: "Investor Note Added",
    description: "Investor adds a note on a KPI",
    recipientsKey: null,
    enabledKey: "investorNoteNotificationEnabled",
    inAppEnabledKey: "investorNoteInAppEnabled",
    subjectKey: "investorNoteNotificationSubject",
    bodyKey: "investorNoteNotificationBody",
    variables: ["company_name", "kpi_name", "note_text", "period", "analytics_link"],
    hasRecipients: false,
  },
  // ── Platform ──
  {
    key: "monthlyDigest",
    group: "platform",
    label: "Monthly Digest",
    description: "Monthly portfolio summary",
    recipientsKey: "monthlyDigestRecipients",
    enabledKey: "monthlyDigestEnabled",
    inAppEnabledKey: "monthlyDigestInAppEnabled",
    subjectKey: "monthlyDigestSubject",
    bodyKey: "monthlyDigestBody",
    variables: ["month_year", "total_companies", "submitted_count", "active_alerts", "dashboard_link"],
    hasRecipients: true,
  },
  {
    key: "platformInvitation",
    group: "platform",
    label: "Platform Invitation",
    description: "New user is invited to the platform",
    recipientsKey: null,
    enabledKey: null,
    inAppEnabledKey: null,
    subjectKey: "invitationSubject",
    bodyKey: "invitationBody",
    variables: ["invitation_link"],
    hasRecipients: false,
  },
] as const;

const EMAIL_EVENT_GROUPS: { key: string; label: string }[] = [
  { key: "submissions", label: "Submission" },
  { key: "kpi",         label: "KPI" },
  { key: "platform",    label: "Platform" },
];

function NotificationsSection({
  vals,
  prefs,
  onChange,
  onPrefChange,
  onSave,
  saving,
}: {
  vals: Record<string, string>;
  prefs: Record<string, boolean>;
  onChange: (key: string, val: string) => void;
  onPrefChange: (key: string, val: boolean) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <Label>From Name</Label>
            <Input value={vals.fromName} onChange={(e) => onChange("fromName", e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>From Email</Label>
            <Input value={vals.fromEmail} onChange={(e) => onChange("fromEmail", e.target.value)} className="mt-1.5" type="email" />
            <p className="text-xs text-muted-foreground mt-1.5">Must be a verified sender domain in your email provider.</p>
          </div>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-b border-border">
            <div className="w-[180px] shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Event</div>
            <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Firm-Level Recipients</div>
            <div className="shrink-0 w-[52px] text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</div>
            <div className="shrink-0 w-[52px] text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">In-App</div>
            <div className="shrink-0 w-[72px] text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template</div>
          </div>
          {EMAIL_EVENT_GROUPS.map((group) => {
            const events = EMAIL_EVENTS.filter((e) => e.group === group.key);
            return (
              <div key={group.key}>
                <div className="px-4 py-1.5 bg-muted/40 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {events.map((event) => (
                  <EventRow
                    key={event.key}
                    event={event}
                    vals={vals}
                    prefs={prefs}
                    onChange={onChange}
                    onPrefChange={onPrefChange}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Button onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
      </div>
    </div>
  );
}

// ─── Main Settings Client ─────────────────────────────────────────────────────

export function SettingsClient({ firmId, currentUserId, settings, kpiDefs, firmUsers, allCompanies, userScopes, funds, industries }: Props) {
  const initial = {
    fromName: settings?.fromName ?? "PortCo Pulse",
    fromEmail: settings?.fromEmail ?? "noreply@portcopulse.com",
    reminderSubject: settings?.reminderSubject || "Action Required: Submission Due — {{company_name}}",
    reminderBody: settings?.reminderBody || "Dear {{company_name}},\n\nThis is a reminder that your submission is due by {{due_date}}.\n\nSubmit here: {{submission_link}}\n\nThank you.",
    monthlyDigestRecipients: settings?.monthlyDigestRecipients ?? "",
    monthlyDigestSubject: settings?.monthlyDigestSubject || "PortCo Pulse - Monthly Portfolio Digest for {{month_year}}",
    monthlyDigestBody: settings?.monthlyDigestBody || "Portfolio Submission Summary - {{month_year}}\n\nHere's your monthly summary of portfolio company performance:\n\nPortfolio Overview:\n• Total Companies: {{total_companies}}\n• Companies Submitted This Period: {{submitted_count}}\n• Active Alerts: {{active_alerts}}\n\nView full dashboard: {{dashboard_link}}",
    thresholdAlertRecipients: settings?.thresholdAlertRecipients ?? "",
    thresholdAlertSubject: settings?.thresholdAlertSubject || "⚠️ Threshold Breach Alert - {{company_name}}",
    thresholdAlertBody: settings?.thresholdAlertBody || "A threshold breach has been detected for {{company_name}}.\n\nDetails:\n• Metric: {{metric_name}}\n• Actual Value: {{value}}\n• Threshold: {{threshold_value}}\n• Severity: {{severity}}\n• Period: {{period}}\n\nView details: {{dashboard_link}}",
    submissionNotificationRecipients: settings?.submissionNotificationRecipients ?? "",
    submissionNotificationSubject: settings?.submissionNotificationSubject || "New Submission Received — {{company_name}}",
    submissionNotificationBody: settings?.submissionNotificationBody || "{{company_name}} has submitted new data.\n\nSubmitted by: {{submitted_by}}\nSubmission time: {{submission_time}}\n\nView details: {{dashboard_link}}",
    submissionVoidedRecipients: (settings as any)?.submissionVoidedRecipients ?? "",
    submissionVoidedSubject: (settings as any)?.submissionVoidedSubject || "Submission Voided — {{company_name}}",
    submissionVoidedBody: (settings as any)?.submissionVoidedBody || "The {{submission_type}} from {{company_name}} has been voided.\n\nVoided on: {{voided_date}}\nReason: {{void_reason}}\n\nView company page: {{company_page_link}}",
    invitationSubject: settings?.invitationSubject || "You've been invited to PortCo Pulse",
    invitationBody: settings?.invitationBody || "Hello,\n\nYou have been invited to join PortCo Pulse, a portfolio monitoring platform.\n\nClick the link below to set up your account:\n{{invitation_link}}\n\nThis link expires in 48 hours.\n\nThank you.",
    planReminderSubject: settings?.planReminderSubject || "Action Required: Submit Your {{fiscal_year}} Annual Plan",
    planReminderBody: settings?.planReminderBody || "Dear {{company_name}},\n\nPlease submit your annual plan for {{fiscal_year}} by {{due_date}}.\n\nYour plan should include targets for each KPI tracked in PortCo Pulse. You can submit your plan using the link below:\n{{plan_link}}\n\nThank you.",
    planSubmittedRecipients: settings?.planSubmittedRecipients ?? "",
    planSubmittedSubject: settings?.planSubmittedSubject || "{{company_name}} Submitted Their {{fiscal_year}} Plan ({{version}})",
    planSubmittedBody: settings?.planSubmittedBody || "{{company_name}} has submitted their {{fiscal_year}} annual plan ({{version}}).\n\nView and comment on the plan: {{plan_review_link}}",
    investorNoteNotificationSubject: (settings as any)?.investorNoteNotificationSubject || "New Note on {{kpi_name}} — {{company_name}}",
    investorNoteNotificationBody: (settings as any)?.investorNoteNotificationBody || "Your investor has added a note on {{kpi_name}} for {{period}}.\n\nNote:\n{{note_text}}\n\nView in PortCo Pulse: {{analytics_link}}",
    submissionReminderRecipients: (settings as any)?.submissionReminderRecipients ?? "",
    planReminderRecipients: (settings as any)?.planReminderRecipients ?? "",
    kpiOverrideNotificationRecipients: (settings as any)?.kpiOverrideNotificationRecipients ?? "",
    kpiOverrideNotificationSubject: (settings as any)?.kpiOverrideNotificationSubject || "KPI Override — {{company_name}}: {{kpi_label}}",
    kpiOverrideNotificationBody: (settings as any)?.kpiOverrideNotificationBody || "A company-level KPI override has been saved for {{company_name}}.\n\nKPI: {{kpi_label}}\nOverride: {{override_summary}}\n\nThis setting will take precedence over the firm-wide default for this company.\n\nView in PortCo Pulse: {{dashboard_link}}",
    ragAlertRecipients: (settings as any)?.ragAlertRecipients ?? "",
    ragAlertSubject: (settings as any)?.ragAlertSubject || "⚠️ RAG Alert — {{company_name}}: {{issues_summary}}",
    ragAlertBody: (settings as any)?.ragAlertBody || "⚠️ KPI STATUS ALERT\n\n{{company_name}} submitted data for {{period}} with the following KPIs off track vs plan:\n\n{{issues_list}}\n\nView full details: {{dashboard_link}}",
    planDueMonth: String(settings?.planDueMonth ?? 1),
    planDueDay: String(settings?.planDueDay ?? 31),
    reminderDaysBeforeDue: String((settings as any)?.reminderDaysBeforeDue ?? 3),
    planReminderDaysBeforeDue: String((settings as any)?.planReminderDaysBeforeDue ?? 30),
    dueDaysMonthly: String((settings as any)?.dueDaysMonthly ?? 15),
    dueDaysQuarterly: String((settings as any)?.dueDaysQuarterly ?? 30),
    dueDaysAnnual: String((settings as any)?.dueDaysAnnual ?? 60),
    dueDaysBiAnnual: String((settings as any)?.dueDaysBiAnnual ?? 45),
  };

  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    submissionReminderEnabled: settings?.submissionReminderEnabled ?? true,
    monthlyDigestEnabled: settings?.monthlyDigestEnabled ?? true,
    thresholdAlertEnabled: settings?.thresholdAlertEnabled ?? true,
    submissionNotificationEnabled: settings?.submissionNotificationEnabled ?? true,
    submissionVoidedEnabled: (settings as any)?.submissionVoidedEnabled ?? true,
    submissionVoidedInAppEnabled: (settings as any)?.submissionVoidedInAppEnabled ?? true,
    planReminderEnabled: settings?.planReminderEnabled ?? true,
    investorNoteNotificationEnabled: (settings as any)?.investorNoteNotificationEnabled ?? true,
    kpiOverrideNotificationEnabled: (settings as any)?.kpiOverrideNotificationEnabled ?? true,
    ragAlertEnabled: (settings as any)?.ragAlertEnabled ?? true,
    // In-app toggles
    submissionNotificationInAppEnabled: (settings as any)?.submissionNotificationInAppEnabled ?? true,
    submissionReminderInAppEnabled: (settings as any)?.submissionReminderInAppEnabled ?? true,
    ragAlertInAppEnabled: (settings as any)?.ragAlertInAppEnabled ?? true,
    thresholdAlertInAppEnabled: (settings as any)?.thresholdAlertInAppEnabled ?? true,
    kpiOverrideNotificationInAppEnabled: (settings as any)?.kpiOverrideNotificationInAppEnabled ?? true,
    investorNoteInAppEnabled: (settings as any)?.investorNoteInAppEnabled ?? true,
    monthlyDigestInAppEnabled: (settings as any)?.monthlyDigestInAppEnabled ?? true,
  });
  const [saving, setSaving] = useState(false);

  const parseDocs = (s: string | null) =>
    new Set((s ?? "balance_sheet,income_statement,cash_flow_statement").split(",").filter(Boolean));
  const parseCadences = (s: string | null) => {
    const map: Record<string, string> = {};
    for (const entry of (s ?? "").split(",").filter(Boolean)) {
      const [k, v] = entry.split(":");
      if (k && v) map[k] = v;
    }
    return map;
  };
  const serializeCadences = (c: Record<string, string>) =>
    Object.entries(c).map(([k, v]) => `${k}:${v}`).join(",");

  const [docsChecked, setDocsChecked] = useState<Set<string>>(() => parseDocs((settings as any)?.firmRequiredDocs ?? null));
  const [docsCadences, setDocsCadences] = useState<Record<string, string>>(() => parseCadences((settings as any)?.firmRequiredDocCadences ?? null));

  function handleChange(key: string, val: string) {
    setVals((prev) => ({ ...prev, [key]: val }));
  }

  function handlePrefChange(key: string, val: boolean) {
    setPrefs((prev) => ({ ...prev, [key]: val }));
  }

  const router = useRouter();
  async function handleSave() {
    setSaving(true);
    try {
      await saveDueDaysAction(firmId, {
        monthly:   Number(vals.dueDaysMonthly ?? 15),
        quarterly: Number(vals.dueDaysQuarterly ?? 30),
        annual:    Number(vals.dueDaysAnnual ?? 60),
        biAnnual:  Number(vals.dueDaysBiAnnual ?? 45),
      });
      await saveEmailSettingsAction({ firmId, ...vals, ...prefs } as Parameters<typeof saveEmailSettingsAction>[0]);
      await saveFirmDocsAction(firmId, [...docsChecked].join(","), serializeCadences(docsCadences));
      toast.success("Settings saved.");
      router.refresh();
    } catch { toast.error("Failed to save settings."); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-8">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>
      <SettingsNav />

      <Tabs defaultValue="access">
        <TabsList className="justify-start rounded-none bg-transparent border-b border-border px-0 h-auto gap-0 w-full mb-8 [&>*]:flex-none">
          {[
            { value: "access", label: "Access" },
            { value: "notifications", label: "Notifications" },
            { value: "kpis", label: "Firm-Wide KPIs" },
            { value: "submissions", label: "Submissions" },
          ].map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="access">
          <TeamSection firmId={firmId} currentUserId={currentUserId} initialUsers={firmUsers} allCompanies={allCompanies} userScopes={userScopes} funds={funds} industries={industries} />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsSection
            vals={vals}
            prefs={prefs}
            onChange={handleChange}
            onPrefChange={handlePrefChange}
            onSave={handleSave}
            saving={saving}
          />
        </TabsContent>

        <TabsContent value="kpis">
          <div>
            <p className="text-xs font-medium bg-muted/50 border border-border rounded-md px-3 py-2 mb-6">
              KPIs tracked across all portfolio companies. Company-specific KPIs and overrides are set per-company in Company Settings.
            </p>
            <FirmKpisSection firmId={firmId} initialKpis={kpiDefs} />
          </div>
        </TabsContent>

        <TabsContent value="submissions">
          <div className="space-y-8">
            <p className="text-xs font-medium bg-muted/50 border border-border rounded-md px-3 py-2">Default requirements for all companies. These settings can be overridden per-company in Company Settings.</p>
            {/* Schedule */}
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Due date by cadence</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Business days after period close</p>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 max-w-sm">
                {([
                  { label: "Monthly",   key: "dueDaysMonthly",   max: 90 },
                  { label: "Quarterly", key: "dueDaysQuarterly", max: 90 },
                  { label: "Bi-Annual", key: "dueDaysBiAnnual",  max: 120 },
                  { label: "Annual",    key: "dueDaysAnnual",    max: 180 },
                ] as const).map(({ label, key, max }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0">{label}</span>
                    <input
                      type="number" min={1} max={max}
                      value={vals[key] ?? ""}
                      onChange={(e) => handleChange(key, e.target.value)}
                      className="w-14 text-xs border border-border rounded px-2 py-1 bg-white"
                    />
                    <span className="text-xs">days</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs">Reminder sent</span>
                <input
                  type="number" min={1} max={90}
                  value={vals["reminderDaysBeforeDue"] ?? "3"}
                  onChange={(e) => handleChange("reminderDaysBeforeDue", e.target.value)}
                  className="w-14 text-xs border border-border rounded px-2 py-1 bg-white"
                />
                <span className="text-xs">business days before due date</span>
              </div>
            </div>

            {/* Required Documents */}
            <div>
              <FirmDocsSection
                checked={docsChecked}
                cadences={docsCadences}
                onCheckedChange={setDocsChecked}
                onCadenceChange={setDocsCadences}
                disabled={saving}
              />
            </div>

            <div>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
