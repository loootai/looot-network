"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, ChevronLeft, ChevronRight, Download, LayoutGrid, Link2, Mail, Rows3, Sparkles, X } from "lucide-react";
import { EmptyState, PersonAvatar, SourceChip } from "@/components/common";
import { PersonDrawer } from "@/components/people/PersonDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { longDate, num } from "@/lib/format";
import type { SavedSearch, Person, SourceKind } from "@/lib/types";
import { SOURCE_KINDS, SOURCE_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ExplorerProps {
  mode: "people" | "search";
  q: string;
  people: Person[];
  total: number;
  explain: string[];
  offset: number;
  pageSize: number;
  sort: string;
  saved: SavedSearch[];
  tags: { tag: string; n: number }[];
  totalInNetwork: number;
}

const EXAMPLES = ["founders in Paris at fintech", "who works at Brightwell", "engineers with email", "investors in London", "head of engineering", "tagged climate"];

/** The People table and the Search page. The URL holds every filter, so a result can be shared, saved and exported. */
export function PeopleExplorer(props: ExplorerProps) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [text, setText] = React.useState(props.q);
  const [view, setView] = React.useState<"table" | "cards">(props.mode === "search" ? "cards" : "table");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saved, setSaved] = React.useState(props.saved);
  const personId = sp.get("person");

  // Follow the URL when it changes from outside (a saved search, the back button).
  const [seenQ, setSeenQ] = React.useState(props.q);
  if (seenQ !== props.q) {
    setSeenQ(props.q);
    setText(props.q);
  }

  const go = React.useCallback(
    (mutate: (p: URLSearchParams) => void, resetPage = true) => {
      const p = new URLSearchParams(sp.toString());
      mutate(p);
      if (resetPage) p.delete("offset");
      const qs = p.toString();
      startTransition(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }));
    },
    [sp, router, path],
  );

  // Debounced search as you type.
  React.useEffect(() => {
    if (text === props.q) return;
    const t = setTimeout(() => go((p) => (text.trim() ? p.set("q", text) : p.delete("q"))), 280);
    return () => clearTimeout(t);
  }, [text, props.q, go]);

  const sources = sp.getAll("source");
  const toggleSource = (s: SourceKind) => go((p) => {
    const cur = p.getAll("source");
    p.delete("source");
    (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]).forEach((x) => p.append("source", x));
  });
  const flag = (k: string) => sp.get(k) === "1";
  const toggleFlag = (k: string) => go((p) => (p.get(k) === "1" ? p.delete(k) : p.set(k, "1")));
  const activeFilters = sources.length + sp.getAll("tag").length + (flag("email") ? 1 : 0) + (flag("linkedin") ? 1 : 0) + (sp.get("company") ? 1 : 0);

  const allOnPage = props.people.length > 0 && props.people.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected((cur) => {
    const next = new Set(cur);
    props.people.forEach((p) => (allOnPage ? next.delete(p.id) : next.add(p.id)));
    return next;
  });
  const toggleOne = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const exportHref = `/api/export?${(() => {
    const p = new URLSearchParams(sp.toString());
    p.delete("offset");
    p.delete("person");
    return p.toString();
  })()}`;
  const enrichHref = () => {
    if (selected.size) {
      try {
        sessionStorage.setItem("network:selection", JSON.stringify([...selected]));
      } catch {
        // Storage can be off. The Enrich page then falls back to the current search.
      }
      return "/enrich?selection=1";
    }
    const p = new URLSearchParams(sp.toString());
    p.delete("offset");
    p.delete("person");
    return `/enrich?${p.toString()}`;
  };

  const save = async () => {
    const res = await fetch("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: saveName, query: props.q }) });
    if (!res.ok) return toast.error("Could not save the search.");
    const { saved: s } = (await res.json()) as { saved: SavedSearch };
    setSaved((cur) => [...cur.filter((x) => x.name !== s.name), s]);
    setSaving(false);
    setSaveName("");
    toast.success(`Saved "${s.name}"`);
  };
  const removeSaved = async (id: string) => {
    const res = await fetch(`/api/saved/${id}`, { method: "DELETE" });
    if (res.ok) setSaved((cur) => cur.filter((x) => x.id !== id));
  };

  const openPerson = (id: string | null) => go((p) => (id ? p.set("person", id) : p.delete("person")), false);
  const from = props.total === 0 ? 0 : props.offset + 1;
  const to = Math.min(props.offset + props.pageSize, props.total);
  const isSearch = props.mode === "search";
  const hasQuery = !!props.q.trim() || activeFilters > 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
      {isSearch ? (
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Search your network</h1>
          <p className="mt-1 max-w-2xl text-13 text-muted-foreground">Write what you would say out loud. A fixed set of rules reads it into filters, and shows you the reading. No model is called.</p>
        </div>
      ) : (
        <div className="mb-4">
          <h1 className="sr-only">People</h1>
          <p className="tnum text-13 text-muted-foreground">{num(props.totalInNetwork)} in your network{hasQuery ? `, ${num(props.total)} match` : ""}</p>
        </div>
      )}

      <div className="relative">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search people"
          placeholder={isSearch ? "founders in Paris at fintech" : "Filter by name, company, title or place, or write a sentence"}
          className={cn(isSearch && "h-11 text-base sm:h-11 sm:text-base")}
        />
        {text && (
          <button type="button" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted" aria-label="Clear the search" onClick={() => { setText(""); go((p) => p.delete("q")); }}>
            <X className="size-4" />
          </button>
        )}
      </div>

      {props.explain.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label="How the search was read">
          <span>Read as</span>
          {props.explain.map((e) => (
            <Badge key={e} tone="outline">{e}</Badge>
          ))}
        </p>
      )}

      {isSearch && !hasQuery && (
        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground">Try one of these</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-13 hover:bg-muted max-sm:py-2.5" onClick={() => { setText(ex); go((p) => p.set("q", ex)); }}>
                {ex}
              </button>
            ))}
          </div>
          {saved.length > 0 && (
            <>
              <p className="mt-6 text-xs font-medium text-muted-foreground">Saved searches</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {saved.map((s) => (
                  <Link key={s.id} href={`${path}?q=${encodeURIComponent(s.query)}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-13 hover:bg-muted max-sm:py-2.5">
                    <Bookmark className="size-3.5 text-muted-foreground" /> {s.name}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {(!isSearch || hasQuery) && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            {SOURCE_KINDS.filter((s) => ["linkedin", "google", "csv", "x"].includes(s)).map((s) => (
              <button key={s} type="button" aria-pressed={sources.includes(s)} onClick={() => toggleSource(s)} className={cn("h-8 rounded-full border px-3 text-13 transition-colors max-sm:h-10", sources.includes(s) ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted")}>
                {SOURCE_LABEL[s]}
              </button>
            ))}
            <button type="button" aria-pressed={flag("email")} onClick={() => toggleFlag("email")} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-13 max-sm:h-10", flag("email") ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted")}>
              <Mail className="size-3.5" /> Has email
            </button>
            <button type="button" aria-pressed={flag("linkedin")} onClick={() => toggleFlag("linkedin")} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-13 max-sm:h-10", flag("linkedin") ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted")}>
              <Link2 className="size-3.5" /> Has LinkedIn
            </button>
            <Select aria-label="Tag" className="h-8 w-auto min-w-28 rounded-full max-sm:h-10" value={sp.get("tag") ?? ""} onChange={(e) => go((p) => (e.target.value ? p.set("tag", e.target.value) : p.delete("tag")))}>
              <option value="">Any tag</option>
              {props.tags.map((t) => (
                <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>
              ))}
            </Select>
            {sp.get("company") && (
              <Badge tone="positive" className="h-8 gap-1.5 pl-3 pr-2 text-13">
                {sp.get("company")}
                <button type="button" aria-label="Remove the company filter" onClick={() => go((p) => p.delete("company"))}><X className="size-3.5" /></button>
              </Badge>
            )}
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={() => go((p) => { ["source", "tag", "email", "linkedin", "company"].forEach((k) => p.delete(k)); })}>Clear filters</Button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-border py-2">
            <p className="tnum text-13 text-muted-foreground" aria-live="polite">
              {pending ? "Searching" : props.total === 0 ? "No match" : `${num(from)} to ${num(to)} of ${num(props.total)}`}
              {selected.size > 0 && <span className="ml-2 font-medium text-foreground">{selected.size} selected</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Sort" className="h-8 w-auto max-sm:h-10" value={props.sort} onChange={(e) => go((p) => p.set("sort", e.target.value))}>
                <option value="relevance">Best match</option>
                <option value="name">Name</option>
                <option value="company">Company</option>
                <option value="recent">Recently connected</option>
              </Select>
              <div className="flex rounded-md border border-border-strong" role="group" aria-label="View">
                <button type="button" aria-pressed={view === "table"} aria-label="Table view" onClick={() => setView("table")} className={cn("grid size-8 place-items-center rounded-l-md max-sm:size-10", view === "table" ? "bg-muted" : "hover:bg-muted/60")}><Rows3 className="size-4" /></button>
                <button type="button" aria-pressed={view === "cards"} aria-label="Card view" onClick={() => setView("cards")} className={cn("grid size-8 place-items-center rounded-r-md border-l border-border-strong max-sm:size-10", view === "cards" ? "bg-muted" : "hover:bg-muted/60")}><LayoutGrid className="size-4" /></button>
              </div>
              {props.q.trim() && (
                <Button variant="outline" onClick={() => setSaving((v) => !v)} aria-expanded={saving}><Bookmark /> Save search</Button>
              )}
              <Button asChild variant="outline"><a href={exportHref} download><Download /> Export CSV</a></Button>
              <Button asChild variant="primary"><Link href={enrichHref()}><Sparkles /> Enrich{selected.size ? ` ${selected.size}` : ""}</Link></Button>
            </div>
          </div>

          {saving && (
            <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (saveName.trim()) void save(); }}>
              <Input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this search" aria-label="Name of the saved search" className="max-w-xs" />
              <Button type="submit" variant="primary" disabled={!saveName.trim()}>Save</Button>
              <Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button>
            </form>
          )}

          {!isSearch && saved.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Saved</span>
              {saved.map((s) => (
                <span key={s.id} className="inline-flex items-center rounded-full border border-border bg-surface">
                  <Link href={`${path}?q=${encodeURIComponent(s.query)}`} className="px-2.5 py-1 text-13 text-foreground hover:underline">{s.name}</Link>
                  <button type="button" aria-label={`Remove saved search ${s.name}`} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted" onClick={() => removeSaved(s.id)}><X className="size-3" /></button>
                </span>
              ))}
            </p>
          )}

          <div className={cn("mt-3 transition-opacity", pending && "opacity-60")}>
            {props.people.length === 0 ? (
              <EmptyState title={props.totalInNetwork === 0 ? "Nobody here yet" : "Nobody matches"} action={props.totalInNetwork === 0 ? <Button asChild variant="primary"><Link href="/imports">Import a file</Link></Button> : undefined}>
                {props.totalInNetwork === 0 ? "Export your connections from LinkedIn or Google Contacts and import the file. It stays in your own Supabase project." : "Loosen the filters, or try fewer words. Typos in names are forgiven."}
              </EmptyState>
            ) : view === "table" ? (
              <>
                <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
                  <Table>
                    <thead>
                      <tr>
                        <Th className="w-10"><Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label="Select everyone on this page" /></Th>
                        <Th>Name</Th>
                        <Th>Company</Th>
                        <Th>Title</Th>
                        <Th>Place</Th>
                        <Th>Email</Th>
                        <Th>Source</Th>
                        <Th className="hidden 2xl:table-cell">Connected</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.people.map((p) => (
                        <tr key={p.id} className={cn("group cursor-pointer hover:bg-muted/50", personId === p.id && "bg-muted/70")} onClick={() => openPerson(p.id)}>
                          <Td onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} aria-label={`Select ${p.full_name}`} /></Td>
                          <Td>
                            <button type="button" className="flex items-center gap-2.5 text-left font-medium" onClick={(e) => { e.stopPropagation(); openPerson(p.id); }}>
                              <PersonAvatar name={p.full_name} size={24} />
                              <span className="truncate">{p.full_name}</span>
                            </button>
                          </Td>
                          <Td className="max-w-48 truncate">{p.company ?? <span className="text-muted-foreground">-</span>}</Td>
                          <Td className="max-w-56 truncate text-muted-foreground">{p.title ?? "-"}</Td>
                          <Td className="max-w-36 truncate text-muted-foreground">{p.location ?? "-"}</Td>
                          <Td className="max-w-44 truncate font-mono text-xs text-muted-foreground">{p.email ?? "-"}</Td>
                          <Td><span className="flex gap-1">{p.source_kinds.map((s) => <SourceChip key={s} source={s} />)}</span></Td>
                          <Td className="tnum hidden whitespace-nowrap text-muted-foreground 2xl:table-cell">{p.connected_on ? longDate(p.connected_on) : "-"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:hidden">
                  {props.people.map((p) => <PersonCard key={p.id} p={p} selected={selected.has(p.id)} onToggle={() => toggleOne(p.id)} onOpen={() => openPerson(p.id)} />)}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {props.people.map((p) => <PersonCard key={p.id} p={p} selected={selected.has(p.id)} onToggle={() => toggleOne(p.id)} onOpen={() => openPerson(p.id)} />)}
              </div>
            )}
          </div>

          {props.total > props.pageSize && (
            <div className="mt-4 flex items-center justify-between">
              <Button variant="outline" disabled={props.offset === 0} onClick={() => go((p) => (props.offset - props.pageSize <= 0 ? p.delete("offset") : p.set("offset", String(props.offset - props.pageSize))), false)}><ChevronLeft /> Previous</Button>
              <span className="tnum text-13 text-muted-foreground">Page {Math.floor(props.offset / props.pageSize) + 1} of {Math.ceil(props.total / props.pageSize)}</span>
              <Button variant="outline" disabled={props.offset + props.pageSize >= props.total} onClick={() => go((p) => p.set("offset", String(props.offset + props.pageSize)), false)}>Next <ChevronRight /></Button>
            </div>
          )}
        </>
      )}

      <PersonDrawer id={personId} onClose={() => openPerson(null)} />
    </div>
  );
}

function PersonCard({ p, selected, onToggle, onOpen }: { p: Person; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border bg-surface p-3 transition-colors hover:bg-muted/40", selected ? "border-primary" : "border-border")}>
      <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${p.full_name}`} className="mt-1" />
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen}>
        <PersonAvatar name={p.full_name} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{p.full_name}</span>
          <span className="block truncate text-13 text-muted-foreground">{[p.title, p.company].filter(Boolean).join(" at ") || "No title or company"}</span>
          {p.location && <span className="block truncate text-xs text-muted-foreground">{p.location}</span>}
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {p.source_kinds.map((s) => <SourceChip key={s} source={s} />)}
            {p.email && <Badge tone="muted"><Mail /> email</Badge>}
          </span>
        </span>
      </button>
    </div>
  );
}
