// Shared view-model types for the Settings page components.
export type Member = {
  userId: string;
  displayName: string;
  color: string;
  role: "owner" | "member";
  avatarUrl?: string | null;
};

export type Account = {
  id: string;
  provider: "google" | "microsoft";
  externalAccountId: string;
  expiresAt: Date;
};

export type CalendarVM = {
  id: string;
  name: string;
  color: string;
  syncEnabled: boolean;
  showOnToday: boolean;
  provider: "google" | "microsoft" | "ics";
  accountEmail: string;
  ownerUserId: string | null;
  ownerIsMe: boolean;
  ownerDisplayName: string;
  lastSyncedAt: string | Date | null;
  lastError: string | null;
  icsUrl: string | null;
  writable: boolean;
};


export const fetcher = (url: string) => fetch(url).then((r) => r.json());

export const PRESET_COLORS = [
  "#4f46e5", // indigo
  "#e11d48", // rose
  "#059669", // emerald
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#0d9488", // teal
  "#ea580c", // orange
  "#2563eb", // blue
];

// Same palette, aliased for clarity at the CalendarRow call site.
export const CALENDAR_COLOR_PRESETS = PRESET_COLORS;
