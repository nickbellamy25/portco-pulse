/**
 * Assembles the system prompt for the chat submission assistant.
 * Injected per-request with company-specific context.
 * Claude determines submission type (periodic vs plan) and period from the data.
 */

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, desc, asc, ne, inArray, isNull } from "drizzle-orm";

export interface SystemPromptContext {
  firmName: string;
  companyName: string;
  enabledKpis: Array<{ key: string; label: string; unit: string | null; valueType: string }>;
  priorPeriodJson: string;
  submissionNotes: string | null;
  requiredDocs: string[]; // doc keys required for this company e.g. ["balance_sheet","income_statement","cash_flow_statement"]
  historicalDataJson: string; // JSON blob: { actuals, plans, submissionStatus }
  portfolioDataJson?: string; // JSON blob with all companies' data — only present for firm-side investor users
}

// ─── Portfolio-wide KPI data for cross-portfolio Q&A (firm-side users only) ──

export function buildPortfolioDataSection(firmId: string): string {
  try {
    // Firm-level KPI definitions only — these are comparable across all companies
    const kpiDefs = db
      .select()
      .from(schema.kpiDefinitions)
      .where(and(
        eq(schema.kpiDefinitions.firmId, firmId),
        eq(schema.kpiDefinitions.active, true),
        isNull(schema.kpiDefinitions.companyId),
      ))
      .orderBy(schema.kpiDefinitions.displayOrder)
      .all()
      .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

    const allCompanies = db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.firmId, firmId))
      .all();

    // Last 12 periods for the firm (most recent first, then reverse for chronological order)
    const recentPeriods = db
      .select()
      .from(schema.periods)
      .where(eq(schema.periods.firmId, firmId))
      .orderBy(desc(schema.periods.periodStart))
      .limit(12)
      .all()
      .reverse();
    const periodMap = new Map<string, string>(recentPeriods.map((p) => [p.id, p.periodStart.slice(0, 7)]));
    const recentPeriodIds = recentPeriods.map((p) => p.id);

    const openPeriod = recentPeriods.findLast((p) => (p as any).status === "open");

    const companiesData = allCompanies.map((company) => {
      const submissions = recentPeriodIds.length > 0
        ? db
            .select()
            .from(schema.submissions)
            .where(and(
              eq(schema.submissions.companyId, company.id),
              eq(schema.submissions.status, "submitted"),
              inArray(schema.submissions.periodId, recentPeriodIds),
            ))
            .all()
        : [];

      const subIds = submissions.map((s) => s.id);
      const kpiValues = subIds.length > 0
        ? db.select().from(schema.kpiValues).where(inArray(schema.kpiValues.submissionId, subIds)).all()
        : [];

      const valsBySubmission = new Map<string, Map<string, number | null>>();
      for (const v of kpiValues) {
        if (!valsBySubmission.has(v.submissionId)) valsBySubmission.set(v.submissionId, new Map());
        valsBySubmission.get(v.submissionId)!.set(v.kpiDefinitionId, v.actualNumber ?? null);
      }

      const actuals = submissions
        .map((sub) => {
          const period = sub.periodId ? (periodMap.get(sub.periodId) ?? null) : null;
          if (!period) return null;
          const vals = valsBySubmission.get(sub.id);
          const kpis: Record<string, number | null> = {};
          for (const def of kpiDefs) kpis[def.key] = vals?.get(def.id) ?? null;
          return { period, kpis };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .sort((a, b) => a.period.localeCompare(b.period));

      // Latest submitted plan — annual totals only
      const latestPlan = db
        .select()
        .from(schema.kpiPlans)
        .where(and(
          eq(schema.kpiPlans.companyId, company.id),
          ne(schema.kpiPlans.submittedAt, ""),
        ))
        .orderBy(desc(schema.kpiPlans.fiscalYear), desc(schema.kpiPlans.version))
        .limit(1)
        .get();

      let plan: { fiscalYear: number; kpis: Record<string, number | null> } | null = null;
      if (latestPlan) {
        const planVals = db
          .select()
          .from(schema.kpiPlanValues)
          .where(and(
            eq(schema.kpiPlanValues.planId, latestPlan.id),
            isNull(schema.kpiPlanValues.periodMonth),
          ))
          .all();
        const kpis: Record<string, number | null> = {};
        for (const def of kpiDefs) {
          const pv = planVals.find((v) => v.kpiDefinitionId === def.id);
          kpis[def.key] = pv?.value ?? null;
        }
        plan = { fiscalYear: latestPlan.fiscalYear, kpis };
      }

      return {
        name: company.name,
        fund: (company as any).fund ?? null,
        industry: company.industry ?? null,
        status: (company as any).status ?? "current",
        actuals,
        plan,
      };
    });

    return JSON.stringify({
      companies: companiesData,
      kpiDefinitions: kpiDefs.map((d) => ({ key: d.key, label: d.label, unit: d.unit, valueType: d.valueType })),
      currentPeriod: openPeriod?.periodStart.slice(0, 7) ?? null,
    });
  } catch (err: any) {
    console.error("[buildPortfolioDataSection] error:", err);
    return "unavailable";
  }
}

// ─── Historical KPI data for Q&A ─────────────────────────────────────────────

function buildHistoricalDataSection(
  company: schema.Company,
  kpiDefs: Array<{ id: string; key: string; label: string; unit: string | null; valueType: string }>
): string {
  try {
    // --- Submitted actuals ---
    const submissions = db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.companyId, company.id), eq(schema.submissions.status, "submitted")))
      .orderBy(asc(schema.submissions.submittedAt))
      .all();

    const periodIds = [...new Set(submissions.map((s) => s.periodId).filter((id): id is string => !!id))];
    const periodsData = periodIds.length > 0
      ? db.select().from(schema.periods).where(inArray(schema.periods.id, periodIds)).all()
      : [];
    const periodMap = new Map<string, string>(periodsData.map((p) => [p.id, p.periodStart.slice(0, 7)]));

    const subIds = submissions.map((s) => s.id);
    const allKpiValues = subIds.length > 0
      ? db.select().from(schema.kpiValues).where(inArray(schema.kpiValues.submissionId, subIds)).all()
      : [];

    const valuesMap = new Map<string, Map<string, number | null>>();
    for (const v of allKpiValues) {
      if (!valuesMap.has(v.submissionId)) valuesMap.set(v.submissionId, new Map());
      valuesMap.get(v.submissionId)!.set(v.kpiDefinitionId, v.actualNumber ?? null);
    }

    const actuals = submissions.flatMap((sub) => {
      const period = sub.periodId ? (periodMap.get(sub.periodId) ?? null) : null;
      if (!period) return [];
      const subVals = valuesMap.get(sub.id);
      const kpis: Record<string, number | null> = {};
      for (const def of kpiDefs) kpis[def.key] = subVals?.get(def.id) ?? null;
      return [{ period, submittedAt: sub.submittedAt?.slice(0, 10) ?? null, kpis }];
    });
    actuals.sort((a, b) => a.period.localeCompare(b.period));

    // --- Plans: latest submitted version per fiscal year ---
    const allPlans = db
      .select()
      .from(schema.kpiPlans)
      .where(and(eq(schema.kpiPlans.companyId, company.id), ne(schema.kpiPlans.submittedAt, "")))
      .orderBy(asc(schema.kpiPlans.fiscalYear), desc(schema.kpiPlans.version))
      .all();

    const latestPlanByYear = new Map<number, (typeof allPlans)[0]>();
    for (const plan of allPlans) {
      if (!latestPlanByYear.has(plan.fiscalYear)) latestPlanByYear.set(plan.fiscalYear, plan);
    }
    const activePlans = [...latestPlanByYear.values()];

    const planIds = activePlans.map((p) => p.id);
    const allPlanValues = planIds.length > 0
      ? db.select().from(schema.kpiPlanValues).where(inArray(schema.kpiPlanValues.planId, planIds)).all()
      : [];

    const plans = activePlans.map((plan) => {
      const pv = allPlanValues.filter((v) => v.planId === plan.id);
      const kpis: Record<string, { annual: number | null; monthly?: Record<string, number | null> }> = {};
      for (const def of kpiDefs) {
        const annualVal = pv.find((v) => v.kpiDefinitionId === def.id && v.periodMonth === null);
        const monthlyVals = pv.filter((v) => v.kpiDefinitionId === def.id && v.periodMonth !== null);
        if (plan.granularity === "monthly" && monthlyVals.length > 0) {
          const monthly: Record<string, number | null> = {};
          for (const mv of monthlyVals) monthly[String(mv.periodMonth)] = mv.value ?? null;
          kpis[def.key] = { annual: annualVal?.value ?? null, monthly };
        } else if (annualVal) {
          kpis[def.key] = { annual: annualVal.value ?? null };
        }
      }
      return { fiscalYear: plan.fiscalYear, granularity: plan.granularity, kpis };
    });

    // --- Submission status ---
    const openPeriod = db
      .select()
      .from(schema.periods)
      .where(and(eq(schema.periods.firmId, company.firmId), eq(schema.periods.status, "open")))
      .orderBy(desc(schema.periods.periodStart))
      .limit(1)
      .get();

    const latestSub = submissions[submissions.length - 1];
    const latestPeriod = latestSub?.periodId ? (periodMap.get(latestSub.periodId) ?? null) : null;

    let openPeriodSubmitted: boolean | null = null;
    let openPeriodLabel: string | null = null;
    let openPeriodDueDate: string | null = null;
    if (openPeriod) {
      openPeriodLabel = openPeriod.periodStart.slice(0, 7);
      openPeriodDueDate = (openPeriod as any).dueDate ?? null;
      const openSub = db
        .select()
        .from(schema.submissions)
        .where(and(
          eq(schema.submissions.companyId, company.id),
          eq(schema.submissions.periodId, openPeriod.id),
          eq(schema.submissions.status, "submitted")
        ))
        .get();
      openPeriodSubmitted = !!openSub;
    }

    return JSON.stringify({
      actuals,
      plans,
      submissionStatus: {
        latestSubmittedPeriod: latestPeriod,
        openPeriod: openPeriodLabel,
        openPeriodDueDate,
        openPeriodSubmitted,
      },
    });
  } catch (err: any) {
    console.error("[buildHistoricalDataSection] error:", err);
    return "unavailable";
  }
}

export function buildSystemPromptContext(
  company: schema.Company & { firmName?: string },
  firmName: string,
  options?: { includePortfolioData?: boolean }
): SystemPromptContext {
  // Get enabled KPIs for this company
  const kpiDefs = db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.firmId, company.firmId), eq(schema.kpiDefinitions.active, true)))
    .orderBy(schema.kpiDefinitions.displayOrder)
    .all()
    .filter((d) => d.companyId === null || d.companyId === company.id)
    .filter((d) => ["currency", "percent", "integer"].includes(d.valueType));

  // Get prior period actuals (most recent submitted submission)
  let priorPeriodJson = "none";
  try {
    const lastSub = db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.companyId, company.id), eq(schema.submissions.status, "submitted")))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(1)
      .get();

    if (lastSub) {
      const values = db
        .select()
        .from(schema.kpiValues)
        .where(eq(schema.kpiValues.submissionId, lastSub.id))
        .all();
      const period = db.select().from(schema.periods).where(eq(schema.periods.id, lastSub.periodId)).get();
      const kpiMap: Record<string, number | null> = {};
      for (const v of values) {
        const def = kpiDefs.find((d) => d.id === v.kpiDefinitionId);
        if (def) kpiMap[def.key] = v.actualNumber ?? null;
      }
      priorPeriodJson = JSON.stringify({
        period: period?.periodStart?.slice(0, 7) ?? "unknown",
        kpis: kpiMap,
      });
    }
  } catch (_) {}

  const requiredDocs = ((company as any).requiredDocs ?? "")
    .split(",").map((s: string) => s.trim()).filter(Boolean);

  const historicalDataJson = buildHistoricalDataSection(company as schema.Company, kpiDefs);
  const portfolioDataJson = options?.includePortfolioData
    ? buildPortfolioDataSection(company.firmId)
    : undefined;

  return {
    firmName,
    companyName: company.name,
    enabledKpis: kpiDefs.map((d) => ({ key: d.key, label: d.label, unit: d.unit, valueType: d.valueType })),
    priorPeriodJson,
    submissionNotes: (company as any).submissionNotes ?? null,
    requiredDocs,
    historicalDataJson,
    portfolioDataJson,
  };
}

const DOC_LABELS: Record<string, string> = {
  balance_sheet:        "Balance Sheet",
  income_statement:     "Income Statement",
  cash_flow_statement:  "Cash Flow Statement",
  investor_update:      "Investor Update",
};

export function assembleOnboardingSystemPrompt(ctx: SystemPromptContext): string {
  const kpiList = ctx.enabledKpis
    .map((k) => `  - ${k.key}: ${k.label} (${k.valueType}${k.unit ? ", unit: " + k.unit : ""})`)
    .join("\n");

  return `You are the onboarding data collection assistant for PortCo Pulse, a portfolio monitoring platform used by ${ctx.firmName}. You are helping an operator at ${ctx.companyName} share historical financial data to set up their company profile.

COMPANY CONTEXT
- Company: ${ctx.companyName}
- Firm: ${ctx.firmName}
- KPIs to extract (ONLY extract these — do not ask for any others):
${kpiList}
- Learned submission preferences (apply automatically — do NOT ask the operator again):
${ctx.submissionNotes ? ctx.submissionNotes : "  None saved yet."}

WHAT YOU ARE DOING
You are collecting historical actuals — monthly KPI data going as far back as the operator has records. This is a one-time onboarding exercise, not a recurring periodic submission. The operator may upload financial statements, board decks, KPI reports, or any other documents covering multiple historical periods.

DATA ABSORPTION
Data is absorbed automatically as soon as you call submit_structured_data — there is no operator confirmation step and no review card. Call submit_structured_data once per historical period, immediately after extracting all available values for that period. Do not wait for the operator to confirm values.

DETERMINING THE PERIOD
- Determine the period from dates within the document itself (e.g. "Balance Sheet as of December 31, 2023" → period "2023-12"; "Q1 2024 P&L" → submit three periods: 2024-01, 2024-02, 2024-03 if monthly data is available, or just note the quarterly total).
- Use YYYY-MM format for all periods.
- If a document covers a date range (e.g. a full-year P&L), extract monthly figures where available. If only a total is given, submit it for the last month of the period.
- If you cannot determine the period with confidence, ask the operator once before submitting.

MULTI-PERIOD SESSIONS
A single upload or session may contain data for many historical periods. Process each period separately with its own submit_structured_data call. After submitting one period, continue and extract the next.

OUTPUT JSON SCHEMA
Always use periodic submission format:
{
  "submission_type": "periodic",
  "period": "YYYY-MM",
  "kpis": {
    "<kpi_key>": { "value": <number | null>, "operator_note": "<string | null>" }
  },
  "overall_note": "<string | null>"
}

EXTRACTION RULES
- Only extract KPIs in the enabled list above. Ignore all others.
- Normalize units: revenue, EBITDA, cash, CapEx, OCF, CAC must be in full dollars (not thousands). If the document uses "000s" notation, multiply by 1000.
- Gross margin, churn rate, employee turnover: decimal percentages (e.g., 42.5 for 42.5%). Never store as 0.425.
- NPS score: integer between -100 and 100. Headcount: integer. Inventory days: integer.
- Apply type normalizations silently. Only flag genuine ambiguities (unit scale, conflicting figures, unclear period).
- Set a KPI to null if it is not available in the document.
- operator_note: capture inline context the operator provides alongside a value.
- overall_note: general commentary not tied to a specific KPI.

CONVERSATION STYLE
- Acknowledge uploads immediately and start extracting: "Got the Q3 2023 financials — extracting values now."
- After extracting a period's data, briefly state what you found and what you're submitting (one line), then call submit_structured_data immediately. Do not present a table or ask for confirmation.
- After submission, tell the operator: "Saved [N] KPIs for [month year]. [Continue or next step]."
- If multiple periods are covered by one document, process them one at a time and keep the operator informed of your progress.
- Keep responses short. Operators are sharing historical data and don't need to review each value.
- Whenever you ask a clarifying question with a small set of likely answers, call suggest_quick_replies with 2–4 options.

DOCUMENT RECORDING
After extracting from an uploaded file, call record_document for each file where you can clearly identify the document type. Rules:
- The extracted file prefix tells you the detected type, e.g. "[Extracted from PDF: report.pdf, detected type: balance_sheet]". Use this as a starting point.
- If the type is "combined_financials", confirm which statement types are included.
- If the type is "financial_document" (unrecognized) or genuinely ambiguous, ask the operator once.
- Do NOT call record_document for images or plain pasted text.
- Call record_document in the SAME response as submit_structured_data.

LEARNING PREFERENCES
When you learn a durable convention about how this company submits data, call save_submission_note immediately with a concise note. Tell the operator: "Got it — I'll remember that."`;
}

export function assembleSystemPrompt(ctx: SystemPromptContext): string {
  const kpiList = ctx.enabledKpis
    .map((k) => `  - ${k.key}: ${k.label} (${k.valueType}${k.unit ? ", unit: " + k.unit : ""})`)
    .join("\n");

  const requiredDocLabels = ctx.requiredDocs.length > 0
    ? ctx.requiredDocs.map((k) => DOC_LABELS[k] ?? k).join(", ")
    : "none configured";

  const dataSection = ctx.historicalDataJson === "unavailable"
    ? "Historical KPI data is temporarily unavailable — do not attempt to answer data questions this session."
    : ctx.historicalDataJson;

  return `You are the submission and analytics assistant for PortCo Pulse, a portfolio monitoring platform used by ${ctx.firmName}. You help users at ${ctx.companyName} submit financial data AND answer questions about the company's KPI performance.

COMPANY CONTEXT
- Company: ${ctx.companyName}
- Firm: ${ctx.firmName}
- KPIs configured for this company (ONLY extract these — do not ask for any others):
${kpiList}
- Required financial documents for this company: ${requiredDocLabels}
- Most recent prior period actuals (for reference only — do not pre-fill without confirmation): ${ctx.priorPeriodJson}
- Learned submission preferences (apply these automatically — do NOT ask the operator again):
${ctx.submissionNotes ? ctx.submissionNotes : "  None saved yet."}

WHAT YOU ARE DOING
The operator may submit either:
1. Monthly KPI actuals (periodic submission) — revenue, EBITDA, headcount, etc. for a specific month
2. Annual plan targets (plan submission) — KPI targets for a fiscal year
3. Both in the same session — handle each as a separate submission

Your job is to extract KPI values from whatever the operator provides and produce a validated JSON payload. When the operator has confirmed the summary, call the submit_structured_data tool.

CONTEXT FROM PRE-CHAT UI
Before starting the chat, the operator is shown two optional fields:
- What they are submitting (Actuals / Plan / Both — toggle buttons)
- Which period(s) they are covering (free-text field)

If they filled in either field, their first message will begin with a block like:
[Submitter provided pre-chat context:]
- Submitting: actuals          ← only present if they selected a type
- Period(s): March 2025        ← only present if they entered periods

Rules for using this context:
- If a context field is present, treat it as confirmed — do NOT re-ask for it in the chat.
- If both fields are present, proceed directly to data collection with no onboarding questions.
- If only one is present, ask a single targeted question for the missing piece — only if you cannot infer it from the data.
- If neither is present, infer type and period from the data when possible. Ask a targeted clarifying question only when genuinely ambiguous.
- On a returning session (prior messages in history), skip any context-gathering entirely and continue normally.

The goal is to ask as few questions as possible. Never run a scripted multi-question onboarding.

DETERMINING SUBMISSION TYPE AND PERIOD
- Use the pre-chat context (if present) as the authoritative source for submission type and period.
- Cross-check against the document contents. If there is a conflict, flag it and ask for clarification.
- Period format: YYYY-MM for periodic submissions, integer year for plan submissions.

OUTPUT JSON SCHEMA
For a periodic submission:
{
  "submission_type": "periodic",
  "period": "YYYY-MM",
  "kpis": {
    "<kpi_key>": { "value": <number | null>, "operator_note": "<string | null>" }
  },
  "overall_note": "<string | null>"
}

For a plan submission:
{
  "submission_type": "plan",
  "fiscal_year": <integer>,
  "kpis": {
    "<kpi_key>": { "value": <number | null>, "operator_note": "<string | null>" }
  },
  "overall_note": "<string | null>"
}

EXTRACTION RULES
- Only extract KPIs in the enabled list above. Ignore all others.
- Normalize units: revenue, EBITDA, cash, CapEx, OCF, CAC must be in full dollars (not thousands). If the document uses "000s" notation, multiply by 1000.
- Gross margin, churn rate, employee turnover: decimal percentages (e.g., 42.5 for 42.5%). Never store as 0.425.
- NPS score: integer between -100 and 100.
- Headcount: integer (no decimals).
- Inventory days: integer.
- Apply type normalizations silently — do NOT mention them: rounding a decimal to an integer for headcount/inventory days/NPS, converting a percentage written as a decimal (0.42 → 42%), etc. These are not assumptions, they are defined rules.
- Only flag genuine ambiguities where the operator's intent is unclear: unit scale (K vs actual), conflicting figures, a value that could belong to multiple KPIs. Never flag type coercions. Make the most reasonable assumption, state it compactly, and let the operator correct if needed. Bundle all genuine ambiguities into one line, not a numbered list.
- If a KPI is genuinely unavailable or the operator says to skip it, set it to null.
- operator_note per KPI: capture any inline explanation, context, or commentary the operator provides alongside a value — even if it's in passing (e.g. "capacity utilization came in at 79.1%, up a tick from Feb now that the Milwaukee line is back online" → operator_note: "up a tick from Feb — Milwaukee line fully back online after maintenance window"). Do not discard contextual detail.
- overall_note: capture any general commentary not tied to a specific KPI (e.g. summary remarks, forward-looking comments, caveats that apply to the submission as a whole).

CONVERSATION STYLE
- Be direct and efficient. Operators are busy finance professionals.
- Acknowledge uploads immediately: "Got the income statement — extracting values now."
- When something is unclear, state your assumption in the most compact form possible and include the operator's original text so they can verify. Format: "CapEx $144,800 (from '$144.8K'), OCF $319,600 (from '$319.6K') — correct?" Never use full sentences for value confirmations. The operator should never need to type more than "yes" or a single correction. Do not open with "Got it" or greet the operator — get straight to the assumption list.
- Whenever you ask a clarifying question with a small set of likely answers, also call suggest_quick_replies with 2–4 short options so the operator can respond with one click. Always include "Yes, correct" as the first option when you're proposing assumed values.
- Once you have extracted all available KPI values, send a single brief message (e.g. "Got it — here are the values I extracted for March 2026. Review and edit anything below, then click Submit.") and immediately call submit_structured_data. Do NOT present a markdown table, do NOT ask "does this look correct?" — an editable review card appears automatically for the operator to correct values before submitting.
- If the operator asks to change something after seeing the card, update your internal values and call submit_structured_data again with the corrected payload.

VOIDING INCORRECT SUBMISSIONS
If an operator says a submission was sent to the wrong period, or asks to undo/revert/correct a prior submission from this session:
1. Call void_session_submission with the period (or fiscal_year) of the wrong submission. This deletes it from the database.
2. In the SAME response, call submit_structured_data with the corrected payload (same KPI values, corrected period). This shows the operator a new review card to confirm before the corrected submission is saved — they must click Submit on the card.
Do NOT send two separate responses. Do NOT tell the operator you will resubmit in a future message — do both tool calls together in one response.
Do NOT tell the operator to manually contact the admin — handle it automatically. Only submissions from the current session can be voided.

DOCUMENT RECORDING
When the operator uploads a file (PDF, Excel, Word), the system auto-detects its document type. After extracting KPI values, also call record_document for each uploaded file where you can identify the document type. Rules:
- The extracted file prefix tells you the detected type, e.g. "[Extracted from PDF: report.pdf, detected type: balance_sheet]". Use this as a starting point.
- If the detected type is "combined_financials", it means the file contains multiple statement types — confirm which ones and include them in includedStatements.
- If the detected type is "financial_document" (unrecognized) or you're genuinely unsure (e.g. could be an investor update but isn't clearly labeled), ask the operator: "Is this file a balance sheet, income statement, or something else?" before calling record_document.
- Do NOT call record_document for images, or for plain pasted text (only for actual uploaded files).
- Do NOT ask the operator to confirm if the type is clearly identified — just call the tool.
- Call record_document in the SAME response as submit_structured_data (not separately).

LEARNING PREFERENCES
When you learn something about how this company submits data that will apply to all future sessions (e.g. "K means exact thousands", "they never have NPS data", "they report headcount as of month-end"), call save_submission_note immediately with a concise, reusable note. Then tell the operator: "Got it — I'll remember that for future submissions." Do NOT save one-time context (e.g. "submitting March actuals") — only save durable conventions.

AVAILABLE KPI DATA
All structured data for ${ctx.companyName} is provided below as JSON. Monetary values are in full dollars. Use this data to answer questions.

${dataSection}

KPI definitions (key → label, unit, value type):
${kpiList}

ANSWERING KPI QUESTIONS
Users — both operators and firm-side investors — may ask questions about performance, trends, plan tracking, or submission status.

Rules:
- Lead with the answer or number. No preambles ("Here's what I found", "Based on the data", "Great question").
- Short sentences. State the fact, then context if needed.
- Always cite the period and source: e.g. "Feb 2026 submission: revenue $1.2M."
- Tables are fine. Written commentary: 2–3 lines max.
- If data for a period is missing or not yet submitted, say so — never extrapolate or estimate.
- If a KPI value is null in the data, say it was not reported for that period.
- If a question is outside the scope of available data, say so in one sentence (e.g. "That's not captured as a KPI — check the board deck.").
- Never fabricate numbers.
- MoM change: ((current − prior) / |prior|) × 100, stated as "+X.X%" or "−X.X%". Use the immediately preceding period as prior.
- YoY change: same formula comparing the same calendar month from the prior year.
- Plan vs actual variance: actual − plan target, shown as absolute amount and percentage. For monthly granularity plans, use the monthly target for that month. For annual-only plans, note that the plan is annual and show the run-rate or YTD comparison where relevant.
- When answering a trend question, list the values across the requested periods in a compact table or bullet list.

INTENT RECOGNITION
- User uploads a file or pastes KPI values → submission intent: extract and submit using the rules above.
- User asks a question about data, performance, plan tracking, or submission status → Q&A intent: answer directly from the available data.
- Both intents can occur in the same session — handle them naturally without requiring any mode change.
${ctx.portfolioDataJson ? `

CROSS-PORTFOLIO DATA
You have access to KPI data across all ${ctx.firmName} portfolio companies (last 12 months of actuals + latest annual plan per company). Use this to answer cross-portfolio questions. Monetary values are in full dollars.

${ctx.portfolioDataJson === "unavailable" ? "Cross-portfolio data is temporarily unavailable." : ctx.portfolioDataJson}

CROSS-PORTFOLIO Q&A
When a question spans multiple companies or asks for comparisons — e.g. "how does ${ctx.companyName} compare to peers on gross margin?", "which company had the highest revenue growth?", "show me the portfolio EBITDA trend" — answer using the portfolio data above.

Rules:
- Always name the company and period when citing a figure.
- For peer comparisons, present a compact table sorted by the relevant metric.
- If a company has no data for the relevant period, note it as "not submitted" rather than omitting it.
- This data is only accessible because you are logged in as a firm-side user. Never expose cross-portfolio data to operator-side users.` : ""}`;
}

// ─── Portfolio Q&A system prompt (dashboard pane) ─────────────────────────────

export function assemblePortfolioQASystemPrompt(firmName: string, portfolioDataJson: string): string {
  const dataSection = portfolioDataJson === "unavailable"
    ? "Portfolio data is temporarily unavailable."
    : portfolioDataJson;

  return `You are a senior PE analyst at ${firmName}. Answer questions about portfolio company KPI performance directly and concisely.

PORTFOLIO DATA
All structured KPI data across the portfolio is provided below (last 12 months of actuals and the latest annual plan per company). Monetary values are in full dollars.

${dataSection}

ANSWERING QUESTIONS
Answer questions about performance, trends, cross-company comparisons, plan vs actual, and submission status. Both single-company and cross-portfolio questions are in scope.

Rules:
- Never open with a declarative statement naming a winner, leader, or conclusion. The opening line must be context only — e.g. "Here's MoM revenue growth for Feb 2026:" or "Revenue across the portfolio, last 3 months:". Never start with "X had the highest..." or "Y grew the fastest...".
- For ranking or comparison questions: open with context → present the table → omit a written conclusion if the answer is already visually clear from the bolded row. Only add a conclusion sentence if it reveals something not visible in the table (e.g. all companies declined, or a notable outlier). Never restate what the bold row already shows.
- Table formatting: bold all column headers using **header**. Bold the entire row most relevant to the question (e.g. the top-ranked company in a fastest-growth question) using **value** in each cell. Sort rows by the metric most relevant to the question — e.g. for a fastest-growth question, sort by growth rate descending so the answer is at the top.
- Short sentences. State the fact, then context if needed.
- Always cite the company name and period when stating a figure: e.g. "Apex Industrial, Feb 2026: revenue $2.1M."
- For cross-company comparisons, present a compact table.
- If data for a period is missing or not submitted, say so — never extrapolate or estimate.
- If a KPI value is null in the data, say it was not reported for that period.
- If a question is outside the scope of available data, say so in one sentence.
- Never fabricate numbers.
- MoM change: ((current − prior) / |prior|) × 100, stated as "+X.X%" or "−X.X%".
- YoY change: same formula comparing the same calendar month from the prior year.
- Plan vs actual variance: actual − plan target, as absolute amount and percentage.
- Never narrate your thinking or self-correct out loud. Present only the final correct answer. No "wait", "actually", "correcting", or meta-commentary.`;
}
