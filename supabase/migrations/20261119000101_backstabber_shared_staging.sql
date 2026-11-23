-- PROPOSED / LOCAL-ONLY: not authorized for hosted application.
-- Creates empty isolated game tables. Java validates the Auth UUID over HTTP;
-- no foreign key or privilege on managed auth.users is required or granted.
-- Run as a trusted migration administrator able to create roles and assign ownership.
-- Deliberately fails on pre-existing names. Provision the LOGIN password separately.
-- This boundary applies to bs_staging_app, not privileged database administrators.
begin;

do $preflight$
begin
  if exists (select 1 from pg_catalog.pg_roles
             where rolname in ('bs_staging_owner', 'bs_staging_app'))
     or exists (select 1 from pg_catalog.pg_namespace where nspname = 'bs_staging') then
    raise exception 'Staging role/schema collision; inspect manually, never adopt existing objects';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class
          where oid = 'realtime.messages'::pg_catalog.regclass) then
    raise exception 'realtime.messages must already have RLS enabled';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'realtime.send(jsonb,text,text,boolean)'::pg_catalog.regprocedure
      and not p.prosecdef and exists (
        select 1 from pg_catalog.aclexplode(coalesce(p.proacl,
          pg_catalog.acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'Staging requires invoker realtime.send with existing PUBLIC EXECUTE';
  end if;
  if not pg_catalog.has_schema_privilege('realtime', 'USAGE WITH GRANT OPTION')
     or not pg_catalog.has_table_privilege('realtime.messages', 'INSERT WITH GRANT OPTION') then
    raise exception 'Executor must delegate realtime schema USAGE and messages INSERT';
  end if;
end;
$preflight$;

create role bs_staging_owner nologin nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls noinherit;
create role bs_staging_app login password null nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls noinherit;

-- PostgreSQL 17 gives a CREATEROLE creator ADMIN on new roles but does not
-- automatically allow SET ROLE/ownership assignment. Bootstrap only these new
-- collision-checked roles. Cleanup revokes our temporary self-grants while
-- preserving PostgreSQL's automatic bootstrap-superuser ADMIN-only grants
-- for a non-superuser creator. Those allow future credential/rollback management.
-- https://www.postgresql.org/docs/17/role-attributes.html
do $bootstrap_membership$
begin
  perform pg_catalog.set_config('bs_staging.bootstrap_executor', current_user, true);
  execute pg_catalog.format(
    'grant bs_staging_owner to %I with inherit true, set true', current_user);
  execute pg_catalog.format(
    'grant bs_staging_app to %I with inherit false, set true', current_user);
end;
$bootstrap_membership$;
alter role bs_staging_app set search_path = bs_staging, pg_catalog;

create schema bs_staging authorization bs_staging_owner;
revoke all on schema bs_staging from public, anon, authenticated, bs_staging_app;
grant usage on schema bs_staging to bs_staging_app, authenticated;
grant usage on schema realtime to bs_staging_owner;
-- PUBLIC already has EXECUTE on invoker send(). Do not regrant managed function
-- privileges without GRANT OPTION. Only fixed trigger bodies use this no-login
-- owner's INSERT bridge; the runtime cannot assume its role.
grant insert on realtime.messages to bs_staging_owner;
create policy bs_staging_owner_hml_broadcast on realtime.messages
  for insert to bs_staging_owner with check (
    private is true and extension = 'broadcast' and event = 'invalidate'
    -- send() may add its transport UUID; fixture/older versions may omit it.
    and (not (payload ? 'id') or (
      pg_catalog.jsonb_typeof(payload -> 'id') = 'string'
      and payload ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ))
    and (
      (topic ~ '^hml:user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and payload - 'id' = '{"kind":"social"}'::jsonb)
      or
      (topic ~ '^hml:room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and payload - 'id' = '{"kind":"room"}'::jsonb)
    )
  );

-- Reject existing PUBLIC Auth table privileges, including column REFERENCES.
-- The staging owner needs no rights on managed Auth tables.
do $owner_auth_boundary$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (pg_catalog.has_table_privilege('bs_staging_owner', c.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_any_column_privilege('bs_staging_owner', c.oid,
             'SELECT,INSERT,UPDATE,REFERENCES'))
  ) then
    raise exception 'PUBLIC privileges violate the staging owner Auth boundary; inspect manually';
  end if;
end;
$owner_auth_boundary$;

create table bs_staging.bs_profiles (
  -- HTTP writes bind Java's validated Auth principal, never a client UUID.
  -- Auth deletion intentionally retains this row until approved staging cleanup.
  user_id uuid primary key,
  username text not null unique check (username ~ '^[a-z0-9_]{3,18}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text check (char_length(avatar_url) <= 2048 and avatar_url like 'https://%'),
  show_online boolean not null default false,
  last_seen timestamptz
);
create index bs_profiles_username_prefix on bs_staging.bs_profiles (username text_pattern_ops);

create table bs_staging.bs_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  recipient_id uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create unique index bs_friend_requests_pending_pair on bs_staging.bs_friend_requests
  (least(sender_id, recipient_id), greatest(sender_id, recipient_id)) where status = 'pending';
create index bs_friend_requests_sender on bs_staging.bs_friend_requests (sender_id, created_at desc);
create index bs_friend_requests_recipient on bs_staging.bs_friend_requests (recipient_id, created_at desc);

create table bs_staging.bs_friends (
  user_a uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  user_b uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index bs_friends_user_b on bs_staging.bs_friends (user_b);

create table bs_staging.bs_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9A-F]{10}$'),
  host_id uuid references bs_staging.bs_profiles (user_id) on delete set null,
  capacity integer not null check (capacity between 2 and 10),
  status text not null default 'lobby' check (status in ('lobby', 'started', 'closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index bs_rooms_host on bs_staging.bs_rooms (host_id);

create table bs_staging.bs_room_members (
  room_id uuid not null references bs_staging.bs_rooms (id) on delete cascade,
  user_id uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  ready boolean not null default false,
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index bs_room_members_user on bs_staging.bs_room_members (user_id, room_id);

create table bs_staging.bs_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references bs_staging.bs_rooms (id) on delete cascade,
  sender_id uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  recipient_id uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  check (sender_id <> recipient_id)
);
create unique index bs_invites_pending_room_recipient on bs_staging.bs_invites
  (room_id, recipient_id) where status = 'pending';
create index bs_invites_room on bs_staging.bs_invites (room_id);
create index bs_invites_sender on bs_staging.bs_invites (sender_id);
create index bs_invites_recipient on bs_staging.bs_invites (recipient_id, created_at desc);

create table bs_staging.bs_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references bs_staging.bs_rooms (id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now()
);

create table bs_staging.bs_match_commands (
  match_id uuid not null references bs_staging.bs_matches (id) on delete cascade,
  user_id uuid not null references bs_staging.bs_profiles (user_id) on delete cascade,
  command_id text not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, command_id)
);
create index bs_match_commands_user on bs_staging.bs_match_commands (user_id);

-- Scrub default grants on NEW staging objects only. Existing public objects are untouched.
do $tables$
declare
  relation record;
begin
  for relation in select c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'bs_staging' and c.relkind = 'r'
  loop
    execute pg_catalog.format('alter table bs_staging.%I owner to bs_staging_owner', relation.relname);
    execute pg_catalog.format('alter table bs_staging.%I enable row level security', relation.relname);
    execute pg_catalog.format('revoke all on table bs_staging.%I from public, anon, authenticated, bs_staging_app', relation.relname);
    execute pg_catalog.format('grant select, insert, update, delete on table bs_staging.%I to bs_staging_app', relation.relname);
    execute pg_catalog.format('create policy bs_staging_app_dml on bs_staging.%I for all to bs_staging_app using (true) with check (true)', relation.relname);
  end loop;
end;
$tables$;

-- Authenticated clients can read only their own room/user membership columns.
grant select (room_id, user_id) on bs_staging.bs_room_members to authenticated;
create policy bs_staging_membership_for_realtime on bs_staging.bs_room_members
  for select to authenticated using (user_id = (select auth.uid()));

-- Additive policies: production topics and existing policy definitions are unchanged.
create policy bs_staging_hml_receive on realtime.messages for select to authenticated using (
  topic = (select realtime.topic())
  and (
    (extension = 'broadcast' and topic = 'hml:user:' || (select auth.uid())::text)
    or (extension in ('broadcast', 'presence') and exists (
      select 1 from bs_staging.bs_room_members m
      where m.user_id = (select auth.uid())
        and 'hml:room:' || m.room_id::text = (select realtime.topic())
    ))
  )
);
create policy bs_staging_hml_track on realtime.messages for insert to authenticated with check (
  topic = (select realtime.topic()) and extension = 'presence' and exists (
    select 1 from bs_staging.bs_room_members m
    where m.user_id = (select auth.uid())
      and 'hml:room:' || m.room_id::text = (select realtime.topic())
  )
);

-- Restrictive guards keep unrelated broad permissive policies from exposing hml.
-- They return true for every non-hml topic, preserving production authorization.
create policy bs_staging_hml_receive_guard on realtime.messages as restrictive
  for select to authenticated using (
    topic not like 'hml:%' or (
      topic = (select realtime.topic())
      and (
        (extension = 'broadcast' and topic = 'hml:user:' || (select auth.uid())::text)
        or (extension in ('broadcast', 'presence') and exists (
          select 1 from bs_staging.bs_room_members m
          where m.user_id = (select auth.uid())
            and 'hml:room:' || m.room_id::text = (select realtime.topic())
        ))
      )
    )
  );
create policy bs_staging_hml_track_guard on realtime.messages as restrictive
  for insert to authenticated with check (
    topic not like 'hml:%' or (
      topic = (select realtime.topic()) and extension = 'presence' and exists (
        select 1 from bs_staging.bs_room_members m
        where m.user_id = (select auth.uid())
          and 'hml:room:' || m.room_id::text = (select realtime.topic())
      )
    )
  );

create function bs_staging.room_invalidation() returns trigger language plpgsql security definer
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

  perform realtime.send('{"kind":"room"}'::jsonb, 'invalidate', 'hml:room:' || room::text, true);
  return null;
end;
$$;

create function bs_staging.social_invalidation() returns trigger language plpgsql security definer
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
  perform realtime.send('{"kind":"social"}'::jsonb, 'invalidate', 'hml:user:' || sender::text, true);
  perform realtime.send('{"kind":"social"}'::jsonb, 'invalidate', 'hml:user:' || recipient::text, true);
  return null;
end;
$$;
revoke all on function bs_staging.room_invalidation(), bs_staging.social_invalidation()
  from public, anon, authenticated;

create trigger bs_rooms_invalidate after insert or update of host_id, status on bs_staging.bs_rooms
  for each row execute function bs_staging.room_invalidation();
create trigger bs_members_invalidate after insert or update of ready, last_seen or delete on bs_staging.bs_room_members
  for each row execute function bs_staging.room_invalidation();
create trigger bs_matches_invalidate after insert or update of state on bs_staging.bs_matches
  for each row execute function bs_staging.room_invalidation();
create trigger bs_requests_invalidate after insert or update of status on bs_staging.bs_friend_requests
  for each row execute function bs_staging.social_invalidation();
create trigger bs_friends_invalidate after insert or delete on bs_staging.bs_friends
  for each row execute function bs_staging.social_invalidation();
create trigger bs_invites_invalidate after insert or update of status on bs_staging.bs_invites
  for each row execute function bs_staging.social_invalidation();

alter function bs_staging.room_invalidation() owner to bs_staging_owner;
alter function bs_staging.social_invalidation() owner to bs_staging_owner;
revoke all on function bs_staging.room_invalidation(), bs_staging.social_invalidation()
  from public, anon, authenticated, bs_staging_app;

-- SECURITY INVOKER is intentional: inspect the actual JDBC current_user.
-- Hikari connectionInitSql: select bs_staging.assert_runtime_role()
create function bs_staging.assert_runtime_role() returns void
  language plpgsql security invoker set search_path = '' as $runtime$
declare
  runtime_oid oid;
  invalid_role boolean;
  exposed_relation text;
  auth_users_oid oid;
  realtime_schema_oid oid;
  realtime_send_oid oid;
  realtime_send_definer boolean;
  realtime_messages_oid oid;
begin
  if current_user <> 'bs_staging_app' then
    raise exception 'Staging JDBC must connect as bs_staging_app; got %', current_user
      using errcode = '42501';
  end if;
  select oid, (rolsuper or rolcreatedb or rolcreaterole or rolreplication
               or rolbypassrls or rolinherit or not rolcanlogin)
    into runtime_oid, invalid_role
    from pg_catalog.pg_roles where rolname = current_user;
  if runtime_oid is null or invalid_role then
    raise exception 'Unsafe bs_staging_app role attributes' using errcode = '42501';
  end if;
  -- NOINHERIT alone does not stop SET ROLE: reject all memberships, including
  -- memberships with INHERIT FALSE / SET TRUE in newer PostgreSQL releases.
  if exists (select 1 from pg_catalog.pg_auth_members where member = runtime_oid) then
    raise exception 'bs_staging_app must not be a member of any role' using errcode = '42501';
  end if;
  if exists (select 1 from pg_catalog.pg_class where relowner = runtime_oid)
     or exists (select 1 from pg_catalog.pg_namespace where nspowner = runtime_oid)
     or exists (select 1 from pg_catalog.pg_proc where proowner = runtime_oid)
     or exists (select 1 from pg_catalog.pg_database where datdba = runtime_oid) then
    raise exception 'bs_staging_app must not own database objects' using errcode = '42501';
  end if;

  -- Includes PUBLIC grants, column-only grants and other game schemas.
  -- Fail closed rather than changing any pre-existing production privileges.
  select pg_catalog.format('%I.%I', n.nspname, c.relname) into exposed_relation
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname <> 'bs_staging' and c.relname like 'bs\_%' escape '\'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (pg_catalog.has_table_privilege(runtime_oid, c.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_any_column_privilege(runtime_oid, c.oid,
            'SELECT,INSERT,UPDATE,REFERENCES'))
    limit 1;
  if exposed_relation is not null then
    raise exception 'bs_staging_app has forbidden privileges on %; repair outside this migration', exposed_relation
      using errcode = '42501';
  end if;

  if pg_catalog.has_database_privilege(runtime_oid, pg_catalog.current_database(), 'CREATE')
     or exists (select 1 from pg_catalog.pg_namespace n
                where pg_catalog.has_schema_privilege(runtime_oid, n.oid, 'CREATE'))
     or exists (
       select 1 from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'bs_staging' and c.relkind in ('r', 'p')
         and pg_catalog.has_table_privilege(runtime_oid, c.oid, 'TRUNCATE,REFERENCES,TRIGGER')
     ) then
    raise exception 'bs_staging_app has staging DDL or excessive table privileges' using errcode = '42501';
  end if;
  -- Resolve dependency OIDs through readable catalogs. Name-based privilege
  -- overloads resolve qualified objects using the caller's schema permissions;
  -- this restricted role intentionally has no USAGE on auth or realtime.
  select c.oid into auth_users_oid
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users';
  select n.oid into realtime_schema_oid
    from pg_catalog.pg_namespace n where n.nspname = 'realtime';
  select c.oid into realtime_messages_oid
    from pg_catalog.pg_class c
    where c.relnamespace = realtime_schema_oid and c.relname = 'messages';
  select p.oid, p.prosecdef into realtime_send_oid, realtime_send_definer
    from pg_catalog.pg_proc p
    where p.pronamespace = realtime_schema_oid and p.proname = 'send'
      and p.pronargs = 4
      and p.proargtypes[0] = 'pg_catalog.jsonb'::pg_catalog.regtype
      and p.proargtypes[1] = 'pg_catalog.text'::pg_catalog.regtype
      and p.proargtypes[2] = 'pg_catalog.text'::pg_catalog.regtype
      and p.proargtypes[3] = 'pg_catalog.bool'::pg_catalog.regtype;
  if auth_users_oid is null or realtime_schema_oid is null
     or realtime_send_oid is null or realtime_messages_oid is null then
    raise exception 'Required staging dependencies are missing' using errcode = '42501';
  end if;
  if pg_catalog.has_table_privilege(runtime_oid, auth_users_oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or pg_catalog.has_any_column_privilege(runtime_oid, auth_users_oid,
       'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'bs_staging_app must not have Auth table privileges' using errcode = '42501';
  end if;
  if pg_catalog.has_table_privilege(runtime_oid, realtime_messages_oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or pg_catalog.has_any_column_privilege(runtime_oid, realtime_messages_oid,
       'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'bs_staging_app must not have Realtime table privileges' using errcode = '42501';
  end if;
  -- PUBLIC EXECUTE on an invoker send() gives no write capability without
  -- INSERT on messages. A callable definer send() would bypass that boundary.
  if realtime_send_definer
     and pg_catalog.has_schema_privilege(runtime_oid, realtime_schema_oid, 'USAGE')
     and pg_catalog.has_function_privilege(runtime_oid, realtime_send_oid, 'EXECUTE') then
    raise exception 'bs_staging_app can invoke realtime.send directly; review existing PUBLIC grants'
      using errcode = '42501';
  end if;
end;
$runtime$;
alter function bs_staging.assert_runtime_role() owner to bs_staging_owner;
revoke all on function bs_staging.assert_runtime_role() from public, anon, authenticated;
grant execute on function bs_staging.assert_runtime_role() to bs_staging_app;

-- Validate with exactly the runtime effective role, before the transaction commits.
set local role bs_staging_app;
select bs_staging.assert_runtime_role();
reset role;
-- RESET ROLE returns to session_user; restore the original migration executor
-- if the caller entered under SET ROLE. Revoke ONLY this executor's temporary
-- self-grants, without CASCADE. A non-superuser CREATEROLE creator cannot alter
-- the automatic bootstrap-superuser ADMIN-only grants and needs those grants
-- for future password provisioning and scoped rollback. Superuser executors may
-- have no remaining memberships because their intrinsic privileges suffice.
do $bootstrap_cleanup$
declare
  executor_name text := pg_catalog.current_setting('bs_staging.bootstrap_executor');
  executor_is_superuser boolean;
  managed_role_count integer;
begin
  if current_user <> executor_name then
    execute pg_catalog.format('set local role %I', executor_name);
  end if;
  execute pg_catalog.format(
    'revoke bs_staging_owner, bs_staging_app from %I granted by %I',
    executor_name, executor_name);
  select rolsuper into executor_is_superuser
    from pg_catalog.pg_roles where rolname = executor_name;
  select pg_catalog.count(distinct m.roleid) into managed_role_count
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles r on r.oid = m.roleid
    join pg_catalog.pg_roles recipient on recipient.oid = m.member
    where r.rolname in ('bs_staging_owner', 'bs_staging_app')
      and recipient.rolname = executor_name;
  if (not executor_is_superuser and managed_role_count <> 2) or exists (
    select 1 from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles r on r.oid = m.roleid
    join pg_catalog.pg_roles recipient on recipient.oid = m.member
    where r.rolname in ('bs_staging_owner', 'bs_staging_app')
      and recipient.rolname = executor_name
      and (not m.admin_option or m.inherit_option or m.set_option
           or m.grantor = m.member)
  ) then
    raise exception 'Only automatic ADMIN-only creator memberships may remain';
  end if;
  if exists (
    select 1 from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles recipient on recipient.oid = m.member
    where recipient.rolname = 'bs_staging_app'
  ) then
    raise exception 'bs_staging_app must remain a member of no roles';
  end if;
end;
$bootstrap_cleanup$;
commit;
