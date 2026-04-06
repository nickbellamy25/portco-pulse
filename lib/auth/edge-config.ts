/**
 * Edge-compatible auth config for middleware.
 * No DB imports — only JWT session verification.
 */
import type { NextAuthConfig } from "next-auth";

export const edgeAuthConfig: NextAuthConfig = {
  providers: [], // credentials provider is NOT edge-compatible — handled in full config
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.firmId = (user as any).firmId;
        token.companyId = (user as any).companyId;
        token.role = (user as any).role;
        token.persona = (user as any).persona;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        (session.user as any).firmId = token.firmId;
        (session.user as any).companyId = token.companyId;
        (session.user as any).role = token.role;
        (session.user as any).persona = token.persona;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
