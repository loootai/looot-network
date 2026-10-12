import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBudget, MemoryStore } from "@/lib/store/memoryStore";
import { routeMap, PUBLIC_ROUTES } from "@/test/routeMap";

let store: MemoryStore;
vi.mock("@/lib/server", async (orig) => {
  const real = await orig<typeof import("@/lib/server")>();
  return { ...real, sessionOr401: async () => ({ store, user: { id: "u1", email: "owner@acme.example", name: "Owner" } }) };
});

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/import/granola", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
};
const note = JSON.stringify({ id: "not_1d3tmYTlCICgjy", object: "note", title: "Kickoff", owner: { name: "Me", email: "me@mine.example" }, created_at: "2026-03-01T10:00:00Z", updated_at: "2026-03-01T10:00:00Z", deleted_at: null, web_url: "u", calendar_event: { event_title: "Kickoff", invitees: [], organiser: null, calendar_event_id: null, scheduled_start_time: "2026-03-01T10:00:00Z", scheduled_end_time: null }, attendees: [{ name: "Sam Lee", email: "sam@other.example" }], summary_text: "", summary_markdown: null, private_notes_text: null, transcript: null });
const list = JSON.stringify({ notes: [{ id: "not_1d3tmYTlCICgjy", object: "note", title: "Kickoff", owner: { name: "Me", email: "me@mine.example" }, created_at: "2026-03-01T10:00:00Z", updated_at: "2026-03-01T10:00:00Z", deleted_at: null }], hasMore: false, cursor: null });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEMO", "");
  vi.stubEnv("SPEND_RATE_LIMIT_PER_MIN", "1000");
  store = new MemoryStore({ demo: false, budget: new DemoBudget() });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/import/granola", () => {
  it("is a private route the gate test covers", () => {
    const r = routeMap().find((x) => x.url === "/api/import/granola");
    expect(r?.methods).toEqual(["POST"]);
    expect(PUBLIC_ROUTES).not.toContain("/api/import/granola");
  });

  it("answers 409 and calls nobody when GRANOLA_API_KEY is not set", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post({});
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("granola_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the key from the server environment and ignores any key in the body", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "grn_server_key");
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).Authorization);
      return new Response(new URL(url).pathname === "/v1/notes" ? list : note, { status: 200 });
    });
    const res = await post({ apiKey: "grn_from_client", GRANOLA_API_KEY: "grn_from_client" });
    expect(res.status).toBe(200);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(["Bearer grn_server_key"]));
    expect(JSON.stringify(await res.clone().json())).not.toContain("grn_");
    expect(store.people.map((p) => p.emails[0])).toEqual(["sam@other.example"]);
    expect(store.people[0].source_kinds).toEqual(["granola"]);
  });

  it("dryRun counts and writes nothing", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "grn_server_key");
    vi.stubGlobal("fetch", async (url: string) => new Response(new URL(url).pathname === "/v1/notes" ? list : note, { status: 200 }));
    const res = await post({ dryRun: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ dryRun: true, added: 1 });
    expect(store.people).toHaveLength(0);
  });

  it("turns a Granola 401 into a 502 without echoing Granola's body", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "grn_bad");
    vi.stubGlobal("fetch", async () => new Response('{"secret":"note text"}', { status: 401 }));
    const res = await post({});
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain("note text");
  });

  it("in demo mode it needs no key and reads no network", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO", "1");
    vi.stubEnv("GRANOLA_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post({ dryRun: true });
    expect(res.status).toBe(200);
    expect((await res.json()).added).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "grn_server_key");
    expect((await post({ since: "not a date" })).status).toBe(400);
  });
});
