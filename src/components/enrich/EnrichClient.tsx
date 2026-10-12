"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { PageIntro } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, Td, Th } from "@/components/ui/table";
import type { BudgetStatus } from "@/lib/budget";
import { num, relative } from "@/lib/format";
import { usd, usdPrecise } from "@/lib/money";
import type { EnrichmentRow } from "@/lib/store/types";
import type { EnrichKind } from "@/lib/types";

interface KindInfo {
  kind: EnrichKind;
  label: string;
  help: string;
  provider: string;
  jobId: string;
  endpointId: string;
  fallbackMicros: number;
  shapeVerified: boolean;
}

interface QuoteResponse {
  lines: { kind: EnrichKind; label: string; provider: string; jobId: string; calls: number; priceMicros: number; totalMicros: number; skippedText: string }[];
  people: number;
  totalMicros: number;
  priceSource: "catalog" | "fallback";
  capMicros: number;
  maxPeople: number;
  truncated: boolean;
  unread: string[];
  budget: BudgetStatus;
  enabled: boolean;
  demo: boolean;
}

interface RunResponse {
  demo: boolean;
  spentMicros: number;
  quotedMicros: number;
  counts: { ok: number; pending: number; failed: number; skippedByCap: number; skippedByBudget: number; replayed: number };
  budgetMessage: string | null;
  aborted: string | null;
}

/** Quote first, run second. The page never sends a spending limit: the cap and the budget come from the server. */
export function EnrichClient(props: { kinds: KindInfo[]; history: EnrichmentRow[]; budget: BudgetStatus; enabled: boolean; demo: boolean; capMicros: number; maxPeople: number; pricesAsOf: string; total: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [picked, setPicked] = React.useState<Set<EnrichKind>>(new Set(["profile"]));
  const [quote, setQuote] = React.useState<QuoteResponse | null>(null);
  const [busy, setBusy] = React.useState<"quote" | "run" | null>(null);
  const [result, setResult] = React.useState<RunResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fromSelection = sp.get("selection") === "1";
  // The selection made on the People page is kept in sessionStorage. The server render has none, so it reads null.
  const rawSelection = React.useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return sessionStorage.getItem("network:selection") ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => null,
  );
  const ids = React.useMemo<string[] | null>(() => {
    if (rawSelection === null) return null;
    try {
      return JSON.parse(rawSelection) as string[];
    } catch {
      return [];
    }
  }, [rawSelection]);

  const scope = React.useMemo(() => {
    if (fromSelection) return ids === null ? null : ids.length ? { ids } : null;
    const filters = { sources: sp.getAll("source"), tags: sp.getAll("tag"), hasEmail: sp.get("email") === "1" ? true : null, hasLinkedin: sp.get("linkedin") === "1" ? true : null, company: sp.get("company") };
    return { query: sp.get("q") ?? "", filters };
  }, [fromSelection, ids, sp]);

  const scopeText = fromSelection ? (ids === null ? "Reading your selection" : `${num(ids.length)} selected people`) : sp.get("q") || sp.toString() ? "The people your current search matches" : "Everyone in your network";

  const post = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kinds: [...picked], ...scope }) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.error?.message ?? "The server refused the request.");
    return body;
  };

  const getQuote = async () => {
    setBusy("quote");
    setError(null);
    setResult(null);
    try {
      setQuote((await post("/api/quote")) as QuoteResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("run");
    setError(null);
    try {
      const out = (await post("/api/enrich")) as RunResponse;
      setResult(out);
      toast.success(out.demo ? "Demo run finished. No call was made." : `Run finished: ${usdPrecise(out.spentMicros)} spent`);
      setQuote(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (k: EnrichKind) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setQuote(null);
  };

  const over = quote ? quote.totalMicros > quote.capMicros : false;
  const b = props.budget;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
      <PageIntro title="Enrich">Optional and paid. Each lookup goes through looot, one pinned endpoint per job, so the price you see is the price charged. A call that fails costs nothing. Nothing runs until you press Run.</PageIntro>

      {!props.enabled && (
        <div role="note" className="mb-4 flex gap-3 rounded-lg border border-border bg-surface p-4 text-13">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-medium">Enrichment is off</p>
            <p className="mt-0.5 text-muted-foreground">You can still get a quote. To run, the server needs <code className="font-mono text-xs">LOOOT_NETWORK_ENRICH=1</code> and a <code className="font-mono text-xs">LOOOT_TOKEN</code>. The token never reaches the browser.</p>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-4" aria-label="Choose lookups">
        <h2 className="text-sm font-semibold">1. Who and what</h2>
        <p className="mt-1 text-13 text-muted-foreground">{scopeText}. One run covers at most {num(props.maxPeople)} people.</p>
        <ul className="mt-3 grid gap-2">
          {props.kinds.map((k) => (
            <li key={k.kind} className="flex items-start gap-3 rounded-md border border-border p-3">
              <Checkbox id={`k-${k.kind}`} checked={picked.has(k.kind)} onCheckedChange={() => toggle(k.kind)} className="mt-0.5" />
              <label htmlFor={`k-${k.kind}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{k.label} <Badge tone="muted" className="font-mono">{usdPrecise(k.fallbackMicros)} per call</Badge></span>
                <span className="mt-0.5 block text-13 text-muted-foreground">{k.help}</span>
                <span className="mt-1 block text-xs text-muted-foreground">looot job <span className="font-mono">{k.jobId}</span>, endpoint <span className="font-mono">{k.endpointId}</span>, list price read {props.pricesAsOf}. {k.shapeVerified ? "" : "Response shape not yet checked against a live call."}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4"><Button variant="primary" onClick={getQuote} disabled={busy !== null || picked.size === 0 || scope === null}>{busy === "quote" ? <Loader2 className="animate-spin" /> : null} Get the quote</Button></div>
      </section>

      {error && <p role="alert" className="mt-3 rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-13 text-danger">{error}</p>}

      {quote && (
        <section className="mt-4 rounded-lg border border-border bg-surface p-4" aria-label="Quote">
          <h2 className="text-sm font-semibold">2. The price, before any call</h2>
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <Table>
              <thead><tr><Th>Lookup</Th><Th className="text-right">Calls</Th><Th className="text-right">Price per call</Th><Th className="text-right">Total</Th><Th>Left out</Th></tr></thead>
              <tbody>
                {quote.lines.map((l) => (
                  <tr key={l.kind}>
                    <Td className="font-medium">{l.label}<span className="block text-xs font-normal text-muted-foreground">{l.provider} via looot job {l.jobId}</span></Td>
                    <Td className="tnum text-right">{num(l.calls)}</Td>
                    <Td className="tnum text-right">{usdPrecise(l.priceMicros)}</Td>
                    <Td className="tnum text-right font-medium">{usdPrecise(l.totalMicros)}</Td>
                    <Td className="text-xs text-muted-foreground">{l.skippedText || "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-13 sm:grid-cols-2">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">People covered</dt><dd className="tnum">{num(quote.people)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Total at list price</dt><dd className="tnum text-base font-semibold">{usdPrecise(quote.totalMicros)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Per-run cap (set on the server)</dt><dd className="tnum">{usd(quote.capMicros)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Left today / this month</dt><dd className="tnum">{usd(quote.budget.day.remainingMicros)} / {usd(quote.budget.month.remainingMicros)}</dd></div>
          </dl>
          {quote.priceSource === "fallback" && !quote.demo && <p className="mt-2 text-13 text-warning">Live prices could not be read{quote.unread.length ? ` for ${quote.unread.join(", ")}` : ""}. Those calls will not run.</p>}
          {quote.truncated && <p className="mt-2 text-13 text-warning">More than {num(quote.maxPeople)} people match. The run covers the first {num(quote.maxPeople)}.</p>}
          {over && <p className="mt-2 text-13 text-warning">The total is above the per-run cap. The run stops when the cap is reached and leaves the rest. Run it again later for the remainder.</p>}
          {quote.totalMicros === 0 && <p className="mt-2 text-13 text-muted-foreground">Nothing to look up for these people.</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={run} disabled={busy !== null || !quote.enabled || quote.totalMicros === 0}>{busy === "run" ? <Loader2 className="animate-spin" /> : null} {quote.demo ? "Run (demo, no charge)" : `Run for up to ${usdPrecise(Math.min(quote.totalMicros, quote.capMicros))}`}</Button>
            {!quote.enabled && <span className="text-13 text-muted-foreground">Enrichment is off on this server.</span>}
          </div>
        </section>
      )}

      {result && (
        <section className="mt-4 rounded-lg border border-border bg-surface p-4" aria-label="Run result" aria-live="polite">
          <h2 className="text-sm font-semibold">{result.demo ? "Demo run finished" : "Run finished"}</h2>
          <p className="mt-1 text-13">Spent <strong className="tnum">{usdPrecise(result.spentMicros)}</strong> of {usdPrecise(result.quotedMicros)} quoted. {result.counts.ok} found, {result.counts.replayed} answered from a stored result, {result.counts.failed} failed, {result.counts.pending} still running.</p>
          {result.counts.pending > 0 && <p className="mt-1 text-13 text-muted-foreground">A run that is still going is not a failure. Its money is held. Run the same lookup again later to collect it at no extra charge.</p>}
          {(result.counts.skippedByCap > 0 || result.counts.skippedByBudget > 0) && <p className="mt-1 text-13 text-warning">{result.budgetMessage ?? `${result.counts.skippedByCap} calls were left because the per-run cap was reached.`}</p>}
          {result.aborted && <p className="mt-1 text-13 text-danger">{result.aborted}</p>}
        </section>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold">Budget</h2>
      <p className="text-13 text-muted-foreground">Today {usd(b.day.usedMicros)} used of {usd(b.day.limitMicros)}, {usd(b.day.reservedMicros)} held for open runs. This month {usd(b.month.usedMicros)} of {usd(b.month.limitMicros)}. A run reserves its list price first, so two runs started together cannot both pass. Change the budget in Settings.</p>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Recent calls</h2>
      {props.history.length === 0 ? (
        <p className="text-13 text-muted-foreground">No paid calls yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <Table>
            <thead><tr><Th>When</Th><Th>Lookup</Th><Th>Status</Th><Th className="text-right">List price</Th><Th className="text-right">Charged</Th><Th>Note</Th></tr></thead>
            <tbody>
              {props.history.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">{relative(h.created_at)}</Td>
                  <Td>{h.kind}</Td>
                  <Td><Badge tone={h.status === "ok" ? "positive" : h.status === "pending" ? "warning" : h.status === "failed" ? "danger" : "muted"}>{h.status}</Badge></Td>
                  <Td className="tnum text-right">{usdPrecise(h.list_price_micros)}</Td>
                  <Td className="tnum text-right">{usdPrecise(h.cost_micros)}</Td>
                  <Td className="max-w-64 truncate text-xs text-muted-foreground">{h.message ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
