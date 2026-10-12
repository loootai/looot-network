import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleExplorer } from "@/components/people/PeopleExplorer";
import { loadPeople, PAGE_SIZE } from "@/lib/pageData";
import { requireSession } from "@/lib/store";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { store } = await requireSession();
  const [page, stats, saved] = await Promise.all([loadPeople(store, await searchParams, { emptyIsNothing: true }), store.stats(), store.listSaved()]);
  return (
    <Suspense>
      <PeopleExplorer mode="search" {...page} pageSize={PAGE_SIZE} saved={saved} tags={stats.tags} totalInNetwork={stats.total} />
    </Suspense>
  );
}
