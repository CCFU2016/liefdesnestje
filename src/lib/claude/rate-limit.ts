import { db } from "@/lib/db";
import { claudeUsage } from "@/lib/db/schema";
import { and, count, eq } from "drizzle-orm";
import { todayInAmsterdam } from "@/lib/chores/schedule";

const DAILY_CAP = 20;

export class ExtractionBudgetError extends Error {
  constructor() {
    super("You've used today's extraction budget — comes back tomorrow. Add manually for now.");
    this.name = "ExtractionBudgetError";
  }
}

// The user's day, in the household's timezone — same convention as chore
// completions. Server-local time would reset the cap at Railway's UTC
// midnight (2am Amsterdam) instead of the actual day boundary.
function today(): string {
  return todayInAmsterdam();
}

export async function assertWithinDailyCap(userId: string): Promise<void> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(claudeUsage)
    .where(and(eq(claudeUsage.userId, userId), eq(claudeUsage.date, today())));
  if (value >= DAILY_CAP) throw new ExtractionBudgetError();
}

export async function recordUsage(input: {
  userId: string;
  callType: "extract-text" | "extract-image" | "extract-social" | "aggregate";
  success: boolean;
  inputSizeBytes: number;
  outputSizeBytes: number;
  latencyMs: number;
}): Promise<void> {
  await db.insert(claudeUsage).values({
    userId: input.userId,
    date: today(),
    callType: input.callType,
    success: input.success,
    inputSizeBytes: input.inputSizeBytes,
    outputSizeBytes: input.outputSizeBytes,
    latencyMs: input.latencyMs,
  });
}
