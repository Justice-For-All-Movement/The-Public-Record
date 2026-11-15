-- Least-privilege application runtime role. NOLOGIN: a deployment either logs in
-- with its own NOBYPASSRLS login role that is a member of tpr_app_runtime, or the
-- app assumes it per transaction with SET LOCAL ROLE (DATABASE_RUNTIME_ROLE).
-- No password or credential is created here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tpr_app_runtime') THEN
    BEGIN
      CREATE ROLE tpr_app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; -- concurrent creation elsewhere in the cluster
    END;
  END IF;
END $$;

-- Allow the migrating (owner) role to assume the runtime role, without inheriting it.
-- If the role pre-exists without ADMIN rights for us, an operator must grant it.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    IF NOT pg_has_role(current_user,'tpr_app_runtime','SET') THEN
      EXECUTE format('GRANT tpr_app_runtime TO %I WITH INHERIT FALSE, SET TRUE',current_user);
    END IF;
  ELSIF NOT pg_has_role(current_user,'tpr_app_runtime','MEMBER') THEN
    EXECUTE format('GRANT tpr_app_runtime TO %I',current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'tpr_app_runtime membership not granted to %; grant it or use a separate login role',current_user;
END $$;

GRANT USAGE ON SCHEMA tpr_public, tpr_private TO tpr_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA tpr_public TO tpr_app_runtime;
GRANT SELECT ON tpr_private.schema_migrations TO tpr_app_runtime;
-- Mutable working copies: no DELETE; evidentiary history is insert-only.
GRANT SELECT, INSERT, UPDATE ON tpr_private.request_drafts TO tpr_app_runtime;
GRANT SELECT, INSERT ON tpr_private.request_events TO tpr_app_runtime;
GRANT SELECT, INSERT ON tpr_private.quarantine_objects TO tpr_app_runtime;
GRANT SELECT, INSERT, UPDATE ON tpr_private.publication_grants TO tpr_app_runtime;
GRANT SELECT, INSERT ON tpr_private.audit_events TO tpr_app_runtime;
GRANT SELECT, INSERT ON tpr_private.consent_events TO tpr_app_runtime;
GRANT SELECT, INSERT ON tpr_private.retention_requests TO tpr_app_runtime;
