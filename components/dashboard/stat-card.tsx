import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  iconBg?: string;
  subtitle?: string;
  subtitleColor?: string;
};

export function StatCard({ label, value, icon, iconBg, subtitle, subtitleColor }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-border p-5 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold mt-1">{value}</p>
        {subtitle && (
          <p className={cn("text-xs mt-1 truncate", subtitleColor ?? "text-muted-foreground")}>{subtitle}</p>
        )}
      </div>
      <div
        className={cn(
          "h-12 w-12 rounded-full flex items-center justify-center shrink-0",
          iconBg ?? "bg-muted"
        )}
      >
        {icon}
      </div>
    </div>
  );
}
