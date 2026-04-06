import { Resend } from "resend";
import type { EmailSettings } from "@/lib/db/schema";
import { createInAppNotifications, buildNotificationLink } from "./notify";

const _resendClient = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/**
 * Thin wrapper around the Resend SDK that checks the returned `{ data, error }`
 * result and throws on failure. Resend SDK v2+ returns errors instead of throwing,
 * so without this check every API error silently succeeds from JavaScript's perspective.
 */
const resend = _resendClient
  ? {
      emails: {
        send: async (params: Parameters<InstanceType<typeof Resend>["emails"]["send"]>[0]) => {
          const result = await _resendClient.emails.send(params as any);
          if (result.error) {
            const to = Array.isArray(params.to) ? params.to.join(", ") : params.to;
            console.error(`[EMAIL] Resend API error sending to ${to}:`, result.error);
            throw new Error((result.error as any).message ?? "Resend API error");
          }
          const to = Array.isArray(params.to) ? params.to.join(", ") : params.to;
          console.log(`[EMAIL] Sent to: ${to} | id: ${result.data?.id}`);
          return result;
        },
      },
    }
  : null;

type ReminderEmailParams = {
  to: string[];
  companyName: string;
  period: string; // "2026-02"
  dueDate: string;
  submissionLink: string;
  missingDocs: string[];
  settings: EmailSettings | null;
  firmId?: string;
  companyId?: string;
  operatorUserIds?: string[];
};

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

type SubmissionNotificationParams = {
  to: string[];
  companyName: string;
  period: string;
  submissionTime: string;
  isResubmission: boolean;
  settings: EmailSettings | null;
  firmId?: string;
  companyId?: string;
};

export async function sendSubmissionNotificationEmail(params: SubmissionNotificationParams) {
  const { to, companyName, period, submissionTime, isResubmission, settings, firmId, companyId } = params;
  if (!to.length) return;
  if (!settings?.submissionNotificationEnabled && !(settings as any)?.submissionNotificationInAppEnabled) return;

  const vars = {
    company_name: companyName,
    period,
    submitted_by: "Submitter",
    submission_time: submissionTime,
    revenue: "—", ebitda: "—", ocf: "—", gross_margin: "—", cash: "—",
    dashboard_link: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/submissions`,
  };

  const defaultSubject = isResubmission
    ? `Re-Submission Received - {{company_name}}`
    : `New Submission Received - {{company_name}}`;

  const subject = interpolate(settings?.submissionNotificationSubject ?? defaultSubject, vars);
  const body = interpolate(
    settings?.submissionNotificationBody ??
      `A${isResubmission ? " revised" : " new"} submission has been received from {{company_name}}.\n\nPeriod: {{period}}\nSubmission time: {{submission_time}}\n\nView details: {{dashboard_link}}`,
    vars
  );

  if (settings?.submissionNotificationEnabled) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && (settings as any)?.submissionNotificationInAppEnabled) {
    const link = buildNotificationLink("submission_received", companyId, period);
    await createInAppNotifications({
      firmId,
      eventType: "submission_received",
      title: subject,
      body: `${companyName} submitted data for ${period}.`,
      companyId,
      periodMonth: period,
      linkUrl: link,
    });
  }
}

type SubmissionVoidedParams = {
  to: string[];
  companyName: string;
  submissionType: string;
  periodLabel: string;
  voidedDate: string;
  voidReason?: string;
  settings: EmailSettings | null;
  firmId?: string;
  companyId?: string;
};

export async function sendSubmissionVoidedEmail(params: SubmissionVoidedParams) {
  const { to, companyName, submissionType, periodLabel, voidedDate, voidReason, settings, firmId, companyId } = params;
  if (!to.length) return;
  if (!(settings as any)?.submissionVoidedEnabled && !(settings as any)?.submissionVoidedInAppEnabled) return;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const vars: Record<string, string> = {
    company_name: companyName,
    submission_type: submissionType,
    voided_date: voidedDate,
    void_reason: voidReason ?? "",
    company_page_link: companyId ? `${base}/analytics?company=${companyId}` : `${base}/dashboard`,
  };

  const subject = interpolate(
    (settings as any)?.submissionVoidedSubject ?? "Submission Voided — {{company_name}}",
    vars
  );
  let bodyTemplate =
    (settings as any)?.submissionVoidedBody ??
    `The {{submission_type}} from {{company_name}} has been voided.\n\nVoided on: {{voided_date}}\nReason: {{void_reason}}\n\nView company page: {{company_page_link}}`;
  if (!voidReason) {
    bodyTemplate = bodyTemplate.replace(/\n.*\{\{void_reason\}\}.*/g, "");
  }
  const body = interpolate(bodyTemplate, vars);

  if ((settings as any)?.submissionVoidedEnabled) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL - submission voided] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && (settings as any)?.submissionVoidedInAppEnabled) {
    const link = buildNotificationLink("submission_voided", companyId, periodLabel);
    await createInAppNotifications({
      firmId,
      eventType: "submission_voided",
      title: subject,
      body: `${companyName}'s ${submissionType} was voided.`,
      companyId,
      periodMonth: periodLabel,
      linkUrl: link,
    });
  }
}

type KpiOverrideParams = {
  to: string[];
  companyName: string;
  kpiLabel: string;
  overrideSummary: string; // e.g. "Alert on At Risk: No, Alert on Off Track: Yes"
  settings: EmailSettings | null;
  firmId?: string;
  companyId?: string;
};

export async function sendKpiOverrideEmail(params: KpiOverrideParams) {
  const { to, companyName, kpiLabel, overrideSummary, settings, firmId, companyId } = params;
  if (!to.length) return;
  if (!(settings as any)?.kpiOverrideNotificationEnabled && !(settings as any)?.kpiOverrideNotificationInAppEnabled) return;

  const vars: Record<string, string> = {
    company_name: companyName,
    kpi_label: kpiLabel,
    override_summary: overrideSummary,
    dashboard_link: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/admin/companies`,
  };

  const defaultSubject = `KPI Override — {{company_name}}: {{kpi_label}}`;
  const defaultBody = `A company-level KPI override has been saved for {{company_name}}.\n\nKPI: {{kpi_label}}\nOverride: {{override_summary}}\n\nThis setting will take precedence over the firm-wide default for this company.\n\nView in PortCo Pulse: {{dashboard_link}}`;

  const subject = interpolate((settings as any)?.kpiOverrideNotificationSubject ?? defaultSubject, vars);
  const body = interpolate((settings as any)?.kpiOverrideNotificationBody ?? defaultBody, vars);

  if ((settings as any)?.kpiOverrideNotificationEnabled) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL - kpi override] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && (settings as any)?.kpiOverrideNotificationInAppEnabled) {
    const link = buildNotificationLink("kpi_override", companyId);
    await createInAppNotifications({
      firmId,
      eventType: "kpi_override",
      title: `KPI Override — ${companyName}: ${kpiLabel}`,
      body: `Company-level override saved for ${kpiLabel} at ${companyName}.`,
      companyId,
      linkUrl: link,
    });
  }
}

type ThresholdBreachParams = {
  to: string[];
  companyName: string;
  kpiLabel: string;
  actual: string;
  thresholdValue: string;
  ruleType: string;
  severity: string;
  period: string;
  settings: EmailSettings | null;
  firmId?: string;
  companyId?: string;
};

export async function sendThresholdBreachEmail(params: ThresholdBreachParams) {
  const { to, companyName, kpiLabel, actual, thresholdValue, ruleType, severity, period, settings, firmId, companyId } = params;
  if (!to.length) return;
  if (!settings?.thresholdAlertEnabled && !(settings as any)?.thresholdAlertInAppEnabled) return;

  const ruleLabels: Record<string, string> = { lt: "<", lte: "≤", gt: ">", gte: "≥" };
  const vars = {
    company_name: companyName,
    metric_name: kpiLabel,
    value: actual,
    threshold_value: thresholdValue,
    period,
    submission_date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    severity,
    dashboard_link: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };

  const defaultSubject = `⚠️ Threshold Breach Alert - {{company_name}}`;
  const defaultBody = `A threshold breach has been detected for {{company_name}}.\n\nDetails:\n• Metric: {{metric_name}}\n• Actual Value: {{value}}\n• Threshold: ${ruleLabels[ruleType] ?? ruleType} {{threshold_value}}\n• Severity: {{severity}}\n• Period: {{period}}\n\nView details: {{dashboard_link}}`;

  const subject = interpolate(settings?.thresholdAlertSubject ?? defaultSubject, vars);
  const body = interpolate(settings?.thresholdAlertBody ?? defaultBody, vars);

  if (settings?.thresholdAlertEnabled) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL - threshold breach] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && (settings as any)?.thresholdAlertInAppEnabled) {
    const link = buildNotificationLink("threshold_alert", companyId, period);
    await createInAppNotifications({
      firmId,
      eventType: "threshold_alert",
      title: `⚠️ ${kpiLabel} threshold breach — ${companyName}`,
      body: `${kpiLabel} actual: ${actual}, threshold: ${ruleLabels[ruleType] ?? ruleType} ${thresholdValue} (${period}).`,
      companyId,
      periodMonth: period,
      linkUrl: link,
    });
  }
}

type MonthlyDigestParams = {
  to: string[];
  monthYear: string; // e.g. "March 2026"
  totalCompanies: number;
  submittedCount: number;
  activeAlerts: number;
  settings: EmailSettings | null;
  firmId?: string;
};

export async function sendMonthlyDigestEmail(params: MonthlyDigestParams) {
  const { to, monthYear, totalCompanies, submittedCount, activeAlerts, settings, firmId } = params;
  if (!to.length) return;
  if (!settings?.monthlyDigestEnabled && !(settings as any)?.monthlyDigestInAppEnabled) return;

  const vars = {
    month_year: monthYear,
    total_companies: String(totalCompanies),
    submitted_count: String(submittedCount),
    active_alerts: String(activeAlerts),
    dashboard_link: process.env.NEXT_PUBLIC_APP_URL ?? "",
  };

  const subject = interpolate(
    settings?.monthlyDigestSubject ?? "PortCo Pulse - Monthly Portfolio Digest for {{month_year}}",
    vars
  );
  const body = interpolate(
    settings?.monthlyDigestBody ??
      `Portfolio Submission Summary - {{month_year}}\n\nHere's your monthly summary of portfolio company performance:\n\nPortfolio Overview:\n• Total Companies: {{total_companies}}\n• Companies Submitted This Period: {{submitted_count}}\n• Active Alerts: {{active_alerts}}\n\nView full dashboard: {{dashboard_link}}`,
    vars
  );

  if (settings?.monthlyDigestEnabled) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL - monthly digest] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && (settings as any)?.monthlyDigestInAppEnabled) {
    await createInAppNotifications({
      firmId,
      eventType: "monthly_digest",
      title: subject,
      body: `${submittedCount}/${totalCompanies} companies submitted. ${activeAlerts} active alert${activeAlerts !== 1 ? "s" : ""}.`,
      linkUrl: buildNotificationLink("monthly_digest"),
    });
  }
}

export async function sendInvitationEmail({
  to,
  inviteLink,
  settings,
}: {
  to: string;
  inviteLink: string;
  settings: EmailSettings | null;
}) {
  const vars = { invitation_link: inviteLink };
  const subject = interpolate(
    settings?.invitationSubject ?? "You've been invited to PortCo Pulse",
    vars
  );
  const body = interpolate(
    settings?.invitationBody ??
      `Hello,\n\nYou have been invited to join PortCo Pulse, a portfolio monitoring platform.\n\nClick the link below to set up your account:\n{{invitation_link}}\n\nThis link expires in 48 hours.\n\nThank you.`,
    vars
  );

  if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
    console.log(`[EMAIL - invitation] To: ${to}\nSubject: ${subject}\n${body}`);
    return;
  }

  await resend.emails.send({
    from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
    to: [to],
    subject,
    text: body,
  });
}

export async function sendReminderEmail(params: ReminderEmailParams) {
  const { to, companyName, period, dueDate, submissionLink, missingDocs, settings, firmId, companyId, operatorUserIds } = params;
  if (!settings?.submissionReminderEnabled && !(settings as any)?.submissionReminderInAppEnabled) return;

  const vars = {
    company_name: companyName,
    period,
    due_date: dueDate,
    submission_link: submissionLink,
    missing_docs: missingDocs.length > 0
      ? missingDocs.map((d) => `• ${d}`).join("\n")
      : "• None — please verify your submission is complete",
  };

  const subject = interpolate(
    settings?.reminderSubject ?? "Action Required: Submission Due — {{company_name}}",
    vars
  );
  const body = interpolate(
    settings?.reminderBody ??
      `Dear {{company_name}},\n\nThis is a reminder that your submission is due by {{due_date}}.\n\nMissing documents:\n{{missing_docs}}\n\nSubmit here: {{submission_link}}\n\nThank you.`,
    vars
  );

  if (settings?.submissionReminderEnabled) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && (settings as any)?.submissionReminderInAppEnabled) {
    await createInAppNotifications({
      firmId,
      eventType: "submission_reminder",
      title: `Submission reminder — ${companyName}`,
      body: `${companyName} submission for ${period} is due ${dueDate}.`,
      companyId,
      periodMonth: period,
      linkUrl: buildNotificationLink("submission_reminder"),
      userIds: operatorUserIds, // target operators specifically, not firm investors
    });
  }
}

// ─── INVESTOR NOTE NOTIFICATION ───────────────────────────────────────────────

type InvestorNoteEmailParams = {
  to: string[];
  companyName: string;
  kpiName: string;
  noteText: string;
  period: string; // e.g. "2026-02"
  analyticsLink: string;
  settings: EmailSettings | null;
  firmId?: string;
  companyId?: string;
  operatorUserIds?: string[];
};

export async function sendInvestorNoteEmail({
  to,
  companyName,
  kpiName,
  noteText,
  period,
  analyticsLink,
  settings,
  firmId,
  companyId,
  operatorUserIds,
}: InvestorNoteEmailParams): Promise<void> {
  if (to.length === 0 && !firmId) return;
  if (!(settings as any)?.investorNoteNotificationEnabled && !(settings as any)?.investorNoteInAppEnabled) return;

  const vars: Record<string, string> = {
    company_name: companyName,
    kpi_name: kpiName,
    note_text: noteText,
    period,
    analytics_link: analyticsLink,
  };

  const subject = interpolate(
    (settings as any)?.investorNoteNotificationSubject ?? "New Note on {{kpi_name}} — {{company_name}}",
    vars
  );
  const body = interpolate(
    (settings as any)?.investorNoteNotificationBody ??
      `Your investor has added a note on {{kpi_name}} for {{period}}.\n\nNote:\n{{note_text}}\n\nView in PortCo Pulse: {{analytics_link}}`,
    vars
  );

  if ((settings as any)?.investorNoteNotificationEnabled && to.length > 0) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL - investor note] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && operatorUserIds && operatorUserIds.length > 0 && (settings as any)?.investorNoteInAppEnabled) {
    const link = buildNotificationLink("investor_note", companyId, period);
    await createInAppNotifications({
      firmId,
      eventType: "investor_note",
      title: `Note added on ${kpiName} — ${companyName}`,
      body: noteText.slice(0, 120) + (noteText.length > 120 ? "…" : ""),
      companyId,
      periodMonth: period,
      linkUrl: link,
      userIds: operatorUserIds, // target operators of this company, not firm investors
    });
  }
}

// ─── RAG ALERT (batched, one email per submission) ────────────────────────────

type RagAlertIssue = {
  kpiLabel: string;
  ragStatus: "amber" | "red";
  variancePct: number; // signed, direction-adjusted (negative = bad)
};

type RagAlertParams = {
  to: string[];
  companyName: string;
  period: string; // "2026-02"
  issues: RagAlertIssue[];
  settings: EmailSettings | null;
  firmId?: string;
  companyId?: string;
};

export async function sendRagAlertEmail(params: RagAlertParams): Promise<void> {
  const { to, companyName, period, issues, settings, firmId, companyId } = params;
  if (!to.length && !firmId) return;
  if (!issues.length) return;
  if (!(settings as any)?.ragAlertEnabled && !(settings as any)?.ragAlertInAppEnabled) return;

  const issueLines = issues
    .map((i) => {
      const statusLabel = i.ragStatus === "red" ? "Off Track" : "At Risk";
      const sign = i.variancePct >= 0 ? "+" : "";
      return `• ${i.kpiLabel}: ${statusLabel} (${sign}${i.variancePct.toFixed(1)}% vs plan)`;
    })
    .join("\n");

  const issuesSummary = issues.length === 1
    ? `${issues[0].kpiLabel} is ${issues[0].ragStatus === "red" ? "Off Track" : "At Risk"}`
    : `${issues.length} KPIs off track`;

  const vars: Record<string, string> = {
    company_name: companyName,
    period,
    issues_list: issueLines,
    issues_summary: issuesSummary,
    dashboard_link: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };

  const defaultSubject = `⚠️ RAG Alert — {{company_name}}: {{issues_summary}}`;
  const defaultBody = `⚠️ KPI STATUS ALERT\n\n{{company_name}} submitted data for {{period}} with the following KPIs off track vs plan:\n\n{{issues_list}}\n\nView full details: {{dashboard_link}}`;

  const subject = interpolate((settings as any)?.ragAlertSubject ?? defaultSubject, vars);
  const body = interpolate((settings as any)?.ragAlertBody ?? defaultBody, vars);

  if ((settings as any)?.ragAlertEnabled && to.length > 0) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL - rag alert] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && (settings as any)?.ragAlertInAppEnabled) {
    const link = buildNotificationLink("rag_alert", companyId, period);
    await createInAppNotifications({
      firmId,
      eventType: "rag_alert",
      title: `⚠️ ${companyName}: ${issuesSummary}`,
      body: issueLines,
      companyId,
      periodMonth: period,
      linkUrl: link,
    });
  }
}

// ─── PLAN REMINDER ────────────────────────────────────────────────────────────

type PlanReminderEmailParams = {
  to: string[];
  companyName: string;
  fiscalYear: number;
  dueDate: string; // "2026-01-31"
  planLink: string;
  settings: EmailSettings | null;
};

export async function sendPlanReminderEmail({
  to,
  companyName,
  fiscalYear,
  dueDate,
  planLink,
  settings,
}: PlanReminderEmailParams): Promise<void> {
  if (to.length === 0) return;
  if (!settings?.submissionReminderEnabled) return;

  const vars: Record<string, string> = {
    company_name: companyName,
    period: `FY${fiscalYear}`,
    due_date: dueDate,
    submission_link: planLink,
    missing_docs: "• Annual Plan",
  };

  const subject = interpolate(
    settings?.reminderSubject ?? "Action Required: Submission Due — {{company_name}}",
    vars
  );
  const body = interpolate(
    settings?.reminderBody ??
      `Dear {{company_name}},\n\nThis is a reminder that your submission is due by {{due_date}}.\n\nMissing documents:\n{{missing_docs}}\n\nSubmit here: {{submission_link}}\n\nThank you.`,
    vars
  );

  if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
    console.log(`[EMAIL - plan reminder] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    return;
  }

  await resend.emails.send({
    from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
    to,
    subject,
    text: body,
  });
}

// ─── ONBOARDING REQUEST ───────────────────────────────────────────────────────

type OnboardingRequestEmailParams = {
  to: string[];
  companyName: string;
  firmName: string;
  chatLink: string;
  settings: EmailSettings | null;
  firmId?: string;
  operatorUserIds?: string[];
};

export async function sendOnboardingRequestEmail({
  to,
  companyName,
  firmName,
  chatLink,
  settings,
  firmId,
  operatorUserIds,
}: OnboardingRequestEmailParams): Promise<void> {
  if (to.length === 0 && !operatorUserIds?.length) return;

  const vars: Record<string, string> = {
    company_name: companyName,
    firm_name: firmName,
    chat_link: chatLink,
  };

  const subject = interpolate(`{{firm_name}} — please share your historical data for {{company_name}}`, vars);
  const body = interpolate(
    `Hi,\n\n{{firm_name}} has added {{company_name}} to PortCo Pulse and would like to collect some historical financial data to set up your profile.\n\nThere's no strict format or deadline — just share what you have when you can. Financial statements, KPI reports, board decks, anything helps.\n\nSubmit your data → {{chat_link}}\n\nIf you have any questions, reach out to your contact at {{firm_name}} directly.`,
    vars
  );

  if (to.length > 0) {
    if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
      console.log(`[EMAIL - onboarding request] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    } else {
      await resend.emails.send({
        from: `${settings?.fromName ?? "PortCo Pulse"} <onboarding@resend.dev>`,
        to,
        subject,
        text: body,
      });
    }
  }

  if (firmId && operatorUserIds && operatorUserIds.length > 0) {
    await createInAppNotifications({
      firmId,
      eventType: "onboarding_request",
      title: subject,
      body: `Submit your historical financial data to set up your profile on PortCo Pulse.`,
      linkUrl: chatLink,
      userIds: operatorUserIds,
    });
  }
}

// ─── ONBOARDING COMPLETE ─────────────────────────────────────────────────────

type OnboardingCompleteEmailParams = {
  to: string[];
  companyName: string;
  firmName: string;
  settings: EmailSettings | null;
};

export async function sendOnboardingCompleteEmail({
  to,
  companyName,
  firmName,
  settings,
}: OnboardingCompleteEmailParams): Promise<void> {
  if (to.length === 0) return;

  const vars: Record<string, string> = { company_name: companyName, firm_name: firmName };
  const subject = interpolate(`You're all set — {{company_name}} onboarding complete`, vars);
  const body = interpolate(
    `Hi,\n\nYour historical data submission for {{company_name}} has been received. You're all set.\n\nYour data is now live on the platform. If anything is missing or needs updating, reach out to your contact at {{firm_name}} directly.`,
    vars
  );

  if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
    console.log(`[EMAIL - onboarding complete] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    return;
  }

  await resend.emails.send({
    from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
    to,
    subject,
    text: body,
  });
}

// ─── PLAN SUBMITTED ───────────────────────────────────────────────────────────

type PlanSubmittedEmailParams = {
  to: string[];
  companyName: string;
  fiscalYear: number;
  version: number;
  planLink: string;
  settings: EmailSettings | null;
};

export async function sendPlanSubmittedEmail({
  to,
  companyName,
  fiscalYear,
  version,
  planLink,
  settings,
}: PlanSubmittedEmailParams): Promise<void> {
  if (to.length === 0) return;

  const versionLabel = version === 1 ? "Original" : `Rev ${version - 1}`;

  const vars: Record<string, string> = {
    company_name: companyName,
    fiscal_year: String(fiscalYear),
    version: versionLabel,
    plan_review_link: planLink,
  };

  const subject = interpolate(
    settings?.planSubmittedSubject ??
      "{{company_name}} Submitted Their {{fiscal_year}} Plan ({{version}})",
    vars
  );
  const body = interpolate(
    settings?.planSubmittedBody ??
      "{{company_name}} has submitted their {{fiscal_year}} annual plan ({{version}}).\n\nView and comment on the plan: {{plan_review_link}}",
    vars
  );

  if (!resend || process.env.RESEND_API_KEY === "re_placeholder") {
    console.log(`[EMAIL] To: ${to.join(", ")}\nSubject: ${subject}\n${body}`);
    return;
  }

  await resend.emails.send({
    from: `${settings?.fromName ?? "PortCo Pulse"} <${settings?.fromEmail ?? "noreply@portcopulse.com"}>`,
    to,
    subject,
    text: body,
  });
}
