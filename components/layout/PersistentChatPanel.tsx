"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, PanelRightClose, Loader2, Send } from "lucide-react";
import { ChatInterface } from "@/app/submit/[token]/_components/ChatInterface";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatContext } from "@/components/layout/chat-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type KpiMeta = { key: string; label: string; unit: string | null; valueType: string };

type InitialMsg = {
  role: "user" | "assistant";
  content: string;
  submittedPayload?: Record<string, unknown>;
  divider?: string;
};

type CompanyContext = {
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
};

type PortfolioContext = {
  kind: "portfolio";
};

type ChatContext = CompanyContext | PortfolioContext | null;

// ─── Portfolio Q&A pane ───────────────────────────────────────────────────────

interface QAEntry {
  question: string;
  answer: string;
  loading: boolean;
}

function PortfolioQAPane({ hintText }: { hintText: string }) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<QAEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = history.length > 0 && history[history.length - 1].loading;

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || isLoading) return;

    setInput("");
    setHistory((prev) => [...prev, { question: q, answer: "", loading: true }]);

    try {
      const res = await fetch("/api/chat/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setHistory((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { question: q, answer: err.message ?? "Something went wrong.", loading: false };
          return updated;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let answer = "";

      setHistory((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], loading: false };
        return updated;
      });

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let event: any;
            try { event = JSON.parse(jsonStr); } catch { continue; }

            if (event.type === "text") {
              answer += event.content;
              setHistory((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { question: q, answer, loading: false };
                return updated;
              });
              setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 20);
            }
            if (event.type === "error") {
              setHistory((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { question: q, answer: event.message ?? "Something went wrong.", loading: false };
                return updated;
              });
            }
          }
        }

        if (done) {
          if (sseBuffer.trim() && sseBuffer.startsWith("data: ")) {
            try {
              const event = JSON.parse(sseBuffer.slice(6).trim());
              if (event.type === "text") {
                answer += event.content;
                setHistory((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { question: q, answer, loading: false };
                  return updated;
                });
              }
            } catch { /* ignore */ }
          }
          break;
        }
      }
    } catch {
      setHistory((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], answer: "Connection error. Please try again.", loading: false };
        return updated;
      });
    }
  }, [isLoading]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground text-center pt-4">
            Ask anything about portfolio performance, trends, or plan vs. actual across all companies.
          </p>
        )}
        {history.map((entry, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-end">
              <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-xs">
                {entry.question}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[90%] px-3 py-2 rounded-2xl rounded-bl-md bg-muted text-foreground text-xs leading-relaxed">
                {entry.loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc pl-3 mb-1 space-y-0.5">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-3 mb-1 space-y-0.5">{children}</ol>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-1">
                          <table className="text-[11px] border-collapse w-full">{children}</table>
                        </div>
                      ),
                      th: ({ children }) => <th className="border border-border px-1.5 py-0.5 text-left font-medium bg-muted/60">{children}</th>,
                      td: ({ children }) => <td className="border border-border px-1.5 py-0.5">{children}</td>,
                    }}
                  >
                    {entry.answer}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border px-3 pt-2 pb-2">
        <p className="text-[11px] text-muted-foreground/70 mb-1.5 leading-snug">{hintText}</p>
        <div className="flex gap-1.5 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Ask about the portfolio…"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <Button
            size="icon"
            disabled={isLoading || !input.trim()}
            onClick={() => ask(input)}
            className="h-8 w-8 shrink-0"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface PersistentChatPanelProps {
  persona: "investor" | "operator" | "independent_operator";
  userCompanyId: string | null;
  firmId: string;
}

const PANEL_WIDTH = 360;

// ─── Outer shell — NO useSearchParams, never suspends, safe in layout ─────────

export function PersistentChatPanel({ persona, userCompanyId, firmId }: PersistentChatPanelProps) {
  const { chatOpen, toggleChat } = useChatContext();

  // When collapsed, render nothing — the topbar button is the only toggle
  if (!chatOpen) return null;

  // ── Expanded shell — useSearchParams lives inside the Suspense boundary ──────
  return (
    <div className="w-[360px] shrink-0 border-l border-border bg-white flex flex-col overflow-hidden">
      {/*
        Suspense boundary is INSIDE the panel, not in the layout.
        useSearchParams() in ChatPanelExpanded suspends only this subtree —
        the layout and navigation are never blocked.
      */}
      <Suspense fallback={
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Loading…</span>
          </div>
          <button onClick={toggleChat} className="text-muted-foreground hover:text-foreground transition-colors">
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      }>
        <ChatPanelExpanded
          persona={persona}
          userCompanyId={userCompanyId}
          firmId={firmId}
          onCollapse={toggleChat}
        />
      </Suspense>
    </div>
  );
}

// ─── Inner expanded component — safe to call useSearchParams here ─────────────

function ChatPanelExpanded({
  persona,
  userCompanyId,
  onCollapse,
}: {
  persona: PersistentChatPanelProps["persona"];
  userCompanyId: string | null;
  firmId: string;
  onCollapse: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams(); // safe — inside Suspense

  const [context, setContext] = useState<ChatContext>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const COMPANY_PARAM_PATHS = ["/analytics", "/admin/companies"];
  const companyIdFromUrl = COMPANY_PARAM_PATHS.includes(pathname) ? searchParams.get("company") : null;
  const targetCompanyId =
    persona === "operator" || persona === "independent_operator"
      ? userCompanyId
      : companyIdFromUrl;

  useEffect(() => {
    if (!targetCompanyId) {
      if (persona === "investor") {
        setContext({ kind: "portfolio" });
        setContextLoading(false);
      }
      return;
    }

    let cancelled = false;
    setContextLoading(true);

    fetch(`/api/chat/context?companyId=${targetCompanyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setContext(persona === "investor" ? { kind: "portfolio" } : null);
        } else {
          setContext({
            kind: "company",
            companyId: targetCompanyId,
            companyName: data.companyName,
            firmName: data.firmName,
            token: data.token,
            chatMode: data.chatMode,
            chatEndpoint: data.chatEndpoint,
            initialMessages: data.initialMessages ?? [],
            enabledKpis: data.enabledKpis ?? [],
            userId: data.userId,
            openingMessage: data.openingMessage,
          });
        }
        setContextLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setContext(persona === "investor" ? { kind: "portfolio" } : null);
          setContextLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [targetCompanyId, persona]);

  return (
    <>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {contextLoading ? (
            <span className="text-xs text-muted-foreground">Loading…</span>
          ) : context?.kind === "company" ? (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 truncate max-w-[220px]">
              {context.companyName}
            </span>
          ) : context?.kind === "portfolio" ? (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Portfolio
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Chat</span>
          )}
        </div>
        <button
          onClick={onCollapse}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Collapse chat"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        {contextLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : context?.kind === "company" ? (
          <CompanyChat
            context={context}
            hintText={
              persona === "operator" || persona === "independent_operator"
                ? "Submit your data or ask about your submissions and KPIs"
                : `Ask about ${context.companyName}'s submissions, KPIs, or plan vs actual`
            }
          />
        ) : context?.kind === "portfolio" ? (
          <PortfolioQAPane hintText="Ask about submissions, KPIs, trends, or plan vs actual across the portfolio" />
        ) : (
          <div className="flex items-center justify-center h-full px-4">
            <p className="text-xs text-muted-foreground text-center">
              Select a company to open their chat.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Company chat wrapper ─────────────────────────────────────────────────────

function CompanyChat({ context, hintText }: { context: CompanyContext; hintText: string }) {
  const initialMessages = context.initialMessages.length > 0
    ? context.initialMessages
    : [{ role: "assistant" as const, content: context.openingMessage }];

  return (
    <ChatInterface
      key={context.token}
      token={context.token}
      companyName={context.companyName}
      firmName={context.firmName}
      initialMessages={initialMessages as any}
      enabledKpis={context.enabledKpis}
      submittedByUserId={context.userId}
      mode={context.chatMode}
      chatEndpoint={context.chatEndpoint}
      hintText={hintText}
    />
  );
}
