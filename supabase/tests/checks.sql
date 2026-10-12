-- Checks run by scripts/test-sql.sh after the demo people are loaded for user 1.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into imports (id, filename, source, rows) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Connections.csv', 'linkedin', 200);
insert into imports (id, filename, source, rows) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Granola meetings', 'granola', 3);
insert into person_sources (person_id, import_id, source, row_number) values ('00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'linkedin', 1);
insert into saved_searches (name, query) values ('Fintech founders', 'founders in Paris at fintech');
insert into enrichments (person_id, kind, idempotency_key, endpoint_id, status) values ('00000000-0000-4000-8000-000000000001', 'profile', 'network:v1:profile:k1', 'anyapi-run-linkedin-profile-thin', 'ok');
insert into settings (daily_budget_micros, monthly_budget_micros) values (5000000, 25000000);
select public.reserve_budget('rls-row', 1000, 'fp', date_trunc('day', now()), date_trunc('month', now())) is not null as seeded_reservation \gset

do $$ declare n bigint; begin
  select count(*) into n from public.search_people(p_limit => 5000); raise notice 'user1 search sees %', n;
end $$;

-- Constraints that carry the money and dedupe rules.
do $$ begin
  insert into people (full_name, linkedin_key) values ('Dup One', 'linkedin.com/in/dup-test');
  begin
    insert into people (full_name, linkedin_key) values ('Dup Two', 'linkedin.com/in/dup-test');
    raise exception 'DUPLICATE LINKEDIN ACCEPTED';
  exception when unique_violation then raise notice 'duplicate linkedin refused'; end;
  begin
    insert into enrichments (person_id, kind, idempotency_key, endpoint_id, status, cost_micros) values ('00000000-0000-4000-8000-000000000001', 'email', 'neg', 'e', 'ok', -1);
    raise exception 'NEGATIVE COST ACCEPTED';
  exception when check_violation then raise notice 'cost above nothing refused'; end;
  begin
    update settings set daily_budget_micros = 30000000;
    raise exception 'DAILY ABOVE MONTHLY ACCEPTED';
  exception when check_violation then raise notice 'daily above monthly refused'; end;
end $$;

-- Search: hostile text is only ever data.
do $$ declare n bigint; begin
  select count(*) into n from public.search_people(p_terms => array['''; drop table people; --'], p_roles => array['.*'], p_companies => array['%'], p_locations => array['\']);
  if n = 0 then raise notice 'hostile text matched nothing'; end if;
  perform 1 from public.people limit 1;
end $$;

-- Budget functions. Daily budget is 5,000,000 micros ($5), monthly 25,000,000 ($25).
do $$ declare r jsonb; d timestamptz := date_trunc('day', now()); m timestamptz := date_trunc('month', now()); begin
  r := public.reserve_budget('k-a', 4000000, 'fp-a', d, m);
  if (r->>'ok')::boolean and not (r->>'shared')::boolean then raise notice 'reserve ok'; end if;
  r := public.reserve_budget('k-a', 4000000, 'fp-a', d, m);
  if (r->>'ok')::boolean and (r->>'shared')::boolean then raise notice 'reserve shared'; end if;
  -- 4,000,000 held + 1,000 held earlier for rls-row + 2,000,000 would pass $5.
  r := public.reserve_budget('k-b', 2000000, 'fp-b', d, m);
  if not (r->>'ok')::boolean and r->>'scope' = 'daily' then raise notice 'two reservations cannot both pass'; raise notice 'daily budget refused'; end if;
  perform public.release_reservation('k-a', now());
  r := public.reserve_budget('k-b', 2000000, 'fp-b', d, m);
  if (r->>'ok')::boolean then raise notice 'release frees the budget'; end if;
  perform public.settle_reservation('k-b', 1500000, now(), '{"runId":"r1","status":"completed"}');
  r := public.budget_status(d, m);
  if (r->'daily'->>'used')::bigint = 1500000 then raise notice 'settle counts as used'; end if;
  -- A settled key is shared, not reserved and charged again.
  r := public.reserve_budget('k-b', 2000000, 'fp-b', d, m);
  if (r->>'ok')::boolean and (r->>'shared')::boolean then raise notice 'settled key not charged again'; end if;
  -- Monthly: 22,000,000 settled earlier this month, none today (the day window starts tomorrow in this call).
  update settings set daily_budget_micros = 25000000;
  insert into public.budget_reservations (idempotency_key, amount_micros, cost_micros, state, settled_at) values ('k-old', 0, 22000000, 'settled', now());
  r := public.reserve_budget('k-c', 4000000, 'fp-c', now() + interval '1 day', m);
  if not (r->>'ok')::boolean and r->>'scope' = 'monthly' then raise notice 'monthly budget refused'; end if;
end $$;

-- User 2 sees nothing of user 1, changes nothing and forges nothing.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare t text; n bigint;
begin
  foreach t in array array['people','imports','person_sources','saved_searches','enrichments','settings','budget_reservations'] loop
    execute format('select count(*) from public.%I', t) into n;
    raise notice 'user2 sees % rows in %', n, t;
    execute format('with u as (update public.%I set created_at = now() returning 1) select count(*) from u', t) into n;
    raise notice 'user2 updated % rows in %', n, t;
    execute format('with d as (delete from public.%I returning 1) select count(*) from d', t) into n;
    raise notice 'user2 deleted % rows in %', n, t;
  end loop;
  select count(*) into n from public.search_people(p_limit => 5000);
  if n = 0 then raise notice 'user2 search sees 0 of 200'; end if;
  select count(*) into n from public.company_groups();
  if n = 0 then raise notice 'user2 company_groups sees 0'; end if;
end $$;

-- Forged owner_id: refused by the insert policy, on every table.
do $$
declare
  t text;
  stmts text[] := array[
    'insert into people (owner_id, full_name) values (''11111111-1111-1111-1111-111111111111'', ''Spoof'')',
    'insert into imports (owner_id, filename, source) values (''11111111-1111-1111-1111-111111111111'', ''x.csv'', ''csv'')',
    'insert into person_sources (owner_id, person_id, import_id, source) values (''11111111-1111-1111-1111-111111111111'', ''00000000-0000-4000-8000-000000000001'', ''bbbbbbbb-0000-0000-0000-000000000001'', ''csv'')',
    'insert into saved_searches (owner_id, name, query) values (''11111111-1111-1111-1111-111111111111'', ''spoof'', ''x'')',
    'insert into enrichments (owner_id, person_id, kind, idempotency_key, endpoint_id, status) values (''11111111-1111-1111-1111-111111111111'', ''00000000-0000-4000-8000-000000000001'', ''email'', ''spoof'', ''e'', ''ok'')',
    'insert into settings (owner_id) values (''11111111-1111-1111-1111-111111111111'')',
    'insert into budget_reservations (owner_id, idempotency_key, amount_micros) values (''11111111-1111-1111-1111-111111111111'', ''spoof'', 1)'
  ];
  names text[] := array['people','imports','person_sources','saved_searches','enrichments','settings','budget_reservations'];
  i int;
begin
  for i in 1 .. array_length(stmts, 1) loop
    begin
      execute stmts[i];
      raise exception 'FORGED OWNER ACCEPTED: %', names[i];
    exception when insufficient_privilege or foreign_key_violation then
      raise notice 'forged owner refused: %', names[i];
    end;
  end loop;
end $$;

-- Anonymous callers get nothing.
reset role;
set role anon;
do $$ begin
  begin
    perform count(*) from public.people;
    raise exception 'ANON READ SUCCEEDED';
  exception when insufficient_privilege then raise notice 'anon refused'; end;
end $$;
reset role;

select 'tables without rls|' || count(*) from pg_tables t where schemaname = 'public' and not rowsecurity;
select 'tables without forced rls|' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity;
select 'public tables|' || count(*) from pg_tables where schemaname = 'public';
