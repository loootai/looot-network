import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionNames, pageMap, PUBLIC_ROUTES, routeMap } from "./routeMap";

type FakeUser = { id: string; email: string; email_confirmed_at: string } | null;
let user: FakeUser = null;
const DB_TOUCHED = "db touched";

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user } }), signOut: async () => ({}), exchangeCodeForSession: async () => ({ error: null }) },
    from: () => { throw new Error("db touched"); },
    rpc: () => { throw new Error("db touched"); },
  }),
}));

const signedIn = (email: string): FakeUser => ({ id: "u1", email, email_confirmed_at: "2026-10-01T00:00:00Z" });
const GATE_CLOSED = [401, 403, 503];

async function call(file: string, method: string, body: unknown = {}): Promise<{ status: number; touchedDb: boolean; json?: Record<string, unknown> }> {
  const mod = await import(/* @vite-ignore */ file);
  const req = new Request("http://localhost/x?q=a", method === "GET" ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const res: Response = await mod[method](req, { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    return { status: res.status, touchedDb: false, json: await res.clone().json().catch(() => undefined) };
  } catch (e) {
    if (e instanceof Error && e.message === DB_TOUCHED) return { status: 200, touchedDb: true };
    throw e;
  }
}

const routes = routeMap().filter((r) => !PUBLIC_ROUTES.includes(r.url));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("LOOOT_NETWORK_ALLOWED_EMAILS", "owner@acme.example");
  vi.stubEnv("LOOOT_NETWORK_ALLOWED_DOMAINS", "");
  vi.stubEnv("LOOOT_TOKEN", "");
  vi.stubEnv("LOOOT_NETWORK_ENRICH", "");
  vi.stubEnv("SPEND_RATE_LIMIT_PER_MIN", "1000");
  vi.resetModules();
  user = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("route map", () => {
  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const r of routes) expect(r.methods.length, r.url).toBeGreaterThan(0);
  });
  it("lists exactly the public routes the app has", () => {
    const urls = routeMap().map((r) => r.url);
    for (const p of PUBLIC_ROUTES) expect(urls, p).toContain(p);
  });
});

describe.each(routes.flatMap((r) => r.methods.map((m) => ({ ...r, method: m }))))("$method $url", ({ file, method }) => {
  it("is closed when not signed in", async () => {
    user = null;
    expect((await call(file, method)).status).toBe(401);
  });
  it("is closed to a signed-in user who is not on the list", async () => {
    user = signedIn("stranger@evil.example");
    const r = await call(file, method);
    expect(r.touchedDb).toBe(false);
    expect(r.status).toBe(403);
  });
  it("is closed to everyone when no allow-list is set", async () => {
    vi.stubEnv("LOOOT_NETWORK_ALLOWED_EMAILS", "");
    user = signedIn("owner@acme.example");
    const r = await call(file, method);
    expect(r.touchedDb).toBe(false);
    expect(r.status).toBe(503);
  });
  it("is open to a user on the list", async () => {
    user = signedIn("Owner@Acme.example");
    const r = await call(file, method);
    expect(r.touchedDb || !GATE_CLOSED.includes(r.status)).toBe(true);
  });
});

describe("pages", () => {
  const pages = pageMap().filter((p) => !p.isPublic);
  it("finds the pages", () => expect(pages.length).toBeGreaterThanOrEqual(7));
  // Each private page and the layout read the store through requireSession, so a page cannot render data without a session.
  it.each(pages.map((p) => [p.url, p.src] as const))("%s runs behind requireSession", (url, src) => {
    expect(src, `${url} does not check the session`).toContain("requireSession");
  });
});

describe("public routes", () => {
  it("the health check is open and returns nothing about the data", async () => {
    const mod = await import("../app/api/health/route");
    const res = await mod.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("server actions", () => {
  it("only signs out", () => expect(actionNames()).toEqual(["signOut"]));
});

describe("spending", () => {
  it("rate-limits /api/quote and /api/enrich per user", async () => {
    vi.stubEnv("SPEND_RATE_LIMIT_PER_MIN", "2");
    vi.stubEnv("LOOOT_NETWORK_ENRICH", "1");
    vi.stubEnv("LOOOT_TOKEN", "tok_test");
    vi.resetModules();
    user = signedIn("owner@acme.example");
    for (const url of ["quote", "enrich"]) {
      const mod = await import(/* @vite-ignore */ routes.find((r) => r.url === `/api/${url}`)!.file);
      const send = () => mod.POST(new Request("http://localhost/x", { method: "POST", body: "{}" }));
      expect((await send()).status).toBe(400);
      expect((await send()).status).toBe(400);
      expect((await send()).status).toBe(429);
    }
  });
  it("refuses a paid run while enrichment is off, before it reads any data", async () => {
    user = signedIn("owner@acme.example");
    const r = await call(routes.find((x) => x.url === "/api/enrich")!.file, "POST", { kinds: ["profile"], query: "" });
    expect(r.status).toBe(409);
    expect(r.touchedDb).toBe(false);
  });
  it("takes the cap from the server, never from the caller", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO", "1");
    vi.stubEnv("LOOOT_NETWORK_CAP_USD", "0.5");
    vi.resetModules();
    const mod = await import("../app/api/quote/route");
    const res = await mod.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ kinds: ["profile"], query: "", maxCostUsd: 999, capMicros: 999_000_000, cap: 999 }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.capMicros).toBe(500_000);
  });
});

describe("auth callback", () => {
  const cb = async (qs: string) => {
    const mod = await import("../app/auth/callback/route");
    return mod.GET(new Request(`http://localhost:3000/auth/callback?${qs}`));
  };
  it.each(["//evil.example", "https://evil.example/x", "/\\evil.example", "javascript:alert(1)"])("ignores next=%s", async (next) => {
    user = signedIn("owner@acme.example");
    const res = await cb(`code=abc&next=${encodeURIComponent(next)}`);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
  it("follows a same-origin relative next", async () => {
    const res = await cb(`code=abc&next=${encodeURIComponent("/imports")}`);
    expect(res.headers.get("location")).toBe("http://localhost:3000/imports");
  });
});

describe("demo mode", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DEMO", "1");
    vi.resetModules();
  });
  it("is open without a session and never touches Supabase", async () => {
    for (const r of routes.filter((x) => x.methods.includes("GET") && !x.url.includes("[id]"))) {
      const res = await call(r.file, "GET");
      expect(GATE_CLOSED.includes(res.status), `${r.url} answered ${res.status}`).toBe(false);
      expect(res.touchedDb).toBe(false);
    }
  });
  it("refuses to start next to a real looot token", async () => {
    vi.stubEnv("LOOOT_TOKEN", "tok_real");
    const { demoStore } = await import("../lib/store");
    expect(() => demoStore()).toThrow(/refuses to run while LOOOT_TOKEN is set/);
  });
});

describe("cron and webhooks", () => {
  it("the app has none, so a new one must be added to the route map and gated", () => {
    expect(routeMap().filter((r) => /cron|webhook/i.test(r.url))).toEqual([]);
  });
});
