-- Riftline: run this once in Supabase → SQL Editor.
-- Profiles (username + synced progress), friendships. Realtime channels (presence, lobbies,
-- invites, WebRTC signalling) need no tables.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (char_length(username) between 3 and 16 and username ~ '^[A-Za-z0-9_]+$'),
  xp integer not null default 0 check (xp >= 0),
  equip jsonb not null default '{}'::jsonb,
  tutorial_done boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.friendships (
  id bigserial primary key,
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;
drop policy if exists "see own friendships" on public.friendships;
create policy "see own friendships" on public.friendships for select using (auth.uid() in (requester, addressee));
drop policy if exists "send requests" on public.friendships;
create policy "send requests" on public.friendships for insert with check (auth.uid() = requester and status = 'pending');
drop policy if exists "accept requests" on public.friendships;
create policy "accept requests" on public.friendships for update using (auth.uid() = addressee) with check (status = 'accepted');
drop policy if exists "remove friendships" on public.friendships;
create policy "remove friendships" on public.friendships for delete using (auth.uid() in (requester, addressee));

-- Leaderboards (added later — safe to re-run): lifetime kills / wins / matches and this week's XP,
-- written by each player's own client after every match.
alter table public.profiles add column if not exists kills integer not null default 0 check (kills >= 0);
alter table public.profiles add column if not exists wins integer not null default 0 check (wins >= 0);
alter table public.profiles add column if not exists matches integer not null default 0 check (matches >= 0);
alter table public.profiles add column if not exists week text;
alter table public.profiles add column if not exists week_xp integer not null default 0 check (week_xp >= 0);
create index if not exists profiles_xp_idx on public.profiles (xp desc);
create index if not exists profiles_kills_idx on public.profiles (kills desc);
create index if not exists profiles_wins_idx on public.profiles (wins desc);
create index if not exists profiles_week_idx on public.profiles (week, week_xp desc);
