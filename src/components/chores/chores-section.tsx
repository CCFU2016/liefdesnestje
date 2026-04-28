"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ListChecks, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Member = { userId: string; displayName: string; color: string; avatarUrl?: string | null };

type Chore = {
  id: string;
  title: string;
  notes: string | null;
  daysOfWeek: number[];
  pointsValue: number;
  rollsOver: boolean;
  visibility: "private" | "shared";
  authorId: string;
};

type Completion = {
  completedById: string;
  completedAt: string;
  pointsAwarded: number;
};

type ScheduledRow = { chore: Chore; completion: Completion | null };
type CarryoverRow = { chore: Chore; missedDate: string };

type Payload = {
  date: string;
  scheduledToday: ScheduledRow[];
  carryover: CarryoverRow[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SAGE = "rgb(91 138 114)"; // soft sage accent

function formatHHmm(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function formatMissedDate(ymd: string): string {
  // "Carried over from Thu 23 Apr"
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(`${ymd}T00:00:00Z`));
  } catch {
    return ymd;
  }
}

function MemberChip({ member }: { member: Member }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-1.5 py-0 text-[10px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.avatarUrl} alt="" className="h-3 w-3 rounded-full object-cover" />
      ) : (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: member.color }}
        />
      )}
      {member.displayName}
    </span>
  );
}

export function ChoresSection({ members }: { members: Member[] }) {
  const { data, mutate } = useSWR<Payload>("/api/chores", fetcher, {
    refreshInterval: 30_000,
  });
  const memberByUserId = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members]
  );

  const scheduled = data?.scheduledToday ?? [];
  const carryover = data?.carryover ?? [];

  const headerLabel = data
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "short",
      }).format(new Date(`${data.date}T00:00:00Z`))
    : "Today";

  const complete = async (choreId: string, date: string) => {
    // Optimistic: mark this row done locally, refetch leaderboard via global mutate.
    mutate(
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          scheduledToday: prev.scheduledToday.map((row) =>
            row.chore.id === choreId && date === prev.date && !row.completion
              ? {
                  ...row,
                  completion: {
                    completedById: "OPTIMISTIC",
                    completedAt: new Date().toISOString(),
                    pointsAwarded: row.chore.pointsValue,
                  },
                }
              : row
          ),
          carryover: prev.carryover.filter(
            (c) => !(c.chore.id === choreId && c.missedDate === date)
          ),
        };
      },
      false
    );
    try {
      const res = await fetch(`/api/chores/${choreId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't mark done — try again.");
    }
    mutate();
    // Tell leaderboard to refetch too.
    leaderboardBump();
  };

  const undo = async (choreId: string, date: string) => {
    if (!confirm("Undo this completion?")) return;
    mutate(
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          scheduledToday: prev.scheduledToday.map((row) =>
            row.chore.id === choreId && date === prev.date
              ? { ...row, completion: null }
              : row
          ),
        };
      },
      false
    );
    try {
      const res = await fetch(
        `/api/chores/${choreId}/complete?date=${encodeURIComponent(date)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't undo — try again.");
    }
    mutate();
    leaderboardBump();
  };

  const isEmpty = scheduled.length === 0 && carryover.length === 0;

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4" style={{ color: SAGE }} />
          Chores · {headerLabel}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-sm text-zinc-500">
            Nothing scheduled today — enjoy a quiet evening.
          </p>
        ) : (
          <ul className="space-y-2">
            {scheduled.map((row) => {
              const date = data!.date;
              const completed = !!row.completion;
              const completer =
                row.completion && memberByUserId.get(row.completion.completedById);
              return (
                <li
                  key={`s-${row.chore.id}`}
                  className={
                    "flex items-start gap-3 rounded-md p-2 -m-2 " +
                    (completed ? "opacity-60" : "")
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      completed ? undo(row.chore.id, date) : complete(row.chore.id, date)
                    }
                    aria-label={completed ? "Undo" : "Mark done"}
                    className={
                      "mt-0.5 h-5 w-5 rounded-full border-2 shrink-0 transition-colors " +
                      (completed
                        ? "border-emerald-500 bg-emerald-500"
                        : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700")
                    }
                    style={completed ? undefined : { borderColor: undefined }}
                  >
                    {completed && (
                      <span className="block h-2 w-2 mx-auto rounded-full bg-white" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={"text-sm font-medium " + (completed ? "line-through" : "")}>
                      {row.chore.title}
                    </div>
                    {completed && completer && row.completion && (
                      <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
                        Done by <MemberChip member={completer} /> at {formatHHmm(row.completion.completedAt)}
                      </div>
                    )}
                  </div>
                  {!completed && (
                    <span
                      className="text-[10px] rounded-full px-1.5 py-0.5 shrink-0"
                      style={{ background: `${SAGE}22`, color: SAGE }}
                    >
                      +{row.chore.pointsValue} pt
                    </span>
                  )}
                  {completed && (
                    <button
                      onClick={() => undo(row.chore.id, date)}
                      className="p-1 text-zinc-400 hover:text-zinc-700 shrink-0"
                      title="Undo"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}

            {carryover.map((row) => (
              <li
                key={`c-${row.chore.id}-${row.missedDate}`}
                className="flex items-start gap-3 rounded-md p-2 -m-2"
              >
                <button
                  type="button"
                  onClick={() => complete(row.chore.id, row.missedDate)}
                  aria-label="Mark done (carryover)"
                  className="mt-0.5 h-5 w-5 rounded-full border-2 border-zinc-300 hover:border-zinc-500 shrink-0 dark:border-zinc-700"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                    {row.chore.title}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Carried over from {formatMissedDate(row.missedDate)}
                  </div>
                </div>
                <span
                  className="text-[10px] rounded-full px-1.5 py-0.5 shrink-0"
                  style={{ background: `${SAGE}22`, color: SAGE }}
                >
                  +{row.chore.pointsValue} pt
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Tiny global pubsub so the chores card can poke the leaderboard card to
// refetch without prop-drilling. SWR's mutate could do this via key
// matching, but we'd need access to the leaderboard's exact URL — this is
// simpler and isolated to this feature.
const LEADERBOARD_REFRESH_EVENT = "liefdesnestje:leaderboard-refresh";
function leaderboardBump() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEADERBOARD_REFRESH_EVENT));
  }
}
export const leaderboardRefreshEvent = LEADERBOARD_REFRESH_EVENT;
