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
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import path from "path";
import * as XLSX from "xlsx";

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
      onboardingStatus: "in_progress",
    },
    {
      slug: "culinary-concepts", name: "Culinary Concepts",
      industry: "Consumer Services", fund: null,
      requiredDocs: "",
      timezone: "America/Chicago",
      ragIntent26: null, revMultiplier26: 0, ebitdaMultiplier26: 0,
      investmentDate: "2023-09-01",
      onboardingStatus: "complete",
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

  const streamvibeId = companyIds["streamvibe-media"];
  if (streamvibeId) {
    db.run(`INSERT INTO onboarding_documents (id, firm_id, company_id, file_name, file_path, uploaded_at) VALUES
      ('${crypto.randomUUID()}', '${firmId}', '${streamvibeId}', 'StreamVibe_Company_Overview_2025.pdf', NULL, '2026-03-28 10:15:00'),
      ('${crypto.randomUUID()}', '${firmId}', '${streamvibeId}', 'StreamVibe_Q4_2025_Financials.xlsx', NULL, '2026-03-28 10:22:00')
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
  // Jan 2023 → Mar 2026 (27 months submitted), Apr 2026 (open, nothing submitted)
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 4 : 12;
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
      "2026-03-01",
    ],
    "culinary-concepts": [
      "2023-06-01","2023-10-01",
      "2024-03-01","2024-09-01",
      "2025-05-01",
    ],
    "evergreen-fitness": ["2023-08-01","2024-07-01","2026-03-01"],
    "optifi-solutions": ["2023-09-01"],
    "apex-industrial-manufacturing": ["2023-05-01"],
    "brighton-healthcare-group": [],
    "keystone-logistics": ["2024-04-01"],
    "veridian-software": ["2023-12-01"],
  };

  // Which months each company uploads docs (requires requiredDocs to be non-empty)
  // Recent months (2025+): ~90% doc compliance; older: ~65%
  function shouldUploadDocs(slug: string, periodStart: string): boolean {
    // Force partial submissions (KPIs only, no docs) for demo purposes in March 2026
    if (periodStart === "2026-03-01" && (slug === "keystone-logistics" || slug === "optifi-solutions")) {
      return false;
    }
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

  // Loop Jan 2023 → Mar 2026 (submitted periods)
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 3 : 12; // Jan-Mar 2026 submitted
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
        let submittedAt: string;
        if (year === 2026 && month === 3) {
          // March 2026 — came in early April for a realistic demo (today is 2026-04-07)
          const earlyAprilDates: Record<string, string> = {
            "veridian-software": "2026-04-02",
            "brighton-healthcare-group": "2026-04-02",
            "apex-industrial-manufacturing": "2026-04-03",
            "optifi-solutions": "2026-04-04",
            "keystone-logistics": "2026-04-04",
            "culinary-concepts": "2026-04-05",
          };
          submittedAt = `${earlyAprilDates[slug] ?? "2026-04-03"}T10:00:00`;
        } else {
          submittedAt = `${year}-${String(month + 1 > 12 ? 1 : month + 1).padStart(2, "0")}-15T10:00:00`;
        }
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

    // ── Annual summary values (periodMonth null) for monthly + quarterly KPIs ───
    // These are needed for the plan completeness check which looks for periodMonth=null entries.
    // Revenue, EBITDA, CapEx, OCF: sum of 12 monthly values
    // Gross Margin: average of 12 monthly values
    // Cash Balance: December value (end of year)
    // Headcount: Q4 value (end of year)
    // Churn Rate: Q4 value (end of year)

    let annualRevSum = 0, annualGmSum = 0, annualEbitdaSum = 0, annualCapexSum = 0, annualOcfSum = 0;
    let decCash = 0;
    for (let m = 1; m <= 12; m++) {
      const idx = baseYearOffset + (m - 1);
      annualRevSum += profile.revenue(idx) * cfg.revMult;
      annualGmSum += profile.grossMarginPct(idx);
      annualEbitdaSum += profile.revenue(idx) * (profile.ebitdaMarginPct(idx) / 100) * cfg.ebitdaMult;
      annualCapexSum += profile.capex(idx) * capexMult;
      annualOcfSum += profile.ocf(idx) * cfg.ebitdaMult;
      if (m === 12) decCash = profile.cashBalance(idx) * cashMult;
    }

    insertPlanValue(kpiDefIds["revenue"]!, r(annualRevSum), null, null);
    insertPlanValue(kpiDefIds["gross_margin"]!, r(annualGmSum / 12, 1), null, null);
    insertPlanValue(kpiDefIds["ebitda"]!, r(annualEbitdaSum), null, null);
    insertPlanValue(kpiDefIds["cash_balance"]!, r(decCash), null, null);
    insertPlanValue(kpiDefIds["capex"]!, r(annualCapexSum), null, null);
    insertPlanValue(kpiDefIds["operating_cash_flow"]!, r(annualOcfSum), null, null);

    // Headcount: use Q4 (last quarter) value
    const q4Idx = baseYearOffset + 11; // December
    insertPlanValue(kpiDefIds["headcount"]!, profile.headcount(q4Idx), null, null);

    // Churn rate: use Q4 value if available
    if (profile.churnRate) {
      const churnVal = profile.churnRate(q4Idx);
      if (churnVal !== null) insertPlanValue(kpiDefIds["churn_rate"]!, r(churnVal * 0.95, 1), null, null);
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
    { slug: "apex-industrial-manufacturing", revMult: 1.02, ebitdaMult: 1.03, version: 1, hasRevision: false, skipAnnual: undefined as string[] | undefined,
      note: "FY2026 plan assumes 4% volume growth driven by two new OEM contracts. Maintenance capex front-loaded in Q1.",
      investorNote: "Conservative plan vs mgmt's initial ask of 8% growth. Revenue on track, EBITDA slightly ahead of plan month-to-date.",
      revComment: "Target looks achievable. Comfortable with this number.", ebitdaComment: undefined },
    { slug: "brighton-healthcare-group", revMult: 0.96, ebitdaMult: 0.94, version: 1, hasRevision: false, skipAnnual: undefined as string[] | undefined,
      note: "FY2026 plan assumes 3% census growth and continued payer mix improvement. New wing fully ramped from Jan.",
      investorNote: "Running ahead of plan on payer mix. EBITDA margin expansion is ahead of schedule. Strong start to year.",
      revComment: "Monthly targets reflect census seasonality and payer mix ramp.", ebitdaComment: undefined },
    { slug: "keystone-logistics", revMult: 1.10, ebitdaMult: 1.16, version: 1, hasRevision: true,
      skipAnnual: ["nps_score", "employee_turnover_rate"] as string[],
      note: "Plan reflects new contract with Midwest Distribution Co. adding ~$2.2M in revenue. Fuel cost assumptions at $3.85/gallon avg.",
      investorNote: "Fuel headwind is the story — diesel running $4.20 vs $3.85 plan. EBITDA at risk without carrier pass-through. Watching closely.",
      revComment: "Slightly aggressive — fuel pass-through timeline uncertain.",
      ebitdaComment: "Margin target depends on fuel assumption. Risk to downside." },
    { slug: "veridian-software", revMult: 0.94, ebitdaMult: 0.92, version: 1, hasRevision: false, skipAnnual: undefined as string[] | undefined,
      note: "ARR target of $18.4M. Plan built bottom-up by product line. Two large enterprise deals in pipeline not included in base case.",
      investorNote: "Beating plan on ARR. Two enterprise deals closed in Feb not in base case — running above plan already. EBITDA margin expansion ahead of budget.",
      revComment: "Monthly targets reflect SaaS ramp. Upside from 2 enterprise deals not included.", ebitdaComment: undefined },
    { slug: "evergreen-fitness", revMult: 1.26, ebitdaMult: 1.40, version: 1, hasRevision: false,
      skipAnnual: ["capex", "operating_cash_flow"] as string[],
      note: "Ambitious growth plan: 3 new club openings in H1 targeting 12% membership growth. Pre-opening costs front-loaded in Q1–Q2.",
      investorNote: "Club openings behind schedule — 2 of 3 slipped to Q3. Revenue significantly behind plan. EBITDA heavily impacted by pre-opening costs with no offsetting revenue. Need updated forecast from mgmt.",
      revComment: "Significantly above current trajectory — needs mid-year reset if trend continues.",
      ebitdaComment: "Pre-opening costs will create a large Q1-Q2 drag. Monitor monthly." },
    { slug: "optifi-solutions", revMult: 1.08, ebitdaMult: 1.11, version: 1, hasRevision: false,
      skipAnnual: ["cash_balance", "headcount", "employee_turnover_rate"] as string[],
      note: "Plan targets 15% AUM growth through new institutional channel launched in Q4 2025. Headcount +6 in sales.",
      investorNote: "New institutional channel slower to ramp than expected. Revenue recognition timing creating a gap. Should normalize in Q2.",
      revComment: "Monitor closely — slightly aggressive vs current run-rate.", ebitdaComment: undefined },
  ]) {
    const planId2026 = insertPlan({
      slug: cfg.slug, fiscalYear: 2026, version: cfg.version,
      submittedAt: "2026-01-28T16:00:00",
      note: cfg.note, investorNote: cfg.investorNote,
      revMult: cfg.revMult, ebitdaMult: cfg.ebitdaMult,
      revComment: cfg.revComment, ebitdaComment: cfg.ebitdaComment,
    });

    // Remove annual targets for specific KPIs to create "Partial" plan status
    if (cfg.skipAnnual && planId2026) {
      for (const kpiKey of cfg.skipAnnual) {
        const defId = kpiDefIds[kpiKey];
        if (defId) {
          db.delete(schema.kpiPlanValues)
            .where(and(
              eq(schema.kpiPlanValues.planId, planId2026),
              eq(schema.kpiPlanValues.kpiDefinitionId, defId),
              isNull(schema.kpiPlanValues.periodMonth)
            ))
            .run();
        }
      }
    }

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
    // March 2026 annotations
    {
      slug: "apex-industrial-manufacturing", periodStart: "2026-03-01",
      submissionNote: "Q1 close — strong month. Production fully recovered after February maintenance shutdown. OEM backlog orders shipped as planned.",
      kpiAnnotations: [
        { key: "revenue", note: "February backlog orders shipped in March as expected. OEM run-rate normalized.", investorNote: "Excellent Q1 close. Full maintenance recovery — no lasting impact. OEM contract pipeline adding Q2 upside." },
        { key: "ebitda", investorNote: "Q1 EBITDA tracking ahead of plan. Margin expansion on track. No concerns heading into Q2." },
      ],
    },
    {
      slug: "keystone-logistics", periodStart: "2026-03-01",
      submissionNote: "KPIs submitted. Financial documents pending CFO sign-off on fuel surcharge restatement — to be uploaded by April 10.",
      kpiAnnotations: [
        { key: "gross_margin", investorNote: "Partial submission — docs pending. Carrier pass-through effective April 1 should help Q2 margin. Watching closely." },
        { key: "operating_cash_flow", note: "OCF recovering from Q1 lease deposit impact. Carrier pass-through pricing now in place from April 1.", investorNote: "Pass-through in place. Expect OCF and margin improvement from Q2 onwards. March was the trough." },
      ],
    },
    {
      slug: "veridian-software", periodStart: "2026-03-01",
      submissionNote: "Q1 close. Exceptional quarter — three enterprise deals closed in Q1 totaling $1.2M in new ARR. Ahead of plan across all metrics.",
      kpiAnnotations: [
        { key: "revenue", note: "Includes $420K recognized revenue from two multi-year enterprise contracts closed late March.", investorNote: "Q1 ARR beat is outstanding. Pipeline for Q2 has 4 enterprise deals in final stages. Very bullish on 2026 full year." },
        { key: "ebitda", investorNote: "EBITDA margin expanding ahead of plan. Q1 EBITDA significantly above budget. Best quarter since investment." },
      ],
    },
    {
      slug: "brighton-healthcare-group", periodStart: "2026-03-01",
      submissionNote: "Strong Q1 close. Census fully recovered in March after February flu season dip; payer mix held favorable throughout.",
      kpiAnnotations: [
        { key: "revenue", investorNote: "Solid Q1. Revenue and EBITDA both above plan. Payer mix improvement is structural — ahead of original thesis timeline." },
      ],
    },
    {
      slug: "optifi-solutions", periodStart: "2026-03-01",
      submissionNote: "Institutional mandates from February now generating recognized revenue. KPIs submitted; fund statements to follow once finalized.",
      kpiAnnotations: [
        { key: "revenue", note: "Revenue recognition from February institutional mandates flowing through as expected.", investorNote: "Revenue trajectory improving as expected. Docs pending sign-off. Comfortable holding amber — Q2 will show full channel contribution." },
      ],
    },
    {
      slug: "culinary-concepts", periodStart: "2026-03-01",
      submissionNote: "First monthly submission following completion of onboarding. March actuals solid — spring dining season starting well.",
      kpiAnnotations: [
        { key: "revenue", note: "Same-store sales up 3.2% vs prior year. Spring season has started strongly.", investorNote: "First clean submission post-onboarding. Revenue and margins look healthy. Will configure required docs and 2026 plan before Q2 submission." },
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

  // ── SEED NOTIFICATIONS ────────────────────────────────────────────────────────
  // Create realistic notifications for the admin and member users
  const notifRecords = [
    // UNREAD — recent March 2026 submissions (came in April 2-5)
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "submission_received", isRead: 0,
      title: "Apex Industrial submitted Mar 2026",
      body: "John Davis submitted March 2026 KPIs and financial documents.",
      linkUrl: `/analytics?company=${companyIds["apex-industrial-manufacturing"]}&period=2026-03&view=detail`,
      companyId: companyIds["apex-industrial-manufacturing"], periodMonth: "2026-03",
      createdAt: "2026-04-03T10:02:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "submission_received", isRead: 0,
      title: "Veridian Software submitted Mar 2026",
      body: "Rachel Park submitted March 2026 data. Enterprise Q1 close — ahead of plan.",
      linkUrl: `/analytics?company=${companyIds["veridian-software"]}&period=2026-03&view=detail`,
      companyId: companyIds["veridian-software"], periodMonth: "2026-03",
      createdAt: "2026-04-02T14:30:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "submission_received", isRead: 0,
      title: "Brighton Healthcare submitted Mar 2026",
      body: "Emily White submitted March 2026 KPIs and all required documents.",
      linkUrl: `/analytics?company=${companyIds["brighton-healthcare-group"]}&period=2026-03&view=detail`,
      companyId: companyIds["brighton-healthcare-group"], periodMonth: "2026-03",
      createdAt: "2026-04-02T09:15:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "submission_received", isRead: 0,
      title: "Keystone Logistics submitted Mar 2026 (partial)",
      body: "Mike Johnson submitted March 2026 KPIs. Financial documents pending — expected by April 10.",
      linkUrl: `/analytics?company=${companyIds["keystone-logistics"]}&period=2026-03&view=detail`,
      companyId: companyIds["keystone-logistics"], periodMonth: "2026-03",
      createdAt: "2026-04-04T11:20:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "submission_received", isRead: 0,
      title: "OptiFi Solutions submitted Mar 2026 (partial)",
      body: "Priya Sharma submitted March 2026 KPIs. Fund statements pending CFO review.",
      linkUrl: `/analytics?company=${companyIds["optifi-solutions"]}&period=2026-03&view=detail`,
      companyId: companyIds["optifi-solutions"], periodMonth: "2026-03",
      createdAt: "2026-04-04T15:45:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "submission_received", isRead: 0,
      title: "Culinary Concepts submitted Mar 2026",
      body: "First submission following onboarding completion. March actuals submitted.",
      linkUrl: `/analytics?company=${companyIds["culinary-concepts"]}&period=2026-03&view=detail`,
      companyId: companyIds["culinary-concepts"], periodMonth: "2026-03",
      createdAt: "2026-04-05T09:00:00",
    },
    // UNREAD — RAG alerts
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "rag_alert", isRead: 0,
      title: "Evergreen Fitness: EBITDA off track",
      body: "EBITDA significantly below plan in Feb 2026. Pre-opening costs with no offsetting revenue from delayed club openings.",
      linkUrl: `/analytics?company=${companyIds["evergreen-fitness"]}&period=2026-02&view=detail`,
      companyId: companyIds["evergreen-fitness"], periodMonth: "2026-02",
      createdAt: "2026-04-01T08:00:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "rag_alert", isRead: 0,
      title: "Keystone Logistics: gross margin at risk",
      body: "Gross margin running below plan in Mar 2026. Fuel headwind persisting despite carrier pass-through discussions.",
      linkUrl: `/analytics?company=${companyIds["keystone-logistics"]}&period=2026-03&view=detail`,
      companyId: companyIds["keystone-logistics"], periodMonth: "2026-03",
      createdAt: "2026-04-04T11:21:00",
    },
    // READ — older items
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "monthly_digest", isRead: 1,
      title: "Portfolio digest — March 2026",
      body: "6 of 8 companies submitted for March. 2 alerts active (Evergreen, Keystone). Veridian and Brighton ahead of plan.",
      linkUrl: `/dashboard`,
      companyId: null, periodMonth: "2026-03",
      createdAt: "2026-04-01T07:00:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "submission_received", isRead: 1,
      title: "Culinary Concepts onboarding complete",
      body: "Culinary Concepts has completed their platform onboarding. Historical data now available in Analytics.",
      linkUrl: `/analytics?company=${companyIds["culinary-concepts"]}&view=detail`,
      companyId: companyIds["culinary-concepts"], periodMonth: null,
      createdAt: "2026-03-20T14:00:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "plan_submitted", isRead: 1,
      title: "Keystone Logistics submitted revised FY2026 plan",
      body: "Revised FY2026 plan submitted. Revenue maintained; EBITDA trimmed 8% to reflect fuel headwind at $4.20/gallon.",
      linkUrl: `/analytics?company=${companyIds["keystone-logistics"]}&view=detail`,
      companyId: companyIds["keystone-logistics"], periodMonth: null,
      createdAt: "2026-03-15T11:35:00",
    },
    {
      id: crypto.randomUUID(), firmId, userId: adminUserId,
      eventType: "onboarding_request", isRead: 1,
      title: "StreamVibe Media — onboarding in progress",
      body: "StreamVibe Media has uploaded initial documents. Onboarding in progress — historical data submission expected within 2 weeks.",
      linkUrl: `/submissions`,
      companyId: companyIds["streamvibe-media"], periodMonth: null,
      createdAt: "2026-03-28T10:25:00",
    },
  ];

  // Duplicate all notifications for the member user as well
  const allNotifRecords = [
    ...notifRecords,
    ...notifRecords.map(n => ({ ...n, id: crypto.randomUUID(), userId: memberId })),
  ];

  for (const n of allNotifRecords) {
    db.run(
      `INSERT INTO notifications (id, firm_id, user_id, event_type, title, body, link_url, company_id, period_month, is_read, created_at)
       VALUES ('${n.id}', '${n.firmId}', '${n.userId}', '${n.eventType}', '${n.title.replace(/'/g, "''")}', '${n.body.replace(/'/g, "''")}', ${n.linkUrl ? `'${n.linkUrl}'` : 'NULL'}, ${n.companyId ? `'${n.companyId}'` : 'NULL'}, ${n.periodMonth ? `'${n.periodMonth}'` : 'NULL'}, ${n.isRead}, '${n.createdAt}')`
    );
  }
  console.log(`Created ${allNotifRecords.length} seed notifications`);

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

  // Seed 12 months of TechVault data (2025 + Jan-Mar 2026)
  const tvMonths = [
    ...Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}-01`),
    "2026-01-01", "2026-02-01", "2026-03-01",
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

  await createDemoFiles(path.join(process.cwd(), "uploads", "demo"));
  console.log("Created demo files in uploads/demo/");

  console.log("\n✅ Seed complete!");
  console.log("\n📋 Login credentials:");
  console.log("  Firm Admin:        nicholasmbellamy@gmail.com / admin123");
  console.log("  Firm Member:       member@meridiancp.com / member123");
  console.log("  PE Operator:       john.davis@apex-industrial.com / operator123");
  console.log("  Ind. Operator:     cfo@techvault.com / ind123");
}

// ── DEMO FILE HELPERS ─────────────────────────────────────────────────────────

function buildTextPdf(lines: string[]): Buffer {
  const streamParts: string[] = ['BT', '/F1 10 Tf'];
  let first = true;
  for (const line of lines) {
    // Escape PDF special chars in parentheses
    const esc = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    if (first) {
      streamParts.push(`72 750 Td`);
      first = false;
    } else {
      streamParts.push(`0 -14 Td`);
    }
    streamParts.push(`(${esc}) Tj`);
  }
  streamParts.push('ET');
  const streamContent = streamParts.join('\n') + '\n';
  const streamLen = Buffer.byteLength(streamContent, 'ascii');

  const header = '%PDF-1.4\n';
  const obj1 = `1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n`;
  const obj2 = `2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n`;
  const obj3 = `3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>\nendobj\n`;
  const obj4 = `4 0 obj\n<</Length ${streamLen}>>\nstream\n${streamContent}endstream\nendobj\n`;
  const obj5 = `5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>\nendobj\n`;

  const body = obj1 + obj2 + obj3 + obj4 + obj5;

  // Compute byte offsets for xref
  let off = Buffer.byteLength(header, 'ascii');
  const offsets: number[] = [0]; // offset[0] unused (free entry)
  for (const obj of [obj1, obj2, obj3, obj4, obj5]) {
    offsets.push(off);
    off += Buffer.byteLength(obj, 'ascii');
  }

  const xrefOffset = Buffer.byteLength(header, 'ascii') + Buffer.byteLength(body, 'ascii');

  // Each xref entry must be exactly 20 bytes: "NNNNNNNNNN GGGGG T \n" (10+1+5+1+1+1+1=20)
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, 'ascii');
}

async function createDemoFiles(demoDir: string): Promise<void> {
  rmSync(demoDir, { recursive: true, force: true });
  mkdirSync(demoDir, { recursive: true });

  // ── File 1: Apex Industrial TXT (informal ops email) ────────────────────────
  const apexText = `hey — sending over the april numbers for apex. couple things to flag before you dig in so read through first

top line: revenue came in at $3,592,400 for the month which is a nice bump from march. we had a Q2 OEM order pull-forward of about $45K and the usual spring pickup across the board. honestly feels like momentum is building — pipeline for may looks solid too but dont want to get ahead of ourselves.

margins holding, maybe ticking up a hair from march. gross margin around 24.6% which im happy with given the input cost environment. steel pricing stabilized which helps, and the procurement team renegotiated the fastener contract so thats flowing through now.

EBITDA was $654,200 — clean number, no one-offs this month. no weird accruals or reclasses to worry about. just solid operating performance across the board.

cash balance end of month: $6,571,000. we're in good shape. operating cash flow came in at $356,100 which is solid — collections were strong, only 2 invoices past 60 days and both are with customers we know are good for it (one is literally just a PO mismatch on their end).

capex was $207,800 — this is the H1 equipment upgrade program continuing. bulk of it was the CNC tooling costs for the new product line. should start tapering in june once the install is complete. we also had some smaller tooling replacements on line 3 that were overdue.

headcount: 198 FTE. 2 new line workers started april 12, both came from the trade school pipeline which has been working well for us. still have one open req for a QC lead — been interviewing but havent found the right fit yet. want someone with ISO experience specifically.

customer churn: 2.9%, down a tick from march. that mid-market account i flagged last month (the one that was wavering) is re-engaged — they placed a $180K order in late april so i think we're good there. relationship is back on track.

inventory days: 41, trending down from 43 in march. the supply chain tightening initiative is working — we reduced safety stock on 3 commodity SKUs and improved the kanban triggers on the floor. goal is to get to ~38 by end of Q2.

NPS: 64, basically flat. next full survey is Q3. anecdotally customers seem happy — we had 2 unsolicited referrals this month which is always a good sign.

capacity utilization: 81.2%, up from 79.8%. on-time delivery: 93.4%. both trending the right direction. the new shift scheduling we implemented in march is paying dividends — less overtime, better throughput.

employee turnover: 8.2% annualized — stable. no surprises. the retention bonuses we put in for the senior machinists seem to be working.

CAC: still not tracked / N/A for industrial. we dont really acquire customers in a way where that metric makes sense — its all relationship-driven and RFQ-based. happy to discuss if you want us to track something analogous but i dont think its the right lens for our business.

oh one more thing — the building HVAC unit on the east side of the plant finally died. replacement is $38K, already got 2 quotes. will hit may capex. not a big deal but wanted to flag it.

let me know if you need anything else or want to jump on a call to walk through.

Tim Ashford
VP Operations
Apex Industrial Manufacturing`;
  writeFileSync(path.join(demoDir, "apex_april2026_ops_update.txt"), apexText);

  // ── File 2: Brighton Healthcare XLSX (multi-tab financials) ─────────────────
  const brightonIS: (string | number | null)[][] = [
    ["Brighton Healthcare Group"],
    ["Income Statement"],
    ["For the Month Ended April 30, 2026", null, "Unaudited"],
    [],
    [null, "Apr-26 ($)", "% Rev", "Mar-26 ($)", "% Rev", "Apr-25 ($)", "YoY Var %"],
    [],
    ["PATIENT REVENUE"],
    ["  Inpatient Services", 3745000, "44.0%", 3692000, "44.0%", 3520000, "6.4%"],
    ["  Outpatient & Ambulatory", 2298000, "27.0%", 2266000, "27.0%", 2162000, "6.3%"],
    ["  Emergency & Acute Care", 1192000, "14.0%", 1175000, "14.0%", 1124000, "6.0%"],
    ["  Surgical Procedures", 851000, "10.0%", 839000, "10.0%", 798000, "6.6%"],
    ["  Ancillary & Diagnostic Services", 426000, "5.0%", 422000, "5.0%", 402000, "6.0%"],
    ["Total Revenue", 8512000, "100.0%", 8394000, "100.0%", 8006000, "6.3%"],
    [],
    ["COST OF SERVICES"],
    ["  Physician & Clinical Salaries", 1872600, "22.0%", 1846700, "22.0%", 1761300, "6.3%"],
    ["  Nursing Staff & Agency Labor", 1361900, "16.0%", 1343000, "16.0%", 1281000, "6.3%"],
    ["  Medical Supplies & Disposables", 596000, "7.0%", 587600, "7.0%", 560400, "6.4%"],
    ["  Pharmacy & Drug Costs", 510700, "6.0%", 503600, "6.0%", 480400, "6.3%"],
    ["  Laboratory & Pathology", 425600, "5.0%", 419700, "5.0%", 400300, "6.3%"],
    ["  Food & Patient Nutrition", 170200, "2.0%", 168000, "2.0%", 160100, "6.3%"],
    ["  Medical Equipment Lease", 281000, "3.3%", 278000, "3.3%", 268000, "4.9%"],
    ["Total Cost of Services", 5218000, "61.3%", 5146600, "61.3%", 4911500, "6.2%"],
    [],
    ["GROSS PROFIT", 3294000, "38.7%", 3247400, "38.7%", 3094500, "6.4%"],
    [],
    ["OPERATING EXPENSES"],
    ["  Administrative & Support Staff", 681000, "8.0%", 671500, "8.0%", 640500, "6.3%"],
    ["  Facility Occupancy & Lease", 383000, "4.5%", 383000, "4.6%", 372000, "3.0%"],
    ["  Insurance & Malpractice", 255400, "3.0%", 252000, "3.0%", 240200, "6.3%"],
    ["  IT & Medical Information Systems", 170200, "2.0%", 168000, "2.0%", 156000, "9.1%"],
    ["  Compliance & Regulatory", 127700, "1.5%", 126000, "1.5%", 120100, "6.3%"],
    ["  Marketing & Community Outreach", 85100, "1.0%", 84000, "1.0%", 80100, "6.2%"],
    ["  Professional Fees (Legal/Audit)", 127700, "1.5%", 126000, "1.5%", 120100, "6.3%"],
    ["  Utilities & Environmental", 170200, "2.0%", 168000, "2.0%", 160100, "6.3%"],
    ["  Staff Training & Credentialing", 85100, "1.0%", 84000, "1.0%", 76100, "11.8%"],
    ["  Other Operating", 161600, "1.9%", 162400, "1.9%", 152000, "6.3%"],
    ["Total Operating Expenses", 2247000, "26.4%", 2224900, "26.5%", 2117200, "6.1%"],
    [],
    ["EBITDA", 1047000, "12.3%", 1022500, "12.2%", 977300, "7.1%"],
    [],
    ["BELOW EBITDA"],
    ["  Depreciation - Medical Equipment", 185000, "2.2%", 185000, "2.2%", 175000, "5.7%"],
    ["  Depreciation - Facilities", 92000, "1.1%", 92000, "1.1%", 88000, "4.5%"],
    ["  Depreciation - IT Systems", 38000, "0.4%", 38000, "0.5%", 35000, "8.6%"],
    ["Total Depreciation", 315000, null, 315000, null, 298000],
    [],
    ["Interest Expense", 42000, null, 43000, null, 48000],
    ["Net Profit Before Tax", 690000, "8.1%", 664500, "7.9%", 631300, "9.3%"],
    ["Tax Expense (28%)", 193200, null, 186100],
    ["NET PROFIT AFTER TAX", 496800, "5.8%", 478400, "5.7%"],
    [],
    ["Operational Metrics - April 2026:"],
    ["  Total Headcount (FTE): 395 | Average Length of Stay: 4.2 days | Bed Occupancy: 87.3%"],
    ["  NPS Score (Q1-26 survey): 79 | Annualised Employee Turnover: 12.4% | Patient Readmission Rate: 3.1%"],
  ];

  const brightonBS: (string | number | null)[][] = [
    ["Brighton Healthcare Group"],
    ["Balance Sheet"],
    ["As at April 30, 2026", null, "Unaudited"],
    [],
    [null, "Apr-26 ($)", "Mar-26 ($)", "Dec-25 ($)"],
    [],
    ["ASSETS"],
    ["Current Assets"],
    ["  Cash & Cash Equivalents", 12845000, 12780000, 12600000],
    ["  Accounts Receivable - Patient", 1842000, 1816000, 1780000],
    ["  Accounts Receivable - Insurance", 962000, 948000, 920000],
    ["  Medical Supplies Inventory", 412000, 406000, 395000],
    ["  Pharmaceutical Inventory", 285000, 278000, 268000],
    ["  Prepaid Insurance & Licenses", 186000, 192000, 210000],
    ["  Other Current Assets", 98000, 95000, 88000],
    ["Total Current Assets", 16630000, 16515000, 16261000],
    [],
    ["Non-Current Assets"],
    ["  Medical Equipment (at cost)", 8420000, 8350000, 8200000],
    ["  Buildings & Leasehold Improvements", 12800000, 12800000, 12650000],
    ["  IT Infrastructure & Systems", 1240000, 1240000, 1180000],
    ["  Accumulated Depreciation", -4865000, -4550000, -3920000],
    ["  Goodwill - Acquisitions", 2800000, 2800000, 2800000],
    ["Total Non-Current Assets", 20395000, 20640000, 20910000],
    [],
    ["TOTAL ASSETS", 37025000, 37155000, 37171000],
    [],
    ["LIABILITIES & EQUITY"],
    ["Current Liabilities"],
    ["  Accounts Payable - Suppliers", 1480000, 1520000, 1450000],
    ["  Accrued Salaries & Benefits", 1245000, 1230000, 1190000],
    ["  Deferred Revenue - Capitated Contracts", 580000, 565000, 540000],
    ["  Current Portion of Long-Term Debt", 420000, 420000, 420000],
    ["  Tax Payable", 248000, 242000, 580000],
    ["  Other Current Liabilities", 185000, 178000, 168000],
    ["Total Current Liabilities", 4158000, 4155000, 4348000],
    [],
    ["Non-Current Liabilities"],
    ["  Term Loan Facility", 6200000, 6250000, 6400000],
    ["  Equipment Finance Leases", 1840000, 1880000, 1960000],
    ["  Provision for Medical Claims", 420000, 415000, 400000],
    ["Total Non-Current Liabilities", 8460000, 8545000, 8760000],
    [],
    ["TOTAL LIABILITIES", 12618000, 12700000, 13108000],
    [],
    ["SHAREHOLDERS' EQUITY"],
    ["  Issued Capital", 8500000, 8500000, 8500000],
    ["  Retained Earnings", 15410200, 15476600, 15063000],
    ["  Current Period Net Profit", 496800, 478400, 500000],
    ["Total Shareholders' Equity", 24407000, 24455000, 24063000],
    [],
    ["TOTAL LIABILITIES & EQUITY", 37025000, 37155000, 37171000],
  ];

  const brightonCF: (string | number | null)[][] = [
    ["Brighton Healthcare Group"],
    ["Cash Flow Statement"],
    ["For the Month Ended April 30, 2026", null, "Indirect Method | Unaudited"],
    [],
    [null, "Apr-26 ($)", "Mar-26 ($)"],
    [],
    ["CASH FLOWS FROM OPERATING ACTIVITIES"],
    ["  Net Profit After Tax", 496800, 478400],
    ["  Adjustments:"],
    ["    Depreciation & Amortisation", 315000, 315000],
    ["  Changes in Working Capital:"],
    ["    (Inc)/Dec Trade & Insurance Receivables", -40000, -28000],
    ["    (Inc)/Dec Medical Inventories", -13000, -8000],
    ["    Inc/(Dec) Accounts Payable", -40000, 35000],
    ["    Inc/(Dec) Accrued Salaries", 15000, 18000],
    ["    Inc/(Dec) Deferred Revenue", 15000, 12000],
    ["    Net Other Working Capital", 25200, 16000],
    ["  NET CASH FROM OPERATING ACTIVITIES", 774000, 838400],
    [],
    ["CASH FLOWS FROM INVESTING ACTIVITIES"],
    ["  Purchase of Medical Equipment", -178000, -165000],
    ["  IT Systems & Infrastructure", -30000, -25000],
    ["  Building Improvements", null, -15000],
    ["  NET CASH FROM INVESTING ACTIVITIES", -208000, -205000],
    [],
    ["CASH FLOWS FROM FINANCING ACTIVITIES"],
    ["  Repayment of Term Loan", -50000, -50000],
    ["  Repayment of Equipment Leases", -40000, -40000],
    ["  Dividends Paid", -411000, null],
    ["  NET CASH FROM FINANCING ACTIVITIES", -501000, -90000],
    [],
    ["NET INCREASE/(DECREASE) IN CASH", 65000, 543400],
    ["Cash - Opening Balance", 12780000, 12236600],
    ["CASH - CLOSING BALANCE", 12845000, 12780000],
  ];

  const brightonWb = XLSX.utils.book_new();

  const isSheet = XLSX.utils.aoa_to_sheet(brightonIS);
  isSheet['!cols'] = [
    { wch: 38 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(brightonWb, isSheet, "Income Statement");

  const bsSheet = XLSX.utils.aoa_to_sheet(brightonBS);
  bsSheet['!cols'] = [
    { wch: 42 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(brightonWb, bsSheet, "Balance Sheet");

  const cfSheet = XLSX.utils.aoa_to_sheet(brightonCF);
  cfSheet['!cols'] = [
    { wch: 46 }, { wch: 16 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(brightonWb, cfSheet, "Cash Flow");

  const brightonBuf = XLSX.write(brightonWb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(path.join(demoDir, "brighton_april2026_financials.xlsx"), brightonBuf);

  // ── File 3: Culinary Concepts PDF (P&L) ────────────────────────────────────
  const culinaryLines = [
    "Culinary Concepts Group",
    "Profit & Loss Statement",
    "For the Month Ended April 30, 2026",
    "Unaudited | For Internal Distribution Only",
    " ",
    "                       Apr-26 ($)  % Rev  Mar-26 ($)  % Rev",
    " ",
    "REVENUE",
    "  Food & Non-Alcoholic   $394,400  66.8%    $381,700  66.8%",
    "  Alcoholic Beverages    $132,200  22.4%    $128,100  22.4%",
    "  Private Dining/Events   $63,800  10.8%     $62,200  10.8%",
    "Total Revenue            $590,400 100.0%    $572,000 100.0%",
    " ",
    "COST OF SALES",
    "  Food Cost              $135,800  23.0%    $131,600  23.0%",
    "  Beverage Cost Non-Alc   $16,900   2.9%     $16,400   2.9%",
    "  Beverage Cost Spirits   $48,900   8.3%     $47,500   8.3%",
    "  Catering Supplies        $1,540   0.3%      $1,490   0.3%",
    "  Packaging                $1,920   0.3%      $1,860   0.3%",
    "  Waste & Spoilage           $440   0.1%        $450   0.1%",
    "Total Cost of Sales      $205,500  34.8%    $199,300  34.8%",
    " ",
    "GROSS PROFIT             $384,900  65.2%    $372,700  65.2%",
    " ",
    "OPERATING EXPENSES",
    "  FOH Labour              $80,900  13.7%     $78,400  13.7%",
    "  Kitchen & BOH Labour    $85,200  14.4%     $82,500  14.4%",
    "  Management Salaries     $23,400   4.0%     $23,400   4.1%",
    "  Casual & Event Labour   $12,400   2.1%     $10,800   1.9%",
    "  Payroll Tax & Insurance $13,200   2.2%     $12,800   2.2%",
    "  Superannuation           $9,500   1.6%      $9,200   1.6%",
    "  Rent & Outgoings        $35,400   6.0%     $35,400   6.2%",
    "  Utilities               $18,800   3.2%     $18,800   3.3%",
    "  Cleaning & Sanitation    $5,900   1.0%      $5,700   1.0%",
    "  Repairs & Maintenance    $8,400   1.4%      $8,000   1.4%",
    "  Marketing                $9,800   1.7%      $9,500   1.7%",
    "  Delivery Commissions     $7,100   1.2%      $6,800   1.2%",
    "  Payment Processing       $5,000   0.8%      $4,900   0.9%",
    "  Insurance                $4,900   0.8%      $4,900   0.9%",
    "  Other Operating          $10,800   1.8%     $10,300   1.8%",
    "Total Opex               $330,700  56.0%    $321,400  56.2%",
    " ",
    "EBITDA                    $54,200   9.2%     $51,300   9.0%",
    " ",
    "  Depreciation            $18,500   3.1%     $18,500   3.2%",
    "  Interest Expense         $3,100   0.5%      $3,100   0.5%",
    "  Bank Charges             $1,000   0.2%      $1,000   0.2%",
    "Net Profit Before Tax     $31,600   5.4%     $29,700   5.2%",
    "  Tax (25%)                $7,900             $7,425",
    "NET PROFIT AFTER TAX      $23,700   4.0%     $22,275   3.9%",
    " ",
    "---",
    "Same-Store Sales Growth vs pcp: +3.5%",
    "Avg Check Size: $41.80 | Covers: ~14,130",
    "Employee Turnover: 23.2% | NPS: 68",
    "Inventory Days: 13",
  ];
  const culinaryPdf = buildTextPdf(culinaryLines);
  writeFileSync(path.join(demoDir, "culinary_april2026_pnl.pdf"), culinaryPdf);

  // ── File 4: Pinnacle Retail Group XLSX (3-year historical for onboarding) ──
  const pinnacleIS: (string | number | null)[][] = [
    ["Pinnacle Retail Group"],
    ["Consolidated Income Statement"],
    ["For the Years Ended December 31", null, "Audited"],
    [],
    [null, "FY2025 ($)", "FY2024 ($)", "FY2023 ($)"],
    [],
    ["REVENUE"],
    ["  Retail Sales — In-Store", 17200000, 15040000, 12560000],
    ["  Retail Sales — E-Commerce", 3010000, 2256000, 1570000],
    ["  Gift Cards & Loyalty Redemptions", 645000, 564000, 471000],
    ["  Wholesale & Corporate Sales", 645000, 540000, 399000],
    ["Total Revenue", 21500000, 18400000, 15000000],
    [],
    ["COST OF GOODS SOLD"],
    ["  Merchandise Purchases", 7740000, 6624000, 5550000],
    ["  Freight & Distribution", 1075000, 920000, 750000],
    ["  Warehouse & Fulfilment", 430000, 368000, 300000],
    ["  Shrinkage & Markdowns", 322500, 276000, 225000],
    ["Total COGS", 9567500, 8188000, 6825000],
    [],
    ["GROSS PROFIT", 11932500, 10212000, 8175000],
    ["  Gross Margin %", "55.5%", "55.5%", "54.5%"],
    [],
    ["OPERATING EXPENSES"],
    ["  Store Staff Wages & Benefits", 4085000, 3496000, 2850000],
    ["  Store Occupancy (Rent + CAM)", 2580000, 2208000, 1800000],
    ["  Management & Head Office Staff", 1290000, 1104000, 900000],
    ["  Marketing & Customer Acquisition", 860000, 736000, 600000],
    ["  IT & E-Commerce Platform", 430000, 368000, 285000],
    ["  Depreciation — Store Fit-outs", 322500, 276000, 225000],
    ["  Depreciation — IT & Equipment", 129000, 110400, 90000],
    ["  Insurance", 215000, 184000, 150000],
    ["  Utilities", 258000, 220800, 180000],
    ["  Professional Fees (Audit/Legal)", 172000, 147200, 120000],
    ["  Other Operating Expenses", 215000, 184000, 150000],
    ["Total Operating Expenses", 10556500, 9034400, 7350000],
    [],
    ["EBITDA", 1827500, 1564000, 1190000],
    ["  EBITDA Margin %", "8.5%", "8.5%", "7.9%"],
    [],
    ["  Total Depreciation (above)", 451500, 386400, 315000],
    ["EBIT", 1376000, 1177600, 875000],
    [],
    ["  Interest Expense", 168000, 180000, 195000],
    ["Net Profit Before Tax", 1208000, 997600, 680000],
    ["  Income Tax (26%)", 314100, 259400, 176800],
    ["NET PROFIT AFTER TAX", 893900, 738200, 503200],
    ["  Net Margin %", "4.2%", "4.0%", "3.4%"],
    [],
    ["Supplementary:"],
    ["  Store Count (end of year)", 14, 12, 10],
    ["  Same-Store Sales Growth", "+4.2%", "+3.8%", "+3.5%"],
    ["  Average Transaction Value", "$42", "$39", "$37"],
    ["  E-Commerce % of Revenue", "14.0%", "12.3%", "10.5%"],
  ];

  const pinnacleBS: (string | number | null)[][] = [
    ["Pinnacle Retail Group"],
    ["Consolidated Balance Sheet"],
    ["As at December 31", null, "Audited"],
    [],
    [null, "FY2025 ($)", "FY2024 ($)", "FY2023 ($)"],
    [],
    ["ASSETS"],
    ["Current Assets"],
    ["  Cash & Cash Equivalents", 2180000, 1840000, 1520000],
    ["  Accounts Receivable — Trade", 312000, 268000, 218000],
    ["  Inventory — Merchandise", 1935000, 1656000, 1350000],
    ["  Prepaid Rent & Expenses", 186000, 162000, 132000],
    ["  Other Current Assets", 78000, 66000, 54000],
    ["Total Current Assets", 4691000, 3992000, 3274000],
    [],
    ["Non-Current Assets"],
    ["  Store Fit-outs & Leasehold (at cost)", 3225000, 2760000, 2250000],
    ["  Furniture, Fixtures & Equipment", 1075000, 920000, 750000],
    ["  IT Systems & E-Commerce Platform", 538000, 460000, 375000],
    ["  Accumulated Depreciation", -1890000, -1438500, -1052100],
    ["  Right-of-Use Assets (AASB 16)", 4300000, 3680000, 3000000],
    ["  Goodwill", 450000, 450000, 450000],
    ["Total Non-Current Assets", 7698000, 6831500, 5772900],
    [],
    ["TOTAL ASSETS", 12389000, 10823500, 9046900],
    [],
    ["LIABILITIES & EQUITY"],
    ["Current Liabilities"],
    ["  Accounts Payable — Suppliers", 1290000, 1104000, 900000],
    ["  Accrued Wages & Benefits", 322500, 276000, 225000],
    ["  Gift Card Liability", 215000, 184000, 150000],
    ["  Lease Liability — Current", 860000, 736000, 600000],
    ["  Income Tax Payable", 125600, 103800, 70700],
    ["  Other Current Liabilities", 129000, 110400, 90000],
    ["Total Current Liabilities", 2942100, 2514200, 2035700],
    [],
    ["Non-Current Liabilities"],
    ["  Lease Liability — Non-Current", 3440000, 2944000, 2400000],
    ["  Term Loan Facility", 1500000, 1680000, 1860000],
    ["  Provisions (Make-good)", 215000, 184000, 150000],
    ["Total Non-Current Liabilities", 5155000, 4808000, 4410000],
    [],
    ["TOTAL LIABILITIES", 8097100, 7322200, 6445700],
    [],
    ["SHAREHOLDERS' EQUITY"],
    ["  Issued Capital", 1800000, 1800000, 1800000],
    ["  Retained Earnings", 2491900, 1701300, 1001200],
    ["  Accumulated OCI", null, null, -200000],
    ["Total Shareholders' Equity", 4291900, 3501300, 2601200],
    [],
    ["TOTAL LIABILITIES & EQUITY", 12389000, 10823500, 9046900],
  ];

  const pinnacleCF: (string | number | null)[][] = [
    ["Pinnacle Retail Group"],
    ["Consolidated Cash Flow Statement"],
    ["For the Years Ended December 31", null, "Indirect Method | Audited"],
    [],
    [null, "FY2025 ($)", "FY2024 ($)", "FY2023 ($)"],
    [],
    ["CASH FLOWS FROM OPERATING ACTIVITIES"],
    ["  Net Profit After Tax", 893900, 738200, 503200],
    ["  Adjustments:"],
    ["    Depreciation & Amortisation", 451500, 386400, 315000],
    ["    ROU Asset Amortisation", 620000, 530400, 432000],
    ["  Changes in Working Capital:"],
    ["    (Inc)/Dec Trade Receivables", -44000, -50000, -28000],
    ["    (Inc)/Dec Inventory", -279000, -306000, -162000],
    ["    (Inc)/Dec Prepaid Expenses", -24000, -30000, -18000],
    ["    Inc/(Dec) Accounts Payable", 186000, 204000, 108000],
    ["    Inc/(Dec) Accrued Wages", 46500, 51000, 27000],
    ["    Inc/(Dec) Gift Card Liability", 31000, 34000, 18000],
    ["    Inc/(Dec) Tax Payable", 21800, 33100, 12700],
    ["    Net Other Working Capital", 18600, 20400, 10800],
    ["  NET CASH FROM OPERATING ACTIVITIES", 1922300, 1611500, 1218700],
    [],
    ["CASH FLOWS FROM INVESTING ACTIVITIES"],
    ["  Store Fit-out Capital (new + refurb)", -465000, -510000, -315000],
    ["  IT & E-Commerce Development", -78000, -85000, -56250],
    ["  Furniture, Fixtures & Equipment", -155000, -170000, -112500],
    ["  NET CASH FROM INVESTING ACTIVITIES", -698000, -765000, -483750],
    [],
    ["CASH FLOWS FROM FINANCING ACTIVITIES"],
    ["  Repayment of Term Loan", -180000, -180000, -180000],
    ["  Lease Payments (Principal)", -620000, -530400, -432000],
    ["  Dividends Paid", -84300, -16100, null],
    ["  NET CASH FROM FINANCING ACTIVITIES", -884300, -726500, -612000],
    [],
    ["NET INCREASE IN CASH", 340000, 120000, 122950],
    ["Cash — Opening Balance", 1840000, 1720000, 1397050],
    ["CASH — CLOSING BALANCE", 2180000, 1840000, 1520000],
    [],
    ["Note: FY2023 opening cash balance adjusted for pre-acquisition period."],
  ];

  const pinnacleWb = XLSX.utils.book_new();

  const pisSheet = XLSX.utils.aoa_to_sheet(pinnacleIS);
  pisSheet['!cols'] = [
    { wch: 42 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(pinnacleWb, pisSheet, "Income Statement");

  const pbsSheet = XLSX.utils.aoa_to_sheet(pinnacleBS);
  pbsSheet['!cols'] = [
    { wch: 42 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(pinnacleWb, pbsSheet, "Balance Sheet");

  const pcfSheet = XLSX.utils.aoa_to_sheet(pinnacleCF);
  pcfSheet['!cols'] = [
    { wch: 46 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(pinnacleWb, pcfSheet, "Cash Flow");

  const pinnacleBuf = XLSX.write(pinnacleWb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(path.join(demoDir, "pinnacle_retail_historical_financials.xlsx"), pinnacleBuf);
}

seed().catch(console.error);
