/** Where a person row came from. */
export type SourceKind = "linkedin" | "google" | "csv" | "x" | "granola" | "manual" | "demo";
export const SOURCE_KINDS: SourceKind[] = ["linkedin", "google", "csv", "x", "granola", "manual", "demo"];
/** Short names for chips in tables, where "Google Contacts" would wrap. */
export const SOURCE_SHORT: Record<SourceKind, string> = { linkedin: "LinkedIn", google: "Google", csv: "CSV", x: "X", granola: "Granola", manual: "Manual", demo: "Demo" };
export const SOURCE_LABEL: Record<SourceKind, string> = { linkedin: "LinkedIn", google: "Google Contacts", csv: "CSV", x: "X following", granola: "Granola meetings", manual: "Manual", demo: "Demo" };

/** One person as a parser produces it, before dedupe. `raw` is the original row, kept so the profile drawer can show what the file said. */
export interface PersonInput {
  full_name: string;
  first_name?: string;
  last_name?: string;
  emails: string[];
  phones: string[];
  linkedin_url?: string;
  x_url?: string;
  company?: string;
  company_domain?: string;
  title?: string;
  location?: string;
  headline?: string;
  notes?: string;
  tags: string[];
  /** ISO date (YYYY-MM-DD) the connection was made, when the file says so. */
  connected_on?: string;
  source: SourceKind;
  raw: Record<string, string>;
}

/** Facts written back by enrichment, with the job that supplied each one. */
export interface EnrichedFacts {
  profile?: { title?: string; company?: string; location?: string; headline?: string; at: string; runId?: string };
  company?: { industry?: string; employees?: number; country?: string; domain?: string; at: string; runId?: string };
  email?: { email: string; at: string; runId?: string };
}

/** A stored person. */
export interface Person {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  /** The first of `emails`, kept as its own column so tables and exports read it without unpacking. */
  email: string | null;
  emails: string[];
  phones: string[];
  linkedin_url: string | null;
  x_url: string | null;
  company: string | null;
  company_domain: string | null;
  title: string | null;
  location: string | null;
  headline: string | null;
  notes: string | null;
  tags: string[];
  connected_on: string | null;
  source_kinds: SourceKind[];
  enriched: EnrichedFacts;
  enriched_at: string | null;
}

/** A row of a file as it was imported, shown on the profile drawer. */
export interface PersonSource {
  /** The person this row fed. Always set on stored rows. */
  person_id: string;
  import_id: string;
  source: SourceKind;
  filename: string;
  imported_at: string;
  row_number: number;
  raw: Record<string, string>;
}

export interface ImportRecord {
  id: string;
  created_at: string;
  filename: string;
  source: SourceKind;
  rows: number;
  added: number;
  merged: number;
  skipped: number;
  /** Rows the parser could not use, with the reason. At most 50 are kept. */
  rejected: { row: number; reason: string }[];
}

export interface SavedSearch {
  id: string;
  created_at: string;
  name: string;
  query: string;
}

export interface CompanyGroup {
  company: string;
  people: number;
  with_email: number;
  titles: string[];
}

export type EnrichKind = "profile" | "company" | "email";
