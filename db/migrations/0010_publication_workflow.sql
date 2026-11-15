-- TPR-31: explicit, per-object publication with independent review.
-- Only agency-released records are eligible; correspondence and receipts are not.
-- Public delivery goes through SECURITY DEFINER functions that return a record
-- only while it is published AND the owner's latest consent event is a grant.
CREATE TABLE IF NOT EXISTS tpr_private.publication_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 255),
  quarantine_object_id text NOT NULL,
  object_sha256 text NOT NULL CHECK (object_sha256 ~ '^[0-9a-f]{64}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  agency_label text CHECK (agency_label IS NULL OR length(agency_label) <= 250),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_review','published','rejected','withdrawn')),
  assigned_reviewer text CHECK (assigned_reviewer IS NULL OR length(assigned_reviewer) <= 255),
  attestation jsonb CHECK (attestation IS NULL OR jsonb_typeof(attestation)='object'),
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 1000),
  public_id text UNIQUE CHECK (public_id IS NULL OR public_id ~ '^pub_[0-9a-f]{20}$'),
  derivative_key text UNIQUE CHECK (derivative_key IS NULL OR derivative_key ~ '^private/derivative/v1/[0-9a-f]{32}/[0-9a-f-]{36}$'),
  mime text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  withdrawn_at timestamptz,
  FOREIGN KEY (quarantine_object_id,owner_subject) REFERENCES tpr_private.quarantine_objects(id,owner_subject) ON DELETE RESTRICT,
  CHECK (assigned_reviewer IS NULL OR assigned_reviewer <> owner_subject),
  CHECK (status <> 'published' OR (public_id IS NOT NULL AND derivative_key IS NOT NULL AND published_at IS NOT NULL AND assigned_reviewer IS NOT NULL AND attestation IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_publication_per_object
  ON tpr_private.publication_requests(quarantine_object_id) WHERE status IN ('requested','in_review','published');

CREATE OR REPLACE FUNCTION tpr_private.guard_publication_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Publication history is never deleted'; END IF;
  IF (NEW.owner_subject,NEW.quarantine_object_id,NEW.object_sha256,NEW.title,NEW.description,NEW.created_at)
     IS DISTINCT FROM (OLD.owner_subject,OLD.quarantine_object_id,OLD.object_sha256,OLD.title,OLD.description,OLD.created_at) THEN
    RAISE EXCEPTION 'Publication request content is immutable';
  END IF;
  IF NOT ((OLD.status='requested' AND NEW.status IN ('in_review','withdrawn'))
       OR (OLD.status='in_review' AND NEW.status IN ('published','rejected','withdrawn'))
       OR (OLD.status='published' AND NEW.status='withdrawn')) THEN
    RAISE EXCEPTION 'Invalid publication transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_requests_guard BEFORE UPDATE OR DELETE ON tpr_private.publication_requests
  FOR EACH ROW EXECUTE FUNCTION tpr_private.guard_publication_request();

ALTER TABLE tpr_private.publication_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpr_private.publication_requests FORCE ROW LEVEL SECURITY;
-- Owner: read, create (requested only), withdraw.
CREATE POLICY owner_reads_publications ON tpr_private.publication_requests FOR SELECT
  USING (owner_subject = current_setting('tpr.subject',true));
CREATE POLICY owner_requests_publication ON tpr_private.publication_requests FOR INSERT
  WITH CHECK (owner_subject = current_setting('tpr.subject',true) AND status='requested' AND assigned_reviewer IS NULL);
CREATE POLICY owner_withdraws_publication ON tpr_private.publication_requests FOR UPDATE
  USING (owner_subject = current_setting('tpr.subject',true))
  WITH CHECK (owner_subject = current_setting('tpr.subject',true) AND status='withdrawn');
-- Records reviewers (server-owned role in tpr.roles): see the unclaimed queue and their assignments.
CREATE POLICY reviewer_reads_publications ON tpr_private.publication_requests FOR SELECT
  USING ('records_reviewer' = ANY(string_to_array(current_setting('tpr.roles',true),','))
    AND owner_subject <> current_setting('tpr.subject',true)
    AND ((status='requested' AND assigned_reviewer IS NULL) OR assigned_reviewer = current_setting('tpr.subject',true)));
CREATE POLICY reviewer_updates_publications ON tpr_private.publication_requests FOR UPDATE
  USING ('records_reviewer' = ANY(string_to_array(current_setting('tpr.roles',true),','))
    AND owner_subject <> current_setting('tpr.subject',true)
    AND ((status='requested' AND assigned_reviewer IS NULL) OR assigned_reviewer = current_setting('tpr.subject',true)))
  WITH CHECK (assigned_reviewer = current_setting('tpr.subject',true) AND status IN ('in_review','published','rejected'));
-- An assigned reviewer may read exactly the object under review.
CREATE POLICY reviewer_reads_assigned_object ON tpr_private.quarantine_objects FOR SELECT
  USING (EXISTS (SELECT 1 FROM tpr_private.publication_requests pr
    WHERE pr.quarantine_object_id = quarantine_objects.id AND pr.owner_subject = quarantine_objects.owner_subject
      AND pr.status='in_review' AND pr.assigned_reviewer = current_setting('tpr.subject',true)));

GRANT SELECT, INSERT ON tpr_private.publication_requests TO tpr_app_runtime;
GRANT UPDATE (status,assigned_reviewer,attestation,review_note,public_id,derivative_key,mime,size_bytes,reviewed_at,published_at,withdrawn_at)
  ON tpr_private.publication_requests TO tpr_app_runtime;

-- Public delivery runs as a dedicated NOLOGIN, NOBYPASSRLS role whose policies
-- expose only published requests and consent events (FORCE RLS applies even to
-- table owners, so the functions cannot run as the owner).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tpr_publication_reader') THEN
    BEGIN
      CREATE ROLE tpr_publication_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    IF NOT pg_has_role(current_user,'tpr_publication_reader','SET') THEN
      EXECUTE format('GRANT tpr_publication_reader TO %I WITH INHERIT FALSE, SET TRUE',current_user);
    END IF;
  ELSIF NOT pg_has_role(current_user,'tpr_publication_reader','MEMBER') THEN
    EXECUTE format('GRANT tpr_publication_reader TO %I',current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'tpr_publication_reader membership not granted to %',current_user;
END $$;
GRANT USAGE ON SCHEMA tpr_private, tpr_public TO tpr_publication_reader;
GRANT SELECT ON tpr_private.publication_requests, tpr_private.consent_events TO tpr_publication_reader;
CREATE POLICY publication_reader_published ON tpr_private.publication_requests FOR SELECT TO tpr_publication_reader
  USING (status='published');
CREATE POLICY publication_reader_consent ON tpr_private.consent_events FOR SELECT TO tpr_publication_reader USING (true);

-- Public delivery: only published + currently consented records, only public fields.
CREATE OR REPLACE FUNCTION tpr_public.published_record(p_public_id text)
RETURNS TABLE(public_id text,title text,description text,agency_label text,mime text,size_bytes bigint,sha256 text,
  derivative_key text,published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, tpr_private AS $$
  SELECT pr.public_id,pr.title,pr.description,pr.agency_label,pr.mime,pr.size_bytes,pr.object_sha256,pr.derivative_key,pr.published_at
  FROM tpr_private.publication_requests pr
  WHERE pr.public_id = p_public_id AND pr.status='published'
    AND (SELECT ce.event_action FROM tpr_private.consent_events ce
         WHERE ce.quarantine_object_id = pr.quarantine_object_id AND ce.owner_subject = pr.owner_subject AND ce.scope='web_publication'
         ORDER BY ce.recorded_at DESC, ce.id DESC LIMIT 1) = 'granted';
$$;
CREATE OR REPLACE FUNCTION tpr_public.published_records(p_limit integer)
RETURNS TABLE(public_id text,title text,agency_label text,mime text,published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, tpr_private AS $$
  SELECT pr.public_id,pr.title,pr.agency_label,pr.mime,pr.published_at
  FROM tpr_private.publication_requests pr
  WHERE pr.status='published'
    AND (SELECT ce.event_action FROM tpr_private.consent_events ce
         WHERE ce.quarantine_object_id = pr.quarantine_object_id AND ce.owner_subject = pr.owner_subject AND ce.scope='web_publication'
         ORDER BY ce.recorded_at DESC, ce.id DESC LIMIT 1) = 'granted'
  ORDER BY pr.published_at DESC LIMIT LEAST(GREATEST(p_limit,1),200);
$$;
-- Ownership transfer needs CREATE on the schema at that moment only.
GRANT CREATE ON SCHEMA tpr_public TO tpr_publication_reader;
ALTER FUNCTION tpr_public.published_record(text) OWNER TO tpr_publication_reader;
ALTER FUNCTION tpr_public.published_records(integer) OWNER TO tpr_publication_reader;
REVOKE CREATE ON SCHEMA tpr_public FROM tpr_publication_reader;
REVOKE ALL ON FUNCTION tpr_public.published_record(text), tpr_public.published_records(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tpr_public.published_record(text), tpr_public.published_records(integer) TO tpr_app_runtime;
