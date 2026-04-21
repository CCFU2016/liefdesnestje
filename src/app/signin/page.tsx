import { signIn, auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Welcome to Liefdesnestje</CardTitle>
          <p className="text-sm text-zinc-500">Our little shared home hub.</p>
        </CardHeader>
        <CardContent>
          <form action={googleSignIn}>
            <Button className="w-full" type="submit">
              Sign in with Google
            </Button>
          </form>
          <p className="mt-4 text-xs text-zinc-500">
            Use the same Google account you want to sync calendars with.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
