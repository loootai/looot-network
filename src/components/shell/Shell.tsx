"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Search, Settings } from "lucide-react";
import { signOut } from "@/app/actions";
import { AppShell, type ShellNavSection } from "@/components/AppShell";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/popover";
import type { BudgetStatus } from "@/lib/budget";
import { initials } from "@/lib/format";
import { usd } from "@/lib/money";

const NAV: ShellNavSection[] = [
  {
    items: [
      { href: "/", label: "People", icon: "users" },
      { href: "/search", label: "Search", icon: "search" },
      { href: "/companies", label: "Companies", icon: "building" },
    ],
  },
  {
    items: [
      { href: "/imports", label: "Imports", icon: "inbox" },
      { href: "/enrich", label: "Enrich", icon: "sparkles" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

export function Shell({ children, user, demo, budget }: { children: React.ReactNode; user: { name: string; email: string }; demo: boolean; budget: BudgetStatus | null }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search");
    setQ("");
  };
  const day = budget?.day;
  return (
    <AppShell
      appName="looot-network"
      githubHref="https://github.com/loootai/looot-network"
      docsHref="https://github.com/loootai/looot-network#readme"
      nav={NAV}
      demoLabel={demo ? "Demo data. Invented people. No sign-in, no looot token, no charge." : undefined}
      spend={
        budget && day
          ? {
              label: "Enrichment budget",
              spent: `${usd(day.remainingMicros)} left today`,
              ratio: day.limitMicros > 0 ? (day.usedMicros + day.reservedMicros) / day.limitMicros : 1,
              lines: [
                { label: `Today of ${usd(day.limitMicros)}`, value: `${usd(day.usedMicros)} used` },
                { label: "Held for open runs", value: usd(day.reservedMicros) },
                { label: `Month of ${usd(budget.month.limitMicros)}`, value: `${usd(budget.month.usedMicros)} used` },
              ],
            }
          : undefined
      }
      primaryAction={{ href: "/imports", label: "Import" }}
    >
      <div className="flex h-12 items-center gap-2 border-b border-border bg-background/95 px-4 sm:px-6">
        <form onSubmit={submit} role="search" className="relative min-w-0 flex-1 sm:max-w-md sm:flex-none sm:basis-96">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search your network"
            placeholder="Search your network"
            className="h-10 w-full rounded-md border border-border-strong bg-surface pl-8 pr-2.5 text-base text-foreground placeholder:text-muted-foreground/80 focus-visible:border-primary sm:h-8 sm:text-13"
          />
        </form>
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-auto grid size-10 shrink-0 place-items-center sm:size-8" aria-label="Account menu">
            <span className="grid size-8 place-items-center rounded-full border border-border bg-muted text-xs font-medium text-foreground">{initials(user.name)}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>
              <span className="block text-13 font-medium text-foreground">{user.name}</span>
              <span className="block font-normal">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/settings")}>
              <Settings /> Settings
            </DropdownMenuItem>
            {!demo && (
              <DropdownMenuItem onSelect={() => signOut()}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </AppShell>
  );
}
