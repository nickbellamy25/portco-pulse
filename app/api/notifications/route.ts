import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const items = db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50)
    .all();

  return NextResponse.json(items);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const body = await req.json();

  if (body.markAllRead) {
    db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId))
      .run();
  } else if (body.id) {
    db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, body.id), eq(notifications.userId, userId)))
      .run();
  }

  return NextResponse.json({ ok: true });
}
