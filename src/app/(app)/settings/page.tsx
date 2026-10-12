import type { Metadata } from "next";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { readAllowList } from "@/lib/access";
import { enrichEnabled, serverCapMicros, serverMaxPeople } from "@/lib/server";
import { requireSession } from "@/lib/store";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { store, user } = await requireSession();
  const [budget, stats] = await Promise.all([store.budget.status(), store.stats()]);
  const allow = readAllowList();
  return <SettingsClient budget={budget} demo={store.demo} user={user} capMicros={serverCapMicros()} maxPeople={serverMaxPeople()} enrichEnabled={enrichEnabled()} allowCount={allow.emails.length + allow.domains.length} stats={stats} />;
}
