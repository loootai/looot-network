import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { seedDemo } from "@/demo/seed";
import { parseImport } from "../import/parsers";
import { previewImport, runImport } from "../import/run";
import { specFrom } from "../search/spec";
import { DemoBudget, MemoryStore } from "./memoryStore";

const ex = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../../examples", f), "utf8");
const fresh = () => new MemoryStore({ demo: true, budget: new DemoBudget() });

describe("importing into the store", () => {
  it("adds the LinkedIn file, then adds nobody when the same file comes again", async () => {
    const store = fresh();
    const first = await runImport(store, parseImport(ex("linkedin-Connections.example.csv")), "Connections.csv");
    expect(first).toMatchObject({ rows: 4, added: 4, merged: 0 });
    expect(store.people).toHaveLength(4);
    const again = await runImport(store, parseImport(ex("linkedin-Connections.example.csv")), "Connections.csv");
    expect(again).toMatchObject({ added: 0, merged: 0, unchanged: 4 });
    expect(store.people).toHaveLength(4);
    expect(store.imports).toHaveLength(2);
  });
  it("matches a Google contact to the LinkedIn person by LinkedIn URL and fills in what LinkedIn left out", async () => {
    const store = fresh();
    await runImport(store, parseImport(ex("linkedin-Connections.example.csv")), "Connections.csv");
    const preview = await previewImport(store, parseImport(ex("google-contacts.example.csv")));
    expect(preview.preview).toMatchObject({ added: 2, merged: 1 });
    await runImport(store, parseImport(ex("google-contacts.example.csv")), "contacts.csv");
    const odile = store.people.find((p) => p.full_name === "Odile Fenwick-Marsh")!;
    expect(odile.source_kinds).toEqual(["linkedin", "google"]);
    expect(odile.emails).toEqual(["odile@brightwell.example.com", "odile.fm@example.com"]);
    expect(odile.location).toBe("Paris, France");
    expect(odile.title).toBe("Co-founder and CEO");
    expect(store.people.filter((p) => p.full_name.startsWith("Odile"))).toHaveLength(1);
    const detail = (await store.getDetail(odile.id))!;
    expect(detail.sources.map((s) => s.source)).toEqual(["linkedin", "google"]);
  });
  it("folds a generic CSV row into the same person by name and company", async () => {
    const store = fresh();
    await runImport(store, parseImport(ex("linkedin-Connections.example.csv")), "Connections.csv");
    const out = await runImport(store, parseImport(ex("generic.example.csv")), "generic.csv");
    expect(out).toMatchObject({ added: 1, merged: 1 });
    expect(store.people.find((p) => p.full_name === "Odile Fenwick-Marsh")!.tags).toEqual(["fintech", "investor-intro"]);
  });
  it("searches what it imported", async () => {
    const store = fresh();
    await runImport(store, parseImport(ex("linkedin-Connections.example.csv")), "Connections.csv");
    const r = await store.search(specFrom("founders", {}, {}));
    expect(r.people.map((p) => p.full_name).sort()).toEqual(["Odile Fenwick-Marsh", "Wren Castellanos"]);
  });
});

describe("store housekeeping", () => {
  it("deletes a person with their sources and saves searches by name", async () => {
    const store = new MemoryStore({ demo: true }, seedDemo());
    const id = store.people[0].id;
    expect(await store.deletePerson(id)).toBe(true);
    expect(store.sources.some((s) => s.person_id === id)).toBe(false);
    expect(await store.deletePerson(id)).toBe(false);
    await store.addSaved("a", "x");
    await store.addSaved("a", "y");
    expect((await store.listSaved()).filter((s) => s.name === "a")).toEqual([expect.objectContaining({ query: "y" })]);
  });
  it("reports totals", async () => {
    const s = await new MemoryStore({ demo: true }, seedDemo()).stats();
    expect(s.total).toBe(200);
    expect(s.by_source.linkedin).toBeGreaterThan(100);
    expect(s.tags.length).toBeGreaterThan(5);
  });
});
