import { signIn, auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DevSignInButtons } from "./dev-buttons";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { from } = await searchParams;

  async function googleSignIn() {
    "use server";
    await signIn("google", { redirectTo: from ?? "/" });
  }

  const devLoginAllowed =
    process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "1";

  const googleConfigured = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Welcome to Liefdesnestje</CardTitle>
          <p className="text-sm text-zinc-500">Our little shared home hub.</p>
        </CardHeader>
        <CardContent>
          {googleConfigured && (
            <form action={googleSignIn}>
              <Button className="w-full" type="submit">
                Sign in with Google
              </Button>
            </form>
          )}
          {!googleConfigured && !devLoginAllowed && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Google OAuth isn't configured yet — set <code>AUTH_GOOGLE_ID</code> and <code>AUTH_GOOGLE_SECRET</code> in your <code>.env</code>.
            </p>
          )}

          {devLoginAllowed && (
            <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-4 space-y-2">
              <p className="text-xs text-zinc-500">Dev mode</p>
              <DevSignInButtons />
            </div>
          )}

          <p className="mt-4 text-xs text-zinc-500">
            Use the same Google account you want to sync calendars with.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
