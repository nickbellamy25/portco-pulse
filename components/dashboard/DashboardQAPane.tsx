"use client";

import { useRef, useState, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface QAEntry {
  question: string;
  answer: string;
  loading: boolean;
}

export function DashboardQAPane() {
  const [input, setInput] = useState("");
  const [entry, setEntry] = useState<QAEntry | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;

    setInput("");
    setEntry({ question: q, answer: "", loading: true });

    try {
      const res = await fetch("/api/chat/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setEntry({ question: q, answer: err.message ?? "Something went wrong.", loading: false });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let answer = "";

      setEntry((prev) => prev ? { ...prev, loading: false } : null);

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
              setEntry({ question: q, answer, loading: false });
              setTimeout(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 20);
            }

            if (event.type === "error") {
              setEntry({ question: q, answer: event.message ?? "Something went wrong.", loading: false });
            }
          }
        }

        if (done) {
          if (sseBuffer.trim()) {
            // flush
            const line = sseBuffer;
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6).trim());
                if (event.type === "text") {
                  answer += event.content;
                  setEntry({ question: q, answer, loading: false });
                }
              } catch { /* ignore */ }
            }
          }
          break;
        }
      }
    } catch {
      setEntry((prev) => prev ? { ...prev, answer: "Connection error. Please try again.", loading: false } : null);
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  }

  const isLoading = entry?.loading ?? false;

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="font-semibold text-base mb-4">Ask a question</h2>

      {/* Answer area */}
      {entry && (
        <div className="mb-4 space-y-3">
          <p className="text-sm font-medium text-foreground">{entry.question}</p>
          <div className="text-sm text-foreground leading-relaxed min-h-[2rem]">
            {entry.loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="text-xs border-collapse w-full">{children}</table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-border px-2 py-1 text-left font-medium bg-muted/50">{children}</th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-border px-2 py-1">{children}</td>
                  ),
                }}
              >
                {entry.answer}
              </ReactMarkdown>
            )}
          </div>
          <div ref={answerRef} />
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="Ask about portfolio performance, trends, plan vs actual…"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button
          size="icon"
          disabled={isLoading || !input.trim()}
          onClick={() => ask(input)}
          className="h-10 w-10 shrink-0"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
