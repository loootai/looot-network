import type { CompanyGroup, Person } from "../types";
import type { SearchSpec } from "./spec";
import { similarity, wordSimilarity } from "./trigram";

/** Word-similarity cut-off for typo tolerance. The SQL function uses the same number. */
export const FUZZY_MIN = 0.55;

const words = (s: string | null | undefined) => (s ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text the full-text index covers: name, company, title, headline, location, tags and notes. */
function ftsWords(p: Person): string[] {
  return words([p.full_name, p.company, p.title, p.headline, p.location, p.tags.join(" "), p.notes].filter(Boolean).join(" "));
}
const haystack = (p: Person) => [p.full_name, p.company, p.title, p.location].filter(Boolean).join(" ").toLowerCase();

/** Every word of `phrase` is the start of some word in `ws`. Same as the SQL prefix tsquery joined with &. */
const prefixAll = (phrase: string, ws: string[]) => {
  const parts = words(phrase);
  return parts.length > 0 && parts.every((t) => ws.some((w) => w.startsWith(t)));
};

function matches(p: Person, s: SearchSpec): boolean {
  const fts = ftsWords(p);
  const hay = haystack(p);
  if (s.terms.length && !s.terms.every((t) => (words(t).length ? prefixAll(t, fts) : false) || wordSimilarity(t, hay) >= FUZZY_MIN)) return false;
  if (s.roles.length) {
    const text = `${p.title ?? ""} ${p.headline ?? ""}`;
    if (!s.roles.some((r) => new RegExp(`(^|[^\\p{L}\\p{N}_])${esc(r)}($|[^\\p{L}\\p{N}_])`, "iu").test(text))) return false;
  }
  if (s.companies.length && !s.companies.some((c) => (p.company ?? "").toLowerCase().includes(c.toLowerCase()) || prefixAll(c, fts))) return false;
  if (s.locations.length) {
    const loc = (p.location ?? "").toLowerCase();
    if (!s.locations.some((l) => loc.includes(l.toLowerCase()) || wordSimilarity(l.toLowerCase(), loc) >= FUZZY_MIN)) return false;
  }
  if (s.name) {
    const nameWords = words(p.full_name);
    if (!(prefixAll(s.name, nameWords) || similarity(p.full_name.toLowerCase(), s.name) >= 0.4)) return false;
  }
  if (s.companyExact && (p.company ?? "").trim().toLowerCase() !== s.companyExact) return false;
  if (s.hasEmail !== null && !!p.email !== s.hasEmail) return false;
  if (s.hasLinkedin !== null && !!p.linkedin_url !== s.hasLinkedin) return false;
  if (s.sources.length && !p.source_kinds.some((k) => s.sources.includes(k))) return false;
  if (s.tags.length) {
    const have = p.tags.map((t) => t.toLowerCase());
    if (!s.tags.every((t) => have.includes(t.toLowerCase()))) return false;
  }
  return true;
}

function rank(p: Person, s: SearchSpec): number {
  const fts = ftsWords(p);
  let r = 0;
  for (const t of s.terms) r += fts.filter((w) => w.startsWith(t)).length * 0.1;
  if (s.terms.length) r += similarity(p.full_name.toLowerCase(), s.terms.join(" "));
  for (const c of s.companies) if ((p.company ?? "").toLowerCase().includes(c.toLowerCase())) r += 0.5;
  return r;
}

/** Runs a search over people held in memory. Used by the demo and the CLI. The SQL function search_people() is the reference for the same rules. */
export function searchMemory(people: Person[], s: SearchSpec): { people: Person[]; total: number } {
  const hits = people.filter((p) => matches(p, s));
  // X handles ("@name") have no real name, so they sort after the people who do.
  const byName = (a: Person, b: Person) => Number(a.full_name.startsWith("@")) - Number(b.full_name.startsWith("@")) || a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase()) || a.id.localeCompare(b.id);
  const ranks = new Map(hits.map((p) => [p.id, rank(p, s)]));
  const sorters: Record<string, (a: Person, b: Person) => number> = {
    relevance: (a, b) => ranks.get(b.id)! - ranks.get(a.id)! || byName(a, b),
    name: byName,
    company: (a, b) => (a.company ? 0 : 1) - (b.company ? 0 : 1) || (a.company ?? "").toLowerCase().localeCompare((b.company ?? "").toLowerCase()) || byName(a, b),
    recent: (a, b) => (b.connected_on ?? b.created_at.slice(0, 10)).localeCompare(a.connected_on ?? a.created_at.slice(0, 10)) || byName(a, b),
  };
  hits.sort(sorters[s.sort] ?? sorters.relevance);
  return { people: hits.slice(s.offset, s.offset + s.limit), total: hits.length };
}

/** People grouped by company (case and spacing ignored), biggest first. */
export function companyGroups(people: Person[], q?: string | null, limit = 500): CompanyGroup[] {
  const needle = (q ?? "").trim().toLowerCase();
  const map = new Map<string, { company: string; people: number; with_email: number; titles: Set<string> }>();
  for (const p of people) {
    const name = (p.company ?? "").trim();
    if (!name || (needle && !name.toLowerCase().includes(needle))) continue;
    const k = name.toLowerCase();
    const g = map.get(k) ?? { company: name, people: 0, with_email: 0, titles: new Set<string>() };
    g.people++;
    if (p.email) g.with_email++;
    if (p.title) g.titles.add(p.title);
    map.set(k, g);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].people - a[1].people || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([, g]) => ({ company: g.company, people: g.people, with_email: g.with_email, titles: [...g.titles].sort().slice(0, 3) }));
}
