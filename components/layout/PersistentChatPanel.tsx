"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, PanelRightClose, Loader2, X } from "lucide-react";
import { useChatContext } from "@/components/layout/chat-context";
import { ChatInterface } from "@/app/submit/[token]/_components/ChatInterface";
import type { UploadResult } from "@/app/api/upload/route";
import { sendRemindersAction } from "@/app/(app)/submissions/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Persona = "investor" | "operator" | "independent_operator";

interface KpiMeta {
  key: string;
  label: string;
  unit: string | null;
  valueType: string;
}

interface CompanyMeta {
  companyId: string;
  companyName: string;
  firmName: string;
  token: string;
  chatMode: "periodic" | "onboarding";
  chatEndpoint: string;
  enabledKpis: KpiMeta[];
  userId: string;
  requiredDocs?: string;
  requiredDocCadences?: string;
}

// ---------------------------------------------------------------------------
// PersistentChatPanel — outer shell (always rendered)
// ---------------------------------------------------------------------------

interface PersistentChatPanelProps {
  persona: Persona;
  userCompanyId: string | null;
  firmId: string | undefined;
}

export function PersistentChatPanel({ persona, userCompanyId, firmId }: PersistentChatPanelProps) {
  const { chatOpen, toggleChat } = useChatContext();

  const [panelWidth, setPanelWidth] = useState(384);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    function onMouseMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      const delta = dragStartX.current - ev.clientX;
      const newWidth = Math.max(320, Math.min(640, dragStartWidth.current + delta));
      setPanelWidth(newWidth);
    }
    function onMouseUp() {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [panelWidth]);

  useEffect(() => {
    if (!chatOpen) setPanelWidth(384);
  }, [chatOpen]);

  return (
    <div
      className="relative shrink-0 h-full flex flex-col overflow-hidden"
      style={{
        width: chatOpen ? `${panelWidth}px` : "2.25rem",
        transition: isDragging.current ? "none" : "width 300ms ease-in-out",
        borderLeft: "1px solid hsl(var(--border))",
      }}
    >
      {chatOpen && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 z-10"
          style={{ cursor: "col-resize" }}
        />
      )}
      {!chatOpen && (
        <button
          type="button"
          onClick={toggleChat}
          className="flex flex-col items-center justify-center h-full w-full transition-colors"
          style={{ backgroundColor: "white", borderRight: "1px solid #e0e0e0" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f5f5f5")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
          aria-label="Open chat panel"
        >
          <div style={{ transform: "rotate(270deg)", display: "flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap" }}>
            <MessageSquare className="h-3.5 w-3.5 text-green-600 shrink-0" />
            <span className="text-[13px] font-medium text-muted-foreground shrink-0">Pulse AI</span>
          </div>
        </button>
      )}
      {chatOpen && (
        <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
          <ChatPanelExpanded
            persona={persona}
            userCompanyId={userCompanyId}
            firmId={firmId}
            onCollapse={toggleChat}
          />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanelExpanded — the unified chat pane
// ---------------------------------------------------------------------------

function ChatPanelExpanded({
  persona,
  userCompanyId,
  firmId,
  onCollapse,
}: {
  persona: Persona;
  userCompanyId: string | null;
  firmId: string | undefined;
  onCollapse: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Active company for submission mode (null = Q&A mode)
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyMeta, setCompanyMeta] = useState<CompanyMeta | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);

  // Company list for picker
  const [companyList, setCompanyList] = useState<Array<{ id: string; name: string }>>([]);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);

  // Pending files/text from pre-selection flow
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingAutoMessage, setPendingAutoMessage] = useState<string | undefined>(undefined);

  // Reminder state (for Submissions page chips)
  const [outstandingData, setOutstandingData] = useState<{
    periodId: string;
    noSubmission: Array<{ companyId: string; companyName: string }>;
    partial: Array<{ companyId: string; companyName: string }>;
  } | null>(null);

  // For operator persona, always use their company
  const operatorCompanyId = (persona === "operator" || persona === "independent_operator") ? userCompanyId : null;

  // Fetch company list on mount
  useEffect(() => {
    if (persona !== "investor") return;
    fetch("/api/companies")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCompanyList(data); })
      .catch(() => {});
  }, [persona]);

  // Fetch outstanding data for Submissions page
  useEffect(() => {
    if (pathname !== "/submissions") { setOutstandingData(null); return; }
    fetch("/api/submissions/outstanding")
      .then((r) => r.json())
      .then((data) => { if (data.noSubmission !== undefined) setOutstandingData(data); })
      .catch(() => {});
  }, [pathname]);

  // Fetch company meta when activeCompanyId changes
  useEffect(() => {
    const targetId = operatorCompanyId ?? activeCompanyId;
    if (!targetId) { setCompanyMeta(null); return; }
    setCompanyLoading(true);
    fetch(`/api/chat/context?companyId=${encodeURIComponent(targetId)}`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((data) => setCompanyMeta(data))
      .catch((err) => { console.error("[PulseAI] context fetch failed:", err); setCompanyMeta(null); })
      .finally(() => setCompanyLoading(false));
  }, [activeCompanyId, operatorCompanyId]);

  // Company-from-URL for Analytics/Settings pages
  const companyIdFromUrl = (pathname === "/analytics" || pathname === "/admin/companies")
    ? (searchParams.get("company") ?? null)
    : null;

  // Auto-set activeCompanyId from URL on relevant pages
  useEffect(() => {
    if (persona === "investor" && companyIdFromUrl) {
      setActiveCompanyId(companyIdFromUrl);
    }
  }, [companyIdFromUrl, persona]);

  // Match company from filename (for file drop)
  function matchCompanyFromFilename(filename: string): string | null {
    const lower = filename.toLowerCase().replace(/[_\-\.]/g, " ");
    for (const co of companyList) {
      const words = co.name.toLowerCase().split(/\s+/);
      const significant = words.filter((w) => w.length > 3);
      if (significant.some((w) => lower.includes(w))) return co.id;
    }
    return null;
  }

  // Handle "Submit data for a company" chip or file drop
  function handleSelectCompany(companyId: string) {
    setShowCompanyPicker(false);
    setActiveCompanyId(companyId);
    // Only auto-send when files were pending (from drop) — otherwise let user pick from chips
    if (pendingFiles.length > 0) {
      setPendingAutoMessage(`Submitting actuals for the current period. Extract all KPI values from the attached file(s).`);
    }
  }

  function handleBackToPortfolio() {
    setActiveCompanyId(null);
    setCompanyMeta(null);
    setPendingFiles([]);
    setPendingAutoMessage(undefined);
  }

  // Determine effective company ID (operators always use their own)
  const effectiveCompanyId = operatorCompanyId ?? activeCompanyId;

  // ── Chip pools ──────────────────────────────────────────────────────────

  const DASHBOARD_CHIPS = [
    "Who's behind on plan YTD?",
    "Which company has deteriorated most over the last 3 periods?",
    "How is total portfolio EBITDA trending vs last year?",
    "Which company's cash position is most concerning?",
    "Who improved most last period?",
    "Which portco is most at risk?",
  ];

  const SUBMISSIONS_CHIPS = [
    "Which companies are at risk of missing this period's deadline?",
  ];

  const COMPANY_CHIPS_FN = (name: string) => [
    `How is ${name} tracking against plan?`,
    `Any active KPI alerts for ${name}?`,
    `What's ${name}'s worst performing KPI vs plan?`,
    `Show ${name}'s headcount trend`,
    `How does ${name}'s margin compare to last period?`,
  ];

  const SUBMISSION_CHIPS_FN = (name: string) => [
    `Submit this period's actuals for ${name}`,
    `Submit annual plan data for ${name}`,
    `Submit historical / onboarding data for ${name}`,
  ];

  const isDashboard = pathname === "/dashboard";
  const isSubmissions = pathname === "/submissions";
  const isFirmSettings = pathname === "/admin/settings" || pathname === "/settings";

  function buildChips(): string[] {
    // When company is active, show submission + Q&A chips
    if (effectiveCompanyId && companyMeta) {
      return [
        ...SUBMISSION_CHIPS_FN(companyMeta.companyName),
        ...COMPANY_CHIPS_FN(companyMeta.companyName),
      ];
    }

    // Portfolio Q&A chips
    if (isDashboard) return DASHBOARD_CHIPS.slice(0, 2);
    if (isSubmissions) {
      const chips = [...SUBMISSIONS_CHIPS];
      // Dynamic reminder chips
      if (outstandingData && outstandingData.noSubmission.length > 0) {
        chips.push("Send reminders to companies with no submission");
      }
      if (outstandingData && outstandingData.partial.length > 0) {
        chips.push("Send reminders to companies with partial submissions");
      }
      return chips;
    }
    if (isFirmSettings) return ["How do firmwide KPI settings and overrides work?", "What are the current firmwide KPI thresholds?"];
    return [];
  }

  const fixedChip = (!effectiveCompanyId && persona === "investor") ? "Submit data for a company \u2192" : undefined;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-green-600" />
          <span className="text-sm font-medium text-muted-foreground">Pulse AI</span>
        </div>
        <button type="button" onClick={onCollapse} className="rounded-md p-1 hover:bg-muted transition-colors" aria-label="Collapse chat panel">
          <PanelRightClose className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Company context bar — shows which company the chat is scoped to */}
      {effectiveCompanyId && companyMeta && !operatorCompanyId && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/50 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-muted-foreground shrink-0">Submitting for</span>
            <span className="text-[10px] font-semibold text-foreground truncate">{companyMeta.companyName}</span>
          </div>
          {/* Only show Exit when company was manually selected (not auto-set from page URL) */}
          {activeCompanyId && !companyIdFromUrl && (
            <button
              type="button"
              onClick={handleBackToPortfolio}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
            >
              ✕ Exit
            </button>
          )}
        </div>
      )}

      {/* Company picker overlay */}
      {showCompanyPicker && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-muted-foreground">Select a company:</span>
            <button type="button" onClick={() => { setShowCompanyPicker(false); setPendingFiles([]); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
            {companyList.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-2">No companies found.</p>
            ) : (
              companyList.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => handleSelectCompany(company.id)}
                  className="text-left px-3 py-1.5 rounded-md text-xs hover:bg-muted border border-transparent hover:border-border transition-colors"
                >
                  {company.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0">
        {companyLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ChatInterface
            key={effectiveCompanyId ?? "portfolio"}
            token={companyMeta?.token ?? ""}
            companyId={effectiveCompanyId ?? undefined}
            companyName={companyMeta?.companyName ?? "Portfolio"}
            firmName={companyMeta?.firmName ?? "your firm"}
            initialMessages={[]}
            enabledKpis={companyMeta?.enabledKpis ?? []}
            submittedByUserId={companyMeta?.userId ?? ""}
            mode="periodic"
            chatEndpoint="/api/chat/pulse"
            compact={true}
            requiredDocs={companyMeta?.requiredDocs}
            requiredDocCadences={companyMeta?.requiredDocCadences}
            promptChips={buildChips()}
            fixedChip={fixedChip}
            autoMessage={pendingAutoMessage}
            onChipIntercept={(chip) => {
              // Handle special chips that shouldn't go to the AI
              if (chip === "Submit data for a company \u2192") {
                setShowCompanyPicker(true);
                return true; // intercepted
              }
              if (chip === "Send reminders to companies with no submission" && outstandingData) {
                // TODO: implement reminder confirmation flow
                return true;
              }
              if (chip === "Send reminders to companies with partial submissions" && outstandingData) {
                // TODO: implement reminder confirmation flow
                return true;
              }
              return false; // not intercepted, let ChatInterface handle it
            }}
          />
        )}
      </div>
    </div>
  );
}
