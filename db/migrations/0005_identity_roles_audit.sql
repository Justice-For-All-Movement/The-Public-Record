-- TPR-07/08/10: member accounts, revocable sessions, server-owned role grants,
-- and audit action codes for authenticated actions. No credentials stored.
CREATE TABLE IF NOT EXISTS tpr_private.member_accounts (
  owner_subject text PRIMARY KEY CHECK (length(owner_subject) BETWEEN 1 AND 255),
  issuer text NOT NULL CHECK (issuer ~ '^https://[^\s]{3,240}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tpr_private.app_sessions (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{20,30}$'),
  owner_subject text NOT NULL REFERENCES tpr_private.member_accounts(owner_subject) ON DELETE RESTRICT,
  issuer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
CREATE INDEX IF NOT EXISTS app_sessions_owner_idx ON tpr_private.app_sessions(owner_subject,created_at DESC);

-- Append-only role grant history. The runtime role can only READ its own
-- grants: privileged roles are provisioned out of band by the database owner.
CREATE TABLE IF NOT EXISTS tpr_private.role_grant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 255),
  issuer text NOT NULL CHECK (issuer ~ '^https://'),
  role text NOT NULL CHECK (role IN ('requester','contributor','researcher','editor','records_reviewer','moderator','admin','operator')),
  grant_action text NOT NULL CHECK (grant_action IN ('granted','revoked')),
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 255),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (actor_subject <> owner_subject)
);
CREATE INDEX IF NOT EXISTS role_grant_events_owner_idx ON tpr_private.role_grant_events(owner_subject,role,recorded_at DESC,id DESC);
CREATE TRIGGER role_grant_events_append_only
  BEFORE UPDATE OR DELETE ON tpr_private.role_grant_events
  FOR EACH ROW EXECUTE FUNCTION tpr_private.reject_event_mutation();

ALTER TABLE tpr_private.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_code_check;
ALTER TABLE tpr_private.audit_events ADD CONSTRAINT audit_events_action_code_check CHECK (action_code IN (
  'draft_created','draft_updated','request_self_reported','agency_evidence_reviewed',
  'evidence_quarantined','evidence_scan_result','consent_granted',
  'consent_revoked','publication_reviewed','access_grant_changed',
  'retention_requested','retention_resolved',
  'session_started','session_ended','draft_adopted','lifecycle_event_recorded'));
ALTER TABLE tpr_private.audit_events DROP CONSTRAINT IF EXISTS audit_events_object_kind_check;
ALTER TABLE tpr_private.audit_events ADD CONSTRAINT audit_events_object_kind_check CHECK (object_kind IN (
  'request_draft','request_event','quarantine_object','publication_consent',
  'publication_derivative','retention_request','role_grant','session','lifecycle_event','member_account'));

ALTER TABLE tpr_private.member_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.member_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.app_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.role_grant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.role_grant_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only_accounts ON tpr_private.member_accounts
  USING (owner_subject = current_setting('tpr.subject',true))
  WITH CHECK (owner_subject = current_setting('tpr.subject',true) AND status='active');
CREATE POLICY owner_only_sessions ON tpr_private.app_sessions
  USING (owner_subject = current_setting('tpr.subject',true))
  WITH CHECK (owner_subject = current_setting('tpr.subject',true));
CREATE POLICY owner_reads_role_grants ON tpr_private.role_grant_events
  FOR SELECT USING (owner_subject = current_setting('tpr.subject',true));

GRANT SELECT, INSERT ON tpr_private.member_accounts TO tpr_app_runtime;
GRANT UPDATE (last_login_at) ON tpr_private.member_accounts TO tpr_app_runtime;
GRANT SELECT, INSERT ON tpr_private.app_sessions TO tpr_app_runtime;
GRANT UPDATE (revoked_at) ON tpr_private.app_sessions TO tpr_app_runtime;
GRANT SELECT ON tpr_private.role_grant_events TO tpr_app_runtime;
