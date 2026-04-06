import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCompanyByToken, getFirm } from "@/lib/server/analytics";
import { deriveSessionKey, loadHistory } from "@/lib/chat/session";
import { ChatInterface } from "./_components/ChatInterface";
import { auth } from "@/lib/auth";

const ONBOARDING_OPENING =
  "Hi — we'd like to collect your historical financial data to set up your company profile on the platform. Please share any financial statements, KPI reports, or other documents you have available, going back as far as possible. There's no strict format required — send what you have and we'll extract what we can. You can submit files in multiple batches over time.";

function formatPeriodLabel(period: string): string {
  if (!period || period.length < 7) return period;
  const [year, month] = period.split("-");
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const m = parseInt(month, 10);
  return `${monthNames[m - 1] ?? month} ${year}`;
}

export default async function SubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ period?: string }>;
}) {
  const { token } = await params;
  const sp = searchParams ? await searchParams : {};
  // period param from reminder links, e.g. "2026-04"
  const periodParam = sp.period;

  const session = await auth();
  if (!session) {
    redirect(`/login?callbackUrl=/submit/${token}`);
  }

  const company = getCompanyByToken(token);
  if (!company) notFound();

  // Mode is derived from company state, not the URL.
  // "pending" or "in_progress" means the onboarding data-collection flow is active.
  // "complete" (or null for companies not in the onboarding flow) uses periodic mode.
  const obStatus = (company as any).onboardingStatus as string | null;
  const chatMode: "onboarding" | "periodic" =
    obStatus === "pending" || obStatus === "in_progress" ? "onboarding" : "periodic";

  if ((company as any).status === "exited") {
    return (
      <div className="min-h-screen bg-muted/20 py-8 px-4 flex items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-semibold mb-2">Submission Link Inactive</h1>
          <p className="text-muted-foreground text-sm">
            This submission link is no longer active. {company.name} is marked as exited.
          </p>
        </div>
      </div>
    );
  }

  const firm = getFirm(company.firmId);
  const firmName = firm?.name ?? "your firm";

  // Load enabled KPIs for this company
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id)
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

  // Unified session key — same for all modes (periodic, onboarding, plan)
  const sessionKey = deriveSessionKey(token, session.user.id);
  const history = loadHistory(sessionKey);

  // Build full initial message list in chronological order, interleaving text messages
  // and submitted payload cards as they appear in history.
  type InitialMsg = {
    role: "user" | "assistant";
    content: string;
    submittedPayload?: Record<string, unknown>;
    divider?: string;
  };

  const allInitialMessages: InitialMsg[] = [];

  for (const h of history) {
    if (h.contentType === "text") {
      allInitialMessages.push({
        role: h.role as "user" | "assistant",
        content: h.content as string,
      });
    } else if (h.contentType === "tool_call") {
      const blocks = h.content as any[];
      for (const b of blocks) {
        if (b.type === "tool_use" && b.name === "submit_structured_data") {
          const payload = b.input?.payload ?? b.input;
          if (payload) {
            allInitialMessages.push({ role: "assistant", content: "", submittedPayload: payload });
          }
        }
      }
    }
  }

  // Inject context label divider + opening message for mode-specific entry points.
  // Divider only appears when there is prior history (marks the start of a new context).
  if (chatMode === "onboarding") {
    if (history.length > 0) {
      allInitialMessages.push({ role: "assistant", content: "", divider: "Historical Data Collection" });
    }
    allInitialMessages.push({ role: "assistant", content: ONBOARDING_OPENING });
  } else if (periodParam && history.length > 0) {
    // Reminder link with a specific period — add a divider so the new submission stands apart
    const label = `${formatPeriodLabel(periodParam)} Submission`;
    allInitialMessages.push({ role: "assistant", content: "", divider: label });
  }

  // Format the period param for the pre-filled context period input (human-readable)
  const contextPeriod = periodParam ? formatPeriodLabel(periodParam) : undefined;

  const headerSubtitle =
    chatMode === "onboarding" ? `Historical Data Collection · ${firmName}` : "Data Submission";

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-3 text-center">
        <h1 className="text-base font-semibold">{company.name}</h1>
        <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
      </div>

      {/* Chat — fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <ChatInterface
          token={token}
          companyName={company.name}
          firmName={firmName}
          initialMessages={allInitialMessages as any}
          enabledKpis={kpiDefs.map((d) => ({ key: d.key, label: d.label, unit: d.unit, valueType: d.valueType }))}
          submittedByUserId={session.user.id}
          mode={chatMode}
          chatEndpoint={chatMode === "onboarding" ? "/api/chat/onboard" : "/api/chat/submit"}
          contextPeriod={contextPeriod}
        />
      </div>
    </div>
  );
}
