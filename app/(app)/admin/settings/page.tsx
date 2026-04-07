import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { emailSettings, kpiDefinitions, users, companies, userAccessScopes, firms } from "@/lib/db/schema";
import { eq, isNull, and, inArray } from "drizzle-orm";
import { getCompanyFilterOptions } from "@/lib/server/analytics";
import { SettingsClient } from "./client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user as any;

  const settings = db
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.firmId, user.firmId))
    .get() ?? null;

  const kpiDefs = db
    .select()
    .from(kpiDefinitions)
    .where(
      and(
        eq(kpiDefinitions.firmId, user.firmId),
        isNull(kpiDefinitions.companyId),
        eq(kpiDefinitions.active, true)
      )
    )
    .orderBy(kpiDefinitions.section, kpiDefinitions.displayOrder)
    .all();

  const firmUsers = db
    .select()
    .from(users)
    .where(
      and(
        eq(users.firmId, user.firmId),
        inArray(users.role, ["firm_admin", "firm_member"])
      )
    )
    .all();

  const allCompanies = db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.firmId, user.firmId))
    .orderBy(companies.name)
    .all();

  const userScopes = db
    .select()
    .from(userAccessScopes)
    .where(eq(userAccessScopes.firmId, user.firmId))
    .all();

  const filterOptions = getCompanyFilterOptions(user.firmId);

  const firm = db.select({ name: firms.name }).from(firms).where(eq(firms.id, user.firmId)).get();

  return (
    <SettingsClient
      firmId={user.firmId}
      currentUserId={user.id}
      settings={settings}
      kpiDefs={kpiDefs}
      firmUsers={firmUsers}
      allCompanies={allCompanies}
      userScopes={userScopes}
      funds={filterOptions.funds}
      industries={filterOptions.industries}
      firmName={firm?.name ?? ""}
    />
  );
}
