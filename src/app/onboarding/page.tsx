import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { householdMembers, householdInvites } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { OnboardingForm } from "./form";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const existing = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.userId, session.user.id))
    .limit(1);
  if (existing[0]) redirect("/today");

  const { invite } = await searchParams;
  let inviteInfo: { token: string; householdId: string } | null = null;
  if (invite) {
    const rows = await db
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.token, invite))
      .limit(1);
    const row = rows[0];
    if (row && !row.acceptedAt && row.expiresAt > new Date()) {
      inviteInfo = { token: row.token, householdId: row.householdId };
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <OnboardingForm
        initialName={session.user.name ?? ""}
        invite={inviteInfo}
      />
    </div>
  );
}
