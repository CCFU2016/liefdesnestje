import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { isVisibleTo, visibleToFilter } from "@/lib/auth/visibility";
import { notes, holidays, recurringChores } from "@/lib/db/schema";

// Render a drizzle SQL fragment to { sql, params } so we can assert on it
// without a live database.
const render = (sql: SQL | undefined) => new PgDialect().sqlToQuery(sql!);

const niki = { userId: "user-niki" };
const laura = { userId: "user-laura" };

describe("isVisibleTo", () => {
  it("shows shared rows to everyone", () => {
    const row = { visibility: "shared" as const, authorId: niki.userId };
    expect(isVisibleTo(row, niki)).toBe(true);
    expect(isVisibleTo(row, laura)).toBe(true);
  });

  it("shows private rows only to their author", () => {
    const row = { visibility: "private" as const, authorId: niki.userId };
    expect(isVisibleTo(row, niki)).toBe(true);
    expect(isVisibleTo(row, laura)).toBe(false);
  });
});

describe("visibleToFilter", () => {
  // The filter must be an OR of exactly (visibility = shared) and
  // (author_id = caller). Assert on the generated SQL so a regression in the
  // helper is caught without a live database.
  it.each([
    ["notes", notes],
    ["holidays", holidays],
    ["recurringChores", recurringChores],
  ] as const)("builds the shared-or-own filter for %s", (_name, table) => {
    const filter = visibleToFilter(niki, table);
    expect(filter).toBeDefined();
    const { sql, params } = render(filter);
    expect(sql).toMatch(/"visibility" = .+ or .+"author_id" = /);
    expect(params).toEqual(["shared", niki.userId]);
  });

  it("binds the caller's user id, not someone else's", () => {
    const { params } = render(visibleToFilter(niki, notes));
    expect(params).toContain(niki.userId);
    expect(params).not.toContain(laura.userId);
  });
});
