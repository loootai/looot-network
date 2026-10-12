-- looot-network schema. One network per sign-in: every row belongs to auth.uid().
-- Row level security is enabled and forced on every table. Nothing is readable by anon.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

-- array_to_string is only STABLE, which a generated column refuses. This wrapper is safe for text arrays.
create function public.immutable_join(a text[]) returns text
language sql immutable parallel safe set search_path = ''
as $$ select array_to_string(a, ' ') $$;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null check (btrim(full_name) <> ''),
  first_name text,
  last_name text,
  -- The first of emails, kept as its own column so lists and exports read it without unpacking.
  email text,
  emails text[] not null default '{}',
  phones text[] not null default '{}',
  linkedin_url text,
  x_url text,
  company text,
  company_domain text,
  title text,
  location text,
  headline text,
  notes text,
  tags text[] not null default '{}',
  connected_on date,
  source_kinds text[] not null default '{}',
  -- Dedupe keys, set by the app from the same code that parses the files.
  linkedin_key text,
  x_key text,
  name_key text,
  -- Facts written back by paid enrichment, with the time and the looot run behind each.
  enriched jsonb not null default '{}',
  enriched_at timestamptz,
  -- Fuzzy text: name, company, title and place in one lower-case string for pg_trgm.
  haystack text generated always as (
    lower(coalesce(full_name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(title, '') || ' ' || coalesce(location, ''))
  ) stored,
  -- Full text, weighted: name A, company and title B, headline place and tags C, notes D.
  fts tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(full_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(company, '') || ' ' || coalesce(title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(headline, '') || ' ' || coalesce(location, '') || ' ' || coalesce(public.immutable_join(tags), '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'D')
  ) stored,
  unique (id, owner_id)
);
-- The same LinkedIn profile is one person. Email and name matches are resolved by the app, because they can legitimately repeat.
create unique index people_owner_linkedin on public.people (owner_id, linkedin_key) where linkedin_key is not null;
create index people_owner_name_key on public.people (owner_id, name_key) where name_key is not null;
create index people_owner_x_key on public.people (owner_id, x_key) where x_key is not null;
create index people_emails on public.people using gin (emails);
create index people_tags on public.people using gin (tags);
create index people_sources on public.people using gin (source_kinds);
create index people_fts on public.people using gin (fts);
create index people_haystack_trgm on public.people using gin (haystack extensions.gin_trgm_ops);
create index people_company_lower on public.people (owner_id, lower(btrim(company)));

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  filename text not null,
  source text not null check (source in ('linkedin', 'google', 'csv', 'x', 'manual')),
  rows int not null default 0,
  added int not null default 0,
  merged int not null default 0,
  skipped int not null default 0,
  rejected jsonb not null default '[]',
  unique (id, owner_id)
);
create index imports_owner_created on public.imports (owner_id, created_at desc);

-- One row per file row that fed a person. The profile drawer lists these.
create table public.person_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  person_id uuid not null,
  import_id uuid not null,
  source text not null,
  row_number int not null default 0,
  raw jsonb not null default '{}',
  foreign key (person_id, owner_id) references public.people (id, owner_id) on delete cascade,
  foreign key (import_id, owner_id) references public.imports (id, owner_id) on delete cascade
);
create index person_sources_person on public.person_sources (owner_id, person_id);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  name text not null check (btrim(name) <> ''),
  query text not null,
  unique (owner_id, name)
);

-- One row per paid call. status: ok, pending (still running at looot, never failed at $0), failed.
create table public.enrichments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  person_id uuid not null,
  kind text not null check (kind in ('profile', 'company', 'email')),
  -- One key per (person, job). The same key replays the stored run at looot and never charges twice.
  idempotency_key text not null,
  endpoint_id text not null,
  looot_run_id text,
  status text not null check (status in ('ok', 'pending', 'failed', 'skipped')),
  list_price_micros bigint not null default 0 check (list_price_micros >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  facts jsonb not null default '{}',
  message text,
  -- A company call answers everyone at the domain, so one key can appear on several people.
  unique (owner_id, person_id, idempotency_key),
  foreign key (person_id, owner_id) references public.people (id, owner_id) on delete cascade
);
create index enrichments_person on public.enrichments (owner_id, person_id, created_at desc);

-- Budget in whole micro-dollars (1 dollar = 1,000,000). The owner changes it; no request body can.
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  daily_budget_micros bigint not null default 5000000 check (daily_budget_micros >= 0),
  monthly_budget_micros bigint not null default 25000000 check (monthly_budget_micros >= 0),
  check (daily_budget_micros <= monthly_budget_micros),
  unique (owner_id)
);

-- Row level security: four policies per table, all on owner_id = auth.uid().
do $$
declare t text;
begin
  foreach t in array array['people', 'imports', 'person_sources', 'saved_searches', 'enrichments', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_delete', t);
    execute format('create index if not exists %I on public.%I (owner_id)', t || '_owner', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
