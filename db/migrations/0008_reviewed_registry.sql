-- TPR-12/17: reviewed FOIA request templates and official filing routes.
-- Public reference data, written only through role-checked server routes.
-- Database triggers enforce independent review and immutability after review.
CREATE TABLE IF NOT EXISTS tpr_public.request_template_versions (
  template_id text NOT NULL CHECK (template_id ~ '^[a-zA-Z0-9_-]{3,128}$'),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 250),
  agency_component_id text NOT NULL CHECK (agency_component_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  agency_label text NOT NULL CHECK (length(agency_label) BETWEEN 3 AND 250),
  records_description text NOT NULL CHECK (length(records_description) BETWEEN 25 AND 6000),
  range_start date,
  range_end date,
  source_ids text[] NOT NULL DEFAULT '{}' CHECK (cardinality(source_ids) <= 100),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','in_review','published','retired','rejected')),
  editor_subject text NOT NULL CHECK (length(editor_subject) BETWEEN 1 AND 255),
  reviewer_subject text CHECK (reviewer_subject IS NULL OR length(reviewer_subject) <= 255),
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  PRIMARY KEY (template_id, version),
  CHECK (range_start IS NULL OR range_end IS NULL OR range_start <= range_end),
  CHECK (state NOT IN ('published','retired','rejected') OR (reviewer_subject IS NOT NULL AND reviewer_subject <> editor_subject AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_published_template_version
  ON tpr_public.request_template_versions(template_id) WHERE state='published';

CREATE OR REPLACE FUNCTION tpr_public.guard_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Template versions are never deleted'; END IF;
  IF OLD.state <> 'draft' AND (NEW.title,NEW.agency_component_id,NEW.agency_label,NEW.records_description,
       NEW.range_start,NEW.range_end,NEW.source_ids,NEW.editor_subject,NEW.template_id,NEW.version)
     IS DISTINCT FROM (OLD.title,OLD.agency_component_id,OLD.agency_label,OLD.records_description,
       OLD.range_start,OLD.range_end,OLD.source_ids,OLD.editor_subject,OLD.template_id,OLD.version) THEN
    RAISE EXCEPTION 'Submitted template versions are immutable; create a new version';
  END IF;
  IF NOT ((OLD.state='draft' AND NEW.state IN ('draft','in_review'))
       OR (OLD.state='in_review' AND NEW.state IN ('published','rejected'))
       OR (OLD.state='published' AND NEW.state='retired')) THEN
    RAISE EXCEPTION 'Invalid template state transition % -> %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER template_versions_guard BEFORE UPDATE OR DELETE ON tpr_public.request_template_versions
  FOR EACH ROW EXECUTE FUNCTION tpr_public.guard_template_version();

CREATE TABLE IF NOT EXISTS tpr_public.filing_trusted_hosts (
  host text PRIMARY KEY CHECK (host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND length(host) <= 253),
  purpose text NOT NULL CHECK (purpose IN ('source','channel','both')),
  added_by text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tpr_public.filing_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_component_id text NOT NULL CHECK (agency_component_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  source_url text NOT NULL CHECK (source_url ~ '^https://' AND length(source_url) <= 2048),
  channel_kind text NOT NULL CHECK (channel_kind IN ('portal','email')),
  channel_value text NOT NULL CHECK (length(channel_value) BETWEEN 3 AND 2048),
  acknowledgement text NOT NULL CHECK (length(acknowledgement) BETWEEN 3 AND 400),
  approval text NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending','approved','rejected','superseded')),
  proposed_by text NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  verified_by text,
  verified_at timestamptz,
  CHECK ((channel_kind='portal') = (channel_value ~ '^https://')),
  CHECK (approval NOT IN ('approved','rejected','superseded') OR (verified_by IS NOT NULL AND verified_by <> proposed_by AND verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_approved_route_per_component
  ON tpr_public.filing_routes(agency_component_id) WHERE approval='approved';

CREATE OR REPLACE FUNCTION tpr_public.guard_filing_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Filing routes are never deleted'; END IF;
  IF (NEW.agency_component_id,NEW.source_url,NEW.channel_kind,NEW.channel_value,NEW.acknowledgement,NEW.proposed_by)
     IS DISTINCT FROM (OLD.agency_component_id,OLD.source_url,OLD.channel_kind,OLD.channel_value,OLD.acknowledgement,OLD.proposed_by) THEN
    RAISE EXCEPTION 'Filing route content is immutable; propose a new route';
  END IF;
  IF NOT ((OLD.approval='pending' AND NEW.approval IN ('approved','rejected'))
       OR (OLD.approval='approved' AND NEW.approval='superseded')
       OR (OLD.approval='approved' AND NEW.approval='approved')) THEN
    RAISE EXCEPTION 'Invalid filing route transition % -> %', OLD.approval, NEW.approval;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER filing_routes_guard BEFORE UPDATE OR DELETE ON tpr_public.filing_routes
  FOR EACH ROW EXECUTE FUNCTION tpr_public.guard_filing_route();

ALTER TABLE tpr_private.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_code_check;
ALTER TABLE tpr_private.audit_events ADD CONSTRAINT audit_events_action_code_check CHECK (action_code IN (
  'draft_created','draft_updated','request_self_reported','agency_evidence_reviewed',
  'evidence_quarantined','evidence_scan_result','consent_granted',
  'consent_revoked','publication_reviewed','access_grant_changed',
  'retention_requested','retention_resolved',
  'session_started','session_ended','draft_adopted','lifecycle_event_recorded',
  'notification_preference_changed',
  'template_version_saved','template_version_reviewed','filing_route_proposed','filing_route_reviewed','trusted_host_added'));
ALTER TABLE tpr_private.audit_events DROP CONSTRAINT IF EXISTS audit_events_object_kind_check;
ALTER TABLE tpr_private.audit_events ADD CONSTRAINT audit_events_object_kind_check CHECK (object_kind IN (
  'request_draft','request_event','quarantine_object','publication_consent',
  'publication_derivative','retention_request','role_grant','session','lifecycle_event','member_account',
  'notification_preference','request_template','filing_route','trusted_host'));

GRANT SELECT, INSERT ON tpr_public.request_template_versions TO tpr_app_runtime;
GRANT UPDATE (title,agency_component_id,agency_label,records_description,range_start,range_end,source_ids,state,
  reviewer_subject,review_note,reviewed_at) ON tpr_public.request_template_versions TO tpr_app_runtime;
GRANT SELECT, INSERT ON tpr_public.filing_routes, tpr_public.filing_trusted_hosts TO tpr_app_runtime;
GRANT UPDATE (approval,verified_by,verified_at) ON tpr_public.filing_routes TO tpr_app_runtime;
