import { db } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";

export type NotificationEventType =
  | "submission_received"
  | "submission_voided"
  | "submission_reminder"
  | "rag_alert"
  | "threshold_alert"
  | "kpi_override"
  | "investor_note"
  | "monthly_digest"
  | "onboarding_request";

type CreateNotificationsParams = {
  firmId: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  companyId?: string;
  periodMonth?: string;
  linkUrl?: string;
  /** Target specific user IDs; defaults to all firm-level users (investors). */
  userIds?: string[];
};

export async function createInAppNotifications({
  firmId,
  eventType,
  title,
  body,
  companyId,
  periodMonth,
  linkUrl,
  userIds,
}: CreateNotificationsParams): Promise<void> {
  let targetUserIds: string[];

  if (userIds && userIds.length > 0) {
    targetUserIds = userIds;
  } else {
    // All investor-persona users for this firm (excludes operators)
    const firmUsers = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.firmId, firmId), ne(users.persona, "operator")))
      .all();
    targetUserIds = firmUsers
      .filter((u) => u.id)
      .map((u) => u.id);
  }

  if (targetUserIds.length === 0) return;

  const now = new Date().toISOString();
  const records = targetUserIds.map((userId) => ({
    id: crypto.randomUUID(),
    firmId,
    userId,
    eventType,
    title,
    body,
    linkUrl: linkUrl ?? null,
    companyId: companyId ?? null,
    periodMonth: periodMonth ?? null,
    isRead: false,
    createdAt: now,
  }));

  db.insert(notifications).values(records).run();
}

export function buildNotificationLink(
  eventType: NotificationEventType,
  companyId?: string,
  periodMonth?: string
): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  switch (eventType) {
    case "submission_received":
    case "submission_voided":
    case "rag_alert":
    case "threshold_alert":
    case "investor_note":
      if (companyId && periodMonth) {
        return `${base}/analytics?company=${companyId}&period=${periodMonth}&view=detail`;
      }
      if (companyId) return `${base}/analytics?company=${companyId}&view=detail`;
      return `${base}/analytics`;
    case "submission_reminder":
      return `${base}/submissions`;
    case "kpi_override":
      if (companyId) return `${base}/admin/companies?company=${companyId}&tab=kpis`;
      return `${base}/admin/companies`;
    case "monthly_digest":
      return `${base}/dashboard`;
    default:
      return `${base}/dashboard`;
  }
}
