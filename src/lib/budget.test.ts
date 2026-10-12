import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";

const now = new Date("2026-10-12T09:00:00Z");
let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "network-budget-"));
  file = join(dir, "budget.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Budget", () => {
  it("starts at $5 a day and $25 a month, and the owner can change both", async () => {
    const b = new Budget(file);
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    expect(DEFAULT_LIMITS).toEqual({ dailyMicros: 5_000_000, monthlyMicros: 25_000_000 });
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 2_000_000 });
    expect((await new Budget(file).status(now)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 2_000_000 });
    await expect(b.setLimits({ dailyMicros: 3_000_000, monthlyMicros: 2_000_000 })).rejects.toThrow(/daily budget cannot be above/);
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 2_000_000 })).rejects.toThrow(/positive/);
  });
  it("reserves atomically: of five calls started together at most the budget gets through", async () => {
    const b = new Budget(file, { dailyMicros: 3_000, monthlyMicros: 100_000 });
    const out = await Promise.all([1, 2, 3, 4, 5].map((i) => b.reserve(`k${i}`, 1_000, now)));
    expect(out.filter((o) => o.ok)).toHaveLength(3);
    expect(out.find((o) => !o.ok)).toMatchObject({ ok: false, message: expect.stringMatching(/daily budget is reached: \$0\.00 used and \$0\.0030 reserved of \$0\.0030/) });
  });
  it("shares a reservation when the same key is asked for twice, and charges once", async () => {
    const b = new Budget(file);
    expect(await b.reserve("k", 1_200, now)).toEqual({ ok: true, shared: false });
    expect(await b.reserve("k", 1_200, now)).toEqual({ ok: true, shared: true });
    expect((await b.status(now)).day.reservedMicros).toBe(1_200);
  });
  it("settles to the real cost, stores the finished run and answers the same call later", async () => {
    const b = new Budget(file);
    await b.reserve("k", 1_200, now, "fp");
    await b.settle("k", "fp", 900, now, { runId: "r1", status: "completed", result: { a: 1 } });
    const s = await b.status(now);
    expect(s.day).toMatchObject({ usedMicros: 900, reservedMicros: 0 });
    expect((await b.recall("k", "fp", now))?.runId).toBe("r1");
    expect(await b.recall("k", "other-input", now)).toBeNull();
  });
  it("releases a call that did not run", async () => {
    const b = new Budget(file);
    await b.reserve("k", 1_200, now);
    await b.release("k");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
  it("collects a pending run once it ends, and never releases one it can still look up", async () => {
    const b = new Budget(file);
    await b.reserve("k", 1_200, now);
    await b.attach("k", "run_9");
    const later = new Date(now.getTime() + RESERVE_TTL_MS + 1);
    await b.reconcile({ getRun: async () => ({ runId: "run_9", status: "running" }) }, later);
    expect((await b.status(later)).day.reservedMicros).toBe(1_200);
    await b.reconcile({ getRun: async () => ({ runId: "run_9", status: "completed", actualCost: 0.0011, result: {} }) }, later);
    const s = await b.status(later);
    expect(s.day).toMatchObject({ reservedMicros: 0, usedMicros: 1_100 });
  });
  it("releases a call with no run id only after the hard expiry", async () => {
    const b = new Budget(file);
    await b.reserve("k", 1_200, now);
    await b.reconcile({ getRun: async () => { throw new Error("no"); } }, new Date(now.getTime() + HARD_EXPIRY_MS - 1000));
    expect((await b.status(now)).day.reservedMicros).toBe(1_200);
    await b.reconcile({ getRun: async () => { throw new Error("no"); } }, new Date(now.getTime() + HARD_EXPIRY_MS + 1000));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
  it("counts the month across days but the day only once", async () => {
    const b = new Budget(file);
    const yesterday = new Date("2026-10-11T09:00:00Z");
    await b.reserve("a", 1_000, yesterday);
    await b.settle("a", "", 1_000, yesterday);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(0);
    expect(s.month.usedMicros).toBe(1_000);
  });
});

describe("money formatting", () => {
  it("never rounds a quote", async () => {
    const { usdPrecise, usd } = await import("./money");
    expect(usdPrecise(3_598)).toBe("$0.003598");
    expect(usdPrecise(1_200)).toBe("$0.0012");
    expect(usdPrecise(0)).toBe("$0.0000");
    expect(usdPrecise(2_500_000)).toBe("$2.50");
    expect(usd(5_000_000)).toBe("$5.00");
  });
});
