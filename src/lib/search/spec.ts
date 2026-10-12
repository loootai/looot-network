import { parseQuery, type ParsedQuery } from "./parse";
import type { SourceKind } from "../types";

export type SortKey = "relevance" | "name" | "company" | "recent";

/** Filters set with the controls next to the search box. They narrow whatever the text says. */
export interface UiFilters {
  sources?: SourceKind[];
  tags?: string[];
  hasEmail?: boolean | null;
  hasLinkedin?: boolean | null;
  /** Exact company, set when a row on the Companies page is opened. Compared in lower case. */
  company?: string | null;
}

export interface SearchSpec extends ParsedQuery {
  companyExact: string | null;
  sort: SortKey;
  limit: number;
  offset: number;
}

export const MAX_LIMIT = 200;
export const EXPORT_LIMIT = 5000;

/** Merges the parsed text, the control filters and the paging into one spec. */
export function specFrom(query: string, ui: UiFilters = {}, paging: { sort?: SortKey; limit?: number; offset?: number } = {}): SearchSpec {
  const p = parseQuery(query);
  const sources = ui.sources?.length ? ui.sources : p.sources;
  const tags = [...new Set([...p.tags, ...(ui.tags ?? []).map((t) => t.toLowerCase())])];
  const sort = paging.sort ?? "relevance";
  return {
    ...p,
    sources,
    tags,
    hasEmail: ui.hasEmail ?? p.hasEmail,
    hasLinkedin: ui.hasLinkedin ?? p.hasLinkedin,
    companyExact: ui.company ? ui.company.trim().toLowerCase() : null,
    sort,
    limit: Math.max(1, Math.min(paging.limit ?? 50, EXPORT_LIMIT)),
    offset: Math.max(0, paging.offset ?? 0),
    isEmpty: p.isEmpty && !sources.length && !tags.length && ui.hasEmail == null && ui.hasLinkedin == null && !ui.company,
  };
}

/** Arguments of the SQL function search_people(). Every value is a parameter, none is spliced into SQL text. */
export interface SearchRpcParams {
  p_terms: string[];
  p_roles: string[];
  p_companies: string[];
  p_locations: string[];
  p_name: string | null;
  p_company_exact: string | null;
  p_has_email: boolean | null;
  p_has_linkedin: boolean | null;
  p_sources: string[];
  p_tags: string[];
  p_sort: SortKey;
  p_limit: number;
  p_offset: number;
}

/** Turns a spec into the arguments of search_people(). Pure, so it can be tested without a database. */
export function rpcParams(spec: SearchSpec): SearchRpcParams {
  return {
    p_terms: spec.terms,
    p_roles: spec.roles,
    p_companies: spec.companies,
    p_locations: spec.locations,
    p_name: spec.name,
    p_company_exact: spec.companyExact,
    p_has_email: spec.hasEmail,
    p_has_linkedin: spec.hasLinkedin,
    p_sources: spec.sources,
    p_tags: spec.tags,
    p_sort: spec.sort,
    p_limit: Math.min(spec.limit, EXPORT_LIMIT),
    p_offset: spec.offset,
  };
}
