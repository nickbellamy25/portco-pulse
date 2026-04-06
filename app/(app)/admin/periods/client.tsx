"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Period } from "@/lib/db/schema";
import { createPeriodAction } from "./actions";

type Props = { periods: Period[]; firmId: string };

export function PeriodsClient({ periods, firmId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodType, setPeriodType] = useState<"monthly" | "quarterly">("monthly");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!periodStart) {
      toast.error("Period start date is required.");
      return;
    }
    setSaving(true);
    try {
      await createPeriodAction({ firmId, periodStart, periodType, dueDate: dueDate || null });
      toast.success("Period created.");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create period.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Reporting Periods</h1>
        </div>
        <Button onClick={() => setOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Period
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Period</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Due Date</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-3 font-medium">
                  {format(new Date(p.periodStart + "T12:00:00"), "MMMM yyyy")}
                </td>
                <td className="px-4 py-3 capitalize text-muted-foreground">{p.periodType}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.dueDate ? format(new Date(p.dueDate), "MMM d, yyyy") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Period Type</Label>
              <select
                className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm"
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as any)}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div>
              <Label>Period Start Date</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Due Date (optional)</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
