"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CheckSquare,
  NotebookText,
  Home,
  Plane,
  Settings as SettingsIcon,
  Wallet,
  Image as ImageIcon,
  Bell,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ElementType };

const primary: NavItem[] = [
  { href: "/today", label: "Today", icon: Home },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/todos", label: "To-dos", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: NotebookText },
];

const secondary: NavItem[] = [
  { href: "/trips", label: "Trips", icon: Plane },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/photos", label: "Photos", icon: ImageIcon },
];

export function Sidebar({
  user,
}: {
  user: { name: string; image: string | null; color: string };
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex h-screen w-60 flex-col border-r border-zinc-200 bg-white px-3 py-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-2 pb-4">
        <Link href="/today" className="flex items-center gap-2">
          <span className="inline-block h-6 w-6 rounded-full" style={{ background: user.color }} />
          <span className="font-semibold tracking-tight">Liefdesnestje</span>
        </Link>
      </div>
      <nav className="flex flex-col gap-0.5">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
        ))}
      </nav>
      <div className="mt-6 px-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Upcoming (soon)
      </div>
      <nav className="mt-1 flex flex-col gap-0.5">
        {secondary.map((item) => (
          <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <NavLink item={{ href: "/settings", label: "Settings", icon: SettingsIcon }} active={pathname.startsWith("/settings")} />
        <NavLink item={{ href: "/notifications", label: "Notifications", icon: Bell }} active={pathname.startsWith("/notifications")} />
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}
