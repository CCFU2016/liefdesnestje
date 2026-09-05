import { describe, expect, it } from "vitest";
import { isRelevantTo } from "@/components/todos/todos-page";

const me = "u-me";
const partner = "u-partner";

describe("isRelevantTo (the 'Mine' to-do filter)", () => {
  it("includes items assigned to me, whoever created them", () => {
    expect(isRelevantTo({ assigneeId: me, authorId: partner }, me)).toBe(true);
  });
  it("includes unassigned items I created", () => {
    expect(isRelevantTo({ assigneeId: null, authorId: me }, me)).toBe(true);
  });
  it("excludes items assigned to my partner, even ones I created", () => {
    expect(isRelevantTo({ assigneeId: partner, authorId: me }, me)).toBe(false);
  });
  it("excludes unassigned items my partner created", () => {
    expect(isRelevantTo({ assigneeId: null, authorId: partner }, me)).toBe(false);
  });
});
