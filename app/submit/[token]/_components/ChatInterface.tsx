"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileUploadZone } from "./FileUploadZone";
import { ConfirmationSummary } from "./ConfirmationSummary";
import type { UploadResult } from "@/app/api/upload/route";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type DataType = "actuals" | "plan";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  submittedPayload?: SubmissionPayload;  // inline confirmed submission card (read-only)
  pendingPayload?: SubmissionPayload;    // inline pending review card (interactive)
  docDetectionLine?: string;             // server-generated doc detection line prepended to assistant message
  divider?: string;                      // section label divider — renders as a horizontal rule with centered text
}

interface SubmissionPayload {
  submission_type: "periodic" | "plan";
  period?: string;
  fiscal_year?: number;
  kpis: Record<string, { value: number | null; operator_note?: string | null }>;
  overall_note?: string | null;
}

interface DocRecord {
  fileName: string;
  filePath: string;
  documentType: string;
  includedStatements?: string[];
}

interface Props {
  token: string;
  companyName: string;
  firmName: string;
  initialMessages?: ChatMessage[];
  initialSubmittedPayloads?: SubmissionPayload[];
  enabledKpis: Array<{ key: string; label: string; unit: string | null; valueType: string }>;
  submittedByUserId: string;
  mode?: "onboarding" | "periodic";
  chatEndpoint?: string;
  contextPeriod?: string;  // pre-filled period from URL param (e.g. reminder link with ?period=April 2026)
  hintText?: string;
  autoMessage?: string;
  promptChips?: string[];
}

export function ChatInterface({
  token,
  companyName,
  firmName,
  initialMessages = [],
  initialSubmittedPayloads = [],
  enabledKpis,
  submittedByUserId,
  mode = "periodic",
  chatEndpoint = "/api/chat/submit",
  contextPeriod,
  hintText,
  autoMessage,
  promptChips = [],
}: Props) {
  // Restore submitted cards after the text history (they happened at the end of the prior session)
  const restoredMessages: ChatMessage[] = [
    ...initialMessages,
    ...initialSubmittedPayloads.map((p) => ({ role: "assistant" as const, content: "", submittedPayload: p })),
  ];
  const [messages, setMessages] = useState<ChatMessage[]>(restoredMessages);
  const [input, setInput] = useState("");
  const [pendingUploads, setPendingUploads] = useState<UploadResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<SubmissionPayload | null>(null);
  const [sessionUploads, setSessionUploads] = useState<UploadResult[]>([]);
  const sessionUploadsRef = useRef<UploadResult[]>([]);
  const [pendingDocRecords, setPendingDocRecords] = useState<DocRecord[]>([]);
  // Maps period (YYYY-MM) or fiscal year string to submission ID, for void support
  const sessionSubmissionIds = useRef<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contextDataTypes, setContextDataTypes] = useState<Set<DataType>>(new Set());
  const [contextPeriods, setContextPeriods] = useState(contextPeriod ?? "");
  const [contextDismissed, setContextDismissed] = useState(initialMessages.length > 0);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoMessageSentRef = useRef(false);

  const sendMessage = useCallback(async (text: string, uploads: UploadResult[]) => {
    const userText = text.trim();
    if (!userText && uploads.length === 0) return;

    // Capture and dismiss context panel on first send
    const isFirstSend = !contextDismissed;
    const sendContextDataType = isFirstSend && contextDataTypes.size > 0
      ? (contextDataTypes.size === 2 ? "both" : [...contextDataTypes][0])
      : undefined;
    const sendContextPeriods = isFirstSend && contextPeriods.trim() ? contextPeriods.trim() : undefined;
    if (isFirstSend) setContextDismissed(true);

    // Add user message to UI (context is silent — not shown in chat)
    const displayText = [
      ...uploads.map((u) => `[Attached: ${u.fileName}]`),
      userText,
    ].filter(Boolean).join("\n");
    setMessages((prev) => [...prev, { role: "user", content: displayText }]);

    setInput("");
    // Accumulate uploads for document record tracking (ref stays current inside callbacks)
    if (uploads.length > 0) {
      sessionUploadsRef.current = [...sessionUploadsRef.current, ...uploads];
      setSessionUploads(sessionUploadsRef.current);
    }
    setPendingUploads([]);
    setQuickReplies([]);
    setIsLoading(true);

    try {
      const res = await fetch(chatEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          message: userText,
          uploads: uploads.length > 0 ? uploads : undefined,
          contextDataType: sendContextDataType ?? undefined,
          contextPeriods: sendContextPeriods,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Something went wrong: ${err.message ?? "Please try again."}` },
        ]);
        return;
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let sseBuffer = ""; // accumulate partial lines across chunks
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      function processSSELines(lines: string[]) {
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          let event: any;
          try { event = JSON.parse(jsonStr); } catch { continue; }

          if (event.type === "doc_detection" && event.line) {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], docDetectionLine: event.line };
              return updated;
            });
          }

          if (event.type === "text") {
            assistantText += event.content;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], role: "assistant", content: assistantText };
              return updated;
            });
          }

          if (event.type === "tool_call" && event.name === "submit_structured_data") {
            const p = event.payload as SubmissionPayload;
            setPendingPayload(p); // keep for backward compat (file upload zone hide)
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "", pendingPayload: p },
            ]);
          }

          if (event.type === "tool_call" && event.name === "record_document" && event.record?.fileName) {
            const rec = event.record as { fileName: string; documentType: string; includedStatements?: string[] };
            // Look up filePath from uploads sent in this turn (closure) or prior session uploads (via state updater)
            // sessionUploadsRef is always current (updated before the fetch); use it to look up filePath
            const matchedUpload = sessionUploadsRef.current.find((u) => u.fileName === rec.fileName);
            setPendingDocRecords((prev) => {
              const filePath = (matchedUpload as any)?.filePath ?? "";
              const without = prev.filter((r) => r.fileName !== rec.fileName);
              return [...without, { fileName: rec.fileName, filePath, documentType: rec.documentType, includedStatements: rec.includedStatements }];
            });
          }

          if (event.type === "quick_replies" && Array.isArray(event.replies)) {
            setQuickReplies(event.replies);
          }

          if (event.type === "onboarding_absorbed") {
            const periodLabel = formatPeriodLabel(event.period ?? "");
            const n = event.kpiCount ?? 0;
            const label = `Saved ${n} KPI${n !== 1 ? "s" : ""} for ${periodLabel}.`;
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: label },
            ]);
          }

          if (event.type === "tool_call" && event.name === "void_session_submission") {
            const key = event.period ?? (event.fiscalYear ? String(event.fiscalYear) : null);
            const subId = key ? sessionSubmissionIds.current[key] : null;
            if (subId) {
              // Fire-and-forget the void request; Claude will resubmit immediately after
              fetch("/api/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "void_submission", token, submissionId: subId, voidReason: event.reason ?? null }),
              }).then(() => {
                // Remove the voided card from messages
                setMessages((prev) => prev.filter((m) => {
                  if (!m.submittedPayload) return true;
                  const msgKey = m.submittedPayload.period ?? String(m.submittedPayload.fiscal_year ?? "");
                  return msgKey !== key;
                }));
                delete sessionSubmissionIds.current[key!];
              }).catch(() => {});
            }
          }

          if (event.type === "error") {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", content: "Something went wrong. Please try again." };
              return updated;
            });
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          sseBuffer += decoder.decode(value, { stream: true });
          // Process all complete newline-terminated lines; keep any partial remainder
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";
          processSSELines(lines);
        }

        if (done) {
          // Flush anything left in the buffer (final event with no trailing newline)
          if (sseBuffer.trim()) processSSELines([sseBuffer]);
          break;
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [token, contextDismissed, contextDataTypes, contextPeriods]);

  useEffect(() => {
    if (autoMessage && !autoMessageSentRef.current) {
      autoMessageSentRef.current = true;
      // Small delay so the component is fully mounted
      const t = setTimeout(() => sendMessage(autoMessage, []), 100);
      return () => clearTimeout(t);
    }
  }, [autoMessage, sendMessage]);

  async function handleConfirm(editedPayload: SubmissionPayload) {
    setIsSubmitting(true);
    const docRecordsToSend = pendingDocRecords;
    // Auto-detect doc records from session uploads that have a recognized type.
    // Explicit docRecords (Claude's record_document tool) take precedence; uploads fill the gap.
    const uploadedFiles = sessionUploadsRef.current
      .filter((u) => u.filePath)
      .map((u) => ({
        fileName: u.fileName,
        filePath: u.filePath!,
        documentType: u.detectedDocumentType ?? "financial_document",
        includedStatements: u.detectedIncludedStatements,
      }));
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "operator_confirmed",
          token,
          submissionType: editedPayload.submission_type,
          period: editedPayload.period ?? null,
          fiscalYear: editedPayload.fiscal_year ?? null,
          payload: editedPayload,
          submittedByUserId,
          docRecords: docRecordsToSend,
          uploadedFiles,
          missingKpis: enabledKpis
            .filter((k) => {
              const e = editedPayload.kpis[k.key];
              return !e || e.value === null || e.value === undefined;
            })
            .map((k) => k.key),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Track submission ID so it can be voided later if operator corrects an error
        const sessionKey = editedPayload.period ?? String(editedPayload.fiscal_year ?? "");
        if (sessionKey && data.id) sessionSubmissionIds.current[sessionKey] = data.id;
        setPendingPayload(null);
        setPendingDocRecords([]);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", submittedPayload: editedPayload },
          { role: "assistant", content: `Submitted to ${firmName}. If you have more data to submit, feel free to share it now.` },
        ]);
      } else {
        alert(data.message ?? "Submission failed. Please try again.");
      }
    } catch {
      alert("Connection error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input, pendingUploads);
    }
  }

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Optional context panel — shown on fresh periodic sessions until first send */}
        {mode === "periodic" && !contextDismissed && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-4 text-sm">
            {/* Row 1: data type */}
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">What data are you submitting?</span>
              <div className="flex gap-2">
                {(["Actuals", "Plan"] as const).map((label) => {
                  const value = label.toLowerCase() as DataType;
                  const selected = contextDataTypes.has(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setContextDataTypes((prev) => {
                        const next = new Set(prev);
                        next.has(value) ? next.delete(value) : next.add(value);
                        return next;
                      })}
                      className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-foreground border-border hover:border-primary/60"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row 2: period(s) */}
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">Which period(s) are you submitting for?</span>
              <input
                type="text"
                value={contextPeriods}
                onChange={(e) => setContextPeriods(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); textareaRef.current?.focus(); } }}
                placeholder="e.g. March 2025, or Q1 2025"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">Only data from periods you list will be collected.</span>
            </div>

          </div>
        )}

        {messages.map((msg, i) => {
          // Section divider — horizontal rule with centered label
          if (msg.divider) {
            return (
              <div key={i} className="flex items-center gap-3 py-1 select-none">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground/70 font-medium shrink-0 px-2 tracking-wide">
                  {msg.divider}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            );
          }

          // Inline confirmed submission card (read-only)
          if (msg.submittedPayload) {
            return (
              <div key={i} className="max-w-[90%]">
                <ConfirmationSummary
                  payload={msg.submittedPayload}
                  enabledKpis={enabledKpis}
                  onConfirm={() => {}}
                  isSubmitting={false}
                  isSubmitted
                />
              </div>
            );
          }

          // Inline pending review card (interactive)
          if (msg.pendingPayload) {
            return (
              <div key={i} className="max-w-[90%]">
                <ConfirmationSummary
                  payload={msg.pendingPayload}
                  enabledKpis={enabledKpis}
                  onConfirm={(edited) => {
                    // Swap pending card to confirmed card in-place, then submit
                    setMessages((prev) => prev.map((m, j) =>
                      j === i ? { role: "assistant", content: "", submittedPayload: edited } : m
                    ));
                    setPendingPayload(null);
                    handleConfirm(edited);
                  }}
                  onCancel={() => {
                    setMessages((prev) => prev.filter((_, j) => j !== i));
                    setPendingPayload(null);
                  }}
                  isSubmitting={isSubmitting}
                />
              </div>
            );
          }

          return (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={
                  msg.role === "user"
                    ? "max-w-[85%] px-4 py-2.5 rounded-2xl text-sm bg-primary text-primary-foreground rounded-br-md whitespace-pre-wrap"
                    : "w-full overflow-x-auto px-4 py-2.5 rounded-2xl text-sm bg-muted text-foreground rounded-bl-md"
                }
              >
                {msg.role === "assistant" ? (
                  <>
                    {msg.docDetectionLine && (
                      <p className="text-xs text-muted-foreground mb-2 pb-2 border-b border-border/40">
                        {msg.docDetectionLine}
                      </p>
                    )}
                    {msg.content ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          table: ({ children }) => <table className="text-xs border-collapse my-1 w-full">{children}</table>,
                          th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-medium bg-background/50">{children}</th>,
                          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : isLoading && i === messages.length - 1 ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : null}
                  </>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Prompt chips — passed from parent (e.g. CompanyChat) */}
      {promptChips.length > 0 && (
        <div className="px-4 pt-2 pb-1 flex flex-wrap gap-2">
          {promptChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => sendMessage(chip, [])}
              disabled={isLoading}
              className="px-2.5 py-1 rounded-full border border-border bg-background text-[11px] text-foreground hover:border-primary/60 hover:bg-muted transition-colors disabled:opacity-40"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Quick reply chips */}
      {quickReplies.length > 0 && !isLoading && !pendingPayload && (
        <div className="px-4 pt-2 pb-1 flex flex-wrap gap-2 border-t border-border">
          {quickReplies.map((reply, i) => (
            <button
              key={i}
              type="button"
              onClick={() => sendMessage(reply, [])}
              className="px-3 py-1.5 rounded-full border border-border bg-background text-sm text-foreground hover:border-primary/60 hover:bg-muted transition-colors"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {/* Input area — always visible */}
      <div className="border-t border-border px-4 pt-2 pb-3">
        <div className="flex flex-col gap-2">
          {!pendingPayload && (
            <FileUploadZone
              token={token}
              onUploadComplete={(results) => setPendingUploads((prev) => [...prev, ...results])}
              disabled={isLoading}
              pendingUploads={pendingUploads}
              onRemoveUpload={(i) => setPendingUploads((prev) => prev.filter((_, idx) => idx !== i))}
            />
          )}
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder="Message…"
                rows={2}
                className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <Button
                size="icon"
                disabled={isLoading || (!input.trim() && pendingUploads.length === 0)}
                onClick={() => sendMessage(input, pendingUploads)}
                className="h-10 w-10 shrink-0"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
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
