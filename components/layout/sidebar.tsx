"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileCheck,
  TrendingUp,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const investorNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tracking", href: "/submissions", icon: FileCheck },
  { label: "Data", href: "/analytics", icon: TrendingUp },
  { label: "Settings", href: "/admin/companies", icon: Settings },
];

const operatorNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tracking", href: "/submissions", icon: FileCheck },
  { label: "Data", href: "/analytics", icon: TrendingUp },
  { label: "Settings", href: "/admin/companies", icon: Settings },
];

const independentOperatorNav: NavItem[] = [
  { label: "Data", href: "/analytics", icon: TrendingUp },
  { label: "Settings", href: "/admin/companies", icon: Settings },
];

type SidebarProps = {
  persona?: "investor" | "operator" | "independent_operator";
};

export function Sidebar({ persona }: SidebarProps) {
  const pathname = usePathname();

  const navItems =
    persona === "independent_operator" ? independentOperatorNav
    : persona === "operator" ? operatorNav
    : investorNav;

  return (
    <div className="flex flex-col sticky top-12 h-[calc(100vh-3rem)] w-[72px] bg-white shrink-0">
      <nav className="flex-1 px-1.5 py-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive =
              item.href.startsWith("/admin")
                ? pathname.startsWith("/admin")
                : pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 px-1 rounded-md transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
