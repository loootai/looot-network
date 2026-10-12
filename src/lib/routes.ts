/**
 * Paths a visitor may reach without a session. Anything not listed here is private: an unlisted path is admin.
 * The route map test reads the file tree and fails when a route handler is added without a gate.
 */
export const PUBLIC_ROUTES = ["/auth/callback", "/api/health"];

/** Pages shown to someone who is not signed in or not on the allow-list. */
export const PUBLIC_PAGES = ["/login", "/setup", "/not-authorised"];

/** True for a path that needs no session. Static files are matched out before the proxy runs. */
export function isPublicPath(path: string): boolean {
  return PUBLIC_ROUTES.includes(path) || PUBLIC_PAGES.includes(path) || path.startsWith("/auth/");
}

/** A state-changing request must come from this site and carry JSON. Blocks cross-site form posts and fetches. */
export function sameOriginJson(method: string, headers: { get(name: string): string | null }, host: string): { ok: true } | { ok: false; reason: string } {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return { ok: true };
  const origin = headers.get("origin");
  if (origin) {
    let h: string | null = null;
    try {
      h = new URL(origin).host;
    } catch {
      h = null;
    }
    if (h !== host) return { ok: false, reason: "Cross-site request refused." };
  } else if (headers.get("sec-fetch-site") === "cross-site") return { ok: false, reason: "Cross-site request refused." };
  const type = headers.get("content-type") ?? "";
  const hasBody = headers.get("content-length") !== "0" && headers.get("content-length") !== null;
  if (method !== "DELETE" && hasBody && !/^application\/json\b/i.test(type)) return { ok: false, reason: "Send application/json." };
  return { ok: true };
}
