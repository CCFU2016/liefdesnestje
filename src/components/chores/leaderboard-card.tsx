"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { leaderboardRefreshEvent } from "./chores-section";

type Row = {
  userId: string;
  displayName: string;
  color: string;
  avatarUrl: string | null;
  points: number;
  completionsCount: number;
};

type Payload = { range: "week" | "all"; leaderboard: Row[] };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function LeaderboardCard() {
  const [range, setRange] = useState<"week" | "all">("week");
  const { data, mutate } = useSWR<Payload>(
    `/api/chores/leaderboard?range=${range}`,
    fetcher,
    { refreshInterval: 60_000 }
  );

  useEffect(() => {
    const onBump = () => mutate();
    window.addEventListener(leaderboardRefreshEvent, onBump);
    return () => window.removeEventListener(leaderboardRefreshEvent, onBump);
  }, [mutate]);

  const board = data?.leaderboard ?? [];
  const top = board[0]?.points ?? 0;
  const tiedAtTop = board.length > 1 && board.length > 0 && board[0].points === board[1].points;

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          Leaderboard
        </CardTitle>
        <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          {(["week", "all"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={
                "px-2 py-1 rounded " +
                (range === r
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500")
              }
            >
              {r === "week" ? "This week" : "All time"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {board.length === 0 ? (
          <p className="text-sm text-zinc-500">No completions yet.</p>
        ) : (
          <ul className="space-y-2">
            {board.map((m, i) => {
              const pct = top > 0 ? Math.round((m.points / top) * 100) : 0;
              const isLeader = i === 0 && m.points > 0 && !tiedAtTop;
              return (
                <li
                  key={m.userId}
                  className="flex items-center gap-3"
                  title={`${m.completionsCount} chore${m.completionsCount === 1 ? "" : "s"} done`}
                >
                  <div className="relative shrink-0">
                    {m.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.avatarUrl}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        className="inline-block h-8 w-8 rounded-full"
                        style={{ background: m.color }}
                      />
                    )}
                    {isLeader && (
                      <span className="absolute -bottom-1 -right-1 inline-block h-3 w-3 rounded-full bg-amber-400 border-2 border-white dark:border-zinc-950" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate">{m.displayName}</span>
                      <span className="text-xs text-zinc-500 shrink-0">{m.points} pt</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: m.color }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
