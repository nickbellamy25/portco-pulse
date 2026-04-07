"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, PanelRightClose, Loader2, Send, Paperclip, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatContext } from "@/components/layout/chat-context";
import { ChatInterface } from "@/app/submit/[token]/_components/ChatInterface";
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

interface InitialMsg {
  role: "user" | "assistant";
  content: string;
}

interface CompanyContext {
  kind: "company";
  companyId: string;
  companyName: string;
  firmName: string;
  token: string;
  chatMode: "periodic" | "onboarding";
  chatEndpoint: string;
  initialMessages: InitialMsg[];
  enabledKpis: KpiMeta[];
  userId: string;
  openingMessage: string;
}

interface PortfolioContext {
  kind: "portfolio";
}

type ChatCtx = CompanyContext | PortfolioContext | null;

// ---------------------------------------------------------------------------
// PersistentChatPanel — outer shell (always rendered, never returns null)
// ---------------------------------------------------------------------------

interface PersistentChatPanelProps {
  persona: Persona;
  userCompanyId: string | null;
  firmId: string | undefined;
}

export function PersistentChatPanel({
  persona,
  userCompanyId,
  firmId,
}: PersistentChatPanelProps) {
  const { chatOpen, toggleChat } = useChatContext();

  const [panelWidth, setPanelWidth] = useState(384);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const [submissionOverrideId, setSubmissionOverrideId] = useState<string | null>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;

    function onMouseMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      const delta = dragStartX.current - ev.clientX; // drag left = wider
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

  const SESSION_KEY = "pulse_chat_messages_v1";
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string; [key: string]: unknown }>>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = sessionStorage.getItem("pulse_chat_messages_v1");
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(chatMessages));
    } catch {}
  }, [chatMessages]);

  useEffect(() => {
    if (!chatOpen) {
      setPanelWidth(384);
      setSubmissionOverrideId(null);
    }
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
      {/* Drag handle on left edge — only when open */}
      {chatOpen && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 z-10"
          style={{ cursor: "col-resize" }}
        />
      )}
      {/* Closed state — vertical clickable tab */}
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

      {/* Open state — expanded panel (Suspense wraps useSearchParams usage) */}
      {chatOpen && (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <ChatPanelExpanded
            persona={persona}
            userCompanyId={userCompanyId}
            firmId={firmId}
            onCollapse={toggleChat}
            chatMessages={chatMessages}
            setChatMessages={setChatMessages}
            submissionOverrideId={submissionOverrideId}
            setSubmissionOverrideId={setSubmissionOverrideId}
          />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanelExpanded — uses useSearchParams so must be inside Suspense
// ---------------------------------------------------------------------------

interface ChatPanelExpandedProps {
  persona: Persona;
  userCompanyId: string | null;
  firmId: string | undefined;
  onCollapse: () => void;
  chatMessages: Array<{ role: "user" | "assistant"; content: string; [key: string]: unknown }>;
  setChatMessages: React.Dispatch<React.SetStateAction<Array<{ role: "user" | "assistant"; content: string; [key: string]: unknown }>>>;
  submissionOverrideId: string | null;
  setSubmissionOverrideId: (id: string | null) => void;
}

function ChatPanelExpanded({
  persona,
  userCompanyId,
  firmId,
  onCollapse,
  chatMessages,
  setChatMessages,
  submissionOverrideId,
  setSubmissionOverrideId,
}: ChatPanelExpandedProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [ctx, setCtx] = useState<ChatCtx>(null);
  const [loading, setLoading] = useState(true);
  const [overrideCtx, setOverrideCtx] = useState<CompanyContext | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  // Company ID from URL — only honoured on relevant routes
  const companyIdFromUrl: string | null =
    pathname === "/analytics" || pathname === "/admin/companies"
      ? (searchParams.get("company") ?? null)
      : null;

  // Operators always see their own company; investors see whatever is in the URL
  const targetCompanyId: string | null =
    persona === "operator" || persona === "independent_operator"
      ? userCompanyId
      : companyIdFromUrl;

  const prevTargetRef = useRef<string | null | undefined>(undefined);
  const prevCompanyIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Skip if the target hasn't changed
    if (prevTargetRef.current === targetCompanyId) return;
    prevTargetRef.current = targetCompanyId;

    // Reset chat messages when switching between two different companies (not portfolio↔company)
    const switchingCompany =
      prevCompanyIdRef.current !== undefined &&
      prevCompanyIdRef.current !== null &&
      targetCompanyId !== null &&
      prevCompanyIdRef.current !== targetCompanyId;
    if (switchingCompany) {
      setChatMessages([]);
    }
    prevCompanyIdRef.current = targetCompanyId;

    if (!targetCompanyId) {
      setCtx(persona === "investor" ? { kind: "portfolio" } : null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/chat/context?companyId=${encodeURIComponent(targetCompanyId)}`)
      .then((r) => r.json())
      .then((data: Omit<CompanyContext, "kind">) => {
        setCtx({ ...data, kind: "company" });
      })
      .catch(() => {
        setCtx(persona === "investor" ? { kind: "portfolio" } : null);
      })
      .finally(() => setLoading(false));
  }, [targetCompanyId, persona]);

  // Fetch override context when submissionOverrideId changes
  useEffect(() => {
    if (!submissionOverrideId || targetCompanyId !== null) {
      setOverrideCtx(null);
      return;
    }
    setOverrideLoading(true);
    fetch(`/api/chat/context?companyId=${encodeURIComponent(submissionOverrideId)}`)
      .then((r) => r.json())
      .then((data: Omit<CompanyContext, "kind">) => {
        setOverrideCtx({ ...data, kind: "company" });
      })
      .catch(() => {
        setOverrideCtx(null);
      })
      .finally(() => setOverrideLoading(false));
  }, [submissionOverrideId, targetCompanyId]);

  function handleBackToPortfolio() {
    setSubmissionOverrideId(null);
    setChatMessages([]);
    setOverrideCtx(null);
  }

  const showOverride = overrideCtx !== null && targetCompanyId === null;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <span className="text-[13px] font-medium text-muted-foreground shrink-0">Pulse AI</span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="rounded-md p-1 hover:bg-muted transition-colors"
          aria-label="Collapse chat panel"
        >
          <PanelRightClose className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Back button when override is active */}
      {showOverride && (
        <button
          type="button"
          onClick={handleBackToPortfolio}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-b border-border w-full bg-muted/30 transition-colors shrink-0"
        >
          <ChevronLeft className="h-3 w-3" /> Portfolio chat
        </button>
      )}

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0">
        {loading || overrideLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : showOverride ? (
          <CompanyChat
            ctx={overrideCtx!}
            messages={chatMessages}
            onMessagesChange={setChatMessages}
            onSubmitForCompany={null}
            autoSubmit={true}
          />
        ) : ctx === null ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Select a company to open their chat.
            </p>
          </div>
        ) : ctx.kind === "portfolio" ? (
          <PortfolioQAPane
            messages={chatMessages}
            setMessages={setChatMessages}
            firmId={firmId}
            onSubmitForCompany={(id) => setSubmissionOverrideId(id)}
            pathname={pathname}
          />
        ) : (
          <CompanyChat
            ctx={ctx}
            messages={chatMessages}
            onMessagesChange={setChatMessages}
            onSubmitForCompany={(id) => setSubmissionOverrideId(id)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompanyChat — wraps ChatInterface from the submission flow
// ---------------------------------------------------------------------------

function CompanyChat({
  ctx,
  messages,
  onMessagesChange,
  onSubmitForCompany,
  autoSubmit,
}: {
  ctx: CompanyContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessagesChange: (msgs: any[]) => void;
  onSubmitForCompany: ((companyId: string) => void) | null;
  autoSubmit?: boolean;
}) {
  const pathname = usePathname();

  const ANALYTICS_CHIP_POOL = [
    `How is ${ctx.companyName} tracking against plan?`,
    `Any active KPI alerts for ${ctx.companyName}?`,
    `Show ${ctx.companyName}'s headcount trend`,
    `What's ${ctx.companyName}'s worst performing KPI vs plan?`,
    `Is ${ctx.companyName} on track to hit its annual plan?`,
    `How does ${ctx.companyName}'s margin compare to last period?`,
  ];

  const COMPANY_SETTINGS_FIXED = [
    `What are ${ctx.companyName}'s current KPI rules?`,
    `Show ${ctx.companyName}'s current alert thresholds`,
    `Submit this period's data for ${ctx.companyName}`,
  ];

  const isCompanySettings = pathname === "/admin/companies";

  // Chip pool passed to ChatInterface — it handles rotation internally via usedPromptChips.
  // For analytics: full 6-chip pool + submit chip (ChatInterface shows first 3 unused, up to 3 total).
  // For company settings: 3 fixed chips.
  // Note: submit chip sends a message in the current ChatInterface impl (Part 1 behavior).
  // Part 2 will intercept it via onSubmitForCompany.
  const promptChips: string[] = isCompanySettings
    ? COMPANY_SETTINGS_FIXED
    : ANALYTICS_CHIP_POOL;

  const fixedChip: string | undefined = isCompanySettings
    ? undefined
    : `Submit this period's data for ${ctx.companyName}`;

  // Use persisted unified messages if available; otherwise fall back to company's DB history
  const effectiveInitialMessages =
    messages.length > 0
      ? messages
      : ctx.initialMessages && ctx.initialMessages.length > 0
      ? ctx.initialMessages
      : ctx.openingMessage
      ? [{ role: "assistant" as const, content: ctx.openingMessage }]
      : [];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ChatInterface
        token={ctx.token}
        companyName={ctx.companyName}
        firmName={ctx.firmName}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialMessages={effectiveInitialMessages as any}
        enabledKpis={ctx.enabledKpis}
        submittedByUserId={ctx.userId}
        mode={ctx.chatMode}
        chatEndpoint={ctx.chatEndpoint}
        promptChips={promptChips}
        fixedChip={fixedChip}
        onMessagesChange={onMessagesChange}
        compact={true}
        autoMessage={autoSubmit ? `Submit this period's data for ${ctx.companyName}` : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortfolioQAPane — streaming Q&A for investors
// ---------------------------------------------------------------------------

interface QAMessage {
  role: "user" | "assistant";
  content: string;
}

interface PortfolioQAPaneProps {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  setMessages: React.Dispatch<React.SetStateAction<Array<{ role: "user" | "assistant"; content: string }>>>;
  firmId: string | undefined;
  onSubmitForCompany: (companyId: string) => void;
  pathname: string;
}

function PortfolioQAPane({ messages, setMessages, firmId, onSubmitForCompany, pathname }: PortfolioQAPaneProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [outstandingData, setOutstandingData] = useState<{
    periodId: string;
    period: string;
    noSubmission: Array<{ companyId: string; companyName: string }>;
    partial: Array<{ companyId: string; companyName: string }>;
  } | null>(null);
  const [pendingReminder, setPendingReminder] = useState<"no_submission" | "partial" | false>(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [qaPendingFiles, setQaPendingFiles] = useState<File[]>([]);
  const [companyList, setCompanyList] = useState<Array<{ id: string; name: string }>>([]);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [usedChips, setUsedChips] = useState<Set<string>>(new Set());

  // Reset usedChips when pathname changes
  useEffect(() => {
    setUsedChips(new Set());
    setShowCompanyPicker(false);
  }, [pathname]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch outstanding submissions when on /submissions
  useEffect(() => {
    if (pathname !== "/submissions") {
      setOutstandingData(null);
      return;
    }
    fetch("/api/submissions/outstanding")
      .then((r) => r.json())
      .then((data) => {
        if (data.noSubmission !== undefined) {
          setOutstandingData(data);
        }
      })
      .catch(() => {});
  }, [pathname]);

  // Fetch company list on mount (lazy, once)
  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCompanyList(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  // ── Chip pools ────────────────────────────────────────────────────────────

  const DASHBOARD_CHIP_POOL = [
    "Who's behind on plan YTD?",
    "Which company has deteriorated most over the last 3 periods?",
    "How is total portfolio EBITDA trending vs last year?",
    "Which company's cash position is most concerning?",
    "Who improved most last period?",
    "Which portco is most at risk?",
  ];

  const SUBMISSIONS_CHIP_POOL = [
    "Which companies are at risk of missing this period's deadline?",
    "Which company submitted most recently?",
    "Which companies have been consistently late this year?",
    "Has any company missed 2 or more consecutive periods?",
  ];

  const FIRM_SETTINGS_FIXED = [
    "What are the current firmwide KPI thresholds?",
    "Which KPIs have alert rules configured?",
    "Submit data for a company →",
  ];

  const isFirmSettings = pathname === "/admin/settings" || pathname === "/settings";
  const isSubmissions = pathname === "/submissions";
  const isDashboard = pathname === "/dashboard";

  const chips: string[] = (() => {
    // Firm Settings: 3 fixed, no rotation
    if (isFirmSettings) {
      return FIRM_SETTINGS_FIXED;
    }

    if (isDashboard) {
      // 2 rotating + fixed submit chip in slot 3
      const rotating = DASHBOARD_CHIP_POOL.filter((c) => !usedChips.has(c)).slice(0, 2);
      return [...rotating, "Submit data for a company →"];
    }

    if (isSubmissions) {
      // Dynamic reminder chips
      const dynamicChips: string[] = [];
      if (outstandingData && outstandingData.noSubmission.length > 0 && !usedChips.has("Send reminders to companies with no submission")) {
        dynamicChips.push("Send reminders to companies with no submission");
      }
      if (outstandingData && outstandingData.partial.length > 0 && !usedChips.has("Send reminders to companies with partial submissions")) {
        dynamicChips.push("Send reminders to companies with partial submissions");
      }

      // Fixed submit chip in slot 1; remaining slots for rotating + dynamic
      const submitChip = "Submit data for a company →";
      const remainingSlots = 2; // total 3 - 1 fixed
      // Dynamic chips consume slots from the remaining 2
      const dynamicToShow = dynamicChips.slice(0, remainingSlots);
      const rotatingSlots = remainingSlots - dynamicToShow.length;
      const rotating = SUBMISSIONS_CHIP_POOL.filter((c) => !usedChips.has(c)).slice(0, rotatingSlots);
      return [submitChip, ...rotating, ...dynamicToShow];
    }

    return [];
  })();

  const sendMessage = useCallback(
    async (q: string) => {
      const fileLines = qaPendingFiles.map((f) => `[Attached: ${f.name}]`).join("\n");
    const question = [fileLines, q.trim()].filter(Boolean).join("\n");
    if (!question || isLoading) return;
    setQaPendingFiles([]);

      setMessages((prev) => [...prev, { role: "user", content: question }]);
      setInput("");
      setIsLoading(true);
      // Placeholder assistant message for streaming
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      try {
        const res = await fetch("/api/chat/qa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question }),
        });

        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: `Something went wrong: ${err.message ?? "Please try again."}`,
            };
            return updated;
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let answerText = "";
        let sseBuffer = "";

        function processLines(lines: string[]) {
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let event: { type: string; content?: string; message?: string };
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }
            if (event.type === "text" && event.content) {
              answerText += event.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: answerText,
                };
                return updated;
              });
            }
            if (event.type === "error") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: "Something went wrong. Please try again.",
                };
                return updated;
              });
            }
          }
        }

        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";
            processLines(lines);
          }
          if (done) {
            if (sseBuffer.trim()) processLines([sseBuffer]);
            break;
          }
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: "Connection error. Please try again.",
          };
          return updated;
        });
      } finally {
        setIsLoading(false);
        setTimeout(
          () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
          50
        );
      }
    },
    [isLoading]
  );

  function handleChipClick(chip: string) {
    setUsedChips((prev) => new Set([...prev, chip]));

    if (chip === "Submit data for a company →") {
      setShowCompanyPicker(true);
      return;
    }

    if (chip === "Send reminders to companies with no submission") {
      if (!outstandingData || outstandingData.noSubmission.length === 0) return;
      const names = outstandingData.noSubmission.map((c) => c.companyName);
      const nameStr = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      setMessages((prev) => [
        ...prev,
        { role: "user", content: chip },
        { role: "assistant", content: `I'll send submission reminders to ${nameStr}. Confirm?` },
      ]);
      setPendingReminder("no_submission");
    } else if (chip === "Send reminders to companies with partial submissions") {
      if (!outstandingData || outstandingData.partial.length === 0) return;
      const names = outstandingData.partial.map((c) => c.companyName);
      const nameStr = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      setMessages((prev) => [
        ...prev,
        { role: "user", content: chip },
        { role: "assistant", content: `I'll send submission reminders to ${nameStr}. Confirm?` },
      ]);
      setPendingReminder("partial");
    } else {
      sendMessage(chip);
    }
  }

  async function handleConfirmReminder() {
    if (!outstandingData || !firmId || pendingReminder === false) return;
    const companies = pendingReminder === "no_submission" ? outstandingData.noSubmission : outstandingData.partial;
    setPendingReminder(false);
    setSendingReminders(true);
    try {
      for (const company of companies) {
        await sendRemindersAction(firmId, outstandingData.periodId, company.companyId);
      }
      const count = companies.length;
      setMessages((prev) => [...prev, { role: "assistant", content: `Sent ${count} reminder${count !== 1 ? "s" : ""}.` }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to send reminders. Check email configuration." },
      ]);
    } finally {
      setSendingReminders(false);
    }
  }

  function handleCancelReminder() {
    setPendingReminder(false);
    setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
  }

  function handleQaDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) setQaPendingFiles((prev) => [...prev, ...files]);
  }
  function handleQaDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleQaFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setQaPendingFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
      e.target.value = "";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
{messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`text-xs px-3 py-2 ${
                msg.role === "user"
                  ? "max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-br-md whitespace-pre-wrap"
                  : "w-full bg-muted text-foreground rounded-2xl rounded-bl-md overflow-x-auto"
              }`}
            >
              {msg.role === "assistant" ? (
                msg.content ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => (
                        <p className="mb-1 last:mb-0">{children}</p>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc pl-4 mb-1 space-y-0.5">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal pl-4 mb-1 space-y-0.5">
                          {children}
                        </ol>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold">{children}</strong>
                      ),
                      table: ({ children }) => (
                        <table className="text-xs border-collapse my-1 w-full">
                          {children}
                        </table>
                      ),
                      th: ({ children }) => (
                        <th className="border border-border px-2 py-1 text-left font-medium bg-background/50">
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="border border-border px-2 py-1">
                          {children}
                        </td>
                      ),
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : isLoading && i === messages.length - 1 ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : null
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border px-3 pt-2 pb-2">

        {pendingReminder !== false && (
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={handleConfirmReminder}
              disabled={sendingReminders}
              className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {sendingReminders ? "Sending..." : "Yes, send"}
            </button>
            <button
              type="button"
              onClick={handleCancelReminder}
              disabled={sendingReminders}
              className="px-3 py-1 rounded-md border border-border bg-background text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Company picker overlay */}
        {showCompanyPicker ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-muted-foreground">Select a company to submit for:</span>
              <button
                type="button"
                onClick={() => setShowCompanyPicker(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Cancel"
              >
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
                    onClick={() => {
                      setShowCompanyPicker(false);
                      onSubmitForCompany(company.id);
                    }}
                    className="text-left px-3 py-1.5 rounded-md text-xs hover:bg-muted border border-transparent hover:border-border transition-colors"
                  >
                    {company.name}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleChipClick(chip)}
                    disabled={isLoading}
                    className="px-2.5 py-1 rounded-full border border-border bg-background text-[11px] text-foreground hover:border-primary/60 hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            {qaPendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {qaPendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 bg-muted border border-border rounded-full px-2.5 py-0.5 text-[11px]">
                    <Paperclip className="h-3 w-3 text-muted-foreground" />
                    <span className="max-w-[100px] truncate">{f.name}</span>
                    <button type="button" onClick={() => setQaPendingFiles((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground ml-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleQaFileChange} />
            <div
              className="flex gap-2 items-end"
              onDrop={handleQaDrop}
              onDragOver={handleQaDragOver}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
                }}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder="Message..."
                rows={1}
                style={{ minHeight: "2.25rem", maxHeight: "128px", overflowY: "auto" }}
                className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                aria-label="Attach file"
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40"
              >
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <Button
                size="icon"
                disabled={isLoading || (!input.trim() && qaPendingFiles.length === 0)}
                onClick={() => sendMessage(input)}
                className="h-9 w-9 shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
