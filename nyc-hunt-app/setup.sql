-- NYC Scavenger Hunt: run this in Supabase > SQL Editor > New query > Run.
-- Safe to run again; it skips anything that already exists. If you set the app up
-- before hunts had codes, running it again moves your existing game into the hunt
-- with code NYC.

-- Hunts: each one has a join code, its own team names, clock and challenge list
create table if not exists public.hunts (
  code          text primary key check (code ~ '^[A-Z0-9]{3,12}$'),
  name          text not null,
  team_a        text not null default 'Team A',
  team_b        text not null default 'Team B',
  challenge_ids text[],            -- null means every challenge
  ends_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- Starter hunt (and the home for data from before hunts had codes)
do $$
begin
  if not exists (select 1 from public.hunts) then
    insert into public.hunts (code, name) values ('NYC', 'NYC Scavenger Hunt');
    if to_regclass('public.teams') is not null then
      update public.hunts set
        team_a = coalesce((select name from public.teams where id = 'A'), team_a),
        team_b = coalesce((select name from public.teams where id = 'B'), team_b)
      where code = 'NYC';
    end if;
    if to_regclass('public.game') is not null then
      update public.hunts set ends_at = (select ends_at from public.game where id = 1) where code = 'NYC';
    end if;
  end if;
end $$;

-- Challenges made on the Admin page (the built-in ones live in challenges.js)
create table if not exists public.challenges (
  id         text primary key,
  cat_id     text not null,
  cat_name   text not null,
  text       text not null,
  note       text,
  points     integer not null,
  type       text not null default 'once' check (type in ('once','judge','count')),
  judge_only boolean not null default false,
  created_at timestamptz not null default now()
);

-- Every photo/video a team submits for a challenge
create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  hunt         text not null references public.hunts(code) on delete cascade,
  challenge_id text not null,
  team         text not null check (team in ('A','B')),
  player       text,
  media_path   text,
  media_type   text,
  caption      text,
  rejected     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Tallies for repeatable items (extra bars, penalties)
create table if not exists public.counters (
  hunt         text not null references public.hunts(code) on delete cascade,
  challenge_id text not null,
  team         text not null check (team in ('A','B')),
  count        integer not null default 0 check (count >= 0),
  constraint counters_hunt_pkey primary key (hunt, challenge_id, team)
);

-- Judge's-call winners (one team per challenge)
create table if not exists public.awards (
  hunt         text not null references public.hunts(code) on delete cascade,
  challenge_id text not null,
  team         text check (team in ('A','B')),
  updated_at   timestamptz not null default now(),
  constraint awards_hunt_pkey primary key (hunt, challenge_id)
);

-- Upgrade tables made before hunts had codes: existing rows go to hunt NYC
do $$
declare t text;
begin
  foreach t in array array['submissions','counters','awards'] loop
    execute format('alter table public.%I add column if not exists hunt text references public.hunts(code) on delete cascade', t);
    execute format('update public.%I set hunt = %L where hunt is null', t, 'NYC');
    execute format('alter table public.%I alter column hunt set not null', t);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'counters_hunt_pkey') then
    alter table public.counters drop constraint if exists counters_pkey;
    alter table public.counters add constraint counters_hunt_pkey primary key (hunt, challenge_id, team);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'awards_hunt_pkey') then
    alter table public.awards drop constraint if exists awards_pkey;
    alter table public.awards add constraint awards_hunt_pkey primary key (hunt, challenge_id);
  end if;
end $$;
create index if not exists submissions_hunt_idx on public.submissions (hunt, created_at desc);

-- Add or subtract from a tally without two phones overwriting each other
drop function if exists public.bump(text, text, integer);
create or replace function public.bump(h text, cid text, t text, d integer)
returns integer
language sql
as $$
  insert into public.counters (hunt, challenge_id, team, count)
  values (h, cid, t, greatest(0, d))
  on conflict (hunt, challenge_id, team)
  do update set count = greatest(0, public.counters.count + d)
  returning count;
$$;

-- Access: no logins, anyone with the app link can play
do $$
declare t text;
begin
  foreach t in array array['hunts','challenges','submissions','counters','awards'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='hunt_open') then
      execute format('create policy hunt_open on public.%I for all to anon, authenticated using (true) with check (true)', t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;
grant execute on function public.bump(text, text, text, integer) to anon, authenticated;

-- Live updates
do $$
declare t text;
begin
  foreach t in array array['hunts','challenges','submissions','counters','awards'] loop
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
