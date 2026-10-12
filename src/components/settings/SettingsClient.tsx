"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageIntro, Stat } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { BudgetStatus } from "@/lib/budget";
import { num } from "@/lib/format";
import { usd } from "@/lib/money";
import type { Stats } from "@/lib/store/types";

/** Budget form plus a plain list of what is turned on. The per-run cap is shown but cannot be edited here. */
export function SettingsClient(props: { budget: BudgetStatus; demo: boolean; user: { email: string; name: string }; capMicros: number; maxPeople: number; enrichEnabled: boolean; allowCount: number; stats: Stats }) {
  const router = useRouter();
  const [daily, setDaily] = React.useState(String(props.budget.limits.dailyMicros / 1e6));
  const [monthly, setMonthly] = React.useState(String(props.budget.limits.monthlyMicros / 1e6));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyUsd: Number(daily), monthlyUsd: Number(monthly) }) });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(body?.error?.message ?? "Could not save.");
    toast.success("Budget saved");
    router.refresh();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
      <PageIntro title="Settings">What is on, what it may spend, and where your data lives.</PageIntro>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="People" value={num(props.stats.total)} hint={`${num(props.stats.with_email)} with an email`} />
        <Stat label="Companies" value={num(props.stats.companies)} />
        <Stat label="Enriched" value={num(props.stats.enriched)} hint="through looot, paid" />
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4" aria-label="Spending">
        <h2 className="text-sm font-semibold">Enrichment budget</h2>
        <p className="mt-1 text-13 text-muted-foreground">The most paid lookups may spend in a day and in a month, for your whole workspace. Each call reserves its list price before it runs, so two runs started together cannot both pass.</p>
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Daily budget, USD" htmlFor="daily"><Input id="daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} disabled={props.demo} /></Field>
          <Field label="Monthly budget, USD" htmlFor="monthly"><Input id="monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={props.demo} /></Field>
          <Button type="submit" variant="primary" disabled={busy || props.demo}>Save</Button>
        </form>
        {props.demo && <p className="mt-2 text-xs text-muted-foreground">The demo has no budget to change.</p>}
        {error && <p role="alert" className="mt-2 text-13 text-danger">{error}</p>}
        <p className="tnum mt-3 text-13 text-muted-foreground">Today: {usd(props.budget.day.usedMicros)} used, {usd(props.budget.day.reservedMicros)} held, {usd(props.budget.day.remainingMicros)} left. Month: {usd(props.budget.month.usedMicros)} used, {usd(props.budget.month.remainingMicros)} left.{props.budget.isDefault ? " These are the defaults." : ""}</p>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4" aria-label="Server settings">
        <h2 className="text-sm font-semibold">Set on the server</h2>
        <p className="mt-1 text-13 text-muted-foreground">These come from environment variables. The browser cannot change them, so a page or a request cannot raise a limit.</p>
        <dl className="mt-3 grid gap-2 text-13">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2"><dt>Paid enrichment</dt><dd>{props.enrichEnabled ? <Badge tone="positive">on</Badge> : <Badge tone="muted">off</Badge>}</dd></div>
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2"><dt>Per-run cap <span className="font-mono text-xs text-muted-foreground">LOOOT_NETWORK_CAP_USD</span></dt><dd className="tnum">{usd(props.capMicros)}</dd></div>
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2"><dt>People per run <span className="font-mono text-xs text-muted-foreground">LOOOT_NETWORK_MAX_PEOPLE</span></dt><dd className="tnum">{num(props.maxPeople)}</dd></div>
          <div className="flex items-center justify-between gap-2"><dt>Who may sign in <span className="font-mono text-xs text-muted-foreground">LOOOT_NETWORK_ALLOWED_EMAILS</span></dt><dd className="tnum">{props.demo ? "Demo, no sign-in" : `${props.allowCount} entr${props.allowCount === 1 ? "y" : "ies"}`}</dd></div>
        </dl>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4" aria-label="Privacy">
        <h2 className="text-sm font-semibold">Where your data lives</h2>
        <p className="mt-1 text-13 text-muted-foreground">Your people live in your own Supabase project, behind row-level security: each row belongs to one signed-in owner. This app has no database of its own and sends nothing to looot unless you run a paid lookup, and then only the LinkedIn URL or company domain that lookup needs. You are signed in as {props.demo ? "the demo user" : props.user.email}.</p>
      </section>
    </div>
  );
}
