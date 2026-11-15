-- TPR-28: metadata for scanned, encrypted private uploads. Rejected uploads are
-- never stored; only their SHA-256 and reason reach the audit trail.
ALTER TABLE tpr_private.quarantine_objects
  ADD COLUMN IF NOT EXISTS mime text CHECK (mime IS NULL OR mime IN ('application/pdf','text/plain','image/png','image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  ADD COLUMN IF NOT EXISTS size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 26214400),
  ADD COLUMN IF NOT EXISTS extension text CHECK (extension IS NULL OR extension ~ '^[a-z]{2,4}$'),
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'correspondence' CHECK (purpose IN ('correspondence','receipt','released_record')),
  ADD COLUMN IF NOT EXISTS scanner text CHECK (scanner IS NULL OR scanner IN ('fake','clamav')),
  ADD COLUMN IF NOT EXISTS scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS storage_driver text CHECK (storage_driver IS NULL OR storage_driver IN ('memory','local','s3'));
ALTER TABLE tpr_private.quarantine_objects
  ADD CONSTRAINT quarantine_key_shape CHECK (private_storage_key ~ '^private/quarantine/v1/[0-9a-f]{32}/[0-9a-f-]{36}$') NOT VALID;
