import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type BudgetLimits, type BudgetStatus, type PeriodStatus, type ReserveResult } from "../budget";
import { keysOf, PersonIndex, type ImportPlan } from "../dedupe";
import { RESERVE_TTL_MS, HARD_EXPIRY_MS, RESULT_TTL_MS } from "../budget";
import type { LoootRun } from "../looot";
import { toMicros, usd } from "../money";
import { rpcParams, type SearchSpec } from "../search/spec";
import type { CompanyGroup, ImportRecord, Person, PersonInput, PersonSource, SavedSearch } from "../types";
import type { BudgetAccess, EnrichmentRow, NetworkStore, Stats } from "./types";

const PERSON_COLS = "id,created_at,updated_at,full_name,first_name,last_name,email,emails,phones,linkedin_url,x_url,company,company_domain,title,location,headline,notes,tags,connected_on,source_kinds,enriched,enriched_at";
const CHUNK = 200;

const chunks = <T,>(a: T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const fail = (what: string, e: { message: string }) => new Error(`${what}: ${e.message}`);

const dayStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
const monthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

interface Window {
  budget: number | string;
  used: number | string;
  reserved: number | string;
}

function periodOf(w: Window): PeriodStatus {
  const limit = Number(w.budget);
  const used = Number(w.used);
  const reserved = Number(w.reserved);
  return { limitMicros: limit, usedMicros: used, reservedMicros: reserved, remainingMicros: Math.max(0, limit - used - reserved) };
}

/** The period budget on Supabase: five SQL functions and one table. Reserving is one locked transaction, so two runs cannot both pass. */
export class SupabaseBudget implements BudgetAccess {
  constructor(private readonly db: SupabaseClient) {}

  async status(now: Date = new Date()): Promise<BudgetStatus> {
    const { data, error } = await this.db.rpc("budget_status", { p_day_start: dayStart(now).toISOString(), p_month_start: monthStart(now).toISOString() });
    if (error) throw fail("budget status", error);
    const d = data as { isDefault: boolean; daily: Window; monthly: Window };
    const day = periodOf(d.daily);
    const month = periodOf(d.monthly);
    const reservations = await this.#heldCount();
    return { limits: { dailyMicros: day.limitMicros, monthlyMicros: month.limitMicros }, isDefault: d.isDefault, day, month, remainingMicros: Math.min(day.remainingMicros, month.remainingMicros), reservations };
  }

  async #heldCount(): Promise<number> {
    const { count } = await this.db.from("budget_reservations").select("id", { count: "exact", head: true }).eq("state", "reserved");
    return count ?? 0;
  }

  async setLimits(limits: BudgetLimits): Promise<BudgetLimits> {
    const { dailyMicros: d, monthlyMicros: m } = limits;
    if (!Number.isFinite(d) || !Number.isFinite(m) || d <= 0 || m <= 0) throw new Error("Budgets must be positive dollar amounts.");
    if (d > m) throw new Error("The daily budget cannot be above the monthly budget.");
    const next = { dailyMicros: Math.round(d), monthlyMicros: Math.round(m) };
    const { data: owner } = await this.db.auth.getUser();
    const { error } = await this.db.from("settings").upsert({ owner_id: owner.user?.id, daily_budget_micros: next.dailyMicros, monthly_budget_micros: next.monthlyMicros }, { onConflict: "owner_id" });
    if (error) throw fail("save budget", error);
    return next;
  }

  async recall(key: string, fingerprint: string, now: Date): Promise<LoootRun | null> {
    const { data, error } = await this.db.from("budget_reservations").select("fingerprint,run,created_at,state").eq("idempotency_key", key).maybeSingle();
    if (error) throw fail("recall", error);
    if (!data || data.state !== "settled" || !data.run || data.fingerprint !== fingerprint) return null;
    return now.getTime() - Date.parse(data.created_at) < RESULT_TTL_MS ? (data.run as LoootRun) : null;
  }

  async reserve(key: string, micros: number, now: Date, fingerprint = ""): Promise<ReserveResult> {
    const { data, error } = await this.db.rpc("reserve_budget", { p_key: key, p_amount: micros, p_fingerprint: fingerprint, p_day_start: dayStart(now).toISOString(), p_month_start: monthStart(now).toISOString() });
    if (error) throw fail("reserve budget", error);
    const r = data as { ok: boolean; shared?: boolean; scope?: "daily" | "monthly"; daily?: Window; monthly?: Window };
    if (r.ok) return { ok: true, shared: !!r.shared };
    const p = periodOf(r[r.scope === "monthly" ? "monthly" : "daily"]!);
    return { ok: false, message: `The ${r.scope} budget is reached: ${usd(p.usedMicros)} used and ${usd(p.reservedMicros)} reserved of ${usd(p.limitMicros)}. This call needs ${usd(micros)}. Raise the budget in Settings, or wait for the period to roll over.` };
  }

  async attach(key: string, runId: string): Promise<void> {
    const { error } = await this.db.rpc("hold_reservation", { p_key: key, p_looot_run_id: runId });
    if (error) throw fail("hold reservation", error);
  }

  async settle(key: string, _fingerprint: string, micros: number, now: Date, run?: LoootRun): Promise<void> {
    const { error } = await this.db.rpc("settle_reservation", { p_key: key, p_cost: micros, p_now: now.toISOString(), p_run: run ?? null });
    if (error) throw fail("settle reservation", error);
  }

  async release(key: string): Promise<void> {
    const { error } = await this.db.rpc("release_reservation", { p_key: key, p_now: new Date().toISOString() });
    if (error) throw fail("release reservation", error);
  }

  async reconcile(runner: { getRun(runId: string): Promise<{ status: string; actualCost?: number | string | null }> }, now: Date = new Date()): Promise<void> {
    const { data, error } = await this.db.from("budget_reservations").select("idempotency_key,looot_run_id,created_at,fingerprint").eq("state", "reserved").lte("created_at", new Date(now.getTime() - RESERVE_TTL_MS).toISOString()).limit(200);
    if (error) throw fail("reconcile", error);
    for (const r of data ?? []) {
      const age = now.getTime() - Date.parse(r.created_at);
      if (!r.looot_run_id) {
        if (age > HARD_EXPIRY_MS) await this.release(r.idempotency_key);
        continue;
      }
      let run: { status: string; actualCost?: number | string | null } | null = null;
      try {
        run = await runner.getRun(r.looot_run_id);
      } catch {
        if (age > HARD_EXPIRY_MS) await this.release(r.idempotency_key);
        continue;
      }
      if (!["completed", "failed", "blocked", "stopped"].includes(run.status)) continue;
      await this.settle(r.idempotency_key, r.fingerprint, toMicros(run.actualCost), now, run.status === "completed" ? ({ runId: r.looot_run_id, ...run } as LoootRun) : undefined);
    }
  }
}

type PeopleRow = Omit<Person, "enriched"> & { enriched: Person["enriched"] | null };
const toPerson = (r: PeopleRow): Person => ({ ...r, enriched: r.enriched ?? {} });

/** Store on Supabase. The client acts as the signed-in user, so row level security scopes every query to their rows. */
export class SupabaseStore implements NetworkStore {
  readonly demo = false;
  readonly budget: SupabaseBudget;
  constructor(private readonly db: SupabaseClient) {
    this.budget = new SupabaseBudget(db);
  }

  async search(spec: SearchSpec) {
    const { data, error } = await this.db.rpc("search_people", rpcParams(spec));
    if (error) throw fail("search", error);
    const hits = (data ?? []) as { id: string; total: number | string }[];
    if (!hits.length) return { people: [], total: 0 };
    const people = await this.getPeople(hits.map((h) => h.id));
    const order = new Map(hits.map((h, i) => [h.id, i]));
    people.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { people, total: Number(hits[0].total) };
  }

  async getPeople(ids: string[]): Promise<Person[]> {
    const out: Person[] = [];
    for (const c of chunks(ids)) {
      const { data, error } = await this.db.from("people").select(PERSON_COLS).in("id", c);
      if (error) {
        if (error.code === "22P02") continue;
        throw fail("read people", error);
      }
      out.push(...((data ?? []) as unknown as PeopleRow[]).map(toPerson));
    }
    return out;
  }

  async getDetail(id: string) {
    const [person] = await this.getPeople([id]);
    if (!person) return null;
    const [src, enr] = await Promise.all([
      this.db.from("person_sources").select("person_id,import_id,source,row_number,raw,created_at,imports(filename,created_at)").eq("person_id", id).order("created_at", { ascending: false }),
      this.db.from("enrichments").select("id,created_at,person_id,kind,idempotency_key,endpoint_id,looot_run_id,status,list_price_micros,cost_micros,message").eq("person_id", id).order("created_at", { ascending: false }),
    ]);
    if (src.error) throw fail("read sources", src.error);
    if (enr.error) throw fail("read enrichments", enr.error);
    const sources: PersonSource[] = (src.data ?? []).map((s) => {
      const imp = (Array.isArray(s.imports) ? s.imports[0] : s.imports) as { filename: string; created_at: string } | null;
      return { person_id: s.person_id, import_id: s.import_id, source: s.source, filename: imp?.filename ?? "", imported_at: imp?.created_at ?? s.created_at, row_number: s.row_number, raw: (s.raw ?? {}) as Record<string, string> };
    });
    const enrichments = (enr.data ?? []).map((e) => ({ ...e, list_price_micros: Number(e.list_price_micros), cost_micros: Number(e.cost_micros) })) as EnrichmentRow[];
    return { person, sources, enrichments };
  }

  async stats(): Promise<Stats> {
    const { data, error } = await this.db.rpc("people_stats");
    if (error) throw fail("stats", error);
    return data as Stats;
  }

  async companies(q?: string | null): Promise<CompanyGroup[]> {
    const { data, error } = await this.db.rpc("company_groups", { p_q: q?.trim() || null, p_limit: 500 });
    if (error) throw fail("companies", error);
    return ((data ?? []) as { company: string; people: number | string; with_email: number | string; titles: string[] | null }[]).map((g) => ({ company: g.company, people: Number(g.people), with_email: Number(g.with_email), titles: g.titles ?? [] }));
  }

  async deletePerson(id: string) {
    const { data, error } = await this.db.from("people").delete().eq("id", id).select("id");
    if (error) {
      if (error.code === "22P02") return false;
      throw fail("delete", error);
    }
    return (data?.length ?? 0) > 0;
  }

  async findCandidates(inputs: PersonInput[]): Promise<Person[]> {
    const keys = inputs.map(keysOf);
    const li = [...new Set(keys.map((k) => k.linkedin).filter((x): x is string => !!x))];
    const em = [...new Set(keys.flatMap((k) => k.emails))];
    const nm = [...new Set(keys.map((k) => k.nameCompany).filter((x): x is string => !!x))];
    const xs = [...new Set(keys.map((k) => k.x).filter((x): x is string => !!x))];
    const found = new Map<string, Person>();
    const add = (rows: unknown[] | null) => (rows as PeopleRow[] | null)?.forEach((r) => found.set(r.id, toPerson(r)));
    for (const c of chunks(li)) add((await this.db.from("people").select(PERSON_COLS).in("linkedin_key", c)).data);
    for (const c of chunks(em, 100)) add((await this.db.from("people").select(PERSON_COLS).overlaps("emails", c)).data);
    for (const c of chunks(nm)) add((await this.db.from("people").select(PERSON_COLS).in("name_key", c)).data);
    for (const c of chunks(xs)) add((await this.db.from("people").select(PERSON_COLS).in("x_key", c)).data);
    return [...found.values()];
  }

  async commitImport(plan: ImportPlan, record: Omit<ImportRecord, "id" | "created_at">): Promise<string> {
    const { data: imp, error: ie } = await this.db.from("imports").insert({ filename: record.filename, source: record.source, rows: record.rows, added: record.added, merged: record.merged, skipped: record.skipped, rejected: record.rejected }).select("id").single();
    if (ie) throw fail("save import", ie);
    const importId = imp.id as string;
    const links: { person_id: string; import_id: string; source: string; row_number: number; raw: Record<string, string> }[] = [];
    const rowFor = (i: PersonInput) => {
      const k = keysOf(i);
      return {
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
        linkedin_key: k.linkedin,
        x_key: k.x,
        name_key: k.nameCompany,
      };
    };
    let n = 0;
    for (const c of chunks(plan.creates, 500)) {
      let ids: string[];
      let kept = c;
      const res = await this.db.from("people").insert(c.map((g) => rowFor(g.input))).select("id");
      if (res.error?.code === "23505") {
        // A LinkedIn profile that is already stored. Write the rest one by one and skip the clash.
        ids = [];
        kept = [];
        for (const g of c) {
          const one = await this.db.from("people").insert(rowFor(g.input)).select("id").single();
          if (one.error) {
            if (one.error.code === "23505") continue;
            throw fail("save people", one.error);
          }
          ids.push(one.data.id);
          kept.push(g);
        }
      } else if (res.error) throw fail("save people", res.error);
      else ids = (res.data ?? []).map((r) => r.id as string);
      kept.forEach((g, i) => {
        for (const r of g.rows) links.push({ person_id: ids[i], import_id: importId, source: r.source, row_number: ++n, raw: r.raw });
      });
    }
    for (const group of chunks(plan.updates, 25)) {
      await Promise.all(
        group.map(async (u) => {
          if (u.patch) {
            const { error } = await this.db.from("people").update({ ...u.patch, updated_at: new Date().toISOString() }).eq("id", u.person.id);
            if (error) throw fail("update person", error);
          }
          for (const r of u.rows) links.push({ person_id: u.person.id, import_id: importId, source: r.source, row_number: ++n, raw: r.raw });
        }),
      );
    }
    for (const c of chunks(links, 500)) {
      const { error } = await this.db.from("person_sources").insert(c);
      if (error) throw fail("save sources", error);
    }
    return importId;
  }

  async listImports(): Promise<ImportRecord[]> {
    const { data, error } = await this.db.from("imports").select("id,created_at,filename,source,rows,added,merged,skipped,rejected").order("created_at", { ascending: false }).limit(200);
    if (error) throw fail("list imports", error);
    return (data ?? []) as ImportRecord[];
  }

  async listSaved(): Promise<SavedSearch[]> {
    const { data, error } = await this.db.from("saved_searches").select("id,created_at,name,query").order("created_at", { ascending: true });
    if (error) throw fail("list saved searches", error);
    return (data ?? []) as SavedSearch[];
  }

  async addSaved(name: string, query: string): Promise<SavedSearch> {
    const { data: owner } = await this.db.auth.getUser();
    const { data, error } = await this.db.from("saved_searches").upsert({ owner_id: owner.user?.id, name, query }, { onConflict: "owner_id,name" }).select("id,created_at,name,query").single();
    if (error) throw fail("save search", error);
    return data as SavedSearch;
  }

  async removeSaved(id: string) {
    const { data, error } = await this.db.from("saved_searches").delete().eq("id", id).select("id");
    if (error) {
      if (error.code === "22P02") return false;
      throw fail("delete saved search", error);
    }
    return (data?.length ?? 0) > 0;
  }

  async recordEnrichment(row: Omit<EnrichmentRow, "id" | "created_at">, patch: Partial<Person> | null) {
    const { error } = await this.db.from("enrichments").upsert(row, { onConflict: "owner_id,person_id,idempotency_key" });
    if (error) throw fail("save enrichment", error);
    if (patch) {
      const { error: ue } = await this.db.from("people").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", row.person_id);
      if (ue) throw fail("save facts", ue);
    }
  }

  async listEnrichments(limit = 200): Promise<EnrichmentRow[]> {
    const { data, error } = await this.db.from("enrichments").select("id,created_at,person_id,kind,idempotency_key,endpoint_id,looot_run_id,status,list_price_micros,cost_micros,message").order("created_at", { ascending: false }).limit(limit);
    if (error) throw fail("list enrichments", error);
    return (data ?? []).map((e) => ({ ...e, list_price_micros: Number(e.list_price_micros), cost_micros: Number(e.cost_micros) })) as EnrichmentRow[];
  }
}
