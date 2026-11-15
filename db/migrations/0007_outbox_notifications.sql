-- TPR-25: durable job outbox with bounded worker leases, retry and dead-letter,
-- plus private in-app notifications and per-member preferences.
-- A separate NOLOGIN, NOBYPASSRLS worker role may lease jobs for any owner but
-- cannot read drafts, events or audit history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tpr_worker_runtime') THEN
    BEGIN
      CREATE ROLE tpr_worker_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    IF NOT pg_has_role(current_user,'tpr_worker_runtime','SET') THEN
      EXECUTE format('GRANT tpr_worker_runtime TO %I WITH INHERIT FALSE, SET TRUE',current_user);
    END IF;
  ELSIF NOT pg_has_role(current_user,'tpr_worker_runtime','MEMBER') THEN
    EXECUTE format('GRANT tpr_worker_runtime TO %I',current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'tpr_worker_runtime membership not granted to %',current_user;
END $$;

CREATE TABLE IF NOT EXISTS tpr_private.outbox_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 255),
  kind text NOT NULL CHECK (kind IN ('deadline_reminder')),
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[A-Za-z0-9:_.-]{3,200}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object' AND length(payload::text) <= 1024),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','done','dead','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner text CHECK (lease_owner IS NULL OR lease_owner ~ '^[A-Za-z0-9_-]{3,64}$'),
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (owner_subject,dedupe_key),
  CHECK ((status='leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS outbox_ready_idx ON tpr_private.outbox_jobs(run_after) WHERE status IN ('pending','leased');

CREATE TABLE IF NOT EXISTS tpr_private.member_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 255),
  job_id uuid UNIQUE REFERENCES tpr_private.outbox_jobs(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('deadline_reminder')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 600),
  link_path text CHECK (link_path IS NULL OR link_path ~ '^/me(/[A-Za-z0-9/_-]*)?$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_owner_idx ON tpr_private.member_notifications(owner_subject,created_at DESC);

CREATE TABLE IF NOT EXISTS tpr_private.notification_preferences (
  owner_subject text PRIMARY KEY CHECK (length(owner_subject) BETWEEN 1 AND 255),
  deadline_reminders boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tpr_private.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_code_check;
ALTER TABLE tpr_private.audit_events ADD CONSTRAINT audit_events_action_code_check CHECK (action_code IN (
  'draft_created','draft_updated','request_self_reported','agency_evidence_reviewed',
  'evidence_quarantined','evidence_scan_result','consent_granted',
  'consent_revoked','publication_reviewed','access_grant_changed',
  'retention_requested','retention_resolved',
  'session_started','session_ended','draft_adopted','lifecycle_event_recorded',
  'notification_preference_changed'));
ALTER TABLE tpr_private.audit_events DROP CONSTRAINT IF EXISTS audit_events_object_kind_check;
ALTER TABLE tpr_private.audit_events ADD CONSTRAINT audit_events_object_kind_check CHECK (object_kind IN (
  'request_draft','request_event','quarantine_object','publication_consent',
  'publication_derivative','retention_request','role_grant','session','lifecycle_event','member_account',
  'notification_preference'));

ALTER TABLE tpr_private.outbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.outbox_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.member_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.member_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.notification_preferences FORCE ROW LEVEL SECURITY;
-- Members: own rows only.
CREATE POLICY owner_jobs ON tpr_private.outbox_jobs TO tpr_app_runtime
  USING (owner_subject = current_setting('tpr.subject',true))
  WITH CHECK (owner_subject = current_setting('tpr.subject',true) AND status='pending' AND attempts=0);
CREATE POLICY owner_notifications ON tpr_private.member_notifications TO tpr_app_runtime
  USING (owner_subject = current_setting('tpr.subject',true))
  WITH CHECK (owner_subject = current_setting('tpr.subject',true));
CREATE POLICY owner_preferences ON tpr_private.notification_preferences TO tpr_app_runtime
  USING (owner_subject = current_setting('tpr.subject',true))
  WITH CHECK (owner_subject = current_setting('tpr.subject',true));
-- Worker: all jobs; may insert notifications and read preferences; nothing else.
CREATE POLICY worker_jobs ON tpr_private.outbox_jobs TO tpr_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY worker_notifications ON tpr_private.member_notifications FOR INSERT TO tpr_worker_runtime WITH CHECK (true);
CREATE POLICY worker_reads_notification_ids ON tpr_private.member_notifications FOR SELECT TO tpr_worker_runtime USING (true);
CREATE POLICY worker_reads_preferences ON tpr_private.notification_preferences FOR SELECT TO tpr_worker_runtime USING (true);

GRANT SELECT, INSERT ON tpr_private.outbox_jobs TO tpr_app_runtime;
GRANT SELECT ON tpr_private.member_notifications TO tpr_app_runtime;
GRANT UPDATE (read_at) ON tpr_private.member_notifications TO tpr_app_runtime;
GRANT SELECT, INSERT, UPDATE ON tpr_private.notification_preferences TO tpr_app_runtime;
GRANT USAGE ON SCHEMA tpr_private TO tpr_worker_runtime;
GRANT SELECT ON tpr_private.schema_migrations TO tpr_worker_runtime;
GRANT SELECT, UPDATE ON tpr_private.outbox_jobs TO tpr_worker_runtime;
GRANT SELECT (id, job_id), INSERT ON tpr_private.member_notifications TO tpr_worker_runtime;
GRANT SELECT ON tpr_private.notification_preferences TO tpr_worker_runtime;
