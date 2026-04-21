import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { beginOAuth } from "@/lib/microsoft/oauth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/signin", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  }
  const url = await beginOAuth(session.user.id);
  return NextResponse.redirect(url);
}
