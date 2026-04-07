import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  const firmId = (session?.user as any)?.firmId;
  if (!session?.user || !firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companies = db
    .select({ id: schema.companies.id, name: schema.companies.name })
    .from(schema.companies)
    .where(eq(schema.companies.firmId, firmId))
    .orderBy(asc(schema.companies.name))
    .all();

  return NextResponse.json(companies);
}
