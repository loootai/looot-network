"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { EmptyState, PageIntro, SourceChip } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { MAP_FIELDS, type ColumnMapping, type ImportFormat } from "@/lib/import/parsers";
import type { ImportPreview } from "@/lib/store/types";
import { relative, num } from "@/lib/format";
import type { ImportRecord } from "@/lib/types";

interface PreviewResponse {
  format: ImportFormat;
  header: string[];
  mapping: ColumnMapping | null;
  sample: { name: string; company: string; title: string; email: string; linkedin: string; location: string }[];
  notes: string[];
  preview: ImportPreview;
}

const FORMAT_LABEL: Record<ImportFormat, string> = { linkedin: "LinkedIn Connections.csv", google: "Google Contacts CSV", x: "X archive following.js", generic: "Generic CSV" };
const FIELD_LABEL: Record<string, string> = { full_name: "Full name", first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone", linkedin_url: "LinkedIn URL", x_url: "X link", company: "Company", title: "Title", location: "Place", headline: "Headline", notes: "Notes", tags: "Tags", connected_on: "Connected on" };

const HOW = [
  ["LinkedIn", "Settings and privacy, Data privacy, Get a copy of your data. Pick Connections, request the archive, download it when LinkedIn emails you, and unzip it. Import Connections.csv. LinkedIn leaves most email addresses and all places out of this file."],
  ["Google Contacts and Gmail", "Open contacts.google.com, select all, Export, Google CSV. Gmail contacts are the same list. Import the CSV."],
  ["X", "Settings, Your account, Download an archive of your data. Unzip it and import data/following.js. The archive has account ids and links, not names."],
  ["Any CSV", "A header row and one person per row. You choose which column is which before anything is saved."],
];

/** Drop a file, see what it holds and what would change, then import. The file is read in the browser and sent to your own server. */
export function ImportClient({ imports, total, demo }: { imports: ImportRecord[]; total: number; demo: boolean }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const [res, setRes] = React.useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "import" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState(false);

  const call = async (url: string, text: string, filename: string, map: ColumnMapping | null) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, filename, ...(map ? { mapping: map } : {}) }) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.error?.message ?? "The server refused the file.");
    return body;
  };

  const read = async (f: File) => {
    setError(null);
    setRes(null);
    if (f.size > 20_000_000) return setError("That file is over 20 MB. Split it and import the parts.");
    const text = await f.text();
    setFile({ name: f.name, text });
    setBusy("preview");
    try {
      const body = (await call("/api/import/preview", text, f.name, null)) as PreviewResponse;
      setRes(body);
      setMapping(body.mapping);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remap = async (next: ColumnMapping) => {
    setMapping(next);
    if (!file) return;
    try {
      setRes((await call("/api/import/preview", file.text, file.name, next)) as PreviewResponse);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const commit = async () => {
    if (!file) return;
    setBusy("import");
    setError(null);
    try {
      const out = await call("/api/import", file.text, file.name, mapping);
      toast.success(`${num(out.added)} added, ${num(out.merged)} updated`);
      setFile(null);
      setRes(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const p = res?.preview;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
      <PageIntro title="Imports">You export the files from LinkedIn, Google or X yourself and drop them here. Nothing is scraped, and no password is asked for. People are matched by email, LinkedIn URL, or name and company, so importing the same file twice adds nobody.</PageIntro>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void read(f); }}
        className={`grid place-items-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${drag ? "border-primary bg-positive-bg" : "border-border-strong bg-surface"}`}
      >
        <FileUp className="size-6 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-medium">Drop a file here</p>
        <p className="text-13 text-muted-foreground">Connections.csv, a Google Contacts CSV, following.js, or any CSV</p>
        <input ref={input} type="file" accept=".csv,.js,.txt,text/csv" className="sr-only" aria-label="Choose a file to import" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
        <Button variant="primary" className="mt-4" onClick={() => input.current?.click()} disabled={busy !== null}>{busy === "preview" ? <Loader2 className="animate-spin" /> : null} Choose a file</Button>
        {demo && <p className="mt-3 max-w-md text-xs text-muted-foreground">Demo: an import is added to the demo network in server memory and disappears when the demo restarts.</p>}
      </div>

      {error && <p role="alert" className="mt-3 rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-13 text-danger">{error}</p>}

      {res && p && file && (
        <section className="mt-5 rounded-lg border border-border bg-surface p-4" aria-label="Import preview">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{file.name}</h2>
            <Badge tone="positive">{FORMAT_LABEL[res.format]}</Badge>
          </div>
          {res.notes.map((n) => <p key={n} className="mt-1 text-13 text-muted-foreground">{n}</p>)}
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Rows read", p.rows], ["New people", p.added], ["Existing, with new details", p.merged], ["Same person twice in the file", p.folded]].map(([k, v]) => (
              <div key={k as string} className="rounded-md bg-muted px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tnum text-lg font-semibold">{num(v as number)}</dd></div>
            ))}
          </dl>
          {p.unchanged > 0 && <p className="mt-2 text-13 text-muted-foreground">{num(p.unchanged)} people are already in your network with nothing new from this file.</p>}
          {p.rejected.length > 0 && <p className="mt-2 text-13 text-warning">{p.rejected.length} rows were skipped: {p.rejected[0].reason.toLowerCase()} (row {p.rejected[0].row}){p.rejected.length > 1 ? ", and others" : ""}.</p>}

          {res.format === "generic" && mapping && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Which column is which</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {MAP_FIELDS.map((f) => (
                  <label key={f} className="grid gap-1 text-xs font-medium">
                    {FIELD_LABEL[f]}
                    <Select value={mapping[f] ?? ""} onChange={(e) => { const next = { ...mapping }; if (e.target.value === "") delete next[f]; else next[f] = Number(e.target.value); void remap(next); }}>
                      <option value="">Not in this file</option>
                      {res.header.map((h, i) => <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </Select>
                  </label>
                ))}
              </div>
            </div>
          )}

          {res.sample.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-md border border-border">
              <Table>
                <thead><tr><Th>Name</Th><Th>Company</Th><Th>Title</Th><Th>Email</Th><Th>Place</Th></tr></thead>
                <tbody>{res.sample.map((s, i) => <tr key={i}><Td>{s.name}</Td><Td>{s.company || "-"}</Td><Td>{s.title || "-"}</Td><Td className="font-mono text-xs">{s.email || "-"}</Td><Td>{s.location || "-"}</Td></tr>)}</tbody>
              </Table>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={commit} disabled={busy !== null || p.added + p.merged === 0}>{busy === "import" ? <Loader2 className="animate-spin" /> : null} Import {num(p.added + p.merged)} {p.added + p.merged === 1 ? "person" : "people"}</Button>
            <Button variant="ghost" onClick={() => { setFile(null); setRes(null); }}>Cancel</Button>
          </div>
        </section>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold">History</h2>
      {imports.length === 0 ? (
        <EmptyState title="No imports yet">Your network has {num(total)} people.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <Table>
            <thead><tr><Th>File</Th><Th>Format</Th><Th className="text-right">Rows</Th><Th className="text-right">Added</Th><Th className="text-right">Updated</Th><Th className="text-right">Skipped</Th><Th>When</Th></tr></thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <Td className="max-w-56 truncate font-medium">{i.filename}</Td>
                  <Td><SourceChip source={i.source} /></Td>
                  <Td className="tnum text-right">{num(i.rows)}</Td>
                  <Td className="tnum text-right">{num(i.added)}</Td>
                  <Td className="tnum text-right">{num(i.merged)}</Td>
                  <Td className="tnum text-right text-muted-foreground">{num(i.skipped)}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{relative(i.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold">How to export each one</h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        {HOW.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface p-4"><dt className="text-sm font-medium">{k}</dt><dd className="mt-1 text-13 text-muted-foreground">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}
