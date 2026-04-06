"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Companies", href: "/admin/companies" },
  { label: "Firm", href: "/admin/settings" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-1 mb-8">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              active
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
