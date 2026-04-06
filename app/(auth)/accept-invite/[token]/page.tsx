import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import { BarChart3 } from "lucide-react";
import { AcceptInviteForm } from "./accept-invite-form";

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hashedToken = createHash("sha256").update(token).digest("hex");
  const user = db.select().from(schema.users).where(eq(schema.users.inviteToken, hashedToken)).get();

  const isInvalid = !user;
  const isExpired = user && (!user.inviteTokenExpiresAt || Date.now() > user.inviteTokenExpiresAt);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-primary rounded-lg p-2">
              <BarChart3 className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold">PortCo Pulse</span>
          </div>
          <p className="text-muted-foreground text-sm">Portfolio Monitoring</p>
        </div>
        {isInvalid || isExpired ? (
          <div className="text-center space-y-2">
            <p className="font-medium">
              {isExpired ? "This invitation link has expired." : "This invitation link is invalid."}
            </p>
            <p className="text-sm text-muted-foreground">
              Please contact your administrator to request a new invitation.
            </p>
          </div>
        ) : (
          <AcceptInviteForm token={token} />
        )}
      </div>
    </div>
  );
}
