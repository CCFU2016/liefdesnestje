import { auth } from "@/lib/auth/config";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/integrations/microsoft/webhook") ||
    pathname.startsWith("/api/integrations/google/webhook") ||
    pathname === "/signin" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon");

  if (!req.auth && !isPublic) {
    const url = new URL("/signin", req.nextUrl.origin);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (req.auth && (pathname === "/signin" || pathname === "/")) {
    return NextResponse.redirect(new URL("/today", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
