export type KpiLibraryItem = {
  key: string;
  label: string;
  section: "Finance" | "Operations" | "Sales";
  unit: string;
  valueType: string;
  requiresNote?: boolean;
};

export const KPI_LIBRARY: KpiLibraryItem[] = [
  // Finance — P&L
  { key: "revenue",               label: "Revenue",                        section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "cogs",                  label: "Cost of Goods Sold",             section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "gross_profit",          label: "Gross Profit",                   section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "gross_margin",          label: "Gross Margin",                   section: "Finance",    unit: "%",    valueType: "percent"  },
  { key: "opex",                  label: "Operating Expenses",             section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "ebitda",                label: "EBITDA",                         section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "ebit",                  label: "EBIT",                           section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "da",                    label: "Depreciation & Amortization",    section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "interest_expense",      label: "Interest Expense",               section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "net_income",            label: "Net Income",                     section: "Finance",    unit: "$",    valueType: "currency" },
  // Finance — Balance Sheet
  { key: "cash_balance",          label: "Cash & Cash Equivalents",        section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "accounts_receivable",   label: "Accounts Receivable",            section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "accounts_payable",      label: "Accounts Payable",               section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "inventory",             label: "Inventory",                      section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "current_assets",        label: "Current Assets",                 section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "current_liabilities",   label: "Current Liabilities",            section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "total_assets",          label: "Total Assets",                   section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "total_liabilities",     label: "Total Liabilities",              section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "total_equity",          label: "Total Equity",                   section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "total_debt",            label: "Total Debt",                     section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "net_debt",              label: "Net Debt",                       section: "Finance",    unit: "$",    valueType: "currency" },
  // Finance — Cash Flow
  { key: "capex",                 label: "Capital Expenditures",           section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "operating_cash_flow",   label: "Operating Cash Flow",            section: "Finance",    unit: "$",    valueType: "currency" },
  { key: "free_cash_flow",        label: "Free Cash Flow",                 section: "Finance",    unit: "$",    valueType: "currency" },
  // Operations
  { key: "headcount",             label: "Headcount",                      section: "Operations", unit: "#",    valueType: "integer"  },
  { key: "revenue_per_employee",  label: "Revenue per Employee",           section: "Operations", unit: "$",    valueType: "currency" },
  { key: "customer_count",        label: "Customer Count",                 section: "Operations", unit: "#",    valueType: "integer"  },
  { key: "new_customers",         label: "New Customers",                  section: "Operations", unit: "#",    valueType: "integer"  },
  { key: "churned_customers",     label: "Churned Customers",              section: "Operations", unit: "#",    valueType: "integer"  },
  { key: "churn_rate",            label: "Churn Rate",                     section: "Operations", unit: "%",    valueType: "percent"  },
  { key: "nrr",                   label: "Net Revenue Retention",          section: "Operations", unit: "%",    valueType: "percent"  },
  { key: "cac",                   label: "Customer Acquisition Cost",      section: "Operations", unit: "$",    valueType: "currency" },
  { key: "ltv",                   label: "Customer Lifetime Value",        section: "Operations", unit: "$",    valueType: "currency" },
  { key: "nps_score",             label: "NPS Score",                      section: "Operations", unit: "",     valueType: "integer"  },
  { key: "employee_turnover_rate",label: "Employee Turnover Rate",         section: "Operations", unit: "%",    valueType: "percent"  },
  { key: "inventory_days",        label: "Inventory Days",                 section: "Operations", unit: "days", valueType: "integer"  },
  { key: "dso",                   label: "Days Sales Outstanding (DSO)",   section: "Operations", unit: "days", valueType: "integer"  },
  { key: "dpo",                   label: "Days Payable Outstanding (DPO)", section: "Operations", unit: "days", valueType: "integer"  },
  { key: "capacity_utilization",  label: "Capacity Utilization",           section: "Operations", unit: "%",    valueType: "percent"  },
  { key: "on_time_delivery",      label: "On-Time Delivery Rate",          section: "Operations", unit: "%",    valueType: "percent"  },
  // Sales — Existing / Closed
  { key: "total_bookings",        label: "Total Bookings",                 section: "Sales",      unit: "$",    valueType: "currency" },
  { key: "net_new_arr",           label: "Net New ARR",                    section: "Sales",      unit: "$",    valueType: "currency" },
  { key: "expansion_arr",         label: "Expansion ARR",                  section: "Sales",      unit: "$",    valueType: "currency" },
  { key: "churned_arr",           label: "Churned ARR",                    section: "Sales",      unit: "$",    valueType: "currency" },
  { key: "new_logos",             label: "New Logos Won",                  section: "Sales",      unit: "#",    valueType: "integer"  },
  { key: "deals_closed",          label: "Deals Closed",                   section: "Sales",      unit: "#",    valueType: "integer"  },
  { key: "avg_deal_size",         label: "Average Deal Size",              section: "Sales",      unit: "$",    valueType: "currency" },
  { key: "win_rate",              label: "Win Rate",                       section: "Sales",      unit: "%",    valueType: "percent"  },
  { key: "sales_cycle_days",      label: "Sales Cycle Length",             section: "Sales",      unit: "days", valueType: "integer"  },
  { key: "quota_attainment",      label: "Quota Attainment",               section: "Sales",      unit: "%",    valueType: "percent"  },
  { key: "upsell_revenue",        label: "Upsell / Cross-sell Revenue",    section: "Sales",      unit: "$",    valueType: "currency" },
  { key: "sales_growth_rate",     label: "Sales Growth Rate",              section: "Sales",      unit: "%",    valueType: "percent"  },
  { key: "revenue_per_rep",       label: "Revenue per Sales Rep",          section: "Sales",      unit: "$",    valueType: "currency" },
  // Sales — Pipeline (requiresNote: user must define what "pipeline" means)
  { key: "pipeline_value",        label: "Total Pipeline Value",           section: "Sales",      unit: "$",    valueType: "currency", requiresNote: true },
  { key: "weighted_pipeline",     label: "Weighted Pipeline Value",        section: "Sales",      unit: "$",    valueType: "currency", requiresNote: true },
  { key: "pipeline_coverage",     label: "Pipeline Coverage Ratio",        section: "Sales",      unit: "x",    valueType: "integer",  requiresNote: true },
  { key: "open_opportunities",    label: "Open Opportunities",             section: "Sales",      unit: "#",    valueType: "integer",  requiresNote: true },
  { key: "avg_pipeline_deal_size",label: "Avg Pipeline Deal Size",         section: "Sales",      unit: "$",    valueType: "currency", requiresNote: true },
  { key: "new_pipeline_created",  label: "New Pipeline Created",           section: "Sales",      unit: "$",    valueType: "currency", requiresNote: true },
  { key: "pipeline_conversion",   label: "Pipeline Conversion Rate",       section: "Sales",      unit: "%",    valueType: "percent",  requiresNote: true },
  { key: "pipeline_velocity",     label: "Pipeline Velocity",              section: "Sales",      unit: "$",    valueType: "currency", requiresNote: true },
  { key: "sqls",                  label: "Sales Qualified Leads (SQLs)",   section: "Sales",      unit: "#",    valueType: "integer",  requiresNote: true },
  { key: "mqls",                  label: "Marketing Qualified Leads (MQLs)", section: "Sales",    unit: "#",    valueType: "integer",  requiresNote: true },
  { key: "lead_to_sql_rate",      label: "Lead-to-SQL Conversion Rate",    section: "Sales",      unit: "%",    valueType: "percent",  requiresNote: true },
  { key: "sql_to_close_rate",     label: "SQL-to-Close Rate",              section: "Sales",      unit: "%",    valueType: "percent",  requiresNote: true },
];
