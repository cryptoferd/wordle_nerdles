-- Enable useful extension.
create extension if not exists pgcrypto;

-- Profiles table.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  catchphrase text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists catchphrase text;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles alter column created_at set default now();

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
create index if not exists submissions_submitted_at_idx on public.submissions (submitted_at desc);

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
  p.avatar_url,
  p.catchphrase,
  p.is_admin
from public.submissions s
join public.profiles p on p.id = s.user_id;

-- Auto-create profile on signup.
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

-- RLS.
alter table public.profiles enable row level security;
alter table public.submissions enable row level security;

-- Profiles policies.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Submission policies.
drop policy if exists "submissions_select_authenticated" on public.submissions;
create policy "submissions_select_authenticated"
on public.submissions for select
to authenticated
using (true);

drop policy if exists "submissions_insert_own" on public.submissions;
create policy "submissions_insert_own"
on public.submissions for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "submissions_update_own" on public.submissions;
create policy "submissions_update_own"
on public.submissions for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "submissions_delete_own" on public.submissions;
create policy "submissions_delete_own"
on public.submissions for delete
to authenticated
using (auth.uid() = user_id);

-- Private screenshots bucket policies.
drop policy if exists "Users can upload own screenshots" on storage.objects;
drop policy if exists "Users can view screenshots" on storage.objects;
drop policy if exists "Users can update own screenshots" on storage.objects;
drop policy if exists "Users can delete own screenshots" on storage.objects;

create policy "Users can upload own screenshots"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can view screenshots"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'screenshots'
);

create policy "Users can update own screenshots"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete own screenshots"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Private avatars bucket policies.
drop policy if exists "Users can upload own avatars" on storage.objects;
drop policy if exists "Users can view avatars" on storage.objects;
drop policy if exists "Users can update own avatars" on storage.objects;
drop policy if exists "Users can delete own avatars" on storage.objects;

create policy "Users can upload own avatars"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can view avatars"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
);

create policy "Users can update own avatars"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete own avatars"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- =====================================
-- COMMENTS
-- =====================================

create table if not exists public.submission_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  parent_comment_id uuid references public.submission_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint submission_comments_body_length check (char_length(body) between 1 and 500)
);

create index if not exists submission_comments_submission_idx
  on public.submission_comments (submission_id, created_at);

create index if not exists submission_comments_parent_idx
  on public.submission_comments (parent_comment_id);

drop view if exists public.comment_feed;

create view public.comment_feed as
select
  c.id,
  c.submission_id,
  c.parent_comment_id,
  c.user_id,
  c.body,
  c.created_at,
  p.display_name,
  p.avatar_url,
  p.catchphrase
from public.submission_comments c
join public.profiles p
  on p.id = c.user_id;

alter table public.submission_comments enable row level security;

drop policy if exists "comments_select_authenticated" on public.submission_comments;
drop policy if exists "comments_insert_own" on public.submission_comments;
drop policy if exists "comments_delete_own" on public.submission_comments;

create policy "comments_select_authenticated"
on public.submission_comments
for select
to authenticated
using (true);

create policy "comments_insert_own"
on public.submission_comments
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "comments_delete_own"
on public.submission_comments
for delete
to authenticated
using (auth.uid() = user_id);
