// Writes a SQL file for scripts/test-sql.sh: the demo people as inserts, then one check per query that compares the
// ids search_people() returns with the ids the in-memory search returns. Test code only; it never touches a real project.
import { seedDemo } from "../src/demo/seed";
import { searchMemory } from "../src/lib/search/memory";
import { rpcParams, specFrom } from "../src/lib/search/spec";
import { keysOf } from "../src/lib/dedupe";

const q = (v: string | null | undefined) => (v === null || v === undefined ? "null" : `'${v.replace(/'/g, "''")}'`);
const arr = (a: string[]) => `array[${a.map(q).join(",")}]::text[]`;
const OWNER = "11111111-1111-1111-1111-111111111111";

const { people } = seedDemo();
const lines: string[] = ["set role authenticated;", `set request.jwt.claim.sub = '${OWNER}';`];
for (const p of people) {
  const k = keysOf(p);
  lines.push(
    `insert into public.people (id, full_name, first_name, last_name, email, emails, phones, linkedin_url, x_url, company, company_domain, title, location, headline, notes, tags, connected_on, source_kinds, linkedin_key, x_key, name_key) values (${[
      q(p.id), q(p.full_name), q(p.first_name), q(p.last_name), q(p.email), arr(p.emails), arr(p.phones), q(p.linkedin_url), q(p.x_url), q(p.company), q(p.company_domain), q(p.title), q(p.location), q(p.headline), q(p.notes), arr(p.tags), p.connected_on ? q(p.connected_on) : "null", arr(p.source_kinds), q(k.linkedin), q(k.x), q(k.nameCompany),
    ].join(",")});`,
  );
}

const QUERIES: [string, Record<string, unknown>][] = [
  ["founders in Paris at fintech", {}],
  ["who works at Brightwell", {}],
  ["engineers with email", {}],
  ["investors in London", {}],
  ["climate", {}],
  ["head of engineering", {}],
  ["CTOs", {}],
  ["people from linkedin", {}],
  ["Odile", {}],
  ["tagged investor-intro", {}],
  ["engineers in Berlin or Paris or Lisbon", {}],
  ["Fenwick", {}],
  ["product managers at Orrin", {}],
  ["", { company: "Brightwell Payments" }],
  ["", { hasEmail: false, sources: ["google"] }],
];
QUERIES.forEach(([text, ui], i) => {
  const spec = specFrom(text, ui, { limit: 5000 });
  const want = searchMemory(people, spec).people.map((p) => p.id).sort();
  const p = rpcParams(spec);
  lines.push(
    `do $$ declare got text; want text := ${q(want.join(","))}; begin
  select coalesce(string_agg(id::text, ',' order by id), '') into got from public.search_people(${[arr(p.p_terms), arr(p.p_roles), arr(p.p_companies), arr(p.p_locations), q(p.p_name), q(p.p_company_exact), p.p_has_email === null ? "null::boolean" : String(p.p_has_email), p.p_has_linkedin === null ? "null::boolean" : String(p.p_has_linkedin), arr(p.p_sources), arr(p.p_tags), q(p.p_sort), String(p.p_limit), String(p.p_offset)].join(", ")});
  if got = want then raise notice 'PARITY ok % (% rows): %', ${i + 1}, ${want.length}, ${q(text || JSON.stringify(ui))};
  else raise notice 'PARITY FAIL % : % sql=% memory=%', ${i + 1}, ${q(text || JSON.stringify(ui))}, (select count(*) from unnest(string_to_array(got, ','))), ${want.length}; end if;
end $$;`,
  );
});
lines.push("reset role;");
console.log(lines.join("\n"));
