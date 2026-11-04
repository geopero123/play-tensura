-- Applied to the game backend. The signed-in user owns exactly one progress document.
create table public.game_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) < 100000),
  updated_at timestamptz not null default now()
);
alter table public.game_saves enable row level security;
grant select, insert, update on public.game_saves to authenticated;
create policy own_save_select on public.game_saves for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_save_insert on public.game_saves for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy own_save_update on public.game_saves for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
