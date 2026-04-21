import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { format } from "date-fns";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, session.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  // Mark all read (best-effort)
  if (rows.some((r) => !r.readAt)) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.userId, session.user.id));
  }

  return (
    <div className="mx-auto max-w-2xl p-6 md:p-10">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500 mt-4">Nothing yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((n) => (
            <li key={n.id} className="py-3">
              <div className="text-sm">{formatKind(n.kind, n.payload as Record<string, unknown>)}</div>
              <div className="text-xs text-zinc-500 mt-1">{format(n.createdAt, "d MMM HH:mm")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatKind(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "todo_assigned":
      return `You were assigned "${payload.title ?? "a todo"}".`;
    case "event_conflict":
      return `An event on your calendar was changed externally.`;
    case "invite_accepted":
      return `${payload.displayName ?? "Your partner"} joined the nest.`;
    default:
      return kind;
  }
}
