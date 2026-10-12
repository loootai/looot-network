-- Adds 'granola' as an import source. Nothing is dropped: the old check is replaced by one with one more value.
alter table public.imports drop constraint if exists imports_source_check;
alter table public.imports add constraint imports_source_check
  check (source in ('linkedin', 'google', 'csv', 'x', 'granola', 'manual'));
