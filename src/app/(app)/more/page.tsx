import Link from "next/link";
import {
  Bell,
  ChevronRight,
  MapPin,
  NotebookText,
  Settings as SettingsIcon,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";
import { requireHouseholdMember } from "@/lib/auth/household";

// The pages that do not fit in the phone's five-tab bar. On a wide screen the
// sidebar lists them all, so this page only matters below the md breakpoint.
const pages = [
  { href: "/meals", label: "Meals", icon: UtensilsCrossed },
  { href: "/notes", label: "Notes", icon: NotebookText },
  { href: "/bucket-list", label: "Bucket list", icon: Sparkles },
  { href: "/places", label: "Travel map", icon: MapPin },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export default async function MorePage() {
  await requireHouseholdMember();

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="mb-3 text-lg font-semibold tracking-tight">More</h1>
      <nav aria-label="More pages">
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {pages.map((page) => {
            const Icon = page.icon;
            return (
              <li key={page.href}>
                <Link
                  href={page.href}
                  className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm text-zinc-900 active:bg-zinc-100 dark:text-zinc-50 dark:active:bg-zinc-900"
                >
                  <Icon className="h-5 w-5 text-zinc-500" />
                  <span className="flex-1">{page.label}</span>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
