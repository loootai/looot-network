import { Shell } from "@/components/shell/Shell";
import { requireSession } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { store, user } = await requireSession();
  const budget = await store.budget.status().catch(() => null);
  return (
    <Shell user={user} demo={store.demo} budget={budget}>
      {children}
    </Shell>
  );
}
