/**
 * Dashboard Q&A endpoint — portfolio-scoped, firm-side users only.
 * Q&A only: no submission tools, no history, single-turn streaming.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildPortfolioDataSection, assemblePortfolioQASystemPrompt } from "@/lib/chat/system-prompt";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const session = await auth();
  const user = session?.user as any;

  if (!user || user.persona !== "investor") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const firm = db.select().from(schema.firms).where(eq(schema.firms.id, user.firmId)).get();
  const firmName = firm?.name ?? "your firm";

  const portfolioDataJson = buildPortfolioDataSection(user.firmId);
  const systemPrompt = assemblePortfolioQASystemPrompt(firmName, portfolioDataJson);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const claudeStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: "user", content: message }],
        });

        for await (const event of claudeStream) {
          if (event.type === "content_block_delta") {
            const delta = event.delta as any;
            if (delta.type === "text_delta") {
              send({ type: "text", content: delta.text });
            }
          }
        }

        send({ type: "done" });
      } catch (err: any) {
        console.error("[chat/qa] error:", err);
        send({ type: "error", message: err.message ?? "Something went wrong." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
