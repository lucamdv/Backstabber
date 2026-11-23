-- PROPOSED PREFLIGHT. Hosted execution requires separate, explicit authorization.
-- PostgreSQL catalogs only. No game/Auth rows, passwords, bodies, JWTs or settings dumps.
-- Every statement is SELECT (some use read-only CTEs). No SET ROLE, DDL, DML,
-- custom functions, realtime.send(), migration or rollback execution.
-- Run under the EXACT proposed migration executor, on an approved connection.
-- Prefer an externally configured read-only transaction with a timeout.
-- Empty output is NOT a GO. Interpret all results with docs/av3/11-sprint-03-5c-preflight.md.
-- Body/expression hashes detect drift; they do not prove semantic compatibility.

-- Q01: execution identity, version and read-only state. PG17 is the tested baseline.
select 'Q01_context' as audit, current_user as executor, session_user as login_role,
       pg_catalog.current_database() as database_name,
       pg_catalog.current_setting('server_version_num')::integer as server_version_num,
       pg_catalog.current_setting('transaction_read_only') as transaction_read_only,
       pg_catalog.current_setting('max_connections')::integer as max_connections,
       r.rolsuper, r.rolcreaterole,
       pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE') as can_create_schema,
       pg_catalog.has_database_privilege(r.oid, d.oid, 'CONNECT') as can_connect
from pg_catalog.pg_roles r
join pg_catalog.pg_database d on d.datname = pg_catalog.current_database()
where r.rolname = current_user;

-- Q02: names must be absent before first application. Never adopt collisions.
select 'Q02_collisions' as audit, 'role' as object_type, rolname as object_name
from pg_catalog.pg_roles where rolname in ('bs_staging_owner', 'bs_staging_app')
union all
select 'Q02_collisions', 'schema', nspname
from pg_catalog.pg_namespace where nspname = 'bs_staging'
union all
select 'Q02_collisions', 'realtime policy', p.polname
from pg_catalog.pg_policy p
join pg_catalog.pg_class c on c.oid = p.polrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'realtime' and c.relname = 'messages'
  and p.polname in ('bs_staging_owner_hml_broadcast', 'bs_staging_hml_receive',
    'bs_staging_hml_track', 'bs_staging_hml_receive_guard', 'bs_staging_hml_track_guard')
order by object_type, object_name;

-- Q03: pg_roles intentionally excludes password hashes (do not use pg_authid).
select 'Q03_roles' as audit, rolname, rolsuper, rolinherit, rolcreaterole,
       rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit
from pg_catalog.pg_roles order by rolname;

-- Q04: membership grantor and PG16+ ADMIN/INHERIT/SET options.
-- to_jsonb permits a diagnostic on older servers without naming absent columns.
select 'Q04_memberships' as audit, parent.rolname as granted_role,
       member.rolname as member_role, grantor.rolname as grantor, m.admin_option,
       pg_catalog.to_jsonb(m) ->> 'inherit_option' as inherit_option,
       pg_catalog.to_jsonb(m) ->> 'set_option' as set_option
from pg_catalog.pg_auth_members m
join pg_catalog.pg_roles parent on parent.oid = m.roleid
join pg_catalog.pg_roles member on member.oid = m.member
join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
order by granted_role, member_role, grantor;

-- Q05: ownership and effective schema privileges; a managed postgres is not superuser.
select 'Q05_schemas' as audit, n.nspname, owner.rolname as owner,
       pg_catalog.has_schema_privilege(n.oid, 'USAGE') as executor_usage,
       pg_catalog.has_schema_privilege(n.oid, 'USAGE WITH GRANT OPTION') as can_delegate_usage,
       pg_catalog.has_schema_privilege(n.oid, 'CREATE') as executor_create
from pg_catalog.pg_namespace n
join pg_catalog.pg_roles owner on owner.oid = n.nspowner
where n.nspname in ('public', 'bs_staging', 'auth', 'realtime', 'extensions')
order by n.nspname;

-- Q06: exact delegation required on PRE-EXISTING shared objects.
-- A usable privilege is different from WITH GRANT OPTION. Missing rows are blockers.
select 'Q06_delegation' as audit, 'auth.users(id)' as object_name,
       'REFERENCES' as privilege,
       pg_catalog.has_column_privilege(c.oid, a.attnum, 'REFERENCES') as executor_can_use,
       pg_catalog.has_column_privilege(c.oid, a.attnum, 'REFERENCES WITH GRANT OPTION') as can_delegate,
       owner.rolname as owner
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped
join pg_catalog.pg_roles owner on owner.oid = c.relowner
where n.nspname = 'auth' and c.relname = 'users'
union all
select 'Q06_delegation', 'realtime.messages', 'INSERT',
       pg_catalog.has_table_privilege(c.oid, 'INSERT'),
       pg_catalog.has_table_privilege(c.oid, 'INSERT WITH GRANT OPTION'), owner.rolname
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_roles owner on owner.oid = c.relowner
where n.nspname = 'realtime' and c.relname = 'messages'
union all
select 'Q06_delegation', 'realtime.send(jsonb,text,text,boolean)', 'EXECUTE',
       pg_catalog.has_function_privilege(p.oid, 'EXECUTE'),
       pg_catalog.has_function_privilege(p.oid, 'EXECUTE WITH GRANT OPTION'), owner.rolname
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_roles owner on owner.oid = p.proowner
where n.nspname = 'realtime' and p.proname = 'send'
  and p.proargtypes = '3802 25 25 16'::pg_catalog.oidvector;

-- Q07: table/view ownership, RLS and structure fingerprint. No table contents.
select 'Q07_relations' as audit, n.nspname, c.relname, c.relkind,
       owner.rolname as owner, c.relrowsecurity, c.relforcerowsecurity,
       pg_catalog.has_table_privilege(c.oid, 'SELECT WITH GRANT OPTION') as can_delegate_select,
       pg_catalog.has_table_privilege(c.oid, 'INSERT WITH GRANT OPTION') as can_delegate_insert,
       pg_catalog.md5(coalesce((select pg_catalog.string_agg(
         a.attnum::text || ':' || a.attname || ':' || a.atttypid::text || ':' ||
         a.atttypmod::text || ':' || a.attnotnull::text || ':' || coalesce(ad.adbin::text, ''),
         '|' order by a.attnum)
         from pg_catalog.pg_attribute a
         left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '')) as columns_hash
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_roles owner on owner.oid = c.relowner
where c.relkind in ('r', 'p', 'v', 'm', 'f') and
  ((n.nspname in ('public', 'bs_staging') and c.relname like 'bs\_%' escape '\')
    or (n.nspname = 'auth' and c.relname = 'users')
    or n.nspname = 'realtime')
order by n.nspname, c.relname;

-- Q08: explicit/default table ACLs, including PUBLIC. Partition ACLs matter too.
select 'Q08_table_acl' as audit, n.nspname, c.relname,
       case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end as grantee,
       grantor.rolname as grantor, acl.privilege_type, acl.is_grantable
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,
  pg_catalog.acldefault('r', c.relowner))) acl
left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
left join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
where c.relkind in ('r', 'p', 'v', 'm', 'f') and
  ((c.relname like 'bs\_%' escape '\' and n.nspname <> 'pg_catalog')
    or n.nspname in ('auth', 'realtime'))
order by n.nspname, c.relname, grantee, acl.privilege_type;

-- Q09: column grants can bypass an apparently clean table ACL.
select 'Q09_column_acl' as audit, n.nspname, c.relname, a.attname,
       case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end as grantee,
       grantor.rolname as grantor, acl.privilege_type, acl.is_grantable
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(a.attacl) acl
left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
left join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
where a.attnum > 0 and not a.attisdropped and
  (c.relname like 'bs\_%' escape '\' or n.nspname in ('auth', 'realtime'))
order by n.nspname, c.relname, a.attname, grantee, acl.privilege_type;

-- Q10: global and schema default privileges, including unrelated grantees.
-- New staging tables/functions are initially created by the migration executor.
select 'Q10_default_acl' as audit, owner.rolname as creating_role,
       coalesce(n.nspname, '<global>') as schema_name, d.defaclobjtype,
       case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end as grantee,
       grantor.rolname as grantor, acl.privilege_type, acl.is_grantable
from pg_catalog.pg_default_acl d
join pg_catalog.pg_roles owner on owner.oid = d.defaclrole
left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
left join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
order by creating_role, schema_name, d.defaclobjtype, grantee, acl.privilege_type;

-- Q11: PUBLIC database/schema rights reach a fresh role without any membership.
select 'Q11_public_boundary' as audit, 'database' as object_type,
       d.datname as object_name, acl.privilege_type, acl.is_grantable
from pg_catalog.pg_database d
cross join lateral pg_catalog.aclexplode(coalesce(d.datacl,
  pg_catalog.acldefault('d', d.datdba))) acl
where d.datname = pg_catalog.current_database() and acl.grantee = 0
union all
select 'Q11_public_boundary', 'schema', n.nspname, acl.privilege_type, acl.is_grantable
from pg_catalog.pg_namespace n
cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,
  pg_catalog.acldefault('n', n.nspowner))) acl
where acl.grantee = 0
order by object_type, object_name, privilege_type;

-- Q12: policy fingerprints, applicable roles and conservative risk indicators.
-- Expressions are inspected in memory by catalog functions, never exported here.
select 'Q12_policies' as audit, n.nspname, c.relname, p.polname,
       owner.rolname as table_owner, p.polcmd, p.polpermissive,
       (select pg_catalog.string_agg(case when x.role_oid = 0 then 'PUBLIC' else r.rolname end,
          ',' order by x.role_oid)
        from pg_catalog.unnest(p.polroles) x(role_oid)
        left join pg_catalog.pg_roles r on r.oid = x.role_oid) as policy_roles,
       exists(select 1 from pg_catalog.unnest(p.polroles) x(role_oid)
         join pg_catalog.pg_roles r on r.rolname = 'authenticated'
         where case when x.role_oid = 0 then true
           else pg_catalog.pg_has_role(r.oid, x.role_oid, 'USAGE') end) as applies_to_authenticated,
       pg_catalog.md5(coalesce(p.polqual::text, '')) as using_hash,
       pg_catalog.md5(coalesce(p.polwithcheck::text, '')) as check_hash,
       p.polqual is null as using_absent,
       p.polwithcheck is null as check_absent,
       coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') = 'true' as using_literal_true,
       coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true' as check_literal_true,
       (coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
        coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')) like '%hml:%' as mentions_hml
from pg_catalog.pg_policy p
join pg_catalog.pg_class c on c.oid = p.polrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_roles owner on owner.oid = c.relowner
where n.nspname = 'bs_staging' or (n.nspname = 'public' and c.relname like 'bs\_%' escape '\')
   or (n.nspname = 'realtime' and c.relname = 'messages')
order by n.nspname, c.relname, p.polname;

-- Q13: required function signatures + all non-system SECURITY DEFINER functions.
-- No source, default argument values or arbitrary proconfig values are emitted.
select 'Q13_functions' as audit, n.nspname, p.proname, p.oid as function_oid,
       pg_catalog.oidvectortypes(p.proargtypes) as input_types,
       pg_catalog.format_type(p.prorettype, null) as return_type,
       owner.rolname as owner, l.lanname, p.prosecdef, p.provolatile,
       pg_catalog.md5(p.prosrc) as body_hash,
       pg_catalog.md5(coalesce(p.proconfig::text, '')) as config_hash,
       exists(select 1 from pg_catalog.unnest(p.proconfig) s(setting)
         where s.setting like 'search_path=%') as explicit_search_path,
       pg_catalog.has_function_privilege(p.oid, 'EXECUTE WITH GRANT OPTION') as can_delegate_execute,
       exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,
         pg_catalog.acldefault('f', p.proowner))) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
       p.prosrc like '%hml:%' as source_mentions_hml,
       p.prosrc like '%bs_staging%' as source_mentions_staging,
       p.prosrc like '%public.bs_%' as source_mentions_public_game
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_roles owner on owner.oid = p.proowner
join pg_catalog.pg_language l on l.oid = p.prolang
where (p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
         and n.nspname not like 'pg_toast%')
   or n.nspname = 'bs_staging'
   or (n.nspname = 'realtime' and p.proname in ('send', 'topic'))
   or (n.nspname = 'auth' and p.proname = 'uid')
   or (n.nspname = 'pg_catalog' and p.proname = 'gen_random_uuid')
order by n.nspname, p.proname, p.oid;

-- Q14: function ACLs and language delegation. Safe fingerprints cannot replace review.
select 'Q14_function_acl' as audit, n.nspname, p.proname, p.oid as function_oid,
       case when a.grantee = 0 then 'PUBLIC' else r.rolname end as grantee,
       grantor.rolname as grantor, a.privilege_type, a.is_grantable
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,
  pg_catalog.acldefault('f', p.proowner))) a
left join pg_catalog.pg_roles r on r.oid = a.grantee
left join pg_catalog.pg_roles grantor on grantor.oid = a.grantor
where n.nspname in ('bs_staging', 'auth', 'realtime')
   or (p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
     and n.nspname not like 'pg_toast%')
order by n.nspname, p.proname, p.oid, grantee;

-- Q15: managed capability hints. Extension presence/settings are NOT proof of GRANT/DDL rights.
select 'Q15_managed_capabilities' as audit, 'extension' as kind,
       e.extname as name, e.extversion as version,
       owner.rolname as owner, null::text as value_hash
from pg_catalog.pg_extension e
join pg_catalog.pg_roles owner on owner.oid = e.extowner
where e.extname in ('supautils', 'pgcrypto', 'uuid-ossp')
union all
select 'Q15_managed_capabilities', 'setting', s.name, null, null,
       pg_catalog.md5(s.setting)
from pg_catalog.pg_settings s
where s.name in ('supautils.policy_grants', 'supautils.privileged_role')
order by kind, name;

-- Q16: triggers and event triggers. No arguments or source text.
select 'Q16_triggers' as audit, n.nspname, c.relname, t.tgname, t.tgisinternal,
       t.tgenabled, fn.nspname as function_schema, p.proname as function_name,
       owner.rolname as function_owner, p.prosecdef,
       pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid, true)) as definition_hash
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
join pg_catalog.pg_namespace fn on fn.oid = p.pronamespace
join pg_catalog.pg_roles owner on owner.oid = p.proowner
where n.nspname in ('bs_staging', 'auth', 'realtime')
   or (n.nspname = 'public' and c.relname like 'bs\_%' escape '\')
order by n.nspname, c.relname, t.tgname;

select 'Q17_event_triggers' as audit, e.evtname, e.evtevent, e.evtenabled,
       owner.rolname as owner, n.nspname as function_schema, p.proname as function_name,
       e.evttags, p.prosecdef, pg_catalog.md5(p.prosrc) as body_hash
from pg_catalog.pg_event_trigger e
join pg_catalog.pg_roles owner on owner.oid = e.evtowner
join pg_catalog.pg_proc p on p.oid = e.evtfoid
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
order by e.evtname;

-- Q18: constraints/index fingerprints and FK direction. No row counts or key values.
select 'Q18_constraints' as audit, n.nspname, c.relname, k.conname, k.contype,
       k.convalidated, rn.nspname as referenced_schema, rc.relname as referenced_table,
       k.confdeltype, pg_catalog.md5(pg_catalog.pg_get_constraintdef(k.oid, true)) as definition_hash
from pg_catalog.pg_constraint k
join pg_catalog.pg_class c on c.oid = k.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_class rc on rc.oid = k.confrelid
left join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
where n.nspname = 'bs_staging' or (n.nspname = 'public' and c.relname like 'bs\_%' escape '\')
   or rn.nspname = 'bs_staging'
order by n.nspname, c.relname, k.conname;

select 'Q19_indexes' as audit, n.nspname, c.relname, idx.relname as index_name,
       i.indisunique, i.indisprimary, i.indisvalid,
       pg_catalog.md5(pg_catalog.pg_get_indexdef(i.indexrelid)) as definition_hash
from pg_catalog.pg_index i
join pg_catalog.pg_class c on c.oid = i.indrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_class idx on idx.oid = i.indexrelid
where n.nspname = 'bs_staging' or (n.nspname = 'public' and c.relname like 'bs\_%' escape '\')
order by n.nspname, c.relname, idx.relname;

-- Q20: dependencies both directions, including dependencies of shared RT policies.
-- Catalog edges do NOT cover dynamic SQL/PLpgSQL strings or external applications.
with targets(classid, objid) as (
  select 'pg_catalog.pg_namespace'::pg_catalog.regclass::oid, n.oid
  from pg_catalog.pg_namespace n where n.nspname = 'bs_staging'
  union
  select 'pg_catalog.pg_class'::pg_catalog.regclass::oid, c.oid
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'bs_staging'
    or (n.nspname = 'public' and c.relname like 'bs\_%' escape '\')
    or (n.nspname = 'auth' and c.relname = 'users')
    or (n.nspname = 'realtime' and c.relname = 'messages')
  union
  select 'pg_catalog.pg_proc'::pg_catalog.regclass::oid, p.oid
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'bs_staging' or (n.nspname = 'realtime' and p.proname in ('send', 'topic'))
  union
  select 'pg_catalog.pg_policy'::pg_catalog.regclass::oid, p.oid
  from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'bs_staging' or (n.nspname = 'realtime' and c.relname = 'messages')
)
select 'Q20_dependencies' as audit, d.deptype,
       pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid) as dependent,
       pg_catalog.pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) as referenced
from pg_catalog.pg_depend d
where exists(select 1 from targets t where t.classid = d.classid and t.objid = d.objid)
   or exists(select 1 from targets t where t.classid = d.refclassid and t.objid = d.refobjid)
order by dependent, referenced, d.deptype;

-- Q21: DROP ROLE blockers cluster-wide; avoid describing objects in other databases.
select 'Q21_role_dependencies' as audit, r.rolname, d.deptype,
       case when d.dbid = 0 then '<shared>' else db.datname end as database_name,
       d.classid, d.objid, d.objsubid,
       case when d.dbid = 0 or db.datname = pg_catalog.current_database()
         then pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid)
         else '<other database: separate approved audit required>' end as dependent
from pg_catalog.pg_shdepend d
join pg_catalog.pg_roles r on r.oid = d.refobjid
left join pg_catalog.pg_database db on db.oid = d.dbid
where d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
  and r.rolname in ('bs_staging_owner', 'bs_staging_app')
order by r.rolname, database_name, d.classid, d.objid, d.objsubid;

-- Q22: language requirements for creating the proposed PL/pgSQL routines.
select 'Q22_languages' as audit, l.lanname, l.lanpltrusted,
       owner.rolname as owner, pg_catalog.has_language_privilege(l.oid, 'USAGE') as executor_usage
from pg_catalog.pg_language l
join pg_catalog.pg_roles owner on owner.oid = l.lanowner
where l.lanname in ('plpgsql', 'sql') order by l.lanname;

-- Q23: connection evidence, not a substitute for JDBC verify-full or Supavisor testing.
select 'Q23_connection_tls' as audit, s.ssl, s.version, s.cipher, s.bits
from pg_catalog.pg_stat_ssl s where s.pid = pg_catalog.pg_backend_pid();

-- Q24: partition/inheritance boundaries can carry separate ACLs/policies/dependencies.
select 'Q24_inheritance' as audit, pn.nspname as parent_schema, p.relname as parent,
       cn.nspname as child_schema, c.relname as child
from pg_catalog.pg_inherits i
join pg_catalog.pg_class p on p.oid = i.inhparent
join pg_catalog.pg_namespace pn on pn.oid = p.relnamespace
join pg_catalog.pg_class c on c.oid = i.inhrelid
join pg_catalog.pg_namespace cn on cn.oid = c.relnamespace
where pn.nspname = 'bs_staging' or cn.nspname = 'bs_staging'
   or (pn.nspname = 'realtime' and p.relname = 'messages')
   or (pn.nspname = 'public' and p.relname like 'bs\_%' escape '\')
order by parent_schema, parent, child_schema, child;

-- Q25: schema grantors/grant options required by migration and exact rollback REVOKEs.
select 'Q25_schema_acl' as audit, n.nspname,
       case when a.grantee = 0 then 'PUBLIC' else r.rolname end as grantee,
       grantor.rolname as grantor, a.privilege_type, a.is_grantable
from pg_catalog.pg_namespace n
cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,
  pg_catalog.acldefault('n', n.nspowner))) a
left join pg_catalog.pg_roles r on r.oid = a.grantee
left join pg_catalog.pg_roles grantor on grantor.oid = a.grantor
where n.nspname in ('public', 'bs_staging', 'auth', 'realtime')
order by n.nspname, grantee, a.privilege_type;
