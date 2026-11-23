-- PROPOSED / LOCAL-ONLY rollback. Never run against hosted infrastructure without
-- separate authorization. Removes ALL staging game data if subsequently populated.
-- Does not drop shared auth users, public game objects, or production RT policies.
-- Deliberately avoids CASCADE: unexpected external dependencies abort atomically.
-- Run as the SAME effective migration executor: REVOKE depends on the grantor.
-- Another administrator must separately review grant provenance; merely having
-- SUPERUSER does not guarantee these unqualified REVOKEs remove another grantor's ACL.
-- Its automatic PostgreSQL ADMIN-only grants permit temporarily enabling teardown
-- capabilities on these new roles; no production role membership is needed.
begin;

do $ownership$
begin
  if not exists (
    select 1 from pg_catalog.pg_namespace n
    join pg_catalog.pg_roles r on r.oid = n.nspowner
    where n.nspname = 'bs_staging' and r.rolname = 'bs_staging_owner'
  ) or not exists (select 1 from pg_catalog.pg_roles where rolname = 'bs_staging_app') then
    raise exception 'Expected staging roles/schema not found; inspect manually';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles r on r.oid = c.relowner
    where n.nspname = 'bs_staging' and c.relkind in ('r', 'p')
      and r.rolname <> 'bs_staging_owner'
  ) then
    raise exception 'Unexpected staging table owner; inspect manually';
  end if;
end;
$ownership$;

-- Scope temporary teardown capabilities to the validated staging roles only.
-- Dropping the roles below removes these memberships transactionally as well.
do $teardown_membership$
begin
  execute pg_catalog.format(
    'grant bs_staging_owner to %I with inherit true, set true', current_user);
  execute pg_catalog.format(
    'grant bs_staging_app to %I with inherit false, set true', current_user);
end;
$teardown_membership$;

drop policy bs_staging_owner_hml_broadcast on realtime.messages;
drop policy bs_staging_hml_receive on realtime.messages;
drop policy bs_staging_hml_track on realtime.messages;
drop policy bs_staging_hml_receive_guard on realtime.messages;
drop policy bs_staging_hml_track_guard on realtime.messages;

-- Listing every object keeps unrelated schemas outside the rollback scope.
-- Dropping these tables also removes only their own triggers/policies/indexes.
drop table bs_staging.bs_match_commands, bs_staging.bs_matches,
  bs_staging.bs_invites, bs_staging.bs_room_members, bs_staging.bs_friends,
  bs_staging.bs_friend_requests, bs_staging.bs_rooms, bs_staging.bs_profiles;
drop function bs_staging.room_invalidation();
drop function bs_staging.social_invalidation();
drop function bs_staging.assert_runtime_role();
drop schema bs_staging;

revoke insert on realtime.messages from bs_staging_owner;
revoke usage on schema realtime from bs_staging_owner;
-- No Auth grant or managed-function grant was made. Preserve PUBLIC EXECUTE.
-- RESTRICT behavior rejects unexpected additional grants/dependencies.
-- Never use DROP OWNED: it could remove grants outside the known staging scope.
drop role bs_staging_app;
drop role bs_staging_owner;
commit;
