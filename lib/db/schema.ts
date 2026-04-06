import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── FIRMS ────────────────────────────────────────────────────────────────────

export const firms = sqliteTable("firms", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  orgType: text("org_type", { enum: ["pe_firm", "operating_company"] })
    .notNull()
    .default("pe_firm"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── COMPANIES ────────────────────────────────────────────────────────────────

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    slug: text("slug"),
    industry: text("industry"),
    timezone: text("timezone"),
    partnerEmail: text("partner_email"),
    requiredDocs: text("required_docs"),
    requiredDocCadences: text("required_doc_cadences"), // "key:cadence,key:cadence" e.g. "cash_flow_statement:quarterly"
    submissionDueDays: integer("submission_due_days"), // legacy — nullable override (superseded by per-cadence fields below)
    dueDaysMonthly: integer("due_days_monthly"),       // nullable — overrides firm default when set
    dueDaysQuarterly: integer("due_days_quarterly"),   // nullable — overrides firm default when set
    dueDaysBiAnnual: integer("due_days_bi_annual"),    // nullable — overrides firm default when set
    dueDaysAnnual: integer("due_days_annual"),         // nullable — overrides firm default when set
    reminderDaysBeforeDue: integer("reminder_days_before_due"), // nullable — overrides firm default when set
    planDueMonth: integer("plan_due_month"),           // nullable — overrides firm default when set
    planDueDay: integer("plan_due_day"),               // nullable — overrides firm default when set
    fund: text("fund"), // nullable — "Independent" in UI when null
    status: text("status", { enum: ["current", "exited"] }).notNull().default("current"),
    alertCcEmails: text("alert_cc_emails"),       // comma-sep — CC these on threshold alerts for this company
    submissionCcEmails: text("submission_cc_emails"), // comma-sep — CC these when this company submits
    companyEmailSettings: text("company_email_settings"), // JSON — per-event { recipients, enabled } overrides
    submissionToken: text("submission_token").unique().notNull(),
    submissionNotes: text("submission_notes"), // learned preferences from chat sessions (e.g. notation conventions)
    investmentDate: text("investment_date"),
    onboardingStatus: text("onboarding_status", { enum: ["pending", "in_progress", "complete"] }),
    onboardingCompletedAt: text("onboarding_completed_at"),
    onboardingRequestSentAt: text("onboarding_request_sent_at"),
    linkedAt: text("linked_at"),
    linkMode: text("link_mode", { enum: ["full_history", "forward_only"] }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("companies_firm_slug_idx").on(t.firmId, t.slug)]
);

// ─── FIRM LINK TOKENS ─────────────────────────────────────────────────────────

export const firmLinkTokens = sqliteTable("firm_link_tokens", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  firmId: text("firm_id")
    .notNull()
    .references(() => firms.id),
  token: text("token").unique().notNull(),
  expiresAt: text("expires_at"),
  createdByUserId: text("created_by_user_id").notNull(),
  linkMode: text("link_mode", { enum: ["full_history", "forward_only"] }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── USERS ────────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  firmId: text("firm_id")
    .notNull()
    .references(() => firms.id),
  companyId: text("company_id").references(() => companies.id),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: text("role", {
    enum: ["firm_admin", "firm_member", "company_admin", "company_member"],
  }).notNull(),
  persona: text("persona", { enum: ["investor", "operator", "independent_operator"] }).notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  inviteToken: text("invite_token"),
  inviteTokenExpiresAt: integer("invite_token_expires_at"),
});

// ─── PERIODS ──────────────────────────────────────────────────────────────────

export const periods = sqliteTable(
  "periods",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    periodType: text("period_type", { enum: ["monthly", "quarterly"] }).notNull(),
    periodStart: text("period_start").notNull(), // ISO date string YYYY-MM-DD
    dueDate: text("due_date"),
    status: text("status", { enum: ["open", "locked"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("periods_firm_type_start_idx").on(
      t.firmId,
      t.periodType,
      t.periodStart
    ),
    index("periods_firm_id_idx").on(t.firmId),
  ]
);

// ─── KPI DEFINITIONS ──────────────────────────────────────────────────────────

export const kpiDefinitions = sqliteTable(
  "kpi_definitions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    scope: text("scope", { enum: ["standard", "custom"] }).notNull(),
    companyId: text("company_id").references(() => companies.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    section: text("section"),
    unit: text("unit"),
    description: text("description"),
    valueType: text("value_type", {
      enum: ["currency", "percent", "integer", "text", "boolean", "date"],
    }).notNull(),
    isRequired: integer("is_required", { mode: "boolean" }).notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    // Collection cadence — how often this KPI is collected from operators
    collectionCadence: text("collection_cadence", { enum: ["weekly", "monthly", "quarterly", "bi-annual"] }).notNull().default("monthly"),
    // Plan + RAG config
    planGranularity: text("plan_granularity", { enum: ["monthly", "quarterly_total", "quarterly_end", "annual_total", "annual_end", "annual"] }).notNull().default("annual_total"),
    ragDirection: text("rag_direction", { enum: ["higher_is_better", "lower_is_better", "any_variance"] }).notNull().default("higher_is_better"),
    ragGreenPct: real("rag_green_pct").notNull().default(5),   // within 5% of plan = green
    ragAmberPct: real("rag_amber_pct").notNull().default(15),  // 5–15% off plan = amber, >15% = red
    // RAG alert settings — which statuses trigger an email alert on submission
    ragAlertOnAmber: integer("rag_alert_on_amber", { mode: "boolean" }).notNull().default(true),
    ragAlertOnRed: integer("rag_alert_on_red", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    uniqueIndex("kpi_defs_firm_key_company_idx").on(t.firmId, t.key, t.companyId),
  ]
);

// ─── SUBMISSIONS ──────────────────────────────────────────────────────────────

export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    periodId: text("period_id")
      .notNull()
      .references(() => periods.id),
    version: integer("version").notNull().default(1),
    status: text("status", { enum: ["draft", "submitted"] })
      .notNull()
      .default("draft"),
    submittedAt: text("submitted_at"),
    submittedByUserId: text("submitted_by_user_id").references(() => users.id),
    note: text("note"),             // operator's overall submission note
    investorNote: text("investor_note"), // firm's overall comment on this version
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    lastUpdatedAt: text("last_updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    extractionSource: text("extraction_source").default("form"), // "form" | "chat"
  },
  (t) => [
    uniqueIndex("submissions_company_period_version_idx").on(t.companyId, t.periodId, t.version),
    index("submissions_firm_company_period_idx").on(
      t.firmId,
      t.companyId,
      t.periodId
    ),
    index("submissions_status_idx").on(t.status),
    index("submissions_period_id_idx").on(t.periodId),
  ]
);

// ─── KPI VALUES ───────────────────────────────────────────────────────────────

export const kpiValues = sqliteTable(
  "kpi_values",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    periodId: text("period_id")
      .notNull()
      .references(() => periods.id),
    kpiDefinitionId: text("kpi_definition_id")
      .notNull()
      .references(() => kpiDefinitions.id),
    actualNumber: real("actual_number"),
    actualText: text("actual_text"),
    targetNumber: real("target_number"),
    targetText: text("target_text"),
    targetDate: text("target_date"),
    note: text("note"),                   // submitter note for this KPI this period
    investorNote: text("investor_note"),  // firm-side annotation added post-submission
    ragOverride: text("rag_override", { enum: ["green", "amber", "red"] }),
    ragOverrideReason: text("rag_override_reason"), // required when ragOverride is set
  },
  (t) => [
    uniqueIndex("kpi_values_submission_def_idx").on(t.submissionId, t.kpiDefinitionId),
    index("kpi_values_firm_company_idx").on(t.firmId, t.companyId),
    index("kpi_values_firm_period_idx").on(t.firmId, t.periodId),
    index("kpi_values_period_id_idx").on(t.periodId),
    index("kpi_values_submission_id_idx").on(t.submissionId),
  ]
);

// ─── THRESHOLD RULES ──────────────────────────────────────────────────────────

export const thresholdRules = sqliteTable(
  "threshold_rules",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    companyId: text("company_id").references(() => companies.id),
    kpiDefinitionId: text("kpi_definition_id")
      .notNull()
      .references(() => kpiDefinitions.id),
    ruleType: text("rule_type", { enum: ["lt", "lte", "gt", "gte"] }).notNull(),
    thresholdValue: real("threshold_value").notNull(),
    severity: text("severity", { enum: ["low", "medium", "high"] }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  }
);

// ─── ALERTS ───────────────────────────────────────────────────────────────────

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    periodId: text("period_id")
      .notNull()
      .references(() => periods.id),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    kpiDefinitionId: text("kpi_definition_id")
      .notNull()
      .references(() => kpiDefinitions.id),
    severity: text("severity", { enum: ["low", "medium", "high"] }).notNull(),
    message: text("message"),
    status: text("status", { enum: ["active", "resolved"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("alerts_submission_def_idx").on(t.submissionId, t.kpiDefinitionId),
    index("alerts_firm_company_period_idx").on(t.firmId, t.companyId, t.periodId),
  ]
);

// ─── FINANCIAL DOCUMENTS ──────────────────────────────────────────────────────

export const financialDocuments = sqliteTable(
  "financial_documents",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    periodId: text("period_id")
      .notNull()
      .references(() => periods.id),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    documentType: text("document_type", {
      enum: [
        "balance_sheet",
        "income_statement",
        "cash_flow_statement",
        "combined_financials",
        "investor_update",
      ],
    }).notNull(),
    version: integer("version").notNull().default(1),
    fileName: text("file_name").notNull(),
    filePath: text("file_path").notNull(),
    includedStatements: text("included_statements"), // comma-separated: "balance_sheet,income_statement,cash_flow_statement"
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id),
    uploadedAt: text("uploaded_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("fin_docs_submission_type_version_idx").on(
      t.submissionId,
      t.documentType,
      t.version
    ),
    index("fin_docs_submission_id_idx").on(t.submissionId),
  ]
);

// ─── EMAIL SETTINGS ───────────────────────────────────────────────────────────

export const emailSettings = sqliteTable("email_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  firmId: text("firm_id")
    .notNull()
    .unique()
    .references(() => firms.id),

  // Sender info
  fromEmail: text("from_email").notNull().default("noreply@portcopulse.com"),
  fromName: text("from_name").notNull().default("PortCo Pulse"),

  // Notification preference toggles
  submissionReminderEnabled: integer("submission_reminder_enabled", { mode: "boolean" }).notNull().default(true),
  monthlyDigestEnabled: integer("monthly_digest_enabled", { mode: "boolean" }).notNull().default(true),
  thresholdAlertEnabled: integer("threshold_alert_enabled", { mode: "boolean" }).notNull().default(true),
  submissionNotificationEnabled: integer("submission_notification_enabled", { mode: "boolean" }).notNull().default(true),

  // Submission Reminder template
  reminderSubject: text("reminder_subject")
    .notNull()
    .default("Action Required: KPI Submission for {{period}}"),
  reminderBody: text("reminder_body").notNull().default(
    `Dear {{company_name}},\n\nThis is a reminder that your KPI submission for {{period}} is due by {{due_date}}.\n\nPlease submit your data using the link below:\n{{submission_link}}\n\nRequired documents:\n{{required_docs}}\n\nThank you.`
  ),

  // Monthly Digest template
  monthlyDigestRecipients: text("monthly_digest_recipients").notNull().default(""),
  monthlyDigestSubject: text("monthly_digest_subject")
    .notNull()
    .default("PortCo Pulse - Monthly Portfolio Digest for {{month_year}}"),
  monthlyDigestBody: text("monthly_digest_body").notNull().default(
    `Portfolio Submission Summary - {{month_year}}\n\nHere's your monthly summary of portfolio company performance:\n\nPortfolio Overview:\n• Total Companies: {{total_companies}}\n• Companies Submitted This Period: {{submitted_count}}\n• Active Alerts: {{active_alerts}}\n\nView full dashboard: {{dashboard_link}}`
  ),

  // Threshold Alert template
  thresholdAlertRecipients: text("threshold_alert_recipients").notNull().default(""),
  thresholdAlertSubject: text("threshold_alert_subject")
    .notNull()
    .default("⚠️ KPI Alert — {{company_name}}: {{issues_summary}}"),
  thresholdAlertBody: text("threshold_alert_body").notNull().default(
    `⚠️ KPI STATUS ALERT\n\n{{company_name}} submitted data for {{period}} with the following KPIs off track:\n\n{{issues_list}}\n\nView full details: {{dashboard_link}}`
  ),

  // Submission Notification template
  submissionNotificationRecipients: text("submission_notification_recipients").notNull().default(""),
  submissionNotificationSubject: text("submission_notification_subject")
    .notNull()
    .default("New Submission Received - {{company_name}}"),
  submissionNotificationBody: text("submission_notification_body").notNull().default(
    `A new submission has been received from {{company_name}}.\n\nSubmission Details:\n• Period: {{period}}\n• Submitted by: {{submitted_by}}\n• Submission time: {{submission_time}}\n\nKey Metrics:\n• Revenue: {{revenue}}\n• EBITDA: {{ebitda}}\n• Operating Cash Flow: {{ocf}}\n• Gross Margin: {{gross_margin}}\n• Cash: {{cash}}\n\nView full details: {{dashboard_link}}`
  ),

  // Platform Invitation template
  invitationSubject: text("invitation_subject")
    .notNull()
    .default("You've been invited to PortCo Pulse"),
  invitationBody: text("invitation_body").notNull().default(
    `Hello,\n\nYou have been invited to join PortCo Pulse, a portfolio monitoring platform.\n\nClick the link below to set up your account:\n{{invitation_link}}\n\nThis link expires in 48 hours.\n\nThank you.`
  ),

  // Submission due date settings — business days after period close, per cadence
  submissionDueDays: integer("submission_due_days").notNull().default(15), // legacy; keep for company-level override fallback
  dueDaysMonthly: integer("due_days_monthly").notNull().default(15),
  dueDaysQuarterly: integer("due_days_quarterly").notNull().default(30),
  dueDaysAnnual: integer("due_days_annual").notNull().default(60),
  dueDaysBiAnnual: integer("due_days_bi_annual").notNull().default(45),

  // KPI override notification (fires when company-level KPI alert settings are customized)
  kpiOverrideNotificationEnabled: integer("kpi_override_notification_enabled", { mode: "boolean" }).notNull().default(true),
  kpiOverrideNotificationRecipients: text("kpi_override_notification_recipients").notNull().default(""),
  kpiOverrideNotificationSubject: text("kpi_override_notification_subject"),
  kpiOverrideNotificationBody: text("kpi_override_notification_body"),

  // RAG status alert (fires on submission when KPIs are At Risk / Off Track vs plan)
  ragAlertEnabled: integer("rag_alert_enabled", { mode: "boolean" }).notNull().default(true),
  ragAlertRecipients: text("rag_alert_recipients").notNull().default(""),
  ragAlertSubject: text("rag_alert_subject"),
  ragAlertBody: text("rag_alert_body"),

  // Firm-level recipients for reminder emails (in addition to per-company operator emails)
  submissionReminderRecipients: text("submission_reminder_recipients").notNull().default(""),
  planReminderRecipients: text("plan_reminder_recipients").notNull().default(""),

  // Auto-reminder timing (calendar days before submission due date)
  reminderDaysBeforeDue: integer("reminder_days_before_due").notNull().default(3),

  // Plan reminder settings
  planReminderEnabled: integer("plan_reminder_enabled", { mode: "boolean" }).notNull().default(true),
  planReminderMonth: integer("plan_reminder_month").notNull().default(12), // kept for legacy; UI now uses planReminderDaysBeforeDue
  planReminderDay: integer("plan_reminder_day").notNull().default(1),
  planDueMonth: integer("plan_due_month").notNull().default(1),            // January
  planDueDay: integer("plan_due_day").notNull().default(31),
  planReminderDaysBeforeDue: integer("plan_reminder_days_before_due").notNull().default(30),

  // Plan reminder email template
  planReminderSubject: text("plan_reminder_subject")
    .notNull()
    .default("Action Required: Submit Your {{fiscal_year}} Annual Plan"),
  planReminderBody: text("plan_reminder_body").notNull().default(
    `Dear {{company_name}},\n\nPlease submit your annual plan for {{fiscal_year}} by {{due_date}}.\n\nYour plan should include targets for each KPI tracked in PortCo Pulse. You can submit your plan using the link below:\n{{plan_link}}\n\nThank you.`
  ),

  // Plan submitted notification template (sent to firm when operator submits/revises a plan)
  planSubmittedRecipients: text("plan_submitted_recipients").notNull().default(""),
  planSubmittedSubject: text("plan_submitted_subject")
    .notNull()
    .default("{{company_name}} Submitted Their {{fiscal_year}} Plan ({{version}})"),
  planSubmittedBody: text("plan_submitted_body").notNull().default(
    `{{company_name}} has submitted their {{fiscal_year}} annual plan ({{version}}).\n\nView and comment on the plan: {{plan_review_link}}`
  ),

  // Investor note notification (sent to company operators when an investor adds a KPI note)
  investorNoteNotificationEnabled: integer("investor_note_notification_enabled", { mode: "boolean" }).notNull().default(true),
  investorNoteNotificationSubject: text("investor_note_notification_subject")
    .notNull()
    .default("New Note on {{kpi_name}} — {{company_name}}"),
  investorNoteNotificationBody: text("investor_note_notification_body").notNull().default(
    `Your investor has added a note on {{kpi_name}} for {{period}}.\n\nNote:\n{{note_text}}\n\nView in PortCo Pulse: {{analytics_link}}`
  ),

  // Submission Voided notification (fires when an operator voids a prior submission via chat)
  submissionVoidedEnabled: integer("submission_voided_enabled", { mode: "boolean" }).notNull().default(true),
  submissionVoidedInAppEnabled: integer("submission_voided_in_app_enabled", { mode: "boolean" }).notNull().default(true),
  submissionVoidedRecipients: text("submission_voided_recipients").notNull().default(""),
  submissionVoidedSubject: text("submission_voided_subject").notNull().default("Submission Voided — {{company_name}}"),
  submissionVoidedBody: text("submission_voided_body").notNull().default(
    `The {{period}} submission from {{company_name}} has been voided and removed from the platform.\n\nVoided on: {{voided_date}}\n\nView submission history: {{dashboard_link}}`
  ),

  // In-app notification toggles (independent of email toggles)
  submissionNotificationInAppEnabled: integer("submission_notification_in_app_enabled", { mode: "boolean" }).notNull().default(true),
  submissionReminderInAppEnabled: integer("submission_reminder_in_app_enabled", { mode: "boolean" }).notNull().default(true),
  ragAlertInAppEnabled: integer("rag_alert_in_app_enabled", { mode: "boolean" }).notNull().default(true),
  thresholdAlertInAppEnabled: integer("threshold_alert_in_app_enabled", { mode: "boolean" }).notNull().default(true),
  kpiOverrideNotificationInAppEnabled: integer("kpi_override_notification_in_app_enabled", { mode: "boolean" }).notNull().default(true),
  investorNoteInAppEnabled: integer("investor_note_in_app_enabled", { mode: "boolean" }).notNull().default(true),
  monthlyDigestInAppEnabled: integer("monthly_digest_in_app_enabled", { mode: "boolean" }).notNull().default(true),

  // Firm-wide required document defaults (company-level can override)
  firmRequiredDocs: text("firm_required_docs"),           // comma-separated doc keys, null = not set
  firmRequiredDocCadences: text("firm_required_doc_cadences"), // "key:cadence,..." format

  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── KPI PLANS ────────────────────────────────────────────────────────────────
// One record per company per fiscal year per version.
// version=1 is "Original", version=2 is "Rev 1", etc.
// The latest version for a company+fiscal_year is the active plan.

export const kpiPlans = sqliteTable(
  "kpi_plans",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    fiscalYear: integer("fiscal_year").notNull(),       // e.g., 2025
    granularity: text("granularity", { enum: ["annual", "monthly"] }).notNull().default("annual"),
    version: integer("version").notNull().default(1),  // 1 = Original, 2 = Rev 1, etc.
    submittedByUserId: text("submitted_by_user_id").references(() => users.id),
    submittedAt: text("submitted_at"),
    note: text("note"),             // operator's overall plan note
    investorNote: text("investor_note"), // firm's overall comment on this version
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("kpi_plans_company_year_version_idx").on(t.companyId, t.fiscalYear, t.version),
    index("kpi_plans_company_year_idx").on(t.companyId, t.fiscalYear),
    index("kpi_plans_firm_id_idx").on(t.firmId),
  ]
);

// ─── KPI PLAN VALUES ──────────────────────────────────────────────────────────
// One row per KPI per plan. For monthly granularity, periodMonth 1–12.
// For annual granularity, periodMonth is null.

export const kpiPlanValues = sqliteTable(
  "kpi_plan_values",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    planId: text("plan_id")
      .notNull()
      .references(() => kpiPlans.id),
    kpiDefinitionId: text("kpi_definition_id")
      .notNull()
      .references(() => kpiDefinitions.id),
    periodMonth: integer("period_month"), // null = annual; 1–12 = monthly breakdown
    value: real("value"),
    investorComment: text("investor_comment"), // firm comment on this specific KPI target
  },
  (t) => [
    uniqueIndex("kpi_plan_values_plan_def_month_idx").on(t.planId, t.kpiDefinitionId, t.periodMonth),
    index("kpi_plan_values_plan_id_idx").on(t.planId),
  ]
);

// ─── KPI CADENCE OVERRIDES ────────────────────────────────────────────────────
// Company-specific cadence override for a firm-wide KPI definition.

export const kpiCadenceOverrides = sqliteTable(
  "kpi_cadence_overrides",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id").notNull().references(() => firms.id),
    companyId: text("company_id").notNull().references(() => companies.id),
    kpiDefinitionId: text("kpi_definition_id").notNull().references(() => kpiDefinitions.id),
    collectionCadence: text("collection_cadence", { enum: ["weekly", "monthly", "quarterly", "bi-annual"] }).notNull(),
  },
  (t) => [
    uniqueIndex("kpi_cadence_overrides_company_def_idx").on(t.companyId, t.kpiDefinitionId),
  ]
);

// ─── KPI ALERT OVERRIDES ──────────────────────────────────────────────────────
// Per-company override for which RAG statuses trigger alert emails for a given KPI.

export const kpiAlertOverrides = sqliteTable(
  "kpi_alert_overrides",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id").notNull().references(() => firms.id),
    companyId: text("company_id").notNull().references(() => companies.id),
    kpiDefinitionId: text("kpi_definition_id").notNull().references(() => kpiDefinitions.id),
    ragAlertOnAmber: integer("rag_alert_on_amber", { mode: "boolean" }).notNull(),
    ragAlertOnRed: integer("rag_alert_on_red", { mode: "boolean" }).notNull(),
  },
  (t) => [
    uniqueIndex("kpi_alert_overrides_company_def_idx").on(t.companyId, t.kpiDefinitionId),
  ]
);

// ─── KPI RAG OVERRIDES ────────────────────────────────────────────────────────
// Per-company override for RAG thresholds for a given KPI.

export const kpiRagOverrides = sqliteTable(
  "kpi_rag_overrides",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id").notNull().references(() => firms.id),
    companyId: text("company_id").notNull().references(() => companies.id),
    kpiDefinitionId: text("kpi_definition_id").notNull().references(() => kpiDefinitions.id),
    ragGreenPct: real("rag_green_pct").notNull(),
    ragAmberPct: real("rag_amber_pct").notNull(),
    ragDirection: text("rag_direction", { enum: ["higher_is_better", "lower_is_better", "any_variance"] }).notNull(),
  },
  (t) => [
    uniqueIndex("kpi_rag_overrides_company_def_idx").on(t.companyId, t.kpiDefinitionId),
  ]
);

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
// One record per user per event. Displayed in the sidebar bell dropdown.

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    firmId: text("firm_id").notNull().references(() => firms.id),
    userId: text("user_id").notNull().references(() => users.id),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url"),
    companyId: text("company_id").references(() => companies.id),
    periodMonth: text("period_month"), // "2026-02" format
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index("notifications_user_id_idx").on(t.userId),
    index("notifications_firm_id_idx").on(t.firmId),
  ]
);

// ─── USER ACCESS SCOPES ───────────────────────────────────────────────────────

export const userAccessScopes = sqliteTable("user_access_scopes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  firmId: text("firm_id").notNull().references(() => firms.id),
  scopeType: text("scope_type", { enum: ["company", "fund", "industry"] }).notNull(),
  scopeValue: text("scope_value").notNull(), // companyId, fund name, or industry name
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ─── PENDING SUBMISSIONS ──────────────────────────────────────────────────────
// Holds extracted JSON payload awaiting firm-user review (chat submission path).

export const pendingSubmissions = sqliteTable("pending_submissions", {
  id:               text("id").primaryKey(),
  companyId:        text("company_id").notNull().references(() => companies.id),
  token:            text("token").notNull(),
  submissionType:   text("submission_type").notNull(), // "periodic" | "plan"
  period:           text("period"),                    // "YYYY-MM" for periodic, null for plan
  fiscalYear:       integer("fiscal_year"),            // e.g. 2026 for plan, null for periodic
  extractedPayload: text("extracted_payload").notNull(), // JSON string
  missingKpis:      text("missing_kpis"),              // JSON array of missing KPI keys
  extractionSource: text("extraction_source").notNull().default("chat"),
  submittedByUserId: text("submitted_by_user_id").references(() => users.id),
  operatorConfirmed: integer("operator_confirmed", { mode: "boolean" }).notNull().default(false),
  status:           text("status").notNull().default("pending_review"), // "pending_review" | "approved" | "rejected"
  reviewedBy:       text("reviewed_by"),
  reviewedAt:       integer("reviewed_at", { mode: "timestamp" }),
  reviewNotes:      text("review_notes"),
  submittedAt:      integer("submitted_at", { mode: "timestamp" }).notNull(),
  createdAt:        integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── CHAT MESSAGES ────────────────────────────────────────────────────────────
// Conversation history per session for continuity across page reloads.

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id:          text("id").primaryKey(),
    sessionKey:  text("session_key").notNull(),
    companyId:   text("company_id").notNull(),
    role:        text("role").notNull(),         // "user" | "assistant" | "tool"
    content:     text("content").notNull(),      // message text or JSON
    contentType: text("content_type").notNull().default("text"), // "text" | "tool_call" | "tool_result"
    createdAt:   integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("chat_messages_session_key_idx").on(t.sessionKey)]
);

// ─── ONBOARDING DOCUMENTS ────────────────────────────────────────────────────
// Files uploaded by an operator during the company onboarding process.
// Separate from financial_documents (which are period/submission-scoped).

export const onboardingDocuments = sqliteTable("onboarding_documents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  firmId: text("firm_id").notNull().references(() => firms.id),
  companyId: text("company_id").notNull().references(() => companies.id),
  fileName: text("file_name").notNull(),
  filePath: text("file_path"),
  uploadedAt: text("uploaded_at").notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index("onboarding_docs_company_idx").on(t.companyId),
]);

// ─── TYPE EXPORTS ─────────────────────────────────────────────────────────────

export type Firm = typeof firms.$inferSelect;
export type NewFirm = typeof firms.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Period = typeof periods.$inferSelect;
export type NewPeriod = typeof periods.$inferInsert;
export type KpiDefinition = typeof kpiDefinitions.$inferSelect;
export type NewKpiDefinition = typeof kpiDefinitions.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type KpiValue = typeof kpiValues.$inferSelect;
export type NewKpiValue = typeof kpiValues.$inferInsert;
export type ThresholdRule = typeof thresholdRules.$inferSelect;
export type NewThresholdRule = typeof thresholdRules.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type FinancialDocument = typeof financialDocuments.$inferSelect;
export type NewFinancialDocument = typeof financialDocuments.$inferInsert;
export type EmailSettings = typeof emailSettings.$inferSelect;
export type KpiPlan = typeof kpiPlans.$inferSelect;
export type NewKpiPlan = typeof kpiPlans.$inferInsert;
export type KpiPlanValue = typeof kpiPlanValues.$inferSelect;
export type NewKpiPlanValue = typeof kpiPlanValues.$inferInsert;
export type UserAccessScope = typeof userAccessScopes.$inferSelect;
export type KpiCadenceOverride = typeof kpiCadenceOverrides.$inferSelect;
export type NewKpiCadenceOverride = typeof kpiCadenceOverrides.$inferInsert;
export type KpiAlertOverride = typeof kpiAlertOverrides.$inferSelect;
export type KpiRagOverride = typeof kpiRagOverrides.$inferSelect;
export type NewKpiRagOverride = typeof kpiRagOverrides.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type OnboardingDocument = typeof onboardingDocuments.$inferSelect;
export type NewOnboardingDocument = typeof onboardingDocuments.$inferInsert;
export type PendingSubmission = typeof pendingSubmissions.$inferSelect;
export type NewPendingSubmission = typeof pendingSubmissions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
