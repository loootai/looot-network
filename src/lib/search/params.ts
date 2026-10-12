import { SOURCE_KINDS, type SourceKind } from "../types";
import type { UiFilters } from "./spec";

/** Reads the filter controls out of a URL: ?source=linkedin&tag=x&email=1&linkedin=1&company=Acme. */
export function filtersFromParams(sp: URLSearchParams): UiFilters {
  const flag = (k: string) => (sp.get(k) === "1" ? true : sp.get(k) === "0" ? false : null);
  return {
    sources: sp.getAll("source").filter((s): s is SourceKind => (SOURCE_KINDS as string[]).includes(s)),
    tags: sp.getAll("tag").slice(0, 10),
    hasEmail: flag("email"),
    hasLinkedin: flag("linkedin"),
    company: sp.get("company"),
  };
}

/** Next.js hands pages a plain object of search params. This turns it into URLSearchParams. */
export function toParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) out.append(k, x);
  return out;
}

export const EXPORT_COLUMNS = ["full_name", "first_name", "last_name", "email", "emails", "phones", "linkedin_url", "x_url", "company", "title", "location", "headline", "tags", "connected_on", "source_kinds", "notes"];
