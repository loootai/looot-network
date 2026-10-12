import "server-only";
import { NextResponse } from "next/server";
import { DemoRunner } from "@/demo/demoRunner";
import { fetchPrices, hasLoootToken, loootFromEnv, type Runner, type PriceMap } from "./looot";
import { FALLBACK_PRICES } from "./enrich/providers";
import { allowCall, spendRateLimit } from "./rateLimit";
import { IS_DEMO, resolveGate, type Session } from "./store";

/**
 * The session for a route handler, or the refusal to send: 401 not signed in, 403 signed in but not on the
 * allow-list, 503 when the operator has set no allow-list. Every private route starts here.
 */
export async function sessionOr401(): Promise<Session | NextResponse> {
  const g = await resolveGate();
  if (g.kind === "ok") return g.session;
  if (g.kind === "setup") return NextResponse.json({ error: { code: "setup_required", message: "Set LOOOT_NETWORK_ALLOWED_EMAILS on the server, then try again." } }, { status: 503, headers: NO_STORE });
  if (g.kind === "denied") return NextResponse.json({ error: { code: "forbidden", message: "You are not authorised for this workspace." } }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401, headers: NO_STORE });
}

/** Responses with personal data or money numbers are never cached by a browser, proxy or CDN. */
export const NO_STORE = { "Cache-Control": "no-store" };

export function bad(message: string, status = 400, code = "bad_request") {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** A 429 answer when this user already made too many calls to a spending route this minute, else null. */
export function rateLimited(bucket: string, session: Session): NextResponse | null {
  if (session.store.demo || allowCall(bucket, session.user.id, spendRateLimit())) return null;
  return bad("Too many requests. Wait a minute and try again.", 429, "rate_limited");
}

/** The most one run may spend, in micro-dollars. Set by the server in LOOOT_NETWORK_CAP_USD (default 1). No request can change it. */
export function serverCapMicros(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LOOOT_NETWORK_CAP_USD);
  return Math.round((Number.isFinite(n) && n > 0 ? n : 1) * 1_000_000);
}

/** The most people one run may cover. Set by the server in LOOOT_NETWORK_MAX_PEOPLE (default 200). */
export function serverMaxPeople(env: Record<string, string | undefined> = process.env): number {
  const n = Math.floor(Number(env.LOOOT_NETWORK_MAX_PEOPLE));
  return Number.isFinite(n) && n > 0 ? n : 200;
}

/** Enrichment is off until the operator turns it on: LOOOT_NETWORK_ENRICH=1 and a LOOOT_TOKEN. Demo mode always shows it, with no calls. */
export function enrichEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return IS_DEMO || (env.LOOOT_NETWORK_ENRICH === "1" && hasLoootToken(env));
}

/** The looot client for this request. Demo mode never reads LOOOT_TOKEN and never calls looot. */
export function runnerForRequest(): Runner & { getRun?: (id: string) => Promise<{ status: string; actualCost?: number | string | null }> } {
  return IS_DEMO ? new DemoRunner() : loootFromEnv();
}

/** Live list prices, or the dated fallback with the endpoints that could not be read. */
export async function readPrices(): Promise<{ prices: PriceMap; source: "catalog" | "fallback"; unread: string[] }> {
  if (IS_DEMO || process.env.LOOOT_OFFLINE === "1") return { prices: { ...FALLBACK_PRICES }, source: "fallback", unread: [] };
  const r = await fetchPrices(FALLBACK_PRICES);
  return { prices: r.prices, source: r.source, unread: r.unread };
}
