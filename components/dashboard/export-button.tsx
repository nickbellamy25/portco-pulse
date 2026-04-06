"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";

export function ExportDataButton({ firmId }: { firmId: string }) {
  function handleExport() {
    window.location.href = `/api/export?firmId=${firmId}`;
    toast.success("Export started");
  }

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
    >
      <Download className="h-4 w-4" />
      Export Data
    </button>
  );
}
