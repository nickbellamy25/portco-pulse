"use server";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";

export async function setPasswordAction(
  token: string,
  password: string
): Promise<{ success: true; email: string } | { success: false; error: string }> {
  const hashedToken = createHash("sha256").update(token).digest("hex");
  const user = db.select().from(schema.users).where(eq(schema.users.inviteToken, hashedToken)).get();

  if (!user) return { success: false, error: "This invitation link is invalid." };
  if (!user.inviteTokenExpiresAt || Date.now() > user.inviteTokenExpiresAt) {
    return { success: false, error: "This invitation link has expired." };
  }

  const { hashSync } = await import("bcryptjs");
  const passwordHash = hashSync(password, 10);

  db.update(schema.users)
    .set({ passwordHash, inviteToken: null, inviteTokenExpiresAt: null })
    .where(eq(schema.users.id, user.id))
    .run();

  return { success: true, email: user.email };
}
