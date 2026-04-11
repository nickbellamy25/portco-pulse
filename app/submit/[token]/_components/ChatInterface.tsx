"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Send, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileUploadZone, type FileUploadZoneHandle } from "./FileUploadZone";
import { ConfirmationSummary } from "./ConfirmationSummary";
import type { UploadResult } from "@/app/api/upload/route";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type DataType = "actuals" | "plan" | "onboarding";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  submittedPayload?: SubmissionPayload;  // inline confirmed submission card (read-only)
  pendingPayload?: SubmissionPayload;    // inline pending review card (interactive)
  canceledPayload?: SubmissionPayload;   // inline canceled card (read-only, gray badge)
  detectedDocuments?: string[];          // docs detected at time of submission (persisted on message)
  submissionVersion?: number;            // version number from API response after confirm
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
  companyId?: string;
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
  autoUploads?: UploadResult[];
  promptChips?: string[];
  fixedChip?: string;
  compact?: boolean;
  requiredDocs?: string;
  requiredDocCadences?: string;
  onMessagesChange?: (msgs: ChatMessage[]) => void;
  onChipIntercept?: (chip: string) => boolean;
  onEditCompanySwitch?: (companyId: string) => void;
}

export function ChatInterface({
  token,
  companyId,
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
  autoUploads,
  promptChips = [],
  fixedChip,
  compact = false,
  requiredDocs,
  requiredDocCadences,
  onMessagesChange,
  onChipIntercept,
  onEditCompanySwitch,
}: Props) {
  // Restore submitted cards after the text history (they happened at the end of the prior session)
  const restoredMessages: ChatMessage[] = [
    ...initialMessages,
    ...initialSubmittedPayloads.map((p) => ({ role: "assistant" as const, content: "", submittedPayload: p })),
  ];
  const [messages, setMessages] = useState<ChatMessage[]>(restoredMessages);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const [input, setInput] = useState("");
  const [pendingUploads, setPendingUploads] = useState<UploadResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<SubmissionPayload | null>(null);
  const [sessionUploads, setSessionUploads] = useState<UploadResult[]>([]);
  const sessionUploadsRef = useRef<UploadResult[]>([]);
  const [pendingDocRecords, setPendingDocRecords] = useState<DocRecord[]>([]);
  // Maps period (YYYY-MM) or fiscal year string to submission ID, for void support
  const sessionSubmissionIds = useRef<Record<string, string>>({});
  // CompanyId/name override from load_submission_for_edit (for Q&A mode edits)
  const editCompanyIdRef = useRef<string | null>(null);
  const editCompanyNameRef = useRef<string | null>(null);
  const editEnabledKpisRef = useRef<Array<{ key: string; label: string; unit: string | null; valueType: string }>>([]);
  const editUserIdRef = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contextDataTypes, setContextDataTypes] = useState<Set<DataType>>(new Set());
  const [contextPeriods, setContextPeriods] = useState(contextPeriod ?? "");
  const [contextDismissed, setContextDismissed] = useState(initialMessages.length > 0 || !!autoMessage);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);
  const [detectedDocs, setDetectedDocs] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoMessageSentRef = useRef(false);
  const [usedPromptChips, setUsedPromptChips] = useState<Set<string>>(new Set());
  const fileUploadRef = useRef<FileUploadZoneHandle>(null);

  const sendMessage = useCallback(async (text: string, uploads: UploadResult[]) => {
    const userText = text.trim();
    if (!userText && uploads.length === 0) return;

    // Capture and dismiss context panel on first send
    const isFirstSend = !contextDismissed;
    const sendContextDataType = isFirstSend && contextDataTypes.size > 0
      ? [...contextDataTypes].join(",")
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
      // Extract detected document types from uploads
      const docs = uploads.flatMap(u => {
        if (u.detectedIncludedStatements) return u.detectedIncludedStatements;
        if (u.detectedDocumentType && u.detectedDocumentType !== 'financial_document') return [u.detectedDocumentType];
        return [];
      });
      if (docs.length > 0) setDetectedDocs(prev => [...new Set([...prev, ...docs])]);
    }
    setPendingUploads([]);
    setQuickReplies([]);
    setIsLoading(true);

    try {
      const res = await fetch(chatEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...((companyId || editCompanyIdRef.current) ? { companyId: companyId || editCompanyIdRef.current } : { token }),
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
            setMessages((prev) => {
              // If the last message is an empty assistant placeholder (from streaming setup),
              // replace it with the card instead of appending a new message
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && !last.content && !last.pendingPayload && !last.submittedPayload) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, pendingPayload: p };
                return updated;
              }
              return [...prev, { role: "assistant", content: "", pendingPayload: p }];
            });
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
            // Also update detectedDocs so the confirmation card shows detected documents
            const docTypes = rec.includedStatements && rec.includedStatements.length > 0
              ? rec.includedStatements
              : rec.documentType && rec.documentType !== "financial_document" ? [rec.documentType] : [];
            if (docTypes.length > 0) setDetectedDocs(prev => [...new Set([...prev, ...docTypes])]);
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
                body: JSON.stringify({ action: "void_submission", ...((companyId || editCompanyIdRef.current) ? { companyId: companyId || editCompanyIdRef.current } : { token }), submissionId: subId, voidReason: event.reason ?? null }),
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

          if (event.type === "show_last_card") {
            setMessages((prev) => {
              const lastSubmitted = [...prev].reverse().find((m) => m.submittedPayload);
              if (lastSubmitted) {
                return [...prev, {
                  role: "assistant" as const,
                  content: "",
                  submittedPayload: lastSubmitted.submittedPayload,
                  detectedDocuments: lastSubmitted.detectedDocuments,
                }];
              }
              return prev;
            });
          }

          if (event.type === "tool_call" && event.name === "load_submission_for_edit") {
            const p = event.payload as SubmissionPayload;
            const editVersion = (event as any).currentVersion as number;
            // Store companyId/name for Q&A mode edits (so handleConfirm can use it)
            if ((event as any).companyId) {
              editCompanyIdRef.current = (event as any).companyId;
              editCompanyNameRef.current = (event as any).companyName ?? null;
            }
            if (Array.isArray((event as any).enabledKpis)) {
              editEnabledKpisRef.current = (event as any).enabledKpis;
            }
            if ((event as any).userId) {
              editUserIdRef.current = (event as any).userId;
            }
            if (Array.isArray((event as any).detectedDocuments) && (event as any).detectedDocuments.length > 0) {
              setDetectedDocs((event as any).detectedDocuments);
            }
            setMessages((prev) => {
              // Replace the empty assistant placeholder or append
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && !last.content.trim() && !last.pendingPayload && !last.submittedPayload) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...last,
                  pendingPayload: p,
                  detectedDocuments: (event as any).detectedDocuments ?? [],
                  submissionVersion: editVersion,
                };
                return updated;
              }
              return [...prev, {
                role: "assistant" as const,
                content: "",
                pendingPayload: p,
                detectedDocuments: (event as any).detectedDocuments ?? [],
                submissionVersion: editVersion,
              }];
            });
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
  }, [token, companyId, contextDismissed, contextDataTypes, contextPeriods]);

  // Scroll to bottom on mount if there are initial messages
  useEffect(() => {
    if (initialMessages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref to always call the latest sendMessage without re-triggering the effect
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (autoMessage && !autoMessageSentRef.current) {
      const uploads = autoUploads ?? [];
      // Extract detected docs from auto uploads
      const docs = uploads.flatMap(u => {
        if (u.detectedIncludedStatements) return u.detectedIncludedStatements;
        if (u.detectedDocumentType && u.detectedDocumentType !== 'financial_document') return [u.detectedDocumentType];
        return [];
      });
      if (docs.length > 0) setDetectedDocs(prev => [...new Set([...prev, ...docs])]);
      // Small delay so the component is fully mounted
      // Set ref INSIDE timeout so StrictMode cleanup doesn't block retry
      const t = setTimeout(() => {
        autoMessageSentRef.current = true;
        sendMessageRef.current(autoMessage, uploads);
      }, 100);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMessage, autoUploads]);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  async function handleConfirm(editedPayload: SubmissionPayload, messageIndex?: number) {
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
          ...((companyId || editCompanyIdRef.current) ? { companyId: companyId || editCompanyIdRef.current } : { token }),
          submissionType: editedPayload.submission_type,
          period: editedPayload.period ?? null,
          fiscalYear: editedPayload.fiscal_year ?? null,
          payload: editedPayload,
          submittedByUserId: submittedByUserId || editUserIdRef.current || null,
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
        // Atomically swap the pending card to a submitted card (no separate success message)
        setMessages((prev) =>
          messageIndex !== undefined
            ? prev.map((m, j) => j === messageIndex ? { role: "assistant" as const, content: "", submittedPayload: editedPayload, detectedDocuments: detectedDocs, submissionVersion: data.version } : m)
            : prev
        );
      } else {
        alert(data.message ?? data.error ?? "Submission failed. Please try again.");
      }
    } catch (err) {
      console.error("[ChatInterface] submission error:", err);
      alert("Connection error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEdit(messageIndex: number) {
    setMessages((prev) =>
      prev.map((m, j) =>
        j === messageIndex
          ? { role: "assistant" as const, content: "", pendingPayload: m.submittedPayload, detectedDocuments: m.detectedDocuments }
          : m
      )
    );
    // Restore detectedDocs state from the message being edited
    const msg = messages[messageIndex];
    if (msg?.detectedDocuments) {
      setDetectedDocs(msg.detectedDocuments);
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
        {!contextDismissed && companyId && (
          <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-3 text-xs">
            {/* Row 1: data type */}
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">What data are you submitting?</span>
              <div className="flex gap-1.5">
                {(["Actuals", "Plan", "Onboarding"] as const).map((label) => {
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
                      className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
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
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">Which period(s) are you submitting for?</span>
              <input
                type="text"
                value={contextPeriods}
                onChange={(e) => setContextPeriods(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); textareaRef.current?.focus(); } }}
                placeholder="e.g. March 2025, or Q1 2025"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-[10px] text-muted-foreground">{contextDataTypes.has("onboarding") ? "List the range of historical periods, e.g. Jan 2023 – Dec 2025." : "Only data from periods you list will be collected."}</span>
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
                  enabledKpis={enabledKpis.length > 0 ? enabledKpis : editEnabledKpisRef.current}
                  companyName={editCompanyNameRef.current || companyName}
                  onConfirm={(edited) => handleConfirm(edited, i)}
                  isSubmitting={isSubmitting}
                  isSubmitted
                  detectedDocuments={msg.detectedDocuments ?? detectedDocs}
                  compact={compact}
                  requiredDocs={requiredDocs}
                  requiredDocCadences={requiredDocCadences}
                  submissionPeriod={msg.submittedPayload.period}
                  onEdit={msg.submissionVersion ? () => handleEdit(i) : undefined}
                  versionNumber={msg.submissionVersion}
                />
              </div>
            );
          }

          // Inline canceled card (read-only, gray badge)
          if (msg.canceledPayload) {
            return (
              <div key={i} className="max-w-[90%]">
                <ConfirmationSummary
                  payload={msg.canceledPayload}
                  enabledKpis={enabledKpis.length > 0 ? enabledKpis : editEnabledKpisRef.current}
                  companyName={editCompanyNameRef.current || companyName}
                  onConfirm={() => {}}
                  isSubmitting={false}
                  isCanceled
                  detectedDocuments={msg.detectedDocuments ?? detectedDocs}
                  compact={compact}
                  requiredDocs={requiredDocs}
                  requiredDocCadences={requiredDocCadences}
                  submissionPeriod={msg.canceledPayload.period}
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
                  enabledKpis={enabledKpis.length > 0 ? enabledKpis : editEnabledKpisRef.current}
                  companyName={editCompanyNameRef.current || companyName}
                  detectedDocuments={detectedDocs}
                  compact={compact}
                  requiredDocs={requiredDocs}
                  requiredDocCadences={requiredDocCadences}
                  submissionPeriod={msg.pendingPayload.period}
                  versionNumber={msg.submissionVersion}
                  onToggleDoc={(docKey) => {
                    setDetectedDocs((prev) =>
                      prev.includes(docKey)
                        ? prev.filter((d) => d !== docKey)
                        : [...prev, docKey]
                    );
                  }}
                  onConfirm={(edited) => {
                    setPendingPayload(null);
                    handleConfirm(edited, i);
                  }}
                  onCancel={() => {
                    setMessages((prev) =>
                      prev.map((m, j) =>
                        j === i
                          ? { role: "assistant" as const, content: "", canceledPayload: m.pendingPayload }
                          : m
                      )
                    );
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
                    ? `max-w-[85%] rounded-2xl rounded-br-md whitespace-pre-wrap bg-primary text-primary-foreground ${compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm"}`
                    : `w-full overflow-x-auto rounded-2xl rounded-bl-md bg-muted text-foreground ${compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm"}`
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

      {/* Prompt chips + quick replies + input: single border-t above whichever comes first */}
      {(() => {
        // Suppress prompt chips while autoMessage is pending OR once the user has engaged in conversation
        // (sent a message and received a response — chips are conversation starters only)
        const autoMessagePending = !!autoMessage && !autoMessageSentRef.current;
        const lastSubmittedIndex = messages.findLastIndex(m => m.submittedPayload);
        const lastUserIndex = messages.findLastIndex(m => m.role === "user");
        const hasActiveConversation = lastUserIndex > lastSubmittedIndex;
        const showPromptChips = quickReplies.length === 0 && !autoMessagePending && !hasActiveConversation;
        const poolLimit = fixedChip ? 2 : 3;
        const visiblePromptChips = showPromptChips
          ? promptChips.filter((c) => !usedPromptChips.has(c)).slice(0, poolLimit)
          : [];
        const hasPromptChips = visiblePromptChips.length > 0 || (fixedChip && showPromptChips);
        const hasQuickReplies = quickReplies.length > 0 && !isLoading && !pendingPayload;
        const chipsAboveInput = hasPromptChips || hasQuickReplies;

        return (
          <>
            {hasPromptChips && (
              <div className="px-4 pt-2 pb-1 flex flex-wrap gap-2 border-t border-border">
                {visiblePromptChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      if (onChipIntercept?.(chip)) return;
                      setUsedPromptChips((prev) => new Set([...prev, chip]));
                      sendMessage(chip, []);
                    }}
                    disabled={isLoading}
                    className="px-2.5 py-1 rounded-full border border-border bg-background text-[11px] text-left text-foreground hover:border-primary/60 hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    {chip}
                  </button>
                ))}
                {fixedChip && (
                  <button
                    key={fixedChip}
                    type="button"
                    onClick={() => { if (onChipIntercept?.(fixedChip)) return; sendMessage(fixedChip, []); }}
                    disabled={isLoading}
                    className="px-2.5 py-1 rounded-full border border-border bg-background text-[11px] text-left text-foreground hover:border-primary/60 hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    {fixedChip}
                  </button>
                )}
              </div>
            )}

            {hasQuickReplies && (
              <div className="px-4 pt-2 pb-1 flex flex-wrap gap-2 border-t border-border">
                {quickReplies.map((reply, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => sendMessage(reply, [])}
                    className={`px-3 py-1.5 rounded-full border border-border bg-background text-foreground hover:border-primary/60 hover:bg-muted transition-colors ${compact ? "text-xs" : "text-sm"}`}
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}
          </>
        );
      })()}

      {/* Input area — always visible */}
      {(() => {
        const poolLimit = fixedChip ? 2 : 3;
        const hasChips = (quickReplies.length === 0 && (promptChips.filter((c) => !usedPromptChips.has(c)).length > 0 || fixedChip))
          || (quickReplies.length > 0 && !isLoading && !pendingPayload);
        return (
      <div
        className={`${hasChips ? "" : "border-t border-border"} px-4 pt-2 pb-3`}
        onDrop={(e) => {
          e.preventDefault();
          dragCounter.current = 0;
          setIsDraggingOver(false);
          if (e.dataTransfer.files.length > 0 && !pendingPayload && (token || companyId)) {
            fileUploadRef.current?.handleFiles(e.dataTransfer.files);
          }
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsDraggingOver(true); }}
        onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDraggingOver(false); } }}
      >
        <div className="flex flex-col gap-2">
          {!pendingPayload && (token || companyId) && (
            <FileUploadZone
              ref={fileUploadRef}
              token={token}
              companyId={companyId}
              onUploadComplete={(results) => setPendingUploads((prev) => [...prev, ...results])}
              disabled={isLoading}
              pendingUploads={pendingUploads}
              onRemoveUpload={(i) => setPendingUploads((prev) => prev.filter((_, idx) => idx !== i))}
              compact
            />
          )}
          <div className="flex gap-2 items-end">
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
              placeholder="Message…"
              rows={1}
              style={{ minHeight: "2.5rem", maxHeight: "128px", overflowY: "auto" }}
              className={`flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${compact ? "text-xs" : "text-sm"} ${isDraggingOver ? "ring-2 ring-primary border-primary" : ""}`}
            />
            {!pendingPayload && (token || companyId) && (
              <button
                type="button"
                onClick={() => fileUploadRef.current?.triggerOpen()}
                disabled={isLoading}
                aria-label="Attach file"
                className="h-10 w-10 shrink-0 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40"
              >
                <Paperclip className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
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
        );
      })()}
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
