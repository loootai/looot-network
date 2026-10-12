import { companyKey, nameCompanyKey, normalizeEmail, normalizeLinkedIn, normalizeX } from "./normalize";
import type { Person, PersonInput } from "./types";

/** Every key a person can be matched on. Email and LinkedIn URL are strong. Name plus company is the last resort. */
export interface Keys {
  emails: string[];
  linkedin: string | null;
  x: string | null;
  nameCompany: string | null;
}

/** The match keys of a parsed person or a stored one. */
export function keysOf(p: { full_name: string; emails: string[]; linkedin_url?: string | null; x_url?: string | null; company?: string | null }): Keys {
  return {
    emails: [...new Set(p.emails.map(normalizeEmail).filter((e): e is string => !!e))],
    linkedin: normalizeLinkedIn(p.linkedin_url),
    x: normalizeX(p.x_url),
    nameCompany: nameCompanyKey(p.full_name, p.company),
  };
}

/** Why two people were treated as one. */
export type MatchReason = "email" | "linkedin" | "x" | "name_company";

/** A lookup of stored people by every key. Build it once per import. */
export class PersonIndex {
  readonly #email = new Map<string, Person>();
  readonly #linkedin = new Map<string, Person>();
  readonly #x = new Map<string, Person>();
  readonly #name = new Map<string, Person>();
  constructor(people: Person[] = []) {
    for (const p of people) this.add(p);
  }
  add(p: Person): void {
    const k = keysOf(p);
    for (const e of k.emails) this.#email.set(e, p);
    if (k.linkedin) this.#linkedin.set(k.linkedin, p);
    if (k.x) this.#x.set(k.x, p);
    if (k.nameCompany) this.#name.set(k.nameCompany, p);
  }
  /** The stored person this input matches, strongest key first. */
  find(input: PersonInput): { person: Person; reason: MatchReason } | null {
    const k = keysOf(input);
    if (k.linkedin && this.#linkedin.has(k.linkedin)) return { person: this.#linkedin.get(k.linkedin)!, reason: "linkedin" };
    for (const e of k.emails) if (this.#email.has(e)) return { person: this.#email.get(e)!, reason: "email" };
    if (k.x && this.#x.has(k.x)) return { person: this.#x.get(k.x)!, reason: "x" };
    if (k.nameCompany && this.#name.has(k.nameCompany)) return { person: this.#name.get(k.nameCompany)!, reason: "name_company" };
    return null;
  }
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Merges two parsed rows of the same person. The first row wins on conflicts. Lists are joined. */
export function mergeInputs(a: PersonInput, b: PersonInput): PersonInput {
  const pick = <K extends keyof PersonInput>(k: K): PersonInput[K] => (a[k] || b[k]) as PersonInput[K];
  return {
    full_name: a.full_name.length >= b.full_name.length ? a.full_name : b.full_name,
    first_name: pick("first_name"),
    last_name: pick("last_name"),
    emails: uniq([...a.emails, ...b.emails]),
    phones: uniq([...a.phones, ...b.phones]),
    linkedin_url: pick("linkedin_url"),
    x_url: pick("x_url"),
    company: pick("company"),
    company_domain: pick("company_domain"),
    title: pick("title"),
    location: pick("location"),
    headline: pick("headline"),
    notes: a.notes && b.notes && a.notes !== b.notes ? `${a.notes}\n${b.notes}` : pick("notes"),
    tags: uniq([...a.tags, ...b.tags]),
    connected_on: [a.connected_on, b.connected_on].filter(Boolean).sort()[0],
    source: a.source,
    raw: a.raw,
  };
}

/**
 * Collapses rows that describe the same person inside one import. Two rows are the same person when they share an
 * email, a LinkedIn URL, an X link or a name and company. Returns the people and how many rows were folded in.
 * Each person keeps every row it came from, so the profile drawer can show them all.
 */
export function dedupeBatch(inputs: PersonInput[]): { people: { input: PersonInput; rows: PersonInput[] }[]; folded: number } {
  const groups: { input: PersonInput; rows: PersonInput[]; keys: Keys }[] = [];
  const byKey = new Map<string, number>();
  const keyList = (k: Keys) => [...(k.linkedin ? [`l:${k.linkedin}`] : []), ...k.emails.map((e) => `e:${e}`), ...(k.x ? [`x:${k.x}`] : []), ...(k.nameCompany ? [`n:${k.nameCompany}`] : [])];
  let folded = 0;
  for (const row of inputs) {
    const keys = keysOf(row);
    const ks = keyList(keys);
    const hit = ks.map((k) => byKey.get(k)).find((i) => i !== undefined);
    if (hit === undefined) {
      groups.push({ input: row, rows: [row], keys });
      ks.forEach((k) => byKey.set(k, groups.length - 1));
    } else {
      const g = groups[hit];
      g.input = mergeInputs(g.input, row);
      g.rows.push(row);
      g.keys = keysOf(g.input);
      keyList(g.keys).forEach((k) => byKey.set(k, hit));
      folded++;
    }
  }
  return { people: groups.map(({ input, rows }) => ({ input, rows })), folded };
}

/** What an import would do with one stored person: the fields it fills in. Empty fields are never overwritten. */
export function patchFor(existing: Person, input: PersonInput): Partial<Person> | null {
  const patch: Partial<Person> = {};
  const fill = <K extends "first_name" | "last_name" | "linkedin_url" | "x_url" | "company" | "company_domain" | "title" | "location" | "headline" | "connected_on">(k: K, v: string | undefined) => {
    if (v && !existing[k]) (patch as Record<string, unknown>)[k] = v;
  };
  fill("first_name", input.first_name);
  fill("last_name", input.last_name);
  fill("linkedin_url", input.linkedin_url);
  fill("x_url", input.x_url);
  fill("company", input.company);
  fill("company_domain", input.company_domain);
  fill("title", input.title);
  fill("location", input.location);
  fill("headline", input.headline);
  fill("connected_on", input.connected_on);
  if (input.notes && !(existing.notes ?? "").includes(input.notes)) patch.notes = existing.notes ? `${existing.notes}\n${input.notes}` : input.notes;
  const emails = uniq([...existing.emails, ...input.emails]);
  if (emails.length !== existing.emails.length) {
    patch.emails = emails;
    patch.email = emails[0] ?? null;
  }
  const phones = uniq([...existing.phones, ...input.phones]);
  if (phones.length !== existing.phones.length) patch.phones = phones;
  const tags = uniq([...existing.tags, ...input.tags]);
  if (tags.length !== existing.tags.length) patch.tags = tags;
  if (!existing.source_kinds.includes(input.source)) patch.source_kinds = [...existing.source_kinds, input.source];
  return Object.keys(patch).length ? patch : null;
}

export interface ImportPlan {
  creates: { input: PersonInput; rows: PersonInput[] }[];
  updates: { person: Person; patch: Partial<Person> | null; input: PersonInput; rows: PersonInput[]; reason: MatchReason }[];
  /** Rows folded into another row of the same file. */
  folded: number;
}

/** Splits an import into new people and people that already exist. Pure: nothing is written. */
export function planImport(inputs: PersonInput[], existing: Person[]): ImportPlan {
  const { people, folded } = dedupeBatch(inputs);
  const index = new PersonIndex(existing);
  const plan: ImportPlan = { creates: [], updates: [], folded };
  for (const g of people) {
    const hit = index.find(g.input);
    if (!hit) {
      plan.creates.push(g);
      continue;
    }
    // Two groups can match the same stored person through different keys. Join them so one patch is written.
    const prior = plan.updates.find((u) => u.person.id === hit.person.id);
    if (prior) {
      prior.input = mergeInputs(prior.input, g.input);
      prior.rows = [...prior.rows, ...g.rows];
      prior.patch = patchFor(hit.person, prior.input);
      plan.folded++;
    } else plan.updates.push({ person: hit.person, patch: patchFor(hit.person, g.input), input: g.input, rows: g.rows, reason: hit.reason });
  }
  return plan;
}

export { companyKey };
