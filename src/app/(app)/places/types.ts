// Shared types for the travel map page.

export type Member = {
  userId: string;
  displayName: string;
  color: string;
  avatarUrl?: string | null;
};

export type Place = {
  id: string;
  name: string;
  country: string | null;
  countryCode: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  visitedOn: string | null; // 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' | null
  withPersons: string[];
  notes: string | null;
  authorId: string;
  tripId: string | null;
  tripName: string | null;
};

export type SearchResult = {
  id: number;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  country: string | null;
  countryCode: string | null;
  state: string | null;
};

export const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** ISO 3166-1 alpha-2 → flag emoji ("nl" → 🇳🇱). */
export function flagOf(countryCode: string | null): string {
  if (!countryCode || countryCode.length !== 2) return "🌍";
  const base = 0x1f1e6; // regional indicator A
  const a = countryCode.toLowerCase().charCodeAt(0) - 97;
  const b = countryCode.toLowerCase().charCodeAt(1) - 97;
  if (a < 0 || a > 25 || b < 0 || b > 25) return "🌍";
  return String.fromCodePoint(base + a, base + b);
}

/** "Together", a member's name, or "?" — for pin popups and list rows. */
export function whoLabel(withPersons: string[], members: Member[]): string {
  if (withPersons.length >= members.length && members.length > 1) return "Together";
  const names = withPersons
    .map((id) => members.find((m) => m.userId === id)?.displayName)
    .filter(Boolean);
  return names.length ? names.join(" & ") : "?";
}

// Map palette (deliberately separate from the app-wide member colors):
// Niki light blue, Laura pink, together orange. Assigned by display name so
// the colors are stable no matter who's looking; falls back to list order if
// nobody is called Laura anymore.
export const TOGETHER_COLOR = "#f97316"; // orange-500
const LIGHT_BLUE = "#38bdf8"; // sky-400
const PINK = "#ec4899"; // pink-500

export function memberMapColor(member: Member, members: Member[]): string {
  if (member.displayName.trim().toLowerCase().startsWith("laura")) return PINK;
  if (members.some((m) => m.displayName.trim().toLowerCase().startsWith("laura"))) {
    return LIGHT_BLUE; // Laura exists and this isn't her
  }
  // No Laura in the household — deterministic fallback by position.
  const idx = [...members].sort((a, b) => a.userId.localeCompare(b.userId)).indexOf(member);
  return idx === 1 ? PINK : LIGHT_BLUE;
}

/** Pin color: orange when everyone was there, else the (first) member's map color. */
export function pinColor(withPersons: string[], members: Member[]): string {
  if (withPersons.length >= members.length && members.length > 1) return TOGETHER_COLOR;
  const m = members.find((x) => withPersons.includes(x.userId));
  return m ? memberMapColor(m, members) : TOGETHER_COLOR;
}

/** Human form of a flexible visit date: "2019", "Jun 2019", "5 Jun 2019", or "". */
export function formatVisited(visitedOn: string | null): string {
  if (!visitedOn) return "";
  const [y, m, d] = visitedOn.split("-");
  if (!m) return y;
  const date = new Date(Number(y), Number(m) - 1, d ? Number(d) : 1);
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}
