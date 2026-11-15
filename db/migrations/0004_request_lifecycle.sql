-- TPR-23: typed, append-only request lifecycle events. Corrections are new rows
-- that reference the corrected event; nothing is updated or deleted.
CREATE TABLE IF NOT EXISTS tpr_private.request_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 255),
  event_type text NOT NULL CHECK (event_type IN (
    'adopted','drafted','filed','receipt_confirmed','acknowledged',
    'clarification_requested','clarification_answered','fee_estimate_received','fee_response_sent',
    'extension_notice','alternative_timeframe_agreed','expedite_requested','expedite_decided',
    'referral','interim_release','final_determination',
    'appeal_filed','appeal_received','appeal_determination',
    'closed','reopened','withdrawn','correction')),
  occurred_on date NOT NULL CHECK (occurred_on BETWEEN DATE '1990-01-01' AND DATE '2200-12-31'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  asserted_by text NOT NULL CHECK (asserted_by IN ('requester','agency_document','reviewer')),
  verification text NOT NULL CHECK (verification IN ('self_reported','document_attached','reviewer_verified')),
  evidence_ref text CHECK (evidence_ref IS NULL OR evidence_ref ~ '^[A-Za-z0-9:_.-]{1,160}$'),
  caused_by uuid,
  corrects_event_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object' AND length(payload::text) <= 2048),
  idempotency_key text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  FOREIGN KEY (request_id,owner_subject)
    REFERENCES tpr_private.request_drafts(id,owner_subject) ON DELETE RESTRICT,
  UNIQUE (owner_subject,request_id,idempotency_key),
  UNIQUE (id,request_id,owner_subject),
  -- Causal and correction links stay within the same owner's request.
  FOREIGN KEY (caused_by,request_id,owner_subject)
    REFERENCES tpr_private.request_lifecycle_events(id,request_id,owner_subject) ON DELETE RESTRICT,
  FOREIGN KEY (corrects_event_id,request_id,owner_subject)
    REFERENCES tpr_private.request_lifecycle_events(id,request_id,owner_subject) ON DELETE RESTRICT,
  CHECK ((event_type='correction') = (corrects_event_id IS NOT NULL)),
  CHECK (verification <> 'document_attached' OR evidence_ref IS NOT NULL),
  CHECK (verification <> 'reviewer_verified' OR (asserted_by='reviewer' AND evidence_ref IS NOT NULL)),
  CHECK (asserted_by <> 'agency_document' OR verification <> 'self_reported')
);
CREATE INDEX IF NOT EXISTS lifecycle_events_request_idx
  ON tpr_private.request_lifecycle_events(owner_subject,request_id,recorded_at,id);

CREATE TRIGGER lifecycle_events_append_only
  BEFORE UPDATE OR DELETE ON tpr_private.request_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION tpr_private.reject_event_mutation();

ALTER TABLE tpr_private.request_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.request_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_reads_lifecycle ON tpr_private.request_lifecycle_events
  FOR SELECT USING (owner_subject = current_setting('tpr.subject',true));
-- Participants may only record their own, non-reviewer events.
CREATE POLICY owner_records_lifecycle ON tpr_private.request_lifecycle_events
  FOR INSERT WITH CHECK (owner_subject = current_setting('tpr.subject',true)
    AND asserted_by <> 'reviewer' AND verification <> 'reviewer_verified');

GRANT SELECT, INSERT ON tpr_private.request_lifecycle_events TO tpr_app_runtime;
