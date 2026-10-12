import { randomUUID } from "node:crypto";
import { Budget, DEFAULT_LIMITS, type BudgetLimits, type BudgetStatus, type Ledger, type ReserveResult } from "../budget";
import { keysOf, type ImportPlan, PersonIndex } from "../dedupe";
import type { LoootRun } from "../looot";
import { companyGroups, searchMemory } from "../search/memory";
import type { SearchSpec } from "../search/spec";
import type { CompanyGroup, ImportRecord, Person, PersonInput, PersonSource, SavedSearch } from "../types";
import type { BudgetAccess, EnrichmentRow, NetworkStore, Stats } from "./types";
import type { DemoData } from "@/demo/seed";

/** A budget that holds nothing and reports defaults. The demo never calls looot, so there is nothing to hold. */
export class DemoBudget implements BudgetAccess {
  async recall(): Promise<LoootRun | null> {
    return null;
  }
  async reserve(): Promise<ReserveResult> {
    return { ok: true, shared: false };
  }
  async attach(): Promise<void> {}
  async settle(): Promise<void> {}
  async release(): Promise<void> {}
  async reconcile(): Promise<void> {}
  async setLimits(l: BudgetLimits): Promise<BudgetLimits> {
    return l;
  }
  async status(): Promise<BudgetStatus> {
    const day = { limitMicros: DEFAULT_LIMITS.dailyMicros, usedMicros: 0, reservedMicros: 0, remainingMicros: DEFAULT_LIMITS.dailyMicros };
    const month = { limitMicros: DEFAULT_LIMITS.monthlyMicros, usedMicros: 0, reservedMicros: 0, remainingMicros: DEFAULT_LIMITS.monthlyMicros };
    return { limits: DEFAULT_LIMITS, isDefault: true, day, month, remainingMicros: day.remainingMicros, reservations: 0 };
  }
}

export interface MemoryOptions {
  demo: boolean;
  budget?: BudgetAccess;
  makeId?: () => string;
  /** Id for a new person. The CLI derives it from the dedupe keys so the same file always gives the same ids, and so the same idempotency keys. */
  personId?: (input: PersonInput) => string;
  now?: () => Date;
}

/** Store in server memory. Used for the demo (seeded, writes last until restart) and for the CLI (loaded from files). */
export class MemoryStore implements NetworkStore {
  readonly demo: boolean;
  readonly budget: BudgetAccess;
  people: Person[] = [];
  sources: PersonSource[] = [];
  imports: ImportRecord[] = [];
  saved: SavedSearch[] = [];
  enrichments: EnrichmentRow[] = [];
  readonly #id: () => string;
  readonly #personId?: (input: PersonInput) => string;
  readonly #now: () => Date;

  constructor(opts: MemoryOptions, seed?: DemoData) {
    this.demo = opts.demo;
    this.budget = opts.budget ?? (opts.demo ? new DemoBudget() : (new Budget() as unknown as BudgetAccess));
    this.#id = opts.makeId ?? randomUUID;
    this.#personId = opts.personId;
    this.#now = opts.now ?? (() => new Date());
    if (seed) {
      this.people = seed.people.map((p) => ({ ...p }));
      this.sources = [...seed.sources];
      this.imports = seed.imports.map((i) => ({ ...i }));
      this.saved = [...seed.saved];
    }
  }

  async search(spec: SearchSpec) {
    return searchMemory(this.people, spec);
  }
  async getPeople(ids: string[]) {
    const set = new Set(ids);
    return this.people.filter((p) => set.has(p.id));
  }
  async getDetail(id: string) {
    const person = this.people.find((p) => p.id === id);
    if (!person) return null;
    return { person, sources: this.sources.filter((s) => s.person_id === id), enrichments: this.enrichments.filter((e) => e.person_id === id) };
  }
  async stats(): Promise<Stats> {
    const by_source: Record<string, number> = {};
    const tags = new Map<string, number>();
    for (const p of this.people) {
      for (const s of p.source_kinds) by_source[s] = (by_source[s] ?? 0) + 1;
      for (const t of p.tags) tags.set(t.toLowerCase(), (tags.get(t.toLowerCase()) ?? 0) + 1);
    }
    return {
      total: this.people.length,
      with_email: this.people.filter((p) => p.email).length,
      with_linkedin: this.people.filter((p) => p.linkedin_url).length,
      companies: new Set(this.people.map((p) => (p.company ?? "").trim().toLowerCase()).filter(Boolean)).size,
      enriched: this.people.filter((p) => p.enriched_at).length,
      by_source,
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([tag, n]) => ({ tag, n })),
    };
  }
  async companies(q?: string | null): Promise<CompanyGroup[]> {
    return companyGroups(this.people, q);
  }
  async deletePerson(id: string) {
    const n = this.people.length;
    this.people = this.people.filter((p) => p.id !== id);
    this.sources = this.sources.filter((s) => s.person_id !== id);
    return this.people.length < n;
  }
  async findCandidates(inputs: PersonInput[]): Promise<Person[]> {
    const index = new PersonIndex(this.people);
    const hit = new Map<string, Person>();
    for (const i of inputs) {
      const m = index.find(i);
      if (m) hit.set(m.person.id, m.person);
    }
    return [...hit.values()];
  }
  async commitImport(plan: ImportPlan, record: Omit<ImportRecord, "id" | "created_at">): Promise<string> {
    const at = this.#now().toISOString();
    const importId = this.#id();
    this.imports.unshift({ ...record, id: importId, created_at: at });
    const link = (personId: string, rows: PersonInput[]) => {
      for (const r of rows) this.sources.push({ import_id: importId, source: r.source, filename: record.filename, imported_at: at, row_number: this.sources.length + 1, raw: r.raw, person_id: personId });
    };
    for (const c of plan.creates) {
      const i = c.input;
      const k = keysOf(i);
      const p: Person = {
        id: this.#personId ? this.#personId(i) : this.#id(),
        created_at: at,
        updated_at: at,
        full_name: i.full_name,
        first_name: i.first_name ?? null,
        last_name: i.last_name ?? null,
        email: i.emails[0] ?? null,
        emails: i.emails,
        phones: i.phones,
        linkedin_url: k.linkedin ? `https://www.${k.linkedin}` : null,
        x_url: i.x_url ?? null,
        company: i.company ?? null,
        company_domain: i.company_domain ?? null,
        title: i.title ?? null,
        location: i.location ?? null,
        headline: i.headline ?? null,
        notes: i.notes ?? null,
        tags: i.tags,
        connected_on: i.connected_on ?? null,
        source_kinds: [i.source],
        enriched: {},
        enriched_at: null,
      };
      this.people.push(p);
      link(p.id, c.rows);
    }
    for (const u of plan.updates) {
      if (u.patch) Object.assign(u.person, u.patch, { updated_at: at });
      link(u.person.id, u.rows);
    }
    return importId;
  }
  async listImports() {
    return this.imports;
  }
  async listSaved() {
    return this.saved;
  }
  async addSaved(name: string, query: string) {
    const s: SavedSearch = { id: this.#id(), created_at: this.#now().toISOString(), name, query };
    this.saved = [...this.saved.filter((x) => x.name !== name), s];
    return s;
  }
  async removeSaved(id: string) {
    const n = this.saved.length;
    this.saved = this.saved.filter((s) => s.id !== id);
    return this.saved.length < n;
  }
  async recordEnrichment(row: Omit<EnrichmentRow, "id" | "created_at">, patch: Partial<Person> | null) {
    this.enrichments.unshift({ ...row, id: this.#id(), created_at: this.#now().toISOString() });
    const p = this.people.find((x) => x.id === row.person_id);
    if (p && patch) Object.assign(p, patch, { updated_at: this.#now().toISOString() });
  }
  async listEnrichments(limit = 200) {
    return this.enrichments.slice(0, limit);
  }
}

export type { Ledger };
