import { specFrom } from "../search/spec";
import type { NetworkStore } from "../store/types";
import type { Person } from "../types";
import type { z } from "zod";
import type { EnrichTargetSchema } from "../schemas";

/** The people a quote or a run covers, resolved on the server and cut to the server's limit. */
export async function resolveTargets(store: NetworkStore, t: z.infer<typeof EnrichTargetSchema>, max: number): Promise<{ people: Person[]; truncated: boolean }> {
  if (t.ids?.length) {
    const people = await store.getPeople(t.ids.slice(0, max + 1));
    return { people: people.slice(0, max), truncated: t.ids.length > max };
  }
  const spec = specFrom(t.query ?? "", t.filters ?? {}, { limit: max + 1, sort: "name" });
  const { people } = await store.search(spec);
  return { people: people.slice(0, max), truncated: people.length > max };
}
