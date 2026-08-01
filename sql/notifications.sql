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
