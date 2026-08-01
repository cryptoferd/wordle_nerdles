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


-- =====================================
-- COMMENT REACTIONS
-- =====================================

create table if not exists public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.submission_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint comment_reactions_one_per_user_per_emoji unique (comment_id, user_id, emoji),
  constraint comment_reactions_emoji_check check (emoji in ('👍','💚','🖕','🤘','🧠','🤣','😉','🤬','🤓','💀','🟩','🟨','⬛'))
);

create index if not exists comment_reactions_comment_idx
  on public.comment_reactions (comment_id, created_at);

drop view if exists public.comment_reaction_feed;

create view public.comment_reaction_feed as
select
  r.id,
  r.comment_id,
  r.user_id,
  r.emoji,
  r.created_at,
  p.display_name
from public.comment_reactions r
join public.profiles p
  on p.id = r.user_id;

alter table public.comment_reactions enable row level security;

drop policy if exists "comment_reactions_select_authenticated" on public.comment_reactions;
drop policy if exists "comment_reactions_insert_own" on public.comment_reactions;
drop policy if exists "comment_reactions_delete_own" on public.comment_reactions;

create policy "comment_reactions_select_authenticated"
on public.comment_reactions
for select
to authenticated
using (true);

create policy "comment_reactions_insert_own"
on public.comment_reactions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "comment_reactions_delete_own"
on public.comment_reactions
for delete
to authenticated
using (auth.uid() = user_id);


-- =========================================================
-- WORDLE NERDLES: FAVORITES + NOTIFICATIONS
-- Safe to run as one complete script in the Supabase SQL Editor.
-- =========================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- FAVORITE PROFILES
-- ---------------------------------------------------------

create table if not exists public.profile_favorites (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  favorite_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, favorite_user_id),
  constraint profile_favorites_no_self check (follower_id <> favorite_user_id)
);

create index if not exists profile_favorites_favorite_user_idx
  on public.profile_favorites (favorite_user_id);

alter table public.profile_favorites enable row level security;

drop policy if exists "favorites_select_own" on public.profile_favorites;
drop policy if exists "favorites_insert_own" on public.profile_favorites;
drop policy if exists "favorites_delete_own" on public.profile_favorites;

create policy "favorites_select_own"
on public.profile_favorites
for select
to authenticated
using (auth.uid() = follower_id);

create policy "favorites_insert_own"
on public.profile_favorites
for insert
to authenticated
with check (
  auth.uid() = follower_id
  and follower_id <> favorite_user_id
);

create policy "favorites_delete_own"
on public.profile_favorites
for delete
to authenticated
using (auth.uid() = follower_id);

-- ---------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  submission_id uuid references public.submissions(id) on delete cascade,
  comment_id uuid references public.submission_comments(id) on delete cascade,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_kind_check check (
    kind in (
      'submission_comment',
      'comment_reply',
      'favorite_submission'
    )
  )
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc);

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;
drop policy if exists "notifications_delete_own" on public.notifications;

create policy "notifications_select_own"
on public.notifications
for select
to authenticated
using (auth.uid() = recipient_user_id);

create policy "notifications_update_own"
on public.notifications
for update
to authenticated
using (auth.uid() = recipient_user_id)
with check (auth.uid() = recipient_user_id);

create policy "notifications_delete_own"
on public.notifications
for delete
to authenticated
using (auth.uid() = recipient_user_id);

-- Intentionally no browser INSERT policy.
-- Notifications are inserted by the security-definer trigger functions below.

drop view if exists public.notification_feed;

create view public.notification_feed
with (security_invoker = true)
as
select
  n.id,
  n.recipient_user_id,
  n.actor_user_id,
  n.kind,
  n.submission_id,
  n.comment_id,
  n.message,
  n.is_read,
  n.created_at,
  p.display_name as actor_display_name,
  p.avatar_url as actor_avatar_url
from public.notifications n
left join public.profiles p
  on p.id = n.actor_user_id;

grant select on public.notification_feed to authenticated;

-- ---------------------------------------------------------
-- COMMENT + REPLY NOTIFICATION TRIGGER
-- ---------------------------------------------------------

create or replace function public.create_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_owner uuid;
  v_parent_author uuid;
  v_actor_name text;
  v_puzzle_number integer;
begin
  select s.user_id, s.puzzle_number
    into v_submission_owner, v_puzzle_number
  from public.submissions s
  where s.id = new.submission_id;

  select coalesce(p.display_name, 'Someone')
    into v_actor_name
  from public.profiles p
  where p.id = new.user_id;

  v_actor_name := coalesce(v_actor_name, 'Someone');

  if new.parent_comment_id is not null then
    select c.user_id
      into v_parent_author
    from public.submission_comments c
    where c.id = new.parent_comment_id;

    if v_parent_author is not null and v_parent_author <> new.user_id then
      insert into public.notifications (
        recipient_user_id,
        actor_user_id,
        kind,
        submission_id,
        comment_id,
        message
      )
      values (
        v_parent_author,
        new.user_id,
        'comment_reply',
        new.submission_id,
        new.id,
        v_actor_name || ' replied to your comment on Wordle #' || v_puzzle_number || '.'
      );
    end if;

    -- Also notify the result owner when the reply is on their result,
    -- unless they authored the reply or already received the reply notification.
    if v_submission_owner is not null
       and v_submission_owner <> new.user_id
       and v_submission_owner is distinct from v_parent_author then
      insert into public.notifications (
        recipient_user_id,
        actor_user_id,
        kind,
        submission_id,
        comment_id,
        message
      )
      values (
        v_submission_owner,
        new.user_id,
        'submission_comment',
        new.submission_id,
        new.id,
        v_actor_name || ' commented on your Wordle #' || v_puzzle_number || ' result.'
      );
    end if;
  else
    if v_submission_owner is not null and v_submission_owner <> new.user_id then
      insert into public.notifications (
        recipient_user_id,
        actor_user_id,
        kind,
        submission_id,
        comment_id,
        message
      )
      values (
        v_submission_owner,
        new.user_id,
        'submission_comment',
        new.submission_id,
        new.id,
        v_actor_name || ' commented on your Wordle #' || v_puzzle_number || ' result.'
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists submission_comment_notification_trigger
  on public.submission_comments;

create trigger submission_comment_notification_trigger
after insert on public.submission_comments
for each row
execute function public.create_comment_notification();

-- ---------------------------------------------------------
-- FAVORITE-PLAYER SUBMISSION NOTIFICATION TRIGGER
-- ---------------------------------------------------------

create or replace function public.create_favorite_submission_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_name text;
begin
  select coalesce(p.display_name, 'Someone')
    into v_actor_name
  from public.profiles p
  where p.id = new.user_id;

  v_actor_name := coalesce(v_actor_name, 'Someone');

  insert into public.notifications (
    recipient_user_id,
    actor_user_id,
    kind,
    submission_id,
    message
  )
  select
    f.follower_id,
    new.user_id,
    'favorite_submission',
    new.id,
    v_actor_name || ' submitted Wordle #' || new.puzzle_number || '.'
  from public.profile_favorites f
  where f.favorite_user_id = new.user_id
    and f.follower_id <> new.user_id;

  return new;
end;
$$;

drop trigger if exists favorite_submission_notification_trigger
  on public.submissions;

create trigger favorite_submission_notification_trigger
after insert on public.submissions
for each row
execute function public.create_favorite_submission_notifications();

-- ---------------------------------------------------------
-- ENABLE REALTIME FOR NOTIFICATIONS
-- ---------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
