import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { householdMembers, notifications } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { Header } from "@/components/shell/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const member = (
    await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, session.user.id))
      .limit(1)
  )[0];
  if (!member) redirect("/onboarding");

  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)));

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar
        user={{
          name: member.displayName,
          image: session.user.image ?? null,
          color: member.color,
        }}
      />
      <div className="flex flex-1 min-w-0 flex-col pb-16 md:pb-0">
        <Header unreadCount={unread.length} />
        {/* min-w-0 lets flex children shrink below their natural width;
            individual pages / cards handle their own overflow so content
            stays visible rather than being clipped off the viewport. */}
        <main className="flex-1 overflow-y-auto min-w-0">{children}</main>
      </div>
      <MobileTabs />
    </div>
  );
}
