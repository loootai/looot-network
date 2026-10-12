-- Search and company grouping. Both run with the caller's rights (security invoker), so row level security
-- scopes every row to the signed-in owner. Every argument is a parameter. Nothing is built from text.

-- 'san fran' becomes 'san:* & fran:*'. Returns null when the text has no letters or digits.
create function public.prefix_tsquery(t text) returns tsquery
language sql immutable parallel safe set search_path = ''
as $$
  select to_tsquery('simple', nullif(array_to_string(array(select w || ':*' from regexp_split_to_table(lower(t), '[^[:alnum:]]+') w where w <> ''), ' & '), ''))
$$;

-- Escapes the characters that mean something in a regular expression, so a role word is matched literally.
create function public.re_escape(t text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select regexp_replace(t, '([.^$*+?(){}|\[\]\\-])', '\\\1', 'g') $$;

-- Returns the ids of the people that match, best first, with the total match count in every row.
-- Categories are joined with AND, the values inside one category with OR. A free word matches when it is the
-- start of a word in the full-text index or is a close trigram match for the name, company, title or place.
create function public.search_people(
  p_terms text[] default '{}',
  p_roles text[] default '{}',
  p_companies text[] default '{}',
  p_locations text[] default '{}',
  p_name text default null,
  p_company_exact text default null,
  p_has_email boolean default null,
  p_has_linkedin boolean default null,
  p_sources text[] default '{}',
  p_tags text[] default '{}',
  p_sort text default 'relevance',
  p_limit int default 50,
  p_offset int default 0
) returns table (id uuid, rank real, total bigint)
language sql
stable
set search_path = public, extensions
as $$
  with hits as (
    select
      p.id,
      p.full_name,
      p.company,
      p.created_at,
      p.connected_on,
      (
        coalesce((select sum(ts_rank(p.fts, public.prefix_tsquery(t))) from unnest(p_terms) t), 0)
        + case when cardinality(p_terms) > 0 then similarity(lower(p.full_name), lower(array_to_string(p_terms, ' '))) else 0 end
        + 0.5 * (select count(*) from unnest(p_companies) c where strpos(lower(coalesce(p.company, '')), lower(c)) > 0)
      )::real as rank
    from public.people p
    where
      (cardinality(p_terms) = 0 or not exists (
        select 1 from unnest(p_terms) t
        where not (coalesce(p.fts @@ public.prefix_tsquery(t), false) or word_similarity(lower(t), p.haystack) >= 0.55)
      ))
      and (cardinality(p_roles) = 0 or exists (
        select 1 from unnest(p_roles) r
        where (coalesce(p.title, '') || ' ' || coalesce(p.headline, '')) ~* ('\m' || public.re_escape(r) || '\M')
      ))
      and (cardinality(p_companies) = 0 or exists (
        select 1 from unnest(p_companies) c
        where strpos(lower(coalesce(p.company, '')), lower(c)) > 0 or coalesce(p.fts @@ public.prefix_tsquery(c), false)
      ))
      and (cardinality(p_locations) = 0 or exists (
        select 1 from unnest(p_locations) l
        where strpos(lower(coalesce(p.location, '')), lower(l)) > 0 or word_similarity(lower(l), lower(coalesce(p.location, ''))) >= 0.55
      ))
      and (p_name is null or coalesce(to_tsvector('simple', p.full_name) @@ public.prefix_tsquery(p_name), false) or similarity(lower(p.full_name), lower(p_name)) >= 0.4)
      and (p_company_exact is null or lower(btrim(coalesce(p.company, ''))) = p_company_exact)
      and (p_has_email is null or (p.email is not null) = p_has_email)
      and (p_has_linkedin is null or (p.linkedin_url is not null) = p_has_linkedin)
      and (cardinality(p_sources) = 0 or p.source_kinds && p_sources)
      and (cardinality(p_tags) = 0 or not exists (
        select 1 from unnest(p_tags) t where not (lower(t) = any (select lower(x) from unnest(p.tags) x))
      ))
  )
  select h.id, h.rank, count(*) over () as total
  from hits h
  order by
    case when p_sort = 'relevance' then h.rank end desc nulls last,
    case when p_sort = 'recent' then coalesce(h.connected_on::timestamptz, h.created_at) end desc nulls last,
    case when p_sort = 'company' then (h.company is null) end asc,
    case when p_sort = 'company' then lower(h.company) end asc,
    -- X handles ("@name") have no real name, so they sort after the people who do.
    (left(h.full_name, 1) = '@') asc,
    lower(h.full_name) asc,
    h.id
  limit greatest(1, least(p_limit, 5000))
  offset greatest(0, p_offset)
$$;

-- People grouped by company, case and spacing ignored, biggest first.
create function public.company_groups(p_q text default null, p_limit int default 500)
returns table (company text, people bigint, with_email bigint, titles text[])
language sql
stable
set search_path = public
as $$
  select
    min(p.company) as company,
    count(*) as people,
    count(p.email) as with_email,
    (array_agg(distinct p.title) filter (where p.title is not null))[1:3] as titles
  from public.people p
  where btrim(coalesce(p.company, '')) <> '' and (p_q is null or strpos(lower(p.company), lower(p_q)) > 0)
  group by lower(btrim(p.company))
  order by count(*) desc, lower(btrim(p.company))
  limit greatest(1, least(p_limit, 2000))
$$;

-- Totals for the People page header and the Imports page.
create function public.people_stats() returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*),
    'with_email', count(email),
    'with_linkedin', count(linkedin_url),
    'companies', count(distinct lower(btrim(company))) filter (where btrim(coalesce(company, '')) <> ''),
    'enriched', count(enriched_at),
    'by_source', coalesce((select jsonb_object_agg(s, n) from (select s, count(*) n from public.people, unnest(source_kinds) s group by s) x), '{}'),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', t, 'n', n) order by n desc, t) from (select lower(t) t, count(*) n from public.people, unnest(tags) t group by lower(t) order by count(*) desc, lower(t) limit 30) y), '[]')
  )
  from public.people
$$;

revoke execute on function public.search_people(text[], text[], text[], text[], text, text, boolean, boolean, text[], text[], text, int, int) from public, anon;
revoke execute on function public.company_groups(text, int) from public, anon;
revoke execute on function public.people_stats() from public, anon;
grant execute on function public.search_people(text[], text[], text[], text[], text, text, boolean, boolean, text[], text[], text, int, int) to authenticated;
grant execute on function public.company_groups(text, int) to authenticated;
grant execute on function public.people_stats() to authenticated;
