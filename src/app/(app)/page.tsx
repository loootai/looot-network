import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleExplorer } from "@/components/people/PeopleExplorer";
import { loadPeople, PAGE_SIZE } from "@/lib/pageData";
import { requireSession } from "@/lib/store";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { store } = await requireSession();
  const [page, stats, saved] = await Promise.all([loadPeople(store, await searchParams), store.stats(), store.listSaved()]);
  return (
    <Suspense>
      <PeopleExplorer mode="people" {...page} pageSize={PAGE_SIZE} saved={saved} tags={stats.tags} totalInNetwork={stats.total} />
    </Suspense>
  );
}
