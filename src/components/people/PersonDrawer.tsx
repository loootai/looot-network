"use client";

import * as React from "react";
import { toast } from "sonner";
import { ExternalLink, Mail, Phone, Trash2 } from "lucide-react";
import { PersonAvatar, SourceChip } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { longDate, relative } from "@/lib/format";
import { usdPrecise } from "@/lib/money";
import type { EnrichmentRow } from "@/lib/store/types";
import type { Person, PersonSource } from "@/lib/types";
import { SOURCE_LABEL } from "@/lib/types";

interface Detail {
  person: Person;
  sources: PersonSource[];
  enrichments: EnrichmentRow[];
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-b border-border py-2 text-13 last:border-0">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </div>
);

/** Side panel for one person: what the network knows, which file rows it came from, and what enrichment found. */
export function PersonDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [detail, setDetail] = React.useState<{ id: string; data: Detail | null; error?: boolean } | null>(null);
  React.useEffect(() => {
    if (!id) return;
    let alive = true;
    fetch(`/api/people/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data: Detail) => alive && setDetail({ id, data }))
      .catch(() => alive && setDetail({ id, data: null, error: true }));
    return () => {
      alive = false;
    };
  }, [id]);
  const d = detail && detail.id === id ? detail : null;
  const p = d?.data?.person;

  const remove = async () => {
    if (!p || !window.confirm(`Remove ${p.full_name} from your network? The file you imported is not touched.`)) return;
    const res = await fetch(`/api/people/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed");
      onClose();
      window.location.reload();
    } else toast.error("Could not remove this person.");
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby="person-desc">
        <DialogTitle className="sr-only">{p?.full_name ?? "Person"}</DialogTitle>
        <DialogDescription id="person-desc" className="sr-only">Profile, sources and enrichment for this person</DialogDescription>
        {!d ? (
          <div className="grid gap-3 p-5"><Skeleton className="h-14 w-14 rounded-full" /><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-64" /><Skeleton className="h-40 w-full" /></div>
        ) : !p ? (
          <p className="p-5 text-13 text-muted-foreground">This person is no longer in your network.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
              <div className="flex items-start gap-3">
                <PersonAvatar name={p.full_name} size={56} />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-[-0.01em]">{p.full_name}</h2>
                  <p className="text-13 text-muted-foreground">{[p.title, p.company].filter(Boolean).join(" at ") || "No title or company"}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{p.source_kinds.map((s) => <SourceChip key={s} source={s} />)}{p.tags.map((t) => <Badge key={t} tone="outline">{t}</Badge>)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.email && <Button asChild size="sm"><a href={`mailto:${p.email}`}><Mail /> Email</a></Button>}
                {p.linkedin_url && <Button asChild size="sm"><a href={p.linkedin_url} target="_blank" rel="noreferrer noopener"><ExternalLink /> LinkedIn</a></Button>}
                {p.x_url && <Button asChild size="sm"><a href={p.x_url} target="_blank" rel="noreferrer noopener"><ExternalLink /> X</a></Button>}
              </div>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <dl>
                <Row label="Place">{p.location ?? <span className="text-muted-foreground">Not in your files</span>}</Row>
                <Row label="Headline">{p.headline ?? <span className="text-muted-foreground">-</span>}</Row>
                <Row label="Emails">{p.emails.length ? p.emails.map((e) => <span key={e} className="block font-mono text-xs">{e}</span>) : <span className="text-muted-foreground">None. Not every export includes them.</span>}</Row>
                {p.phones.length > 0 && <Row label="Phones">{p.phones.map((e) => <span key={e} className="flex items-center gap-1 font-mono text-xs"><Phone className="size-3" />{e}</span>)}</Row>}
                <Row label="Connected">{p.connected_on ? longDate(p.connected_on) : "-"}</Row>
                {p.notes && <Row label="Notes"><span className="whitespace-pre-wrap">{p.notes}</span></Row>}
              </dl>

              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
              {d!.data!.sources.length === 0 ? (
                <p className="mt-2 text-13 text-muted-foreground">No file rows are linked to this person.</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {d!.data!.sources.map((s, i) => (
                    <li key={`${s.import_id}-${i}`} className="rounded-md border border-border bg-surface p-3">
                      <p className="flex flex-wrap items-center gap-1.5 text-13"><SourceChip source={s.source} /> <span className="font-medium">{s.filename}</span> <span className="text-muted-foreground">imported {relative(s.imported_at)}</span></p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground">What the {SOURCE_LABEL[s.source]} file said</summary>
                        <dl className="mt-2 grid gap-0.5 text-xs">
                          {Object.entries(s.raw).filter(([, v]) => v).map(([k, v]) => (
                            <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"><dt className="truncate text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>
                          ))}
                        </dl>
                      </details>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enrichment</h3>
              {p.enriched_at ? (
                <dl className="mt-2">
                  {p.enriched.profile && <Row label="Profile">{[p.enriched.profile.title, p.enriched.profile.company, p.enriched.profile.location].filter(Boolean).join(", ") || "Nothing new found"}</Row>}
                  {p.enriched.company && <Row label="Company">{[p.enriched.company.industry, p.enriched.company.employees ? `${p.enriched.company.employees} people` : null, p.enriched.company.country].filter(Boolean).join(", ") || "Nothing new found"}</Row>}
                  {p.enriched.email && <Row label="Work email">{p.enriched.email.email || "None found"}</Row>}
                </dl>
              ) : (
                <p className="mt-2 text-13 text-muted-foreground">Not enriched. Enrichment is optional, paid, and shows its price first.</p>
              )}
              {d!.data!.enrichments.length > 0 && (
                <ul className="mt-2 grid gap-1 text-xs">
                  {d!.data!.enrichments.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5">
                      <span>{e.kind} <span className="text-muted-foreground">via {e.endpoint_id}</span></span>
                      <span className="tnum">{e.status === "pending" ? "pending" : e.status} {e.cost_micros > 0 ? usdPrecise(e.cost_micros) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
              <Button variant="danger" size="sm" onClick={remove}><Trash2 /> Remove</Button>
              <span className="text-xs text-muted-foreground">Added {relative(p.created_at)}</span>
            </div>
          </div>
        )}
      </SheetContent>
    </Dialog>
  );
}
