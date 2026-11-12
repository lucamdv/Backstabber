create table public.bs_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,18}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text check (char_length(avatar_url) <= 2048 and avatar_url like 'https://%'),
  show_online boolean not null default false,
  last_seen timestamptz
);
create index bs_profiles_username_prefix on public.bs_profiles (username text_pattern_ops);

create table public.bs_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.bs_profiles (user_id) on delete cascade,
  recipient_id uuid not null references public.bs_profiles (user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create unique index bs_friend_requests_pending_pair on public.bs_friend_requests
  (least(sender_id, recipient_id), greatest(sender_id, recipient_id)) where status = 'pending';
create index bs_friend_requests_sender on public.bs_friend_requests (sender_id, created_at desc);
create index bs_friend_requests_recipient on public.bs_friend_requests (recipient_id, created_at desc);

create table public.bs_friends (
  user_a uuid not null references public.bs_profiles (user_id) on delete cascade,
  user_b uuid not null references public.bs_profiles (user_id) on delete cascade,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index bs_friends_user_b on public.bs_friends (user_b);

create table public.bs_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9A-F]{10}$'),
  host_id uuid references public.bs_profiles (user_id) on delete set null,
  capacity integer not null check (capacity between 2 and 10),
  status text not null default 'lobby' check (status in ('lobby', 'started', 'closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index bs_rooms_host on public.bs_rooms (host_id);

create table public.bs_room_members (
  room_id uuid not null references public.bs_rooms (id) on delete cascade,
  user_id uuid not null references public.bs_profiles (user_id) on delete cascade,
  ready boolean not null default false,
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index bs_room_members_user on public.bs_room_members (user_id, room_id);

create table public.bs_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.bs_rooms (id) on delete cascade,
  sender_id uuid not null references public.bs_profiles (user_id) on delete cascade,
  recipient_id uuid not null references public.bs_profiles (user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  check (sender_id <> recipient_id)
);
create unique index bs_invites_pending_room_recipient on public.bs_invites
  (room_id, recipient_id) where status = 'pending';
create index bs_invites_room on public.bs_invites (room_id);
create index bs_invites_sender on public.bs_invites (sender_id);
create index bs_invites_recipient on public.bs_invites (recipient_id, created_at desc);

create table public.bs_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.bs_rooms (id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now()
);

create table public.bs_match_commands (
  match_id uuid not null references public.bs_matches (id) on delete cascade,
  user_id uuid not null references public.bs_profiles (user_id) on delete cascade,
  command_id text not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, command_id)
);
create index bs_match_commands_user on public.bs_match_commands (user_id);

alter table public.bs_profiles enable row level security;
alter table public.bs_friend_requests enable row level security;
alter table public.bs_friends enable row level security;
alter table public.bs_rooms enable row level security;
alter table public.bs_room_members enable row level security;
alter table public.bs_invites enable row level security;
alter table public.bs_matches enable row level security;
alter table public.bs_match_commands enable row level security;

-- Existing Supabase projects can grant public-schema tables to API roles by default.
revoke all on public.bs_profiles, public.bs_friend_requests, public.bs_friends,
  public.bs_rooms, public.bs_room_members, public.bs_invites,
  public.bs_matches, public.bs_match_commands from public, anon, authenticated;

-- Realtime can look up only the subscriber's own membership columns.
grant select (room_id, user_id) on public.bs_room_members to authenticated;
create policy bs_membership_for_realtime on public.bs_room_members
  for select to authenticated using (user_id = (select auth.uid()));

create policy bs_realtime_receive on realtime.messages for select to authenticated using (
  topic = (select realtime.topic())
  and (
    (extension = 'broadcast' and topic = 'user:' || (select auth.uid())::text)
    or (
      extension in ('broadcast', 'presence')
      and exists (
        select 1 from public.bs_room_members m
        where m.user_id = (select auth.uid())
          and 'room:' || m.room_id::text = (select realtime.topic())
      )
    )
  )
);
create policy bs_realtime_track on realtime.messages for insert to authenticated with check (
  topic = (select realtime.topic())
  and extension = 'presence'
  and exists (
    select 1 from public.bs_room_members m
    where m.user_id = (select auth.uid())
      and 'room:' || m.room_id::text = (select realtime.topic())
  )
);

create schema bs_private;
revoke all on schema bs_private from public, anon, authenticated;

create function bs_private.room_invalidation() returns trigger language plpgsql
  set search_path = '' as $$
declare
  room uuid;
begin
  if tg_table_name = 'bs_rooms' then
    room := new.id;
  elsif tg_op = 'DELETE' then
    room := old.room_id;
  else
    room := new.room_id;
  end if;

  -- Routine heartbeats should not fan out into repeated snapshot requests.
  if tg_table_name = 'bs_room_members' and tg_op = 'UPDATE' then
    if new.ready = old.ready and old.last_seen > now() - interval '35 seconds'
       and new.last_seen > now() - interval '35 seconds' then
      return null;
    end if;
  end if;

  perform realtime.send('{"kind":"room"}'::jsonb, 'invalidate', 'room:' || room::text, true);
  return null;
end;
$$;

create function bs_private.social_invalidation() returns trigger language plpgsql
  set search_path = '' as $$
declare
  sender uuid;
  recipient uuid;
begin
  if tg_table_name = 'bs_friends' then
    if tg_op = 'DELETE' then
      sender := old.user_a;
      recipient := old.user_b;
    else
      sender := new.user_a;
      recipient := new.user_b;
    end if;
  else
    sender := new.sender_id;
    recipient := new.recipient_id;
  end if;
  perform realtime.send('{"kind":"social"}'::jsonb, 'invalidate', 'user:' || sender::text, true);
  perform realtime.send('{"kind":"social"}'::jsonb, 'invalidate', 'user:' || recipient::text, true);
  return null;
end;
$$;
revoke all on function bs_private.room_invalidation(), bs_private.social_invalidation()
  from public, anon, authenticated;

create trigger bs_rooms_invalidate after insert or update of host_id, status on public.bs_rooms
  for each row execute function bs_private.room_invalidation();
create trigger bs_members_invalidate after insert or update of ready, last_seen or delete on public.bs_room_members
  for each row execute function bs_private.room_invalidation();
create trigger bs_matches_invalidate after insert or update of state on public.bs_matches
  for each row execute function bs_private.room_invalidation();
create trigger bs_requests_invalidate after insert or update of status on public.bs_friend_requests
  for each row execute function bs_private.social_invalidation();
create trigger bs_friends_invalidate after insert or delete on public.bs_friends
  for each row execute function bs_private.social_invalidation();
create trigger bs_invites_invalidate after insert or update of status on public.bs_invites
  for each row execute function bs_private.social_invalidation();
