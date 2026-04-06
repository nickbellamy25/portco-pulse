import { NextRequest } from "next/server";
import { handleChatRequest } from "@/lib/chat/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handleChatRequest(req);
}
