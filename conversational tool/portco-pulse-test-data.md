# PortCo Pulse — Submission Extractor Test Data

Three test cases for validating the `portco-pulse-submission-extractor` skill.
Each case includes the raw messy input and the expected extracted JSON output.

---

## Test Case 1 — Messy Typed Text, Periodic Submission

### Scenario
The CFO of Meridian Industrial (token: `mrd-4481`) types directly into the chat for their
February 2025 submission. They use inconsistent formatting, non-standard labels, mixed units,
omit several KPIs, and include a note about a one-time event.

---

### Raw Operator Input (typed chat message)

```
hi - sending feb numbers. its a bit of a messy month fyi

top line came in at 4.85M, gross profit was about 1.73M on that so margins were ok
EBITDA: -$142,000 — heads up this includes a ~$280K one time write-off from the Denver facility
closure so normalized EBITDA was closer to +138k

ending cash as of 2/28 was $3,210,500
we spent about 65K on equipment this month (capex)
cash from ops was positive, $287k

headcount: we're at 208 now, added 6 in February
churn holding at 2.3%
NPS — we ran the survey last week, came in at 52

no inventory days figure available this month (we're switching systems)
employee turnover and CAC not calculated yet for feb, will follow up
```

---

### Extraction Notes (for validator)

**Submission type**: Detected as `periodic` — "feb numbers", single-month values, no 12-column table.

**Period**: `2025-02` — "feb", "2/28", "February".

**KPI mapping**:
- "top line" → `revenue`: `$4.85M` → `4850000`
- "gross profit was about 1.73M" + "top line 4.85M" → `gross_margin` computed: `(1730000 / 4850000) * 100` = `35.67` (round to 2 decimal places)
- "EBITDA: -$142,000" → `ebitda`: `-142000`; note: "includes a ~$280K one-time write-off from the Denver facility closure, normalized EBITDA ~+138K"
- "ending cash as of 2/28 was $3,210,500" → `cash_balance`: `3210500`
- "65K on equipment this month (capex)" → `capex`: `65000`
- "cash from ops was positive, $287k" → `operating_cash_flow`: `287000`
- `customer_acquisition_cost`: `null` — "not calculated yet"
- "headcount: we're at 208 now" → `headcount`: `208`
- "churn holding at 2.3%" → `churn_rate`: `2.3`
- "no inventory days figure available this month" → `inventory_days`: `null`
- "NPS... came in at 52" → `nps_score`: `52`
- "employee turnover... not calculated yet" → `employee_turnover_rate`: `null`

**Documents**: none uploaded.

**Missing KPIs**: `customer_acquisition_cost`, `inventory_days`, `employee_turnover_rate`

---

### Expected Extracted JSON

```json
{
  "submission_type": "periodic",
  "company_token": "mrd-4481",
  "period": "2025-02",
  "submitted_by": null,
  "kpis": {
    "revenue": {
      "value": 4850000,
      "note": null
    },
    "gross_margin": {
      "value": 35.67,
      "note": "Computed from gross profit $1,730,000 / revenue $4,850,000"
    },
    "ebitda": {
      "value": -142000,
      "note": "Includes ~$280K one-time write-off from Denver facility closure; normalized EBITDA ~$138K"
    },
    "cash_balance": {
      "value": 3210500,
      "note": null
    },
    "capex": {
      "value": 65000,
      "note": null
    },
    "operating_cash_flow": {
      "value": 287000,
      "note": null
    },
    "customer_acquisition_cost": {
      "value": null,
      "note": "Not calculated for February; operator will follow up"
    },
    "headcount": {
      "value": 208,
      "note": null
    },
    "churn_rate": {
      "value": 2.3,
      "note": null
    },
    "inventory_days": {
      "value": null,
      "note": "Not available this month; switching systems"
    },
    "nps_score": {
      "value": 52,
      "note": null
    },
    "employee_turnover_rate": {
      "value": null,
      "note": "Not calculated for February; operator will follow up"
    }
  },
  "documents": [],
  "missing_kpis": ["customer_acquisition_cost", "inventory_days", "employee_turnover_rate"],
  "operator_confirmed": true,
  "extracted_at": "2025-03-05T14:32:00Z"
}
```

---

## Test Case 2 — Simulated CSV Export, Periodic Submission

### Scenario
The controller at Vantage Logistics (token: `vnt-7721`) uploads a CSV that was exported from
their legacy accounting system for January 2025. It has irregular headers, dollar signs and commas
in number fields, extra blank rows, a mislabeled KPI row, and an embedded mini income statement.
No other text is provided.

---

### Raw CSV Content

```csv
VANTAGE LOGISTICS - MONTHLY REPORT EXPORT
Generated: 2025-02-03 09:14:22
Period: JAN-2025
,,,,

SECTION: OPERATIONS SUMMARY
Metric,Actual,Prior Month,Variance,$Var
Total Headcount,319,312,+7,n/a
Cust. Attrition Rate,1.8%,2.1%,-0.3%,n/a
Days Inventory (DIO),44,47,-3,n/a
Net Promoter,61,58,+3,n/a
Staff Attrition,6.2%,5.9%,+0.3%,n/a
CAC (blended),$ 318.00,$ 295.00,+23,n/a

,,,,
SECTION: INCOME STATEMENT (unaudited)
,,,,
,January,December,YTD,
Gross Sales,"$7,234,000","$6,980,000","$14,214,000",
Returns & Allowances,"($134,500)","($102,000)","($236,500)",
NET REVENUE,"$7,099,500","$6,878,000","$13,977,500",
,,,,
Cost of Goods Sold,"$4,508,000","$4,392,000","$8,900,000",
GROSS PROFIT,"$2,591,500","$2,486,000","$5,077,500",
,,,,
Operating Expenses,"$1,845,000","$1,812,000","$3,657,000",
Depreciation & Amort.,"$145,000","$145,000","$290,000",
Interest Expense,"$38,000","$38,500","$76,500",
EBITDA*,"$891,500","$819,000","$1,710,500",
[*] EBITDA = Gross Profit minus OpEx plus D&A,,,,

,,,,
SECTION: BALANCE SHEET HIGHLIGHTS
As of January 31 2025,,,,
Cash and Cash Equivalents,"$5,412,333",,,,
Total Debt,"$12,100,000",,,,
Net Working Capital,"$3,210,000",,,,

,,,,
SECTION: CASH FLOW (partial)
Net Cash from Operating Activities,"$1,023,000",,,,
Capital Expenditures,"($212,000)",,,,
```

---

### Extraction Notes (for validator)

**Submission type**: `periodic` — period header "JAN-2025", month-specific actuals, standard financial statement structure.

**Period**: `2025-01` — "JAN-2025", "January 31 2025".

**KPI mapping**:

From OPERATIONS SUMMARY section:
- "Total Headcount" → `headcount`: `319`
- "Cust. Attrition Rate" → `churn_rate`: `1.8` (customer attrition = customer churn)
- "Days Inventory (DIO)" → `inventory_days`: `44`
- "Net Promoter" → `nps_score`: `61`
- "Staff Attrition" → `employee_turnover_rate`: `6.2`
- "CAC (blended)" → `customer_acquisition_cost`: `318` (strip `$` and `.00`)

From INCOME STATEMENT (January column, ignore December/YTD):
- "NET REVENUE" → `revenue`: `$7,099,500` → `7099500`
- "GROSS PROFIT" `$2,591,500` / "NET REVENUE" `$7,099,500` → `gross_margin`: `(2591500/7099500)*100` = `36.50`
- "EBITDA*" → `ebitda`: `$891,500` → `891500`

Note on EBITDA footnote: the formula note says "Gross Profit minus OpEx plus D&A" — this matches
standard EBITDA. The value `$891,500` can be validated: `2,591,500 - 1,845,000 + 145,000 = 891,500` ✓

From BALANCE SHEET HIGHLIGHTS:
- "Cash and Cash Equivalents" → `cash_balance`: `5412333`

From CASH FLOW:
- "Net Cash from Operating Activities" → `operating_cash_flow`: `1023000`
- "Capital Expenditures" → `capex`: `212000` (strip parentheses/negative, CapEx is conventionally positive)

**Documents**: This CSV contains sections resembling income statement, balance sheet highlights, and partial cash flow — mark all three as extracted from the same file.

**Missing KPIs**: none — all 12 KPIs resolved.

---

### Expected Extracted JSON

```json
{
  "submission_type": "periodic",
  "company_token": "vnt-7721",
  "period": "2025-01",
  "submitted_by": null,
  "kpis": {
    "revenue": {
      "value": 7099500,
      "note": "Net Revenue line from income statement (Gross Sales $7,234,000 less Returns $134,500)"
    },
    "gross_margin": {
      "value": 36.50,
      "note": "Computed from Gross Profit $2,591,500 / Net Revenue $7,099,500"
    },
    "ebitda": {
      "value": 891500,
      "note": null
    },
    "cash_balance": {
      "value": 5412333,
      "note": null
    },
    "capex": {
      "value": 212000,
      "note": null
    },
    "operating_cash_flow": {
      "value": 1023000,
      "note": null
    },
    "customer_acquisition_cost": {
      "value": 318,
      "note": "Blended CAC"
    },
    "headcount": {
      "value": 319,
      "note": null
    },
    "churn_rate": {
      "value": 1.8,
      "note": "Customer attrition rate"
    },
    "inventory_days": {
      "value": 44,
      "note": null
    },
    "nps_score": {
      "value": 61,
      "note": null
    },
    "employee_turnover_rate": {
      "value": 6.2,
      "note": "Staff attrition rate"
    }
  },
  "documents": [
    {
      "document_type": "income_statement",
      "file_name": "vantage_jan2025_monthly_report.csv",
      "extracted": true
    },
    {
      "document_type": "balance_sheet",
      "file_name": "vantage_jan2025_monthly_report.csv",
      "extracted": true
    },
    {
      "document_type": "cash_flow_statement",
      "file_name": "vantage_jan2025_monthly_report.csv",
      "extracted": true
    }
  ],
  "missing_kpis": [],
  "operator_confirmed": true,
  "extracted_at": "2025-02-05T10:15:00Z"
}
```

---

## Test Case 3 — Annual Plan, Free-Form Pasted Text

### Scenario
The VP Finance at Corestone Health (token: `crs-0092`) pastes a budget table from a Word doc into
the chat for their FY2026 plan. The table is partially formatted, has shorthand column headers,
includes quarterly sub-totals mixed in with monthly figures, uses inconsistent KPI labels, and
is missing several months for some KPIs.

---

### Raw Operator Input (pasted text, sent as a single message)

```
FY26 Plan — Corestone Health
Pasting from our budget model — hope the formatting comes through ok

REVENUE (000s)
        Jan    Feb    Mar    Q1 Total    Apr    May    Jun    Q2 Total    Jul    Aug    Sep    Q3 Total    Oct    Nov    Dec    Q4 Total    FY Total
Plan:   850    920    975    2,745       1,010  1,050  1,090  3,150       1,120  1,150  1,175  3,445       1,200  1,250  1,300  3,750       13,090

GM% Targets
Jan: 41.0   Feb: 41.5   Mar: 42.0   Q1 avg: 41.5
Apr: 42.0   May: 42.5   Jun: 43.0
[Q3 and Q4 GM% TBD - still working with ops team]

EBITDA Plan ($000s)
Jan=(95)  Feb=(40)  Mar=15  Apr=80  May=110  Jun=145  Jul=175  Aug=200  Sep=220  Oct=250  Nov=280  Dec=320
[Note: H1 negative EBITDA reflects planned marketing investment ramp]

Ending Cash ($K)
Jan 3,100 / Feb 2,900 / Mar 2,750 / Apr 2,850 / May 3,000 / Jun 3,200 / Jul 3,450 / Aug 3,700 / Sep 3,950 / Oct 4,200 / Nov 4,500 / Dec 4,800

CAPEX: $180K total for FY26, spread evenly across the year (15K/mo)

Operating CF
Q1: $120K   Q2: $310K   Q3: $480K   Q4: $620K
(monthly breakdowns not available yet)

CAC
Jan-Mar: $510   Apr-Jun: $480   Jul-Sep: $450   Oct-Dec: $425
(same within each quarter)

HEADCOUNT (end of period)
Jan 88 / Feb 91 / Mar 94 / Apr 97 / May 101 / Jun 105 / Jul 109 / Aug 113 / Sep 117 / Oct 121 / Nov 125 / Dec 130

Churn target: 1.5% monthly across all months

NPS: targeting 65 by end of year, starting from 58 in Jan — linear ramp
(Jan=58, Jun≈61, Dec=65)

Inventory days: 35 days target for all months

Emp. Turnover: 8.0% for H1, 7.5% for H2 (monthly figure same within each half)
```

---

### Extraction Notes (for validator)

**Submission type**: `plan` — "FY26 Plan", annual budget table, monthly targets, future fiscal year.

**Fiscal year**: `2026` — "FY26", "FY2026 plan".

**KPI extraction and normalization** (all revenue/EBITDA/cash figures are in $000s unless
otherwise noted — multiply by 1000):

**revenue** (all months in $000s → multiply by 1000):
- Jan=850000, Feb=920000, Mar=975000, Apr=1010000, May=1050000, Jun=1090000,
  Jul=1120000, Aug=1150000, Sep=1175000, Oct=1200000, Nov=1250000, Dec=1300000
- Q1/Q2/Q3/Q4 totals are validation figures, not separate data — ignore for monthly targets.

**gross_margin** (% — store as plain number):
- Jan=41.0, Feb=41.5, Mar=42.0, Apr=42.0, May=42.5, Jun=43.0
- Jul, Aug, Sep, Oct, Nov, Dec = null ("Q3 and Q4 TBD")
- Note: "Q1 avg: 41.5" is a summary figure, not a separate month — ignore.

**ebitda** (all in $000s → multiply by 1000; parentheses = negative):
- Jan=-95000, Feb=-40000, Mar=15000, Apr=80000, May=110000, Jun=145000,
  Jul=175000, Aug=200000, Sep=220000, Oct=250000, Nov=280000, Dec=320000
- Note on Jan–Jun: "planned marketing investment ramp"

**cash_balance** (in $K → multiply by 1000):
- Jan=3100000, Feb=2900000, Mar=2750000, Apr=2850000, May=3000000, Jun=3200000,
  Jul=3450000, Aug=3700000, Sep=3950000, Oct=4200000, Nov=4500000, Dec=4800000

**capex**: "$180K total for FY26, spread evenly... 15K/mo"
- All 12 months = 15000

**operating_cash_flow**: Provided as quarterly totals, no monthly breakdown available.
- Flag this — do NOT silently divide by 3. Store all months as null.
- Set missing_months accordingly. Include a note.
- (Q1=$120K, Q2=$310K, Q3=$480K, Q4=$620K — store as note in the JSON or as a field-level
  annotation. Since the schema has no quarterly field, record as note on the KPI.)

**customer_acquisition_cost**: Same within each quarter
- Jan=510, Feb=510, Mar=510, Apr=480, May=480, Jun=480,
  Jul=450, Aug=450, Sep=450, Oct=425, Nov=425, Dec=425

**headcount** (integers):
- Jan=88, Feb=91, Mar=94, Apr=97, May=101, Jun=105,
  Jul=109, Aug=113, Sep=117, Oct=121, Nov=125, Dec=130

**churn_rate**: 1.5% all months → all months = 1.5

**nps_score**: Linear ramp Jan=58 → Dec=65 (approximately 0.636/month increment)
- Jan=58, Feb=59, Mar=59, Apr=60, May=60, Jun=61, Jul=61, Aug=62, Sep=62,
  Oct=63, Nov=64, Dec=65
- (Round to nearest integer; operator specified Jan=58, Jun≈61, Dec=65 — interpolate linearly)

**inventory_days**: 35 all months

**employee_turnover_rate**: H1 = 8.0, H2 = 7.5
- Jan=8.0, Feb=8.0, Mar=8.0, Apr=8.0, May=8.0, Jun=8.0,
  Jul=7.5, Aug=7.5, Sep=7.5, Oct=7.5, Nov=7.5, Dec=7.5

**Missing months**: `operating_cash_flow` — all 12 months null (only quarterly provided).

---

### Expected Extracted JSON

```json
{
  "submission_type": "plan",
  "company_token": "crs-0092",
  "fiscal_year": 2026,
  "submitted_by": null,
  "monthly_targets": {
    "revenue": {
      "jan": 850000, "feb": 920000, "mar": 975000,
      "apr": 1010000, "may": 1050000, "jun": 1090000,
      "jul": 1120000, "aug": 1150000, "sep": 1175000,
      "oct": 1200000, "nov": 1250000, "dec": 1300000
    },
    "gross_margin": {
      "jan": 41.0, "feb": 41.5, "mar": 42.0,
      "apr": 42.0, "may": 42.5, "jun": 43.0,
      "jul": null, "aug": null, "sep": null,
      "oct": null, "nov": null, "dec": null
    },
    "ebitda": {
      "jan": -95000, "feb": -40000, "mar": 15000,
      "apr": 80000, "may": 110000, "jun": 145000,
      "jul": 175000, "aug": 200000, "sep": 220000,
      "oct": 250000, "nov": 280000, "dec": 320000
    },
    "cash_balance": {
      "jan": 3100000, "feb": 2900000, "mar": 2750000,
      "apr": 2850000, "may": 3000000, "jun": 3200000,
      "jul": 3450000, "aug": 3700000, "sep": 3950000,
      "oct": 4200000, "nov": 4500000, "dec": 4800000
    },
    "capex": {
      "jan": 15000, "feb": 15000, "mar": 15000,
      "apr": 15000, "may": 15000, "jun": 15000,
      "jul": 15000, "aug": 15000, "sep": 15000,
      "oct": 15000, "nov": 15000, "dec": 15000
    },
    "operating_cash_flow": {
      "jan": null, "feb": null, "mar": null,
      "apr": null, "may": null, "jun": null,
      "jul": null, "aug": null, "sep": null,
      "oct": null, "nov": null, "dec": null
    },
    "customer_acquisition_cost": {
      "jan": 510, "feb": 510, "mar": 510,
      "apr": 480, "may": 480, "jun": 480,
      "jul": 450, "aug": 450, "sep": 450,
      "oct": 425, "nov": 425, "dec": 425
    },
    "headcount": {
      "jan": 88, "feb": 91, "mar": 94,
      "apr": 97, "may": 101, "jun": 105,
      "jul": 109, "aug": 113, "sep": 117,
      "oct": 121, "nov": 125, "dec": 130
    },
    "churn_rate": {
      "jan": 1.5, "feb": 1.5, "mar": 1.5,
      "apr": 1.5, "may": 1.5, "jun": 1.5,
      "jul": 1.5, "aug": 1.5, "sep": 1.5,
      "oct": 1.5, "nov": 1.5, "dec": 1.5
    },
    "inventory_days": {
      "jan": 35, "feb": 35, "mar": 35,
      "apr": 35, "may": 35, "jun": 35,
      "jul": 35, "aug": 35, "sep": 35,
      "oct": 35, "nov": 35, "dec": 35
    },
    "nps_score": {
      "jan": 58, "feb": 59, "mar": 59,
      "apr": 60, "may": 60, "jun": 61,
      "jul": 61, "aug": 62, "sep": 62,
      "oct": 63, "nov": 64, "dec": 65
    },
    "employee_turnover_rate": {
      "jan": 8.0, "feb": 8.0, "mar": 8.0,
      "apr": 8.0, "may": 8.0, "jun": 8.0,
      "jul": 7.5, "aug": 7.5, "sep": 7.5,
      "oct": 7.5, "nov": 7.5, "dec": 7.5
    }
  },
  "missing_months": {
    "gross_margin": ["jul", "aug", "sep", "oct", "nov", "dec"],
    "operating_cash_flow": ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
  },
  "_extraction_notes": {
    "operating_cash_flow": "Operator provided quarterly totals only (Q1=$120K, Q2=$310K, Q3=$480K, Q4=$620K). Monthly breakdown not available — all months left null. Quarterly totals should be surfaced to firm reviewer.",
    "ebitda": "H1 negative EBITDA reflects planned marketing investment ramp per operator note.",
    "gross_margin": "Q3 and Q4 targets TBD — ops team alignment in progress.",
    "nps_score": "Linear interpolation between Jan=58 and Dec=65 per operator guidance."
  },
  "operator_confirmed": true,
  "extracted_at": "2025-11-14T16:45:00Z"
}
```

> **Validator note**: The `_extraction_notes` field is not part of the formal schema but is shown
> here to document extraction decisions. In the actual skill output, these notes would appear as
> part of the confirmation summary presented to the operator before confirmation, not as a separate
> JSON field.

---

## Summary of Edge Cases Covered

| Case | Key Challenges |
|---|---|
| TC1 | Alias mapping ("top line" → revenue), computed GM%, operator notes, partial submission, free-form prose |
| TC2 | CSV export noise (blank rows, extra columns, YTD columns to ignore), dollar signs/commas in numbers, embedded multi-section doc, parenthetical negatives |
| TC3 | Units in headers ($000s, $K), quarterly totals mixed with monthly, linear interpolation, half-year constants, missing months (GM%, OpCF), shorthand labels |
