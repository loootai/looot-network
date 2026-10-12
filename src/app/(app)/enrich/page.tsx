import type { Metadata } from "next";
import { Suspense } from "react";
import { EnrichClient } from "@/components/enrich/EnrichClient";
import { ENRICH, KINDS, PRICES_AS_OF } from "@/lib/enrich/providers";
import { enrichEnabled, serverCapMicros, serverMaxPeople } from "@/lib/server";
import { requireSession } from "@/lib/store";

export const metadata: Metadata = { title: "Enrich" };

export default async function EnrichPage() {
  const { store } = await requireSession();
  const [history, budget, stats] = await Promise.all([store.listEnrichments(50), store.budget.status(), store.stats()]);
  const kinds = KINDS.map((k) => ({ kind: k, label: ENRICH[k].label, help: ENRICH[k].help, provider: ENRICH[k].provider, jobId: ENRICH[k].jobId, endpointId: ENRICH[k].endpointId, fallbackMicros: ENRICH[k].fallbackMicros, shapeVerified: ENRICH[k].shapeVerified }));
  return (
    <Suspense>
      <EnrichClient kinds={kinds} history={history} budget={budget} enabled={enrichEnabled()} demo={store.demo} capMicros={serverCapMicros()} maxPeople={serverMaxPeople()} pricesAsOf={PRICES_AS_OF} total={stats.total} />
    </Suspense>
  );
}
