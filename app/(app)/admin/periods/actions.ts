"use server";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function createPeriodAction(input: {
  firmId: string;
  periodStart: string;
  periodType: "monthly" | "quarterly";
  dueDate: string | null;
}) {
  const existing = db
    .select()
    .from(schema.periods)
    .where(
      and(
        eq(schema.periods.firmId, input.firmId),
        eq(schema.periods.periodStart, input.periodStart),
        eq(schema.periods.periodType, input.periodType)
      )
    )
    .get();

  if (existing) {
    throw new Error(`A ${input.periodType} period for ${input.periodStart} already exists.`);
  }

  db.insert(schema.periods).values({
    firmId: input.firmId,
    periodType: input.periodType,
    periodStart: input.periodStart,
    dueDate: input.dueDate,
    status: "open",
  }).run();
}
