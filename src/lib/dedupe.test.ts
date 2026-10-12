import { describe, expect, it } from "vitest";
import { dedupeBatch, patchFor, planImport } from "./dedupe";
import { companyKey, nameCompanyKey, normalizeLinkedIn, normalizeX, toIsoDate, workDomain } from "./normalize";
import type { Person, PersonInput } from "./types";

const input = (o: Partial<PersonInput> & { full_name: string }): PersonInput => ({ emails: [], phones: [], tags: [], source: "csv", raw: {}, ...o });
const stored = (o: Partial<Person> & { full_name: string }): Person => ({
  id: "p1", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", first_name: null, last_name: null, email: null, emails: [], phones: [], linkedin_url: null, x_url: null, company: null, company_domain: null, title: null, location: null, headline: null, notes: null, tags: [], connected_on: null, source_kinds: ["linkedin"], enriched: {}, enriched_at: null, ...o,
});

describe("normalize", () => {
  it("reduces LinkedIn URLs to one key", () => {
    const keys = ["https://www.linkedin.com/in/Jane-Doe/", "linkedin.com/in/jane-doe", "https://fr.linkedin.com/in/jane-doe?trk=x#top", "http://linkedin.com/pub/jane-doe/1/2/3"];
    expect(new Set(keys.map(normalizeLinkedIn))).toEqual(new Set(["linkedin.com/in/jane-doe"]));
    expect(normalizeLinkedIn("https://www.linkedin.com/company/acme")).toBeNull();
    expect(normalizeLinkedIn("https://example.com/in/jane")).toBeNull();
    expect(normalizeLinkedIn("")).toBeNull();
  });
  it("folds company names without legal suffixes", () => {
    expect(companyKey("Stripe, Inc.")).toBe("stripe");
    expect(companyKey("Brightwell Payments SAS")).toBe("brightwell payments");
    expect(nameCompanyKey("Zoë Ångström", "Acme GmbH")).toBe("zoe angstrom|acme");
    expect(nameCompanyKey("Cher", "Acme")).toBeNull();
    expect(nameCompanyKey("Jane Doe", "")).toBeNull();
  });
  it("normalises X links, dates and work domains", () => {
    expect(normalizeX("https://twitter.com/intent/user?user_id=123")).toBe("x.com/i/user/123");
    expect(normalizeX("https://x.com/Jane_Doe")).toBe("x.com/jane_doe");
    expect(normalizeX("@Jane_Doe")).toBe("x.com/jane_doe");
    expect(toIsoDate("11 Mar 2023")).toBe("2023-03-11");
    expect(toIsoDate("Mar 11, 2023")).toBe("2023-03-11");
    expect(toIsoDate("13/03/2023")).toBe("2023-03-13");
    expect(toIsoDate("nonsense")).toBeUndefined();
    expect(workDomain("a@gmail.com")).toBeNull();
    expect(workDomain("a@acme.example.com")).toBe("acme.example.com");
  });
});

describe("dedupeBatch", () => {
  it("merges rows that share an email, a LinkedIn URL or a name and company", () => {
    const rows = [
      input({ full_name: "Jane Doe", company: "Acme, Inc.", linkedin_url: "https://www.linkedin.com/in/jane-doe", source: "linkedin" }),
      input({ full_name: "Jane Doe", emails: ["jane@acme.example.com"], company: "Acme", title: "CTO" }),
      input({ full_name: "J. Doe", emails: ["jane@acme.example.com"], phones: ["+1 555 0100"], tags: ["friend"] }),
      input({ full_name: "John Roe", company: "Acme" }),
    ];
    const { people, folded } = dedupeBatch(rows);
    expect(folded).toBe(2);
    expect(people).toHaveLength(2);
    expect(people[0].input).toMatchObject({ full_name: "Jane Doe", title: "CTO", emails: ["jane@acme.example.com"], phones: ["+1 555 0100"], tags: ["friend"], linkedin_url: "https://www.linkedin.com/in/jane-doe" });
    expect(people[0].rows).toHaveLength(3);
  });
  it("does not merge on a bare name", () => {
    expect(dedupeBatch([input({ full_name: "Jane Doe" }), input({ full_name: "Jane Doe" })]).people).toHaveLength(2);
  });
  it("chains merges: A shares an email with B, B shares a LinkedIn URL with C", () => {
    const { people } = dedupeBatch([
      input({ full_name: "A One", emails: ["a@x.example.com"] }),
      input({ full_name: "A One", emails: ["a@x.example.com"], linkedin_url: "https://www.linkedin.com/in/a-one" }),
      input({ full_name: "A One", linkedin_url: "linkedin.com/in/a-one", title: "VP" }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].input.title).toBe("VP");
  });
});

describe("planImport", () => {
  const existing = [stored({ id: "p1", full_name: "Jane Doe", company: "Acme", linkedin_url: "https://www.linkedin.com/in/jane-doe", emails: ["jane@old.example.com"], email: "jane@old.example.com" })];
  it("matches stored people by LinkedIn URL first, then email, then name and company", () => {
    const plan = planImport(
      [
        input({ full_name: "Jane D.", linkedin_url: "https://uk.linkedin.com/in/Jane-Doe/", emails: ["jane@acme.example.com"], title: "CTO" }),
        input({ full_name: "Jane Doe", company: "ACME Inc" }),
        input({ full_name: "New Person", company: "Zed" }),
      ],
      existing,
    );
    // Rows 1 and 2 reach the same stored person by different keys. They become one update.
    expect(plan.updates.map((u) => u.reason)).toEqual(["linkedin"]);
    expect(plan.updates[0].rows).toHaveLength(2);
    expect(plan.creates.map((c) => c.input.full_name)).toEqual(["New Person"]);
    expect(plan.folded).toBe(1);
    expect(plan.updates[0].patch).toMatchObject({ title: "CTO", emails: ["jane@old.example.com", "jane@acme.example.com"] });
    expect(plan.updates[0].patch?.email).toBe("jane@old.example.com");
  });
  it("never overwrites a stored field and returns no patch when nothing is new", () => {
    const p = stored({ full_name: "A B", company: "Keep", title: "Keep", source_kinds: ["csv"] });
    expect(patchFor(p, input({ full_name: "A B", company: "Other", title: "Other" }))).toBeNull();
    expect(patchFor(p, input({ full_name: "A B", location: "Paris" }))).toEqual({ location: "Paris" });
  });
  it("re-importing the same file adds nobody", () => {
    const rows = [input({ full_name: "Jane Doe", company: "Acme" })];
    const first = planImport(rows, []);
    expect(first.creates).toHaveLength(1);
    const again = planImport(rows, [stored({ full_name: "Jane Doe", company: "Acme", source_kinds: ["csv"] })]);
    expect(again.creates).toHaveLength(0);
    expect(again.updates[0].patch).toBeNull();
  });
});
