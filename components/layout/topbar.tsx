"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { BarChart3, Bell, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type TopbarProps = {
  userName?: string | null;
  userRole?: string | null;
};

export function Topbar({ userName, userRole }: TopbarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  async function fetchNotifications() {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) setItems(await res.json());
    } catch {
      // silently fail
    }
  }

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const unreadCount = items.filter((n) => !n.isRead).length;

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  async function handleClick(item: NotificationItem) {
    if (!item.isRead) {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      setItems((prev) => prev.map((n) => n.id === item.id ? { ...n, isRead: true } : n));
    }
    setOpen(false);
    if (item.linkUrl) {
      const url = item.linkUrl;
      // Strip the origin so we get just the pathname+query
      let path = url;
      try { path = new URL(url).pathname + new URL(url).search; } catch { /* relative URL already */ }
      // Operator submission/onboarding links should not be opened by firm users — redirect to submissions
      if (path.startsWith("/submit/") || path.startsWith("/onboard/")) {
        router.push("/submissions");
      } else {
        router.push(path);
      }
    }
  }

  const initials = userName
    ? userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  return (
    <div className="h-12 border-b border-border bg-white flex items-center px-5 shrink-0 gap-1">
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-2.5 mr-auto hover:opacity-80 transition-opacity">
        <div className="bg-primary rounded-lg p-1.5">
          <BarChart3 className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="font-semibold text-sm">PortCo Pulse</div>
      </Link>

      <div className="relative" ref={panelRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted"
          title="Notifications"
        >
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No notifications</p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleClick(item)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-muted/40 transition-colors",
                      !item.isRead && "bg-blue-50/60"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!item.isRead && (
                        <span className="mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500" />
                      )}
                      <div className={cn("min-w-0", item.isRead && "pl-3.5")}>
                        <p className="text-xs font-medium leading-snug truncate">{item.title}</p>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{item.body}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{formatTime(item.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-border mx-2" />

      {/* User avatar + logout */}
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
          {initials}
        </div>
        <button
          onClick={() => {
            try { sessionStorage.removeItem("pulse_chat_messages_v1"); } catch {}
            signOut({ callbackUrl: "/login" });
          }}
          className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
