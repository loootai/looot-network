import "server-only";
import { filtersFromParams, toParams } from "./search/params";
import { specFrom, type SortKey } from "./search/spec";
import type { NetworkStore } from "./store/types";
import type { Person } from "./types";

export const PAGE_SIZE = 50;

export interface PeoplePage {
  q: string;
  people: Person[];
  total: number;
  explain: string[];
  offset: number;
  sort: SortKey;
}

/** The people a page shows, read from its URL. Search runs on the server so the first paint already has rows. */
export async function loadPeople(store: NetworkStore, raw: Record<string, string | string[] | undefined>, opts: { emptyIsNothing?: boolean } = {}): Promise<PeoplePage> {
  const sp = toParams(raw);
  const q = (sp.get("q") ?? "").slice(0, 500);
  const sort = (["relevance", "name", "company", "recent"].includes(sp.get("sort") ?? "") ? sp.get("sort") : q ? "relevance" : "name") as SortKey;
  const offset = Math.max(0, Math.min(Number(sp.get("offset")) || 0, 1_000_000));
  const spec = specFrom(q, filtersFromParams(sp), { sort, limit: PAGE_SIZE, offset });
  if (opts.emptyIsNothing && spec.isEmpty) return { q, people: [], total: 0, explain: [], offset, sort };
  const { people, total } = await store.search(spec);
  return { q, people, total, explain: spec.explain, offset, sort };
}
