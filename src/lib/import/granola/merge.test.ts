import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DemoBudget, MemoryStore } from "../../store/memoryStore";
import { parseImport } from "../parsers";
import { previewImport, runImport } from "../run";
import { DemoGranolaClient, GranolaClient, granolaToParseResult, importAttendees, nameFromEmail, readGranola } from "./index";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const res = (b: string) => new Response(b, { status: 200, headers: { "content-type": "application/json" } });
const fixtureClient = () =>
  new GranolaClient({
    apiKey: "grn_test",
    fetchImpl: (async (input: string) => {
      const u = new URL(input);
      if (u.pathname === "/v1/notes") return res(u.searchParams.get("cursor") ? fx("list-page2.json") : fx("list-page1.json"));
      const note = JSON.parse(fx("note.json"));
      if (u.pathname.endsWith("not_2d3tmYTlCICgjy")) return res(JSON.stringify({ ...note, id: "not_2d3tmYTlCICgjy", title: "Second call", created_at: "2026-02-01T10:00:00Z", calendar_event: { ...note.calendar_event, event_title: "Second call", scheduled_start_time: "2026-02-01T10:00:00Z" } }));
      return res(JSON.stringify(note));
    }) as unknown as typeof fetch,
  });
const fresh = () => new MemoryStore({ demo: true, budget: new DemoBudget() });

describe("granolaToParseResult", () => {
  it("maps attendees to people with source granola and the last-met date and title in raw", async () => {
    const parsed = await readGranola(fixtureClient());
    expect(parsed.source).toBe("granola");
    const jo = parsed.people.find((p) => p.emails[0] === "jo@acme.example.com")!;
    expect(jo).toMatchObject({ full_name: "Jo Smith", source: "granola", company_domain: "acme.example.com", tags: ["granola"] });
    expect(jo.raw["Last met"]).toBe("2026-02-01");
    expect(jo.raw["Meeting title"]).toBe("Second call");
    expect(jo.raw.Meetings).toBe("2");
  });
  it("names an invitee who has no name from the email, and leaves free mail without a company domain", () => {
    expect(nameFromEmail("priya.raman@tidemark.example.com")).toBe("Priya Raman");
    const p = granolaToParseResult([{ email: "x@gmail.com", name: null, companyDomain: null, meetingCount: 1, firstMeetingAt: "2026-01-01T00:00:00Z", lastMeetingAt: "2026-01-01T00:00:00Z", lastMeetingTitle: null, noteIds: ["not_a"], source: "granola" }]);
    expect(p.people[0].company_domain).toBeUndefined();
    expect(p.people[0].full_name).toBe("X");
  });
  it("keeps the title of the most recent meeting, whatever order notes arrive in", async () => {
    const out = await importAttendees(fixtureClient());
    expect(out.find((c) => c.email === "jo@acme.example.com")!.lastMeetingTitle).toBe("Second call");
  });
});

describe("granola through the same merge path as the CSV sources", () => {
  const csv = "Name,Email,Company,Title\nJo Smith,jo@acme.example.com,Acme Inc,CTO\n";

  it("merges into a person a CSV already added: nothing is overwritten, source and provenance are added", async () => {
    const store = fresh();
    await runImport(store, parseImport(csv), "people.csv");
    const parsed = await readGranola(fixtureClient());
    const { preview } = await previewImport(store, parsed);
    expect(preview.merged).toBe(1);
    expect(preview.added).toBe(parsed.people.length - 1);
    const sum = await runImport(store, parsed, "Granola meetings");
    expect(sum.added).toBe(parsed.people.length - 1);
    const jo = store.people.filter((p) => p.emails.includes("jo@acme.example.com"));
    expect(jo).toHaveLength(1);
    expect(jo[0]).toMatchObject({ company: "Acme Inc", title: "CTO" });
    expect(jo[0].source_kinds).toEqual(["csv", "granola"]);
    const detail = (await store.getDetail(jo[0].id))!;
    const g = detail.sources.find((s) => s.source === "granola")!;
    expect(g.raw["Meeting title"]).toBe("Second call");
    expect(g.raw["Last met"]).toBe("2026-02-01");
  });

  it("importing the same meetings twice adds nobody", async () => {
    const store = fresh();
    await runImport(store, await readGranola(fixtureClient()), "Granola meetings");
    const n = store.people.length;
    const again = await runImport(store, await readGranola(fixtureClient()), "Granola meetings");
    expect(again.added).toBe(0);
    expect(store.people).toHaveLength(n);
  });

  it("a dry run (preview) writes nothing", async () => {
    const store = fresh();
    const { preview } = await previewImport(store, await readGranola(fixtureClient()));
    expect(preview.added).toBeGreaterThan(0);
    expect(store.people).toHaveLength(0);
    expect(store.imports).toHaveLength(0);
  });

  it("the demo client yields new people and ones already in the network", async () => {
    const store = fresh();
    await runImport(store, parseImport("Name,Email,Company\nAda Known,ada@known.example.com,Known\n"), "k.csv");
    const parsed = await readGranola(new DemoGranolaClient([{ name: "Ada Known", email: "ada@known.example.com" }]));
    const { preview } = await previewImport(store, parsed);
    expect(preview.merged).toBe(1);
    expect(preview.added).toBe(3);
  });
});
