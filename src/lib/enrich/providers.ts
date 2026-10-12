import { createHash } from "node:crypto";
import { normalizeEmail, normalizeLinkedIn, workDomain } from "../normalize";
import { findNumber, findString, isRec, rowsOf } from "../read";
import type { EnrichKind, Person } from "../types";

/** What a paid call wrote back, with only the fields the provider returned. */
export interface Facts {
  profile?: { title?: string; company?: string; location?: string; headline?: string };
  company?: { industry?: string; employees?: number; country?: string };
  email?: { email: string };
}

export interface EnrichDef {
  kind: EnrichKind;
  label: string;
  provider: string;
  /** looot job id, kept as the catalog reference. */
  jobId: string;
  /** The one endpoint the call is pinned to, so the price is the quoted price and there is no provider fallback. */
  endpointId: string;
  /** Price per call in micro-dollars from the public catalog on PRICES_AS_OF. */
  fallbackMicros: number;
  /** false until someone has checked a real response body against the parser. */
  shapeVerified: boolean;
  /** One sentence for the Enrich page. */
  help: string;
  parse(result: unknown): Facts;
}

export const PRICES_AS_OF = "2026-10-12";

/** The first array found under one of `keys`, searching the whole body. */
function findArray(v: unknown, keys: string[], depth = 0): unknown[] | undefined {
  if (depth > 6) return undefined;
  if (isRec(v)) {
    for (const k of keys) if (Array.isArray(v[k])) return v[k] as unknown[];
    for (const x of Object.values(v)) {
      const a = findArray(x, keys, depth + 1);
      if (a) return a;
    }
  } else if (Array.isArray(v)) {
    for (const x of v) {
      const a = findArray(x, keys, depth + 1);
      if (a) return a;
    }
  }
  return undefined;
}

function currentRole(result: unknown): { title?: string; company?: string } {
  const rows = (findArray(result, ["experience", "experiences", "positions", "jobs"]) ?? []).filter(isRec);
  const row = rows.find((r) => r.current === true || r.isCurrent === true || r.end === null || r.endDate === null || r.end_date === null || /present/i.test(String(r.end ?? r.endDate ?? r.end_date ?? ""))) ?? rows[0];
  if (!row) return {};
  const company = findString(row, ["company", "companyName", "company_name", "organization"]);
  const title = findString(row, ["title", "position", "role", "job_title"]);
  return { title, company };
}

/** The three paid calls this app makes. Job ids and prices come from the free looot catalog. */
export const ENRICH: Record<EnrichKind, EnrichDef> = {
  profile: {
    kind: "profile",
    label: "LinkedIn profile: current company, title, place",
    provider: "anyapi",
    jobId: "linkedin.person.profile",
    endpointId: "anyapi-run-linkedin-profile-thin",
    fallbackMicros: 1_200,
    shapeVerified: false,
    help: "Reads the public profile at the LinkedIn URL you imported. Needs a LinkedIn URL.",
    parse(result) {
      const role = currentRole(result);
      const out: NonNullable<Facts["profile"]> = {};
      const title = findString(result, ["position", "job_title", "jobTitle"]) ?? role.title;
      const company = findString(result, ["companyName", "company_name", "currentCompany", "current_company"]) ?? role.company;
      const location = findString(result, ["location", "geo", "city"]);
      const headline = findString(result, ["headline", "summary"]);
      if (title) out.title = title;
      if (company) out.company = company;
      if (location) out.location = location;
      if (headline) out.headline = headline;
      return Object.keys(out).length ? { profile: out } : {};
    },
  },
  company: {
    kind: "company",
    label: "Company firmographics",
    provider: "thecompaniesapi",
    jobId: "company.enrich",
    endpointId: "thecompaniesapi-companies-by-email",
    fallbackMicros: 1_900,
    shapeVerified: false,
    help: "Looks the company up from its web domain. One call per domain, shared by everyone who works there. Needs a work email or a company domain.",
    parse(result) {
      const out: NonNullable<Facts["company"]> = {};
      const industry = findString(result, ["industryMain", "industry", "industries", "sector", "category"]);
      const raw = findNumber(result, ["totalEmployees", "employees", "employee_count", "employeeCount", "headcount"]);
      const country = findString(result, ["countryCode", "country_code", "country"]);
      if (industry) out.industry = industry;
      if (raw !== undefined && raw >= 0) out.employees = Math.round(raw);
      if (country) out.country = country;
      return Object.keys(out).length ? { company: out } : {};
    },
  },
  email: {
    kind: "email",
    label: "Work email from the LinkedIn profile",
    provider: "anysite",
    jobId: "people.email.find",
    endpointId: "anysite-api-linkedin-user-email",
    fallbackMicros: 3_598,
    shapeVerified: false,
    help: "Looks for a work email behind the LinkedIn URL. Skipped for people who already have an email.",
    parse(result) {
      const found = findString(result, ["email", "work_email", "professional_email", "email_address"]);
      const e = normalizeEmail(found);
      if (e) return { email: { email: e } };
      const first = isRec(result) ? rowsOf(result, ["emails", "data", "results"])[0] : undefined;
      const e2 = first ? normalizeEmail(findString(first, ["email", "address", "value"])) : null;
      return e2 ? { email: { email: e2 } } : {};
    },
  },
};

export const KINDS = Object.keys(ENRICH) as EnrichKind[];

/** Fallback prices keyed by endpoint id. */
export const FALLBACK_PRICES: Record<string, number> = Object.fromEntries(Object.values(ENRICH).map((d) => [d.endpointId, d.fallbackMicros]));

/** The company domain looot is asked about: the stored domain, else the domain of a work email. */
export function domainFor(p: Pick<Person, "company_domain" | "emails">): string | null {
  return p.company_domain ?? p.emails.map(workDomain).find(Boolean) ?? null;
}

export type SkipReason = "no_linkedin" | "no_domain" | "has_email" | "done";

/** What a call for this person would need, or why it is not made. Pure: nothing is called. */
export function planFor(p: Person, kind: EnrichKind): { input: Record<string, unknown>; target: string } | { skip: SkipReason } {
  if (p.enriched[kind]) return { skip: "done" };
  if (kind === "company") {
    const d = domainFor(p);
    return d ? { input: { email: `info@${d}` }, target: d } : { skip: "no_domain" };
  }
  const key = normalizeLinkedIn(p.linkedin_url);
  if (!key) return { skip: "no_linkedin" };
  if (kind === "email" && p.email) return { skip: "has_email" };
  const url = `https://www.${key}`;
  return kind === "profile" ? { input: { url }, target: key } : { input: { profile: url }, target: key };
}

export const SKIP_TEXT: Record<SkipReason, string> = {
  no_linkedin: "no LinkedIn URL",
  no_domain: "no company domain",
  has_email: "already has an email",
  done: "already enriched",
};

/** Hash of what a paid call asks for: endpoint and input, lower-cased. Guards a short key against a collision. */
export function callFingerprint(endpointId: string, input: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => (typeof v === "string" ? v.trim().toLowerCase() : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, norm(x)])) : v);
  return createHash("sha256").update(JSON.stringify([endpointId, norm(input)])).digest("hex");
}

/**
 * One key per paid call. Profile and email calls are keyed by the person, so they are never made twice for one
 * person. The company call depends only on the domain, so it is keyed by the domain and shared by everyone there.
 * The same key replays the stored run at looot and never charges twice.
 */
export function idempotencyKey(kind: EnrichKind, p: Pick<Person, "id">, target: string): string {
  const subject = kind === "company" ? `d:${target}` : `p:${p.id}`;
  return `network:v1:${kind}:${createHash("sha256").update(subject).digest("hex").slice(0, 16)}`;
}
