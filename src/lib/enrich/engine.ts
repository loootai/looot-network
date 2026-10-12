import type { Ledger } from "../budget";
import { LoootError, type LoootRun, type PriceMap, type Runner } from "../looot";
import { toMicros } from "../money";
import type { EnrichKind, Person } from "../types";
import { callFingerprint, ENRICH, idempotencyKey, KINDS, planFor, SKIP_TEXT, type Facts, type SkipReason } from "./providers";

export interface QuoteLine {
  kind: EnrichKind;
  label: string;
  provider: string;
  jobId: string;
  endpointId: string;
  /** Calls that would be made. Company calls are counted once per domain. */
  calls: number;
  priceMicros: number;
  totalMicros: number;
  /** People left out and why. */
  skipped: Partial<Record<SkipReason, number>>;
}

export interface Quote {
  lines: QuoteLine[];
  people: number;
  totalMicros: number;
  priceSource: "catalog" | "fallback";
}

/** One call to make: a person (or the first person at a domain) and what to send. */
export interface Need {
  kind: EnrichKind;
  key: string;
  target: string;
  input: Record<string, unknown>;
  /** Everyone this call answers. One person for profile and email, everyone at the domain for company. */
  personIds: string[];
}

/** The calls a run would make for these people and kinds. */
export function needsFor(people: Person[], kinds: EnrichKind[]): { needs: Need[]; skipped: Record<EnrichKind, Partial<Record<SkipReason, number>>> } {
  const needs: Need[] = [];
  const skipped = Object.fromEntries(KINDS.map((k) => [k, {}])) as Record<EnrichKind, Partial<Record<SkipReason, number>>>;
  const byKey = new Map<string, Need>();
  for (const kind of KINDS.filter((k) => kinds.includes(k))) {
    for (const p of people) {
      const plan = planFor(p, kind);
      if ("skip" in plan) {
        skipped[kind][plan.skip] = (skipped[kind][plan.skip] ?? 0) + 1;
        continue;
      }
      const key = idempotencyKey(kind, p, plan.target);
      const hit = byKey.get(key);
      if (hit) hit.personIds.push(p.id);
      else {
        const n: Need = { kind, key, target: plan.target, input: plan.input, personIds: [p.id] };
        byKey.set(key, n);
        needs.push(n);
      }
    }
  }
  return { needs, skipped };
}

/** What a run costs at list price. Pure: no call is made. */
export function buildQuote(people: Person[], kinds: EnrichKind[], prices: PriceMap, priceSource: Quote["priceSource"] = "catalog"): Quote {
  const { needs, skipped } = needsFor(people, kinds);
  const lines: QuoteLine[] = KINDS.filter((k) => kinds.includes(k)).map((k) => {
    const d = ENRICH[k];
    const calls = needs.filter((n) => n.kind === k).length;
    const priceMicros = prices[d.endpointId] ?? d.fallbackMicros;
    return { kind: k, label: d.label, provider: d.provider, jobId: d.jobId, endpointId: d.endpointId, calls, priceMicros, totalMicros: priceMicros * calls, skipped: skipped[k] };
  });
  return { lines, people: people.length, totalMicros: lines.reduce((n, l) => n + l.totalMicros, 0), priceSource };
}

export type CallStatus = "ok" | "pending" | "failed" | "skipped_cap" | "skipped_budget" | "skipped_price" | "parse_error";

/** The outcome of one call, passed to `apply` as soon as it ends so progress is saved even if the process stops. */
export interface CallResult {
  need: Need;
  status: CallStatus;
  listPriceMicros: number;
  costMicros: number;
  runId?: string;
  facts: Facts;
  message?: string;
  errorCode?: string;
  /** true when the answer came from a stored result and no call was made. */
  replayed: boolean;
}

export interface RunOptions {
  people: Person[];
  kinds: EnrichKind[];
  looot: Runner;
  prices: PriceMap;
  priceSource?: Quote["priceSource"];
  /** Endpoints whose live price could not be read. They are not called. */
  unpriced?: readonly string[];
  /** The per-run cap in micro-dollars. Comes from server config, never from the request. */
  capMicros: number;
  /** Period budget, reservations and stored answers. Left out in demo mode. */
  ledger?: Ledger;
  now?: Date;
  demo?: boolean;
  /** Called after each call ends. */
  apply?: (r: CallResult) => Promise<void>;
  concurrency?: number;
}

export interface RunSummary {
  quote: Quote;
  capMicros: number;
  quotedMicros: number;
  spentMicros: number;
  results: CallResult[];
  counts: { ok: number; pending: number; failed: number; skippedByCap: number; skippedByBudget: number; replayed: number };
  budgetMessage: string | null;
  aborted: string | null;
  demo: boolean;
}

const FAIL_STOPS = new Set(["unauthorized", "insufficient_funds", "payment_required", "invalid_token", "missing_token"]);

/**
 * Enriches the people through looot. Order for each call: stored answer (free), per-run cap, period budget
 * reservation, then the call. The cap is checked against list prices, so the run cannot commit more than it. A call
 * still running when waiting stops is "pending" with its reservation held, never a failure at $0.
 */
export async function runEnrich(opts: RunOptions): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const quote = buildQuote(opts.people, opts.kinds, opts.prices, opts.priceSource);
  const { needs } = needsFor(opts.people, opts.kinds);
  const unpriced = new Set(opts.unpriced ?? []);
  const ledger = opts.demo ? undefined : opts.ledger;
  let committed = 0;
  let spent = 0;
  let budgetMessage: string | null = null;
  let aborted: string | null = null;
  const results: CallResult[] = [];

  async function execute(need: Need): Promise<CallResult> {
    const def = ENRICH[need.kind];
    const listPriceMicros = opts.prices[def.endpointId] ?? def.fallbackMicros;
    const base = { need, listPriceMicros, costMicros: 0, facts: {} as Facts, replayed: false };
    if (aborted) return { ...base, status: "skipped_cap", message: aborted };
    if (!opts.demo && unpriced.has(def.endpointId)) return { ...base, status: "skipped_price", message: "Live price could not be read." };
    // The cap is checked and the list price is committed in one synchronous step, so calls that start together
    // cannot all pass the check before any of them counts.
    const counted = !opts.demo;
    if (counted && committed + listPriceMicros > opts.capMicros) return { ...base, status: "skipped_cap", message: "Per-run cap reached." };
    if (counted) committed += listPriceMicros;
    const fp = callFingerprint(def.endpointId, need.input);
    if (ledger) {
      const stored = await ledger.recall(need.key, fp, now);
      if (stored) {
        try {
          const facts = def.parse(stored.result);
          if (counted) committed -= listPriceMicros;
          return { ...base, status: "ok", runId: stored.runId, facts, message: "Answered from the stored result. No call, no charge.", replayed: true };
        } catch {
          // A stored result that no longer parses is called again. The same key replays it at looot with no second charge.
        }
      }
      const held = await ledger.reserve(need.key, listPriceMicros, now, fp);
      if (!held.ok) {
        if (counted) committed -= listPriceMicros;
        budgetMessage = held.message;
        return { ...base, status: "skipped_budget", message: held.message };
      }
    }
    try {
      const run: LoootRun = await opts.looot.runAndWait(def.endpointId, need.input, need.key);
      const cost = opts.demo ? 0 : toMicros(run.actualCost);
      if (run.status === "completed") {
        committed += cost - listPriceMicros;
        spent += cost;
        await ledger?.settle(need.key, fp, cost, now, run);
        try {
          return { ...base, status: "ok", costMicros: cost, runId: run.runId, facts: def.parse(run.result) };
        } catch (e) {
          return { ...base, status: "parse_error", costMicros: cost, runId: run.runId, message: (e as Error).message };
        }
      }
      if (run.status === "failed" || run.status === "blocked" || run.status === "stopped") {
        committed += cost - listPriceMicros;
        spent += cost;
        await ledger?.settle(need.key, fp, cost, now);
        return { ...base, status: "failed", costMicros: cost, runId: run.runId, errorCode: run.error?.code ?? run.status, message: run.error?.message };
      }
      // Still running at looot: the reservation stays until the run ends. It is never recorded as failed at $0.
      await ledger?.attach(need.key, run.runId);
      return { ...base, status: "pending", runId: run.runId, message: `Run ${run.runId} is ${run.status}. Run again later to collect it at no extra charge.` };
    } catch (e) {
      committed -= listPriceMicros;
      const err = e instanceof LoootError ? e : null;
      // An HTTP answer from looot means the call did not run, so the reservation goes back. A network error is unknown:
      // the request may have been accepted, so the reservation stays until the hard expiry or a replay settles it.
      if (err) await ledger?.release(need.key);
      if (err && (FAIL_STOPS.has(err.code ?? "") || err.status === 401 || err.status === 402)) aborted = `Stopped: ${err.message}`;
      return { ...base, status: "failed", errorCode: err?.code ?? "network_error", message: (e as Error).message };
    }
  }

  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= needs.length) return;
      const r = await execute(needs[i]);
      results.push(r);
      await opts.apply?.(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, Math.max(1, needs.length)) }, worker));

  const count = (s: CallStatus) => results.filter((r) => r.status === s).length;
  return {
    quote,
    capMicros: opts.capMicros,
    quotedMicros: quote.totalMicros,
    spentMicros: spent,
    results,
    counts: { ok: count("ok"), pending: count("pending"), failed: count("failed") + count("parse_error"), skippedByCap: count("skipped_cap"), skippedByBudget: count("skipped_budget"), replayed: results.filter((r) => r.replayed).length },
    budgetMessage,
    aborted,
    demo: opts.demo ?? false,
  };
}

/** Writes "no LinkedIn URL (3), already has an email (1)" for a quote line. */
export function skipText(skipped: QuoteLine["skipped"]): string {
  return (Object.entries(skipped) as [SkipReason, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${SKIP_TEXT[r]} (${n})`).join(", ");
}

/** The facts of a result as a patch for the stored person, plus the `enriched` record. Fills empty fields only. */
export function applyFacts(p: Person, r: CallResult, at: string): Partial<Person> | null {
  if (r.status !== "ok") return null;
  const patch: Partial<Person> = {};
  const enriched = { ...p.enriched };
  const f = r.facts;
  if (f.profile) {
    enriched.profile = { ...f.profile, at, runId: r.runId };
    if (f.profile.title && !p.title) patch.title = f.profile.title;
    if (f.profile.company && !p.company) patch.company = f.profile.company;
    if (f.profile.location && !p.location) patch.location = f.profile.location;
    if (f.profile.headline && !p.headline) patch.headline = f.profile.headline;
  }
  if (f.company) enriched.company = { ...f.company, domain: r.need.target, at, runId: r.runId };
  if (f.email) {
    enriched.email = { email: f.email.email, at, runId: r.runId };
    if (!p.emails.includes(f.email.email)) {
      patch.emails = [...p.emails, f.email.email];
      patch.email = p.email ?? f.email.email;
    }
  }
  // A call that found nothing still marks the person done, so it is not paid for again.
  if (!f.profile && r.need.kind === "profile") enriched.profile = { at, runId: r.runId };
  if (!f.company && r.need.kind === "company") enriched.company = { domain: r.need.target, at, runId: r.runId };
  if (!f.email && r.need.kind === "email") enriched.email = { email: "", at, runId: r.runId };
  patch.enriched = enriched;
  patch.enriched_at = at;
  return patch;
}
