import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GranolaClient, GranolaApiError, importAttendees, planEnrichment, companyDomainOf } from "./index";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const eq = (a: unknown, b: unknown, m?: string) => expect(a, m).toBe(b);
const deq = (a: unknown, b: unknown) => expect(a).toEqual(b);
const rej = async (p: Promise<unknown>, check?: (e: unknown) => boolean) => {
  let err: unknown;
  try { await p; } catch (e) { err = e; }
  expect(err, "should reject").toBeDefined();
  if (check) expect(check(err)).toBe(true);
};

describe("granola client and importer (ported, mocked HTTP only)", () => {
  const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

  function mock(routes: (url: URL, init: RequestInit) => Response) {
    const calls: { url: URL; auth: string }[] = [];
    const fetchImpl = (async (input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return routes(url, init);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  const note2 = JSON.stringify({ ...JSON.parse(fx("note.json")), id: "not_2d3tmYTlCICgjy", created_at: "2026-02-01T10:00:00Z",
    calendar_event: { ...JSON.parse(fx("note.json")).calendar_event, scheduled_start_time: "2026-02-01T10:00:00Z" } });

  function routes(url: URL) {
    if (url.pathname === "/v1/notes") return json(url.searchParams.get("cursor") ? fx("list-page2.json") : fx("list-page1.json"));
    if (url.pathname.endsWith("not_1d3tmYTlCICgjy")) return json(fx("note.json"));
    if (url.pathname.endsWith("not_2d3tmYTlCICgjy")) return json(note2);
    return json("{}", 404);
  }

  it("client sends bearer key and follows cursor", async () => {
    const m = mock(routes);
    const c = new GranolaClient({ apiKey: "grn_test", fetchImpl: m.fetchImpl });
    const ids: string[] = [];
    for await (const n of c.iterateNotes()) ids.push(n.id);
    eq(ids.length, 3);
    eq(m.calls[0].auth, "Bearer grn_test");
    eq(m.calls[1].url.searchParams.get("cursor"), "abc");
    eq(m.calls[0].url.searchParams.get("page_size"), "30");
  });

  it("importer dedupes, skips self, free mail kept but no domain, skips deleted notes", async () => {
    const m = mock(routes);
    const c = new GranolaClient({ apiKey: "grn_test", fetchImpl: m.fetchImpl });
    const out = await importAttendees(c);
    const byEmail = Object.fromEntries(out.map((x) => [x.email, x]));
    eq(byEmail["oat@granola.example.com"], undefined, "owner excluded");
    eq(byEmail["jo@acme.example.com"].meetingCount, 2);
    eq(byEmail["jo@acme.example.com"].name, "Jo Smith");
    eq(byEmail["jo@acme.example.com"].companyDomain, "acme.example.com");
    eq(byEmail["jo@acme.example.com"].lastMeetingAt, "2026-02-01T10:00:00Z");
    eq(byEmail["friend@gmail.com"].companyDomain, null);
    eq(m.calls.filter((x) => x.url.pathname.includes("not_3d3")).length, 0, "deleted note not fetched");
    eq(m.calls.some((x) => x.url.searchParams.has("include")), false, "transcript never requested");
  });

  it("excludeDomains and selfEmails work", async () => {
    const c = new GranolaClient({ apiKey: "k", fetchImpl: mock(routes).fetchImpl });
    const out = await importAttendees(c, { excludeDomains: ["granola.example.com"], selfEmails: ["jo@acme.example.com"] });
    deq(out.map((x) => x.email), ["friend@gmail.com"]);
  });

  it("planEnrichment counts and lists domains, makes no calls", async () => {
    const c = new GranolaClient({ apiKey: "k", fetchImpl: mock(routes).fetchImpl });
    const plan = planEnrichment(await importAttendees(c));
    eq(plan.contacts, 3);
    eq(plan.freeMailContacts, 1);
    deq(plan.quoteRequest.companyLookups, ["acme.example.com", "granola.example.com"]);
  });

  it("401 throws without body, 429 retries then succeeds", async () => {
    const c401 = new GranolaClient({ apiKey: "bad", fetchImpl: mock(() => json('{"secret":"x"}', 401)).fetchImpl });
    await rej(c401.listNotes(), (e: unknown) => e instanceof GranolaApiError && e.status === 401 && !e.message.includes("secret"));
    let n = 0;
    const slept: number[] = [];
    const c = new GranolaClient({
      apiKey: "k", sleep: async (ms) => { slept.push(ms); },
      fetchImpl: mock(() => (n++ < 2 ? json("{}", 429) : json(fx("list-page2.json")))).fetchImpl,
    });
    eq((await c.listNotes()).notes.length, 2);
    deq(slept, [500, 1000]);
  });

  it("bad note id rejected before any request; companyDomainOf edge cases", async () => {
    const m = mock(routes);
    const c = new GranolaClient({ apiKey: "k", fetchImpl: m.fetchImpl });
    await rej(c.getNote("../etc"));
    eq(m.calls.length, 0);
    eq(companyDomainOf("x"), null);
    eq(companyDomainOf("A@foo.example.com"), "foo.example.com");
  });
});
