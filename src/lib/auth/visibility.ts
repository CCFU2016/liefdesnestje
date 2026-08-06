import { eq, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Visibility rule, in one place: a row is visible to the caller when it's
 * shared, or when it's the caller's own private item. Use this (or
 * `visibleToFilter` for list queries) instead of hand-writing the check in
 * routes — one forgotten copy is a private-data leak.
 */
export function isVisibleTo(
  row: { visibility: "private" | "shared"; authorId: string },
  ctx: { userId: string }
): boolean {
  return row.visibility !== "private" || row.authorId === ctx.userId;
}

/**
 * WHERE-clause companion to `isVisibleTo` for list queries: shared rows plus
 * the caller's own private rows. Pass the table (or any object exposing its
 * `visibility` and `authorId` columns).
 */
export function visibleToFilter(
  ctx: { userId: string },
  cols: { visibility: AnyPgColumn; authorId: AnyPgColumn }
): SQL | undefined {
  return or(eq(cols.visibility, "shared"), eq(cols.authorId, ctx.userId));
}
