-- Enable useful extension.
create extension if not exists pgcrypto;

-- Profiles table.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Submissions table.
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

-- Helper view for front end display.
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
join public.profiles p on p.id = s.user_id;

-- RLS.
alter table public.profiles enable row level security;
alter table public.submissions enable row level security;

-- Profiles policies.
drop policy if exists "profiles are viewable by authenticated users" on public.profiles;
create policy "profiles are viewable by authenticated users"
on public.profiles for select
using (auth.role() = 'authenticated');

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- Submission policies.
drop policy if exists "authenticated users can view submissions" on public.submissions;
create policy "authenticated users can view submissions"
on public.submissions for select
using (auth.role() = 'authenticated');

drop policy if exists "users can insert own submissions" on public.submissions;
create policy "users can insert own submissions"
on public.submissions for insert
with check (auth.uid() = user_id);

drop policy if exists "users can update own submissions" on public.submissions;
create policy "users can update own submissions"
on public.submissions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Storage setup notes:
-- 1) Create a public/private bucket named: screenshots
-- 2) Prefer private bucket.
-- 3) Add storage policies so authenticated users can upload only to paths beginning with their auth.uid().
-- 4) For locked screenshots, do not make the bucket public. Use signed URLs after checking whether the viewer submitted that puzzle.

-- Example storage policies to adapt in Supabase dashboard / SQL:
-- Allow authenticated uploads to own folder.
-- create policy "users upload own screenshots"
-- on storage.objects for insert
-- to authenticated
-- with check (
--   bucket_id = 'screenshots'
--   and (storage.foldername(name))[1] = auth.uid()::text
-- );

-- Allow authenticated users to read screenshot objects.
-- IMPORTANT: the front end already checks puzzle unlocks before requesting signed URLs,
-- but for stronger enforcement you can move signed URL generation into an edge function
-- that verifies the viewer has submitted the same puzzle or is_admin = true.

