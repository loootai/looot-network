import type { Metadata } from "next";
import { ImportClient } from "@/components/import/ImportClient";
import { requireSession } from "@/lib/store";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage() {
  const { store } = await requireSession();
  const [imports, stats] = await Promise.all([store.listImports(), store.stats()]);
  return <ImportClient imports={imports} total={stats.total} demo={store.demo} />;
}
