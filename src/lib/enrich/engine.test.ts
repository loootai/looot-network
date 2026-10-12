import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Budget } from "../budget";
import { LoootError, type LoootRun, type Runner } from "../looot";
import type { Person } from "../types";
import { applyFacts, buildQuote, needsFor, runEnrich } from "./engine";
import { ENRICH, FALLBACK_PRICES, idempotencyKey, planFor } from "./providers";

const person = (o: Partial<Person> & { id: string }): Person => ({
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", full_name: o.id, first_name: null, last_name: null, email: null, emails: [], phones: [], linkedin_url: null, x_url: null, company: null, company_domain: null, title: null, location: null, headline: null, notes: null, tags: [], connected_on: null, source_kinds: ["linkedin"], enriched: {}, enriched_at: null, ...o,
});
const A = person({ id: "a", linkedin_url: "https://www.linkedin.com/in/a", company_domain: "acme.example.com" });
const B = person({ id: "b", linkedin_url: "https://www.linkedin.com/in/b", company_domain: "acme.example.com", emails: ["b@acme.example.com"], email: "b@acme.example.com" });
const C = person({ id: "c", full_name: "No Links" });
const now = new Date("2026-10-12T09:00:00Z");
const ok = (cost: number, result: unknown = {}): LoootRun => ({ runId: `run_${Math.random().toString(36).slice(2, 8)}`, status: "completed", actualCost: cost, result });
const prices = FALLBACK_PRICES;
const base = { prices, now, kinds: ["profile", "company", "email"] as const };

let dir: string;
let ledger: Budget;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "network-budget-"));
  ledger = new Budget(join(dir, "budget.json"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("quote", () => {
  it("counts calls per kind, shares the company call by domain, and says why people are left out", () => {
    const q = buildQuote([A, B, C], ["profile", "company", "email"], prices);
    const line = (k: string) => q.lines.find((l) => l.kind === k)!;
    expect(line("profile").calls).toBe(2);
    expect(line("company").calls).toBe(1);
    expect(line("email").calls).toBe(1);
    expect(line("email").skipped).toEqual({ has_email: 1, no_linkedin: 1 });
    expect(line("profile").skipped).toEqual({ no_linkedin: 1 });
    expect(q.totalMicros).toBe(2 * 1200 + 1900 + 3598);
  });
  it("makes no call and skips people who are already enriched", () => {
    const done = person({ ...A, enriched: { profile: { at: "x" } } });
    expect(buildQuote([done], ["profile"], prices).lines[0].calls).toBe(0);
    expect(planFor(done, "profile")).toEqual({ skip: "done" });
  });
  it("uses the work-email domain when no company domain is stored, and ignores gmail", () => {
    expect(planFor(person({ id: "x", emails: ["x@startup.example.com"] }), "company")).toEqual({ input: { email: "info@startup.example.com" }, target: "startup.example.com" });
    expect(planFor(person({ id: "y", emails: ["y@gmail.com"] }), "company")).toEqual({ skip: "no_domain" });
  });
});

describe("idempotency keys", () => {
  it("are stable per (person, job) and differ across jobs and people", () => {
    const k = (kind: "profile" | "email", p: Person) => idempotencyKey(kind, p, "t");
    expect(k("profile", A)).toBe(k("profile", A));
    expect(k("profile", A)).not.toBe(k("email", A));
    expect(k("profile", A)).not.toBe(k("profile", B));
  });
  it("key the company call by domain, so two colleagues share one call", () => {
    const { needs } = needsFor([A, B], ["company"]);
    expect(needs).toHaveLength(1);
    expect(needs[0].personIds).toEqual(["a", "b"]);
  });
});

describe("runEnrich", () => {
  it("pins the endpoint, sends the key and writes cost into the ledger", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => ok(0.0012, { location: "Paris, France" })) };
    const r = await runEnrich({ ...base, kinds: ["profile"], people: [A], looot, capMicros: 1_000_000, ledger });
    expect(looot.runAndWait).toHaveBeenCalledWith("anyapi-run-linkedin-profile-thin", { url: "https://www.linkedin.com/in/a" }, expect.stringMatching(/^network:v1:profile:[0-9a-f]{16}$/));
    expect(r.spentMicros).toBe(1200);
    expect(r.results[0].facts.profile?.location).toBe("Paris, France");
    expect((await ledger.status(now)).day.usedMicros).toBe(1200);
  });
  it("stops at the per-run cap before it calls", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => ok(0.0012)) };
    const r = await runEnrich({ ...base, kinds: ["profile"], people: [A, B], looot, capMicros: 1_500, ledger });
    expect(looot.runAndWait).toHaveBeenCalledTimes(1);
    expect(r.counts.skippedByCap).toBe(1);
  });
  it("leaves a run that is still going as pending, holds its money, and never records it failed at $0", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => ({ runId: "run_slow", status: "pending_provider" })) };
    const r = await runEnrich({ ...base, kinds: ["profile"], people: [A], looot, capMicros: 1_000_000, ledger });
    expect(r.results[0].status).toBe("pending");
    expect(r.counts).toMatchObject({ pending: 1, failed: 0 });
    const s = await ledger.status(now);
    expect(s.day.reservedMicros).toBe(1200);
    expect(s.day.usedMicros).toBe(0);
  });
  it("answers a repeated call from the stored result with no second call", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => ok(0.0012, { location: "Paris" })) };
    await runEnrich({ ...base, kinds: ["profile"], people: [A], looot, capMicros: 1_000_000, ledger });
    const again = await runEnrich({ ...base, kinds: ["profile"], people: [A], looot, capMicros: 1_000_000, ledger });
    expect(looot.runAndWait).toHaveBeenCalledTimes(1);
    expect(again.counts.replayed).toBe(1);
    expect(again.results[0].facts.profile?.location).toBe("Paris");
    expect(again.spentMicros).toBe(0);
  });
  it("refuses a call the period budget cannot cover, and names the period and the numbers", async () => {
    await ledger.setLimits({ dailyMicros: 2_000, monthlyMicros: 50_000 });
    const looot: Runner = { runAndWait: vi.fn(async () => ok(0.0012)) };
    const r = await runEnrich({ ...base, kinds: ["profile"], people: [A, B], looot, capMicros: 1_000_000, ledger });
    expect(looot.runAndWait).toHaveBeenCalledTimes(1);
    expect(r.counts.skippedByBudget).toBe(1);
    expect(r.budgetMessage).toMatch(/daily budget is reached/);
  });
  it("two runs started together cannot both pass the budget", async () => {
    await ledger.setLimits({ dailyMicros: 1_500, monthlyMicros: 50_000 });
    const slow: Runner = { runAndWait: async () => { await new Promise((r) => setTimeout(r, 20)); return ok(0.0012); } };
    const [r1, r2] = await Promise.all([
      runEnrich({ ...base, kinds: ["profile"], people: [A], looot: slow, capMicros: 1_000_000, ledger }),
      runEnrich({ ...base, kinds: ["profile"], people: [B], looot: slow, capMicros: 1_000_000, ledger }),
    ]);
    expect([r1.counts.ok, r2.counts.ok].sort()).toEqual([0, 1]);
    expect(r1.counts.skippedByBudget + r2.counts.skippedByBudget).toBe(1);
  });
  it("stops everything after a 401 and gives the reservation back", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => { throw new LoootError("Bad token", 401, "unauthorized"); }) };
    const r = await runEnrich({ ...base, kinds: ["profile"], people: [A, B], looot, capMicros: 1_000_000, ledger, concurrency: 1 });
    expect(r.aborted).toMatch(/Bad token/);
    expect(looot.runAndWait).toHaveBeenCalledTimes(1);
    expect((await ledger.status(now)).day.reservedMicros).toBe(0);
  });
  it("keeps the reservation after a network error, because the request may have reached looot", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => { throw new TypeError("fetch failed"); }) };
    const r = await runEnrich({ ...base, kinds: ["profile"], people: [A], looot, capMicros: 1_000_000, ledger });
    expect(r.results[0]).toMatchObject({ status: "failed", errorCode: "network_error" });
    expect((await ledger.status(now)).day.reservedMicros).toBe(1200);
  });
  it("makes no call and spends nothing in demo mode", async () => {
    const looot: Runner = { runAndWait: vi.fn(async () => ok(0.5)) };
    const r = await runEnrich({ ...base, kinds: ["profile"], people: [A], looot, capMicros: 1, ledger, demo: true });
    expect(r.spentMicros).toBe(0);
    expect((await ledger.status(now)).day.usedMicros).toBe(0);
  });
  it("calls the apply hook after every call", async () => {
    const seen: string[] = [];
    await runEnrich({ ...base, kinds: ["profile", "email"], people: [A], looot: { runAndWait: async () => ok(0.001, { email: "a@acme.example.com" }) }, capMicros: 1_000_000, ledger, apply: async (r) => void seen.push(r.need.kind) });
    expect(seen.sort()).toEqual(["email", "profile"]);
  });
});

describe("parsers", () => {
  it("read the fields they know and nothing else", () => {
    expect(ENRICH.profile.parse({ data: { headline: "CTO at Acme", location: "Paris, France", experience: [{ company: "Acme", title: "CTO", end: null }] } })).toEqual({ profile: { title: "CTO", company: "Acme", location: "Paris, France", headline: "CTO at Acme" } });
    expect(ENRICH.company.parse({ industryMain: "Fintech", totalEmployees: 120, countryCode: "FR" })).toEqual({ company: { industry: "Fintech", employees: 120, country: "FR" } });
    expect(ENRICH.email.parse({ email: "Ada@acme.example.com" })).toEqual({ email: { email: "ada@acme.example.com" } });
    expect(ENRICH.email.parse({ email: "not an email" })).toEqual({});
    expect(ENRICH.profile.parse({})).toEqual({});
  });
});

describe("applyFacts", () => {
  const result = (kind: "profile" | "email", facts: object) => ({ need: { kind, key: "k", target: "t", input: {}, personIds: ["a"] }, status: "ok" as const, listPriceMicros: 1, costMicros: 1, runId: "r1", facts, replayed: false });
  it("fills empty fields only and records where each fact came from", () => {
    const p = person({ id: "a", title: "Founder", company: null });
    const patch = applyFacts(p, result("profile", { profile: { title: "CTO", company: "Acme", location: "Paris" } }), "2026-10-12T09:00:00Z")!;
    expect(patch).toMatchObject({ company: "Acme", location: "Paris", enriched_at: "2026-10-12T09:00:00Z" });
    expect(patch.title).toBeUndefined();
    expect(patch.enriched?.profile).toMatchObject({ title: "CTO", runId: "r1" });
  });
  it("adds a found email and keeps the first email primary", () => {
    const p = person({ id: "a", emails: ["old@x.example.com"], email: "old@x.example.com" });
    const patch = applyFacts(p, result("email", { email: { email: "new@x.example.com" } }), "t")!;
    expect(patch.emails).toEqual(["old@x.example.com", "new@x.example.com"]);
    expect(patch.email).toBe("old@x.example.com");
  });
  it("marks a call that found nothing as done, so it is not paid for twice", () => {
    expect(applyFacts(person({ id: "a" }), result("profile", {}), "t")!.enriched?.profile).toBeTruthy();
  });
  it("writes nothing for a failed call", () => {
    expect(applyFacts(person({ id: "a" }), { ...result("profile", {}), status: "failed" as never }, "t")).toBeNull();
  });
});
