const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../portco-pulse.db"));

const migrations = [
  // companies
  "ALTER TABLE companies ADD COLUMN status TEXT NOT NULL DEFAULT 'current'",
  "ALTER TABLE companies ADD COLUMN industry TEXT",
  "ALTER TABLE companies ADD COLUMN timezone TEXT",
  "ALTER TABLE companies ADD COLUMN required_docs TEXT",
  "ALTER TABLE companies ADD COLUMN submission_due_days INTEGER",
  "ALTER TABLE companies ADD COLUMN alert_cc_emails TEXT",
  "ALTER TABLE companies ADD COLUMN submission_cc_emails TEXT",
  // users
  "ALTER TABLE users ADD COLUMN persona TEXT NOT NULL DEFAULT 'investor'",
  "ALTER TABLE users ADD COLUMN company_id TEXT REFERENCES companies(id)",
  "ALTER TABLE users ADD COLUMN invite_token TEXT",
  "ALTER TABLE users ADD COLUMN invite_token_expires_at INTEGER",
  // kpi_definitions
  "ALTER TABLE kpi_definitions ADD COLUMN scope TEXT NOT NULL DEFAULT 'standard'",
  "ALTER TABLE kpi_definitions ADD COLUMN company_id TEXT",
  "ALTER TABLE kpi_definitions ADD COLUMN description TEXT",
  "ALTER TABLE kpi_definitions ADD COLUMN display_order INTEGER NOT NULL DEFAULT 99",
  "ALTER TABLE kpi_definitions ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE kpi_definitions ADD COLUMN plan_granularity TEXT NOT NULL DEFAULT 'annual'",
  "ALTER TABLE kpi_definitions ADD COLUMN rag_direction TEXT NOT NULL DEFAULT 'higher_is_better'",
  "ALTER TABLE kpi_definitions ADD COLUMN rag_green_pct REAL NOT NULL DEFAULT 5",
  "ALTER TABLE kpi_definitions ADD COLUMN rag_amber_pct REAL NOT NULL DEFAULT 15",
  // submissions
  "ALTER TABLE submissions ADD COLUMN note TEXT",
  // kpi_values
  "ALTER TABLE kpi_values ADD COLUMN note TEXT",
  "ALTER TABLE kpi_values ADD COLUMN investor_note TEXT",
  "ALTER TABLE kpi_values ADD COLUMN rag_override TEXT",
  "ALTER TABLE kpi_values ADD COLUMN rag_override_reason TEXT",
  // email_settings
  "ALTER TABLE email_settings ADD COLUMN from_name TEXT NOT NULL DEFAULT 'PortCo Pulse'",
  "ALTER TABLE email_settings ADD COLUMN from_email TEXT NOT NULL DEFAULT 'noreply@portcopulse.com'",
  "ALTER TABLE email_settings ADD COLUMN reminder_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN reminder_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN reminder_days_before_due INTEGER NOT NULL DEFAULT 3",
  "ALTER TABLE email_settings ADD COLUMN submission_reminder_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN monthly_digest_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN monthly_digest_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN monthly_digest_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN monthly_digest_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN threshold_alert_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN threshold_alert_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN threshold_alert_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN threshold_alert_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN submission_notification_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN submission_notification_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN submission_notification_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN submission_notification_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN invitation_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN invitation_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN plan_reminder_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN plan_reminder_month INTEGER NOT NULL DEFAULT 12",
  "ALTER TABLE email_settings ADD COLUMN plan_reminder_day INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN plan_due_month INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN plan_due_day INTEGER NOT NULL DEFAULT 31",
  "ALTER TABLE email_settings ADD COLUMN plan_reminder_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN plan_reminder_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN plan_submitted_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN plan_submitted_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN plan_submitted_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN updated_at TEXT",
  "ALTER TABLE email_settings ADD COLUMN submission_due_days INTEGER NOT NULL DEFAULT 15",
  // periods
  "ALTER TABLE periods ADD COLUMN due_date TEXT",
  // threshold_rules
  "ALTER TABLE threshold_rules ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
  // user_access_scopes (CREATE, not ALTER)
  `CREATE TABLE IF NOT EXISTS user_access_scopes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    firm_id TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  )`,
  // kpi_plans
  `CREATE TABLE IF NOT EXISTS kpi_plans (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    granularity TEXT NOT NULL DEFAULT 'annual',
    version INTEGER NOT NULL DEFAULT 1,
    submitted_by_user_id TEXT,
    submitted_at TEXT,
    note TEXT,
    investor_note TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  )`,
  // kpi_plan_values
  `CREATE TABLE IF NOT EXISTS kpi_plan_values (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    kpi_definition_id TEXT NOT NULL,
    period_month INTEGER,
    value REAL,
    investor_comment TEXT
  )`,
];

let applied = 0;
let skipped = 0;
for (const sql of migrations) {
  try {
    db.exec(sql);
    applied++;
  } catch (e) {
    if (e.message.includes("duplicate column") || e.message.includes("already exists")) {
      skipped++;
    } else {
      console.error("ERROR:", e.message, "\nSQL:", sql.slice(0, 80));
    }
  }
}

console.log(`Done. Applied: ${applied}, Skipped (already exist): ${skipped}`);
