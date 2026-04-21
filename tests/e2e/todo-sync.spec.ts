import { test, expect, type BrowserContext } from "@playwright/test";

// E2E: two authenticated contexts representing both partners. Create a todo in
// one; assert it appears in the other via SWR polling (≤ 7s).
//
// Prereq: the server must be running against a test DB that has been seeded
// with two users in one household. Because Auth.js OAuth flows can't be
// automated, the server must expose a test-only session-cookie bypass when
// NODE_ENV=test. Do NOT enable that route in production.
//
// Seed both members and capture valid session tokens in env:
//   E2E_SESSION_USER_A, E2E_SESSION_USER_B (signed session tokens)
//   E2E_LIST_ID (a todo list in the shared household)

test.skip(
  !process.env.E2E_SESSION_USER_A || !process.env.E2E_SESSION_USER_B || !process.env.E2E_LIST_ID,
  "Skipping: set E2E_SESSION_USER_A / _B and E2E_LIST_ID to run."
);

async function signedInContext(
  browser: import("@playwright/test").Browser,
  sessionToken: string
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    storageState: {
      cookies: [
        {
          name: "authjs.session-token",
          value: sessionToken,
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });
  return ctx;
}

test("todo created by partner A appears in partner B's browser within 7s", async ({ browser }) => {
  const ctxA = await signedInContext(browser, process.env.E2E_SESSION_USER_A!);
  const ctxB = await signedInContext(browser, process.env.E2E_SESSION_USER_B!);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.goto("/todos");
  await pageB.goto("/todos");

  const title = `e2e-${Date.now()}`;
  await pageA.getByPlaceholder("Add a to-do…").first().fill(title);
  await pageA.getByRole("button", { name: "Add" }).first().click();

  // Polling is 5s, so within 7s B should see the new item.
  await expect(pageB.getByText(title)).toBeVisible({ timeout: 7_000 });

  await ctxA.close();
  await ctxB.close();
});
