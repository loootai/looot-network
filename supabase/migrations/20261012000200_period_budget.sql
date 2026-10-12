-- Period budget with atomic reservation, in whole micro-dollars. Before a paid looot call the app reserves the
-- call's list price with reserve_budget(). The function locks the owner's settings row, adds spent + reserved +
-- the new amount and writes the reservation in the same transaction, so two simultaneous runs cannot both pass.
-- The budgets are read from the settings row here, never from the request.

-- state: reserved (counts against the budget), settled (cost_micros is what looot charged), released (nothing was spent).
create table public.budget_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Same key the looot call uses. A second reservation for it is refused, so a pending call is never repeated.
  idempotency_key text not null,
  fingerprint text not null default '',
  amount_micros bigint not null check (amount_micros >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  state text not null default 'reserved' check (state in ('reserved', 'settled', 'released')),
  looot_run_id text,
  -- The finished run, kept so the same call is answered later with no charge.
  run jsonb,
  settled_at timestamptz,
  unique (owner_id, idempotency_key)
);
create index budget_reservations_owner_state on public.budget_reservations (owner_id, state, created_at);

alter table public.budget_reservations enable row level security;
alter table public.budget_reservations force row level security;
create policy budget_reservations_select on public.budget_reservations for select to authenticated using (owner_id = (select auth.uid()));
create policy budget_reservations_insert on public.budget_reservations for insert to authenticated with check (owner_id = (select auth.uid()));
create policy budget_reservations_update on public.budget_reservations for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy budget_reservations_delete on public.budget_reservations for delete to authenticated using (owner_id = (select auth.uid()));
create index budget_reservations_owner on public.budget_reservations (owner_id);
revoke all on public.budget_reservations from anon;
grant select, insert, update, delete on public.budget_reservations to authenticated;

-- Reserves one paid call. Returns jsonb:
--   { ok: true, shared: false, daily: {budget, used, reserved}, monthly: {...} }
--   { ok: true, shared: true }                 the same key already holds a reservation
--   { ok: false, scope: 'daily' | 'monthly', daily, monthly }
create function public.reserve_budget(
  p_key text,
  p_amount bigint,
  p_fingerprint text,
  p_day_start timestamptz,
  p_month_start timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_daily bigint;
  v_monthly bigint;
  v_used_day bigint;
  v_used_month bigint;
  v_reserved bigint;
  v_numbers jsonb;
begin
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.settings (owner_id) values (v_owner) on conflict (owner_id) do nothing;
  -- The row lock is the whole point: every reservation for this owner waits here, one at a time.
  select s.daily_budget_micros, s.monthly_budget_micros into v_daily, v_monthly
    from public.settings s where s.owner_id = v_owner for update;

  if exists (select 1 from public.budget_reservations b where b.owner_id = v_owner and b.idempotency_key = p_key and b.state = 'reserved') then
    return jsonb_build_object('ok', true, 'shared', true);
  end if;

  select coalesce(sum(b.cost_micros), 0) into v_used_day from public.budget_reservations b where b.owner_id = v_owner and b.state = 'settled' and b.created_at >= p_day_start;
  select coalesce(sum(b.cost_micros), 0) into v_used_month from public.budget_reservations b where b.owner_id = v_owner and b.state = 'settled' and b.created_at >= p_month_start;
  select coalesce(sum(b.amount_micros), 0) into v_reserved from public.budget_reservations b where b.owner_id = v_owner and b.state = 'reserved';

  v_numbers := jsonb_build_object(
    'daily', jsonb_build_object('budget', v_daily, 'used', v_used_day, 'reserved', v_reserved),
    'monthly', jsonb_build_object('budget', v_monthly, 'used', v_used_month, 'reserved', v_reserved)
  );

  if v_used_day + v_reserved + p_amount > v_daily then
    return jsonb_build_object('ok', false, 'scope', 'daily') || v_numbers;
  end if;
  if v_used_month + v_reserved + p_amount > v_monthly then
    return jsonb_build_object('ok', false, 'scope', 'monthly') || v_numbers;
  end if;

  -- A settled or released row with this key is replaced: the call is being made again under the same key.
  insert into public.budget_reservations (owner_id, idempotency_key, fingerprint, amount_micros)
  values (v_owner, p_key, p_fingerprint, p_amount)
  on conflict (owner_id, idempotency_key) do update
    set state = 'reserved', amount_micros = excluded.amount_micros, fingerprint = excluded.fingerprint, cost_micros = 0, settled_at = null
    where public.budget_reservations.state = 'released';
  if not found then
    -- Settled already: the caller should have recalled the stored result. Share it rather than charge again.
    return jsonb_build_object('ok', true, 'shared', true);
  end if;
  return jsonb_build_object('ok', true, 'shared', false) || v_numbers;
end;
$$;

-- Used, held and the budgets for today and this month. Reads only.
create function public.budget_status(p_day_start timestamptz, p_month_start timestamptz) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'isDefault', s.id is null,
    'daily', jsonb_build_object(
      'budget', coalesce(s.daily_budget_micros, 5000000),
      'used', (select coalesce(sum(b.cost_micros), 0) from public.budget_reservations b where b.state = 'settled' and b.created_at >= p_day_start),
      'reserved', (select coalesce(sum(b.amount_micros), 0) from public.budget_reservations b where b.state = 'reserved')),
    'monthly', jsonb_build_object(
      'budget', coalesce(s.monthly_budget_micros, 25000000),
      'used', (select coalesce(sum(b.cost_micros), 0) from public.budget_reservations b where b.state = 'settled' and b.created_at >= p_month_start),
      'reserved', (select coalesce(sum(b.amount_micros), 0) from public.budget_reservations b where b.state = 'reserved')))
  from (select 1) one left join public.settings s on s.owner_id = (select auth.uid());
$$;

-- The call ended. cost_micros is what looot charged; the finished run is stored under the key.
create function public.settle_reservation(p_key text, p_cost bigint, p_now timestamptz, p_run jsonb) returns void
language sql
set search_path = ''
as $$
  update public.budget_reservations
     set state = 'settled', cost_micros = p_cost, settled_at = p_now, run = coalesce(p_run, run)
   where owner_id = (select auth.uid()) and idempotency_key = p_key and state = 'reserved';
$$;

-- The call did not run. Only a reserved row can be released.
create function public.release_reservation(p_key text, p_now timestamptz) returns void
language sql
set search_path = ''
as $$
  update public.budget_reservations set state = 'released', settled_at = p_now where owner_id = (select auth.uid()) and idempotency_key = p_key and state = 'reserved';
$$;

-- The call is accepted but not finished. Keep the looot run id so a later check can read its status.
create function public.hold_reservation(p_key text, p_looot_run_id text) returns void
language sql
set search_path = ''
as $$
  update public.budget_reservations set looot_run_id = p_looot_run_id where owner_id = (select auth.uid()) and idempotency_key = p_key and state = 'reserved';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'reserve_budget(text, bigint, text, timestamptz, timestamptz)',
    'budget_status(timestamptz, timestamptz)',
    'settle_reservation(text, bigint, timestamptz, jsonb)',
    'release_reservation(text, timestamptz)',
    'hold_reservation(text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
