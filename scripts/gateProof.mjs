// Starts the production build without demo mode, next to a fake local Supabase auth server, and checks with real
// HTTP requests that admin routes are closed without a session and open with one. Needs `npm run build` first
// (without NEXT_PUBLIC_DEMO). Starts two processes on ports 3278 and 3279 and stops them by PID. Calls nothing outside localhost.
import { spawn } from "node:child_process";
import http from "node:http";

const APP = 3278;
const AUTH = 3279;
const USER = { id: "00000000-0000-4000-8000-0000000000aa", aud: "authenticated", role: "authenticated", email: "owner@acme.example", email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };

// A stand-in for Supabase auth and PostgREST. It answers the session check and fails every data query, so a 200 from an
// admin route proves the gate let the request in, and a data error proves it reached the database layer.
const fake = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url?.startsWith("/auth/v1/user")) return void res.end(JSON.stringify(USER));
  res.statusCode = 500;
  res.end(JSON.stringify({ message: "fake database" }));
}).listen(AUTH);

const session = { access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER };
const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

const child = spawn("node_modules/.bin/next", ["start", "-p", String(APP)], {
  env: { ...process.env, NEXT_PUBLIC_DEMO: "", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${AUTH}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", LOOOT_NETWORK_ALLOWED_EMAILS: "owner@acme.example", LOOOT_TOKEN: "" },
  stdio: "ignore",
});
const stop = () => { child.kill(); fake.close(); };
process.on("exit", stop);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`http://localhost:${APP}/api/health`)).ok) break; } catch { /* not up yet */ }
  await sleep(250);
}

const get = async (path, init = {}) => (await fetch(`http://localhost:${APP}${path}`, { redirect: "manual", ...init })).status;
const rows = [];
let bad = 0;
const check = (name, got, want) => {
  const ok = want.includes(got);
  if (!ok) bad++;
  rows.push(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (wanted ${want.join(" or ")})`}`);
};

const api = ["/api/people", "/api/people/00000000-0000-4000-8000-000000000001", "/api/companies", "/api/budget", "/api/saved", "/api/enrichments", "/api/export?q=a"];
const pages = ["/", "/search", "/companies", "/imports", "/enrich", "/settings"];
for (const p of api) check(`no cookie  GET ${p}`, await get(p), [401]);
for (const p of pages) check(`no cookie  GET ${p}`, await get(p), [307, 303]);
check("no cookie  POST /api/import", await get("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), [401]);
check("no cookie  POST /api/enrich", await get("/api/enrich", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), [401]);
check("public     GET /api/health", await get("/api/health"), [200]);
check("public     GET /login", await get("/login"), [200]);
const h = { cookie };
// With a session the gate lets the request through. The fake database then refuses it, which proves the route got past the gate.
for (const p of api) check(`session    GET ${p}`, await get(p, { headers: h }), [200, 404, 500]);
for (const p of pages) check(`session    GET ${p}`, await get(p, { headers: h }), [200, 500]);
check("session    POST /api/import from another origin", await get("/api/import", { method: "POST", headers: { ...h, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }), [403]);
check("session    POST /api/import as text/plain", await get("/api/import", { method: "POST", headers: { ...h, "content-type": "text/plain" }, body: "{}" }), [403]);
check("session    POST /api/enrich while enrichment is off", await get("/api/enrich", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ kinds: ["profile"], query: "", maxCostUsd: 999 }) }), [409]);
console.log(rows.join("\n"));
console.log(bad === 0 ? `Gate proof passed: ${rows.length} checks` : `Gate proof FAILED: ${bad} of ${rows.length}`);
stop();
process.exit(bad === 0 ? 0 : 1);
