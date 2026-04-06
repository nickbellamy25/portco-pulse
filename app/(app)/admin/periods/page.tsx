import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAllPeriods } from "@/lib/server/analytics";
import { PeriodsClient } from "./client";

export default async function PeriodsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user as any;
  if (user.persona === "operator") redirect("/dashboard");

  const periods = getAllPeriods(user.firmId);
  return <PeriodsClient periods={periods} firmId={user.firmId} />;
}
