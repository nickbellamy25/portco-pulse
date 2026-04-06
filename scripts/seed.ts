/**
 * Seed script for PortCo Pulse v2 — fully self-contained, no CSV required.
 * Run with: pnpm db:seed  (or pnpm db:reset to wipe+reseed)
 */

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed script must not be run in production.");
}

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../lib/db/schema";
import { eq, and, isNull, desc, notInArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import path from "path";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Deterministic noise in [-1, 1] based on string seed */
function noise(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  }
  return ((Math.abs(h) % 10000) / 10000) * 2 - 1;
}

/** Apply noise up to ±pct% to a base value */
function jitter(base: number, pctMax: number, seed: string): number {
  return base * (1 + (noise(seed) * pctMax) / 100);
}

function r(n: number, dp = 0): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

// ─── DB SETUP ─────────────────────────────────────────────────────────────────

const dbPath = path.join(process.cwd(), "portco-pulse.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

console.log("Running migrations...");
migrate(db, { migrationsFolder: "./drizzle" });

// Apply manual migrations (columns/tables not tracked by Drizzle)
const manualMigrations = [
  "ALTER TABLE companies ADD COLUMN status TEXT NOT NULL DEFAULT 'current'",
  "ALTER TABLE companies ADD COLUMN fund TEXT",
  "ALTER TABLE companies ADD COLUMN industry TEXT",
  "ALTER TABLE companies ADD COLUMN timezone TEXT",
  "ALTER TABLE companies ADD COLUMN required_docs TEXT",
  "ALTER TABLE companies ADD COLUMN submission_due_days INTEGER",
  "ALTER TABLE companies ADD COLUMN plan_due_month INTEGER",
  "ALTER TABLE companies ADD COLUMN plan_due_day INTEGER",
  "ALTER TABLE companies ADD COLUMN alert_cc_emails TEXT",
  "ALTER TABLE companies ADD COLUMN submission_cc_emails TEXT",
  "ALTER TABLE companies ADD COLUMN company_email_settings TEXT",
  "ALTER TABLE users ADD COLUMN persona TEXT NOT NULL DEFAULT 'investor'",
  "ALTER TABLE users ADD COLUMN company_id TEXT REFERENCES companies(id)",
  "ALTER TABLE users ADD COLUMN invite_token TEXT",
  "ALTER TABLE users ADD COLUMN invite_token_expires_at INTEGER",
  "ALTER TABLE kpi_definitions ADD COLUMN scope TEXT NOT NULL DEFAULT 'standard'",
  "ALTER TABLE kpi_definitions ADD COLUMN company_id TEXT",
  "ALTER TABLE kpi_definitions ADD COLUMN description TEXT",
  "ALTER TABLE kpi_definitions ADD COLUMN display_order INTEGER NOT NULL DEFAULT 99",
  "ALTER TABLE kpi_definitions ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE kpi_definitions ADD COLUMN plan_granularity TEXT NOT NULL DEFAULT 'annual'",
  "ALTER TABLE kpi_definitions ADD COLUMN rag_direction TEXT NOT NULL DEFAULT 'higher_is_better'",
  "ALTER TABLE kpi_definitions ADD COLUMN rag_green_pct REAL NOT NULL DEFAULT 5",
  "ALTER TABLE kpi_definitions ADD COLUMN rag_amber_pct REAL NOT NULL DEFAULT 15",
  "ALTER TABLE submissions ADD COLUMN note TEXT",
  "ALTER TABLE kpi_values ADD COLUMN note TEXT",
  "ALTER TABLE kpi_values ADD COLUMN investor_note TEXT",
  "ALTER TABLE kpi_values ADD COLUMN rag_override TEXT",
  "ALTER TABLE kpi_values ADD COLUMN rag_override_reason TEXT",
  "ALTER TABLE email_settings ADD COLUMN reminder_days_before_due INTEGER NOT NULL DEFAULT 3",
  "ALTER TABLE email_settings ADD COLUMN submission_due_days INTEGER NOT NULL DEFAULT 15",
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
  "ALTER TABLE email_settings ADD COLUMN plan_reminder_days_before_due INTEGER NOT NULL DEFAULT 30",
  "ALTER TABLE email_settings ADD COLUMN investor_note_notification_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN investor_note_notification_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN investor_note_notification_body TEXT",
  "ALTER TABLE periods ADD COLUMN due_date TEXT",
  "ALTER TABLE threshold_rules ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
  `CREATE TABLE IF NOT EXISTS user_access_scopes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    firm_id TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  )`,
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
  `CREATE TABLE IF NOT EXISTS kpi_plan_values (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    kpi_definition_id TEXT NOT NULL,
    period_month INTEGER,
    value REAL,
    investor_comment TEXT
  )`,
  "ALTER TABLE kpi_definitions ADD COLUMN collection_cadence TEXT NOT NULL DEFAULT 'monthly'",
  `CREATE TABLE IF NOT EXISTS kpi_cadence_overrides (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL REFERENCES firms(id),
    company_id TEXT NOT NULL REFERENCES companies(id),
    kpi_definition_id TEXT NOT NULL REFERENCES kpi_definitions(id),
    collection_cadence TEXT NOT NULL,
    UNIQUE(company_id, kpi_definition_id)
  )`,
  "ALTER TABLE kpi_definitions ADD COLUMN rag_alert_on_amber INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE kpi_definitions ADD COLUMN rag_alert_on_red INTEGER NOT NULL DEFAULT 1",
  `CREATE TABLE IF NOT EXISTS kpi_alert_overrides (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL REFERENCES firms(id),
    company_id TEXT NOT NULL REFERENCES companies(id),
    kpi_definition_id TEXT NOT NULL REFERENCES kpi_definitions(id),
    rag_alert_on_amber INTEGER NOT NULL,
    rag_alert_on_red INTEGER NOT NULL,
    UNIQUE(company_id, kpi_definition_id)
  )`,
  `CREATE TABLE IF NOT EXISTS kpi_rag_overrides (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL REFERENCES firms(id),
    company_id TEXT NOT NULL REFERENCES companies(id),
    kpi_definition_id TEXT NOT NULL REFERENCES kpi_definitions(id),
    rag_green_pct REAL NOT NULL,
    rag_amber_pct REAL NOT NULL,
    rag_direction TEXT NOT NULL,
    UNIQUE(company_id, kpi_definition_id)
  )`,
  "ALTER TABLE companies ADD COLUMN investment_date TEXT",
  "ALTER TABLE companies ADD COLUMN onboarding_status TEXT",
  "ALTER TABLE companies ADD COLUMN onboarding_completed_at TEXT",
  "ALTER TABLE companies ADD COLUMN onboarding_request_sent_at TEXT",
  `CREATE TABLE IF NOT EXISTS onboarding_documents (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL REFERENCES firms(id),
    company_id TEXT NOT NULL REFERENCES companies(id),
    file_name TEXT NOT NULL,
    file_path TEXT,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "ALTER TABLE companies ADD COLUMN required_doc_cadences TEXT",
  "ALTER TABLE companies ADD COLUMN due_days_monthly INTEGER",
  "ALTER TABLE companies ADD COLUMN due_days_quarterly INTEGER",
  "ALTER TABLE companies ADD COLUMN due_days_bi_annual INTEGER",
  "ALTER TABLE companies ADD COLUMN due_days_annual INTEGER",
  "ALTER TABLE companies ADD COLUMN reminder_days_before_due INTEGER",
  "ALTER TABLE email_settings ADD COLUMN due_days_monthly INTEGER NOT NULL DEFAULT 15",
  "ALTER TABLE email_settings ADD COLUMN due_days_quarterly INTEGER NOT NULL DEFAULT 30",
  "ALTER TABLE email_settings ADD COLUMN due_days_annual INTEGER NOT NULL DEFAULT 60",
  "ALTER TABLE email_settings ADD COLUMN due_days_bi_annual INTEGER NOT NULL DEFAULT 45",
  "ALTER TABLE email_settings ADD COLUMN submission_reminder_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN plan_reminder_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN kpi_override_notification_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN kpi_override_notification_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN kpi_override_notification_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN kpi_override_notification_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN rag_alert_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN rag_alert_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN rag_alert_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN rag_alert_body TEXT",
  "ALTER TABLE email_settings ADD COLUMN firm_required_docs TEXT",
  "ALTER TABLE email_settings ADD COLUMN firm_required_doc_cadences TEXT",
  "ALTER TABLE email_settings ADD COLUMN submission_notification_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN submission_reminder_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN rag_alert_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN threshold_alert_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN kpi_override_notification_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN investor_note_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN monthly_digest_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN submission_voided_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN submission_voided_in_app_enabled INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_settings ADD COLUMN submission_voided_recipients TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE email_settings ADD COLUMN submission_voided_subject TEXT",
  "ALTER TABLE email_settings ADD COLUMN submission_voided_body TEXT",
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL REFERENCES firms(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link_url TEXT,
    company_id TEXT REFERENCES companies(id),
    period_month TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS notifications_firm_id_idx ON notifications(firm_id)`,
  // Chat submission tables
  "ALTER TABLE submissions ADD COLUMN extraction_source TEXT DEFAULT 'form'",
  `CREATE TABLE IF NOT EXISTS pending_submissions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    token TEXT NOT NULL,
    submission_type TEXT NOT NULL,
    period TEXT,
    fiscal_year INTEGER,
    extracted_payload TEXT NOT NULL,
    missing_kpis TEXT,
    extraction_source TEXT NOT NULL DEFAULT 'chat',
    operator_confirmed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending_review',
    reviewed_by TEXT,
    reviewed_at INTEGER,
    review_notes TEXT,
    submitted_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    company_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_session_key_idx ON chat_messages(session_key)`,
  // Periodic submission versioning + investor note
  `ALTER TABLE submissions ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE submissions ADD COLUMN investor_note TEXT`,
  `DROP INDEX IF EXISTS submissions_company_period_idx`,
  `CREATE UNIQUE INDEX IF NOT EXISTS submissions_company_period_version_idx ON submissions(company_id, period_id, version)`,
  // Learned submission preferences from chat sessions
  `ALTER TABLE companies ADD COLUMN submission_notes TEXT`,
  // Submitter attribution for chat-based pending submissions
  `ALTER TABLE pending_submissions ADD COLUMN submitted_by_user_id TEXT REFERENCES users(id)`,
];

for (const sql of manualMigrations) {
  try { sqlite.exec(sql); } catch (e: any) {
    if (!e.message?.includes("duplicate column") && !e.message?.includes("already exists")) {
      console.warn("Migration warning:", e.message?.slice(0, 80));
    }
  }
}
console.log("Migrations complete.");

// ─── COMPANY PROFILE DEFINITIONS ──────────────────────────────────────────────

/** revenue(monthIdx) returns base revenue for month 0=Jan2023, 1=Feb2023, … */
type Profile = {
  revenue: (idx: number) => number;
  grossMarginPct: (idx: number) => number;
  ebitdaMarginPct: (idx: number) => number; // of revenue
  cashBalance: (idx: number) => number;
  capex: (idx: number) => number;
  ocf: (idx: number) => number;
  workingCapital: (idx: number) => number;
  headcount: (idx: number) => number;
  // firm-wide custom KPIs (null = not tracked)
  churnRate?: (idx: number) => number | null;
  inventoryDays?: (idx: number) => number | null;
  npsScore?: (idx: number) => number | null;
  cac?: (idx: number) => number | null;
  employeeTurnover?: (idx: number) => number | null;
};

const INDUSTRIAL_SEASON = [0.94, 0.95, 1.01, 1.06, 1.09, 1.07, 1.04, 1.03, 1.02, 0.99, 0.96, 0.84];
const HEALTHCARE_SEASON = [1.01, 0.97, 1.00, 1.01, 1.01, 0.98, 0.97, 0.98, 1.01, 1.02, 1.01, 1.02];
const LOGISTICS_SEASON  = [0.95, 0.96, 1.01, 1.04, 1.06, 1.02, 0.99, 1.00, 1.03, 1.05, 1.06, 1.03];
const SAAS_SEASON       = [1.00, 0.98, 1.00, 1.01, 1.01, 0.99, 0.98, 0.99, 1.01, 1.01, 1.02, 0.99];
const FITNESS_SEASON    = [1.14, 1.08, 1.04, 0.99, 0.96, 0.91, 0.87, 0.88, 0.96, 1.00, 1.05, 1.09]; // Jan surge
const FINTECH_SEASON    = [0.94, 0.96, 1.00, 1.03, 1.05, 1.05, 1.04, 1.03, 1.02, 1.00, 0.98, 0.94];
const MEDIA_SEASON      = [0.95, 0.93, 0.97, 0.99, 1.00, 1.01, 1.04, 1.04, 1.06, 1.07, 1.09, 1.08];
const RESTAURANT_SEASON = [1.04, 0.93, 0.96, 0.99, 1.01, 0.97, 0.94, 0.95, 1.00, 1.02, 1.05, 1.13];

function growRev(base: number, monthlyGrowth: number, season: number[], idx: number): number {
  const month = idx % 12; // 0=Jan
  return base * Math.pow(1 + monthlyGrowth, idx) * season[month];
}

// FY2026 revenue for Evergreen is intentionally suppressed (club delays)
function evergreenRev(idx: number): number {
  const base = growRev(685000, 0.006, FITNESS_SEASON, idx);
  // 2026 months (idx 36+): new clubs delayed → revenue flat vs budget
  if (idx >= 36) return base * 0.80; // 20% below "expected"
  return base;
}

const PROFILES: Record<string, Profile> = {
  "apex-industrial-manufacturing": {
    revenue: (i) => growRev(2870000, 0.0042, INDUSTRIAL_SEASON, i),
    grossMarginPct: (i) => Math.min(31, 23.5 + i * 0.025),
    ebitdaMarginPct: (i) => Math.min(21, 17.5 + i * 0.018),
    cashBalance: (i) => 5200000 + i * 35000 + jitter(200000, 8, `apex-cash-${i}`),
    capex: (i) => {
      const base = 148000;
      const m = i % 12;
      return base * (m >= 3 && m <= 8 ? 1.4 : 0.85) + jitter(20000, 10, `apex-capex-${i}`);
    },
    ocf: (i) => growRev(310000, 0.004, INDUSTRIAL_SEASON, i) * 0.92,
    workingCapital: (i) => 2400000 + i * 8000 + jitter(100000, 5, `apex-wc-${i}`),
    headcount: (i) => Math.round(178 + (i / 12) * 6),
    churnRate: (i) => r(3.2 - i * 0.01 + jitter(0.3, 15, `apex-churn-${i}`), 1),
    inventoryDays: (i) => r(42 + jitter(4, 8, `apex-inv-${i}`), 0),
    npsScore: (i) => r(62 + i * 0.1 + jitter(3, 5, `apex-nps-${i}`), 0),
    cac: () => null,
    employeeTurnover: (i) => r(8.5 + jitter(1, 10, `apex-turn-${i}`), 1),
  },

  "brighton-healthcare-group": {
    revenue: (i) => growRev(7350000, 0.0035, HEALTHCARE_SEASON, i),
    grossMarginPct: (i) => Math.min(44, 37.5 + i * 0.03),
    ebitdaMarginPct: (i) => Math.min(16, 11.5 + i * 0.02),
    cashBalance: (i) => 10500000 + i * 60000 + jitter(400000, 6, `brgh-cash-${i}`),
    capex: (i) => 195000 + jitter(25000, 12, `brgh-capex-${i}`),
    ocf: (i) => growRev(680000, 0.003, HEALTHCARE_SEASON, i),
    workingCapital: (i) => 4200000 + i * 15000 + jitter(200000, 4, `brgh-wc-${i}`),
    headcount: (i) => Math.round(362 + (i / 12) * 10),
    churnRate: () => null,
    inventoryDays: () => null,
    npsScore: (i) => r(74 + i * 0.12 + jitter(2, 3, `brgh-nps-${i}`), 0),
    cac: () => null,
    employeeTurnover: (i) => r(12.5 + jitter(1.5, 8, `brgh-turn-${i}`), 1),
  },

  "keystone-logistics": {
    revenue: (i) => {
      const base = growRev(4050000, 0.005, LOGISTICS_SEASON, i);
      // 2026: fuel headwind suppresses margin but revenue is ok
      return base;
    },
    grossMarginPct: (i) => {
      const base = 22.5 - i * 0.01;
      // 2026: fuel hits margin harder
      if (i >= 36) return base - 2.0 + jitter(0.5, 5, `kl-gm-${i}`);
      return base + jitter(0.5, 5, `kl-gm-${i}`);
    },
    ebitdaMarginPct: (i) => {
      const base = 9.0;
      if (i >= 36) return Math.max(4, base - 2.5 + jitter(0.3, 8, `kl-ebitda-m-${i}`));
      return base + jitter(0.4, 8, `kl-ebitda-m-${i}`);
    },
    cashBalance: (i) => 3100000 + i * 18000 + jitter(150000, 7, `kl-cash-${i}`),
    capex: (i) => 195000 + jitter(30000, 15, `kl-capex-${i}`),
    ocf: (i) => {
      const base = growRev(230000, 0.004, LOGISTICS_SEASON, i);
      if (i >= 36) return base * 0.65 + jitter(20000, 10, `kl-ocf-${i}`);
      return base + jitter(20000, 10, `kl-ocf-${i}`);
    },
    workingCapital: (i) => 1800000 + i * 6000 + jitter(80000, 6, `kl-wc-${i}`),
    headcount: (i) => Math.round(127 + (i / 12) * 7),
    churnRate: () => null,
    inventoryDays: () => null,
    npsScore: (i) => r(55 + jitter(3, 5, `kl-nps-${i}`), 0),
    cac: () => null,
    employeeTurnover: (i) => r(14.0 + jitter(1.5, 8, `kl-turn-${i}`), 1),
  },

  "veridian-software": {
    revenue: (i) => growRev(1210000, 0.013, SAAS_SEASON, i),
    grossMarginPct: (i) => Math.min(82, 70.5 + i * 0.08),
    ebitdaMarginPct: (i) => Math.min(28, 16.0 + i * 0.12),
    cashBalance: (i) => {
      // Raised $8M in mid-2024 (month 18)
      const raise = i >= 18 ? 8000000 : 0;
      return 6200000 + raise + i * 45000 + jitter(300000, 5, `ver-cash-${i}`);
    },
    capex: (i) => 28000 + jitter(5000, 10, `ver-capex-${i}`),
    ocf: (i) => growRev(185000, 0.012, SAAS_SEASON, i),
    workingCapital: (i) => 2800000 + i * 30000 + jitter(150000, 5, `ver-wc-${i}`),
    headcount: (i) => Math.round(47 + (i / 12) * 12),
    churnRate: (i) => r(Math.max(1.5, 4.8 - i * 0.05) + jitter(0.3, 10, `ver-churn-${i}`), 1),
    inventoryDays: () => null,
    npsScore: (i) => r(68 + i * 0.15 + jitter(3, 4, `ver-nps-${i}`), 0),
    cac: (i) => r(growRev(3400, -0.004, SAAS_SEASON, i), 0),
    employeeTurnover: (i) => r(9.5 + jitter(1, 8, `ver-turn-${i}`), 1),
  },

  "evergreen-fitness": {
    revenue: evergreenRev,
    grossMarginPct: (i) => Math.min(66, 57.5 + i * 0.03),
    ebitdaMarginPct: (i) => {
      const base = 8.5 + i * 0.01;
      // 2026: pre-opening costs hit hard
      if (i >= 36) return Math.max(-5, base - 9 + jitter(0.5, 10, `eg-ebitda-m-${i}`));
      return base + jitter(0.4, 8, `eg-ebitda-m-${i}`);
    },
    cashBalance: (i) => Math.max(600000, 1550000 - (i >= 36 ? (i - 36) * 120000 : 0) + jitter(80000, 6, `eg-cash-${i}`)),
    capex: (i) => {
      if (i >= 36) return 380000 + jitter(40000, 12, `eg-capex-${i}`); // new club buildouts
      return 95000 + jitter(12000, 12, `eg-capex-${i}`);
    },
    ocf: (i) => {
      const base = growRev(48000, 0.004, FITNESS_SEASON, i);
      if (i >= 36) return base - 90000 + jitter(8000, 15, `eg-ocf-${i}`);
      return base + jitter(8000, 15, `eg-ocf-${i}`);
    },
    workingCapital: (i) => Math.max(200000, 820000 - (i >= 36 ? (i - 36) * 40000 : 0) + jitter(40000, 6, `eg-wc-${i}`)),
    headcount: (i) => Math.round(85 + (i / 12) * 10),
    churnRate: (i) => r(Math.max(2, 8.5 - i * 0.04) + jitter(0.6, 8, `eg-churn-${i}`), 1),
    inventoryDays: () => null,
    npsScore: (i) => r(58 + i * 0.08 + jitter(3, 6, `eg-nps-${i}`), 0),
    cac: (i) => r(185 + jitter(20, 8, `eg-cac-${i}`), 0),
    employeeTurnover: (i) => r(18.5 + jitter(2, 10, `eg-turn-${i}`), 1),
  },

  "optifi-solutions": {
    revenue: (i) => {
      const base = growRev(1610000, 0.007, FINTECH_SEASON, i);
      // 2026: new institutional channel slower to ramp
      if (i >= 36) return base * 0.92 + jitter(40000, 4, `opt-rev-${i}`);
      return base + jitter(40000, 4, `opt-rev-${i}`);
    },
    grossMarginPct: (i) => Math.min(74, 63.5 + i * 0.06),
    ebitdaMarginPct: (i) => Math.min(27, 20.5 + i * 0.05),
    cashBalance: (i) => 4600000 + i * 25000 + jitter(200000, 5, `opt-cash-${i}`),
    capex: (i) => 52000 + jitter(8000, 10, `opt-capex-${i}`),
    ocf: (i) => growRev(272000, 0.007, FINTECH_SEASON, i) * 0.88,
    workingCapital: (i) => 2200000 + i * 12000 + jitter(100000, 5, `opt-wc-${i}`),
    headcount: (i) => Math.round(63 + (i / 12) * 9),
    churnRate: (i) => r(Math.max(1, 3.8 - i * 0.03) + jitter(0.3, 8, `opt-churn-${i}`), 1),
    inventoryDays: () => null,
    npsScore: (i) => r(71 + i * 0.1 + jitter(2, 3, `opt-nps-${i}`), 0),
    cac: (i) => r(growRev(2800, -0.003, FINTECH_SEASON, i), 0),
    employeeTurnover: (i) => r(10.5 + jitter(1.2, 8, `opt-turn-${i}`), 1),
  },

  "streamvibe-media": {
    revenue: (i) => growRev(962000, 0.005, MEDIA_SEASON, i) + jitter(50000, 6, `sv-rev-${i}`),
    grossMarginPct: (i) => 46.5 + jitter(3, 6, `sv-gm-${i}`),
    ebitdaMarginPct: (i) => 10.5 + jitter(2, 12, `sv-ebitda-m-${i}`),
    cashBalance: (i) => 2100000 + i * 10000 + jitter(120000, 8, `sv-cash-${i}`),
    capex: (i) => 78000 + jitter(15000, 15, `sv-capex-${i}`),
    ocf: (i) => 90000 + jitter(20000, 18, `sv-ocf-${i}`),
    workingCapital: (i) => 950000 + jitter(60000, 8, `sv-wc-${i}`),
    headcount: (i) => Math.round(53 + (i / 12) * 5),
    churnRate: (i) => r(5.5 + jitter(0.8, 10, `sv-churn-${i}`), 1),
    inventoryDays: () => null,
    npsScore: (i) => r(52 + jitter(4, 6, `sv-nps-${i}`), 0),
    cac: (i) => r(42 + jitter(8, 10, `sv-cac-${i}`), 0),
    employeeTurnover: (i) => r(16.5 + jitter(2, 10, `sv-turn-${i}`), 1),
  },

  "culinary-concepts": {
    revenue: (i) => growRev(528000, 0.003, RESTAURANT_SEASON, i) + jitter(25000, 6, `cc-rev-${i}`),
    grossMarginPct: (i) => 63.5 + jitter(2, 5, `cc-gm-${i}`),
    ebitdaMarginPct: (i) => 9.5 + jitter(1.5, 10, `cc-ebitda-m-${i}`),
    cashBalance: (i) => 840000 + i * 4000 + jitter(50000, 8, `cc-cash-${i}`),
    capex: (i) => 28000 + jitter(6000, 15, `cc-capex-${i}`),
    ocf: (i) => 38000 + jitter(8000, 18, `cc-ocf-${i}`),
    workingCapital: (i) => 380000 + jitter(30000, 8, `cc-wc-${i}`),
    headcount: (i) => Math.round(63 + (i / 12) * 3),
    churnRate: () => null,
    inventoryDays: (i) => r(12 + jitter(2, 8, `cc-inv-${i}`), 0),
    npsScore: (i) => r(66 + jitter(4, 5, `cc-nps-${i}`), 0),
    cac: () => null,
    employeeTurnover: (i) => r(22.0 + jitter(3, 10, `cc-turn-${i}`), 1),
  },
};

// ─── SEED ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log("Seeding database...");

  // ── Create placeholder file for financial docs ─────────────────────────────
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  const placeholderPath = path.join(uploadsDir, "seed-placeholder.txt");
  if (!existsSync(placeholderPath)) {
    writeFileSync(placeholderPath, "[Placeholder document — seeded for demo]\n");
  }
  const DOC_PATH = "uploads/seed-placeholder.txt";

  // ── FIRM ──────────────────────────────────────────────────────────────────
  const firmId = crypto.randomUUID();
  db.insert(schema.firms).values({ id: firmId, name: "Meridian Capital Partners", orgType: "pe_firm" }).run();

  db.insert(schema.emailSettings).values({
    firmId,
    fromEmail: "reporting@meridiancp.com",
    fromName: "Meridian Capital Partners",
    reminderSubject: "Action Required: Submission Due — {{company_name}}",
    reminderBody: `Dear {{company_name}},\n\nThis is a reminder that your submission is due by {{due_date}}.\n\nMissing documents:\n{{missing_docs}}\n\nSubmit here:\n{{submission_link}}\n\nThank you,\nMeridian Capital Partners`,
    submissionNotificationRecipients: "nicholasmbellamy@gmail.com",
    submissionNotificationSubject: "New Submission Received — {{company_name}}",
    submissionNotificationBody: `{{company_name}} has submitted new data.\n\nSubmitted by: {{submitted_by}}\nSubmission time: {{submission_time}}\n\nView details: {{dashboard_link}}`,
    submissionVoidedRecipients: "nicholasmbellamy@gmail.com",
    submissionVoidedSubject: "Submission Voided — {{company_name}}",
    submissionVoidedBody: `The {{period}} submission from {{company_name}} has been voided and removed from the platform.\n\nVoided on: {{voided_date}}\n\nView submission history: {{dashboard_link}}`,
    monthlyDigestRecipients: "nicholasmbellamy@gmail.com",
    thresholdAlertRecipients: "nicholasmbellamy@gmail.com",
    planSubmittedRecipients: "nicholasmbellamy@gmail.com",
  }).run();
  console.log("Created firm");

  // ── COMPANIES ─────────────────────────────────────────────────────────────
  const COMPANY_META: Array<{
    slug: string; name: string; industry: string; fund: string | null;
    requiredDocs: string; timezone: string;
    ragIntent26: "green" | "amber" | "red" | null;
    revMultiplier26: number; ebitdaMultiplier26: number;
    investmentDate: string | null;
    onboardingStatus?: "pending" | "in_progress" | "complete";
  }> = [
    {
      slug: "apex-industrial-manufacturing", name: "Apex Industrial Manufacturing",
      industry: "Industrial", fund: "Fund I",
      requiredDocs: "balance_sheet,income_statement,cash_flow_statement",
      timezone: "America/Chicago",
      ragIntent26: "green", revMultiplier26: 1.02, ebitdaMultiplier26: 1.03,
      investmentDate: "2021-03-15",
    },
    {
      slug: "brighton-healthcare-group", name: "Brighton Healthcare Group",
      industry: "Healthcare", fund: "Fund I",
      requiredDocs: "balance_sheet,income_statement,cash_flow_statement,investor_update",
      timezone: "America/New_York",
      ragIntent26: "green", revMultiplier26: 0.96, ebitdaMultiplier26: 0.94,
      investmentDate: "2021-09-08",
    },
    {
      slug: "keystone-logistics", name: "Keystone Logistics",
      industry: "Logistics", fund: "Fund II",
      requiredDocs: "balance_sheet,income_statement,cash_flow_statement",
      timezone: "America/Chicago",
      ragIntent26: "amber", revMultiplier26: 1.10, ebitdaMultiplier26: 1.16,
      investmentDate: "2022-02-01",
    },
    {
      slug: "veridian-software", name: "Veridian Software",
      industry: "Software / SaaS", fund: "Fund II",
      requiredDocs: "income_statement,investor_update",
      timezone: "America/Los_Angeles",
      ragIntent26: "green", revMultiplier26: 0.94, ebitdaMultiplier26: 0.92,
      investmentDate: "2022-05-20",
    },
    {
      slug: "evergreen-fitness", name: "Evergreen Fitness",
      industry: "Consumer Discretionary", fund: "Fund III",
      requiredDocs: "income_statement",
      timezone: "America/Denver",
      ragIntent26: "red", revMultiplier26: 1.26, ebitdaMultiplier26: 1.40,
      investmentDate: "2022-11-03",
    },
    {
      slug: "optifi-solutions", name: "OptiFi Solutions",
      industry: "FinTech", fund: "Fund III",
      requiredDocs: "balance_sheet,income_statement,cash_flow_statement",
      timezone: "America/New_York",
      ragIntent26: "amber", revMultiplier26: 1.08, ebitdaMultiplier26: 1.11,
      investmentDate: "2023-04-17",
    },
    {
      slug: "streamvibe-media", name: "StreamVibe Media",
      industry: "Digital Media", fund: null,
      requiredDocs: "",
      timezone: "America/Los_Angeles",
      ragIntent26: null, revMultiplier26: 0, ebitdaMultiplier26: 0,
      investmentDate: "2023-06-14",
      onboardingStatus: "pending",
    },
    {
      slug: "culinary-concepts", name: "Culinary Concepts",
      industry: "Consumer Services", fund: null,
      requiredDocs: "",
      timezone: "America/Chicago",
      ragIntent26: null, revMultiplier26: 0, ebitdaMultiplier26: 0,
      investmentDate: "2023-09-01",
      onboardingStatus: "in_progress",
    },
  ];

  const companyIds: Record<string, string> = {};
  for (const c of COMPANY_META) {
    const id = crypto.randomUUID();
    companyIds[c.slug] = id;
    db.insert(schema.companies).values({
      id, firmId, name: c.name, slug: c.slug,
      industry: c.industry, fund: c.fund,
      status: "current",
      timezone: c.timezone,
      requiredDocs: c.requiredDocs || null,
      investmentDate: c.investmentDate ?? null,
      onboardingStatus: c.onboardingStatus ?? null,
      submissionToken: generateToken(),
    } as any).run();
  }
  console.log("Created companies");

  // ── ONBOARDING DOCUMENTS (seed demo data for Culinary Concepts) ───────────
  const culinaryId = companyIds["culinary-concepts"];
  if (culinaryId) {
    db.run(`INSERT INTO onboarding_documents (id, firm_id, company_id, file_name, file_path, uploaded_at) VALUES
      ('${crypto.randomUUID()}', '${firmId}', '${culinaryId}', 'Culinary_Concepts_Overview.pdf', NULL, '2023-09-12 09:14:00'),
      ('${crypto.randomUUID()}', '${firmId}', '${culinaryId}', 'Historical_P&L_2021-2023.xlsx', NULL, '2023-09-15 14:30:00')
    `);
  }

  // ── USERS ─────────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash("admin123", 12);
  const memberHash = await bcrypt.hash("member123", 12);
  const opHash = await bcrypt.hash("operator123", 12);

  const adminUserId = crypto.randomUUID();
  db.insert(schema.users).values({
    id: adminUserId, firmId,
    email: "nicholasmbellamy@gmail.com", passwordHash: adminHash,
    name: "Nicholas Bellamy", role: "firm_admin", persona: "investor",
  }).run();

  const memberId = crypto.randomUUID();
  db.insert(schema.users).values({
    id: memberId, firmId,
    email: "member@meridiancp.com", passwordHash: memberHash,
    name: "Sarah Chen", role: "firm_member", persona: "investor",
  }).run();

  const opUsers: Array<{ slug: string; email: string; name: string }> = [
    { slug: "apex-industrial-manufacturing", email: "john.davis@apex-industrial.com", name: "John Davis" },
    { slug: "brighton-healthcare-group", email: "emily.white@brighton-health.com", name: "Emily White" },
    { slug: "keystone-logistics", email: "mike.johnson@keystonelog.com", name: "Mike Johnson" },
    { slug: "veridian-software", email: "cto@veridian.io", name: "Rachel Park" },
    { slug: "evergreen-fitness", email: "cfo@evergreenfitness.com", name: "Tom Barrett" },
    { slug: "optifi-solutions", email: "finance@optifi.com", name: "Priya Sharma" },
  ];
  const opUserIds: Record<string, string> = {};
  for (const op of opUsers) {
    const id = crypto.randomUUID();
    opUserIds[op.slug] = id;
    db.insert(schema.users).values({
      id, firmId, companyId: companyIds[op.slug],
      email: op.email, passwordHash: opHash,
      name: op.name, role: "company_admin", persona: "operator",
    }).run();
  }
  console.log("Created users");

  // ── KPI DEFINITIONS ───────────────────────────────────────────────────────
  // Standard KPIs with RAG criteria
  const standardKpiDefs: Array<{
    key: string; label: string; section: string; unit: string;
    valueType: "currency" | "percent" | "integer";
    isRequired: boolean; displayOrder: number;
    ragDirection: "higher_is_better" | "lower_is_better";
    ragGreenPct: number; ragAmberPct: number;
    planGranularity?: string;
  }> = [
    { key: "revenue", label: "Revenue", section: "Finance", unit: "$", valueType: "currency", isRequired: true, displayOrder: 1, ragDirection: "higher_is_better", ragGreenPct: 5, ragAmberPct: 15, planGranularity: "monthly" },
    { key: "gross_margin", label: "Gross Margin", section: "Finance", unit: "%", valueType: "percent", isRequired: true, displayOrder: 2, ragDirection: "higher_is_better", ragGreenPct: 3, ragAmberPct: 8, planGranularity: "monthly" },
    { key: "ebitda", label: "EBITDA", section: "Finance", unit: "$", valueType: "currency", isRequired: true, displayOrder: 3, ragDirection: "higher_is_better", ragGreenPct: 8, ragAmberPct: 20, planGranularity: "monthly" },
    { key: "cash_balance", label: "Cash Balance", section: "Finance", unit: "$", valueType: "currency", isRequired: true, displayOrder: 4, ragDirection: "higher_is_better", ragGreenPct: 10, ragAmberPct: 25, planGranularity: "monthly" },
    { key: "capex", label: "CapEx", section: "Finance", unit: "$", valueType: "currency", isRequired: false, displayOrder: 5, ragDirection: "lower_is_better", ragGreenPct: 10, ragAmberPct: 25, planGranularity: "monthly" },
    { key: "operating_cash_flow", label: "Operating Cash Flow", section: "Finance", unit: "$", valueType: "currency", isRequired: true, displayOrder: 6, ragDirection: "higher_is_better", ragGreenPct: 10, ragAmberPct: 25, planGranularity: "monthly" },
    { key: "headcount", label: "Headcount", section: "Operations", unit: "#", valueType: "integer", isRequired: true, displayOrder: 7, ragDirection: "any_variance" as any, ragGreenPct: 5, ragAmberPct: 15, planGranularity: "quarterly_end" },
  ];

  const kpiDefIds: Record<string, string> = {};
  for (const kpi of standardKpiDefs) {
    const id = crypto.randomUUID();
    kpiDefIds[kpi.key] = id;
    db.insert(schema.kpiDefinitions).values({
      id, firmId, scope: "standard", companyId: null,
      key: kpi.key, label: kpi.label, section: kpi.section,
      unit: kpi.unit, valueType: kpi.valueType,
      isRequired: kpi.isRequired, displayOrder: kpi.displayOrder, active: true,
      ragDirection: kpi.ragDirection, ragGreenPct: kpi.ragGreenPct, ragAmberPct: kpi.ragAmberPct,
      planGranularity: kpi.planGranularity ?? "annual_total",
    } as any).run();
  }

  // Firm-wide custom KPIs
  const firmCustomKpis: Array<{
    key: string; label: string; section: string; unit: string;
    valueType: "currency" | "percent" | "integer";
    displayOrder: number;
    ragDirection: "higher_is_better" | "lower_is_better";
    ragGreenPct: number; ragAmberPct: number;
    planGranularity?: string;
  }> = [
    { key: "churn_rate", label: "Churn Rate", section: "Operations", unit: "%", valueType: "percent", displayOrder: 10, ragDirection: "lower_is_better", ragGreenPct: 10, ragAmberPct: 25, planGranularity: "quarterly_end" },
    { key: "inventory_days", label: "Inventory Days", section: "Operations", unit: "days", valueType: "integer", displayOrder: 11, ragDirection: "lower_is_better", ragGreenPct: 10, ragAmberPct: 20, planGranularity: "annual_end" },
    { key: "nps_score", label: "NPS Score", section: "Operations", unit: "score", valueType: "integer", displayOrder: 12, ragDirection: "higher_is_better", ragGreenPct: 5, ragAmberPct: 15, planGranularity: "annual_end" },
    { key: "customer_acquisition_cost", label: "Customer Acquisition Cost", section: "Finance", unit: "$", valueType: "currency", displayOrder: 13, ragDirection: "lower_is_better", ragGreenPct: 10, ragAmberPct: 20, planGranularity: "annual_end" },
    { key: "employee_turnover_rate", label: "Employee Turnover Rate", section: "Operations", unit: "%", valueType: "percent", displayOrder: 14, ragDirection: "lower_is_better", ragGreenPct: 10, ragAmberPct: 20, planGranularity: "annual_end" },
  ];

  for (const kpi of firmCustomKpis) {
    const id = crypto.randomUUID();
    kpiDefIds[kpi.key] = id;
    db.insert(schema.kpiDefinitions).values({
      id, firmId, scope: "custom", companyId: null,
      key: kpi.key, label: kpi.label, section: kpi.section,
      unit: kpi.unit, valueType: kpi.valueType,
      isRequired: false, displayOrder: kpi.displayOrder, active: true,
      ragDirection: kpi.ragDirection, ragGreenPct: kpi.ragGreenPct, ragAmberPct: kpi.ragAmberPct,
      planGranularity: kpi.planGranularity ?? "annual_total",
    } as any).run();
  }

  // Company-specific custom KPIs
  const companyKpis: Array<{
    slug: string; key: string; label: string; section: string; unit: string;
    valueType: "currency" | "percent" | "integer"; displayOrder: number;
    planGranularity?: string;
  }> = [
    { slug: "apex-industrial-manufacturing", key: "capacity_utilization", label: "Capacity Utilization", section: "Operations", unit: "%", valueType: "percent", displayOrder: 20, planGranularity: "quarterly_end" },
    { slug: "apex-industrial-manufacturing", key: "on_time_delivery", label: "On-Time Delivery Rate", section: "Operations", unit: "%", valueType: "percent", displayOrder: 21, planGranularity: "monthly" },
    { slug: "brighton-healthcare-group", key: "patient_satisfaction", label: "Patient Satisfaction Score", section: "Operations", unit: "score", valueType: "integer", displayOrder: 20, planGranularity: "annual_end" },
    { slug: "brighton-healthcare-group", key: "bed_occupancy_rate", label: "Bed Occupancy Rate", section: "Operations", unit: "%", valueType: "percent", displayOrder: 21, planGranularity: "quarterly_end" },
    { slug: "keystone-logistics", key: "fleet_utilization", label: "Fleet Utilization", section: "Operations", unit: "%", valueType: "percent", displayOrder: 20, planGranularity: "quarterly_end" },
    { slug: "keystone-logistics", key: "cost_per_mile", label: "Cost Per Mile", section: "Finance", unit: "$", valueType: "currency", displayOrder: 21, planGranularity: "monthly" },
    { slug: "veridian-software", key: "mrr", label: "Monthly Recurring Revenue", section: "Finance", unit: "$", valueType: "currency", displayOrder: 20, planGranularity: "monthly" },
    { slug: "veridian-software", key: "arr", label: "Annual Recurring Revenue", section: "Finance", unit: "$", valueType: "currency", displayOrder: 21, planGranularity: "annual_end" },
    { slug: "evergreen-fitness", key: "member_count", label: "Total Member Count", section: "Operations", unit: "#", valueType: "integer", displayOrder: 20, planGranularity: "quarterly_end" },
    { slug: "evergreen-fitness", key: "new_memberships", label: "New Memberships", section: "Operations", unit: "#", valueType: "integer", displayOrder: 21, planGranularity: "monthly" },
    { slug: "optifi-solutions", key: "aum", label: "Assets Under Management", section: "Finance", unit: "$", valueType: "currency", displayOrder: 20, planGranularity: "quarterly_end" },
    { slug: "optifi-solutions", key: "active_users", label: "Active Users", section: "Operations", unit: "#", valueType: "integer", displayOrder: 21, planGranularity: "quarterly_end" },
    { slug: "streamvibe-media", key: "monthly_active_users", label: "Monthly Active Users", section: "Operations", unit: "#", valueType: "integer", displayOrder: 20, planGranularity: "monthly" },
    { slug: "streamvibe-media", key: "subscriber_count", label: "Subscriber Count", section: "Operations", unit: "#", valueType: "integer", displayOrder: 21, planGranularity: "quarterly_end" },
    { slug: "culinary-concepts", key: "same_store_sales_growth", label: "Same-Store Sales Growth", section: "Finance", unit: "%", valueType: "percent", displayOrder: 20, planGranularity: "monthly" },
    { slug: "culinary-concepts", key: "avg_check_size", label: "Avg Check Size", section: "Finance", unit: "$", valueType: "currency", displayOrder: 21, planGranularity: "annual_end" },
  ];

  const companyKpiDefIds: Record<string, string> = {}; // slug_key → id
  for (const kpi of companyKpis) {
    const companyId = companyIds[kpi.slug];
    if (!companyId) continue;
    const id = crypto.randomUUID();
    companyKpiDefIds[`${kpi.slug}_${kpi.key}`] = id;
    db.insert(schema.kpiDefinitions).values({
      id, firmId, scope: "custom", companyId,
      key: kpi.key, label: kpi.label, section: kpi.section,
      unit: kpi.unit, valueType: kpi.valueType,
      isRequired: false, displayOrder: kpi.displayOrder, active: true,
      planGranularity: kpi.planGranularity ?? "annual_total",
    } as any).run();
  }
  console.log("Created KPI definitions");

  // ── ALERT RULES ───────────────────────────────────────────────────────────
  const alertRules = [
    { key: "revenue", ruleType: "lt" as const, threshold: 500000, severity: "high" as const },
    { key: "gross_margin", ruleType: "lt" as const, threshold: 30, severity: "medium" as const },
    { key: "ebitda", ruleType: "lt" as const, threshold: 0, severity: "high" as const },
    { key: "cash_balance", ruleType: "lt" as const, threshold: 800000, severity: "high" as const },
    { key: "capex", ruleType: "gt" as const, threshold: 500000, severity: "medium" as const },
    { key: "operating_cash_flow", ruleType: "lt" as const, threshold: 0, severity: "high" as const },
    { key: "churn_rate", ruleType: "gt" as const, threshold: 8, severity: "high" as const },
    { key: "employee_turnover_rate", ruleType: "gt" as const, threshold: 25, severity: "medium" as const },
  ];

  for (const r of alertRules) {
    const kpiDefId = kpiDefIds[r.key];
    if (!kpiDefId) continue;
    db.insert(schema.thresholdRules).values({
      firmId, companyId: null, kpiDefinitionId: kpiDefId,
      ruleType: r.ruleType, thresholdValue: r.threshold,
      severity: r.severity, active: true,
    }).run();
  }
  console.log("Created alert rules");

  // ── PERIODS ───────────────────────────────────────────────────────────────
  const periodIds: Record<string, string> = {};
  // Jan 2023 → Feb 2026 (26 months submitted), Mar 2026 (open, nothing submitted)
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 3 : 12;
    for (let month = 1; month <= maxMonth; month++) {
      const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const id = crypto.randomUUID();
      periodIds[periodStart] = id;
      db.insert(schema.periods).values({
        id, firmId, periodType: "monthly", periodStart, status: "open",
        dueDate: null,
      }).run();
    }
  }
  console.log("Created periods");

  // ── SUBMISSIONS + KPI VALUES + FINANCIAL DOCUMENTS ────────────────────────

  // Which months each company skips (no submission)
  const SKIP_MONTHS: Record<string, string[]> = {
    "streamvibe-media": [
      "2023-03-01","2023-07-01","2023-11-01",
      "2024-02-01","2024-06-01","2024-10-01",
      "2025-03-01","2025-08-01",
    ],
    "culinary-concepts": [
      "2023-06-01","2023-10-01",
      "2024-03-01","2024-09-01",
      "2025-05-01",
    ],
    "evergreen-fitness": ["2023-08-01","2024-07-01"],
    "optifi-solutions": ["2023-09-01"],
    "apex-industrial-manufacturing": ["2023-05-01"],
    "brighton-healthcare-group": [],
    "keystone-logistics": ["2024-04-01"],
    "veridian-software": ["2023-12-01"],
  };

  // Which months each company uploads docs (requires requiredDocs to be non-empty)
  // Recent months (2025+): ~90% doc compliance; older: ~65%
  function shouldUploadDocs(slug: string, periodStart: string): boolean {
    const meta = COMPANY_META.find((c) => c.slug === slug)!;
    if (!meta.requiredDocs) return false;
    const year = parseInt(periodStart.slice(0, 4));
    const complianceRate = year >= 2025 ? 0.90 : 0.65;
    const n = noise(`docs-${slug}-${periodStart}`);
    return (n + 1) / 2 < complianceRate; // convert [-1,1] to [0,1]
  }

  function shouldUploadInvestorUpdate(slug: string, periodStart: string): boolean {
    // Only companies that require it, and recent periods more likely
    const meta = COMPANY_META.find((c) => c.slug === slug)!;
    if (!meta.requiredDocs.includes("investor_update")) return false;
    const year = parseInt(periodStart.slice(0, 4));
    const n = noise(`inv-upd-${slug}-${periodStart}`);
    return (n + 1) / 2 < (year >= 2025 ? 0.85 : 0.55);
  }

  // Track actuals for plan computation
  const actualsByCompanyMonth: Record<string, { revenue: number; ebitda: number }> = {};

  // Loop Jan 2023 → Feb 2026 (submitted periods)
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 2 : 12; // Only Jan+Feb 2026 submitted
    for (let month = 1; month <= maxMonth; month++) {
      const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const periodId = periodIds[periodStart];
      if (!periodId) continue;

      const idx = (year - 2023) * 12 + (month - 1);

      for (const meta of COMPANY_META) {
        const { slug } = meta;
        const companyId = companyIds[slug];
        const profile = PROFILES[slug];
        if (!companyId || !profile) continue;

        // Skip?
        const skipSet = SKIP_MONTHS[slug] ?? [];
        if (skipSet.includes(periodStart)) continue;

        // Generate KPI values
        const rev = r(profile.revenue(idx));
        const gm = r(profile.grossMarginPct(idx), 1);
        const ebitda = r(rev * profile.ebitdaMarginPct(idx) / 100);
        const cash = r(profile.cashBalance(idx));
        const capex = r(profile.capex(idx));
        const ocf = r(profile.ocf(idx));
        const hc = profile.headcount(idx);

        // Track for plan computation
        actualsByCompanyMonth[`${slug}:${periodStart}`] = { revenue: rev, ebitda };

        // Create submission
        const submissionId = crypto.randomUUID();
        const submittedAt = `${year}-${String(month + 1 > 12 ? 1 : month + 1).padStart(2, "0")}-15T10:00:00`;
        const opUserId = opUserIds[slug] ?? adminUserId;

        db.insert(schema.submissions).values({
          id: submissionId, firmId, companyId, periodId,
          status: "submitted",
          submittedAt,
          submittedByUserId: opUserId,
          lastUpdatedAt: submittedAt,
        }).run();

        // KPI values helper
        const insertKpi = (kpiKey: string, value: number | null, defIdOverride?: string) => {
          if (value === null || isNaN(value as number)) return;
          const defId = defIdOverride ?? kpiDefIds[kpiKey];
          if (!defId) return;
          try {
            db.insert(schema.kpiValues).values({
              submissionId, firmId, companyId, periodId,
              kpiDefinitionId: defId,
              actualNumber: value as number,
              actualText: null, targetNumber: null, targetText: null, targetDate: null,
            }).run();
          } catch { /* skip dup */ }
        };

        insertKpi("revenue", rev);
        insertKpi("gross_margin", gm);
        insertKpi("ebitda", ebitda);
        insertKpi("cash_balance", cash);
        insertKpi("capex", capex);
        insertKpi("operating_cash_flow", ocf);
        insertKpi("headcount", hc);

        // Firm-wide custom KPIs
        if (profile.churnRate) insertKpi("churn_rate", profile.churnRate(idx));
        if (profile.inventoryDays) insertKpi("inventory_days", profile.inventoryDays(idx));
        if (profile.npsScore) insertKpi("nps_score", profile.npsScore(idx));
        if (profile.cac) insertKpi("customer_acquisition_cost", profile.cac(idx));
        if (profile.employeeTurnover) insertKpi("employee_turnover_rate", profile.employeeTurnover(idx));

        // Company-specific KPIs
        const compKpis: Record<string, number | null> = {};
        if (slug === "apex-industrial-manufacturing") {
          compKpis["capacity_utilization"] = r(74 + idx * 0.08 + jitter(3, 5, `apex-cu-${idx}`), 1);
          compKpis["on_time_delivery"] = r(91 + jitter(2, 3, `apex-otd-${idx}`), 1);
        }
        if (slug === "brighton-healthcare-group") {
          compKpis["patient_satisfaction"] = r(82 + jitter(3, 3, `brgh-ps-${idx}`), 0);
          compKpis["bed_occupancy_rate"] = r(84 + jitter(3, 4, `brgh-bor-${idx}`), 1);
        }
        if (slug === "keystone-logistics") {
          compKpis["fleet_utilization"] = r(78 + jitter(4, 5, `kl-fu-${idx}`), 1);
          compKpis["cost_per_mile"] = r(2.85 + (idx >= 36 ? 0.35 : 0) + jitter(0.08, 4, `kl-cpm-${idx}`), 2);
        }
        if (slug === "veridian-software") {
          const mrr = r(rev * 0.92);
          compKpis["mrr"] = mrr;
          compKpis["arr"] = r(mrr * 12);
        }
        if (slug === "evergreen-fitness") {
          compKpis["member_count"] = Math.round(4200 + idx * 30 - (idx >= 36 ? (idx - 36) * 80 : 0) + jitter(100, 3, `eg-mc-${idx}`));
          compKpis["new_memberships"] = Math.round(120 * (idx >= 36 ? 0.65 : 1) + jitter(20, 10, `eg-nm-${idx}`));
        }
        if (slug === "optifi-solutions") {
          compKpis["aum"] = r(growRev(82000000, 0.008, FINTECH_SEASON, idx) * (idx >= 36 ? 0.91 : 1));
          compKpis["active_users"] = Math.round(18500 + idx * 180 + jitter(400, 3, `opt-au-${idx}`));
        }
        if (slug === "streamvibe-media") {
          compKpis["monthly_active_users"] = Math.round(growRev(1850000, 0.006, MEDIA_SEASON, idx) + jitter(30000, 4, `sv-mau-${idx}`));
          compKpis["subscriber_count"] = Math.round(growRev(420000, 0.005, MEDIA_SEASON, idx) + jitter(8000, 4, `sv-sub-${idx}`));
        }
        if (slug === "culinary-concepts") {
          compKpis["same_store_sales_growth"] = r(2.1 + jitter(1.5, 20, `cc-sssg-${idx}`), 1);
          compKpis["avg_check_size"] = r(38 + idx * 0.04 + jitter(2, 4, `cc-acs-${idx}`), 2);
        }

        for (const [key, val] of Object.entries(compKpis)) {
          if (val === null) continue;
          const defId = companyKpiDefIds[`${slug}_${key}`];
          if (defId) insertKpi(key, val, defId);
        }

        // Financial documents
        if (shouldUploadDocs(slug, periodStart)) {
          const requiredTypes = meta.requiredDocs.split(",").filter(Boolean) as schema.FinancialDocument["documentType"][];
          for (const docType of requiredTypes) {
            if (docType === "investor_update" && !shouldUploadInvestorUpdate(slug, periodStart)) continue;
            try {
              db.insert(schema.financialDocuments).values({
                id: crypto.randomUUID(),
                firmId, companyId, periodId, submissionId,
                documentType: docType,
                version: 1,
                fileName: `${periodStart.slice(0, 7)}_${docType}.pdf`,
                filePath: DOC_PATH,
                uploadedByUserId: opUserId,
                uploadedAt: submittedAt,
              }).run();
            } catch { /* skip dup */ }
          }
        }
      }
    }
  }
  console.log("Created submissions, KPI values, and financial documents");

  // ── PLANS ─────────────────────────────────────────────────────────────────


  let totalPlanValuesInserted = 0;

  /**
   * Insert a plan for a company+year, deriving all KPI targets from PROFILES.
   *
   * Financial KPIs (revenue, GM, EBITDA, cash, capex, OCF) → stored monthly (periodMonth 1-12).
   * Headcount + churn_rate → stored quarterly_end (periodMonth 101-104).
   * inventory_days, nps_score, cac, employee_turnover → stored annual_end (periodMonth null).
   *
   * All multipliers are relative to the PROFILES trajectory for that fiscal year.
   */
  function insertPlan(cfg: {
    slug: string; fiscalYear: number; version: number;
    submittedAt: string; note: string; investorNote: string;
    revMult: number;      // scales revenue and gross margin target
    ebitdaMult: number;   // scales EBITDA and OCF targets
    cashMult?: number;    // scales cash balance target (default 1.0)
    capexMult?: number;   // scales capex budget vs profile run-rate (default 1.05)
    revComment?: string;
    ebitdaComment?: string;
  }) {
    const profile = PROFILES[cfg.slug];
    if (!profile) return;
    const companyId = companyIds[cfg.slug];
    if (!companyId) return;

    const planId = crypto.randomUUID();
    const opUserId = opUserIds[cfg.slug] ?? adminUserId;
    const baseYearOffset = (cfg.fiscalYear - 2023) * 12; // idx of Jan of fiscal year

    db.insert(schema.kpiPlans).values({
      id: planId, firmId, companyId,
      fiscalYear: cfg.fiscalYear,
      granularity: "annual", // deprecated plan-level field; per-KPI planGranularity drives behavior
      version: cfg.version,
      submittedByUserId: opUserId,
      submittedAt: cfg.submittedAt,
      note: cfg.note,
      investorNote: cfg.investorNote,
    } as any).run();

    const insertPlanValue = (defId: string, value: number | null, month: number | null, comment?: string | null) => {
      if (value === null || value === undefined || !isFinite(value)) return;
      try {
        db.insert(schema.kpiPlanValues).values({
          id: crypto.randomUUID(), planId, kpiDefinitionId: defId,
          periodMonth: month, value, investorComment: comment ?? null,
        } as any).run();
        totalPlanValuesInserted++;
      } catch (e: any) {
        console.warn(`  ⚠ insertPlanValue error (${cfg.slug} FY${cfg.fiscalYear}): ${e?.message?.slice(0, 100)}`);
      }
    };

    const cashMult = cfg.cashMult ?? 1.0;
    const capexMult = cfg.capexMult ?? 1.05;

    // ── Monthly financial KPIs (periodMonth 1–12) ──────────────────────────────
    for (let m = 1; m <= 12; m++) {
      const idx = baseYearOffset + (m - 1);
      const rev   = r(profile.revenue(idx) * cfg.revMult);
      const gm    = r(profile.grossMarginPct(idx), 1);
      const ebi   = r(profile.revenue(idx) * (profile.ebitdaMarginPct(idx) / 100) * cfg.ebitdaMult);
      const cash  = r(profile.cashBalance(idx) * cashMult);
      const capex = r(profile.capex(idx) * capexMult);
      const ocf   = r(profile.ocf(idx) * cfg.ebitdaMult);

      insertPlanValue(kpiDefIds["revenue"]!,            rev,   m, m === 1 ? (cfg.revComment ?? null) : null);
      insertPlanValue(kpiDefIds["gross_margin"]!,       gm,    m, null);
      insertPlanValue(kpiDefIds["ebitda"]!,             ebi,   m, m === 1 ? (cfg.ebitdaComment ?? null) : null);
      insertPlanValue(kpiDefIds["cash_balance"]!,       cash,  m, null);
      insertPlanValue(kpiDefIds["capex"]!,              capex, m, null);
      insertPlanValue(kpiDefIds["operating_cash_flow"]!, ocf,  m, null);
    }

    // ── Quarterly_end KPIs: headcount + churn_rate (periodMonth 101–104) ───────
    for (let q = 1; q <= 4; q++) {
      const idx = baseYearOffset + (q * 3 - 1); // last month of quarter (Mar/Jun/Sep/Dec)

      const hc = profile.headcount(idx);
      insertPlanValue(kpiDefIds["headcount"]!, hc, 100 + q, null);

      if (profile.churnRate) {
        const churn = profile.churnRate(idx);
        if (churn !== null) {
          insertPlanValue(kpiDefIds["churn_rate"]!, r(churn * 0.95, 1), 100 + q, null);
        }
      }
    }

    // ── Annual_end KPIs (periodMonth null) ─────────────────────────────────────
    const refIdx = baseYearOffset + 11; // December of fiscal year

    if (profile.inventoryDays) {
      const v = profile.inventoryDays(refIdx);
      if (v !== null) insertPlanValue(kpiDefIds["inventory_days"]!, r(v * 0.97), null, null);
    }
    if (profile.npsScore) {
      const v = profile.npsScore(refIdx);
      if (v !== null) insertPlanValue(kpiDefIds["nps_score"]!, r(v * 1.03), null, null);
    }
    if (profile.cac) {
      const v = profile.cac(refIdx);
      if (v !== null) insertPlanValue(kpiDefIds["customer_acquisition_cost"]!, r(v * 0.95), null, null);
    }
    if (profile.employeeTurnover) {
      const v = profile.employeeTurnover(refIdx);
      if (v !== null) insertPlanValue(kpiDefIds["employee_turnover_rate"]!, r(v * 0.93, 1), null, null);
    }

    return planId;
  }

  // FY2024 Plans (Apex + Brighton)
  insertPlan({
    slug: "apex-industrial-manufacturing", fiscalYear: 2024, version: 1,
    submittedAt: "2024-01-22T14:00:00",
    note: "FY2024 plan targets modest volume growth of 3% amid soft industrial demand. CapEx front-loaded in H1 for equipment refresh.",
    investorNote: "Slightly conservative plan vs mgmt's original ask. Revenue came in 4% behind on soft OEM demand — margin improvement offset the gap. Overall acceptable year.",
    revMult: 1.06, ebitdaMult: 1.09, capexMult: 1.10,
    revComment: "Slightly aggressive on volume; monitor OEM pipeline.",
    ebitdaComment: "Margin improvement dependent on Q3 line efficiency gains.",
  });
  insertPlan({
    slug: "brighton-healthcare-group", fiscalYear: 2024, version: 1,
    submittedAt: "2024-01-18T10:30:00",
    note: "Stable census growth plan. Payer mix improvement expected following renegotiation of commercial contracts in Q4 2023.",
    investorNote: "Solid execution year. Revenue finished 2% above plan; EBITDA 5% above. Payer mix improved ahead of schedule.",
    revMult: 0.98, ebitdaMult: 0.95,
    revComment: "Achievable. Consistent with 3-year growth trend.",
  });

  // FY2025 Plans (6 companies)
  for (const cfg of [
    { slug: "apex-industrial-manufacturing", revMult: 0.97, ebitdaMult: 0.95,
      note: "FY2025 builds on FY2024 execution. Two new OEM contracts in pipeline add upside not included in base case.",
      investorNote: "Conservative base case as expected from mgmt. Actuals tracked 3% ahead on revenue — OEM contract signed in Q2 added ~$1.8M.",
      revComment: "Target looks achievable based on current trajectory." },
    { slug: "brighton-healthcare-group", revMult: 0.96, ebitdaMult: 0.93,
      note: "New 24-bed wing opens April 2025. Plan includes full-year benefit from improved payer mix.",
      investorNote: "Revenue and EBITDA both finished above plan. New wing ramped faster than modeled. Excellent year.",
      revComment: "Target looks achievable based on current trajectory." },
    { slug: "keystone-logistics", revMult: 0.98, ebitdaMult: 0.97,
      note: "New Midwest Distribution contract adds ~$2.2M annualized starting Q1. Fuel cost assumption $3.85/gallon.",
      investorNote: "Finished in-line with plan. Fuel averaged $3.78 vs $3.85 assumption — minor tailwind. Good execution.",
      revComment: "Target looks achievable based on current trajectory." },
    { slug: "veridian-software", revMult: 0.93, ebitdaMult: 0.90,
      note: "ARR target $15.2M. Bottom-up by product line. Two enterprise deals in late-stage pipeline not in base.",
      investorNote: "Beat revenue plan by 7%; EBITDA beat by 10%. Enterprise deals closed in Q2 and Q3 as predicted. Exceptional year.",
      revComment: "Monthly targets reflect SaaS seasonality + expected new logo closings." },
    { slug: "evergreen-fitness", revMult: 0.99, ebitdaMult: 0.97,
      note: "Steady membership growth plan. No major capex planned — existing clubs at target occupancy.",
      investorNote: "In-line with plan for FY2025. Set up for ambitious FY2026 expansion but club delays are emerging risk.",
      revComment: "Target looks achievable based on current trajectory." },
    { slug: "optifi-solutions", revMult: 1.07, ebitdaMult: 1.10,
      note: "New institutional sales channel launched Q4 2024. Plan reflects partial-year ramp contribution.",
      investorNote: "Finished ~6% behind on revenue — institutional channel slower than hoped. EBITDA behind plan 9%. Heading into 2026 with channel now maturing.",
      revComment: "Monitor closely — slightly above current run-rate." },
  ] as const) {
    insertPlan({
      slug: cfg.slug, fiscalYear: 2025, version: 1,
      submittedAt: "2025-01-20T15:00:00",
      note: cfg.note, investorNote: cfg.investorNote,
      revMult: cfg.revMult, ebitdaMult: cfg.ebitdaMult,
      revComment: cfg.revComment,
    });
  }

  // FY2026 Plans — targets designed to produce specific RAG outcomes
  for (const cfg of [
    { slug: "apex-industrial-manufacturing", revMult: 1.02, ebitdaMult: 1.03, version: 1, hasRevision: false,
      note: "FY2026 plan assumes 4% volume growth driven by two new OEM contracts. Maintenance capex front-loaded in Q1.",
      investorNote: "Conservative plan vs mgmt's initial ask of 8% growth. Revenue on track, EBITDA slightly ahead of plan month-to-date.",
      revComment: "Target looks achievable. Comfortable with this number.", ebitdaComment: undefined },
    { slug: "brighton-healthcare-group", revMult: 0.96, ebitdaMult: 0.94, version: 1, hasRevision: false,
      note: "FY2026 plan assumes 3% census growth and continued payer mix improvement. New wing fully ramped from Jan.",
      investorNote: "Running ahead of plan on payer mix. EBITDA margin expansion is ahead of schedule. Strong start to year.",
      revComment: "Monthly targets reflect census seasonality and payer mix ramp.", ebitdaComment: undefined },
    { slug: "keystone-logistics", revMult: 1.10, ebitdaMult: 1.16, version: 1, hasRevision: true,
      note: "Plan reflects new contract with Midwest Distribution Co. adding ~$2.2M in revenue. Fuel cost assumptions at $3.85/gallon avg.",
      investorNote: "Fuel headwind is the story — diesel running $4.20 vs $3.85 plan. EBITDA at risk without carrier pass-through. Watching closely.",
      revComment: "Slightly aggressive — fuel pass-through timeline uncertain.",
      ebitdaComment: "Margin target depends on fuel assumption. Risk to downside." },
    { slug: "veridian-software", revMult: 0.94, ebitdaMult: 0.92, version: 1, hasRevision: false,
      note: "ARR target of $18.4M. Plan built bottom-up by product line. Two large enterprise deals in pipeline not included in base case.",
      investorNote: "Beating plan on ARR. Two enterprise deals closed in Feb not in base case — running above plan already. EBITDA margin expansion ahead of budget.",
      revComment: "Monthly targets reflect SaaS ramp. Upside from 2 enterprise deals not included.", ebitdaComment: undefined },
    { slug: "evergreen-fitness", revMult: 1.26, ebitdaMult: 1.40, version: 1, hasRevision: false,
      note: "Ambitious growth plan: 3 new club openings in H1 targeting 12% membership growth. Pre-opening costs front-loaded in Q1–Q2.",
      investorNote: "Club openings behind schedule — 2 of 3 slipped to Q3. Revenue significantly behind plan. EBITDA heavily impacted by pre-opening costs with no offsetting revenue. Need updated forecast from mgmt.",
      revComment: "Significantly above current trajectory — needs mid-year reset if trend continues.",
      ebitdaComment: "Pre-opening costs will create a large Q1-Q2 drag. Monitor monthly." },
    { slug: "optifi-solutions", revMult: 1.08, ebitdaMult: 1.11, version: 1, hasRevision: false,
      note: "Plan targets 15% AUM growth through new institutional channel launched in Q4 2025. Headcount +6 in sales.",
      investorNote: "New institutional channel slower to ramp than expected. Revenue recognition timing creating a gap. Should normalize in Q2.",
      revComment: "Monitor closely — slightly aggressive vs current run-rate.", ebitdaComment: undefined },
  ]) {
    insertPlan({
      slug: cfg.slug, fiscalYear: 2026, version: cfg.version,
      submittedAt: "2026-01-28T16:00:00",
      note: cfg.note, investorNote: cfg.investorNote,
      revMult: cfg.revMult, ebitdaMult: cfg.ebitdaMult,
      revComment: cfg.revComment, ebitdaComment: cfg.ebitdaComment,
    });

    // Keystone v2: revised after Q1 — same revenue, EBITDA trimmed 8%
    if (cfg.hasRevision) {
      insertPlan({
        slug: cfg.slug, fiscalYear: 2026, version: 2,
        submittedAt: "2026-03-15T11:30:00",
        note: "Revised plan reflects Q1 actuals and updated fuel cost assumptions of $4.20/gallon. Revenue target maintained but EBITDA trimmed 8% to reflect margin compression.",
        investorNote: "Accepted the EBITDA revision. Revenue target still achievable with Midwest contract. Fuel risk remains if prices don't stabilize.",
        revMult: 1.10, ebitdaMult: r(1.16 * 0.92, 4),
        revComment: "Revenue kept flat vs original plan.",
        ebitdaComment: "Revised down 8% for fuel headwind.",
      });
    }
  }
  console.log(`Created FY2024/2025/2026 plans (${totalPlanValuesInserted} plan values)`);

  // ── EVALUATE ALERTS ───────────────────────────────────────────────────────
  const allSubmissions = db.select().from(schema.submissions).where(eq(schema.submissions.firmId, firmId)).all();
  const allRules = db.select().from(schema.thresholdRules).where(and(eq(schema.thresholdRules.firmId, firmId), isNull(schema.thresholdRules.companyId))).all();
  const allKpiDefs = db.select().from(schema.kpiDefinitions).where(eq(schema.kpiDefinitions.firmId, firmId)).all();

  let alertsCreated = 0;
  for (const sub of allSubmissions) {
    const values = db.select().from(schema.kpiValues).where(eq(schema.kpiValues.submissionId, sub.id)).all();
    for (const rule of allRules) {
      const kv = values.find((v) => v.kpiDefinitionId === rule.kpiDefinitionId);
      if (!kv || kv.actualNumber === null) continue;
      let breached = false;
      if (rule.ruleType === "lt" && kv.actualNumber < rule.thresholdValue) breached = true;
      if (rule.ruleType === "lte" && kv.actualNumber <= rule.thresholdValue) breached = true;
      if (rule.ruleType === "gt" && kv.actualNumber > rule.thresholdValue) breached = true;
      if (rule.ruleType === "gte" && kv.actualNumber >= rule.thresholdValue) breached = true;
      if (!breached) continue;
      const kpiDef = allKpiDefs.find((k) => k.id === rule.kpiDefinitionId);
      try {
        db.insert(schema.alerts).values({
          firmId, companyId: sub.companyId, periodId: sub.periodId,
          submissionId: sub.id, kpiDefinitionId: rule.kpiDefinitionId,
          severity: rule.severity,
          message: (() => {
            const label = kpiDef?.label ?? "KPI";
            const ruleLabel: Record<string, string> = { lt: "below", lte: "at or below", gt: "above", gte: "at or above" };
            const vt = kpiDef?.valueType ?? "number";
            const fmt = (n: number) => vt === "currency" ? `$${Math.abs(n).toLocaleString()}` : vt === "percent" ? `${n}%` : n.toLocaleString();
            return `${label} ${ruleLabel[rule.ruleType] ?? rule.ruleType} ${fmt(rule.thresholdValue)} · Actual: ${fmt(kv.actualNumber)}`;
          })(),
          status: "active",
        }).run();
        alertsCreated++;
      } catch { /* skip dup */ }
    }
  }

  // Resolve historical alerts (keep last 2 months active)
  const sortedPeriods = db.select().from(schema.periods).where(eq(schema.periods.firmId, firmId)).orderBy(desc(schema.periods.periodStart)).all();
  const recentPeriodIds = new Set(sortedPeriods.slice(0, 2).map((p) => p.id));
  const resolved = db.update(schema.alerts).set({ status: "resolved" }).where(
    and(eq(schema.alerts.firmId, firmId), eq(schema.alerts.status, "active"), notInArray(schema.alerts.periodId, [...recentPeriodIds]))
  ).run().changes;
  console.log(`Created ${alertsCreated} alerts, resolved ${resolved} historical`);

  // ── OPERATOR NOTES + INVESTOR ANNOTATIONS ────────────────────────────────
  const annotations: Array<{
    slug: string; periodStart: string;
    submissionNote?: string;
    kpiAnnotations?: Array<{ key: string; note?: string; investorNote?: string; ragOverride?: "green" | "amber" | "red"; ragOverrideReason?: string }>;
  }> = [
    {
      slug: "apex-industrial-manufacturing", periodStart: "2026-02-01",
      submissionNote: "February results impacted by planned maintenance shutdown in week 2. Line back online March 1. Expect Q1 to finish on budget.",
      kpiAnnotations: [
        { key: "ebitda", note: "Maintenance costs of ~$120K were one-time; normalized EBITDA margin remains ~18%.", investorNote: "One-time maintenance charge confirmed with mgmt. Normalizing to 18.2% margin. No action needed.", ragOverride: "green", ragOverrideReason: "One-time maintenance capex of $120K excluded from normalized EBITDA; underlying margin on track." },
        { key: "revenue", note: "Shutdown reduced output by ~8% for the month. Backlog orders will ship in March." },
      ],
    },
    {
      slug: "keystone-logistics", periodStart: "2026-01-01",
      submissionNote: "Diesel fuel surcharges up 12% YoY are compressing margins. Working with carriers on pass-through pricing effective March.",
      kpiAnnotations: [
        { key: "operating_cash_flow", note: "Negative OCF driven by $800K upfront equipment lease deposit — one-time item.", investorNote: "Lease deposit confirmed as one-time. OCF ex-deposit would be +$180K.", ragOverride: "amber", ragOverrideReason: "$800K equipment lease deposit distorts OCF; recurring cash generation remains positive." },
        { key: "ebitda", note: "Fuel surcharge headwind estimated at $220K for the month." },
      ],
    },
    {
      slug: "keystone-logistics", periodStart: "2026-02-01",
      submissionNote: "Fuel costs remained elevated through February. Carrier pass-through discussions ongoing — expect resolution by end of March.",
      kpiAnnotations: [
        { key: "gross_margin", investorNote: "Margin compression worse than expected. If carrier negotiations fail, will need to revise FY2026 guidance again." },
      ],
    },
    {
      slug: "veridian-software", periodStart: "2026-02-01",
      submissionNote: "Strong month. Closed two enterprise deals late in the period that weren't in the Feb forecast.",
      kpiAnnotations: [
        { key: "revenue", note: "Includes $340K in accelerated recognized revenue from Acme Corp multi-year contract.", investorNote: "ARR acceleration continues. Pipeline for Q2 closes looks strong — 2 enterprise deals in final stage." },
      ],
    },
    {
      slug: "brighton-healthcare-group", periodStart: "2026-02-01",
      submissionNote: "February census slightly below January due to flu season discharge backlog clearing. Core financials remain solid.",
      kpiAnnotations: [
        { key: "revenue", note: "Lower patient days vs January but payer mix improved — more commercial, less Medicaid.", investorNote: "Payer mix improvement offsetting census dip. On track for the year." },
      ],
    },
    {
      slug: "evergreen-fitness", periodStart: "2026-02-01",
      submissionNote: "Two of three planned club openings have slipped to Q3 due to construction permit delays. Pre-opening costs continue. Membership at existing clubs remains strong.",
      kpiAnnotations: [
        { key: "revenue", investorNote: "New Year membership surge softening as expected. Club delays are the key risk — requested updated timeline from mgmt." },
        { key: "ebitda", investorNote: "Pre-opening costs ~$280K without offsetting revenue. Very material vs plan. Need go/no-go decision on third club by April.", ragOverride: "red", ragOverrideReason: "Club opening delays driving pre-opening cost drag with no offsetting revenue. Not a temporary variance." },
      ],
    },
    {
      slug: "optifi-solutions", periodStart: "2026-02-01",
      submissionNote: "Institutional channel showing early traction — 3 new mandates signed in February. Revenue recognition on a lag so won't show until Q2.",
      kpiAnnotations: [
        { key: "revenue", investorNote: "Revenue recognition lag understood. AUM growing faster than revenue line suggests — Q2 should normalize. Comfortable holding amber." },
      ],
    },
  ];

  for (const ann of annotations) {
    const companyId = companyIds[ann.slug];
    if (!companyId) continue;
    const periodId = periodIds[ann.periodStart];
    if (!periodId) continue;
    const sub = db.select().from(schema.submissions).where(
      and(eq(schema.submissions.companyId, companyId), eq(schema.submissions.periodId, periodId))
    ).get();
    if (!sub) continue;

    if (ann.submissionNote) {
      db.update(schema.submissions).set({ note: ann.submissionNote } as any).where(eq(schema.submissions.id, sub.id)).run();
    }

    for (const kpiAnn of ann.kpiAnnotations ?? []) {
      const defId = kpiDefIds[kpiAnn.key];
      if (!defId) continue;
      const updatePayload: Record<string, unknown> = {};
      if (kpiAnn.note) updatePayload.note = kpiAnn.note;
      if (kpiAnn.investorNote) updatePayload.investorNote = kpiAnn.investorNote;
      if (kpiAnn.ragOverride) { updatePayload.ragOverride = kpiAnn.ragOverride; updatePayload.ragOverrideReason = kpiAnn.ragOverrideReason ?? null; }
      if (Object.keys(updatePayload).length) {
        db.update(schema.kpiValues).set(updatePayload as any).where(
          and(eq(schema.kpiValues.submissionId, sub.id), eq(schema.kpiValues.kpiDefinitionId, defId))
        ).run();
      }
    }
  }
  console.log("Added operator notes and investor annotations");

  // ── INDEPENDENT OPERATOR (TechVault) ─────────────────────────────────────
  const indFirmId = crypto.randomUUID();
  db.insert(schema.firms).values({ id: indFirmId, name: "TechVault Inc.", orgType: "operating_company" }).run();
  db.insert(schema.emailSettings).values({ firmId: indFirmId, fromEmail: "reporting@techvault.com", fromName: "TechVault Inc." }).run();

  const indCompanyId = crypto.randomUUID();
  db.insert(schema.companies).values({
    id: indCompanyId, firmId: indFirmId, name: "TechVault Inc.", slug: "techvault-inc",
    industry: "Software / SaaS", timezone: "America/New_York",
    requiredDocs: "balance_sheet,income_statement,investor_update",
    submissionToken: generateToken(),
  } as any).run();

  const indKpis = [
    { key: "revenue", label: "Revenue", section: "Finance", unit: "$", valueType: "currency" as const, isRequired: true, displayOrder: 1, ragDirection: "higher_is_better" as const },
    { key: "gross_margin", label: "Gross Margin", section: "Finance", unit: "%", valueType: "percent" as const, isRequired: true, displayOrder: 2, ragDirection: "higher_is_better" as const },
    { key: "ebitda", label: "EBITDA", section: "Finance", unit: "$", valueType: "currency" as const, isRequired: true, displayOrder: 3, ragDirection: "higher_is_better" as const },
    { key: "cash_balance", label: "Cash Balance", section: "Finance", unit: "$", valueType: "currency" as const, isRequired: true, displayOrder: 4, ragDirection: "higher_is_better" as const },
    { key: "headcount", label: "Headcount", section: "Operations", unit: "#", valueType: "integer" as const, isRequired: true, displayOrder: 5, ragDirection: "higher_is_better" as const },
    { key: "mrr", label: "Monthly Recurring Revenue", section: "Finance", unit: "$", valueType: "currency" as const, isRequired: false, displayOrder: 6, ragDirection: "higher_is_better" as const },
    { key: "churn_rate", label: "Churn Rate", section: "Operations", unit: "%", valueType: "percent" as const, isRequired: false, displayOrder: 7, ragDirection: "lower_is_better" as const },
  ];

  const indKpiIds: Record<string, string> = {};
  for (const k of indKpis) {
    const id = crypto.randomUUID();
    indKpiIds[k.key] = id;
    db.insert(schema.kpiDefinitions).values({
      id, firmId: indFirmId, scope: k.displayOrder <= 5 ? "standard" : "custom", companyId: null,
      key: k.key, label: k.label, section: k.section, unit: k.unit,
      valueType: k.valueType, isRequired: k.isRequired, displayOrder: k.displayOrder, active: true,
      ragDirection: k.ragDirection, ragGreenPct: 5, ragAmberPct: 15,
    } as any).run();
  }

  const tvPeriodIds: Record<string, string> = {};
  for (let year = 2024; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 3 : 12;
    for (let month = 1; month <= maxMonth; month++) {
      const ps = `${year}-${String(month).padStart(2, "0")}-01`;
      const id = crypto.randomUUID();
      tvPeriodIds[ps] = id;
      db.insert(schema.periods).values({ id, firmId: indFirmId, periodType: "monthly", periodStart: ps, status: "open" }).run();
    }
  }

  const indPasswordHash = await bcrypt.hash("ind123", 12);
  const indUserId = crypto.randomUUID();
  db.insert(schema.users).values({
    id: indUserId, firmId: indFirmId, companyId: indCompanyId,
    email: "cfo@techvault.com", passwordHash: indPasswordHash,
    name: "Alex Rivera", role: "firm_admin", persona: "independent_operator",
  }).run();

  // Seed 12 months of TechVault data (2025 + Jan-Feb 2026)
  const tvMonths = [
    ...Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}-01`),
    "2026-01-01", "2026-02-01",
  ];
  for (const ps of tvMonths) {
    const periodId = tvPeriodIds[ps];
    if (!periodId) continue;
    const idx = (parseInt(ps.slice(0, 4)) - 2024) * 12 + (parseInt(ps.slice(5, 7)) - 1);
    const rev = r(growRev(380000, 0.018, SAAS_SEASON, idx));
    const gm = r(72 + idx * 0.1, 1);
    const ebitda = r(rev * (0.12 + idx * 0.003));
    const cash = r(1200000 + idx * 40000);
    const hc = Math.round(12 + idx * 0.8);
    const mrr = r(rev * 0.88);
    const churn = r(Math.max(1.5, 5.5 - idx * 0.08), 1);

    const subId = crypto.randomUUID();
    const submittedAt = `${ps.slice(0, 7).replace("-", "-")}-20T10:00:00`;
    db.insert(schema.submissions).values({
      id: subId, firmId: indFirmId, companyId: indCompanyId, periodId,
      status: "submitted", submittedAt, submittedByUserId: indUserId, lastUpdatedAt: submittedAt,
    }).run();

    for (const [key, val] of [
      ["revenue", rev], ["gross_margin", gm], ["ebitda", ebitda],
      ["cash_balance", cash], ["headcount", hc], ["mrr", mrr], ["churn_rate", churn],
    ] as [string, number][]) {
      const defId = indKpiIds[key];
      if (!defId) continue;
      try {
        db.insert(schema.kpiValues).values({
          submissionId: subId, firmId: indFirmId, companyId: indCompanyId, periodId,
          kpiDefinitionId: defId, actualNumber: val,
          actualText: null, targetNumber: null, targetText: null, targetDate: null,
        }).run();
      } catch { /* skip */ }
    }
  }
  console.log("Created independent operator: TechVault Inc.");

  console.log("\n✅ Seed complete!");
  console.log("\n📋 Login credentials:");
  console.log("  Firm Admin:        nicholasmbellamy@gmail.com / admin123");
  console.log("  Firm Member:       member@meridiancp.com / member123");
  console.log("  PE Operator:       john.davis@apex-industrial.com / operator123");
  console.log("  Ind. Operator:     cfo@techvault.com / ind123");
}

seed().catch(console.error);
