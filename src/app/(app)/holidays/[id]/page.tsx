import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { holidays, householdMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { differenceInCalendarDays, format } from "date-fns";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarCheck, ExternalLink } from "lucide-react";

export default async function HolidayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireHouseholdMember();
  const h = (await db.select().from(holidays).where(eq(holidays.id, id)).limit(1))[0];
  if (!h || h.householdId !== ctx.householdId || h.deletedAt) notFound();
  if (h.visibility === "private" && h.authorId !== ctx.userId) notFound();

  const members = await db
    .select({
      userId: householdMembers.userId,
      displayName: householdMembers.displayName,
      color: householdMembers.color,
    })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId));

  const memberByUserId = new Map(members.map((m) => [m.userId, m]));
  const start = parseYmd(h.startsOn);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysAway = differenceInCalendarDays(start, now);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <div className="mb-4">
        <Link href="/holidays" className="text-sm text-zinc-500 hover:underline">← Back to holidays</Link>
      </div>

      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{h.title}</h1>
          <div className="text-sm text-zinc-500 mt-1">
            {format(start, "d MMM yyyy")}
            {h.endsOn && ` – ${format(parseYmd(h.endsOn), "d MMM yyyy")}`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-3xl font-bold">{Math.abs(daysAway)}</div>
          <div className="text-xs text-zinc-500">{daysAway < 0 ? "days ago" : "days away"}</div>
        </div>
      </div>

      {h.forPersons.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs uppercase tracking-wider text-zinc-500">For:</span>
          {h.forPersons.map((uid) => {
            const m = memberByUserId.get(uid);
            if (!m) return null;
            return (
              <span key={uid} className="flex items-center gap-1 text-sm">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                {m.displayName}
              </span>
            );
          })}
        </div>
      )}

      {h.pushToCalendar && h.externalCalendarEventId && (
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 mb-4">
          <CalendarCheck className="h-3.5 w-3.5" />
          In sync with your {h.externalCalendarProvider} calendar
        </div>
      )}

      {h.description && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{h.description}</CardContent>
        </Card>
      )}

      {h.documentUrl && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Document</CardTitle>
          </CardHeader>
          <CardContent>
            <a
              href={h.documentUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-sm underline"
            >
              Open document <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>
      )}

      {h.authorId === ctx.userId && (
        <div className="mt-4">
          <Link href="/holidays">
            <Button variant="ghost" size="sm">Edit from the list</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
