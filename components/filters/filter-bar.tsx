"use client";

type FilterBarProps = {
  funds: string[];       // distinct fund names; "independent" = null-fund companies
  industries: string[];  // distinct industry values
  fund: string;          // "" = All
  industry: string;      // "" = All
  status: string;        // "" = All | "current" | "exited"
  onChange: (key: "fund" | "industry" | "status", value: string) => void;
  hideStatus?: boolean;
};

export function FilterBar({ funds, industries, fund, industry, status, onChange, hideStatus }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground mr-1">Filter:</span>

      {/* Fund */}
      <select
        value={fund}
        onChange={(e) => onChange("fund", e.target.value)}
        className="text-sm border border-border rounded-md px-3 py-1.5 bg-white min-w-[130px]"
      >
        <option value="">All Funds</option>
        {funds.map((f) => (
          <option key={f} value={f}>
            {f === "independent" ? "Independent" : f}
          </option>
        ))}
      </select>

      {/* Industry */}
      <select
        value={industry}
        onChange={(e) => onChange("industry", e.target.value)}
        className="text-sm border border-border rounded-md px-3 py-1.5 bg-white min-w-[140px]"
      >
        <option value="">All Industries</option>
        {industries.map((i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>

      {/* Status */}
      {!hideStatus && (
        <select
          value={status}
          onChange={(e) => onChange("status", e.target.value)}
          className="text-sm border border-border rounded-md px-3 py-1.5 bg-white min-w-[120px]"
        >
          <option value="">All Statuses</option>
          <option value="current">Currently Held</option>
          <option value="exited">Exited</option>
        </select>
      )}
    </div>
  );
}
