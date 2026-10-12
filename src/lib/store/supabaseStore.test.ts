import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { specFrom } from "../search/spec";
import { SupabaseBudget, SupabaseStore } from "./supabaseStore";

const now = new Date("2026-10-12T09:00:00Z");
type Call = { fn: string; args: unknown };

/** A stand-in for the Supabase client that records calls and answers rpc by name. The SQL itself is checked by scripts/test-sql.sh. */
function fakeDb(rpcs: Record<string, unknown>, rows: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  const db = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: rpcs[fn] ?? null, error: null };
    }),
    from: (table: string) => {
      const q = {
        select: () => q,
        in: (_c: string, ids: string[]) => ({ then: (ok: (v: unknown) => void) => ok({ data: (rows[table] ?? []).filter((r) => ids.includes((r as { id: string }).id)), error: null }) }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("SupabaseBudget", () => {
  it("sends the key, the amount in micros and the period starts, and returns shared or refused as the ledger expects", async () => {
    const { db, calls } = fakeDb({ reserve_budget: { ok: true, shared: false } });
    const b = new SupabaseBudget(db);
    expect(await b.reserve("k1", 1200, now, "fp")).toEqual({ ok: true, shared: false });
    expect(calls[0]).toEqual({ fn: "reserve_budget", args: { p_key: "k1", p_amount: 1200, p_fingerprint: "fp", p_day_start: "2026-10-12T00:00:00.000Z", p_month_start: "2026-10-01T00:00:00.000Z" } });
  });
  it("turns a refused reservation into a message that names the period and the numbers", async () => {
    const { db } = fakeDb({ reserve_budget: { ok: false, scope: "daily", daily: { budget: 5000000, used: 4000000, reserved: 900000 }, monthly: { budget: 25000000, used: 0, reserved: 0 } } });
    const r = await new SupabaseBudget(db).reserve("k", 500000, now);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("daily budget is reached: $4.00 used and $0.90 reserved of $5.00. This call needs $0.50") });
  });
  it("settles with the real cost and the finished run, and releases without a cost", async () => {
    const { db, calls } = fakeDb({});
    const b = new SupabaseBudget(db);
    await b.settle("k", "fp", 900, now, { runId: "r1", status: "completed" });
    await b.release("k");
    expect(calls[0]).toEqual({ fn: "settle_reservation", args: { p_key: "k", p_cost: 900, p_now: now.toISOString(), p_run: { runId: "r1", status: "completed" } } });
    expect(calls[1].fn).toBe("release_reservation");
  });
  it("throws when the database refuses, so a run never goes ahead unreserved", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as unknown as SupabaseClient;
    await expect(new SupabaseBudget(db).reserve("k", 1, now)).rejects.toThrow(/reserve budget: boom/);
  });
});

describe("SupabaseStore", () => {
  it("passes only parameters to search_people and keeps the order the database ranked", async () => {
    const person = (id: string) => ({ id, full_name: id, emails: [], phones: [], tags: [], source_kinds: [], enriched: null });
    const { db, calls } = fakeDb({ search_people: [{ id: "b", rank: 1, total: "2" }, { id: "a", rank: 0.5, total: "2" }] }, { people: [person("a"), person("b")] });
    const out = await new SupabaseStore(db).search(specFrom("founders in Paris'; drop table people; --", {}, { limit: 10 }));
    expect(out.total).toBe(2);
    expect(out.people.map((p) => p.id)).toEqual(["b", "a"]);
    expect(out.people[0].enriched).toEqual({});
    const args = calls[0].args as Record<string, unknown>;
    // The hostile text stays inside one parameter value. It is never part of SQL text.
    expect(args.p_locations).toEqual(["paris'; drop table people; --"]);
    expect(Object.keys(args).sort()).toEqual(["p_companies", "p_company_exact", "p_has_email", "p_has_linkedin", "p_limit", "p_locations", "p_name", "p_offset", "p_roles", "p_sort", "p_sources", "p_tags", "p_terms"]);
  });
  it("returns nothing without a second query when the database finds nothing", async () => {
    const { db } = fakeDb({ search_people: [] });
    expect(await new SupabaseStore(db).search(specFrom("zzz"))).toEqual({ people: [], total: 0 });
  });
});
