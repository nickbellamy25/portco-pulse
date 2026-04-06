/**
 * Chat session utilities — session key derivation, history load/save.
 * All chat state is persisted in the chat_messages SQLite table.
 */

import { createHash } from "crypto";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export function deriveSessionKey(token: string, userId: string): string {
  return createHash("sha256").update(`${token}:${userId}`).digest("hex");
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string | object;
  contentType: "text" | "tool_call" | "tool_result";
}

export function loadHistory(sessionKey: string): StoredMessage[] {
  const rows = db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionKey, sessionKey))
    .orderBy(schema.chatMessages.createdAt)
    .all();

  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.contentType === "text" ? r.content : JSON.parse(r.content),
    contentType: r.contentType as "text" | "tool_call" | "tool_result",
  }));
}

export function saveMessage(
  sessionKey: string,
  companyId: string,
  role: "user" | "assistant",
  content: string | object,
  contentType: "text" | "tool_call" | "tool_result" = "text"
): void {
  const id = crypto.randomUUID();
  db.insert(schema.chatMessages).values({
    id,
    sessionKey,
    companyId,
    role,
    content: typeof content === "string" ? content : JSON.stringify(content),
    contentType,
    createdAt: new Date(),
  }).run();
}

/**
 * Build the Anthropic messages array from stored history + the new user message.
 * If there is no stored history, prepend the static opening question as the first
 * assistant turn so Claude knows what question the operator is responding to.
 */
export function buildAnthropicMessages(
  history: StoredMessage[],
  newUserContent: AnthropicContentBlock[],
  openingQuestion: string
): AnthropicMessage[] {
  const msgs: AnthropicMessage[] = [];

  // On a fresh session (no history) inject the opening question as the first
  // assistant message so Claude has full context for the operator's first reply.
  if (history.length === 0) {
    msgs.push({ role: "assistant", content: openingQuestion });
  }

  for (const h of history) {
    if (h.contentType === "text") {
      msgs.push({ role: h.role, content: h.content as string });
    } else if (h.contentType === "tool_call") {
      // assistant message with tool_use blocks
      const toolUseBlocks = h.content as any[];
      msgs.push({ role: "assistant", content: toolUseBlocks });
      // Anthropic requires a tool_result after every tool_use — add synthetic acks
      const toolResults = toolUseBlocks
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({ type: "tool_result", tool_use_id: b.id, content: "OK" }));
      if (toolResults.length > 0) {
        msgs.push({ role: "user", content: toolResults as any });
      }
    } else if (h.contentType === "tool_result") {
      // user message with a tool_result block
      msgs.push({ role: "user", content: h.content as any });
    }
  }

  msgs.push({ role: "user", content: newUserContent });
  return msgs;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
