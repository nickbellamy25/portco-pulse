import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PersistentChatPanel } from "@/components/layout/PersistentChatPanel";
import { ChatContextProvider } from "@/components/layout/chat-context";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;

  return (
    <ChatContextProvider>
      <div className="h-screen flex flex-col bg-muted/20">
        <div className="shrink-0 z-40">
          <Topbar userName={user.name} userRole={user.role} />
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="border-r border-border shrink-0">
            <Sidebar persona={user.persona} />
          </div>
          <main className="flex-1 min-w-0 overflow-y-auto">
            {children}
          </main>
          <PersistentChatPanel
            persona={user.persona}
            userCompanyId={user.companyId ?? null}
            firmId={user.firmId}
          />
        </div>
      </div>
    </ChatContextProvider>
  );
}
