import { planImport, type ImportPlan } from "../dedupe";
import type { ImportPreview, ImportSummary, NetworkStore } from "../store/types";
import type { ParseResult } from "./parsers";

function previewOf(plan: ImportPlan, parsed: ParseResult): ImportPreview {
  return {
    rows: parsed.rows,
    added: plan.creates.length,
    merged: plan.updates.filter((u) => u.patch).length,
    unchanged: plan.updates.filter((u) => !u.patch).length,
    folded: plan.folded,
    rejected: parsed.rejected.slice(0, 50),
  };
}

/** Plans an import against the stored people. Writes nothing. */
export async function previewImport(store: NetworkStore, parsed: ParseResult): Promise<{ plan: ImportPlan; preview: ImportPreview }> {
  const existing = await store.findCandidates(parsed.people);
  const plan = planImport(parsed.people, existing);
  return { plan, preview: previewOf(plan, parsed) };
}

/** Parses nothing and plans everything: dedupes inside the file, matches against stored people, then writes. */
export async function runImport(store: NetworkStore, parsed: ParseResult, filename: string): Promise<ImportSummary> {
  const { plan, preview } = await previewImport(store, parsed);
  const importId = await store.commitImport(plan, {
    filename,
    source: parsed.source,
    rows: parsed.rows,
    added: preview.added,
    merged: preview.merged + preview.unchanged,
    skipped: preview.rejected.length,
    rejected: preview.rejected,
  });
  return { ...preview, importId };
}
