"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { CalendarCheck, Plus, AlertCircle, Tag } from "lucide-react";
import { differenceInCalendarDays, format, isBefore } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EventDialog, type Category, type Event, type Member } from "./event-dialog";


const fetcher = (url: string) => fetch(url).then((r) => r.json());

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function EventsClient({
  initialEvents,
  members,
  currentUserId,
  connectedProviders,
  categories: initialCategories,
}: {
  initialEvents: Event[];
  members: Member[];
  currentUserId: string;
  connectedProviders: Array<"google" | "microsoft">;
  categories: Category[];
}) {
  const [dialog, setDialog] = useState<{ existing?: Event } | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<string | null | "uncategorized">(null);

  const { data, mutate } = useSWR<{ holidays: Event[] }>(`/api/holidays`, fetcher, {
    fallbackData: { holidays: initialEvents },
    refreshInterval: 10000,
  });
  const items = data?.holidays ?? initialEvents;

  const { data: catData, mutate: mutateCategories } = useSWR<{ categories: Category[] }>(
    `/api/event-categories`,
    fetcher,
    { fallbackData: { categories: initialCategories } }
  );
  const categories = catData?.categories ?? initialCategories;
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filtered = useMemo(() => {
    if (filterCategoryId === null) return items;
    if (filterCategoryId === "uncategorized") return items.filter((e) => !e.categoryId);
    return items.filter((e) => e.categoryId === filterCategoryId);
  }, [items, filterCategoryId]);

  const { upcoming, past } = useMemo(() => {
    const up: Event[] = [];
    const pa: Event[] = [];
    for (const h of filtered) {
      if (isBefore(parseYmd(h.startsOn), today)) pa.push(h);
      else up.push(h);
    }
    return { upcoming: up, past: pa.reverse() };
  }, [filtered, today]);

  const memberByUserId = new Map(members.map((m) => [m.userId, m]));

  const uncatCount = items.filter((e) => !e.categoryId).length;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button onClick={() => setDialog({})}>
          <Plus className="h-4 w-4" /> New event
        </Button>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <FilterChip
            active={filterCategoryId === null}
            onClick={() => setFilterCategoryId(null)}
          >
            All ({items.length})
          </FilterChip>
          {categories.map((c) => {
            const count = items.filter((e) => e.categoryId === c.id).length;
            return (
              <FilterChip
                key={c.id}
                active={filterCategoryId === c.id}
                color={c.color ?? undefined}
                onClick={() => setFilterCategoryId(c.id)}
              >
                {c.name} ({count})
              </FilterChip>
            );
          })}
          {uncatCount > 0 && (
            <FilterChip
              active={filterCategoryId === "uncategorized"}
              onClick={() => setFilterCategoryId("uncategorized")}
            >
              uncategorized ({uncatCount})
            </FilterChip>
          )}
          <Link
            href="/settings#categories"
            className="text-xs px-2 py-0.5 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 flex items-center gap-1"
          >
            <Tag className="h-3 w-3" /> manage
          </Link>
        </div>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">
          {filterCategoryId
            ? "No events in this category."
            : "No events planned yet. Add your next trip, milestone, or day off."}
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">Upcoming</h2>
          {upcoming.map((h) => (
            <EventCard
              key={h.id}
              event={h}
              memberByUserId={memberByUserId}
              category={h.categoryId ? categoryById.get(h.categoryId) : undefined}
              canEdit={h.authorId === currentUserId}
              onEdit={() => setDialog({ existing: h })}
            />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <details className="mt-8">
          <summary className="text-xs uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-700">
            Previous ({past.length})
          </summary>
          <div className="mt-3 space-y-3 opacity-60">
            {past.map((h) => (
              <EventCard
                key={h.id}
                event={h}
                memberByUserId={memberByUserId}
                category={h.categoryId ? categoryById.get(h.categoryId) : undefined}
                canEdit={h.authorId === currentUserId}
                onEdit={() => setDialog({ existing: h })}
              />
            ))}
          </div>
        </details>
      )}

      {dialog && (
        <EventDialog
          existing={dialog.existing}
          members={members}
          categories={categories}
          connectedProviders={connectedProviders}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            mutate();
            mutateCategories();
          }}
          onCategoryCreated={() => mutateCategories()}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
        active
          ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50"
          : "bg-transparent text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
      }`}
    >
      {color && (
        <span
          className="inline-block h-2 w-2 rounded-full mr-1 align-middle"
          style={{ background: color }}
        />
      )}
      {children}
    </button>
  );
}

function EventCard({
  event,
  memberByUserId,
  category,
  canEdit,
  onEdit,
}: {
  event: Event;
  memberByUserId: Map<string, Member>;
  category?: Category;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const start = parseYmd(event.startsOn);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysAway = differenceInCalendarDays(start, now);
  const isPast = daysAway < 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/events/${event.id}`} className="font-semibold truncate hover:underline">
                {event.title}
              </Link>
              {category && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1"
                  style={{
                    background: category.color
                      ? `${category.color}22` // 13% alpha
                      : "rgb(244 244 245)",
                    color: category.color ?? "inherit",
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: category.color ?? "currentColor" }}
                  />
                  {category.name}
                </span>
              )}
              {event.pushToCalendar && event.externalCalendarEventId && (
                <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
              )}
              {event.pushToCalendar && !event.externalCalendarEventId && (
                <span title="Push pending or failed">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                </span>
              )}
              {event.visibility === "private" && (
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">private</span>
              )}
            </div>
            <div className="text-sm text-zinc-500 mt-0.5">
              {format(start, "d MMM yyyy")}
              {event.endsOn && ` – ${format(parseYmd(event.endsOn), "d MMM yyyy")}`}
            </div>
            {event.forPersons.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {event.forPersons.map((uid) => {
                  const m = memberByUserId.get(uid);
                  if (!m) return null;
                  return (
                    <span key={uid} className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: m.color }}
                      />
                      {m.displayName}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold">{Math.abs(daysAway)}</div>
            <div className="text-xs text-zinc-500">{isPast ? "days ago" : "days away"}</div>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={onEdit} className="mt-1 h-7 px-2 text-xs">
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

