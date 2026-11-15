-- TPR-19: member-owned saved drafts pinned to a reviewed template version.
-- Optimistic concurrency via `version`; idempotent creation per owner.
ALTER TABLE tpr_private.request_drafts
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '' CHECK (length(title) <= 250),
  ADD COLUMN IF NOT EXISTS template_id text CHECK (template_id IS NULL OR template_id ~ '^[a-zA-Z0-9_-]{3,128}$'),
  ADD COLUMN IF NOT EXISTS template_version integer CHECK (template_version IS NULL OR template_version >= 1),
  ADD COLUMN IF NOT EXISTS agency_label text CHECK (agency_label IS NULL OR length(agency_label) <= 250),
  ADD COLUMN IF NOT EXISTS agency_component_ref text CHECK (agency_component_ref IS NULL OR
    agency_component_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  ADD COLUMN IF NOT EXISTS range_start date,
  ADD COLUMN IF NOT EXISTS range_end date,
  ADD COLUMN IF NOT EXISTS fee_cap_usd numeric(10,2) NOT NULL DEFAULT 25 CHECK (fee_cap_usd BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS electronic_copies boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS idempotency_key text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$');
ALTER TABLE tpr_private.request_drafts
  ADD CONSTRAINT request_drafts_body_size CHECK (length(draft_body) <= 20000),
  ADD CONSTRAINT request_drafts_range_order CHECK (range_start IS NULL OR range_end IS NULL OR range_start <= range_end),
  ADD CONSTRAINT request_drafts_template_pin CHECK ((template_id IS NULL) = (template_version IS NULL)),
  ADD CONSTRAINT request_drafts_owner_idempotency UNIQUE (owner_subject, idempotency_key);
