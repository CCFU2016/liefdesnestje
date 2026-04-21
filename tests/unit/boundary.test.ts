import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB + auth modules before importing the SUT.
const memberRows: Array<{ userId: string; householdId: string; role: "owner" | "member"; displayName: string; color: string }> = [];
let sessionUserId: string | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => (sessionUserId ? { user: { id: sessionUserId } } : null),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (_: unknown) => ({
          limit: (_n: number) => memberRows.filter((r) => r.userId === sessionUserId),
        }),
      }),
    }),
  },
}));

describe("requireHouseholdMember + assertSameHousehold", () => {
  beforeEach(() => {
    memberRows.length = 0;
    sessionUserId = null;
  });

  it("throws 401 when not signed in", async () => {
    const { requireHouseholdMember, UnauthorizedError } = await import("@/lib/auth/household");
    await expect(requireHouseholdMember()).rejects.toBeInstanceOf(UnauthorizedError);
    try {
      await requireHouseholdMember();
    } catch (e) {
      if (e instanceof UnauthorizedError) expect(e.status).toBe(401);
    }
  });

  it("throws 403 when signed in but no membership", async () => {
    sessionUserId = "u-1";
    const { requireHouseholdMember, UnauthorizedError } = await import("@/lib/auth/household");
    await expect(requireHouseholdMember()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns the member's household context when valid", async () => {
    sessionUserId = "u-1";
    memberRows.push({ userId: "u-1", householdId: "h-1", role: "owner", displayName: "Niki", color: "#4f46e5" });
    const { requireHouseholdMember } = await import("@/lib/auth/household");
    const ctx = await requireHouseholdMember();
    expect(ctx.userId).toBe("u-1");
    expect(ctx.householdId).toBe("h-1");
    expect(ctx.role).toBe("owner");
  });

  it("assertSameHousehold blocks cross-household access", async () => {
    sessionUserId = "u-1";
    memberRows.push({ userId: "u-1", householdId: "h-1", role: "member", displayName: "Niki", color: "#4f46e5" });
    const { assertSameHousehold, UnauthorizedError } = await import("@/lib/auth/household");
    await expect(assertSameHousehold("h-OTHER")).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(assertSameHousehold("h-1")).resolves.toMatchObject({ householdId: "h-1" });
  });
});
