import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { householdMembers, householdInvites } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { OnboardingForm } from "./form";
import { SwitchForm } from "./switch-form";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { invite } = await searchParams;

  const existing = (
    await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, session.user.id))
      .limit(1)
  )[0];

  // Resolve invite (if any)
  let inviteInfo: { token: string; householdId: string } | null = null;
  if (invite) {
    const row = (
      await db.select().from(householdInvites).where(eq(householdInvites.token, invite)).limit(1)
    )[0];
    if (row && !row.acceptedAt && row.expiresAt > new Date()) {
      inviteInfo = { token: row.token, householdId: row.householdId };
    }
  }

  // Already a member
  if (existing) {
    // Same household or no invite → nothing to do
    if (!inviteInfo || inviteInfo.householdId === existing.householdId) {
      redirect("/today");
    }
    // Different household — can we switch? Only if the user is alone in theirs.
    const otherInCurrent = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, existing.householdId),
          ne(householdMembers.userId, session.user.id)
        )
      );
    const canSwitch = otherInCurrent.length === 0;

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <SwitchForm
          canSwitch={canSwitch}
          inviteToken={inviteInfo.token}
          currentDisplayName={existing.displayName}
          currentColor={existing.color}
        />
      </div>
    );
  }

  // Not a member yet — original flow
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <OnboardingForm initialName={session.user.name ?? ""} invite={inviteInfo} />
    </div>
  );
}
