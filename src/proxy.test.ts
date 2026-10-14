import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isPublicPath, sameOriginJson } from "./lib/routes";

let user: { id: string; email: string; email_confirmed_at: string } | null = null;
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));

const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost:3000${path}`, init);
const on = { id: "1", email: "owner@acme.example", email_confirmed_at: "x" };
const off = { id: "2", email: "stranger@evil.example", email_confirmed_at: "x" };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("LOOOT_NETWORK_ALLOWED_EMAILS", "owner@acme.example");
  user = null;
});
afterEach(() => vi.unstubAllEnvs());

const loc = (r: Response) => r.headers.get("location");

describe("proxy", () => {
  it("sends anon page requests to /login and answers anon API calls 401", async () => {
    const { proxy } = await import("./proxy");
    expect(loc(await proxy(req("/companies")))).toBe("http://localhost:3000/login");
    expect((await proxy(req("/api/export?q=a"))).status).toBe(401);
  });
  it("sends a stranger to /not-authorised and answers APIs 403", async () => {
    const { proxy } = await import("./proxy");
    user = off;
    expect(loc(await proxy(req("/")))).toBe("http://localhost:3000/not-authorised");
    expect((await proxy(req("/api/people"))).status).toBe(403);
  });
  it("sends everyone to /setup while no allow-list is set", async () => {
    const { proxy } = await import("./proxy");
    vi.stubEnv("LOOOT_NETWORK_ALLOWED_EMAILS", "");
    user = on;
    expect(loc(await proxy(req("/")))).toBe("http://localhost:3000/setup");
    expect((await proxy(req("/api/people"))).status).toBe(503);
  });
  it("lets an allowed user through and bounces them off /setup", async () => {
    const { proxy } = await import("./proxy");
    user = on;
    expect((await proxy(req("/api/people"))).status).toBe(200);
    expect(loc(await proxy(req("/setup")))).toBe("http://localhost:3000/");
  });
  it("keeps the sign-in pages and the health check open", async () => {
    const { proxy } = await import("./proxy");
    expect((await proxy(req("/login"))).status).toBe(200);
    expect((await proxy(req("/auth/callback?code=x"))).status).toBe(200);
    expect((await proxy(req("/api/health"))).status).toBe(200);
    expect((await proxy(req("/api/people"))).status).toBe(401);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/api/people")).toBe(false);
    expect(isPublicPath("/anything-new")).toBe(false);
  });
  it("is open in demo mode", async () => {
    const { proxy } = await import("./proxy");
    vi.stubEnv("NEXT_PUBLIC_DEMO", "1");
    expect((await proxy(req("/api/people"))).status).toBe(200);
  });
});

describe("CSRF", () => {
  const post = (headers: Record<string, string>) => req("/api/import", { method: "POST", headers: { "content-length": "2", ...headers }, body: "{}" });
  it("refuses a state-changing request from another origin, even with a valid session", async () => {
    const { proxy } = await import("./proxy");
    user = on;
    const r = await proxy(post({ origin: "https://evil.example", "content-type": "application/json" }));
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("csrf");
  });
  it("refuses a form-encoded or text post, which a cross-site form can send without a preflight", async () => {
    const { proxy } = await import("./proxy");
    user = on;
    expect((await proxy(post({ origin: "http://localhost:3000", "content-type": "text/plain" }))).status).toBe(403);
    expect((await proxy(post({ "content-type": "application/x-www-form-urlencoded" }))).status).toBe(403);
  });
  it("allows a same-origin JSON post", async () => {
    const { proxy } = await import("./proxy");
    user = on;
    expect((await proxy(post({ origin: "http://localhost:3000", "content-type": "application/json" }))).status).toBe(200);
  });
  it("applies the same rule in demo mode", () => {
    expect(sameOriginJson("POST", new Headers({ origin: "https://evil.example", "content-type": "application/json", "content-length": "2" }), "localhost:3000").ok).toBe(false);
    expect(sameOriginJson("DELETE", new Headers({ origin: "http://localhost:3000" }), "localhost:3000").ok).toBe(true);
    expect(sameOriginJson("POST", new Headers({ "sec-fetch-site": "cross-site", "content-type": "application/json", "content-length": "2" }), "localhost:3000").ok).toBe(false);
    expect(sameOriginJson("GET", new Headers({ origin: "https://evil.example" }), "localhost:3000").ok).toBe(true);
    const json = { "content-type": "application/json", "content-length": "2" };
    expect(sameOriginJson("POST", new Headers({ origin: "null", "sec-fetch-site": "same-origin", ...json }), "localhost:3000").ok).toBe(true);
    expect(sameOriginJson("POST", new Headers({ origin: "null", "sec-fetch-site": "cross-site", ...json }), "localhost:3000").ok).toBe(false);
    expect(sameOriginJson("POST", new Headers({ origin: "null", ...json }), "localhost:3000").ok).toBe(false);
  });
});
