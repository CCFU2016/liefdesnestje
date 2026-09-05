"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CalendarRange,
  CheckSquare,
  Home,
  Ellipsis,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Five tabs that always fit on a phone. Everything else lives behind "More"
// (a plain route, so it survives reloads and works with the back gesture).
// Nine scrolling tabs looked like five: nothing showed the row could scroll.
const items = [
  { href: "/today", label: "Today", icon: Home },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/todos", label: "To-dos", icon: CheckSquare },
  { href: "/events", label: "Events", icon: CalendarRange },
  { href: "/more", label: "More", icon: Ellipsis },
];

// Pages reached through /more highlight the More tab, so no page is left
// without a lit tab.
const morePrefixes = [
  "/more",
  "/meals",
  "/notes",
  "/bucket-list",
  "/places",
  "/notifications",
  "/settings",
  "/budget",
  "/photos",
];

export function MobileTabs() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/more" ? morePrefixes.some((p) => pathname.startsWith(p)) : pathname.startsWith(href);

  return (
    // The safe-area padding sits inside the bar: in the installed app the
    // viewport runs under the home indicator (viewport-fit=cover), and a
    // control placed there is caught by the iOS swipe-up gesture instead of
    // being tapped. The blurred background still extends to the screen edge.
    <nav
      aria-label="Main"
      className="md:hidden fixed bottom-0 inset-x-0 z-20 flex border-t border-zinc-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90"
    >
      {items.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs",
              active ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500"
            )}
          >
            <Icon className="h-6 w-6" strokeWidth={active ? 2.25 : 1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
