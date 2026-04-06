"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, PanelRightClose, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatContext } from "@/components/layout/chat-context";
import { ChatInterface } from "@/app/submit/[token]/_components/ChatInterface";

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

  return (
    <div
      className="shrink-0 h-full border-l border-border flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out"
      style={{
        width: chatOpen ? "38vw" : "2.25rem",
        minWidth: chatOpen ? "300px" : undefined,
      }}
    >
      {/* Closed state — vertical clickable tab */}
      {!chatOpen && (
        <button
          type="button"
          onClick={toggleChat}
          className="flex flex-col items-center justify-center h-full w-full bg-white gap-2 hover:bg-gray-50 transition-colors"
          aria-label="Open chat panel"
        >
          <MessageSquare className="h-4 w-4 text-green-600" />
          <span
            className="text-xs font-medium tracking-widest text-green-600"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Ask AI
          </span>
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
}

function ChatPanelExpanded({
  persona,
  userCompanyId,
  onCollapse,
}: ChatPanelExpandedProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [ctx, setCtx] = useState<ChatCtx>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    // Skip if the target hasn't changed
    if (prevTargetRef.current === targetCompanyId) return;
    prevTargetRef.current = targetCompanyId;

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

  // Context badge
  const badge =
    ctx?.kind === "company" ? (
      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200 truncate max-w-[160px]">
        {ctx.companyName}
      </span>
    ) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {badge}
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

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : ctx === null ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Select a company to open their chat.
            </p>
          </div>
        ) : ctx.kind === "portfolio" ? (
          <PortfolioQAPane />
        ) : (
          <CompanyChat ctx={ctx} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompanyChat — wraps ChatInterface from the submission flow
// ---------------------------------------------------------------------------

function CompanyChat({ ctx }: { ctx: CompanyContext }) {
  // Use openingMessage as a synthetic first message when there's no history
  const initialMessages: InitialMsg[] =
    ctx.initialMessages && ctx.initialMessages.length > 0
      ? ctx.initialMessages
      : ctx.openingMessage
      ? [{ role: "assistant" as const, content: ctx.openingMessage }]
      : [];

  return (
    <ChatInterface
      token={ctx.token}
      companyName={ctx.companyName}
      firmName={ctx.firmName}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialMessages={initialMessages as any}
      enabledKpis={ctx.enabledKpis}
      submittedByUserId={ctx.userId}
      mode={ctx.chatMode}
      chatEndpoint={ctx.chatEndpoint}
    />
  );
}

// ---------------------------------------------------------------------------
// PortfolioQAPane — streaming Q&A for investors
// ---------------------------------------------------------------------------

interface QAMessage {
  role: "user" | "assistant";
  content: string;
}

function PortfolioQAPane() {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question || isLoading) return;

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
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground/70 text-center py-4">
            Ask a question about your portfolio.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] text-xs px-3 py-2 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md whitespace-pre-wrap"
                  : "bg-muted text-foreground rounded-2xl rounded-bl-md"
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

        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Ask about your portfolio…"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button
            size="icon"
            disabled={isLoading || !input.trim()}
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
      </div>
    </div>
  );
}
