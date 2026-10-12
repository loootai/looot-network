import type { BudgetLimits, BudgetStatus, Ledger } from "../budget";
import type { ImportPlan } from "../dedupe";
import type { ParseResult } from "../import/parsers";
import type { SearchSpec } from "../search/spec";
import type { CompanyGroup, EnrichKind, ImportRecord, Person, PersonInput, PersonSource, SavedSearch } from "../types";

/** One paid call as stored. */
export interface EnrichmentRow {
  id: string;
  created_at: string;
  person_id: string;
  kind: EnrichKind;
  idempotency_key: string;
  endpoint_id: string;
  looot_run_id: string | null;
  status: "ok" | "pending" | "failed" | "skipped";
  list_price_micros: number;
  cost_micros: number;
  message: string | null;
}

export interface Stats {
  total: number;
  with_email: number;
  with_linkedin: number;
  companies: number;
  enriched: number;
  by_source: Record<string, number>;
  tags: { tag: string; n: number }[];
}

/** What an import would do, shown before anything is written. */
export interface ImportPreview {
  rows: number;
  /** People who are not in the network yet. */
  added: number;
  /** People who already exist and get new details from this file. */
  merged: number;
  /** People who already exist and gain nothing. */
  unchanged: number;
  /** Rows that describe the same person as another row of the same file. */
  folded: number;
  rejected: { row: number; reason: string }[];
}

export interface ImportSummary extends ImportPreview {
  importId: string;
}

/** The period budget as the store keeps it. Supabase holds it in the database, the CLI in a JSON file. */
export interface BudgetAccess extends Ledger {
  status(now?: Date): Promise<BudgetStatus>;
  setLimits(limits: BudgetLimits): Promise<BudgetLimits>;
  /** Looks up held runs that ended and settles them. */
  reconcile(runner: { getRun(runId: string): Promise<{ status: string; actualCost?: number | string | null }> }, now?: Date): Promise<void>;
}

/**
 * The one data interface the app uses. Two implementations: Supabase (row level security does the owner filter)
 * and an in-memory store for the demo and the CLI. Pages and route handlers only see this interface.
 */
export interface NetworkStore {
  readonly demo: boolean;
  readonly budget: BudgetAccess;
  search(spec: SearchSpec): Promise<{ people: Person[]; total: number }>;
  getPeople(ids: string[]): Promise<Person[]>;
  getDetail(id: string): Promise<{ person: Person; sources: PersonSource[]; enrichments: EnrichmentRow[] } | null>;
  stats(): Promise<Stats>;
  companies(q?: string | null): Promise<CompanyGroup[]>;
  deletePerson(id: string): Promise<boolean>;
  /** Stored people that could be the same person as one of these inputs. */
  findCandidates(inputs: PersonInput[]): Promise<Person[]>;
  /** Writes an import plan and its record. */
  commitImport(plan: ImportPlan, record: Omit<ImportRecord, "id" | "created_at">): Promise<string>;
  listImports(): Promise<ImportRecord[]>;
  listSaved(): Promise<SavedSearch[]>;
  addSaved(name: string, query: string): Promise<SavedSearch>;
  removeSaved(id: string): Promise<boolean>;
  /** Writes the outcome of one paid call and the facts it found. */
  recordEnrichment(row: Omit<EnrichmentRow, "id" | "created_at">, patch: Partial<Person> | null): Promise<void>;
  listEnrichments(limit?: number): Promise<EnrichmentRow[]>;
}

export type { ParseResult };
