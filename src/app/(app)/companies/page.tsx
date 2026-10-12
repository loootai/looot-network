import type { Metadata } from "next";
import Link from "next/link";
import { Monogram, PageIntro, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { num } from "@/lib/format";
import { requireSession } from "@/lib/store";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { store } = await requireSession();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const groups = await store.companies(q);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
      <PageIntro title="Companies" actions={<span className="tnum text-13 text-muted-foreground">{num(groups.length)} companies</span>}>
        Everyone you know, grouped by the company in your files. Spelling and legal suffixes are ignored when grouping.
      </PageIntro>
      <form className="mb-4 flex max-w-md gap-2" role="search">
        <Input name="q" defaultValue={q} aria-label="Filter companies" placeholder="Filter companies" />
        <Button type="submit">Filter</Button>
      </form>
      {groups.length === 0 ? (
        <EmptyState title={q ? "No company matches" : "No companies yet"}>{q ? "Try fewer letters." : "Companies appear once you import people who have one."}</EmptyState>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
            <Table>
              <thead>
                <tr><Th>Company</Th><Th className="text-right">People</Th><Th className="text-right">With email</Th><Th>Titles you know there</Th></tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.company} className="hover:bg-muted/50">
                    <Td>
                      <Link href={`/?company=${encodeURIComponent(g.company)}`} className="flex items-center gap-2.5 font-medium hover:underline">
                        <Monogram name={g.company} size={24} /> {g.company}
                      </Link>
                    </Td>
                    <Td className="tnum text-right">{g.people}</Td>
                    <Td className="tnum text-right text-muted-foreground">{g.with_email}</Td>
                    <Td className="max-w-md truncate text-muted-foreground">{g.titles.join(", ") || "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 md:hidden">
            {groups.map((g) => (
              <li key={g.company}>
                <Link href={`/?company=${encodeURIComponent(g.company)}`} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                  <Monogram name={g.company} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{g.company}</span>
                    <span className="block truncate text-xs text-muted-foreground">{g.titles.join(", ") || "No titles"}</span>
                  </span>
                  <span className="tnum text-sm font-semibold">{g.people}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
