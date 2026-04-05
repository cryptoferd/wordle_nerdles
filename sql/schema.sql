-- Enable extension used for UUID generation.
create extension if not exists pgcrypto;

-- =========================
-- PROFILES
-- =========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================
-- SUBMISSIONS
-- =========================
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  puzzle_number integer not null,
  score integer,
  solved boolean not null,
  rows_json jsonb not null,
  share_text text not null,
  screenshot_path text,
  submitted_at timestamptz not null default now(),

  constraint submissions_score_check check (
    (solved = true and score between 1 and 6)
    or (solved = false and score is null)
  ),

  constraint submissions_one_per_user_per_puzzle unique (user_id, puzzle_number)
);

create index if not exists submissions_puzzle_idx on public.submissions (puzzle_number);
create index if not exists submissions_user_idx on public.submissions (user_id);
create index if not exists submissions_submitted_at_idx on public.submissions (submitted_at desc);

-- =========================
-- VIEW
-- =========================
create or replace view public.submission_feed as
select
  s.id,
  s.user_id,
  s.puzzle_number,
  s.score,
  s.solved,
  s.rows_json,
  s.share_text,
  s.screenshot_path,
  s.submitted_at,
  p.display_name,
  p.is_admin
from public.submissions s
join public.profiles p
  on p.id = s.user_id;

-- =========================
-- AUTO-CREATE PROFILE ON SIGNUP
-- =========================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- =========================
-- RLS
-- =========================
alter table public.profiles enable row level security;
alter table public.submissions enable row level security;

-- Drop old policies if they exist.
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

drop policy if exists "submissions_select_authenticated" on public.submissions;
drop policy if exists "submissions_insert_own" on public.submissions;
drop policy if exists "submissions_update_own" on public.submissions;
drop policy if exists "submissions_delete_own" on public.submissions;

-- Profiles policies
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Submissions policies
create policy "submissions_select_authenticated"
on public.submissions
for select
to authenticated
using (true);

create policy "submissions_insert_own"
on public.submissions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "submissions_update_own"
on public.submissions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "submissions_delete_own"
on public.submissions
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- STORAGE NOTES
-- =========================
-- Bucket name: screenshots
-- Keep it private.
--
-- Example storage policies to run separately if you want:
--
-- create policy "users upload own screenshots"
-- on storage.objects
-- for insert
-- to authenticated
-- with check (
--   bucket_id = 'screenshots'
--   and (storage.foldername(name))[1] = auth.uid()::text
-- );
--
-- create policy "users view own screenshots"
-- on storage.objects
-- for select
-- to authenticated
-- using (
--   bucket_id = 'screenshots'
--   and (storage.foldername(name))[1] = auth.uid()::text
-- );
