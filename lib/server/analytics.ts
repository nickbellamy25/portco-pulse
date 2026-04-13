/**
 * Server-side analytics query layer.
 * All dashboard/analytics read queries live here — never call DB directly from pages.
 */

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, or, desc, isNull, ne, inArray, sql } from "drizzle-orm";
import { endOfMonth, addDays } from "date-fns";

// ─── FILTER TYPES & HELPERS ───────────────────────────────────────────────────

export type CompanyFilters = {
  fund?: string;          // "" = all | "independent" = null-fund | fund name
  industry?: string;      // "" = all | industry name
  status?: string;        // "" = all | "current" | "exited"
  allowedIds?: string[] | null; // null = no restriction | string[] = scoped member
};

export function applyCompanyFilters(companies: schema.Company[], filters: CompanyFilters): schema.Company[] {
  return companies.filter((c) => {
    if (filters.allowedIds != null && !filters.allowedIds.includes(c.id)) return false;
    if (filters.fund) {
      if (filters.fund === "independent") {
        if ((c as any).fund != null) return false;
      } else {
        if ((c as any).fund !== filters.fund) return false;
      }
    }
    if (filters.industry && c.industry !== filters.industry) return false;
    if (filters.status && (c as any).status !== filters.status) return false;
    return true;
  });
}

/**
 * Returns null if the user has full access (admin or no scopes configured).
 * Returns a string[] of allowed company IDs if the user has scope restrictions.
 */
export function getAccessibleCompanyIds(userId: string, firmId: string): string[] | null {
  const scopes = db
    .select()
    .from(schema.userAccessScopes)
    .where(
      and(
        eq(schema.userAccessScopes.userId, userId),
        eq(schema.userAccessScopes.firmId, firmId)
      )
    )
    .all();

  if (scopes.length === 0) return null; // full access

  const allCompanies = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.firmId, firmId))
    .all();

  const allowed = new Set<string>();
  for (const company of allCompanies) {
    for (const scope of scopes) {
      if (scope.scopeType === "company" && scope.scopeValue === company.id) {
        allowed.add(company.id);
      } else if (scope.scopeType === "fund" && (company as any).fund === scope.scopeValue) {
        allowed.add(company.id);
      } else if (scope.scopeType === "industry" && company.industry === scope.scopeValue) {
        allowed.add(company.id);
      }
    }
  }
  return [...allowed];
}

export function getCompanyFilterOptions(firmId: string): { funds: string[]; industries: string[] } {
  const allCompanies = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.firmId, firmId))
    .all();

  const fundSet = new Set<string>();
  for (const c of allCompanies) {
    fundSet.add((c as any).fund != null ? (c as any).fund : "independent");
  }

  const industrySet = new Set<string>();
  for (const c of allCompanies) {
    if (c.industry) industrySet.add(c.industry);
  }

  return {
    funds: [...fundSet].sort((a, b) => {
      if (a === "independent") return 1;
      if (b === "independent") return -1;
      return a.localeCompare(b);
    }),
    industries: [...industrySet].sort(),
  };
}

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────

/** Parse "key:cadence,key:cadence" into a lookup map. */
export function parseDocCadences(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of (raw ?? "").split(",").filter(Boolean)) {
    const [key, cadence] = entry.split(":");
    if (key && cadence) map[key] = cadence;
  }
  return map;
}

/** Returns true if the given doc cadence means the doc is due in the given period month (1–12). */
export function isDocDueThisPeriod(cadence: string, periodMonth: number): boolean {
  switch (cadence) {
    case "quarterly": return periodMonth % 3 === 0; // Mar, Jun, Sep, Dec
    case "bi-annual": return periodMonth === 6 || periodMonth === 12;
    case "annual":    return periodMonth === 12;
    default:          return true; // monthly + unknown = always due
  }
}

/** Compute RAG status from actual vs plan. Returns null if either value is missing or plan is 0. */
export function computeRagPct(
  actual: number,
  plan: number,
  greenPct: number,
  amberPct: number,
  direction: "higher_is_better" | "lower_is_better" | "any_variance"
): "green" | "amber" | "red" | null {
  if (plan === 0) return null;
  const rawPct = ((actual - plan) / Math.abs(plan)) * 100;
  if (direction === "any_variance") {
    const absPct = Math.abs(rawPct);
    if (absPct <= greenPct) return "green";
    if (absPct <= amberPct) return "amber";
    return "red";
  }
  const signed = direction === "lower_is_better" ? -rawPct : rawPct;
  if (signed >= -greenPct) return "green";
  if (signed >= -amberPct) return "amber";
  return "red";
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type SubmittedKpiValue = {
  companyId: string;
  companyName: string;
  periodId: string;
  periodStart: string;
  kpiKey: string;
  kpiLabel: string;
  kpiUnit: string | null;
  kpiValueType: string;
  actualNumber: number | null;
  actualText: string | null;
};

export type PortfolioDashboardData = {
  totalCompanies: number;
  submittedThisMonth: number;
  pendingSubmissions: number;
  ebitdaByCompany: Array<{ name: string; ebitda: number }>;
  cashByCompany: Array<{ name: string; cash: number }>;
  openPeriod: schema.Period | null;
  companies: Array<{ id: string; name: string }>;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Get the period matching the current calendar month, or the most recent one */
export function getCurrentPeriod(firmId: string) {
  const thisMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const all = db
    .select()
    .from(schema.periods)
    .where(and(eq(schema.periods.firmId, firmId), eq(schema.periods.periodType, "monthly")))
    .orderBy(desc(schema.periods.periodStart))
    .all();
  return all.find((p) => p.periodStart.slice(0, 7) === thisMonth) ?? all[0] ?? null;
}

/** Ensure a period exists for the current calendar month; create it if missing */
export function ensureCurrentPeriod(firmId: string) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const periodStart = `${thisMonth}-01`;
  const existing = db
    .select()
    .from(schema.periods)
    .where(and(eq(schema.periods.firmId, firmId), eq(schema.periods.periodStart, periodStart)))
    .get();
  if (!existing) {
    db.insert(schema.periods).values({
      firmId,
      periodType: "monthly",
      periodStart,
      dueDate: null,
      status: "open",
    }).run();
  }
  return getCurrentPeriod(firmId);
}

/** @deprecated Use getCurrentPeriod instead */
export function getOpenPeriod(firmId: string) {
  return getCurrentPeriod(firmId);
}

/** Get all periods for a firm ordered newest first */
export function getAllPeriods(firmId: string) {
  return db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.firmId, firmId))
    .orderBy(desc(schema.periods.periodStart))
    .all();
}

/** Get all companies for a firm */
export function getCompanies(firmId: string) {
  return db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.firmId, firmId))
    .orderBy(schema.companies.name)
    .all();
}

/** Get a single company by id (with firm check) */
export function getCompany(firmId: string, companyId: string) {
  return db
    .select()
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.firmId, firmId),
        eq(schema.companies.id, companyId)
      )
    )
    .get() ?? null;
}

/** Get company by submission token */
export function getCompanyByToken(token: string) {
  return db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.submissionToken, token))
    .get() ?? null;
}

/** Get firm by id */
export function getFirm(firmId: string) {
  return db
    .select()
    .from(schema.firms)
    .where(eq(schema.firms.id, firmId))
    .get() ?? null;
}

// ─── PORTFOLIO DASHBOARD ──────────────────────────────────────────────────────

export function getPortfolioDashboardData(firmId: string, filters: CompanyFilters = {}): PortfolioDashboardData {
  const openPeriod = getCurrentPeriod(firmId);
  const allCompanies = getCompanies(firmId);
  const companies = applyCompanyFilters(allCompanies, filters);
  const totalCompanies = companies.length;

  const dashboardPeriod = openPeriod;

  const companyIds = companies.map((c) => c.id);

  // Submitted this month (open period)
  let submittedThisMonth = 0;
  let pendingSubmissions = totalCompanies;
  if (openPeriod) {
    submittedThisMonth = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.firmId, firmId),
          eq(schema.submissions.periodId, openPeriod.id),
          eq(schema.submissions.status, "submitted")
        )
      )
      .get()?.count ?? 0;
    pendingSubmissions = totalCompanies - submittedThisMonth;
  }

  // EBITDA and Cash by company for latest period
  const ebitdaByCompany: Array<{ name: string; ebitda: number }> = [];
  const cashByCompany: Array<{ name: string; cash: number }> = [];

  if (dashboardPeriod) {
    // Get EBITDA kpi def
    const ebitdaDef = db
      .select()
      .from(schema.kpiDefinitions)
      .where(
        and(
          eq(schema.kpiDefinitions.firmId, firmId),
          eq(schema.kpiDefinitions.key, "ebitda")
        )
      )
      .get();

    const cashDef = db
      .select()
      .from(schema.kpiDefinitions)
      .where(
        and(
          eq(schema.kpiDefinitions.firmId, firmId),
          eq(schema.kpiDefinitions.key, "cash_balance")
        )
      )
      .get();

    // Batch: fetch all submitted submissions for this period at once
    const allSubs = db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.firmId, firmId),
          eq(schema.submissions.periodId, dashboardPeriod.id),
          eq(schema.submissions.status, "submitted")
        )
      )
      .all();

    const subByCompany = new Map(allSubs.map(s => [s.companyId, s]));
    const subIds = allSubs.map(s => s.id);

    // Batch: fetch all relevant KPI values for those submissions at once
    const kpiDefIds = [ebitdaDef?.id, cashDef?.id].filter((id): id is string => !!id);
    const allVals = (subIds.length > 0 && kpiDefIds.length > 0)
      ? db
          .select()
          .from(schema.kpiValues)
          .where(
            and(
              inArray(schema.kpiValues.submissionId, subIds),
              inArray(schema.kpiValues.kpiDefinitionId, kpiDefIds)
            )
          )
          .all()
      : [];

    // Index: submissionId → kpiDefId → value
    const valIndex = new Map<string, Map<string, number | null>>();
    for (const v of allVals) {
      if (!valIndex.has(v.submissionId)) valIndex.set(v.submissionId, new Map());
      valIndex.get(v.submissionId)!.set(v.kpiDefinitionId, v.actualNumber ?? null);
    }

    for (const company of companies) {
      const sub = subByCompany.get(company.id);
      if (!sub) continue;

      if (ebitdaDef) {
        const val = valIndex.get(sub.id)?.get(ebitdaDef.id);
        if (val !== null && val !== undefined) {
          ebitdaByCompany.push({ name: company.name, ebitda: val });
        }
      }

      if (cashDef) {
        const val = valIndex.get(sub.id)?.get(cashDef.id);
        if (val !== null && val !== undefined) {
          cashByCompany.push({ name: company.name, cash: val });
        }
      }
    }
  }

  // Sort descending
  ebitdaByCompany.sort((a, b) => b.ebitda - a.ebitda);
  cashByCompany.sort((a, b) => b.cash - a.cash);

  return {
    totalCompanies,
    submittedThisMonth: Number(submittedThisMonth),
    pendingSubmissions: Number(pendingSubmissions),
    ebitdaByCompany,
    cashByCompany,
    openPeriod,
    companies: companies.map((c) => ({ id: c.id, name: c.name })),
  };
}

// ─── PORTFOLIO PLAN SUMMARY ───────────────────────────────────────────────────

export type CompanyPlanSummary = {
  companyId: string;
  companyName: string;
  hasPlan: boolean;
  latestMonth: number | null; // last month with submitted data
  revenue: {
    ytdActual: number | null;
    ytdPlan: number | null;
    ytdVariancePct: number | null;
    rag: "green" | "amber" | "red" | null;
    thruMonth: number | null;
  } | null;
  grossMargin: {
    ytdActual: number | null;
    ytdPlan: number | null;
    ytdVariancePct: number | null;
    rag: "green" | "amber" | "red" | null;
    thruMonth: number | null;
  } | null;
  ebitda: {
    ytdActual: number | null;
    ytdPlan: number | null;
    ytdVariancePct: number | null;
    rag: "green" | "amber" | "red" | null;
    thruMonth: number | null;
  } | null;
};

export type PortfolioPlanSummary = {
  fiscalYear: number;
  companies: CompanyPlanSummary[];
  ragDistribution: { green: number; amber: number; red: number; noPlan: number };
  onPlanCount: number;
  totalWithPlan: number;
};

export function getPortfolioPlanSummary(firmId: string, companyIds: string[]): PortfolioPlanSummary {
  const fiscalYear = new Date().getFullYear();
  const empty: PortfolioPlanSummary = {
    fiscalYear,
    companies: [],
    ragDistribution: { green: 0, amber: 0, red: 0, noPlan: 0 },
    onPlanCount: 0,
    totalWithPlan: 0,
  };
  if (!companyIds.length) return empty;

  // Revenue + EBITDA KPI definitions
  const revenueDef = db.select().from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, firmId), eq(schema.kpiDefinitions.key, "revenue")))
    .get() ?? null;
  const grossMarginDef = db.select().from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, firmId), eq(schema.kpiDefinitions.key, "gross_margin")))
    .get() ?? null;
  const ebitdaDef = db.select().from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, firmId), eq(schema.kpiDefinitions.key, "ebitda")))
    .get() ?? null;
  if (!revenueDef && !grossMarginDef && !ebitdaDef) return empty;

  // Latest submitted plan per company for this fiscal year
  const allPlans = db.select().from(schema.kpiPlans)
    .where(and(
      inArray(schema.kpiPlans.companyId, companyIds),
      eq(schema.kpiPlans.fiscalYear, fiscalYear)
    ))
    .all()
    .filter((p) => p.submittedAt !== null);

  const latestPlanByCompany = new Map<string, schema.KpiPlan>();
  for (const plan of allPlans.sort((a, b) => a.version - b.version)) {
    latestPlanByCompany.set(plan.companyId, plan);
  }

  // Plan values indexed: planId → kpiDefId → month (null=annual)
  const planIds = [...latestPlanByCompany.values()].map((p) => p.id);
  const allPlanVals = planIds.length
    ? db.select().from(schema.kpiPlanValues).where(inArray(schema.kpiPlanValues.planId, planIds)).all()
    : [];
  const planValIdx = new Map<string, Map<string, Map<number | null, number | null>>>();
  for (const pv of allPlanVals) {
    if (!planValIdx.has(pv.planId)) planValIdx.set(pv.planId, new Map());
    if (!planValIdx.get(pv.planId)!.has(pv.kpiDefinitionId))
      planValIdx.get(pv.planId)!.set(pv.kpiDefinitionId, new Map());
    planValIdx.get(pv.planId)!.get(pv.kpiDefinitionId)!.set(pv.periodMonth ?? null, pv.value ?? null);
  }

  // Submitted submissions for these companies in the current fiscal year
  const allFirmPeriods = db.select().from(schema.periods)
    .where(eq(schema.periods.firmId, firmId))
    .all()
    .filter((p) => p.periodStart.startsWith(`${fiscalYear}-`));
  const periodIdToMonth = new Map(allFirmPeriods.map((p) => [p.id, parseInt(p.periodStart.slice(5, 7), 10)]));
  const fiscalPeriodIds = allFirmPeriods.map((p) => p.id);

  const submissions = fiscalPeriodIds.length
    ? db.select().from(schema.submissions)
        .where(and(
          inArray(schema.submissions.companyId, companyIds),
          inArray(schema.submissions.periodId, fiscalPeriodIds),
          eq(schema.submissions.status, "submitted")
        ))
        .all()
    : [];

  const kpiDefIds = [revenueDef?.id, grossMarginDef?.id, ebitdaDef?.id].filter(Boolean) as string[];
  const subIds = submissions.map((s) => s.id);
  const kpiVals = subIds.length && kpiDefIds.length
    ? db.select().from(schema.kpiValues)
        .where(and(
          inArray(schema.kpiValues.submissionId, subIds),
          inArray(schema.kpiValues.kpiDefinitionId, kpiDefIds)
        ))
        .all()
    : [];

  // Actual values: companyId → kpiDefId → month → value
  const actuals = new Map<string, Map<string, Map<number, number>>>();
  for (const sub of submissions) {
    const month = periodIdToMonth.get(sub.periodId);
    if (!month) continue;
    for (const val of kpiVals.filter((v) => v.submissionId === sub.id)) {
      if (val.actualNumber === null) continue;
      if (!actuals.has(sub.companyId)) actuals.set(sub.companyId, new Map());
      if (!actuals.get(sub.companyId)!.has(val.kpiDefinitionId))
        actuals.get(sub.companyId)!.set(val.kpiDefinitionId, new Map());
      actuals.get(sub.companyId)!.get(val.kpiDefinitionId)!.set(month, val.actualNumber);
    }
  }

  function kpiYtd(
    companyId: string,
    plan: schema.KpiPlan | undefined,
    def: schema.KpiDefinition | null,
    thruMonth: number,
    isPercent = false
  ): CompanyPlanSummary["revenue"] {
    if (!def) return null;
    const byMonth = actuals.get(companyId)?.get(def.id);
    if (!byMonth) return null;

    let ytdActual = 0;
    let count = 0;
    let kpiLatestMonth = 0;
    for (let m = 1; m <= thruMonth; m++) {
      const v = byMonth.get(m);
      if (v !== undefined) { ytdActual += v; count++; kpiLatestMonth = m; }
    }
    if (!count) return null;
    if (isPercent) ytdActual = ytdActual / count;

    let ytdPlan: number | null = null;
    if (plan) {
      const byKpi = planValIdx.get(plan.id)?.get(def.id);
      if (byKpi) {
        if (plan.granularity === "annual") {
          const annual = byKpi.get(null) ?? null;
          ytdPlan = annual !== null ? (isPercent ? annual : annual * (thruMonth / 12)) : null;
        } else {
          let s = 0; let pc = 0;
          for (let m = 1; m <= thruMonth; m++) {
            const pv = byKpi.get(m) ?? null;
            if (pv !== null) { s += pv; pc++; }
          }
          ytdPlan = pc ? (isPercent ? s / pc : s) : null;
        }
      }
    }

    const ytdVariancePct =
      ytdPlan !== null && ytdPlan !== 0
        ? ((ytdActual - ytdPlan) / Math.abs(ytdPlan)) * 100
        : null;
    const rag =
      ytdPlan !== null
        ? computeRagPct(
            ytdActual,
            ytdPlan,
            (def as any).ragGreenPct ?? 5,
            (def as any).ragAmberPct ?? 15,
            ((def as any).ragDirection ?? "higher_is_better") as "higher_is_better" | "lower_is_better" | "any_variance"
          )
        : null;

    return { ytdActual, ytdPlan, ytdVariancePct, rag, thruMonth: kpiLatestMonth || null };
  }

  const companies = db.select().from(schema.companies)
    .where(inArray(schema.companies.id, companyIds))
    .orderBy(schema.companies.name)
    .all();

  const summaries: CompanyPlanSummary[] = [];
  for (const company of companies) {
    const plan = latestPlanByCompany.get(company.id);
    const hasPlan = plan !== undefined;

    // Latest month with any data for this company
    const companyActuals = actuals.get(company.id);
    let latestMonth = 0;
    if (companyActuals) {
      for (const byMonth of companyActuals.values()) {
        for (const m of byMonth.keys()) if (m > latestMonth) latestMonth = m;
      }
    }

    if (latestMonth === 0) {
      summaries.push({ companyId: company.id, companyName: company.name, hasPlan, latestMonth: null, revenue: null, grossMargin: null, ebitda: null });
      continue;
    }

    const revenue = kpiYtd(company.id, plan, revenueDef, latestMonth);
    const grossMargin = kpiYtd(company.id, plan, grossMarginDef, latestMonth, true);
    const ebitda = kpiYtd(company.id, plan, ebitdaDef, latestMonth);
    const rags = [revenue?.rag, grossMargin?.rag, ebitda?.rag].filter(Boolean) as ("green" | "amber" | "red")[];
    const overallRag = rags.includes("red") ? "red" : rags.includes("amber") ? "amber" : rags.length > 0 ? "green" : null;

    summaries.push({ companyId: company.id, companyName: company.name, hasPlan, latestMonth, revenue, grossMargin, ebitda });
  }

  const ragDistribution = { green: 0, amber: 0, red: 0, noPlan: 0 };
  let onPlanCount = 0;
  let totalWithPlan = 0;
  for (const c of summaries) {
    const rags = [c.revenue?.rag, c.grossMargin?.rag, c.ebitda?.rag].filter(Boolean) as string[];
    if (!c.hasPlan || !rags.length) { ragDistribution.noPlan++; continue; }
    totalWithPlan++;
    if (rags.includes("red")) ragDistribution.red++;
    else if (rags.includes("amber")) ragDistribution.amber++;
    else { ragDistribution.green++; onPlanCount++; }
  }

  return { fiscalYear, companies: summaries, ragDistribution, onPlanCount, totalWithPlan };
}

// ─── LATEST SUBMISSION RAG ────────────────────────────────────────────────────

export type LatestSubmissionKpiViolation = {
  kpiLabel: string;
  kpiKey: string;
  actual: number;
  plan: number;
  unit: string | null;
  variancePct: number;
  ragStatus: "amber" | "red";
};

export type LatestSubmissionCompanyRag = {
  companyId: string;
  companyName: string;
  worstSeverity: "high" | "medium";
  periodLabel: string; // e.g. "Feb 2026"
  violations: LatestSubmissionKpiViolation[];
};

export type LatestSubmissionRagSummary = {
  offTrackCount: number;
  atRiskCount: number;
  total: number;
  companies: LatestSubmissionCompanyRag[];
};

/**
 * For each company, finds their most recent submitted period and evaluates
 * RAG status (% variance from plan) for each KPI.
 * Returns summary counts and per-company violation detail.
 */
export function getLatestSubmissionRagCount(firmId: string, companyIds: string[]): LatestSubmissionRagSummary {
  const empty: LatestSubmissionRagSummary = { offTrackCount: 0, atRiskCount: 0, total: 0, companies: [] };
  if (!companyIds.length) return empty;

  // All submitted submissions with period info
  const submissionsWithPeriod = db
    .select({
      submissionId: schema.submissions.id,
      companyId: schema.submissions.companyId,
      periodStart: schema.periods.periodStart,
    })
    .from(schema.submissions)
    .innerJoin(schema.periods, eq(schema.submissions.periodId, schema.periods.id))
    .where(and(
      eq(schema.submissions.firmId, firmId),
      inArray(schema.submissions.companyId, companyIds),
      eq(schema.submissions.status, "submitted")
    ))
    .all();

  // Keep only the latest submission per company
  const latestSubByCompany = new Map<string, { submissionId: string; periodStart: string }>();
  for (const row of submissionsWithPeriod) {
    const existing = latestSubByCompany.get(row.companyId);
    if (!existing || row.periodStart > existing.periodStart) {
      latestSubByCompany.set(row.companyId, { submissionId: row.submissionId, periodStart: row.periodStart });
    }
  }

  const total = latestSubByCompany.size;
  if (!total) return empty;

  // Active KPI definitions (numeric types only)
  const kpiDefs = db.select().from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, firmId), eq(schema.kpiDefinitions.active, true)))
    .all()
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));
  if (!kpiDefs.length) return { ...empty, total };

  const kpiDefById = new Map(kpiDefs.map((k) => [k.id, k]));

  // Company name lookup
  const companyRows = db.select({ id: schema.companies.id, name: schema.companies.name })
    .from(schema.companies)
    .where(inArray(schema.companies.id, companyIds))
    .all();
  const companyNameById = new Map(companyRows.map((c) => [c.id, c.name]));

  // KPI values for latest submissions
  const latestSubmissionIds = [...latestSubByCompany.values()].map((v) => v.submissionId);
  const kpiValues = db.select().from(schema.kpiValues)
    .where(inArray(schema.kpiValues.submissionId, latestSubmissionIds))
    .all();

  // Index: submissionId → kpiDefId → actualNumber
  const kvIdx = new Map<string, Map<string, number | null>>();
  for (const kv of kpiValues) {
    if (!kvIdx.has(kv.submissionId)) kvIdx.set(kv.submissionId, new Map());
    kvIdx.get(kv.submissionId)!.set(kv.kpiDefinitionId, kv.actualNumber ?? null);
  }

  // --- Plans: find latest submitted plan per company ---
  // Collect fiscal years from latest submissions
  const companyFiscalYears = new Map<string, number>();
  for (const [companyId, { periodStart }] of latestSubByCompany) {
    companyFiscalYears.set(companyId, parseInt(periodStart.slice(0, 4), 10));
  }
  const fiscalYears = [...new Set(companyFiscalYears.values())];

  const allPlans = db.select().from(schema.kpiPlans)
    .where(and(
      inArray(schema.kpiPlans.companyId, [...latestSubByCompany.keys()]),
      inArray(schema.kpiPlans.fiscalYear, fiscalYears)
    ))
    .all()
    .filter((p) => p.submittedAt !== null);

  // Latest plan per company (for matching fiscal year)
  const latestPlanByCompany = new Map<string, typeof allPlans[0]>();
  for (const plan of allPlans.sort((a, b) => a.version - b.version)) {
    const fy = companyFiscalYears.get(plan.companyId);
    if (plan.fiscalYear === fy) {
      latestPlanByCompany.set(plan.companyId, plan);
    }
  }

  // Plan values indexed: planId → kpiDefId → periodMonth → value
  const planIds = [...latestPlanByCompany.values()].map((p) => p.id);
  const allPlanVals = planIds.length
    ? db.select().from(schema.kpiPlanValues).where(inArray(schema.kpiPlanValues.planId, planIds)).all()
    : [];
  const planValIdx = new Map<string, Map<string, Map<number | null, number | null>>>();
  for (const pv of allPlanVals) {
    if (!planValIdx.has(pv.planId)) planValIdx.set(pv.planId, new Map());
    if (!planValIdx.get(pv.planId)!.has(pv.kpiDefinitionId))
      planValIdx.get(pv.planId)!.set(pv.kpiDefinitionId, new Map());
    planValIdx.get(pv.planId)!.get(pv.kpiDefinitionId)!.set(pv.periodMonth ?? null, pv.value ?? null);
  }

  // RAG overrides: companyId → kpiDefId → override
  const ragOverrideRows = db.select().from(schema.kpiRagOverrides)
    .where(and(
      eq(schema.kpiRagOverrides.firmId, firmId),
      inArray(schema.kpiRagOverrides.companyId, [...latestSubByCompany.keys()])
    ))
    .all();
  const ragOverrideIdx = new Map<string, Map<string, typeof ragOverrideRows[0]>>();
  for (const ro of ragOverrideRows) {
    if (!ragOverrideIdx.has(ro.companyId)) ragOverrideIdx.set(ro.companyId, new Map());
    ragOverrideIdx.get(ro.companyId)!.set(ro.kpiDefinitionId, ro);
  }

  // --- Evaluate each company ---
  let offTrackCount = 0;
  let atRiskCount = 0;
  const companies: LatestSubmissionCompanyRag[] = [];

  for (const [companyId, { submissionId, periodStart }] of latestSubByCompany) {
    const plan = latestPlanByCompany.get(companyId);
    if (!plan) continue; // Skip companies without a plan

    const month = parseInt(periodStart.slice(5, 7), 10);
    const kvMap = kvIdx.get(submissionId) ?? new Map();
    const companyRagOverrides = ragOverrideIdx.get(companyId);
    let worstSeverity: "high" | "medium" | null = null;
    const violations: LatestSubmissionKpiViolation[] = [];

    for (const def of kpiDefs) {
      if (def.companyId !== null && def.companyId !== companyId) continue;
      const actual = kvMap.get(def.id);
      if (actual === null || actual === undefined) continue;

      // Resolve plan value for this month
      const byKpi = planValIdx.get(plan.id)?.get(def.id);
      if (!byKpi) continue;

      let planVal: number | null = null;
      if (plan.granularity === "annual") {
        const annual = byKpi.get(null) ?? null;
        if (annual !== null) {
          planVal = def.valueType === "percent" ? annual : annual / 12;
        }
      } else {
        planVal = byKpi.get(month) ?? null;
      }
      if (planVal === null || planVal === 0) continue;

      // Get RAG thresholds (company override > firm default)
      const override = companyRagOverrides?.get(def.id);
      const greenPct = override?.ragGreenPct ?? (def as any).ragGreenPct ?? 5;
      const amberPct = override?.ragAmberPct ?? (def as any).ragAmberPct ?? 15;
      const direction = (override?.ragDirection ?? (def as any).ragDirection ?? "higher_is_better") as "higher_is_better" | "lower_is_better" | "any_variance";

      const rag = computeRagPct(actual, planVal, greenPct, amberPct, direction);
      if (rag === "amber" || rag === "red") {
        const variancePct = ((actual - planVal) / Math.abs(planVal)) * 100;
        violations.push({
          kpiLabel: def.label,
          kpiKey: def.key,
          actual,
          plan: planVal,
          unit: def.unit ?? null,
          variancePct,
          ragStatus: rag,
        });
        if (rag === "red") worstSeverity = "high";
        else if (worstSeverity !== "high") worstSeverity = "medium";
      }
    }

    if (worstSeverity && violations.length > 0) {
      const d = new Date(`${periodStart}T12:00:00`);
      companies.push({
        companyId,
        companyName: companyNameById.get(companyId) ?? companyId,
        worstSeverity,
        periodLabel: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        violations,
      });
      if (worstSeverity === "high") offTrackCount++;
      else atRiskCount++;
    }
  }

  // Sort: Off Track first, then At Risk, then alphabetically
  companies.sort((a, b) => {
    if (a.worstSeverity !== b.worstSeverity) return a.worstSeverity === "high" ? -1 : 1;
    return a.companyName.localeCompare(b.companyName);
  });

  return { offTrackCount, atRiskCount, total, companies };
}

// ─── PORTFOLIO CHART DATA ─────────────────────────────────────────────────────

export type PortfolioChartData = {
  kpiOptions: Array<{ key: string; label: string; unit: string | null }>;
  kpiThresholds: Record<string, Array<{ ruleType: string; value: number; severity: string }>>;
  companies: Array<{
    id: string;
    name: string;
    hasAlert: boolean;
    latestValues: Record<string, number | null>;
    latestPeriodLabel: string | null;
  }>;
  trendPeriods: Array<{
    period: string;
    label: string;
    byKpi: Record<string, Record<string, number | null>>; // kpiKey → companyId → value
  }>;
};

export function getPortfolioChartData(firmId: string, companyIds: string[]): PortfolioChartData {
  const empty: PortfolioChartData = { kpiOptions: [], kpiThresholds: {}, companies: [], trendPeriods: [] };
  if (!companyIds.length) return empty;

  const allCompanies = db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.firmId, firmId), inArray(schema.companies.id, companyIds)))
    .orderBy(schema.companies.name)
    .all();

  // Active alert company IDs
  const alertRows = db
    .select({ companyId: schema.alerts.companyId })
    .from(schema.alerts)
    .where(and(
      eq(schema.alerts.firmId, firmId),
      eq(schema.alerts.status, "active"),
      inArray(schema.alerts.companyId, companyIds)
    ))
    .all();
  const alertCompanyIds = new Set(alertRows.map((a) => a.companyId));

  // Last 13 periods (oldest→newest)
  const allPeriods = getAllPeriods(firmId).slice(0, 13).reverse();
  if (!allPeriods.length) {
    return {
      ...empty,
      companies: allCompanies.map((c) => ({ id: c.id, name: c.name, hasAlert: alertCompanyIds.has(c.id), latestValues: {}, latestPeriodLabel: null })),
      kpiThresholds: {},
    };
  }

  const periodIds = allPeriods.map((p) => p.id);

  // All firm-wide numeric KPI defs, ordered by displayOrder
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(
      eq(schema.kpiDefinitions.firmId, firmId),
      isNull(schema.kpiDefinitions.companyId),
      eq(schema.kpiDefinitions.active, true),
      ne(schema.kpiDefinitions.valueType, "text")
    ))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all();

  const kpiOptions = kpiDefs.map((k) => ({ key: k.key, label: k.label, unit: k.unit ?? null }));
  const kpiDefIdToKey = new Map(kpiDefs.map((k) => [k.id, k.key]));

  // Firm-wide threshold rules for these KPI defs (companyId IS NULL = firm-wide)
  const thresholdRows = kpiDefs.length
    ? db
        .select()
        .from(schema.thresholdRules)
        .where(and(
          eq(schema.thresholdRules.firmId, firmId),
          isNull(schema.thresholdRules.companyId),
          eq(schema.thresholdRules.active, true),
          inArray(schema.thresholdRules.kpiDefinitionId, kpiDefs.map((k) => k.id))
        ))
        .all()
    : [];

  const kpiThresholds: Record<string, Array<{ ruleType: string; value: number; severity: string }>> = {};
  for (const row of thresholdRows) {
    const key = kpiDefIdToKey.get(row.kpiDefinitionId);
    if (!key) continue;
    if (!kpiThresholds[key]) kpiThresholds[key] = [];
    kpiThresholds[key].push({ ruleType: row.ruleType, value: row.thresholdValue, severity: row.severity });
  }

  // All submitted submissions for these companies/periods in one query
  const submissions = db
    .select()
    .from(schema.submissions)
    .where(and(
      eq(schema.submissions.firmId, firmId),
      inArray(schema.submissions.companyId, companyIds),
      inArray(schema.submissions.periodId, periodIds),
      eq(schema.submissions.status, "submitted")
    ))
    .all();

  // All KPI values for those submissions in one query
  const kpiValues =
    submissions.length && kpiDefs.length
      ? db
          .select()
          .from(schema.kpiValues)
          .where(and(
            inArray(schema.kpiValues.submissionId, submissions.map((s) => s.id)),
            inArray(schema.kpiValues.kpiDefinitionId, kpiDefs.map((k) => k.id))
          ))
          .all()
      : [];

  // submissionId → kpiKey → value
  const subKpiMap = new Map<string, Record<string, number | null>>();
  for (const kv of kpiValues) {
    const key = kpiDefIdToKey.get(kv.kpiDefinitionId);
    if (!key) continue;
    if (!subKpiMap.has(kv.submissionId)) subKpiMap.set(kv.submissionId, {});
    subKpiMap.get(kv.submissionId)![key] = kv.actualNumber ?? null;
  }

  // companyId:periodId → submission
  const subLookup = new Map<string, (typeof submissions)[0]>();
  for (const s of submissions) {
    subLookup.set(`${s.companyId}:${s.periodId}`, s);
  }

  // Snapshot: per-company latest period with a submission
  const periodsDesc = [...allPeriods].reverse();
  const companies = allCompanies.map((c) => {
    const latestP = periodsDesc.find((p) => subLookup.has(`${c.id}:${p.id}`)) ?? null;
    const sub = latestP ? subLookup.get(`${c.id}:${latestP.id}`) : undefined;
    const kpis = sub ? (subKpiMap.get(sub.id) ?? {}) : {};
    const latestValues: Record<string, number | null> = {};
    for (const kpiDef of kpiDefs) {
      latestValues[kpiDef.key] = kpis[kpiDef.key] ?? null;
    }
    const latestPeriodLabel = latestP
      ? new Date(latestP.periodStart + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : null;
    return { id: c.id, name: c.name, hasAlert: alertCompanyIds.has(c.id), latestValues, latestPeriodLabel };
  });

  // Trend: last 12 months, per KPI per company
  const trendPeriods = allPeriods.slice(-12).map((p) => {
    const byKpi: Record<string, Record<string, number | null>> = {};
    for (const kpiDef of kpiDefs) {
      byKpi[kpiDef.key] = {};
      for (const c of allCompanies) {
        const sub = subLookup.get(`${c.id}:${p.id}`);
        const kpis = sub ? (subKpiMap.get(sub.id) ?? {}) : {};
        byKpi[kpiDef.key][c.id] = kpis[kpiDef.key] ?? null;
      }
    }
    const d = new Date(p.periodStart + "T12:00:00");
    return {
      period: p.periodStart.slice(0, 7),
      label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      byKpi,
    };
  });

  return { kpiOptions, kpiThresholds, companies, trendPeriods };
}

// ─── SUBMISSION TRACKING ─────────────────────────────────────────────────────

export type SubmissionDocInfo = { id: string; fileName: string; viaCombined: boolean } | null;

export type SubmissionTrackingRow = {
  companyId: string;
  companyName: string;
  submissionToken: string;
  industry: string | null;
  requiredDocs: string;
  requiredDocCadences: string;
  status: "submitted" | "partial" | "draft" | "missing";
  kpisSubmitted: boolean;
  submissionId: string | null;
  version: number | null;
  balanceSheet: boolean;
  balanceSheetDoc: SubmissionDocInfo;
  incomeStatement: boolean;
  incomeStatementDoc: SubmissionDocInfo;
  cashFlow: boolean;
  cashFlowDoc: SubmissionDocInfo;
  investorUpdate: boolean;
  investorUpdateDoc: SubmissionDocInfo;
  sourceFiles: Array<{ id: string; fileName: string; version: number; uploadedAt: string }>;
  submittedBy: string | null;
  submittedAt: string | null;
  isOverdue: boolean;
};

export function getSubmissionTracking(firmId: string, periodId: string, filters: CompanyFilters = {}) {
  const period = db
    .select()
    .from(schema.periods)
    .where(eq(schema.periods.id, periodId))
    .get();

  const allCompanies = applyCompanyFilters(getCompanies(firmId), filters);
  const now = new Date().toISOString().split("T")[0];
  const isOverdueable = period?.dueDate != null && now > period.dueDate;

  // Filter out companies whose investmentDate is after this period's month
  const companies = allCompanies.filter((c: any) => {
    const effectiveDate = c.investmentDate || c.createdAt?.slice(0, 10);
    if (!effectiveDate) return true; // no date at all = show in all periods (legacy)
    if (!period) return true;
    // Compare by YYYY-MM so a company invested mid-month still shows in that month's period
    return effectiveDate.slice(0, 7) <= period.periodStart.slice(0, 7);
  });

  const rows: SubmissionTrackingRow[] = [];

  for (const company of companies) {
    const sub = db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.firmId, firmId),
          eq(schema.submissions.companyId, company.id),
          eq(schema.submissions.periodId, periodId)
        )
      )
      .orderBy(desc(schema.submissions.version))
      .get();

    let submittedBy: string | null = null;
    if (sub?.submittedByUserId) {
      const u = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, sub.submittedByUserId))
        .get();
      submittedBy = u?.name ?? u?.email ?? null;
    }

    const docs = sub
      ? db
          .select()
          .from(schema.financialDocuments)
          .where(eq(schema.financialDocuments.submissionId, sub.id))
          .all()
      : [];

    const hasDoc = (type: string) =>
      docs.some(
        (d) =>
          d.documentType === type ||
          (d.documentType === "combined_financials" &&
            d.includedStatements?.split(",").includes(type))
      );

    const getDoc = (type: string): SubmissionDocInfo => {
      const direct = docs.find((d) => d.documentType === type);
      if (direct) return { id: direct.id, fileName: direct.fileName, viaCombined: false };
      const combined = docs.find(
        (d) =>
          d.documentType === "combined_financials" &&
          d.includedStatements?.split(",").includes(type)
      );
      if (combined) return { id: combined.id, fileName: combined.fileName, viaCombined: true };
      return null;
    };

    // Determine if a submitted submission is missing required docs (cadence-aware)
    const requiredDocTypes = ((company as any).requiredDocs ?? "").split(",").filter(Boolean) as string[];
    const docCadenceMap = parseDocCadences((company as any).requiredDocCadences ?? "");
    const periodMonth = period ? parseInt(period.periodStart.slice(5, 7), 10) : 1;
    // Only count a doc as required if it's both in requiredDocs AND due this period
    const dueRequiredDocTypes = requiredDocTypes.filter((type) =>
      isDocDueThisPeriod(docCadenceMap[type] ?? "monthly", periodMonth)
    );
    const missingRequiredDocs = sub?.status === "submitted"
      ? dueRequiredDocTypes.filter((type) => !hasDoc(type))
      : [];

    const baseStatus =
      !sub
        ? "missing"
        : sub.status === "submitted" && missingRequiredDocs.length > 0
        ? "partial"
        : sub.status === "submitted"
        ? "submitted"
        : "draft";

    rows.push({
      companyId: company.id,
      companyName: company.name,
      submissionToken: company.submissionToken,
      industry: company.industry ?? null,
      requiredDocs: (company as any).requiredDocs ?? "",
      requiredDocCadences: (company as any).requiredDocCadences ?? "",
      status: baseStatus,
      kpisSubmitted: sub?.status === "submitted",
      submissionId: sub?.id ?? null,
      version: sub?.version ?? null,
      balanceSheet: hasDoc("balance_sheet"),
      balanceSheetDoc: getDoc("balance_sheet"),
      incomeStatement: hasDoc("income_statement"),
      incomeStatementDoc: getDoc("income_statement"),
      cashFlow: hasDoc("cash_flow_statement"),
      cashFlowDoc: getDoc("cash_flow_statement"),
      investorUpdate: hasDoc("investor_update"),
      investorUpdateDoc: getDoc("investor_update"),
      sourceFiles: docs.map((d) => ({ id: d.id, fileName: d.fileName, version: d.version, uploadedAt: d.uploadedAt })),
      submittedBy,
      submittedAt: sub?.submittedAt ?? null,
      isOverdue: isOverdueable && baseStatus !== "submitted",
    });
  }

  return { rows, period };
}

// ─── PLAN TRACKING ────────────────────────────────────────────────────────────

export type PlanTrackingRow = {
  companyId: string;
  companyName: string;
  submissionToken: string;
  industry: string | null;
  latestVersion: number | null;
  latestSubmittedAt: string | null;
  submittedBy: string | null;
  hasRevisionDraft: boolean;
  planStatus: "complete" | "partial" | "no_submission";
  sourceFiles: Array<{ id: string; fileName: string; version: number; uploadedAt: string }>;
};

export function getPlanTracking(
  firmId: string,
  fiscalYear: number,
  filters: CompanyFilters = {}
): PlanTrackingRow[] {
  const companies = applyCompanyFilters(getCompanies(firmId), filters);

  const rows: PlanTrackingRow[] = [];

  for (const company of companies) {
    const plans = db
      .select()
      .from(schema.kpiPlans)
      .where(
        and(
          eq(schema.kpiPlans.companyId, company.id),
          eq(schema.kpiPlans.fiscalYear, fiscalYear)
        )
      )
      .orderBy(desc(schema.kpiPlans.version))
      .all();

    const latestSubmitted = plans.find((p) => p.submittedAt !== null) ?? null;
    const latestDraft = plans.find((p) => p.submittedAt === null) ?? null;
    const hasRevisionDraft =
      latestDraft !== null &&
      (latestSubmitted === null || latestDraft.version > latestSubmitted.version);

    let submittedBy: string | null = null;
    if (latestSubmitted?.submittedByUserId) {
      const u = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, latestSubmitted.submittedByUserId))
        .get();
      submittedBy = u?.name ?? u?.email ?? null;
    }

    let planStatus: PlanTrackingRow["planStatus"] = "no_submission";
    if (latestSubmitted) {
      // Get KPI definition IDs that this company has actually reported data for
      const reportedKpiIds = db
        .select({ kpiDefinitionId: schema.kpiValues.kpiDefinitionId })
        .from(schema.kpiValues)
        .innerJoin(schema.submissions, eq(schema.kpiValues.submissionId, schema.submissions.id))
        .where(eq(schema.submissions.companyId, company.id))
        .all();

      const reportedIds = new Set(reportedKpiIds.map(r => r.kpiDefinitionId));

      // Filter active defs to only those the company actually reports
      const activeDefs = db
        .select({ id: schema.kpiDefinitions.id })
        .from(schema.kpiDefinitions)
        .where(
          and(
            eq(schema.kpiDefinitions.firmId, firmId),
            eq(schema.kpiDefinitions.active, true),
            isNull(schema.kpiDefinitions.companyId)
          )
        )
        .all()
        .filter(d => reportedIds.has(d.id));

      const annualTargets = db
        .select({ kpiDefinitionId: schema.kpiPlanValues.kpiDefinitionId })
        .from(schema.kpiPlanValues)
        .where(
          and(
            eq(schema.kpiPlanValues.planId, latestSubmitted.id),
            isNull(schema.kpiPlanValues.periodMonth)
          )
        )
        .all();

      const coveredIds = new Set(annualTargets.map((t) => t.kpiDefinitionId));
      const allCovered = activeDefs.every((d) => coveredIds.has(d.id));
      planStatus = allCovered ? "complete" : "partial";
    }

    rows.push({
      companyId: company.id,
      companyName: company.name,
      submissionToken: company.submissionToken,
      industry: company.industry ?? null,
      latestVersion: latestSubmitted?.version ?? null,
      latestSubmittedAt: latestSubmitted?.submittedAt ?? null,
      submittedBy,
      hasRevisionDraft,
      planStatus,
      sourceFiles: [],
    });
  }

  return rows;
}

// ─── COMPANY ANALYTICS ────────────────────────────────────────────────────────

export type CompanyAnalyticsData = {
  company: schema.Company;
  activeAlerts: Array<{
    id: string;
    kpiLabel: string;
    severity: string;
    message: string;
    periodStart: string;
  }>;
  keyMetrics: {
    totalSubmissions: number;
    avgMonthlyRevenueTtm: number | null;
    avgMonthlyEbitdaTtm: number | null;
    currentCash: number | null;
  };
  trendData: Array<{
    period: string;
    revenue: number | null;
    ebitda: number | null;
    ocf: number | null;
    headcount: number | null;
    grossMargin: number | null;
    cash: number | null;
    churnRate: number | null;
  }>;
  rawData: Array<{
    period: string;
    kpiKey: string;
    kpiLabel: string;
    unit: string | null;
    actual: number | string | null;
    target: number | string | null;
    variance: number | null;
    // Plan & variance vs plan
    kpiDefinitionId: string;
    kpiValueId: string | null;
    submissionId: string | null;
    plan: number | null;
    planTooltip: string | null;
    planGranularity: string | null;
    planAnnualTarget: number | null; // raw annual plan value (before ÷12), for use in quarterly/FY aggregations
    planFyTotal: number | null;      // sum of all 12 monthly plan values for the fiscal year (monthly-granularity KPIs only)
    planVariance: number | null;
    planVariancePct: number | null;
    // YTD (year-to-date, numeric KPIs only)
    ytdActual: number | null;
    ytdPlan: number | null;
    ytdVariance: number | null;
    ytdVariancePct: number | null;
    // YoY (prior year same period)
    priorYearActual: number | null;
    yoyVariance: number | null;
    yoyVariancePct: number | null;
    // Notes
    note: string | null;
    investorNote: string | null;
    // RAG status
    ragAutoStatus: "green" | "amber" | "red" | null;
    ragOverride: "green" | "amber" | "red" | null;
    ragOverrideReason: string | null;
    ragEffective: "green" | "amber" | "red" | null;
    ragGreenPct: number;
    ragAmberPct: number;
    ragDirection: "higher_is_better" | "lower_is_better" | "any_variance";
  }>;
  /** Threshold rules applicable to this company, keyed by KPI key */
  thresholds: Record<string, Array<{ ruleType: string; value: number; severity: string }>>;
  /** All submission versions per period (YYYY-MM), sorted descending by version */
  submissionVersionsByPeriod: Record<string, Array<{
    version: number;
    submissionId: string;
    submittedAt: string | null;
    submittedBy: string | null;
    note: string | null;
    investorNote: string | null;
    documents: Array<{
      id: string;
      fileName: string;
      uploadedAt: string;
      uploadedBy: string | null;
    }>;
  }>>;
};

export function getCompanyAnalytics(
  firmId: string,
  companyId: string,
  filterPeriodId?: string
): CompanyAnalyticsData | null {
  const company = getCompany(firmId, companyId);
  if (!company) return null;

  // Get KPI definitions applicable to this company
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(
      and(
        eq(schema.kpiDefinitions.firmId, firmId),
        eq(schema.kpiDefinitions.active, true)
      )
    )
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter(
      (d) => d.companyId === null || d.companyId === companyId
    );

  const kpiById = Object.fromEntries(kpiDefs.map((d) => [d.id, d]));

  // Threshold rules: firm-wide (companyId IS NULL) + company-specific overrides
  const thresholdRows = kpiDefs.length
    ? db
        .select()
        .from(schema.thresholdRules)
        .where(
          and(
            eq(schema.thresholdRules.firmId, firmId),
            eq(schema.thresholdRules.active, true),
            inArray(
              schema.thresholdRules.kpiDefinitionId,
              kpiDefs.map((k) => k.id)
            )
          )
        )
        .all()
        .filter((r) => r.companyId === null || r.companyId === companyId)
    : [];

  const thresholds: Record<string, Array<{ ruleType: string; value: number; severity: string }>> = {};
  for (const row of thresholdRows) {
    const def = kpiById[row.kpiDefinitionId];
    if (!def) continue;
    if (!thresholds[def.key]) thresholds[def.key] = [];
    thresholds[def.key].push({
      ruleType: row.ruleType,
      value: row.thresholdValue,
      severity: row.severity,
    });
  }

  // Get submitted submissions for this company
  const submissionsQuery = db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.firmId, firmId),
        eq(schema.submissions.companyId, companyId),
        eq(schema.submissions.status, "submitted"),
        ...(filterPeriodId ? [eq(schema.submissions.periodId, filterPeriodId)] : [])
      )
    )
    .orderBy(desc(schema.submissions.createdAt))
    .all();

  // Key metrics — count unique periods with submissions
  const totalSubmissions = new Set(submissionsQuery.map((s) => s.periodId)).size;

  // Get all KPI values for all submission versions (needed for version history)
  const subIds = submissionsQuery.map((s) => s.id);
  const allKpiValues = subIds.length
    ? db
        .select()
        .from(schema.kpiValues)
        .where(inArray(schema.kpiValues.submissionId, subIds))
        .all()
    : [];

  // Group values by submission, then by kpi key
  const valuesBySubmission = new Map<string, Map<string, number | null>>();
  for (const v of allKpiValues) {
    const def = kpiById[v.kpiDefinitionId];
    if (!def) continue;
    if (!valuesBySubmission.has(v.submissionId)) {
      valuesBySubmission.set(v.submissionId, new Map());
    }
    valuesBySubmission.get(v.submissionId)!.set(def.key, v.actualNumber ?? null);
  }

  // Get period start for each submission (batch lookup)
  const periodStartById = new Map<string, string>();
  const uniquePeriodIds = [...new Set(submissionsQuery.map(s => s.periodId))];
  const periodsForSubs = uniquePeriodIds.length > 0
    ? db.select().from(schema.periods).where(inArray(schema.periods.id, uniquePeriodIds)).all()
    : [];
  const periodByIdMap = new Map(periodsForSubs.map(p => [p.id, p]));
  for (const sub of submissionsQuery) {
    const period = periodByIdMap.get(sub.periodId);
    if (period) periodStartById.set(sub.id, period.periodStart);
  }

  // Batch-fetch documents and user names for version history
  const allDocsBySubmission = new Map<string, Array<{ id: string; fileName: string; uploadedAt: string; uploadedByUserId: string | null }>>();
  if (subIds.length) {
    const docs = db
      .select()
      .from(schema.financialDocuments)
      .where(inArray(schema.financialDocuments.submissionId, subIds))
      .all();
    for (const doc of docs) {
      if (!allDocsBySubmission.has(doc.submissionId)) allDocsBySubmission.set(doc.submissionId, []);
      allDocsBySubmission.get(doc.submissionId)!.push({
        id: doc.id,
        fileName: doc.fileName,
        uploadedAt: doc.uploadedAt,
        uploadedByUserId: doc.uploadedByUserId ?? null,
      });
    }
  }

  const submitterIds = [...new Set(
    submissionsQuery.map((s) => s.submittedByUserId).filter((id): id is string => !!id)
  )];
  const docUploaderIds = [...new Set(
    [...allDocsBySubmission.values()].flat().map((d) => d.uploadedByUserId).filter((id): id is string => !!id)
  )];
  const allUserIds = [...new Set([...submitterIds, ...docUploaderIds])];
  const userNameMap = new Map<string, string>();
  if (allUserIds.length) {
    const users = db.select().from(schema.users).where(inArray(schema.users.id, allUserIds)).all();
    for (const u of users) userNameMap.set(u.id, u.name ?? u.email ?? u.id);
  }

  // Build version history per period (YYYY-MM)
  const submissionVersionsByPeriod: CompanyAnalyticsData["submissionVersionsByPeriod"] = {};
  for (const sub of submissionsQuery) {
    const periodStart = periodStartById.get(sub.id);
    if (!periodStart) continue;
    const periodKey = periodStart.slice(0, 7);
    if (!submissionVersionsByPeriod[periodKey]) submissionVersionsByPeriod[periodKey] = [];
    const rawDocs = allDocsBySubmission.get(sub.id) ?? [];
    submissionVersionsByPeriod[periodKey].push({
      version: sub.version,
      submissionId: sub.id,
      submittedAt: sub.submittedAt ?? null,
      submittedBy: sub.submittedByUserId ? (userNameMap.get(sub.submittedByUserId) ?? null) : null,
      note: sub.note ?? null,
      investorNote: (sub as any).investorNote ?? null,
      documents: rawDocs.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        uploadedAt: d.uploadedAt,
        uploadedBy: d.uploadedByUserId ? (userNameMap.get(d.uploadedByUserId) ?? null) : null,
      })),
    });
  }
  for (const key of Object.keys(submissionVersionsByPeriod)) {
    submissionVersionsByPeriod[key].sort((a, b) => b.version - a.version);
  }

  // Deduplicate submissions by period — keep only the latest version per period
  // for trend and raw data so charts show current actuals, not restatements
  const latestSubByPeriod = new Map<string, typeof submissionsQuery[0]>();
  for (const sub of submissionsQuery) {
    const existing = latestSubByPeriod.get(sub.periodId);
    if (!existing || sub.version > existing.version) {
      latestSubByPeriod.set(sub.periodId, sub);
    }
  }
  const dedupedSubmissions = [...latestSubByPeriod.values()];

  // Trend data — use deduplicated (latest version per period)
  const trendData = dedupedSubmissions
    .map((sub) => {
      const vals = valuesBySubmission.get(sub.id) ?? new Map();
      return {
        period: periodStartById.get(sub.id) ?? "",
        revenue: vals.get("revenue") ?? null,
        ebitda: vals.get("ebitda") ?? null,
        ocf: vals.get("operating_cash_flow") ?? null,
        headcount: vals.get("headcount") ?? null,
        grossMargin: vals.get("gross_margin") ?? null,
        cash: vals.get("cash_balance") ?? null,
        churnRate: vals.get("churn_rate") ?? null,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  // Key metrics — TTM = trailing 12 months (last 12 data points)
  const mostRecent = trendData[trendData.length - 1];
  const ttmData = trendData.slice(-12);

  function ttmAvg(vals: (number | null)[]): number | null {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  const avgMonthlyRevenueTtm = ttmAvg(ttmData.map((t) => t.revenue));
  const avgMonthlyEbitdaTtm = ttmAvg(ttmData.map((t) => t.ebitda));

  // Active alerts
  const alertRows = db
    .select()
    .from(schema.alerts)
    .where(
      and(
        eq(schema.alerts.firmId, firmId),
        eq(schema.alerts.companyId, companyId),
        eq(schema.alerts.status, "active")
      )
    )
    .orderBy(desc(schema.alerts.createdAt))
    .limit(20)
    .all();

  // Batch-fetch periods for alerts
  const alertPeriodIds = [...new Set(alertRows.map(a => a.periodId))];
  const alertPeriods = alertPeriodIds.length > 0
    ? db.select().from(schema.periods).where(inArray(schema.periods.id, alertPeriodIds)).all()
    : [];
  const alertPeriodMap = new Map(alertPeriods.map(p => [p.id, p]));

  const activeAlerts = alertRows.map((a) => {
    const def = kpiById[a.kpiDefinitionId];
    const period = alertPeriodMap.get(a.periodId);
    return {
      id: a.id,
      kpiLabel: def?.label ?? "KPI",
      severity: a.severity,
      message: a.message ?? "",
      periodStart: period?.periodStart ?? "",
    };
  });

  // ── Plan data ──────────────────────────────────────────────────────────────
  // Load latest submitted plan per fiscal year for this company
  const submittedPlans = db
    .select()
    .from(schema.kpiPlans)
    .where(eq(schema.kpiPlans.companyId, companyId))
    .all()
    .filter((p) => p.submittedAt !== null);

  const latestPlanByYear = new Map<number, schema.KpiPlan>();
  for (const plan of submittedPlans.sort((a, b) => a.version - b.version)) {
    latestPlanByYear.set(plan.fiscalYear, plan);
  }

  const activePlanIds = [...latestPlanByYear.values()].map((p) => p.id);
  const allPlanValuesArr = activePlanIds.length
    ? db
        .select()
        .from(schema.kpiPlanValues)
        .where(inArray(schema.kpiPlanValues.planId, activePlanIds))
        .all()
    : [];

  // Index: planId → kpiDefId → periodMonth (null = annual) → value
  const planValueIdx = new Map<string, Map<string, Map<number | null, number | null>>>();
  for (const pv of allPlanValuesArr) {
    if (!planValueIdx.has(pv.planId)) planValueIdx.set(pv.planId, new Map());
    if (!planValueIdx.get(pv.planId)!.has(pv.kpiDefinitionId))
      planValueIdx.get(pv.planId)!.set(pv.kpiDefinitionId, new Map());
    planValueIdx.get(pv.planId)!.get(pv.kpiDefinitionId)!.set(
      pv.periodMonth ?? null,
      pv.value ?? null
    );
  }

  function getPlanValue(
    kpiDefId: string,
    def: schema.KpiDefinition,
    fiscalYear: number,
    month: number
  ): { value: number | null; planTooltip: string | null; annualTarget: number | null; planGranularity: string } {
    const plan = latestPlanByYear.get(fiscalYear);
    const noResult = (g: string) => ({ value: null, planTooltip: null, annualTarget: null, planGranularity: g });
    if (!plan) return noResult("annual_total");
    const byKpi = planValueIdx.get(plan.id)?.get(kpiDefId);
    if (!byKpi) return noResult((def as any).planGranularity ?? "annual_total");

    const defGranularity: string = (def as any).planGranularity ?? "annual_total";

    // Backward compat: if plan was stored as monthly (old plan-level "monthly"), use byKpi.get(month)
    if (plan.granularity === "monthly" && byKpi.has(month)) {
      return { value: byKpi.get(month) ?? null, planTooltip: null, annualTarget: byKpi.get(null) ?? null, planGranularity: "monthly" };
    }

    function fmtPlanVal(v: number): string {
      const unit: string = (def as any).unit ?? "";
      const vt: string = (def as any).valueType ?? "";
      if (vt === "currency" || unit === "$") return `$${Math.round(v).toLocaleString("en-US")}`;
      if (unit === "%" || vt === "percent") return `${v.toFixed(2)}%`;
      return v.toLocaleString("en-US");
    }

    switch (defGranularity) {
      case "monthly": {
        return { value: byKpi.get(month) ?? null, planTooltip: null, annualTarget: null, planGranularity: "monthly" };
      }
      case "quarterly_total": {
        const q = Math.ceil(month / 3);
        const qVal = byKpi.get(100 + q) ?? null;
        if (qVal === null) return noResult("quarterly_total");
        return {
          value: qVal / 3,
          planTooltip: `Q${q} total: ${fmtPlanVal(qVal)} (÷3 monthly run-rate)`,
          annualTarget: null,
          planGranularity: "quarterly_total",
        };
      }
      case "quarterly_end": {
        const q = Math.ceil(month / 3);
        const qEndMonth = q * 3;
        const qVal = byKpi.get(100 + q) ?? null;
        if (qVal === null) return noResult("quarterly_end");
        // Only show plan value for the last month of the quarter
        const value = month === qEndMonth ? qVal : null;
        return { value, planTooltip: null, annualTarget: null, planGranularity: "quarterly_end" };
      }
      case "annual_end": {
        const annual = byKpi.get(null) ?? null;
        return { value: annual, planTooltip: null, annualTarget: annual, planGranularity: "annual_end" };
      }
      case "annual_total":
      case "annual":
      default: {
        const annual = byKpi.get(null) ?? null;
        const isCurrency = (def as any).valueType === "currency" || (def as any).unit === "$";
        if (isCurrency && annual !== null) {
          return {
            value: annual / 12,
            planTooltip: `Annual target: ${fmtPlanVal(annual)} (÷12 monthly run-rate)`,
            annualTarget: annual,
            planGranularity: "annual_total",
          };
        }
        return { value: annual, planTooltip: null, annualTarget: annual, planGranularity: defGranularity };
      }
    }
  }

  function computeRagAuto(
    actual: number,
    plan: number,
    def: schema.KpiDefinition
  ): "green" | "amber" | "red" | null {
    return computeRagPct(
      actual,
      plan,
      (def as any).ragGreenPct ?? 5,
      (def as any).ragAmberPct ?? 15,
      ((def as any).ragDirection ?? "higher_is_better") as "higher_is_better" | "lower_is_better" | "any_variance"
    );
  }

  // ── Raw data table ── use deduplicated (latest version per period) ──────────
  const rawData: CompanyAnalyticsData["rawData"] = [];
  for (const sub of dedupedSubmissions) {
    const vals = allKpiValues.filter((v) => v.submissionId === sub.id);
    const period = periodStartById.get(sub.id) ?? "";
    const fiscalYear = parseInt(period.slice(0, 4), 10);
    const periodMonth = parseInt(period.slice(5, 7), 10);

    for (const val of vals) {
      const def = kpiById[val.kpiDefinitionId];
      if (!def) continue;
      const actual = val.actualNumber ?? val.actualText ?? null;
      const target = val.targetNumber ?? val.targetText ?? null;
      const variance =
        typeof actual === "number" && typeof target === "number"
          ? actual - target
          : null;

      const planResult =
        typeof actual === "number"
          ? getPlanValue(def.id, def, fiscalYear, periodMonth)
          : null;
      const planValue = planResult?.value ?? null;
      const planTooltip = planResult?.planTooltip ?? null;
      const planGranularity = planResult?.planGranularity ?? null;
      const planVariance =
        typeof actual === "number" && planValue !== null
          ? actual - planValue
          : null;
      const planVariancePct =
        planVariance !== null && planValue !== null && planValue !== 0
          ? (planVariance / Math.abs(planValue)) * 100
          : null;

      // Sum all 12 monthly plan values for the FY (used by Full Year attainment for monthly-granularity KPIs)
      let planFyTotal: number | null = null;
      if (planGranularity === "monthly") {
        const fyPlanRecord = latestPlanByYear.get(fiscalYear);
        const fyByKpi = fyPlanRecord ? planValueIdx.get(fyPlanRecord.id)?.get(def.id) : undefined;
        if (fyByKpi) {
          let sum = 0; let found = false;
          for (let m = 1; m <= 12; m++) {
            const v = fyByKpi.get(m) ?? null;
            if (v !== null) { sum += v; found = true; }
          }
          planFyTotal = found ? sum : null;
        }
      }

      const ragOverrideVal = (val.ragOverride as "green" | "amber" | "red" | null) ?? null;
      const ragAutoStatus =
        typeof actual === "number" && planValue !== null
          ? computeRagAuto(actual, planValue, def)
          : null;
      const ragEffective = ragOverrideVal ?? ragAutoStatus;

      rawData.push({
        period,
        kpiKey: def.key,
        kpiLabel: def.label,
        unit: def.unit,
        actual,
        target,
        variance,
        kpiDefinitionId: def.id,
        kpiValueId: val.id,
        submissionId: sub.id,
        plan: planValue,
        planTooltip,
        planGranularity,
        planAnnualTarget: planResult?.annualTarget ?? null,
        planFyTotal,
        planVariance,
        planVariancePct,
        ytdActual: null,    // filled in second pass
        ytdPlan: null,
        ytdVariance: null,
        ytdVariancePct: null,
        priorYearActual: null, // filled in second pass
        yoyVariance: null,
        yoyVariancePct: null,
        note: val.note ?? null,
        investorNote: val.investorNote ?? null,
        ragAutoStatus,
        ragOverride: ragOverrideVal,
        ragOverrideReason: val.ragOverrideReason ?? null,
        ragEffective,
        ragGreenPct: (def as any).ragGreenPct ?? 5,
        ragAmberPct: (def as any).ragAmberPct ?? 15,
        ragDirection: ((def as any).ragDirection ?? "higher_is_better") as "higher_is_better" | "lower_is_better" | "any_variance",
      });
    }
  }
  rawData.sort((a, b) => a.period.localeCompare(b.period));

  // ── Second pass: YTD and YoY ──────────────────────────────────────────────
  const rowByKpiPeriod = new Map<string, number>();
  rawData.forEach((r, i) => {
    rowByKpiPeriod.set(`${r.kpiKey}|${r.period.slice(0, 7)}`, i);
  });

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (typeof row.actual !== "number") continue;

    const year = parseInt(row.period.slice(0, 4), 10);
    const month = parseInt(row.period.slice(5, 7), 10);

    // YTD actual: sum Jan → currentMonth, same fiscal year + KPI
    let ytdActualSum = 0;
    let ytdActualFound = false;
    for (let m = 1; m <= month; m++) {
      const key = `${row.kpiKey}|${year}-${String(m).padStart(2, "0")}`;
      const idx = rowByKpiPeriod.get(key);
      if (idx !== undefined && typeof rawData[idx].actual === "number") {
        ytdActualSum += rawData[idx].actual as number;
        ytdActualFound = true;
      }
    }
    const ytdActual = ytdActualFound ? ytdActualSum : null;

    // YTD plan — use per-KPI granularity
    let ytdPlan: number | null = null;
    const plan = latestPlanByYear.get(year);
    if (plan) {
      const def2 = kpiById[row.kpiDefinitionId];
      const defG: string = plan.granularity === "monthly"
        ? "monthly"
        : ((def2 as any)?.planGranularity ?? "annual_total");

      const byKpi2 = planValueIdx.get(plan.id)?.get(row.kpiDefinitionId);
      if (byKpi2) {
        switch (defG) {
          case "monthly": {
            let sum = 0, found = false;
            for (let m = 1; m <= month; m++) {
              const pv = byKpi2.get(m) ?? null;
              if (pv !== null) { sum += pv; found = true; }
            }
            ytdPlan = found ? sum : null;
            break;
          }
          case "quarterly_total": {
            let sum = 0, found = false;
            for (let q = 1; q <= 4; q++) {
              const qStartMonth = (q - 1) * 3 + 1;
              const qEndMonth = q * 3;
              if (qStartMonth > month) break;
              const qVal = byKpi2.get(100 + q) ?? null;
              if (qVal !== null) {
                if (qEndMonth <= month) {
                  sum += qVal;
                } else {
                  // Partial quarter: prorate
                  const monthsIntoQ = month - (q - 1) * 3;
                  sum += qVal * (monthsIntoQ / 3);
                }
                found = true;
              }
            }
            ytdPlan = found ? sum : null;
            break;
          }
          case "quarterly_end": {
            const q = Math.ceil(month / 3);
            ytdPlan = byKpi2.get(100 + q) ?? null;
            break;
          }
          case "annual_end": {
            ytdPlan = byKpi2.get(null) ?? null;
            break;
          }
          case "annual_total":
          case "annual":
          default: {
            const annualPlan = byKpi2.get(null) ?? null;
            ytdPlan = annualPlan !== null ? annualPlan * (month / 12) : null;
            break;
          }
        }
      }
    }

    const ytdVariance =
      ytdActual !== null && ytdPlan !== null ? ytdActual - ytdPlan : null;
    const ytdVariancePct =
      ytdVariance !== null && ytdPlan !== null && ytdPlan !== 0
        ? (ytdVariance / Math.abs(ytdPlan)) * 100
        : null;

    // YoY: same KPI, same month, prior year
    const priorKey = `${row.kpiKey}|${year - 1}-${String(month).padStart(2, "0")}`;
    const priorIdx = rowByKpiPeriod.get(priorKey);
    const priorYearActual =
      priorIdx !== undefined && typeof rawData[priorIdx].actual === "number"
        ? (rawData[priorIdx].actual as number)
        : null;
    const yoyVariance =
      priorYearActual !== null ? (row.actual as number) - priorYearActual : null;
    const yoyVariancePct =
      yoyVariance !== null && priorYearActual !== null && priorYearActual !== 0
        ? (yoyVariance / Math.abs(priorYearActual)) * 100
        : null;

    rawData[i] = {
      ...row,
      ytdActual,
      ytdPlan,
      ytdVariance,
      ytdVariancePct,
      priorYearActual,
      yoyVariance,
      yoyVariancePct,
    };
  }

  return {
    company,
    activeAlerts,
    keyMetrics: {
      totalSubmissions,
      avgMonthlyRevenueTtm,
      avgMonthlyEbitdaTtm,
      currentCash: mostRecent?.cash ?? null,
    },
    trendData,
    rawData,
    thresholds,
    submissionVersionsByPeriod,
  };
}

// ─── SUBMISSION FORM ──────────────────────────────────────────────────────────

export type SubmissionFormData = {
  company: schema.Company;
  firm: schema.Firm;
  period: schema.Period;
  allPeriods: schema.Period[];
  submission: schema.Submission | null;
  kpiDefinitions: schema.KpiDefinition[];
  kpiValues: schema.KpiValue[];
  documents: schema.FinancialDocument[];
  dueDate: string | null; // effective per-company due date (may differ from period.dueDate)
  activePlan: schema.KpiPlan | null;
  activePlanValues: schema.KpiPlanValue[];
};

export function getSubmissionFormData(
  token: string,
  periodId?: string
): SubmissionFormData | null {
  const company = getCompanyByToken(token);
  if (!company) return null;

  const firm = getFirm(company.firmId);
  if (!firm) return null;

  // Auto-create any missing monthly periods up to and including last completed month
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find earliest existing period to know how far back to go
  const earliestPeriod = db
    .select()
    .from(schema.periods)
    .where(and(eq(schema.periods.firmId, company.firmId), eq(schema.periods.periodType, "monthly")))
    .orderBy(schema.periods.periodStart)
    .limit(1)
    .get();

  // Fetch firm's due-day setting (business days after period close)
  const firmSettings = db
    .select()
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.firmId, company.firmId))
    .get();
  const dueDays: number = (firmSettings as any)?.submissionDueDays ?? 15;

  function addBusinessDays(start: Date, days: number): Date {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d;
  }

  function toLocalDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  if (earliestPeriod) {
    // Walk from earliest month to last completed month and insert any gaps
    // Use UTC methods throughout to avoid timezone drift on Windows
    let cursorYear = parseInt(earliestPeriod.periodStart.slice(0, 4), 10);
    let cursorMonth = parseInt(earliestPeriod.periodStart.slice(5, 7), 10); // 1-based
    while (true) {
      const periodStart = `${cursorYear}-${String(cursorMonth).padStart(2, "0")}-01`;
      const monthEnd = endOfMonth(new Date(periodStart + "T12:00:00"));
      const periodEndPlusOne = addDays(monthEnd, 1);
      if (periodEndPlusOne > today) break;
      const exists = db
        .select()
        .from(schema.periods)
        .where(
          and(
            eq(schema.periods.firmId, company.firmId),
            eq(schema.periods.periodType, "monthly"),
            eq(schema.periods.periodStart, periodStart)
          )
        )
        .get();
      if (!exists) {
        const dueDate = toLocalDateStr(addBusinessDays(monthEnd, dueDays));
        db.insert(schema.periods).values({
          firmId: company.firmId,
          periodType: "monthly",
          periodStart,
          dueDate,
          status: "open",
        }).run();
      }
      cursorMonth++;
      if (cursorMonth > 12) { cursorMonth = 1; cursorYear++; }
    }
  }

  // All monthly periods that have ended (available from day after month close)
  const allPeriodsRaw = db
    .select()
    .from(schema.periods)
    .where(
      and(
        eq(schema.periods.firmId, company.firmId),
        eq(schema.periods.periodType, "monthly")
      )
    )
    .orderBy(desc(schema.periods.periodStart))
    .all()
    .filter((p) => addDays(endOfMonth(new Date(p.periodStart + "T12:00:00")), 1) <= today);

  // Deduplicate by year-month (keep first encountered per month)
  const seenMonths = new Set<string>();
  const allPeriods = allPeriodsRaw.filter((p) => {
    const ym = p.periodStart.slice(0, 7);
    if (seenMonths.has(ym)) return false;
    seenMonths.add(ym);
    return true;
  });

  // Use requested period or current calendar month period
  const thisMonth = new Date().toISOString().slice(0, 7);
  const latestOpen = allPeriods.find((p) => p.periodStart.slice(0, 7) === thisMonth) ?? allPeriods[0];
  const period = periodId
    ? allPeriods.find((p) => p.id === periodId) ?? latestOpen
    : latestOpen;

  if (!period) return null;

  // Get or create submission
  let submission = db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.companyId, company.id),
        eq(schema.submissions.periodId, period.id)
      )
    )
    .get() ?? null;

  // Get KPI definitions for this company
  const allKpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(
      and(
        eq(schema.kpiDefinitions.firmId, company.firmId),
        eq(schema.kpiDefinitions.active, true)
      )
    )
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id);

  // Load company cadence overrides for firm-wide KPIs
  const cadenceOverrides = db
    .select()
    .from(schema.kpiCadenceOverrides)
    .where(eq(schema.kpiCadenceOverrides.companyId, company.id))
    .all();
  const cadenceOverrideMap = Object.fromEntries(cadenceOverrides.map((o) => [o.kpiDefinitionId, o.collectionCadence]));

  // Determine period month for cadence filtering
  const submissionMonth = parseInt(period.periodStart.slice(5, 7), 10); // 1–12

  function isKpiDueThisPeriod(kpiDef: (typeof allKpiDefs)[number]): boolean {
    // Custom (company-specific) KPIs always shown
    if (kpiDef.companyId !== null) return true;
    // Determine effective cadence: company override > firm default
    const cadence = cadenceOverrideMap[kpiDef.id] ?? ((kpiDef as any).collectionCadence ?? "monthly");
    if (cadence === "weekly" || cadence === "monthly") return true;
    if (cadence === "quarterly") return submissionMonth % 3 === 0; // Mar, Jun, Sep, Dec
    if (cadence === "bi-annual") return submissionMonth === 6 || submissionMonth === 12;
    if (cadence === "annual") return submissionMonth === 12;
    return true;
  }

  const kpiDefs = allKpiDefs.filter(isKpiDueThisPeriod);

  const kpiValues = submission
    ? db
        .select()
        .from(schema.kpiValues)
        .where(eq(schema.kpiValues.submissionId, submission.id))
        .all()
    : [];

  const documents = submission
    ? db
        .select()
        .from(schema.financialDocuments)
        .where(eq(schema.financialDocuments.submissionId, submission.id))
        .all()
    : [];

  // Compute effective due date — use company override if set, otherwise firm default
  const effectiveDueDays: number = (company as any).submissionDueDays ?? dueDays;
  const periodMonthEnd = endOfMonth(new Date(period.periodStart + "T12:00:00"));
  const dueDate = toLocalDateStr(addBusinessDays(periodMonthEnd, effectiveDueDays));

  // Active plan for this company + fiscal year (latest submitted version)
  const fiscalYear = parseInt(period.periodStart.slice(0, 4), 10);
  const periodMonth = parseInt(period.periodStart.slice(5, 7), 10);

  const activePlan = db
    .select()
    .from(schema.kpiPlans)
    .where(
      and(
        eq(schema.kpiPlans.companyId, company.id),
        eq(schema.kpiPlans.fiscalYear, fiscalYear),
        ne(schema.kpiPlans.submittedAt, "")
      )
    )
    .orderBy(desc(schema.kpiPlans.version))
    .all()
    .find((p) => p.submittedAt !== null) ?? null;

  const activePlanValues = activePlan
    ? db
        .select()
        .from(schema.kpiPlanValues)
        .where(eq(schema.kpiPlanValues.planId, activePlan.id))
        .all()
        .filter((v) =>
          // For annual plans: only annual values (periodMonth = null)
          // For monthly plans: match this specific month
          activePlan.granularity === "annual"
            ? v.periodMonth === null
            : v.periodMonth === periodMonth
        )
    : [];

  return { company, firm, period, allPeriods, submission, kpiDefinitions: kpiDefs, kpiValues, documents, dueDate, activePlan, activePlanValues };
}

// ─── OPERATOR DASHBOARD ───────────────────────────────────────────────────────

export function getOperatorDashboard(firmId: string, companyId: string) {
  return getCompanyAnalytics(firmId, companyId);
}

// ─── PLAN FORM ────────────────────────────────────────────────────────────────

export type PlanFormData = {
  company: schema.Company;
  firm: schema.Firm;
  kpiDefinitions: schema.KpiDefinition[];
  plan: schema.KpiPlan | null;
  planValues: schema.KpiPlanValue[];
  fiscalYear: number;
  availableYears: number[];
  allPlanVersions: schema.KpiPlan[];
};

export function getPlanFormData(
  token: string,
  fiscalYear?: number
): PlanFormData | null {
  const company = getCompanyByToken(token);
  if (!company) return null;

  const firm = getFirm(company.firmId);
  if (!firm) return null;

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1–12
  // Default to next year in December (operators plan for the coming year)
  const defaultYear = currentMonth === 12 ? currentYear + 1 : currentYear;
  const year = fiscalYear ?? defaultYear;

  const availableYears = [currentYear - 1, currentYear, currentYear + 1];

  // All versions for this company + year (desc version = latest first)
  const allPlanVersions = db
    .select()
    .from(schema.kpiPlans)
    .where(
      and(
        eq(schema.kpiPlans.companyId, company.id),
        eq(schema.kpiPlans.fiscalYear, year)
      )
    )
    .orderBy(desc(schema.kpiPlans.version))
    .all();

  const latestPlan = allPlanVersions[0] ?? null;

  const planValues = latestPlan
    ? db
        .select()
        .from(schema.kpiPlanValues)
        .where(eq(schema.kpiPlanValues.planId, latestPlan.id))
        .all()
    : [];

  // Quantifiable KPI definitions only (currency, percent, integer)
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(
      and(
        eq(schema.kpiDefinitions.firmId, company.firmId),
        eq(schema.kpiDefinitions.active, true)
      )
    )
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id)
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

  return {
    company,
    firm,
    kpiDefinitions: kpiDefs,
    plan: latestPlan,
    planValues,
    fiscalYear: year,
    availableYears,
    allPlanVersions,
  };
}

// ─── ONBOARDING TRACKING ──────────────────────────────────────────────────────

export type OnboardingRow = {
  companyId: string;
  companyName: string;
  submissionToken: string;
  fund: string | null;
  industry: string | null;
  onboardingStatus: "pending" | "in_progress" | "complete";
  onboardingCompletedAt: string | null;
  fileCount: number;
  lastActivity: string | null;
  files: Array<{ id: string; fileName: string; uploadedAt: string }>;
};

/** Returns companies that are in onboarding (status = pending | in_progress | complete).
 *  The tab only renders when at least one pending/in_progress row exists — callers check this. */
export function getOnboardingTracking(firmId: string): OnboardingRow[] {
  const companies = db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.firmId, firmId))
    .all()
    .filter((c) => (c as any).onboardingStatus !== null);

  const rows: OnboardingRow[] = [];

  for (const company of companies) {
    const docs = db
      .select()
      .from(schema.onboardingDocuments)
      .where(eq(schema.onboardingDocuments.companyId, company.id))
      .orderBy(desc(schema.onboardingDocuments.uploadedAt))
      .all();

    const lastActivity = docs[0]?.uploadedAt ?? null;

    rows.push({
      companyId: company.id,
      companyName: company.name,
      submissionToken: company.submissionToken,
      fund: (company as any).fund ?? null,
      industry: company.industry ?? null,
      onboardingStatus: (company as any).onboardingStatus as "pending" | "in_progress" | "complete",
      onboardingCompletedAt: (company as any).onboardingCompletedAt ?? null,
      fileCount: docs.length,
      lastActivity,
      files: docs.map((d) => ({ id: d.id, fileName: d.fileName, uploadedAt: d.uploadedAt })),
    });
  }

  return rows;
}
