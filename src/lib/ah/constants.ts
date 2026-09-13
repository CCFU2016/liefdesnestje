// Everything that identifies us to Albert Heijn's private mobile API lives
// here, so a change on their side is a one-file fix. Verified 2026-09-11;
// see docs/albert-heijn-api.md for what each value is and how it was tested.

export const AH_API_BASE = "https://api.ah.nl";

// The AH app's own client id. The login URL and the code exchange must use
// the same one: a code issued for `appie-ios` is rejected when exchanged as
// anything else.
export const AH_CLIENT_ID = "appie-ios";
export const AH_CLIENT_VERSION = "9.28";
export const AH_USER_AGENT = "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)";

export const AH_LOGIN_URL = `https://login.ah.nl/login?client_id=${AH_CLIENT_ID}&response_type=code&redirect_uri=appie://login-exit`;

// The redirect the login page sends the browser to; it never resolves in a
// browser, which is why the code has to be pasted by hand.
export const AH_REDIRECT_PREFIX = "appie://login-exit";

export const AH_PATHS = {
  anonymousToken: "/mobile-auth/v1/auth/token/anonymous",
  exchangeCode: "/mobile-auth/v1/auth/token",
  refreshToken: "/mobile-auth/v1/auth/token/refresh",
  logout: "/mobile-auth/v1/auth/token/logout",
  graphql: "/graphql",
  productSearch: "/mobile-services/product/search/v2",
  productsByIds: "/mobile-services/product/search/v2/products",
  // Mijn lijst: GET reads it, PATCH appends to it. Nothing removes items
  // (every delete variant answers 404/405); removal happens in the Appie app.
  myList: "/mobile-services/shoppinglist/v2/items",
} as const;

// One deadline for headers and body; AH is fast, and a stuck request must
// not hold a route open.
export const AH_TIMEOUT_MS = 15_000;
// A product search page is well over 100 KB, Mijn lijst with product details
// about 30 KB per dozen items.
export const AH_MAX_BODY_BYTES = 4 * 1024 * 1024;

export function ahHeaders(accessToken?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": AH_USER_AGENT,
    "x-client-name": AH_CLIENT_ID,
    "x-client-version": AH_CLIENT_VERSION,
    "x-application": "AHWEBSHOP",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  return h;
}
