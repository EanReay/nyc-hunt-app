-- NYC Scavenger Hunt: run this once in Supabase > SQL Editor > New query > Run.
-- Safe to run again; it skips anything that already exists.

-- Team names
create table if not exists public.teams (
  id   text primary key check (id in ('A','B')),
  name text not null
);
insert into public.teams (id, name) values ('A','Team A'), ('B','Team B')
on conflict (id) do nothing;

-- Every photo/video a team submits for a challenge
create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  challenge_id text not null,
  team         text not null check (team in ('A','B')),
  player       text,
  media_path   text,
  media_type   text,
  caption      text,
  rejected     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists submissions_created_idx on public.submissions (created_at desc);

-- Tallies for repeatable items (extra bars, penalties)
create table if not exists public.counters (
  challenge_id text not null,
  team         text not null check (team in ('A','B')),
  count        integer not null default 0 check (count >= 0),
  primary key (challenge_id, team)
);

-- Judge's-call winners (one team per challenge)
create table if not exists public.awards (
  challenge_id text primary key,
  team         text check (team in ('A','B')),
  updated_at   timestamptz not null default now()
);

-- Game clock
create table if not exists public.game (
  id      integer primary key default 1 check (id = 1),
  ends_at timestamptz
);
insert into public.game (id) values (1) on conflict (id) do nothing;

-- Add or subtract from a tally without two phones overwriting each other
create or replace function public.bump(cid text, t text, d integer)
returns integer
language sql
as $$
  insert into public.counters (challenge_id, team, count)
  values (cid, t, greatest(0, d))
  on conflict (challenge_id, team)
  do update set count = greatest(0, public.counters.count + d)
  returning count;
$$;

-- Access: no logins, anyone with the app link can play
alter table public.teams       enable row level security;
alter table public.submissions enable row level security;
alter table public.counters    enable row level security;
alter table public.awards      enable row level security;
alter table public.game        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['teams','submissions','counters','awards','game'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='hunt_open') then
      execute format('create policy hunt_open on public.%I for all to anon, authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.teams, public.submissions, public.counters, public.awards, public.game to anon, authenticated;
grant execute on function public.bump(text, text, integer) to anon, authenticated;

-- Live updates
do $$
declare t text;
begin
  foreach t in array array['teams','submissions','counters','awards','game'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Photo/video storage (public bucket, 50 MB per file)
insert into storage.buckets (id, name, public, file_size_limit)
values ('hunt', 'hunt', true, 52428800)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='hunt_read') then
    create policy hunt_read on storage.objects for select to anon, authenticated using (bucket_id = 'hunt');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='hunt_upload') then
    create policy hunt_upload on storage.objects for insert to anon, authenticated with check (bucket_id = 'hunt');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='hunt_delete') then
    create policy hunt_delete on storage.objects for delete to anon, authenticated using (bucket_id = 'hunt');
  end if;
end $$;
