"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CheckSquare, Home, NotebookText, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/today", label: "Today", icon: Home },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/todos", label: "To-dos", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: NotebookText },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function MobileTabs() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 flex justify-around border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-[11px]",
              active ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500"
            )}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
