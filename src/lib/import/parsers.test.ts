import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guessMapping, detectFormat, parseGeneric, parseGoogle, parseImport, parseLinkedIn, parseXFollowing } from "./parsers";
import { parseCsv, sniffDelimiter, toCsv } from "./csv";

const ex = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../../examples", f), "utf8");

describe("csv", () => {
  it("reads quotes, escaped quotes, CRLF and embedded newlines", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n"line\none",z')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["line\none", "z"]]);
  });
  it("sniffs semicolons and tabs", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(sniffDelimiter("a\tb\tc")).toBe("\t");
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("writes cells that start with a formula character with a leading quote", () => {
    expect(toCsv([{ a: "=SUM(A1)", b: "x,y" }])).toBe("a,b\n'=SUM(A1),\"x,y\"");
  });
});

describe("LinkedIn Connections.csv", () => {
  const res = parseLinkedIn(ex("linkedin-Connections.example.csv"));
  it("is detected, including the notes lines above the header", () => {
    expect(detectFormat(ex("linkedin-Connections.example.csv"))).toBe("linkedin");
    expect(res.notes[0]).toMatch(/Skipped 2 lines/);
    expect(res.header).toEqual(["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"]);
  });
  it("reads people, normalises the profile URL and the date", () => {
    expect(res.people).toHaveLength(4);
    const [odile, teodor, wren, ibrahim] = res.people;
    expect(odile).toMatchObject({ full_name: "Odile Fenwick-Marsh", company: "Brightwell Payments", title: "Co-founder and CEO", connected_on: "2023-03-11", linkedin_url: "https://www.linkedin.com/in/odile-fenwick-marsh-example", emails: [], source: "linkedin" });
    expect(teodor.linkedin_url).toBe("https://www.linkedin.com/in/teodor-alvarenga-example");
    expect(teodor.emails).toEqual(["teodor.alvarenga@example.com"]);
    expect(wren.linkedin_url).toBe("https://www.linkedin.com/in/wren-castellanos-example");
    expect(ibrahim.linkedin_url).toBeUndefined();
  });
  it("keeps the original row and reports blank rows only when they have content", () => {
    expect(res.people[0].raw["Connected On"]).toBe("11 Mar 2023");
    expect(res.rows).toBe(4);
    expect(res.rejected).toEqual([]);
  });
  it("rejects a row with no name", () => {
    const r = parseLinkedIn("First Name,Last Name,URL,Email Address,Company,Position,Connected On\n,,https://www.linkedin.com/in/x,,Acme,CEO,");
    expect(r.people).toHaveLength(0);
    expect(r.rejected[0].reason).toBe("No name");
  });
});

describe("Google Contacts CSV", () => {
  const res = parseGoogle(ex("google-contacts.example.csv"));
  it("is detected", () => expect(detectFormat(ex("google-contacts.example.csv"))).toBe("google"));
  it("reads names, several emails, phone, city and labels", () => {
    expect(res.people).toHaveLength(3);
    const odile = res.people[0];
    expect(odile).toMatchObject({ full_name: "Odile Fenwick-Marsh", company: "Brightwell Payments", title: "Chief Executive Officer", location: "Paris, France", tags: ["Fintech"], notes: "Met at the Lisbon fintech meetup" });
    expect(odile.emails).toEqual(["odile@brightwell.example.com", "odile.fm@example.com"]);
    expect(odile.phones).toEqual(["+33 6 00 00 00 01"]);
    expect(odile.linkedin_url).toBe("https://www.linkedin.com/in/odile-fenwick-marsh-example");
    expect(odile.company_domain).toBe("brightwell.example.com");
  });
  it("splits ::: separated emails and keeps an organisation-only contact", () => {
    expect(res.people[1].emails).toEqual(["pia@quillon.example.com", "pia.d@example.com"]);
    expect(res.people[2].emails).toEqual(["orders@monas-bakery.example.com"]);
    expect(res.people[2].full_name).toBe("Mona's Bakery");
  });
});

describe("generic CSV", () => {
  const text = ex("generic.example.csv");
  it("guesses the mapping from header names", () => {
    const m = guessMapping(["Name", "Work email", "Employer", "Role", "City", "LinkedIn", "Tags"]);
    expect(m).toEqual({ full_name: 0, email: 1, company: 2, title: 3, location: 4, linkedin_url: 5, tags: 6 });
  });
  it("uses the guessed mapping and notes it", () => {
    const r = parseGeneric(text);
    expect(r.notes[0]).toMatch(/Check the mapping/);
    expect(r.people[0]).toMatchObject({ full_name: "Odile Fenwick-Marsh", company: "Brightwell Payments, Inc.", title: "CEO", location: "Paris", tags: ["fintech", "investor-intro"] });
    expect(r.people[0].linkedin_url).toBe("https://www.linkedin.com/in/odile-fenwick-marsh-example");
  });
  it("uses a mapping the user chose", () => {
    const r = parseGeneric("who,org,mail\nAda Example,Acme,ada@acme.example.com", { full_name: 0, company: 1, email: 2 });
    expect(r.notes).toEqual([]);
    expect(r.people[0]).toMatchObject({ full_name: "Ada Example", first_name: "Ada", last_name: "Example", company: "Acme", emails: ["ada@acme.example.com"], company_domain: "acme.example.com" });
  });
  it("rejects a row with neither a name nor an email", () => {
    const r = parseGeneric("name,email\n,\n,x");
    expect(r.rejected).toEqual([{ row: 2, reason: "No name and no email" }]);
  });
});

describe("X following.js", () => {
  const res = parseXFollowing(ex("following.example.js"));
  it("is detected from the assignment", () => expect(detectFormat(ex("following.example.js"))).toBe("x"));
  it("reads account ids and links, with placeholder names", () => {
    expect(res.people).toHaveLength(2);
    expect(res.people[0]).toMatchObject({ full_name: "X account 1000000001", source: "x", tags: ["x-following"] });
    expect(res.notes[0]).toMatch(/not names/);
  });
  it("reports broken JSON", () => {
    expect(parseXFollowing("window.YTD.following.part0 = [ {oops").people).toEqual([]);
  });
});

describe("parseImport", () => {
  it("detects and reads each fixture", () => {
    expect(parseImport(ex("linkedin-Connections.example.csv")).format).toBe("linkedin");
    expect(parseImport(ex("google-contacts.example.csv")).format).toBe("google");
    expect(parseImport(ex("generic.example.csv")).format).toBe("generic");
    expect(parseImport(ex("following.example.js"), { filename: "following.js" }).format).toBe("x");
  });
  it("honours a forced format", () => {
    expect(parseImport(ex("generic.example.csv"), { format: "generic" }).people).toHaveLength(2);
  });
});
