import { linkedInUrl, nameCompanyKey } from "@/lib/normalize";
import type { ImportRecord, Person, PersonSource, SavedSearch, SourceKind } from "@/lib/types";

/** The demo is built from this fixed date so screenshots and tests do not drift. */
export const DEMO_NOW = new Date("2026-10-12T09:00:00Z");

/** Small seeded generator (mulberry32). Same seed, same people. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Odile", "Teodor", "Wren", "Ibrahim", "Marek", "Pia", "Sunniva", "Lucan", "Imelda", "Corvin", "Nadezhda", "Osric", "Thessaly", "Bartholomew", "Anouk", "Perpetua", "Ignatius", "Saoirse", "Evander", "Keziah", "Lorcan", "Maelys", "Dorian", "Yseult", "Fenwick", "Calliope", "Rafferty", "Zinnia", "Alaric", "Brisa", "Cassian", "Delphine", "Emeric", "Fiora", "Gideon", "Harriet", "Ivo", "Juniper", "Kasimir", "Linnea"];
const LAST = ["Fenwick-Marsh", "Alvarenga", "Castellanos", "Okonjo-Reyes", "Sobczak", "Drummond", "Halvorsen", "Quillfeather", "Brambleton", "Oyelaran", "Vandermolen", "Thistlewood", "Marchetti", "Nakagawa-Pryce", "Ellingsworth", "Pennyfeather", "Abernathy-Zhou", "Dellacroix", "Stonehaven", "Rukavina", "Lindqvist", "Ferreira-Bell", "Okafor-Lund", "Whitlock", "Tarkovsky-Hale", "Moorcroft", "Bellweather", "Ashdown", "Kowalczyk", "Underhill"];

interface Co {
  name: string;
  slug: string;
  industry: string;
  city: string;
  blurb: string;
  titles: string[];
}

const COMPANIES: Co[] = [
  { name: "Brightwell Payments", slug: "brightwell", industry: "fintech", city: "Paris, France", blurb: "payments infrastructure for fintech teams", titles: ["Co-founder and CEO", "Founder", "Head of Engineering", "Staff Engineer", "Product Manager", "Head of Growth", "CFO"] },
  { name: "Kestrel Ledger", slug: "kestrel", industry: "fintech", city: "London, United Kingdom", blurb: "open banking and ledgers, fintech", titles: ["Founder", "CTO", "Senior Engineer", "Compliance Lead", "VP Sales"] },
  { name: "Lowmoor Capital", slug: "lowmoor", industry: "venture", city: "London, United Kingdom", blurb: "early-stage venture investor, fintech and climate", titles: ["Partner", "Investor", "Principal", "Venture Partner", "Analyst"] },
  { name: "Harborline Labs", slug: "harborline", industry: "logistics", city: "Rotterdam, Netherlands", blurb: "freight visibility software for logistics", titles: ["Co-founder and CEO", "Head of Product", "Software Engineer", "Designer", "Customer Success Manager"] },
  { name: "Tallowmere Freight", slug: "tallowmere", industry: "logistics", city: "Gdansk, Poland", blurb: "last-mile logistics operator", titles: ["Operations Lead", "Founder", "Fleet Manager", "Data Analyst"] },
  { name: "Quillon Robotics", slug: "quillon", industry: "robotics", city: "Leeds, United Kingdom", blurb: "warehouse robotics and machine learning", titles: ["Staff Engineer", "Founder and CTO", "Machine Learning Engineer", "Research Scientist", "Recruiter"] },
  { name: "Ardent Climate", slug: "ardent", industry: "climate", city: "Berlin, Germany", blurb: "carbon accounting for climate-focused companies", titles: ["Founder", "Head of Sustainability", "Data Scientist", "Product Designer", "Account Executive"] },
  { name: "Mossgate Health", slug: "mossgate", industry: "health", city: "Amsterdam, Netherlands", blurb: "digital health records for clinics", titles: ["Chief Medical Officer", "Founder", "Software Engineer", "Clinical Researcher", "Head of Partnerships"] },
  { name: "Sablewood Security", slug: "sablewood", industry: "security", city: "Austin, United States", blurb: "cloud security posture for devtools teams", titles: ["Founder", "CISO", "Security Engineer", "Sales Engineer", "VP Marketing"] },
  { name: "Pennyfold", slug: "pennyfold", industry: "fintech", city: "Lisbon, Portugal", blurb: "personal finance app, fintech consumer", titles: ["Co-founder", "Growth Marketer", "iOS Engineer", "Designer", "Head of Data"] },
  { name: "Orrin Analytics", slug: "orrin", industry: "ai", city: "San Francisco, United States", blurb: "AI analytics for revenue teams", titles: ["Founder and CEO", "Research Engineer", "Machine Learning Engineer", "Product Manager", "Head of Sales"] },
  { name: "Wickerby Retail", slug: "wickerby", industry: "retail", city: "Manchester, United Kingdom", blurb: "omnichannel retail brand", titles: ["Head of E-commerce", "Buyer", "Marketing Director", "Founder"] },
  { name: "Glassmoor Media", slug: "glassmoor", industry: "media", city: "New York, United States", blurb: "newsletter network and podcasts", titles: ["Editor in Chief", "Founder", "Producer", "Head of Partnerships", "Community Manager"] },
  { name: "Tern & Pike Legal", slug: "ternpike", industry: "legal", city: "Toronto, Canada", blurb: "legal operations and contract tooling", titles: ["Partner", "Legal Counsel", "Legal Engineer", "Founder"] },
  { name: "Nimbus Forge", slug: "nimbusforge", industry: "devtools", city: "Singapore", blurb: "developer tools and build infrastructure", titles: ["Co-founder and CTO", "Staff Engineer", "Developer Advocate", "Engineering Manager", "Designer"] },
  { name: "Cobaltine Energy", slug: "cobaltine", industry: "climate", city: "Oslo, Norway", blurb: "grid storage and energy software for climate projects", titles: ["Founder", "Head of Engineering", "Energy Analyst", "VP Business Development"] },
];

const SOURCES: SourceKind[] = ["linkedin", "linkedin", "linkedin", "linkedin", "linkedin", "linkedin", "google", "google", "csv", "x"];
const ELSEWHERE = ["Paris, France", "London, United Kingdom", "Berlin, Germany", "New York, United States", "Lisbon, Portugal", "Madrid, Spain", "Toronto, Canada", "Dublin, Ireland"];
const TAGS = ["met-at-conference", "investor-intro", "former-colleague", "customer", "advisor", "hiring", "friend"];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface DemoData {
  people: Person[];
  sources: PersonSource[];
  imports: ImportRecord[];
  saved: SavedSearch[];
}

/** 200 invented people. Names, companies and addresses are made up. Emails sit on example.com subdomains, which belong to nobody. */
export function seedDemo(count = 200): DemoData {
  const r = rng(20261012);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const people: Person[] = [];
  const sources: PersonSource[] = [];
  const used = new Set<string>();
  const imports: ImportRecord[] = [
    { id: id(9001), created_at: "2026-10-01T08:00:00Z", filename: "Connections.csv", source: "linkedin", rows: 0, added: 0, merged: 0, skipped: 0, rejected: [] },
    { id: id(9002), created_at: "2026-10-03T18:30:00Z", filename: "contacts.csv", source: "google", rows: 0, added: 0, merged: 0, skipped: 0, rejected: [] },
    { id: id(9003), created_at: "2026-10-05T10:15:00Z", filename: "founders-met-2026.csv", source: "csv", rows: 0, added: 0, merged: 0, skipped: 0, rejected: [] },
    { id: id(9004), created_at: "2026-10-06T21:00:00Z", filename: "following.js", source: "x", rows: 0, added: 0, merged: 0, skipped: 0, rejected: [] },
    { id: id(9005), created_at: "2026-10-09T17:00:00Z", filename: "Granola meetings", source: "granola", rows: 0, added: 0, merged: 0, skipped: 0, rejected: [] },
  ];
  const importOf: Record<string, ImportRecord> = { linkedin: imports[0], google: imports[1], csv: imports[2], x: imports[3], granola: imports[4] };

  for (let i = 0; people.length < count; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const full = `${first} ${last}`;
    const co = COMPANIES[Math.floor(r() * COMPANIES.length)];
    const key = nameCompanyKey(full, co.name)!;
    if (used.has(key)) continue;
    used.add(key);
    const source = pick(SOURCES);
    // Founders are over-represented on purpose: a network of founders is the usual case, and it gives the demo searches something to find.
    const title = r() < 0.3 ? co.titles[0] : pick(co.titles);
    const location = r() < 0.7 ? co.city : pick(ELSEWHERE);
    const slug = slugify(full);
    const hasEmail = source !== "x" && r() < (source === "google" ? 0.95 : 0.35);
    const email = hasEmail ? `${slugify(first)}.${slugify(last).replace(/-.*/, "")}@${co.slug}.example.com` : null;
    const isX = source === "x";
    const n = people.length + 1;
    const tags = [co.industry, ...(r() < 0.3 ? [pick(TAGS)] : [])];
    const month = 1 + Math.floor(r() * 12);
    const year = 2019 + Math.floor(r() * 8);
    const connected = `${year}-${String(month).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`;
    const person: Person = {
      id: id(n),
      created_at: importOf[source].created_at,
      updated_at: importOf[source].created_at,
      full_name: isX ? `@${slug.replace(/-/g, "_").slice(0, 14)}` : full,
      first_name: isX ? null : first,
      last_name: isX ? null : last,
      email,
      emails: email ? [email] : [],
      phones: source === "google" && r() < 0.6 ? [`+44 7700 9${String(10000 + n).slice(-5)}`] : [],
      linkedin_url: isX ? null : linkedInUrl(`linkedin.com/in/${slug}-${String(n).padStart(3, "0")}`),
      x_url: isX ? `https://x.com/${slug.replace(/-/g, "_").slice(0, 14)}` : null,
      company: isX ? null : co.name,
      company_domain: email ? `${co.slug}.example.com` : null,
      title: isX ? null : title,
      location: isX ? null : source === "linkedin" && r() < 0.5 ? null : location,
      headline: isX ? null : `${title} at ${co.name}. ${co.blurb[0].toUpperCase()}${co.blurb.slice(1)}.`,
      notes: r() < 0.12 ? "Met at a meetup. Promised an intro." : null,
      tags: isX ? ["x-following"] : tags,
      connected_on: source === "linkedin" || source === "csv" ? connected : null,
      source_kinds: [source],
      enriched: {},
      enriched_at: null,
    };
    people.push(person);
    const imp = importOf[source];
    imp.rows++;
    imp.added++;
    sources.push({ person_id: person.id, import_id: imp.id, source, filename: imp.filename, imported_at: imp.created_at, row_number: imp.rows, raw: rawFor(person) });
  }
  // A few people appear in two files, so the profile drawer shows two sources.
  for (const p of people.filter((_, k) => k % 17 === 3 && people[k].source_kinds[0] === "linkedin").slice(0, 6)) {
    p.source_kinds = ["linkedin", "google"];
    if (!p.email) {
      p.email = `${p.first_name!.toLowerCase()}@${slugify(p.company ?? "none")}.example.com`;
      p.emails = [p.email];
    }
    const imp = importOf.google;
    imp.rows++;
    imp.merged++;
    sources.push({ person_id: p.id, import_id: imp.id, source: "google", filename: imp.filename, imported_at: imp.created_at, row_number: imp.rows, raw: { "First Name": p.first_name ?? "", "Last Name": p.last_name ?? "", "E-mail 1 - Value": p.email, "Organization Name": p.company ?? "" } });
  }
  // Some people with an email were also met in a Granola meeting. The profile drawer shows the last-met date and the meeting title.
  const MEETINGS = ["Intro call", "Product demo", "Partnership sync", "Hiring chat", "Investor catch-up"];
  for (const [j, p] of people.filter((q, k) => k % 23 === 5 && q.email && q.source_kinds[0] !== "x").entries()) {
    const when = `2026-09-${String(3 + ((j * 3) % 25)).padStart(2, "0")}`;
    const title = `${MEETINGS[j % MEETINGS.length]} with ${p.company ?? "a guest"}`;
    p.source_kinds = [...p.source_kinds, "granola"];
    const imp = importOf.granola;
    imp.rows++;
    imp.merged++;
    sources.push({ person_id: p.id, import_id: imp.id, source: "granola", filename: imp.filename, imported_at: imp.created_at, row_number: imp.rows, raw: { Email: p.email!, Name: p.full_name, "Last met": when, "Meeting title": title, Meetings: String(1 + (j % 3)), "Note ids": "" } });
  }
  const saved: SavedSearch[] = [
    { id: id(8001), created_at: "2026-10-02T10:00:00Z", name: "Fintech founders in Paris", query: "founders in Paris at fintech" },
    { id: id(8002), created_at: "2026-10-04T10:00:00Z", name: "Climate people with an email", query: "climate with email" },
    { id: id(8003), created_at: "2026-10-07T10:00:00Z", name: "Investors in London", query: "investors in London" },
  ];
  return { people, sources, imports, saved };
}

function rawFor(p: Person): Record<string, string> {
  if (p.source_kinds[0] === "linkedin") return { "First Name": p.first_name ?? "", "Last Name": p.last_name ?? "", URL: p.linkedin_url ?? "", "Email Address": p.email ?? "", Company: p.company ?? "", Position: p.title ?? "", "Connected On": p.connected_on ?? "" };
  if (p.source_kinds[0] === "google") return { "First Name": p.first_name ?? "", "Last Name": p.last_name ?? "", "Organization Name": p.company ?? "", "Organization Title": p.title ?? "", "E-mail 1 - Value": p.email ?? "", "Phone 1 - Value": p.phones[0] ?? "", "Address 1 - City": p.location ?? "" };
  if (p.source_kinds[0] === "x") return { accountId: String(1000000000 + Number(p.id.slice(-4))), userLink: p.x_url ?? "" };
  return { Name: p.full_name, Employer: p.company ?? "", Role: p.title ?? "", City: p.location ?? "", Email: p.email ?? "" };
}
