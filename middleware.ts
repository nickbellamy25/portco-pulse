import NextAuth from "next-auth";
import { edgeAuthConfig } from "@/lib/auth/edge-config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(edgeAuthConfig);

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session?.user;
  const pathname = nextUrl.pathname;

  // Public paths
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/submit/") ||
    pathname.startsWith("/plan/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/upload") ||
    pathname.startsWith("/api/review") ||
    pathname.startsWith("/api/chat/");

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && pathname === "/login") {
    const user = session!.user as any;
    if (user.persona === "operator") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
