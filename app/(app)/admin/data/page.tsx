import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { submissions, companies, periods, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default async function DataManagementPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user as any;
  if (user.persona === "operator") redirect("/dashboard");

  const allSubmissions = db
    .select()
    .from(submissions)
    .where(eq(submissions.firmId, user.firmId))
    .orderBy(desc(submissions.lastUpdatedAt))
    .all();

  const allCompanies = db
    .select()
    .from(companies)
    .where(eq(companies.firmId, user.firmId))
    .all();

  const allPeriods = db
    .select()
    .from(periods)
    .where(eq(periods.firmId, user.firmId))
    .all();

  const companyById = Object.fromEntries(allCompanies.map((c) => [c.id, c]));
  const periodById = Object.fromEntries(allPeriods.map((p) => [p.id, p]));

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Data Management</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review and manage all submissions
        </p>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Period</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last Updated</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Submitted At</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allSubmissions.map((sub) => {
                const company = companyById[sub.companyId];
                const period = periodById[sub.periodId];
                return (
                  <tr key={sub.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{company?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {period ? format(new Date(period.periodStart + "T12:00:00"), "MMM yyyy") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          sub.status === "submitted"
                            ? "bg-green-100 text-green-700 border-green-200"
                            : "bg-yellow-100 text-yellow-700 border-yellow-200"
                        }
                      >
                        {sub.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {sub.lastUpdatedAt
                        ? format(new Date(sub.lastUpdatedAt), "MM/dd/yyyy HH:mm")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {sub.submittedAt
                        ? format(new Date(sub.submittedAt), "MM/dd/yyyy HH:mm")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/analytics?company=${sub.companyId}`}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        View Analytics
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
