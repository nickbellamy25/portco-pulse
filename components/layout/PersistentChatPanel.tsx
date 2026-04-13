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
  latestPeriodLabel?: string;
  initialMessages?: Array<{
    role: "user" | "assistant";
    content: string;
    submittedPayload?: any;
    canceledPayload?: any;
    detectedDocuments?: string[];
    divider?: string;
  }>;
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
  const { chatOpen } = useChatContext();

  // Active company for submission mode (null = Q&A mode)
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyMeta, setCompanyMeta] = useState<CompanyMeta | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);

  // Company list for picker
  const [companyList, setCompanyList] = useState<Array<{ id: string; name: string; onboardingStatus: string | null }>>([]);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);

  // Pending files/text from pre-selection flow
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingAutoMessage, setPendingAutoMessage] = useState<string | undefined>(undefined);
  const [pendingSubmissionText, setPendingSubmissionText] = useState<string | null>(null);


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
  }, [persona, chatOpen]);

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

  // companyIdFromUrl is available for reference but does NOT auto-set activeCompanyId.
  // The panel always starts in Q&A mode — user opts into submission via "Submit data for a company →" chip.

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
    // Forward pending submission text (from intent detection) as auto-message
    if (pendingSubmissionText) {
      setPendingAutoMessage(pendingSubmissionText);
      setPendingSubmissionText(null);
    }
    // Only auto-send when files were pending (from drop) — otherwise let user pick from chips
    else if (pendingFiles.length > 0) {
      setPendingAutoMessage(`Submitting actuals for the current period. Extract all KPI values from the attached file(s).`);
    }
  }

  function handleBackToPortfolio() {
    setActiveCompanyId(null);
    setCompanyMeta(null);
    setPendingFiles([]);
    setPendingAutoMessage(undefined);
    setPendingSubmissionText(null);
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


  const isDashboard = pathname === "/dashboard";
  const isSubmissions = pathname === "/submissions";
  const isAnalytics = pathname === "/analytics";
  const isCompanySettings = pathname === "/admin/companies";
  const isFirmSettings = pathname === "/admin/settings" || pathname === "/settings";

  // Resolve company name from URL for contextual chips (without entering submission mode)
  const urlCompanyName = companyIdFromUrl
    ? companyList.find((c) => c.id === companyIdFromUrl)?.name ?? null
    : null;

  const COMPANY_SETTINGS_CHIPS_FN = (name: string) => [
    `What KPIs are configured for ${name}?`,
    `What are the current alert thresholds for ${name}?`,
    `What documents are required for ${name}?`,
  ];

  function buildChips(): string[] {
    // Portfolio Q&A chips per page
    if (isDashboard) return DASHBOARD_CHIPS;
    if (isSubmissions) {
      return [
        "Send reminders to companies with no submission this period",
        ...SUBMISSIONS_CHIPS,
      ];
    }
    if (isAnalytics && urlCompanyName) {
      const chips = COMPANY_CHIPS_FN(urlCompanyName);
      const comp = companyList.find(c => c.id === companyIdFromUrl);
      if (comp?.onboardingStatus === "pending" || comp?.onboardingStatus === "in_progress") {
        chips.unshift(`Send onboarding reminder to ${urlCompanyName}`);
      }
      return chips;
    }
    if (isAnalytics) return DASHBOARD_CHIPS;
    if (isCompanySettings && urlCompanyName) {
      const chips = COMPANY_SETTINGS_CHIPS_FN(urlCompanyName);
      const comp = companyList.find(c => c.id === companyIdFromUrl);
      if (comp?.onboardingStatus === "pending" || comp?.onboardingStatus === "in_progress") {
        chips.unshift(`Send onboarding reminder to ${urlCompanyName}`);
      }
      return chips;
    }
    if (isCompanySettings) return DASHBOARD_CHIPS.slice(0, 2);
    if (isFirmSettings) return ["How do firmwide KPI settings and overrides work?", "What are the current firmwide KPI thresholds?"];
    return [];
  }

  const fixedChip = (!effectiveCompanyId && persona === "investor") ? "Submit data for a company \u2192" : undefined;

  // ── Submission intent detection (Q&A mode only) ─────────────────────────
  // Detects when a user message in Q&A mode is actually a submission intent
  // and routes them to submission mode instead of the Q&A endpoint.

  const SUBMISSION_PHRASES = /\b(submit|submit\s+data|enter\s+data|report\s+data|upload\s+data|send\s+data|input\s+data|log\s+data|record\s+data|file\s+data|submit\s+for|submit\s+actuals|enter\s+actuals|report\s+actuals|i\s+want\s+to\s+submit|i\s+need\s+to\s+submit|ready\s+to\s+submit|let\s*'?s\s+submit)\b/i;
  const QUESTION_PHRASES = /\b(what|which|who|how|show|list|display|compare|when|where|why|has\s+been\s+submitted|submission\s+status|submissions\s+for)\b/i;

  function detectSubmissionIntent(text: string, uploads: UploadResult[]): boolean {
    // File uploads in Q&A mode always indicate submission intent
    if (uploads.length > 0) return true;

    // If it looks like a question, don't intercept
    if (QUESTION_PHRASES.test(text) && !SUBMISSION_PHRASES.test(text)) return false;

    // Check for explicit submission phrases
    if (SUBMISSION_PHRASES.test(text)) return true;

    // Check for data-heavy messages (3+ numbers suggest KPI data entry)
    const numberMatches = text.match(/\d[\d,]*\.?\d*/g);
    if (numberMatches && numberMatches.length >= 3) return true;

    return false;
  }

  function handleMessageIntercept(text: string, uploads: UploadResult[]): boolean {
    // Only intercept in Q&A mode for investors
    if (effectiveCompanyId || persona !== "investor") return false;

    if (!detectSubmissionIntent(text, uploads)) return false;

    // Try to extract company name from the message text
    const matchedCompanyId = matchCompanyFromFilename(text);

    if (matchedCompanyId) {
      // Company found — auto-select and forward the message
      setPendingSubmissionText(text);
      handleSelectCompany(matchedCompanyId);
    } else {
      // No company matched — open picker and stash the message
      setPendingSubmissionText(text);
      setShowCompanyPicker(true);
    }

    return true; // intercepted
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background border-l border-border">
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
          {activeCompanyId && (
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
            <button type="button" onClick={() => { setShowCompanyPicker(false); setPendingFiles([]); setPendingSubmissionText(null); }} className="text-muted-foreground hover:text-foreground">
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
            token={effectiveCompanyId ? (companyMeta?.token ?? "") : ""}
            companyId={effectiveCompanyId ?? undefined}
            companyName={effectiveCompanyId ? (companyMeta?.companyName ?? "Portfolio") : "Portfolio"}
            firmName={companyMeta?.firmName ?? "your firm"}
            initialMessages={companyMeta?.initialMessages ?? []}
            enabledKpis={effectiveCompanyId ? (companyMeta?.enabledKpis ?? []) : []}
            submittedByUserId={companyMeta?.userId ?? ""}
            mode="periodic"
            chatEndpoint="/api/chat/pulse"
            compact={true}
            requiredDocs={companyMeta?.requiredDocs}
            requiredDocCadences={companyMeta?.requiredDocCadences}
            contextPeriod={companyMeta?.latestPeriodLabel}
            promptChips={effectiveCompanyId ? [] : buildChips()}
            fixedChip={effectiveCompanyId ? undefined : fixedChip}
            autoMessage={pendingAutoMessage}
            onMessageIntercept={!effectiveCompanyId ? handleMessageIntercept : undefined}
            onChipIntercept={(chip) => {
              // Handle special chips that shouldn't go to the AI
              if (chip === "Submit data for a company \u2192") {
                setShowCompanyPicker(true);
                return true; // intercepted
              }
              if (chip === "Send reminders to companies with no submission this period" && outstandingData) {
                // TODO: implement reminder confirmation flow
                return true;
              }
              if (chip.startsWith("Send onboarding reminder to ") && companyIdFromUrl) {
                fetch("/api/companies/onboarding-remind", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ companyId: companyIdFromUrl }),
                })
                  .then(r => r.json())
                  .then(data => {
                    alert(data.message || "Onboarding reminder sent!");
                  })
                  .catch(() => alert("Failed to send onboarding reminder"));
                return true;
              }
              return false; // not intercepted, let ChatInterface handle it
            }}
            onEditCompanySwitch={() => {/* handled internally via editCompanyIdRef */}}
          />
        )}
      </div>
    </div>
  );
}
