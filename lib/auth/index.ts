import NextAuth from "next-auth";
import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  firmId: string;
  companyId: string | null;
  role: "firm_admin" | "firm_member" | "company_admin" | "company_member";
  persona: "investor" | "operator";
};
