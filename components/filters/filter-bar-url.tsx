"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FilterBar } from "./filter-bar";

type Props = {
  funds: string[];
  industries: string[];
  hideStatus?: boolean;
};

export function FilterBarUrl({ funds, industries, hideStatus }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fund = searchParams.get("fund") ?? "";
  const industry = searchParams.get("industry") ?? "";
  const status = searchParams.get("status") ?? "current";

  function handleChange(key: "fund" | "industry" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Reset to page 1 / no company selection on fund/industry/status changes
    params.delete("company");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <FilterBar
      funds={funds}
      industries={industries}
      fund={fund}
      industry={industry}
      status={status}
      onChange={handleChange}
      hideStatus={hideStatus}
    />
  );
}
