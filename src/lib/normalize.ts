/** Lower-cases and trims an email. Returns null when it is not shaped like one. */
export function normalizeEmail(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s) ? s : null;
}

/** Splits a cell that may hold several emails ("a@example.com ::: b@example.org", "a@example.com; b@example.org") into clean, unique emails. */
export function splitEmails(v: string | null | undefined): string[] {
  const out = (v ?? "")
    .split(/\s*(?::::|;|,|\n|\s\/\s)\s*/)
    .map(normalizeEmail)
    .filter((e): e is string => !!e);
  return [...new Set(out)];
}

/**
 * The dedupe form of a LinkedIn profile URL: "linkedin.com/in/<slug>" in lower case, no scheme, no www or locale host,
 * no query, no trailing slash. Returns null for anything that is not a person profile.
 */
export function normalizeLinkedIn(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const withScheme = /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:in|pub)\/([^/]+)/i);
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // keep the raw slug
  }
  slug = slug.trim().toLowerCase();
  return slug ? `linkedin.com/in/${slug}` : null;
}

/** The canonical https URL for a normalized LinkedIn key. */
export const linkedInUrl = (key: string) => `https://www.${key}`;

/** The X handle or numeric id behind an x.com / twitter.com URL. */
export function normalizeX(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const m = s.match(/(?:twitter|x)\.com\/(?:intent\/user\?user_id=(\d+)|@?([A-Za-z0-9_]{1,15}))/i);
  if (m?.[1]) return `x.com/i/user/${m[1]}`;
  if (m?.[2]) return `x.com/${m[2].toLowerCase()}`;
  const handle = s.match(/^@([A-Za-z0-9_]{1,15})$/);
  return handle ? `x.com/${handle[1].toLowerCase()}` : null;
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lower-case, accent-free, punctuation-free text for comparing names and companies. */
export function fold(v: string | null | undefined): string {
  return strip(v ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL = /\b(inc|incorporated|ltd|limited|llc|llp|plc|gmbh|sas|sarl|bv|ag|sa|corp|corporation|co|company|group|holdings)\b/g;

/** A company name folded for comparison, without legal suffixes ("Stripe, Inc." and "stripe" match). */
export function companyKey(v: string | null | undefined): string {
  return fold(v).replace(LEGAL, " ").replace(/\s+/g, " ").trim();
}

/** The name-and-company dedupe key. null when either part is missing, because a bare name is not safe to merge on. */
export function nameCompanyKey(full: string | null | undefined, company: string | null | undefined): string | null {
  const n = fold(full);
  const c = companyKey(company);
  return n && c && n.includes(" ") ? `${n}|${c}` : null;
}

/** The domain of an email, or of a URL or bare domain. */
export function domainOf(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  const host = s.includes("@") ? s.split("@").pop()! : s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : null;
}

/** Mail providers that say nothing about an employer. */
export const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "gmx.com", "aol.com", "orange.fr", "free.fr", "wanadoo.fr", "msn.com", "yandex.com", "qq.com", "163.com"]);

/** The work domain of an email address: null for personal mail providers. */
export function workDomain(email: string | null | undefined): string | null {
  const d = domainOf(email);
  return d && !PERSONAL_DOMAINS.has(d) ? d : null;
}

/** "Jane Q. Doe" split into first and last, for files that carry one name field. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date cell ("11 Mar 2023", "2023-03-11", "03/11/2023") to YYYY-MM-DD, or undefined. */
export function toIsoDate(v: string | null | undefined): string | undefined {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    // Month first when the first number cannot be a day of month 13 or more.
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return undefined;
}
